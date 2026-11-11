"use client";

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
    <div className="flex min-h-screen flex-col bg-stone-50 text-stone-900">
      <VerityNav />
      <main className="flex-1" role="main">
        {view === "detect" && <UploadView />}
        {view === "report" && <ReportView />}
        {view === "humanize" && <HumanizeView />}
      </main>
      <VerityFooter />
      <AboutDialog />
    </div>
  );
}
