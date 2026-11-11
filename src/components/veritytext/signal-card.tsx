"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import type { SignalResult, BandKey } from "@/lib/veritytext/detector/types";

const SIGNAL_COLORS: Record<string, string> = {
  perplexity: "bg-amber-100 text-amber-900 border-amber-300",
  burstiness: "bg-rose-100 text-rose-900 border-rose-300",
  repetitive: "bg-purple-100 text-purple-900 border-purple-300",
  vocabulary: "bg-orange-100 text-orange-900 border-orange-300",
  specificity: "bg-teal-100 text-teal-900 border-teal-300",
  tone: "bg-pink-100 text-pink-900 border-pink-300",
  fingerprints: "bg-stone-200 text-stone-800 border-stone-400",
};

function scoreColor(score: number): { text: string; bg: string; ring: string } {
  if (score < 0.35)
    return { text: "text-emerald-700", bg: "bg-emerald-50", ring: "ring-emerald-200" };
  if (score < 0.55)
    return { text: "text-amber-700", bg: "bg-amber-50", ring: "ring-amber-200" };
  return { text: "text-rose-700", bg: "bg-rose-50", ring: "ring-rose-200" };
}

function scoreLabel(score: number): string {
  if (score < 0.35) return "low";
  if (score < 0.55) return "moderate";
  return "high";
}

export function SignalCard({
  signal,
  band,
}: {
  signal: SignalResult;
  band?: BandKey;
}) {
  const [open, setOpen] = useState(false);
  const score100 = Math.round(signal.score * 100);
  const colors = scoreColor(signal.score);
  const accent = SIGNAL_COLORS[signal.key] ?? "bg-stone-100 text-stone-800 border-stone-300";

  return (
    <Card className="border-stone-200 py-4">
      <CardHeader className="px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className={cn("mt-0.5 inline-flex size-2.5 shrink-0 rounded-full border", accent)}
            />
            <div>
              <CardTitle className="flex flex-wrap items-center gap-2 text-sm text-stone-900">
                <span>{signal.name}</span>
                {signal.weak && (
                  <Badge variant="outline" className="border-stone-300 bg-stone-100 text-[10px] font-normal text-stone-600">
                    weak / probabilistic
                  </Badge>
                )}
              </CardTitle>
              <p className="mt-1 text-xs text-stone-600">{signal.explanation}</p>
            </div>
          </div>
          <div
            className={cn(
              "flex shrink-0 flex-col items-end rounded-md px-2 py-1 ring-1",
              colors.bg,
              colors.ring,
            )}
          >
            <span className={cn("text-xl font-semibold tabular-nums", colors.text)}>{score100}</span>
            <span className={cn("text-[10px] uppercase tracking-wide", colors.text)}>
              {scoreLabel(signal.score)}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4">
        <div className="mb-3 flex items-center gap-3 text-[11px] text-stone-500">
          <span>weight {signal.weight.toFixed(2)}</span>
          <span aria-hidden="true">•</span>
          <span>contributes {((signal.score * signal.weight) * 100).toFixed(1)}% to aggregate</span>
        </div>

        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-stone-700">
              {open ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              {open ? "Hide evidence" : "View evidence"}
              <Badge variant="secondary" className="ml-1 bg-stone-100 text-[10px] text-stone-600">
                {signal.evidence.length}
              </Badge>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <ul className="space-y-1.5 text-xs text-stone-700">
              {signal.evidence.length === 0 && (
                <li className="text-stone-500">No evidence snippets.</li>
              )}
              {signal.evidence.map((e, i) => (
                <li
                  key={i}
                  className="rounded border border-stone-200 bg-stone-50 px-2 py-1.5 font-mono text-[11px] leading-snug"
                >
                  {e}
                </li>
              ))}
            </ul>
            {signal.metrics && Object.keys(signal.metrics).length > 0 && (
              <div className="mt-3">
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-stone-500">
                  Metrics
                </div>
                <div className="grid grid-cols-2 gap-1 text-[11px] text-stone-600 sm:grid-cols-3">
                  {Object.entries(signal.metrics).map(([k, v]) => (
                    <div key={k} className="flex flex-col">
                      <span className="text-stone-400">{k}</span>
                      <span className="font-mono text-stone-800">
                        {typeof v === "number" ? v : String(v)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {signal.weak && (
              <div className="mt-3 flex items-start gap-1.5 rounded border border-stone-200 bg-stone-50 p-2 text-[11px] text-stone-600">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                <span>
                  This signal is heuristic and probabilistic. It is never sufficient on its own
                  {band ? " and is weighted low in the aggregate" : ""}.
                </span>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
