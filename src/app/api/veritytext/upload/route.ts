// POST /api/veritytext/upload
// Multipart form-data with a `file` field (.docx / .pdf / .txt, <= 15 MB).
// Validates extension + MIME + magic bytes, extracts text, runs detection,
// creates a session, and returns { sessionId, meta, extractedLength, report }.
import { NextRequest, NextResponse } from "next/server";
import { validateFile, extractText, MAX_FILE_SIZE } from "@/lib/veritytext/parsing";
import { createSession, updateSession } from "@/lib/veritytext/session";
import { analyzeText } from "@/lib/veritytext/detector";
import {
  attachOwnerCookie,
  getOwnerId,
  historyConfigured,
  newOwnerId,
  saveHistory,
} from "@/lib/veritytext/history";

export const runtime = "nodejs";

// Next.js Route Handlers parse multipart bodies natively via `req.formData()`,
// but we enforce the 15 MB cap before reading by checking the Content-Length
// header (browsers always send it for multipart uploads).
export async function POST(req: NextRequest) {
  try {
    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (contentLength > MAX_FILE_SIZE + 1024 * 512) {
      // Allow a 512 KB margin for multipart encoding overhead.
      return NextResponse.json(
        {
          error: `Upload too large. Maximum file size is 15.00 MB (15,728,640 bytes).`,
        },
        { status: 413 },
      );
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "Could not read upload — request was not valid multipart form-data." },
        { status: 400 },
      );
    }

    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "No file provided. Please select a .docx, .pdf, or .txt file." },
        { status: 400 },
      );
    }

    // File.size is the raw byte length (no multipart overhead).
    const buffer = new Uint8Array(await file.arrayBuffer());
    const validation = validateFile(file.name, file.type, file.size, buffer);
    if (!validation.ok || !validation.meta) {
      return NextResponse.json(
        { error: validation.error ?? "Invalid file." },
        { status: 400 },
      );
    }

    // Extract text (this also handles scanned-PDF, encrypted, corrupt, and
    // non-UTF-8 edge cases with friendly errors).
    let extracted;
    try {
      extracted = await extractText(buffer, validation.meta);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not read file.";
      // Distinguish "not enough text" / "scanned pdf" (422) from hard parse
      // failures (422) and size issues (413).
      const status = /not enough text|scanned|fewer than/i.test(msg)
        ? 422
        : /too large|5\.00 MB/i.test(msg)
          ? 413
          : 422;
      return NextResponse.json({ error: msg }, { status });
    }

    const report = analyzeText(extracted.text, {
      extractedLength: extracted.text.length,
      filename: validation.meta.filename,
    });

    const session = createSession({
      filename: validation.meta.filename,
      fileType: validation.meta.ext,
      fileSize: validation.meta.size,
      originalText: extracted.text,
      extractedLength: extracted.text.length,
      report,
    });

    // Opt-in persistence. Nothing is written unless the client explicitly
    // asks for it; a database failure must never fail the analysis.
    const wantsHistory = formData.get("saveHistory") === "true";
    let ownerId = getOwnerId(req);
    let historySaved = false;
    let historyError: string | undefined;
    if (wantsHistory) {
      if (!historyConfigured()) {
        historyError =
          "History is not configured on this server. Set DATABASE_URL to a Postgres database to enable it.";
      } else {
        ownerId = ownerId ?? newOwnerId();
        try {
          await saveHistory(session, ownerId);
          updateSession(session.id, {
            historySaved: true,
            historyOwnerId: ownerId,
          });
          historySaved = true;
        } catch (err) {
          console.error("[veritytext] save history failed:", err);
          historyError =
            "The analysis succeeded, but it could not be saved to history.";
        }
      }
    }

    const response = NextResponse.json({
      sessionId: session.id,
      meta: {
        filename: session.filename,
        fileType: session.fileType,
        fileSize: session.fileSize,
        ext: validation.meta.ext,
        wordCount: extracted.meta.wordCount,
        partialAnalysis: extracted.meta.partialAnalysis,
        warnings: extracted.meta.warnings,
      },
      extractedLength: extracted.text.length,
      report,
      historySaved,
      historyError,
    });

    if (historySaved && ownerId) attachOwnerCookie(response, ownerId);
    return response;
  } catch (err) {
    console.error("[veritytext] upload route failed:", err);
    const msg = err instanceof Error ? err.message : "Upload failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
