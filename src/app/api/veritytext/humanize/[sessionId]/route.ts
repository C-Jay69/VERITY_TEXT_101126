// POST /api/veritytext/humanize/[sessionId]
// Body: { strength: "light"|"balanced"|"strong", tone, preserve[] }
// Returns { humanizedText, originalScore, newScore, improved, warning?, error? }
import { NextRequest, NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/veritytext/session";
import { humanizeText, type HumanizeOptions } from "@/lib/veritytext/humanizer";
import { analyzeText } from "@/lib/veritytext/detector";

export const runtime = "nodejs";

const STRONG_MIN_IMPROVEMENT = 15; // points

export async function POST(
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
    if (!session.report) {
      return NextResponse.json(
        { error: "Detection report not available for this session." },
        { status: 409 },
      );
    }

    let body: Partial<HumanizeOptions & { reRun?: boolean }>;
    try {
      body = (await req.json()) as Partial<HumanizeOptions & { reRun?: boolean }>;
    } catch {
      body = {};
    }
    const strength = (body.strength ?? "balanced") as HumanizeOptions["strength"];
    const tone = (body.tone ?? "original") as HumanizeOptions["tone"];
    const preserve = Array.isArray(body.preserve) && body.preserve.length > 0
      ? body.preserve
      : ["citations", "names", "dates", "quotes"];
    const reRun = body.reRun === true;

    const originalScore = session.report.aggregate.aiProbability;

    // First pass (or re-run on the original).
    const baseText = reRun && session.humanizedText ? session.humanizedText : session.originalText;
    const baseReport = reRun && session.humanizedReport ? session.humanizedReport : session.report;

    const result = await humanizeText(baseText, baseReport, {
      strength,
      tone,
      preserve,
    });

    // Re-run detection on the humanized output.
    const humanizedReport = analyzeText(result.text, {
      extractedLength: result.text.length,
    });
    const newScore = humanizedReport.aggregate.aiProbability;
    const improved = originalScore - newScore;

    let warning: string | undefined = result.warning;
    if (result.error) {
      // Soft refusal or LLM failure — surface as error.
      return NextResponse.json({
        humanizedText: result.text,
        originalScore,
        newScore,
        improved,
        error: result.error,
      });
    }

    // If this is a "strong" pass and we didn't improve by ≥15 points, surface
    // a warning. The frontend can offer a "Run stronger pass" button (which
    // calls back with reRun=true and strength="strong").
    if (strength === "strong" && improved < STRONG_MIN_IMPROVEMENT && !reRun) {
      warning =
        `The first strong pass only reduced the detected AI-likelihood by ${improved} points (target ≥ ${STRONG_MIN_IMPROVEMENT}). You can run a stronger pass to push further, but note that further reduction is not guaranteed.`;
    }

    updateSession(sessionId, {
      humanizedText: result.text,
      humanizedReport,
      humanizeMeta: {
        strength,
        tone,
        preserve,
        warning,
        reHumanized: reRun,
      },
    });

    return NextResponse.json({
      humanizedText: result.text,
      originalScore,
      newScore,
      improved,
      warning,
      reHumanized: reRun,
      report: humanizedReport,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Humanizer failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
