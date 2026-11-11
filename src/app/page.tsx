"use client";

import Image from "next/image";
import { VerityNav } from "@/components/veritytext/nav";
import { UploadView } from "@/components/veritytext/upload-view";
import { ReportView } from "@/components/veritytext/report-view";
import { HumanizeView } from "@/components/veritytext/humanize-view";
import { AboutDialog } from "@/components/veritytext/about-dialog";
import { VerityFooter } from "@/components/veritytext/footer";
import { useVerityStore } from "@/lib/veritytext/store";

export default function Home() {
  const view = useVerityStore((s) => s.view);

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-stone-50 text-stone-900">
      {/* Subtle paper grain across every view. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.05] mix-blend-multiply"
        style={{
          backgroundImage: "url('/images/paper-texture.webp')",
          backgroundSize: "720px auto",
        }}
      />
      <div className="relative z-10 flex min-h-screen flex-col">
        <VerityNav />
        <main className="relative flex-1" role="main">
          {view !== "detect" && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-72 overflow-hidden"
            >
              <Image
                src={
                  view === "report"
                    ? "/images/band-report.webp"
                    : "/images/band-humanize.webp"
                }
                alt=""
                fill
                sizes="100vw"
                className="object-cover object-center opacity-25"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-stone-50/10 via-stone-50/55 to-stone-50" />
            </div>
          )}
          <div className="relative">
            {view === "detect" && <UploadView />}
            {view === "report" && <ReportView />}
            {view === "humanize" && <HumanizeView />}
          </div>
        </main>
        <VerityFooter />
        <AboutDialog />
      </div>
    </div>
  );
}
