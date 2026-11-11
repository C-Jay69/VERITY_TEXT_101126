"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useVerityStore } from "@/lib/veritytext/store";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sparkles,
  Loader2,
  Download,
  AlertTriangle,
  Wand2,
  CheckCircle2,
  ShieldAlert,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DetectionReport } from "@/lib/veritytext/detector/types";

interface HumanizeResponse {
  humanizedText: string;
  originalScore: number;
  newScore: number;
  improved: number;
  warning?: string;
  error?: string;
  reHumanized?: boolean;
  report: DetectionReport;
}

const TONES = [
  { value: "original", label: "Keep original tone" },
  { value: "casual", label: "Casual" },
  { value: "academic", label: "Academic" },
  { value: "professional", label: "Professional" },
];

const PRESERVE_OPTIONS = [
  { value: "citations", label: "Citations" },
  { value: "names", label: "Names (proper nouns)" },
  { value: "dates", label: "Dates & numbers" },
  { value: "quotes", label: "Direct quotes" },
];

export function HumanizeView() {
  const report = useVerityStore((s) => s.report);
  const sessionId = useVerityStore((s) => s.sessionId);
  const meta = useVerityStore((s) => s.meta);
  const humanizedText = useVerityStore((s) => s.humanizedText);
  const humanizedReport = useVerityStore((s) => s.humanizedReport);
  const originalScore = useVerityStore((s) => s.originalScore);
  const newScore = useVerityStore((s) => s.newScore);
  const humanizeLoading = useVerityStore((s) => s.humanizeLoading);
  const humanizeError = useVerityStore((s) => s.humanizeError);
  const humanizeWarning = useVerityStore((s) => s.humanizeWarning);
  const setHumanize = useVerityStore((s) => s.setHumanize);
  const setHumanizeLoading = useVerityStore((s) => s.setHumanizeLoading);
  const setHumanizeError = useVerityStore((s) => s.setHumanizeError);
  const setView = useVerityStore((s) => s.setView);

  const [strength, setStrength] = useState<"light" | "balanced" | "strong">("strong");
  const [tone, setTone] = useState<string>("original");
  const [preserve, setPreserve] = useState<string[]>(["citations", "names", "dates", "quotes"]);
  const [originalText, setOriginalText] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [cancelController, setCancelController] = useState<AbortController | null>(null);

  const runHumanize = useCallback(
    async (opts?: { reRun?: boolean; strength?: "light" | "balanced" | "strong" }) => {
      if (!sessionId || !report) return;
      setHumanizeLoading(true);
      setHumanizeError(null);
      setStreamingText("");
      const controller = new AbortController();
      setCancelController(controller);
      try {
        const res = await fetch(`/api/veritytext/humanize/${sessionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            strength: opts?.strength ?? strength,
            tone,
            preserve,
            reRun: opts?.reRun ?? false,
            stream: true,
          }),
        });

        if (!res.ok) {
          let msg = `Humanize failed (HTTP ${res.status}).`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j.error) msg = j.error;
          } catch {
            // ignore
          }
          setHumanizeError(msg);
          setStreamingText(null);
          return;
        }

        const contentType = res.headers.get("content-type") ?? "";

        // Fallback: a non-SSE JSON response (e.g. an older server or a proxy
        // that buffered the stream) — parse it directly.
        if (!contentType.includes("text/event-stream") || !res.body) {
          const data = (await res.json()) as HumanizeResponse;
          setHumanize({
            text: data.humanizedText,
            report: data.report,
            originalScore: data.originalScore,
            newScore: data.newScore,
            warning: data.warning ?? null,
            error: data.error ?? null,
          });
          setStreamingText(null);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let accumulated = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary: number;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const dataLine = frame
              .split("\n")
              .find((line) => line.startsWith("data:"));
            if (!dataLine) continue;
            let payload: {
              type?: string;
              text?: string;
              error?: string;
              warning?: string;
              originalScore?: number;
              newScore?: number;
              report?: DetectionReport;
            };
            try {
              payload = JSON.parse(dataLine.slice(5).trim());
            } catch {
              continue;
            }
            if (payload.type === "delta" && payload.text) {
              accumulated += payload.text;
              setStreamingText(accumulated);
            } else if (payload.type === "done") {
              setHumanize({
                text: payload.text ?? accumulated,
                report: payload.report as DetectionReport,
                originalScore: payload.originalScore ?? 0,
                newScore: payload.newScore ?? 0,
                warning: payload.warning ?? null,
                error: payload.error ?? null,
              });
              setStreamingText(null);
            } else if (payload.type === "error") {
              setHumanizeError(payload.error ?? "Humanizer failed.");
              setStreamingText(null);
            }
          }
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setHumanizeError("Humanizing cancelled.");
        } else {
          setHumanizeError(e instanceof Error ? e.message : "Humanize failed.");
        }
        setStreamingText(null);
      } finally {
        setHumanizeLoading(false);
        setCancelController(null);
      }
    },
    [sessionId, report, strength, tone, preserve, setHumanize, setHumanizeError, setHumanizeLoading],
  );

  const cancelHumanize = useCallback(() => {
    if (cancelController) cancelController.abort();
  }, [cancelController]);

  // Lazy-load original text for the side-by-side comparison.
  const loadOriginal = useCallback(async () => {
    if (!sessionId || originalText) return;
    try {
      const res = await fetch(`/api/veritytext/download/${sessionId}?format=txt&variant=original`);
      if (res.ok) setOriginalText(await res.text());
    } catch {
      // ignore
    }
  }, [sessionId, originalText]);

  // Auto-load original text once when entering the view.
  useEffect(() => {
    void loadOriginal();
  }, [loadOriginal]);

  const download = useCallback(
    async (format: "pdf" | "docx" | "txt") => {
      if (!sessionId) return;
      setDownloading(true);
      try {
        const res = await fetch(
          `/api/veritytext/download/${sessionId}?format=${format}&variant=humanized`,
        );
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
        a.download = `veritytext-humanized-${sessionId.slice(0, 8)}.${format}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objUrl);
      } finally {
        setDownloading(false);
      }
    },
    [sessionId],
  );

  // Compute chart data with safe fallbacks when session is missing.
  const chartData = useMemo(() => {
    const rows: { name: string; score: number; kind: string }[] = [];
    if (originalScore !== null) rows.push({ name: "Original", score: originalScore, kind: "original" });
    if (newScore !== null) rows.push({ name: "Humanized", score: newScore, kind: "humanized" });
    return rows;
  }, [originalScore, newScore]);

  const originalReportSignals = report?.signals ?? [];
  const humanizedSignals = humanizedReport?.signals ?? [];
  const signalChart = originalReportSignals.map((s, i) => ({
    name: s.name.split(" ")[0],
    original: Math.round((originalReportSignals[i]?.score ?? 0) * 100),
    humanized: Math.round((humanizedSignals[i]?.score ?? 0) * 100),
  }));

  if (!report || !meta || !sessionId) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertTitle>No text to humanize</AlertTitle>
          <AlertDescription>
            Upload a document (or load a sample) on the Detect tab first.
          </AlertDescription>
        </Alert>
        <Button className="mt-4" onClick={() => setView("detect")}>
          Go to Detect
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-4">
        <h1 className="font-serif text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
          Humanize text
        </h1>
        <p className="mt-1 text-sm text-stone-600">
          Rewrite the text to reduce detected AI signals while preserving all facts, citations,
          names, dates, numbers, and quotes. The output is re-scored automatically so you can see the
          improvement.
        </p>
        {meta && meta.extractedLength > 50_000 && (
          <Alert className="mt-4 border-amber-200 bg-amber-50">
            <AlertTriangle className="size-4 text-amber-600" />
            <AlertTitle className="text-amber-900">Long document</AlertTitle>
            <AlertDescription className="text-amber-800">
              Detection and reports cover the whole document. The humanizer
              rewrites up to 50,000 characters per pass to stay within the
              language model&apos;s limits, so only that portion will be
              rewritten.
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Controls */}
        <Card className="border-stone-200 lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-stone-900">
              <Wand2 className="size-4" /> Controls
            </CardTitle>
            <CardDescription>Tune the rewrite. All settings preserve factual content.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <Label className="mb-2 text-stone-700">Strength</Label>
              <RadioGroup
                value={strength}
                onValueChange={(v) => setStrength(v as "light" | "balanced" | "strong")}
                className="grid grid-cols-3 gap-2"
              >
                {(["light", "balanced", "strong"] as const).map((s) => (
                  <Label
                    key={s}
                    className={cn(
                      "flex cursor-pointer flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs capitalize",
                      strength === s
                        ? "border-stone-900 bg-stone-900 text-white"
                        : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50",
                    )}
                  >
                    <RadioGroupItem value={s} className="sr-only" />
                    <span className="font-medium">{s}</span>
                    {s === "strong" && <span className="text-[10px] opacity-80">target ≥15pt drop</span>}
                  </Label>
                ))}
              </RadioGroup>
            </div>

            <div>
              <Label className="mb-2 text-stone-700">Tone</Label>
              <Select value={tone} onValueChange={setTone}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TONES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="mb-2 text-stone-700">Preserve (always preserved by default)</Label>
              <div className="grid grid-cols-2 gap-2">
                {PRESERVE_OPTIONS.map((p) => {
                  const checked = preserve.includes(p.value);
                  return (
                    <Label
                      key={p.value}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs",
                        checked
                          ? "border-stone-300 bg-white text-stone-800"
                          : "border-stone-200 bg-stone-50 text-stone-500",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(c) => {
                          setPreserve((prev) =>
                            c === true ? [...prev, p.value] : prev.filter((x) => x !== p.value),
                          );
                        }}
                      />
                      <span>{p.label}</span>
                    </Label>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] text-stone-500">
                Unchecking an item only relaxes the editor&rsquo;s instruction — facts are still preserved by the base prompt.
              </p>
            </div>

            <Button
              className="w-full"
              onClick={() => runHumanize()}
              disabled={humanizeLoading}
            >
              {humanizeLoading ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Humanizing…
                </>
              ) : (
                <>
                  <Sparkles className="size-4" /> Humanize
                </>
              )}
            </Button>

            {humanizeLoading && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={cancelHumanize}
              >
                <X className="size-4" /> Cancel
              </Button>
            )}

            {humanizeError && (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" />
                <AlertTitle>Humanizer error</AlertTitle>
                <AlertDescription>{humanizeError}</AlertDescription>
              </Alert>
            )}

            {humanizeWarning && !humanizeError && (
              <Alert className="border-amber-300 bg-amber-50">
                <AlertTriangle className="size-4 text-amber-600" />
                <AlertTitle className="text-amber-800">Stronger pass recommended</AlertTitle>
                <AlertDescription className="text-amber-800">
                  {humanizeWarning}
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-amber-400 bg-white text-amber-800 hover:bg-amber-100"
                      onClick={() => runHumanize({ reRun: true, strength: "strong" })}
                      disabled={humanizeLoading}
                    >
                      Run stronger pass
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            <Alert className="border-stone-300 bg-stone-50 py-3">
              <ShieldAlert className="size-4 text-amber-600" />
              <AlertDescription className="text-[11px] text-stone-700">
                The humanizer reduces detected signals — it does not &ldquo;pass all detectors&rdquo;.
                Use it to improve the naturalness of your own writing, not to deceive evaluators.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        {/* Side-by-side */}
        <Card className="border-stone-200 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-stone-900">Original vs. humanized</CardTitle>
            <CardDescription>
              Diff highlights: <span className="text-emerald-700">added</span> /{" "}
              <span className="text-rose-700 line-through">removed</span>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-stone-500">
                    Original
                  </span>
                  {originalScore !== null && (
                    <Badge variant="outline" className="border-stone-300 text-stone-700">
                      {originalScore}% AI
                    </Badge>
                  )}
                </div>
                <ScrollArea className="h-[420px] rounded-md border border-stone-200 bg-white">
                  <pre className="whitespace-pre-wrap p-3 font-serif text-[12px] leading-relaxed text-stone-800">
                    {originalText ?? "Loading…"}
                  </pre>
                </ScrollArea>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-stone-500">
                    Humanized
                  </span>
                  {newScore !== null && (
                    <Badge
                      variant="outline"
                      className={cn(
                        newScore < (originalScore ?? 100)
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-rose-300 bg-rose-50 text-rose-700",
                      )}
                    >
                      {newScore}% AI
                    </Badge>
                  )}
                </div>
                <ScrollArea className="h-[420px] rounded-md border border-stone-200 bg-white">
                  {humanizedText ? (
                    <div className="p-3 font-serif text-[12px] leading-relaxed">
                      <DiffView a={originalText ?? ""} b={humanizedText} />
                    </div>
                  ) : streamingText ? (
                    <div className="p-3 font-serif text-[12px] leading-relaxed whitespace-pre-wrap">
                      {streamingText}
                      <span className="ml-0.5 inline-block animate-pulse text-stone-400">▍</span>
                    </div>
                  ) : (
                    <div className="p-3 text-[12px] text-stone-500">
                      Run the humanizer to see the rewritten text here.
                    </div>
                  )}
                </ScrollArea>
              </div>
            </div>

            {/* Score comparison */}
            {humanizedText && newScore !== null && originalScore !== null && (
              <div className="mt-5 space-y-4">
                <div className="flex flex-wrap items-center gap-3 rounded-md border border-stone-200 bg-stone-50 px-4 py-3">
                  <CheckCircle2
                    className={cn(
                      "size-5",
                      newScore < originalScore ? "text-emerald-600" : "text-rose-600",
                    )}
                  />
                  <div className="text-sm text-stone-800">
                    AI-likelihood reduced from{" "}
                    <strong className="tabular-nums">{originalScore}%</strong> to{" "}
                    <strong className="tabular-nums">{newScore}%</strong> — a{" "}
                    <strong
                      className={cn(
                        "tabular-nums",
                        newScore < originalScore ? "text-emerald-700" : "text-rose-700",
                      )}
                    >
                      {originalScore - newScore >= 0 ? "-" : "+"}{Math.abs(originalScore - newScore)} point
                    </strong>{" "}
                    change.
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-md border border-stone-200 bg-white p-3">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-500">
                      Before / after aggregate
                    </div>
                    <div className="h-[180px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#78716c" />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#78716c" />
                          <Tooltip
                            contentStyle={{
                              fontSize: 12,
                              borderRadius: 6,
                              border: "1px solid #e7e5e4",
                            }}
                            formatter={(v: number) => [`${v}%`, "AI probability"]}
                          />
                          <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                            {chartData.map((d, i) => (
                              <Cell
                                key={i}
                                fill={d.kind === "humanized" ? "#059669" : "#b91c1c"}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="rounded-md border border-stone-200 bg-white p-3">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-500">
                      Per-signal before / after
                    </div>
                    <div className="h-[180px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={signalChart} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                          <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="#78716c" />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#78716c" />
                          <Tooltip
                            contentStyle={{
                              fontSize: 12,
                              borderRadius: 6,
                              border: "1px solid #e7e5e4",
                            }}
                          />
                          <Bar dataKey="original" fill="#b91c1c" radius={[3, 3, 0, 0]} />
                          <Bar dataKey="humanized" fill="#059669" radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3">
                  <span className="text-xs text-stone-500">Download humanized text:</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => download("txt")}
                    disabled={downloading}
                  >
                    <Download className="size-3.5" /> .txt
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => download("docx")}
                    disabled={downloading}
                  >
                    <Download className="size-3.5" /> .docx
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => download("pdf")}
                    disabled={downloading}
                  >
                    <Download className="size-3.5" /> .pdf
                  </Button>
                  <span className="ml-auto text-[11px] text-stone-500">
                    Output matches the upload format: {meta.fileType.replace(/^\./, "") || "txt"}.
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// --- simple word-level diff ---

interface DiffPiece {
  type: "same" | "add" | "del";
  text: string;
}

function tokenizeForDiff(s: string): string[] {
  // Split into words + whitespace runs so we can reconstruct faithfully.
  return s.match(/\s+|\S+/g) ?? [];
}

function diffWords(a: string, b: string): DiffPiece[] {
  const A = tokenizeForDiff(a);
  const B = tokenizeForDiff(b);
  const m = A.length;
  const n = B.length;
  // LCS DP.
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pieces: DiffPiece[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) {
      pieces.push({ type: "same", text: A[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pieces.push({ type: "del", text: A[i] });
      i++;
    } else {
      pieces.push({ type: "add", text: B[j] });
      j++;
    }
  }
  while (i < m) pieces.push({ type: "del", text: A[i++] });
  while (j < n) pieces.push({ type: "add", text: B[j++] });
  return pieces;
}

function DiffView({ a, b }: { a: string; b: string }) {
  const pieces = useMemo(() => diffWords(a, b), [a, b]);
  return (
    <div className="whitespace-pre-wrap font-serif text-[12px] leading-relaxed">
      {pieces.map((p, i) => {
        if (p.type === "same") return <span key={i}>{p.text}</span>;
        if (p.type === "add")
          return (
            <span key={i} className="rounded-sm bg-emerald-100 text-emerald-900">
              {p.text}
            </span>
          );
        return (
          <span key={i} className="rounded-sm bg-rose-100 text-rose-700 line-through">
            {p.text}
          </span>
        );
      })}
    </div>
  );
}
