// POST /api/veritytext/upload
// Multipart form-data with field "file". Returns { sessionId, meta, report }.
import { NextRequest, NextResponse } from "next/server";
import {
  MAX_FILE_SIZE,
  validateFile,
  extractText,
} from "@/lib/veritytext/parsing";
import { createSession } from "@/lib/veritytext/session";
import { analyzeText } from "@/lib/veritytext/detector";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "No file uploaded. Use a multipart form with a 'file' field." },
        { status: 400 },
      );
    }

    // Edge cap (frontend also validates, but enforce here).
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File is ${(file.size / 1024 / 1024).toFixed(2)} MB. Maximum is 5.00 MB.` },
        { status: 413 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    const validation = validateFile(file.name, file.type, file.size, buffer);
    if (!validation.ok || !validation.meta) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    let extracted;
    try {
      extracted = await extractText(buffer, validation.meta);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not read file.";
      return NextResponse.json({ error: msg }, { status: 422 });
    }

    // Run detection immediately so the report endpoint can serve it.
    const report = analyzeText(extracted.text, {
      extractedLength: extracted.text.length,
      filename: validation.meta.filename,
    });

    const session = createSession({
      filename: validation.meta.filename,
      fileType: validation.meta.ext,
      fileSize: validation.meta.size,
      originalText: extracted.text,
      extractedLength: extracted.text.length,
      report,
    });

    return NextResponse.json({
      sessionId: session.id,
      meta: {
        filename: session.filename,
        fileType: session.fileType,
        fileSize: session.fileSize,
        ...extracted.meta,
      },
      report,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Upload failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
