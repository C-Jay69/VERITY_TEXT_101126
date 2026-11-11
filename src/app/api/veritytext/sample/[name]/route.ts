// GET /api/veritytext/sample/[name]?name=ai_sample|human_sample|hybrid_sample
// Loads one of the bundled sample texts, creates a session, and runs detection.
// Useful for quick demos without requiring the user to upload a file.
import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/veritytext/session";
import { analyzeText } from "@/lib/veritytext/detector";
import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const SAMPLES = new Set(["ai_sample", "human_sample", "hybrid_sample"]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await params;
    if (!SAMPLES.has(name)) {
      return NextResponse.json(
        { error: `Unknown sample "${name}". Available: ai_sample, human_sample, hybrid_sample.` },
        { status: 404 },
      );
    }
    const samplesDir = path.join(process.cwd(), "samples");
    const filePath = path.join(samplesDir, `${name}.txt`);
    let text: string;
    try {
      text = await fs.readFile(filePath, "utf8");
    } catch {
      return NextResponse.json(
        { error: "Sample file could not be read on the server." },
        { status: 500 },
      );
    }
    const report = analyzeText(text, { extractedLength: text.length });
    const session = createSession({
      filename: `${name}.txt`,
      fileType: ".txt",
      fileSize: Buffer.byteLength(text, "utf8"),
      originalText: text,
      extractedLength: text.length,
      report,
    });
    return NextResponse.json({
      sessionId: session.id,
      meta: {
        filename: session.filename,
        fileType: session.fileType,
        fileSize: session.fileSize,
        wordCount: report.meta.wordCount,
        partialAnalysis: false,
        warnings: report.meta.warnings,
      },
      report,
      extractedLength: text.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load sample.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
