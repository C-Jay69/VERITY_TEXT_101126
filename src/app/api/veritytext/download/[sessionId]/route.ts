// GET /api/veritytext/download/[sessionId]?format=pdf|json|docx|txt&variant=original|humanized
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/veritytext/session";
import {
  buildJsonReport,
  buildPdfReport,
  buildDocxFromText,
  buildPdfFromText,
  buildTxtFromText,
} from "@/lib/veritytext/report";

export const runtime = "nodejs";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  json: "application/json",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain; charset=utf-8",
};

function extOf(format: string, fileType: string): string {
  if (format === "json") return "json";
  if (format === "pdf") return "pdf";
  if (format === "txt") return "txt";
  if (format === "docx") return "docx";
  // "original" → match upload type
  if (fileType === ".docx") return "docx";
  if (fileType === ".pdf") return "pdf";
  return "txt";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: "Session not found or expired. Please upload the file again." },
        { status: 404 },
      );
    }

    const url = new URL(req.url);
    const formatParam = (url.searchParams.get("format") ?? "original").toLowerCase();
    const variant = (url.searchParams.get("variant") ?? "original").toLowerCase();

    const useHumanized = variant === "humanized";
    const text = useHumanized ? session.humanizedText : session.originalText;

    if (useHumanized && !session.humanizedText) {
      return NextResponse.json(
        { error: "No humanized text available for this session yet." },
        { status: 409 },
      );
    }

    // Resolve the actual format. "original" means "match the upload extension".
    let format = formatParam;
    if (format === "original") {
      format = session.fileType.replace(/^\./, "");
    }
    if (!["pdf", "json", "docx", "txt"].includes(format)) {
      return NextResponse.json(
        { error: `Unsupported format "${format}".` },
        { status: 400 },
      );
    }

    // For JSON, only original-report variant makes sense.
    if (format === "json") {
      if (!session.report) {
        return NextResponse.json(
          { error: "Report not available." },
          { status: 409 },
        );
      }
      const json = buildJsonReport(session);
      const buf = Buffer.from(JSON.stringify(json, null, 2), "utf8");
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="veritytext-report-${sessionId.slice(0, 8)}.json"`,
        },
      });
    }

    if (format === "pdf") {
      if (variant === "humanized") {
        if (!text) {
          return NextResponse.json({ error: "No text available." }, { status: 409 });
        }
        const buf = await buildPdfFromText(text, "VerityText — humanized text");
        return new NextResponse(new Uint8Array(buf), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="veritytext-humanized-${sessionId.slice(0, 8)}.pdf"`,
          },
        });
      }
      // Report PDF.
      if (!session.report) {
        return NextResponse.json({ error: "Report not available." }, { status: 409 });
      }
      const buf = await buildPdfReport(session);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="veritytext-report-${sessionId.slice(0, 8)}.pdf"`,
        },
      });
    }

    if (format === "docx") {
      if (!text) {
        return NextResponse.json({ error: "No text available." }, { status: 409 });
      }
      const buf = await buildDocxFromText(text);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": MIME.docx,
          "Content-Disposition": `attachment; filename="veritytext-${variant}-${sessionId.slice(0, 8)}.docx"`,
        },
      });
    }

    // txt
    if (!text) {
      return NextResponse.json({ error: "No text available." }, { status: 409 });
    }
    const buf = buildTxtFromText(text);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="veritytext-${variant}-${sessionId.slice(0, 8)}.txt"`,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Download failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Re-export to satisfy linter for unused extOf helper if tree-shaken.
void extOf;
