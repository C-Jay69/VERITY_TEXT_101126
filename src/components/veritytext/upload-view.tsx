"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useVerityStore, type SessionMeta } from "@/lib/veritytext/store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ArrowDown,
  BookOpen,
  FileText,
  UploadCloud,
  X,
  Loader2,
  FileWarning,
  FlaskConical,
  History,
  FolderOpen,
  Trash2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { DetectionReport } from "@/lib/veritytext/detector/types";

const ACCEPTED = [".docx", ".pdf", ".txt"];
const ACCEPTED_MIME = ".docx,.pdf,.txt";
const MAX_SIZE = 15 * 1024 * 1024;

const HERO_STATS = [
  { value: "7", label: "independent signals" },
  { value: "244", label: "AI-favourite terms" },
  { value: "1 hr", label: "in-memory lifetime" },
] as const;

interface UploadResponse {
  sessionId: string;
  meta: {
    filename: string;
    fileType: string;
    fileSize: number;
    wordCount: number;
    partialAnalysis: boolean;
    warnings: string[];
  };
  report: DetectionReport;
  extractedLength?: number;
  historySaved?: boolean;
  historyError?: string;
}

interface HistoryItem {
  id: string;
  filename: string;
  fileType: string;
  aiProbability: number;
  verdict: string;
  band: string;
  confidence: number;
  hasHumanized: boolean;
  humanizedScore: number | null;
  createdAt: string;
  updatedAt: string;
}

interface RestoreResponse {
  sessionId: string;
  meta: {
    filename: string;
    fileType: string;
    fileSize: number;
    extractedLength: number;
    wordCount: number;
    partialAnalysis: boolean;
    warnings: string[];
  };
  report: DetectionReport;
  humanized: {
    text: string;
    report: DetectionReport | null;
    meta: { warning?: string } | null;
  } | null;
}

