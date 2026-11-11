"use client";

import { ShieldAlert } from "lucide-react";

export function VerityFooter() {
  return (
    <footer
      className="mt-auto w-full border-t border-stone-200 bg-stone-50"
      role="contentinfo"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div className="text-xs text-stone-600">
            <div className="font-serif text-sm font-semibold text-stone-900">VerityText</div>
            <div className="text-stone-500">AI Text Detector &amp; Humanizer — v1.0</div>
          </div>
          <div className="flex max-w-xl items-start gap-2 rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-800">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Detection is a statistical heuristic. False positives and false negatives occur. Do not
              use as sole evidence in academic, legal, or employment decisions.
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
