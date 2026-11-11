"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useVerityStore, type ViewKey } from "@/lib/veritytext/store";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  FileText,
  Info,
  Menu,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

const TABS: { key: ViewKey; label: string; icon: React.ReactNode }[] = [
  { key: "detect", label: "Detect", icon: <ScanSearch className="size-4" /> },
  { key: "report", label: "Report", icon: <FileText className="size-4" /> },
  { key: "humanize", label: "Humanize", icon: <Sparkles className="size-4" /> },
];

export function VerityNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const view = useVerityStore((s) => s.view);
  const setView = useVerityStore((s) => s.setView);
  const setAboutOpen = useVerityStore((s) => s.setAboutOpen);
  const sessionId = useVerityStore((s) => s.sessionId);
  const report = useVerityStore((s) => s.report);
  const humanized = useVerityStore((s) => s.humanizedText);

  // Disable report/humanize tabs until there's a session.
  const canReport = Boolean(sessionId && report);
  const canHumanize = Boolean(sessionId && report);

  const isDisabled = (key: ViewKey) =>
    (key === "report" && !canReport) || (key === "humanize" && !canHumanize);

  const selectView = (key: ViewKey) => {
    setView(key);
    setMenuOpen(false);
  };

  const analyze = () => {
    setView("detect");
    setMenuOpen(false);
    // Wait for the detect view to mount before scrolling to the uploader.
    requestAnimationFrame(() =>
      document.getElementById("upload")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      }),
    );
  };

  const openAbout = () => {
    setAboutOpen(true);
    setMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 w-full" role="banner">
      <div
        aria-hidden="true"
        className="h-[3px] w-full bg-gradient-to-r from-amber-400 via-rose-400 to-emerald-400"
      />
      <div className="border-b border-stone-200/80 bg-white/85 shadow-[0_1px_16px_rgba(28,25,23,0.05)] backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => {
              setView("detect");
              setMenuOpen(false);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="group flex shrink-0 items-center gap-2.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-2"
            aria-label="VerityText — back to Detect"
          >
            <span className="relative flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-stone-900 via-stone-800 to-amber-950 text-amber-300 shadow-sm ring-1 ring-stone-900/10 transition-transform group-hover:-rotate-2">
              <ScanSearch className="size-5" />
              <span
                aria-hidden="true"
                className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-emerald-400 ring-2 ring-white"
              />
            </span>
            <span className="leading-tight">
              <span className="block font-serif text-lg font-semibold tracking-tight text-stone-900">
                VerityText
              </span>
              <span className="hidden text-[11px] text-stone-500 sm:block">
                AI Text Detector &amp; Humanizer
              </span>
            </span>
          </button>

          <nav
            className="ml-4 hidden items-center gap-1 rounded-full border border-stone-200 bg-stone-100/80 p-1 md:flex"
            role="tablist"
            aria-label="Primary views"
          >
            {TABS.map((t) => {
              const active = view === t.key;
              const disabled = isDisabled(t.key);
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={active}
                  aria-disabled={disabled}
                  disabled={disabled}
                  onClick={() => selectView(t.key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-1",
                    active
                      ? "bg-white text-stone-900 shadow-sm ring-1 ring-stone-200"
                      : "text-stone-600 hover:bg-white/60 hover:text-stone-900",
                    disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
                  )}
                >
                  {t.icon}
                  <span>{t.label}</span>
                  {t.key === "humanize" && humanized && (
                    <span
                      className="ml-0.5 inline-flex size-1.5 rounded-full bg-emerald-500"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 text-[11px] font-medium text-stone-500 xl:flex">
              <ShieldCheck className="size-3.5 text-emerald-600" />
              Private by default
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="hidden gap-1.5 text-stone-600 hover:text-stone-900 md:inline-flex"
              onClick={openAbout}
            >
              <Info className="size-4" />
              <span className="hidden lg:inline">Methodology</span>
            </Button>
            <Button
              size="sm"
              className="hidden gap-1.5 rounded-full bg-stone-900 px-4 text-stone-50 shadow-sm hover:bg-stone-800 md:inline-flex"
              onClick={analyze}
            >
              Analyze a document
              <ArrowRight className="size-4" />
            </Button>

            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="inline-flex size-9 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-700 shadow-sm transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 md:hidden"
              aria-expanded={menuOpen}
              aria-controls="verity-mobile-nav"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
            >
              {menuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div
            id="verity-mobile-nav"
            className="border-t border-stone-200 bg-white px-4 pb-4 pt-3 md:hidden"
          >
            <div className="flex flex-col gap-1" role="tablist" aria-label="Primary views">
              {TABS.map((t) => {
                const active = view === t.key;
                const disabled = isDisabled(t.key);
                return (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={active}
                    aria-disabled={disabled}
                    disabled={disabled}
                    onClick={() => selectView(t.key)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      active
                        ? "bg-stone-900 text-white"
                        : "text-stone-700 hover:bg-stone-100",
                      disabled && "cursor-not-allowed opacity-45",
                    )}
                  >
                    {t.icon}
                    {t.label}
                    {t.key === "humanize" && humanized && (
                      <span className="ml-auto size-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="outline" className="gap-1.5" onClick={openAbout}>
                <Info className="size-4" /> Methodology
              </Button>
              <Button className="gap-1.5 bg-stone-900 text-stone-50 hover:bg-stone-800" onClick={analyze}>
                Analyze <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
