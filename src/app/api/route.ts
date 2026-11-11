import { NextResponse } from "next/server";

// Health / service metadata endpoint.
export async function GET() {
  return NextResponse.json({
    name: "VerityText",
    description: "AI Text Detector & Humanizer",
    status: "ok",
    endpoints: {
      upload: "POST /api/veritytext/upload",
      report: "GET /api/veritytext/report/[sessionId]",
      humanize: "POST /api/veritytext/humanize/[sessionId]",
      download:
        "GET /api/veritytext/download/[sessionId]?format=pdf|json|docx|txt&variant=original|humanized",
      sample: "GET /api/veritytext/sample/[name]",
    },
    disclaimer:
      "Detection is a statistical heuristic. False positives and false negatives occur. Do not use as sole evidence in academic, legal, or employment decisions.",
  });
}
