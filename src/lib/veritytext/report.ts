// VerityText report generators: JSON, PDF (pdfkit), DOCX (docx pkg), TXT.
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import { type Session } from "./session";
import { type DetectionReport } from "./detector/types";
import { DISCLAIMER } from "./detector";

// ---------- JSON report ----------

export function buildJsonReport(session: Session): object {
  const report = session.report!;
  return {
    file: {
      name: session.filename,
      size: session.fileSize,
      type: session.fileType.replace(/^\./, ""),
    },
    // Included at the top level to match the documented report schema.
    extractedTextLength: session.extractedLength,
    meta: {
      extractedLength: session.extractedLength,
      partialAnalysis: report.meta.partialAnalysis,
      wordCount: report.meta.wordCount,
      lowConfidence: report.meta.lowConfidence,
      mixedLanguage: report.meta.mixedLanguage,
      warnings: report.meta.warnings,
    },
    signals: report.signals.map((s) => ({
      name: s.name,
      key: s.key,
      score: Number(s.score.toFixed(3)),
      weight: s.weight,
      weak: s.weak ?? false,
      explanation: s.explanation,
      evidence: s.evidence,
      metrics: s.metrics,
    })),
    aggregate: {
      aiProbability: report.aggregate.aiProbability,
      verdict: report.aggregate.verdict,
      band: report.aggregate.band,
      confidence: report.aggregate.confidence,
      singleSignalTrigger: report.aggregate.singleSignalTrigger,
      lowConfidence: report.aggregate.lowConfidence,
      partialAnalysis: report.aggregate.partialAnalysis,
      notes: report.aggregate.notes,
    },
    disclaimer: DISCLAIMER,
    timestamp: report.timestamp,
  };
}

// ---------- PDF report (pdfkit) ----------

