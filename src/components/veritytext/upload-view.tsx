"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVerityStore, type SessionMeta } from "@/lib/veritytext/store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
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
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { DetectionReport } from "@/lib/veritytext/detector/types";

const ACCEPTED = [".docx", ".pdf", ".txt"];
const ACCEPTED_MIME = ".docx,.pdf,.txt";
const MAX_SIZE = 5 * 1024 * 1024;

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
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-6 text-center">
        <h1 className="font-serif text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
          Detect AI-generated text
        </h1>
        <p className="mt-2 text-sm text-stone-600 sm:text-base">
          Upload a <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">.docx</code>,{" "}
          <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">.pdf</code>, or{" "}
          <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">.txt</code> file (max 5 MB) and
          get a seven-signal analysis with an aggregate verdict, evidence snippets, and a downloadable
          report.
        </p>
      </div>

      <Card
        className={cn(
          "border-stone-200 transition-colors",
          dragOver && "border-stone-400 bg-stone-50",
        )}
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-stone-900">
            <UploadCloud className="size-5" />
            Upload document
          </CardTitle>
          <CardDescription>
            Drag &amp; drop a file here, or click to browse. Detection runs entirely on the server.
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
                .docx, .pdf, .txt — max 5 MB
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
