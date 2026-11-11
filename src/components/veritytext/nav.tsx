"use client";

import { cn } from "@/lib/utils";
import { useVerityStore, type ViewKey } from "@/lib/veritytext/store";
import { Button } from "@/components/ui/button";
import { Info, ScanSearch, FileText, Sparkles } from "lucide-react";

const TABS: { key: ViewKey; label: string; icon: React.ReactNode }[] = [
  { key: "detect", label: "Detect", icon: <ScanSearch className="size-4" /> },
  { key: "report", label: "Report", icon: <FileText className="size-4" /> },
  { key: "humanize", label: "Humanize", icon: <Sparkles className="size-4" /> },
];

export function VerityNav() {
  const view = useVerityStore((s) => s.view);
  const setView = useVerityStore((s) => s.setView);
  const setAboutOpen = useVerityStore((s) => s.setAboutOpen);
  const sessionId = useVerityStore((s) => s.sessionId);
  const report = useVerityStore((s) => s.report);
  const humanized = useVerityStore((s) => s.humanizedText);

  // Disable report/humanize tabs until there's a session.
  const canReport = Boolean(sessionId && report);
  const canHumanize = Boolean(sessionId && report);

  return (
    <header
      className="sticky top-0 z-40 w-full border-b border-stone-200 bg-background/85 backdrop-blur"
      role="banner"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-3 sm:px-6 md:flex-row md:items-center md:justify-between md:py-4">
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-md bg-stone-900 text-stone-50"
          >
            <ScanSearch className="size-5" />
          </div>
          <div className="leading-tight">
            <div className="font-serif text-lg font-semibold tracking-tight text-stone-900">
              VerityText
            </div>
            <div className="text-xs text-stone-500">
              AI Text Detector &amp; Humanizer
            </div>
          </div>
        </div>

        <nav
          className="flex items-center gap-1 rounded-lg border border-stone-200 bg-stone-100 p-1"
          role="tablist"
          aria-label="Primary views"
        >
          {TABS.map((t) => {
            const active = view === t.key;
            const disabled =
              (t.key === "report" && !canReport) ||
              (t.key === "humanize" && !canHumanize);
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                aria-disabled={disabled}
                disabled={disabled}
                onClick={() => setView(t.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-1",
                  active
                    ? "bg-background text-stone-900 shadow-sm"
                    : "text-stone-600 hover:text-stone-900",
                  disabled && "cursor-not-allowed opacity-50",
                )}
              >
                {t.icon}
                <span>{t.label}</span>
                {t.key === "humanize" && humanized && (
                  <span className="ml-1 inline-flex size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                )}
              </button>
            );
          })}
          <Button
            variant="ghost"
            size="sm"
            className="ml-1 gap-1.5 text-stone-600"
            onClick={() => setAboutOpen(true)}
            aria-label="Open methodology dialog"
          >
            <Info className="size-4" />
            <span className="hidden sm:inline">About</span>
          </Button>
        </nav>
      </div>
    </header>
  );
}
