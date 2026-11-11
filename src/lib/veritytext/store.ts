"use client";

import { create } from "zustand";
import type { DetectionReport } from "@/lib/veritytext/detector/types";

export type ViewKey = "detect" | "report" | "humanize";

export interface SessionMeta {
  sessionId: string;
  filename: string;
  fileType: string;
  fileSize: number;
  wordCount: number;
  extractedLength: number;
  partialAnalysis: boolean;
  warnings: string[];
}

export interface RecentSession {
  sessionId: string;
  filename: string;
  fileType: string;
  aiProbability: number;
  verdict: string;
  createdAt: number;
}

interface VerityState {
  view: ViewKey;
  sessionId: string | null;
  meta: SessionMeta | null;
  report: DetectionReport | null;
  loadingReport: boolean;
  error: string | null;
  recents: RecentSession[];

  // Humanize state
  humanizedText: string | null;
  humanizedReport: DetectionReport | null;
  originalScore: number | null;
  newScore: number | null;
  humanizeLoading: boolean;
  humanizeError: string | null;
  humanizeWarning: string | null;

  // About dialog
  aboutOpen: boolean;

  setView: (v: ViewKey) => void;
  setAboutOpen: (open: boolean) => void;
  setSession: (sessionId: string, meta: SessionMeta, report: DetectionReport) => void;
  setReport: (report: DetectionReport) => void;
  setLoadingReport: (b: boolean) => void;
  setError: (e: string | null) => void;
  addRecent: (r: RecentSession) => void;
  reset: () => void;
  setHumanize: (data: {
    text: string;
    report: DetectionReport;
    originalScore: number;
    newScore: number;
    warning?: string | null;
    error?: string | null;
  }) => void;
  setHumanizeLoading: (b: boolean) => void;
  setHumanizeError: (e: string | null) => void;
  clearHumanize: () => void;
}

export const useVerityStore = create<VerityState>((set) => ({
  view: "detect",
  sessionId: null,
  meta: null,
  report: null,
  loadingReport: false,
  error: null,
  recents: [],

  humanizedText: null,
  humanizedReport: null,
  originalScore: null,
  newScore: null,
  humanizeLoading: false,
  humanizeError: null,
  humanizeWarning: null,

  aboutOpen: false,

  setView: (v) => set({ view: v }),
  setAboutOpen: (open) => set({ aboutOpen: open }),
  setSession: (sessionId, meta, report) =>
    set((s) => ({
      sessionId,
      meta,
      report,
      error: null,
      view: "report",
      humanizedText: null,
      humanizedReport: null,
      originalScore: null,
      newScore: null,
      humanizeError: null,
      humanizeWarning: null,
      recents: [
        {
          sessionId,
          filename: meta.filename,
          fileType: meta.fileType,
          aiProbability: report.aggregate.aiProbability,
          verdict: report.aggregate.verdict,
          createdAt: Date.now(),
        },
        ...s.recents.filter((r) => r.sessionId !== sessionId),
      ].slice(0, 3),
    })),
  setReport: (report) => set({ report }),
  setLoadingReport: (b) => set({ loadingReport: b }),
  setError: (e) => set({ error: e }),
  addRecent: (r) =>
    set((s) => ({
      recents: [r, ...s.recents.filter((x) => x.sessionId !== r.sessionId)].slice(0, 3),
    })),
  reset: () =>
    set({
      view: "detect",
      sessionId: null,
      meta: null,
      report: null,
      error: null,
      loadingReport: false,
      humanizedText: null,
      humanizedReport: null,
      originalScore: null,
      newScore: null,
      humanizeLoading: false,
      humanizeError: null,
      humanizeWarning: null,
    }),
  setHumanize: (data) =>
    set({
      humanizedText: data.text,
      humanizedReport: data.report,
      originalScore: data.originalScore,
      newScore: data.newScore,
      humanizeWarning: data.warning ?? null,
      humanizeError: data.error ?? null,
    }),
  setHumanizeLoading: (b) => set({ humanizeLoading: b }),
  setHumanizeError: (e) => set({ humanizeError: e }),
  clearHumanize: () =>
    set({
      humanizedText: null,
      humanizedReport: null,
      originalScore: null,
      newScore: null,
      humanizeError: null,
      humanizeWarning: null,
    }),
}));
