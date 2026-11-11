// GET /api/veritytext/report/[sessionId]
// Returns the JSON detection report for the session. If detection hasn't run
// yet (defensive — currently upload runs it eagerly), run it now.
import { NextRequest, NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/veritytext/session";
import { analyzeText } from "@/lib/veritytext/detector";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
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
    let report = session.report;
    if (!report) {
      report = analyzeText(session.originalText, {
        extractedLength: session.extractedLength,
        filename: session.filename,
      });
      updateSession(sessionId, { report });
    }
    return NextResponse.json({
      sessionId,
      meta: {
        filename: session.filename,
        fileType: session.fileType,
        fileSize: session.fileSize,
        extractedLength: session.extractedLength,
      },
      report,
      humanized: session.humanizedText
        ? {
            text: session.humanizedText,
            report: session.humanizedReport,
            meta: session.humanizeMeta,
          }
        : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load report.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
