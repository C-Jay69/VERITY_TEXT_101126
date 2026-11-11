// File parsing & validation for VerityText.
//
// All functions are safe to call server-side only.
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { Buffer } from "node:buffer";
import path from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

// pdf-parse uses pdfjs-dist under the hood, which dynamically imports a
// worker module via `GlobalWorkerOptions.workerSrc`. Point it at the on-disk
// worker file from pdfjs-dist as a file:// URL before parsing. Runs once.
let pdfWorkerConfigured = false;
function ensurePdfWorker() {
  if (pdfWorkerConfigured) return;
  pdfWorkerConfigured = true;
  const candidates = [
    path.join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"),
    path.join(process.cwd(), "node_modules/pdfjs-dist/build/pdf.worker.mjs"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      try {
        PDFParse.setWorker(pathToFileURL(c).href);
        return;
      } catch {
        // ignore — try the next candidate
      }
    }
  }
}

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5,242,880 bytes
export const ACCEPTED_EXTENSIONS = [".docx", ".pdf", ".txt"] as const;
export type AcceptedExt = (typeof ACCEPTED_EXTENSIONS)[number];

export interface FileMeta {
  filename: string;
  size: number;
  ext: AcceptedExt;
  mime: string;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  meta?: FileMeta;
}

export interface ExtractResult {
  text: string;
  meta: {
    ext: AcceptedExt;
    wordCount: number;
    partialAnalysis: boolean;
    warnings: string[];
  };
}

/**
 * Validate an uploaded file by extension, declared MIME type, AND magic bytes.
 */
export function validateFile(
  filename: string,
  declaredMime: string,
  size: number,
  buffer: Uint8Array,
): ValidationResult {
  if (size <= 0) {
    return { ok: false, error: "File is empty." };
  }
  if (size > MAX_FILE_SIZE) {
    return {
      ok: false,
      error: `File is ${(size / 1024 / 1024).toFixed(2)} MB. Maximum is 5.00 MB (5,242,880 bytes).`,
    };
  }
  const lower = filename.toLowerCase();
  const ext = ACCEPTED_EXTENSIONS.find((e) => lower.endsWith(e));
  if (!ext) {
    return {
      ok: false,
      error: `Unsupported file type. Accepted: ${ACCEPTED_EXTENSIONS.join(", ")}.`,
    };
  }

  // Declared MIME check (be lenient: accept generic application/octet-stream
  // because some browsers mislabel; only reject obvious mismatches).
  const declaredLower = (declaredMime || "").toLowerCase();
  const acceptableMimes: Record<AcceptedExt, string[]> = {
    ".docx": [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/octet-stream",
      "application/zip",
      "",
    ],
    ".pdf": ["application/pdf", "application/octet-stream", ""],
    ".txt": ["text/plain", "application/octet-stream", "text/plain; charset=utf-8", ""],
  };
  const accept = acceptableMimes[ext];
  if (!accept.includes(declaredLower) && !declaredLower.startsWith("text/")) {
    return {
      ok: false,
      error: `MIME type "${declaredMime}" does not match extension "${ext}".`,
    };
  }

  // Magic bytes.
  const magic = magicType(buffer);
  const expected: Record<AcceptedExt, string> = {
    ".docx": "zip",
    ".pdf": "pdf",
    ".txt": "text",
  };
  if (magic !== expected[ext]) {
    return {
      ok: false,
      error: `File contents do not match its extension "${ext}" (magic bytes indicate ${magic || "unknown"}). The file may have been renamed.`,
    };
  }

  return {
    ok: true,
    meta: { filename, size, ext, mime: declaredMime || extToMime(ext) },
  };
}

function extToMime(ext: AcceptedExt): string {
  switch (ext) {
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".pdf":
      return "application/pdf";
    case ".txt":
      return "text/plain";
  }
}

function magicType(buf: Uint8Array): "pdf" | "zip" | "text" | "" {
  if (buf.length < 4) return "";
  // %PDF
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return "pdf";
  }
  // PK\x03\x04 (ZIP, which is what a .docx is)
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    return "zip";
  }
  // Also accept PK\x05\x06 (empty zip) and PK\x07\x08 (spanned zip).
  if (buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x05 || buf[2] === 0x07)) {
    return "zip";
  }
  // Text: must be mostly printable ASCII / valid UTF-8.
  let printable = 0;
  let total = 0;
  const limit = Math.min(buf.length, 1024);
  for (let i = 0; i < limit; i++) {
    const b = buf[i];
    total++;
    // Allow common whitespace, printable ASCII, and UTF-8 continuation bytes.
    if (
      (b >= 0x20 && b <= 0x7e) ||
      b === 0x09 ||
      b === 0x0a ||
      b === 0x0d ||
      b >= 0x80
    ) {
      printable++;
    }
  }
  if (total > 0 && printable / total > 0.9) return "text";
  return "";
}

