"use client";

import { useCallback, useMemo, useState } from "react";
import { useVerityStore } from "@/lib/veritytext/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { SignalCard } from "./signal-card";
import { HighlightedText } from "./highlighted-text";
import {
  Download,
  FileJson,
  FileText,
  Sparkles,
  ShieldAlert,
  AlertTriangle,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { BandKey } from "@/lib/veritytext/detector/types";

const BAND_STYLES: Record<BandKey, { bg: string; text: string; ring: string; label: string }> = {
  human: { bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-200", label: "Human" },
  "likely-human": { bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-200", label: "Likely Human" },
  mixed: { bg: "bg-amber-50", text: "text-amber-700", ring: "ring-amber-200", label: "Mixed / Uncertain" },
  "likely-ai": { bg: "bg-rose-50", text: "text-rose-700", ring: "ring-rose-200", label: "Likely AI" },
  "very-likely-ai": { bg: "bg-rose-50", text: "text-rose-700", ring: "ring-rose-200", label: "Very Likely AI" },
};

export function ReportView() {
  const report = useVerityStore((s) => s.report);
  const meta = useVerityStore((s) => s.meta);
  const sessionId = useVerityStore((s) => s.sessionId);
  const setView = useVerityStore((s) => s.setView);
  const reset = useVerityStore((s) => s.reset);
  const [downloading, setDownloading] = useState<string | null>(null);

  // We need the original text for the highlighted view — fetch it via the
  // session meta API. To avoid an extra round-trip, the upload endpoint
  // returns the report but not the text. We'll fetch the text lazily only
  // when the user opens the highlights section.
  const [fullText, setFullText] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);

  const loadText = useCallback(async () => {
    if (!sessionId || fullText) return;
    setTextLoading(true);
    setTextError(null);
    try {
      const res = await fetch(
        `/api/veritytext/download/${sessionId}?format=txt&variant=original`,
      );
      if (!res.ok) {
        setTextError("Could not load text for highlighting.");
        return;
      }
      const text = await res.text();
      setFullText(text);
    } catch {
      setTextError("Could not load text for highlighting.");
    } finally {
      setTextLoading(false);
    }
  }, [sessionId, fullText]);

  const download = useCallback(
    async (format: "pdf" | "json", variant: "original" | "humanized" = "original") => {
      if (!sessionId) return;
      setDownloading(`${format}-${variant}`);
      try {
        const url =
          format === "json"
            ? `/api/veritytext/download/${sessionId}?format=json`
            : `/api/veritytext/download/${sessionId}?format=pdf&variant=${variant}`;
        const res = await fetch(url);
        if (!res.ok) {
          let msg = `Download failed (HTTP ${res.status}).`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j.error) msg = j.error;
          } catch {
            // ignore
          }
          alert(msg);
          return;
        }
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objUrl;
        a.download =
          format === "json"
            ? `veritytext-report-${sessionId.slice(0, 8)}.json`
            : `veritytext-report-${sessionId.slice(0, 8)}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objUrl);
      } finally {
        setDownloading(null);
      }
    },
    [sessionId],
  );

  const verdict = useMemo(() => {
    if (!report) return null;
    return report.aggregate;
  }, [report]);

  if (!report || !meta || !sessionId) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertTitle>No report loaded</AlertTitle>
          <AlertDescription>
            Upload a document (or load a sample) on the Detect tab to see the analysis here.
          </AlertDescription>
        </Alert>
        <Button className="mt-4" onClick={() => setView("detect")}>
          Go to Detect
        </Button>
      </div>
    );
  }

  const band = verdict!.band;
  const style = BAND_STYLES[band];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Verdict header */}
      <Card className={cn("border-stone-200 ring-1", style.ring, style.bg)}>
        <CardHeader>
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-stone-500">
                Aggregate verdict
              </div>
              <div className={cn("mt-1 font-serif text-3xl font-semibold sm:text-4xl", style.text)}>
                {verdict!.verdict}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-stone-700">
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-semibold tabular-nums">{verdict!.aiProbability}%</span>
                  <span className="text-stone-500">AI probability</span>
                </span>
                <span aria-hidden="true" className="text-stone-300">•</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-semibold tabular-nums">{verdict!.confidence}%</span>
                  <span className="text-stone-500">confidence</span>
                </span>
                {verdict!.singleSignalTrigger && (
                  <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                    single-signal — downgraded
                  </Badge>
                )}
                {verdict!.lowConfidence && (
                  <Badge variant="outline" className="border-stone-300 bg-stone-100 text-stone-600">
                    short sample — low confidence
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => download("pdf")}
                disabled={downloading === "pdf-original"}
              >
                {downloading === "pdf-original" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileText className="size-4" />
                )}
                PDF report
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => download("json")}
                disabled={downloading === "json-original"}
              >
                {downloading === "json-original" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileJson className="size-4" />
                )}
                JSON report
              </Button>
              <Button size="sm" onClick={() => setView("humanize")}>
                <Sparkles className="size-4" />
                Proceed to Humanize
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Alert className="border-stone-300 bg-white/70">
            <ShieldAlert className="size-4 text-amber-600" />
            <AlertTitle className="text-stone-800">Disclaimer</AlertTitle>
            <AlertDescription className="text-stone-700">
              {report.disclaimer}
            </AlertDescription>
          </Alert>
          {report.meta.warnings.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {report.meta.warnings.map((w, i) => (
                <Alert key={i} variant="default" className="border-amber-200 bg-amber-50 py-2">
                  <AlertTriangle className="size-4 text-amber-600" />
                  <AlertDescription className="text-amber-800">{w}</AlertDescription>
                </Alert>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* File meta */}
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md border border-stone-200 bg-white px-4 py-3 text-xs text-stone-600">
        <span><strong className="text-stone-800">File:</strong> {meta.filename}</span>
        <span><strong className="text-stone-800">Type:</strong> {meta.fileType}</span>
        <span><strong className="text-stone-800">Size:</strong> {(meta.fileSize / 1024).toFixed(1)} KB</span>
        <span><strong className="text-stone-800">Words:</strong> {report.meta.wordCount}</span>
        <span><strong className="text-stone-800">Sentences:</strong> {report.meta.sentenceCount}</span>
        {report.meta.partialAnalysis && (
          <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
            partial analysis
          </Badge>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 gap-1 text-xs text-stone-500"
          onClick={() => {
            reset();
          }}
        >
          <RotateCcw className="size-3" /> New upload
        </Button>
      </div>

      {/* Signal cards */}
      <div className="mt-6">
        <h2 className="mb-3 font-serif text-lg font-semibold text-stone-900">Seven signals</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {report.signals.map((s) => (
            <SignalCard key={s.key} signal={s} band={band} />
          ))}
        </div>
      </div>

      {/* Highlighted text */}
      <div className="mt-8">
        <h2 className="mb-3 font-serif text-lg font-semibold text-stone-900">Highlighted text</h2>
        {!fullText && !textLoading && (
          <Button variant="outline" size="sm" onClick={loadText}>
            <Download className="size-4" />
            Load text to highlight
          </Button>
        )}
        {textLoading && (
          <div className="inline-flex items-center gap-2 text-sm text-stone-500">
            <Loader2 className="size-4 animate-spin" /> Loading text…
          </div>
        )}
        {textError && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertDescription>{textError}</AlertDescription>
          </Alert>
        )}
        {fullText && (
          <HighlightedText key={sessionId} text={fullText} signals={report.signals} />
        )}
      </div>

      {/* Bottom action bar */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-4">
        <div className="text-xs text-stone-500">
          Need to reduce the AI signal? Humanize the text — preserves facts, citations, names, and quotes.
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => download("pdf")}>
            <FileText className="size-4" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => download("json")}>
            <FileJson className="size-4" /> JSON
          </Button>
          <Button size="sm" onClick={() => setView("humanize")}>
            <Sparkles className="size-4" /> Humanize
          </Button>
        </div>
      </div>
    </div>
  );
}
