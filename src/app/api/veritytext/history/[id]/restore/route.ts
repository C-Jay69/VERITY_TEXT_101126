// POST /api/veritytext/history/[id]/restore
// Loads a saved session back into the in-memory store so the report,
// humanizer, and downloads work exactly as they do for a fresh upload.
import { NextRequest, NextResponse } from "next/server";
import {
  getOwnerId,
  historyConfigured,
  restoreHistory,
} from "@/lib/veritytext/history";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!historyConfigured()) {
    return NextResponse.json(
      { error: "History is not configured on this server." },
      { status: 503 },
    );
  }
  const ownerId = getOwnerId(req);
  if (!ownerId) {
    return NextResponse.json({ error: "History entry not found." }, { status: 404 });
  }

  try {
    const { id } = await params;
    const session = await restoreHistory(id, ownerId);
    if (!session || !session.report) {
      return NextResponse.json(
        { error: "History entry not found." },
        { status: 404 },
      );
    }

    const report = session.report;
    return NextResponse.json({
      sessionId: session.id,
      meta: {
        filename: session.filename,
        fileType: session.fileType,
        fileSize: session.fileSize,
        extractedLength: session.extractedLength,
        wordCount: report.meta.wordCount,
        partialAnalysis: report.meta.partialAnalysis,
        warnings: report.meta.warnings,
      },
      report,
      humanized: session.humanizedText
        ? {
            text: session.humanizedText,
            report: session.humanizedReport ?? null,
            meta: session.humanizeMeta ?? null,
          }
        : null,
      historySaved: true,
    });
  } catch (err) {
    console.error("[veritytext] history restore failed:", err);
    return NextResponse.json(
      { error: "Could not restore the history entry." },
      { status: 503 },
    );
  }
}