/**
 * Extract text from a validated file. Sanitizes the result (NFC normalize,
 * strip nulls, collapse runs of whitespace while preserving paragraph breaks).
 */
export async function extractText(
  buffer: Uint8Array,
  meta: FileMeta,
): Promise<ExtractResult> {
  let raw: string;
  try {
    switch (meta.ext) {
      case ".docx":
        raw = await extractDocx(buffer);
        break;
      case ".pdf":
        raw = await extractPdf(buffer);
        break;
      case ".txt":
        raw = extractTxt(buffer);
        break;
    }
  } catch (err) {
    // Distinguish known error cases.
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[veritytext] extractText failed:", msg, err instanceof Error ? err.stack : "");
    if (/password|encrypt/i.test(msg)) {
      throw new Error(
        "This file appears to be encrypted or password-protected. Please provide an unprotected file.",
      );
    }
    if (/corrupt|invalid|bad/i.test(msg)) {
      throw new Error("Could not read file — it may be corrupt.");
    }
    // If the message itself is descriptive enough, surface it; otherwise generic.
    if (msg && msg.length < 200 && /[\w ]{10,}/.test(msg)) {
      throw new Error(`Could not read file: ${msg}`);
    }
    throw new Error("Could not read file.");
  }

  const warnings: string[] = [];
  const sanitized = sanitizeText(raw, warnings);
  const wordCount = countWords(sanitized);

  // Edge case: PDF that yielded <50 words despite valid magic bytes → likely
  // a scanned PDF (image-only).
  if (meta.ext === ".pdf" && wordCount < 50 && sanitized.trim().length < 200) {
    throw new Error(
      "This PDF appears to be scanned images. OCR is not supported in v1.",
    );
  }
  if (wordCount < 50) {
    throw new Error(
      "Not enough text to analyze reliably — fewer than 50 words were extracted.",
    );
  }

  const partialAnalysis = sanitized.length > 50_000;
  return {
    text: sanitized,
    meta: {
      ext: meta.ext,
      wordCount,
      partialAnalysis,
      warnings,
    },
  };
}

async function extractDocx(buffer: Uint8Array): Promise<string> {
  const buf = Buffer.from(buffer);
  const result = await mammoth.extractRawText({ buffer: buf });
  return result.value || "";
}

async function extractPdf(buffer: Uint8Array): Promise<string> {
  ensurePdfWorker();
  const buf = Buffer.from(buffer);
  // pdf-parse v2 exposes a `PDFParse` class. Construct with the buffer as
  // `data` (TypedArray), then call `.getText()`. Encrypted PDFs will throw
  // a PasswordException — we surface that as a friendly error.
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    // The TextResult has `.text` (concatenated) and `.pages`.
    let text = "";
    if (result && typeof (result as { text?: string }).text === "string") {
      text = (result as { text: string }).text;
    } else if (result && Array.isArray((result as { pages?: { text?: string }[] }).pages)) {
      text = (result as { pages: { text?: string }[] })
        .pages.map((p) => p.text ?? "")
        .join("\n\n");
    }
    return text;
  } finally {
    await parser.destroy().catch(() => {
      // ignore destroy errors
    });
  }
}

function extractTxt(buffer: Uint8Array): string {
  const buf = Buffer.from(buffer);
  // Try UTF-8 first; if there are too many replacement chars, reject.
  let text = buf.toString("utf8");
  const replacementCount = (text.match(/\uFFFD/g) ?? []).length;
  if (replacementCount > 0 && replacementCount / Math.max(text.length, 1) > 0.01) {
    // Try latin1 as a fallback heuristic — if that looks cleaner, use it.
    const latin1 = buf.toString("latin1");
    const latin1Replacement = (latin1.match(/\uFFFD/g) ?? []).length;
    if (latin1Replacement < replacementCount) {
      text = latin1;
    } else {
      throw new Error(
        "File is not valid UTF-8 text and could not be transcoded cleanly.",
      );
    }
  }
  return text;
}

function sanitizeText(raw: string, warnings: string[]): string {
  if (!raw) return "";
  // Strip null bytes.
  let out = raw.replace(/\0/g, "");
  // NFC normalize.
  out = out.normalize("NFC");
  // Detect replacement characters from the source (txt path already handled).
  // Collapse runs of internal whitespace (tabs/spaces) to a single space,
  // but preserve paragraph breaks (double newlines).
  out = out.replace(/\r\n?/g, "\n");
  // Normalize 3+ newlines to 2 (paragraph break).
  out = out.replace(/\n{3,}/g, "\n\n");
  // Trim trailing spaces per line.
  out = out
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, "").replace(/^[ \t]+/g, ""))
    .join("\n");
  // Collapse multiple spaces inside lines.
  out = out.replace(/[ \t]{2,}/g, " ");
  // Trim leading/trailing whitespace overall.
  out = out.trim();
  return out;
}

function countWords(text: string): number {
  const matches = text.toLowerCase().match(/[a-z0-9'’-]+/g);
  return matches ? matches.length : 0;
}