export async function buildPdfReport(session: Session): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 56, bottom: 72, left: 56, right: 56 },
        // Required so we can switchToPage() and stamp the mandatory disclaimer
        // footer on every page after the content has been laid out.
        bufferPages: true,
        info: {
          Title: `VerityText Report — ${session.filename}`,
          Author: "VerityText",
          Subject: "AI Text Detection Report",
        },
      });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const report = session.report!;
      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;
      const margin = 56;
      const contentWidth = pageWidth - margin * 2;

      // --- Cover ---
      doc
        .fontSize(22)
        .font("Helvetica-Bold")
        .fillColor("#1c1917")
        .text("VerityText", margin, 64, { width: contentWidth });
      doc
        .fontSize(11)
        .font("Helvetica")
        .fillColor("#57534e")
        .text("AI Text Detector & Humanizer — Detection Report", margin, 92, {
          width: contentWidth,
        });

      doc
        .moveDown(0.5)
        .fontSize(9)
        .fillColor("#a8a29e")
        .text(`File: ${session.filename}`, { width: contentWidth })
        .text(`Generated: ${new Date(report.timestamp).toLocaleString()}`, {
          width: contentWidth,
        })
        .text(`Words analyzed: ${report.meta.wordCount}   Sentences: ${report.meta.sentenceCount}`, {
          width: contentWidth,
        });

      drawHr(doc, margin, doc.y + 8, contentWidth);

      // --- Verdict ---
      doc
        .fontSize(13)
        .font("Helvetica-Bold")
        .fillColor("#1c1917")
        .text("Verdict", margin, doc.y + 18, { width: contentWidth });
      const verdictColor = verdictColorHex(report.aggregate.band);
      doc
        .fontSize(28)
        .font("Helvetica-Bold")
        .fillColor(verdictColor)
        .text(report.aggregate.verdict, margin, doc.y + 4, { width: contentWidth });
      doc
        .fontSize(12)
        .font("Helvetica")
        .fillColor("#1c1917")
        .text(
          `AI probability: ${report.aggregate.aiProbability}%   |   Confidence: ${report.aggregate.confidence}%`,
          margin,
          doc.y + 4,
          { width: contentWidth },
        );
      if (report.aggregate.singleSignalTrigger) {
        doc
          .fontSize(10)
          .fillColor("#b45309")
          .text(
            "Single-signal trigger — low confidence. Verdict downgraded one band.",
            { width: contentWidth },
          );
      }
      if (report.meta.warnings.length > 0) {
        doc.moveDown(0.4).fontSize(9).fillColor("#9a3412").text("Warnings:", {
          width: contentWidth,
        });
        for (const w of report.meta.warnings) {
          doc.text(`  • ${w}`, { width: contentWidth });
        }
      }

      drawHr(doc, margin, doc.y + 12, contentWidth);

      // --- Signals table ---
      doc
        .fontSize(13)
        .font("Helvetica-Bold")
        .fillColor("#1c1917")
        .text("Signals", margin, doc.y + 12, { width: contentWidth });

      // Table header
      const tableTop = doc.y + 8;
      const colX = {
        name: margin,
        score: margin + 220,
        weight: margin + 320,
        signal: margin + 400,
      };
      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .fillColor("#57534e")
        .text("SIGNAL", colX.name, tableTop, { width: 200 })
        .text("SCORE", colX.score, tableTop, { width: 80 })
        .text("WEIGHT", colX.weight, tableTop, { width: 80 })
        .text("TYPE", colX.signal, tableTop, { width: 120 });
      drawHr(doc, margin, tableTop + 14, contentWidth);

      let rowY = tableTop + 22;
      doc.font("Helvetica").fontSize(9).fillColor("#1c1917");
      for (const s of report.signals) {
        if (rowY > pageHeight - 120) {
          doc.addPage();
          rowY = margin + 8;
        }
        const scoreColor = scoreColorHex(s.score);
        doc
          .font("Helvetica")
          .fillColor("#1c1917")
          .text(s.name, colX.name, rowY, { width: 200 })
          .fillColor(scoreColor)
          .font("Helvetica-Bold")
          .text(`${Math.round(s.score * 100)}`, colX.score, rowY, { width: 80 })
          .font("Helvetica")
          .fillColor("#1c1917")
          .text(`${s.weight.toFixed(2)}`, colX.weight, rowY, { width: 80 })
          .fillColor(s.weak ? "#a8a29e" : "#1c1917")
          .text(s.weak ? "weak/heuristic" : "core", colX.signal, rowY, { width: 120 });
        rowY += 12;
        // Wrap the explanation under the row.
        doc
          .font("Helvetica-Oblique")
          .fontSize(8)
          .fillColor("#57534e")
          .text(s.explanation, colX.name, rowY, { width: contentWidth - 8 });
        rowY = doc.y + 6;
      }

      // --- Evidence appendix ---
      if (rowY > pageHeight - 160) {
        doc.addPage();
        rowY = margin + 8;
      }
      drawHr(doc, margin, rowY + 8, contentWidth);
      doc
        .fontSize(13)
        .font("Helvetica-Bold")
        .fillColor("#1c1917")
        .text("Evidence Appendix", margin, rowY + 18, { width: contentWidth });
      rowY = doc.y + 8;
      for (const s of report.signals) {
        if (rowY > pageHeight - 120) {
          doc.addPage();
          rowY = margin + 8;
        }
        doc
          .font("Helvetica-Bold")
          .fontSize(10)
          .fillColor("#1c1917")
          .text(s.name, margin, rowY, { width: contentWidth });
        rowY = doc.y + 4;
        doc.font("Helvetica").fontSize(8).fillColor("#44403c");
        for (const e of s.evidence.slice(0, 6)) {
          if (rowY > pageHeight - 80) {
            doc.addPage();
            rowY = margin + 8;
          }
          doc.text(`  • ${e}`, margin + 8, rowY, { width: contentWidth - 16 });
          rowY = doc.y + 2;
        }
        rowY += 4;
      }

      // --- Footer (on every page) ---
      // pdfkit only buffers pages when `bufferPages: true` (set above). Use the
      // documented `bufferedPageRange()` accessor rather than an ad-hoc count.
      const range = doc.bufferedPageRange();
      const pageCount = range.count;
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        // Temporarily remove the bottom margin so stamping text in the footer
        // area cannot overflow and trigger pagination (which would add blank
        // pages every time we write the footer).
        const savedBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        drawHr(doc, margin, pageHeight - 56, contentWidth);
        doc
          .fontSize(7)
          .font("Helvetica-Oblique")
          .fillColor("#78716c")
          .text(DISCLAIMER, margin, pageHeight - 48, {
            width: contentWidth,
            align: "left",
          });
        doc
          .fontSize(7)
          .font("Helvetica")
          .fillColor("#a8a29e")
          .text(
            `VerityText Report — page ${i - range.start + 1} of ${pageCount}`,
            margin,
            pageHeight - 26,
            { width: contentWidth, align: "left" },
          );
        doc.page.margins.bottom = savedBottom;
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function drawHr(doc: PDFDocument, x: number, y: number, w: number): void {
  doc
    .moveTo(x, y)
    .lineTo(x + w, y)
    .strokeColor("#e7e5e4")
    .lineWidth(0.5)
    .stroke();
}