export function UploadView() {
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [cancelController, setCancelController] = useState<AbortController | null>(null);
  const [saveHistory, setSaveHistory] = useState(false);
  const [historyEnabled, setHistoryEnabled] = useState(false);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [historyBusyId, setHistoryBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const setSession = useVerityStore((s) => s.setSession);
  const setHumanize = useVerityStore((s) => s.setHumanize);
  const setError = useVerityStore((s) => s.setError);
  const error = useVerityStore((s) => s.error);
  const recents = useVerityStore((s) => s.recents);
  const setView = useVerityStore((s) => s.setView);
  const setAboutOpen = useVerityStore((s) => s.setAboutOpen);

  const validateClient = useCallback(
    (file: File): string | null => {
      const lower = file.name.toLowerCase();
      const okExt = ACCEPTED.some((e) => lower.endsWith(e));
      if (!okExt) {
        return `Unsupported file type. Accepted: ${ACCEPTED.join(", ")}.`;
      }
      if (file.size > MAX_SIZE) {
        return `File is ${(file.size / 1024 / 1024).toFixed(2)} MB. Maximum is 5.00 MB.`;
      }
      if (file.size === 0) {
        return "File is empty.";
      }
      return null;
    },
    [],
  );

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/veritytext/history", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        enabled: boolean;
        items: HistoryItem[];
        reason?: string;
      };
      setHistoryEnabled(data.enabled);
      setHistoryItems(data.items ?? []);
      if (!data.enabled && data.reason) setHistoryNotice(data.reason);
    } catch {
      // History is optional — never block uploads on it.
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const openHistoryItem = useCallback(
    async (id: string) => {
      setHistoryBusyId(id);
      setHistoryNotice(null);
      try {
        const res = await fetch(`/api/veritytext/history/${id}/restore`, {
          method: "POST",
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          setHistoryNotice(j.error ?? "Could not open this history entry.");
          return;
        }
        const data = (await res.json()) as RestoreResponse;
        const meta: SessionMeta = {
          sessionId: data.sessionId,
          filename: data.meta.filename,
          fileType: data.meta.fileType,
          fileSize: data.meta.fileSize,
          wordCount: data.meta.wordCount,
          extractedLength: data.meta.extractedLength ?? data.meta.fileSize,
          partialAnalysis: data.meta.partialAnalysis,
          warnings: data.meta.warnings ?? [],
        };
        setSession(meta.sessionId, meta, data.report);
        if (data.humanized?.text && data.humanized.report) {
          setHumanize({
            text: data.humanized.text,
            report: data.humanized.report,
            originalScore: data.report.aggregate.aiProbability,
            newScore: data.humanized.report.aggregate.aiProbability,
            warning: data.humanized.meta?.warning ?? null,
          });
        }
      } catch (e) {
        setHistoryNotice(
          e instanceof Error ? e.message : "Could not open this history entry.",
        );
      } finally {
        setHistoryBusyId(null);
      }
    },
    [setSession, setHumanize],
  );

  const deleteHistoryItem = useCallback(async (id: string) => {
    if (!window.confirm("Delete this saved session permanently?")) return;
    setHistoryBusyId(id);
    setHistoryNotice(null);
    try {
      const res = await fetch(`/api/veritytext/history/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setHistoryNotice(j.error ?? "Could not delete this history entry.");
        return;
      }
      setHistoryItems((items) => items.filter((item) => item.id !== id));
    } catch (e) {
      setHistoryNotice(
        e instanceof Error ? e.message : "Could not delete this history entry.",
      );
    } finally {
      setHistoryBusyId(null);
    }
  }, []);

  const upload = useCallback(
    async (file: File) => {
      setLocalError(null);
      setError(null);
      setHistoryNotice(null);
      const err = validateClient(file);
      if (err) {
        setLocalError(err);
        return;
      }
      setUploading(true);
      setProgress(5);
      const controller = new AbortController();
      setCancelController(controller);
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("saveHistory", saveHistory ? "true" : "false");
        // Simulate incremental progress for UX — the upload itself is one request.
        const progressTimer = setInterval(() => {
          setProgress((p) => (p < 85 ? p + Math.random() * 8 : p));
        }, 180);
        const res = await fetch("/api/veritytext/upload", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });
        clearInterval(progressTimer);
        setProgress(95);
        if (!res.ok) {
          let msg = `Upload failed (HTTP ${res.status}).`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j.error) msg = j.error;
          } catch {
            // ignore parse error
          }
          setLocalError(msg);
          setProgress(0);
          return;
        }
        const data = (await res.json()) as UploadResponse;
        setProgress(100);
        const meta: SessionMeta = {
          sessionId: data.sessionId,
          filename: data.meta.filename,
          fileType: data.meta.fileType,
          fileSize: data.meta.fileSize,
          wordCount: data.meta.wordCount,
          extractedLength: data.extractedLength ?? data.meta.fileSize,
          partialAnalysis: data.meta.partialAnalysis,
          warnings: data.meta.warnings ?? [],
        };
        setSession(meta.sessionId, meta, data.report);
        if (data.historyError) setHistoryNotice(data.historyError);
        if (data.historySaved) void loadHistory();
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setLocalError("Upload cancelled.");
        } else {
          setLocalError(e instanceof Error ? e.message : "Upload failed.");
        }
        setProgress(0);
      } finally {
        setUploading(false);
        setCancelController(null);
        setTimeout(() => setProgress(0), 800);
      }
    },
    [setSession, setError, validateClient, saveHistory, loadHistory],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) upload(file);
    },
    [upload],
  );

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) upload(file);
      // reset input so picking the same file again re-triggers change
      e.target.value = "";
    },
    [upload],
  );

  const loadSample = useCallback(async (name: "ai_sample" | "human_sample" | "hybrid_sample") => {
    setLocalError(null);
    setError(null);
    setUploading(true);
    setProgress(10);
    try {
      const res = await fetch(`/api/veritytext/sample/${name}`, { method: "GET" });
      setProgress(80);
      if (!res.ok) {
        let msg = `Failed to load sample (HTTP ${res.status}).`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          // ignore
        }
        setLocalError(msg);
        setProgress(0);
        return;
      }
      const data = (await res.json()) as UploadResponse;
      setProgress(100);
      const meta: SessionMeta = {
        sessionId: data.sessionId,
        filename: data.meta.filename,
        fileType: data.meta.fileType,
        fileSize: data.meta.fileSize,
        wordCount: data.meta.wordCount,
        extractedLength: data.meta.fileSize,
        partialAnalysis: data.meta.partialAnalysis,
        warnings: data.meta.warnings ?? [],
      };
      setSession(meta.sessionId, meta, data.report);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Failed to load sample.");
      setProgress(0);
    } finally {
      setUploading(false);
      setTimeout(() => setProgress(0), 800);
    }
  }, [setSession, setError]);

  const cancelUpload = useCallback(() => {
    if (cancelController) cancelController.abort();
  }, [cancelController]);

  const displayError = localError ?? error;

  return (
    <div className="pb-12">
      <section className="relative isolate overflow-hidden bg-stone-950">
        <Image
          src="/images/hero-library.webp"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-center opacity-75"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-r from-stone-950/95 via-stone-950/80 to-stone-950/25"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-stone-950/80 via-transparent to-stone-950/20"
        />
        <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-4 pb-20 pt-12 sm:px-6 sm:pb-24 sm:pt-16 lg:grid-cols-[1.4fr_0.9fr] lg:items-end">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-100 backdrop-blur">
              <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
              Seven-signal forensic analysis
            </span>
            <h1 className="mt-5 max-w-2xl font-serif text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl">
              Read between the lines.
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-stone-300 sm:text-base">
              VerityText weighs perplexity, burstiness, repetition, vocabulary,
              specificity, tone, and statistical fingerprints — then shows you
              the evidence behind every verdict.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                className="gap-2 rounded-full bg-white px-5 text-stone-900 shadow-lg shadow-stone-950/30 hover:bg-stone-100"
                onClick={() =>
                  document.getElementById("upload")?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  })
                }
              >
                Analyze a document <ArrowDown className="size-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="gap-2 rounded-full border-white/25 bg-white/5 text-white hover:bg-white/15 hover:text-white"
                onClick={() => setAboutOpen(true)}
              >
                <BookOpen className="size-4" /> How it works
              </Button>
            </div>
            <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-400">
              <span className="inline-flex items-center gap-1">
                <ShieldCheck className="size-3.5 text-emerald-400" /> No account required
              </span>
              <span aria-hidden="true">·</span>
              <span>In-memory by default</span>
              <span aria-hidden="true">·</span>
              <span>DOCX, PDF, TXT</span>
            </p>
          </div>

          <dl className="grid grid-cols-3 divide-x divide-white/15 overflow-hidden rounded-2xl border border-white/15 bg-white/[0.07] text-center backdrop-blur-md lg:grid-cols-1 lg:divide-x-0 lg:divide-y">
            {HERO_STATS.map((stat) => (
              <div
                key={stat.label}
                className="flex flex-col-reverse px-4 py-4 lg:flex-row-reverse lg:items-baseline lg:justify-between lg:px-5"
              >
                <dt className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-stone-300 lg:mt-0">
                  {stat.label}
                </dt>
                <dd className="font-serif text-2xl font-semibold text-white">
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <div id="upload" className="mx-auto w-full max-w-3xl scroll-mt-28 px-4 sm:px-6">
        <Card
          className={cn(
            "-mt-12 border-stone-200 bg-white/95 shadow-xl shadow-stone-900/5 backdrop-blur transition-colors",
            dragOver && "border-stone-400 bg-white",
          )}
        >
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-stone-900">
            <UploadCloud className="size-5" />
            Upload document
          </CardTitle>
          <CardDescription>
            Drag &amp; drop a file here, or click to browse. Whole documents are
            analyzed on the server — up to 1,000,000 characters (about 150,000
            words).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            role="button"
            tabIndex={0}
            aria-label="Upload a document by clicking or dropping a file"
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(false);
            }}
            onDrop={onDrop}
            className={cn(
              "flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-stone-300 bg-stone-50/60 p-8 text-center transition-colors",
              "hover:border-stone-400 hover:bg-stone-50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-2",
              dragOver && "border-stone-500 bg-stone-100",
              uploading && "pointer-events-none opacity-70",
            )}
          >
            <div className="flex size-12 items-center justify-center rounded-full bg-stone-200 text-stone-700">
              <FileText className="size-6" />
            </div>
            <div>
              <div className="text-sm font-medium text-stone-800">
                {uploading ? "Uploading…" : "Drop a file or click to browse"}
              </div>
              <div className="mt-1 text-xs text-stone-500">
                .docx, .pdf, .txt — max 15 MB
              </div>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_MIME}
              onChange={onPick}
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
            />
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-md border border-stone-200 bg-stone-50/60 p-3 text-xs text-stone-600">
            <Checkbox
              id="save-history"
              checked={saveHistory}
              onCheckedChange={(checked) => setSaveHistory(checked === true)}
              disabled={uploading}
              aria-label="Save to history"
              className="mt-0.5"
            />
            <label htmlFor="save-history" className="cursor-pointer">
              <span className="font-medium text-stone-800">
                Save to history (opt-in)
              </span>
              <span className="mt-0.5 block">
                Stores this document, its report, and any humanized version in the
                configured Postgres database. Off by default; delete entries at any time.
              </span>
            </label>
          </div>

          {uploading && (
            <div className="mt-4 space-y-2">
              <Progress value={progress} className="h-2 bg-stone-200" />
              <div className="flex items-center justify-between text-xs text-stone-500">
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="size-3 animate-spin" />
                  {progress < 95 ? "Uploading & extracting text…" : "Running detection…"}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-stone-600"
                  onClick={cancelUpload}
                >
                  <X className="size-3" /> Cancel
                </Button>
              </div>
              <p className="text-[11px] text-stone-400">
                The whole document is analyzed, not a sample. A 100,000-word
                manuscript can take 10–20 seconds.
              </p>
            </div>
          )}

          {displayError && (
            <Alert variant="destructive" className="mt-4">
              <FileWarning className="size-4" />
              <AlertTitle>Upload error</AlertTitle>
              <AlertDescription>{displayError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="mt-6">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-500">
          Or try a sample
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SampleButton label="AI-generated" desc="Mechanical, predictable" onClick={() => loadSample("ai_sample")} disabled={uploading} />
          <SampleButton label="Human-written" desc="Varied, specific" onClick={() => loadSample("human_sample")} disabled={uploading} />
          <SampleButton label="Hybrid" desc="Heavily edited" onClick={() => loadSample("hybrid_sample")} disabled={uploading} />
        </div>
      </div>

      {(historyEnabled || historyItems.length > 0 || historyNotice) && (
        <div className="mt-8">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-stone-500">
              Saved history (opt-in)
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-stone-600"
              onClick={() => void loadHistory()}
            >
              <RefreshCw className="size-3" /> Refresh
            </Button>
          </div>

          {historyNotice && (
            <div className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {historyNotice}
            </div>
          )}

          {historyItems.length === 0 ? (
            <p className="rounded-lg border border-stone-200 bg-white px-3 py-3 text-xs text-stone-500">
              No saved entries yet. Turn on “Save to history” before uploading to keep a
              document, its report, and any humanized version here.
            </p>
          ) : (
            <ScrollArea className="max-h-56 rounded-lg border border-stone-200 bg-white">
              <ul className="divide-y divide-stone-100">
                {historyItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <History className="size-4 shrink-0 text-stone-400" />
                        <span className="truncate font-medium text-stone-800">
                          {item.filename}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-stone-500">
                        {new Date(item.createdAt).toLocaleString()} · {item.verdict}{" "}
                        {item.aiProbability}%
                        {item.hasHumanized && item.humanizedScore != null
                          ? ` · humanized ${item.humanizedScore}%`
                          : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={historyBusyId === item.id}
                        onClick={() => void openHistoryItem(item.id)}
                      >
                        {historyBusyId === item.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <FolderOpen className="size-3" />
                        )}
                        Open
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-stone-500"
                        disabled={historyBusyId === item.id}
                        aria-label={`Delete ${item.filename}`}
                        onClick={() => void deleteHistoryItem(item.id)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </div>
      )}

      {recents.length > 0 && (
        <div className="mt-8">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-500">
            Recent uploads (this browser tab)
          </div>
          <ScrollArea className="max-h-40 rounded-lg border border-stone-200 bg-white">
            <ul className="divide-y divide-stone-100">
              {recents.map((r) => (
                <li
                  key={r.sessionId}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="size-4 shrink-0 text-stone-400" />
                    <span className="truncate font-medium text-stone-800">{r.filename}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-stone-500">{r.verdict}</span>
                    <span className="text-xs font-semibold text-stone-700">{r.aiProbability}%</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setView("report")}
                    >
                      View
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </div>
      )}

      <div className="mt-8 rounded-lg border border-stone-200 bg-stone-50 p-4 text-xs text-stone-600">
        <div className="mb-1 flex items-center gap-1.5 font-medium text-stone-700">
          <FlaskConical className="size-3.5" /> How detection works
        </div>
        VerityText computes seven statistical signals (perplexity, burstiness, repetitive patterns,
        generic vocabulary, lack of specificity, uniform tone, statistical fingerprints) and aggregates
        them as a weighted cluster. No single signal is ever sufficient proof. Read the methodology in
        the About dialog.
      </div>
    </div>

      <section
        aria-labelledby="signals-heading"
        className="mx-auto mt-14 w-full max-w-6xl px-4 sm:px-6"
      >
        <div className="flex flex-col gap-4 border-t border-stone-200 pt-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-700">
              Inside the analysis
            </div>
            <h2
              id="signals-heading"
              className="mt-2 font-serif text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl"
            >
              Seven signals. One honest verdict.
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600">
              No single number decides the outcome. Each signal is scored and
              weighted, then read together — so you can see what drove the
              verdict, not just the verdict itself.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setAboutOpen(true)}
            className="shrink-0 gap-1.5 self-start border-stone-300 bg-white/70 sm:self-auto"
          >
            <BookOpen className="size-4" /> Read the methodology
          </Button>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <FeatureCard
            image="/images/typewriter.webp"
            alt="Vintage typewriter with a sheet of paper"
            eyebrow="01 · Predictability"
            title="Perplexity & burstiness"
          >
            Vocabulary rarity and sentence-length variance — the most-cited
            signatures in the detection literature.
          </FeatureCard>
          <FeatureCard
            image="/images/writing-desk.webp"
            alt="Notebook and pencil on a wooden writing desk"
            eyebrow="02 · Structure"
            title="Repetition & tone"
          >
            Mechanical transitions, repeated openers, uniform paragraphs, and a
            flat-formal register.
          </FeatureCard>
          <FeatureCard
            image="/images/manuscript-letters.webp"
            alt="Handwritten letters spread across a table"
            eyebrow="03 · Evidence"
            title="Specificity & fingerprints"
          >
            Named entities, dates, numbers, quotes, and weak statistical
            anomalies — shown with the snippets behind them.
          </FeatureCard>
        </div>
      </section>
    </div>
  );
}

function SampleButton({
  label,
  desc,
  onClick,
  disabled,
}: {
  label: string;
  desc: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-col items-start gap-1 rounded-lg border border-stone-200 bg-white p-3 text-left transition-colors",
        "hover:border-stone-400 hover:bg-stone-50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      <span className="text-sm font-medium text-stone-900">{label}</span>
      <span className="text-xs text-stone-500">{desc}</span>
    </button>
  );
}

function FeatureCard({
  image,
  alt,
  eyebrow,
  title,
  children,
}: {
  image: string;
  alt: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article className="group overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className="relative h-40 overflow-hidden">
        <Image
          src={image}
          alt={alt}
          fill
          sizes="(min-width: 640px) 33vw, 100vw"
          className="object-cover transition-transform duration-700 group-hover:scale-[1.04]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-stone-950/60 via-stone-950/5 to-transparent"
        />
        <span className="absolute bottom-3 left-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/85">
          {eyebrow}
        </span>
      </div>
      <div className="p-4">
        <h3 className="font-serif text-lg font-semibold text-stone-900">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-stone-600">{children}</p>
      </div>
    </article>
  );
}
