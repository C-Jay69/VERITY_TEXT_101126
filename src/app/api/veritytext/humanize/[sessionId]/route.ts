// POST /api/veritytext/humanize/[sessionId]
// Body: { strength, tone, preserve[], reRun?, stream? }
//
// Non-streaming (default) returns JSON:
//   { humanizedText, originalScore, newScore, improved, warning?, error?, report }
// Streaming (`stream: true`) returns text/event-stream:
//   data: {"type":"delta","text":"…"}         (repeated)
//   data: {"type":"done","text","originalScore","newScore","improved",
//          "warning?","error?","report"}
//
// In both modes the rewritten text is immediately re-scored with the same
// detector so the client can show the before/after improvement.
import { NextRequest, NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/veritytext/session";
import {
  humanizeText,
  humanizeTextStream,
  type HumanizeOptions,
} from "@/lib/veritytext/humanizer";
import { analyzeText } from "@/lib/veritytext/detector";
import { syncHistory } from "@/lib/veritytext/history";

export const runtime = "nodejs";

const STRONG_MIN_IMPROVEMENT = 15; // points

interface HumanizeBody extends Partial<HumanizeOptions> {
  reRun?: boolean;
  stream?: boolean;
}

function parseBody(raw: HumanizeBody): Required<
  Pick<HumanizeOptions, "strength" | "tone" | "preserve">
> & { reRun: boolean; stream: boolean } {
  const strength = (raw.strength ?? "balanced") as HumanizeOptions["strength"];
  const tone = (raw.tone ?? "original") as HumanizeOptions["tone"];
  const preserve =
    Array.isArray(raw.preserve) && raw.preserve.length > 0
      ? raw.preserve
      : ["citations", "names", "dates", "quotes"];
  return {
    strength: ["light", "balanced", "strong"].includes(strength)
      ? strength
      : "balanced",
    tone: ["original", "casual", "academic", "professional"].includes(tone)
      ? tone
      : "original",
    preserve,
    reRun: raw.reRun === true,
    stream: raw.stream === true,
  };
}

/**
 * Build the user-facing warning. Per spec:
 *  - always warn when the re-score is not lower than the original;
 *  - on a first "strong" pass, warn when the drop is below 15 points.
 */
function buildWarning(
  originalScore: number,
  newScore: number,
  strength: HumanizeOptions["strength"],
  reRun: boolean,
): string | undefined {
  if (newScore >= originalScore) {
    return `The rewritten text re-scored at ${newScore}% AI-likelihood — not lower than the original ${originalScore}%. Try a stronger pass or review the controls.`;
  }
  if (
    strength === "strong" &&
    originalScore - newScore < STRONG_MIN_IMPROVEMENT &&
    !reRun
  ) {
    return `The first strong pass only reduced the detected AI-likelihood by ${originalScore - newScore} points (target ≥ ${STRONG_MIN_IMPROVEMENT}). You can run a stronger pass to push further, but note that further reduction is not guaranteed.`;
  }
  return undefined;
}

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

    let rawBody: HumanizeBody;
    try {
      rawBody = (await req.json()) as HumanizeBody;
    } catch {
      rawBody = {};
    }
    const opts = parseBody(rawBody);

    const originalScore = session.report.aggregate.aiProbability;
    const baseText =
      opts.reRun && session.humanizedText
        ? session.humanizedText
        : session.originalText;
    const baseReport =
      opts.reRun && session.humanizedReport
        ? session.humanizedReport
        : session.report;

    if (opts.stream) {
      return streamResponse({
        req,
        sessionId,
        baseText,
        baseReport,
        opts,
        originalScore,
      });
    }

    const result = await humanizeText(baseText, baseReport, opts);
    const humanizedReport = analyzeText(result.text, {
      extractedLength: result.text.length,
    });
    const newScore = humanizedReport.aggregate.aiProbability;
    const improved = originalScore - newScore;

    if (result.error) {
      // Soft refusal or LLM failure — surface as error, never blank.
      return NextResponse.json({
        humanizedText: result.text,
        originalScore,
        newScore,
        improved,
        error: result.error,
      });
    }

    const warning = buildWarning(originalScore, newScore, opts.strength, opts.reRun);

    const updated = updateSession(sessionId, {
      humanizedText: result.text,
      humanizedReport,
      humanizeMeta: {
        strength: opts.strength,
        tone: opts.tone,
        preserve: opts.preserve,
        warning,
        reHumanized: opts.reRun,
      },
    });
    if (updated) await syncHistory(updated);

    return NextResponse.json({
      humanizedText: result.text,
      originalScore,
      newScore,
      improved,
      warning,
      reHumanized: opts.reRun,
      report: humanizedReport,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Humanizer failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

interface StreamArgs {
  req: NextRequest;
  sessionId: string;
  baseText: string;
  baseReport: import("@/lib/veritytext/detector/types").DetectionReport;
  opts: Required<
    Pick<HumanizeOptions, "strength" | "tone" | "preserve">
  > & { reRun: boolean; stream: boolean };
  originalScore: number;
}

function streamResponse({
  req,
  sessionId,
  baseText,
  baseReport,
  opts,
  originalScore,
}: StreamArgs): NextResponse {
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      };

      try {
        for await (const event of humanizeTextStream(
          baseText,
          baseReport,
          opts,
          req.signal,
        )) {
          if (event.type === "delta") {
            send({ type: "delta", text: event.text });
            continue;
          }

          // Final event: re-score and persist the session.
          const humanizedReport = analyzeText(event.text, {
            extractedLength: event.text.length,
          });
          const newScore = humanizedReport.aggregate.aiProbability;
          const improved = originalScore - newScore;
          const warning = event.error
            ? undefined
            : buildWarning(originalScore, newScore, opts.strength, opts.reRun);

          if (!event.error) {
            const updated = updateSession(sessionId, {
              humanizedText: event.text,
              humanizedReport,
              humanizeMeta: {
                strength: opts.strength,
                tone: opts.tone,
                preserve: opts.preserve,
                warning,
                reHumanized: opts.reRun,
              },
            });
            if (updated) await syncHistory(updated);
          }

          send({
            type: "done",
            text: event.text,
            originalScore,
            newScore,
            improved,
            warning,
            error: event.error,
            report: humanizedReport,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Humanizer failed.";
        send({ type: "error", error: msg });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // Client already disconnected.
        }
      }
    },
    cancel() {
      // The client aborted; `req.signal` will surface as an AbortError in the
      // generator, which yields a graceful "cancelled" done event.
    },
  });

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