function verdictColorHex(band: string): string {
  switch (band) {
    case "human":
    case "likely-human":
      return "#059669"; // emerald
    case "mixed":
      return "#b45309"; // amber
    case "likely-ai":
    case "very-likely-ai":
      return "#b91c1c"; // red
    default:
      return "#1c1917";
  }
}

function scoreColorHex(score: number): string {
  if (score < 0.35) return "#059669";
  if (score < 0.55) return "#b45309";
  return "#b91c1c";
}

// ---------- DOCX (for humanized-text download) ----------

export async function buildDocxFromText(text: string): Promise<Buffer> {
  const paragraphs: Paragraph[] = [];
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  for (const block of blocks) {
    const lines = block.split(/\n/).map((l) => l.trim()).filter(Boolean);
    // If the block is a single short line in ALL CAPS or short title-style, treat as heading.
    if (lines.length === 1 && (lines[0] === lines[0].toUpperCase() || lines[0].length < 60)) {
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: lines[0], bold: true })],
        }),
      );
    } else {
      for (const line of lines) {
        paragraphs.push(new Paragraph({ children: [new TextRun(line)] }));
      }
    }
    paragraphs.push(new Paragraph({ children: [] })); // paragraph break
  }
  const doc = new Document({
    creator: "VerityText",
    title: "VerityText humanized text",
    sections: [{ properties: {}, children: paragraphs }],
  });
  return Packer.toBuffer(doc);
}

// ---------- PDF for humanized text ----------

export async function buildPdfFromText(
  text: string,
  title = "VerityText — humanized text",
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 56, bottom: 72, left: 56, right: 56 },
        info: { Title: title, Author: "VerityText" },
      });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      doc
        .fontSize(14)
        .font("Helvetica-Bold")
        .fillColor("#1c1917")
        .text(title, 56, 56, { width: doc.page.width - 112 });
      doc
        .moveDown(0.5)
        .fontSize(9)
        .fillColor("#a8a29e")
        .text(`Generated: ${new Date().toLocaleString()}`, { width: doc.page.width - 112 });
      drawHr(doc, 56, doc.y + 8, doc.page.width - 112);
      doc.moveDown(1).fontSize(11).font("Helvetica").fillColor("#1c1917");

      const blocks = text.split(/\n\s*\n/);
      for (const block of blocks) {
        const trimmed = block.trim();
        if (!trimmed) {
          doc.moveDown(0.5);
          continue;
        }
        // Heading heuristic: single line, ALL CAPS or short.
        const lines = trimmed.split(/\n/);
        if (lines.length === 1 && (trimmed === trimmed.toUpperCase() || trimmed.length < 60)) {
          doc.moveUp(0.3);
          doc
            .font("Helvetica-Bold")
            .fontSize(13)
            .fillColor("#1c1917")
            .text(trimmed, { width: doc.page.width - 112 });
          doc.moveDown(0.2).font("Helvetica").fontSize(11);
        } else {
          doc.text(trimmed, { width: doc.page.width - 112, align: "left" });
          doc.moveDown(0.4);
        }
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ---------- TXT ----------

export function buildTxtFromText(text: string): Buffer {
  return Buffer.from(text, "utf8");
}

// Re-export for callers that need to regenerate a report from a session.
export type { DetectionReport };
