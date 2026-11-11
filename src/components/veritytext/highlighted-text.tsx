"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { SignalResult, SignalKey } from "@/lib/veritytext/detector/types";

// Highlight background classes per signal. Always paired with a left-border
// color AND a margin tag, so color is never the only signal.
const SIGNAL_STYLES: Record<
  SignalKey,
  { bg: string; border: string; tag: string; tagBg: string }
> = {
  perplexity: {
    bg: "bg-amber-100/70",
    border: "border-l-amber-400",
    tag: "P",
    tagBg: "bg-amber-500 text-white",
  },
  burstiness: {
    bg: "bg-rose-100/70",
    border: "border-l-rose-400",
    tag: "B",
    tagBg: "bg-rose-500 text-white",
  },
  repetitive: {
    bg: "bg-purple-100/70",
    border: "border-l-purple-400",
    tag: "R",
    tagBg: "bg-purple-500 text-white",
  },
  vocabulary: {
    bg: "bg-orange-100/70",
    border: "border-l-orange-400",
    tag: "V",
    tagBg: "bg-orange-500 text-white",
  },
  specificity: {
    bg: "bg-teal-100/70",
    border: "border-l-teal-400",
    tag: "S",
    tagBg: "bg-teal-500 text-white",
  },
  tone: {
    bg: "bg-pink-100/70",
    border: "border-l-pink-400",
    tag: "T",
    tagBg: "bg-pink-500 text-white",
  },
  fingerprints: {
    bg: "bg-stone-200/80",
    border: "border-l-stone-500",
    tag: "F",
    tagBg: "bg-stone-700 text-white",
  },
};

interface Segment {
  text: string;
  signals: SignalKey[];
}

export function HighlightedText({
  text,
  signals,
}: {
  text: string;
  signals: SignalResult[];
}) {
  // Default: every signal visible. The parent remounts this component on
  // session change (via key={sessionId}), so the initializer runs fresh each
  // time without needing an effect-based reset.
  const [enabled, setEnabled] = useState<Record<SignalKey, boolean>>({
    perplexity: true,
    burstiness: true,
    repetitive: true,
    vocabulary: true,
    specificity: true,
    tone: true,
    fingerprints: true,
  });

  const segments = useMemo(() => buildSegments(text, signals), [text, signals]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-stone-500">Highlight:</span>
        {signals.map((s) => {
          const style = SIGNAL_STYLES[s.key];
          const active = enabled[s.key];
          return (
            <Label
              key={s.key}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
                active
                  ? "border-stone-300 bg-white text-stone-800"
                  : "border-stone-200 bg-stone-50 text-stone-400",
              )}
            >
              <Checkbox
                checked={active}
                onCheckedChange={(c) =>
                  setEnabled((prev) => ({ ...prev, [s.key]: c === true }))
                }
                className="size-3.5"
              />
              <span
                aria-hidden="true"
                className={cn(
                  "inline-flex size-3.5 items-center justify-center rounded text-[9px] font-bold",
                  style.tagBg,
                )}
              >
                {style.tag}
              </span>
              <span>{s.name}</span>
            </Label>
          );
        })}
      </div>

      <ScrollArea className="max-h-[480px] flex-1 rounded-md border border-stone-200 bg-white">
        <article className="prose prose-sm max-w-none whitespace-pre-wrap p-4 font-serif text-[13px] leading-relaxed text-stone-800">
          {segments.map((seg, i) => {
            const activeSignals = seg.signals.filter((k) => enabled[k]);
            if (activeSignals.length === 0) {
              return <span key={i}>{seg.text}</span>;
            }
            // Use the first active signal's style for the highlight.
            const primary = activeSignals[0];
            const style = SIGNAL_STYLES[primary];
            return (
              <mark
                key={i}
                className={cn(
                  "rounded-sm border-l-2 px-0.5 py-px",
                  style.bg,
                  style.border,
                )}
                title={activeSignals
                  .map((k) => signals.find((s) => s.key === k)?.name ?? k)
                  .join(", ")}
              >
                {seg.text}
                <span
                  aria-hidden="true"
                  className={cn(
                    "ml-0.5 inline-flex size-3.5 items-center justify-center rounded text-[8px] font-bold align-middle",
                    style.tagBg,
                  )}
                >
                  {style.tag}
                </span>
              </mark>
            );
          })}
        </article>
      </ScrollArea>
      <p className="text-[11px] text-stone-500">
        Color is never the only signal — each highlight also carries a letter tag and a tooltip with
        the signal name. Toggle individual signals above.
      </p>
    </div>
  );
}

function buildSegments(text: string, signals: SignalResult[]): Segment[] {
  // Collect all spans across signals, with their signal keys.
  type S = { start: number; end: number; signals: SignalKey[] };
  const byStart = new Map<number, S>();
  for (const sig of signals) {
    if (!sig.spans) continue;
    for (const span of sig.spans) {
      if (span.end <= span.start || span.end > text.length) continue;
      const existing = byStart.get(span.start);
      if (existing && existing.end === span.end) {
        if (!existing.signals.includes(span.signal)) existing.signals.push(span.signal);
      } else if (existing && existing.end !== span.end) {
        // Overlapping spans with different endpoints — split. For simplicity
        // we keep the existing span and skip the new one if they collide at
        // the same start. (Our signals rarely produce overlapping spans.)
        // To be safe, prefer the longer span.
        if (span.end - span.start > existing.end - existing.start) {
          byStart.set(span.start, {
            start: span.start,
            end: span.end,
            signals: Array.from(new Set([...existing.signals, span.signal])),
          });
        } else if (!existing.signals.includes(span.signal)) {
          existing.signals.push(span.signal);
        }
      } else {
        byStart.set(span.start, {
          start: span.start,
          end: span.end,
          signals: [span.signal],
        });
      }
    }
  }
  const spans = Array.from(byStart.values()).sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const sp of spans) {
    if (sp.start > cursor) {
      segments.push({ text: text.slice(cursor, sp.start), signals: [] });
    }
    segments.push({ text: text.slice(sp.start, sp.end), signals: sp.signals });
    cursor = sp.end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), signals: [] });
  }
  return segments.length > 0 ? segments : [{ text, signals: [] }];
}
