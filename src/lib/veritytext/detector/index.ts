// VerityText detection engine — orchestrates the seven signals and aggregates
// the verdict. Detection is ALWAYS a weighted cluster; a single high signal
// is never sufficient proof.
import nlp from "compromise";
import {
  type AggregateResult,
  type DetectionReport,
  type SignalResult,
  DISCLAIMER,
  bandFor,
  downgradeBand,
} from "./types";
import { DEFAULT_WEIGHTS, SIGNAL_ORDER } from "./weights";
import {
  splitSentences,
  splitParagraphs,
  tokenize,
  wordCount,
} from "./text-utils";
import { perplexitySignal } from "./signals/perplexity";
import { burstinessSignal } from "./signals/burstiness";
import { repetitiveSignal } from "./signals/repetitive";
import { vocabularySignal } from "./signals/vocabulary";
import { specificitySignal } from "./signals/specificity";
import { toneSignal } from "./signals/tone";
import { fingerprintsSignal } from "./signals/fingerprints";

const MAX_ANALYZED_CHARS = 50_000;

export interface AnalyzeOptions {
  /** Original extracted length before truncation. */
  extractedLength: number;
  /** Original filename (for warnings only). */
  filename?: string;
}

export function analyzeText(
  rawText: string,
  options: AnalyzeOptions = { extractedLength: rawText.length },
): DetectionReport {
  const text = rawText.slice(0, MAX_ANALYZED_CHARS);
  const partialAnalysis = rawText.length > MAX_ANALYZED_CHARS;

  const sentences = splitSentences(text);
  const paragraphs = splitParagraphs(text);
  const wc = wordCount(text);
  const lowConfidence = wc >= 50 && wc < 200;

  // Mixed-language detection: compromise + a heuristic on non-ASCII letter
  // density. If a substantial fraction of letters are non-Latin, warn.
  const warnings: string[] = [];
  const mixedLanguage = detectMixedLanguage(text, warnings);

  // Run all seven signals.
  const signals: SignalResult[] = [
    perplexitySignal(text, sentences),
    burstinessSignal(text, sentences),
    repetitiveSignal(text, sentences, paragraphs, wc),
    vocabularySignal(text, wc),
    specificitySignal(text),
    toneSignal(text, sentences),
    fingerprintsSignal(text, sentences, paragraphs),
  ];

  const aggregate = aggregateScore(signals, {
    lowConfidence,
    partialAnalysis,
    wordCount: wc,
    sentenceCount: sentences.length,
    mixedLanguage,
  });

  if (mixedLanguage) {
    warnings.push(
      "Mixed-language text detected — results may be less reliable for non-English content.",
    );
  }
  if (partialAnalysis) {
    warnings.push(
      `Text was truncated at ${MAX_ANALYZED_CHARS} characters (original ${options.extractedLength}). Analysis covers the first portion only.`,
    );
  }
  if (lowConfidence) {
    warnings.push(
      "Sample is short (50–200 words). Results are low-confidence — analyze a longer passage for a stable verdict.",
    );
  }
  warnings.push(...aggregate.notes);

  return {
    signals,
    aggregate,
    meta: {
      extractedLength: options.extractedLength,
      analyzedLength: text.length,
      wordCount: wc,
      sentenceCount: sentences.length,
      partialAnalysis,
      lowConfidence,
      mixedLanguage,
      warnings,
    },
    disclaimer: DISCLAIMER,
    timestamp: new Date().toISOString(),
  };
}

interface AggregateInput {
  lowConfidence: boolean;
  partialAnalysis: boolean;
  wordCount: number;
  sentenceCount: number;
  mixedLanguage: boolean;
}

function aggregateScore(
  signals: SignalResult[],
  input: AggregateInput,
): AggregateResult {
  const totalWeight = signals.reduce((acc, s) => acc + s.weight, 0);
  const weighted = signals.reduce(
    (acc, s) => acc + s.score * s.weight,
    0,
  );
  const normalized = weighted / Math.max(totalWeight, 1e-9);
  let probability = Math.round(normalized * 100);
  probability = Math.max(0, Math.min(100, probability));

  // Single-signal rule: if exactly ONE signal is "high" (>= 0.6) and the
  // rest are all "low" (< 0.4), downgrade the verdict by one band.
  const highCount = signals.filter((s) => s.score >= 0.6).length;
  const lowCount = signals.filter((s) => s.score < 0.4).length;
  const singleSignalTrigger =
    highCount === 1 && lowCount >= signals.length - 1;

  let band = bandFor(probability);
  let notes: string[] = [];
  if (singleSignalTrigger) {
    const downgraded = downgradeBand(band.key);
    band = { key: downgraded, label: bandLabel(downgraded) };
    notes.push("Single-signal trigger — low confidence; verdict downgraded one band.");
  }

  // Confidence heuristic: how tightly do the signals agree? Lower variance
  // among signal scores → higher confidence. Also boosted by sample length.
  const scores = signals.map((s) => s.score);
  const variance =
    scores.reduce((acc, s) => acc + (s - normalized) ** 2, 0) /
    Math.max(scores.length, 1);
  const varianceConfidence = Math.max(0, 1 - variance * 4); // 0..1
  const lengthConfidence = Math.min(1, input.wordCount / 500);
  let confidence = Math.round(
    (varianceConfidence * 0.6 + lengthConfidence * 0.4) * 100,
  );
  if (input.lowConfidence) confidence = Math.min(confidence, 40);
  if (input.mixedLanguage) confidence = Math.min(confidence, 50);
  if (singleSignalTrigger) confidence = Math.min(confidence, 50);
  confidence = Math.max(15, Math.min(95, confidence));

  return {
    aiProbability: probability,
    verdict: band.label,
    band: band.key,
    confidence,
    singleSignalTrigger,
    lowConfidence: input.lowConfidence,
    partialAnalysis: input.partialAnalysis,
    notes,
  };
}

function bandLabel(key: string): string {
  switch (key) {
    case "human":
      return "Human";
    case "likely-human":
      return "Likely Human";
    case "mixed":
      return "Mixed / Uncertain";
    case "likely-ai":
      return "Likely AI";
    case "very-likely-ai":
      return "Very Likely AI";
    default:
      return "Mixed / Uncertain";
  }
}

function detectMixedLanguage(text: string, warnings: string[]): boolean {
  const letters = (text.match(/[a-zA-Z]/g) ?? []).length;
  const nonAsciiLetters = (text.match(/[\u00c0-\u024f\u0400-\u04ff\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) ?? []).length;
  // Use compromise to detect non-English-heavy text (very heuristic).
  const doc = nlp(text.slice(0, 2000));
  const sentences = doc.sentences().out("array");
  const avgLen = sentences.length > 0
    ? sentences.reduce((a, s) => a + s.split(/\s+/).length, 0) / sentences.length
    : 0;
  // If a substantial fraction of letters are non-ASCII OR compromise finds
  // very few parseable sentences, flag mixed language.
  const ratio = letters > 0 ? nonAsciiLetters / letters : 0;
  if (ratio > 0.08) {
    warnings.push(
      `Non-Latin script detected (~${(ratio * 100).toFixed(0)}% of letters). Detector is tuned for English.`,
    );
    return true;
  }
  if (avgLen > 0 && avgLen < 4 && text.length > 300) {
    warnings.push("Sentence parsing yielded very short segments — text may not be English prose.");
    return true;
  }
  return false;
}

// Re-export the signal order for the UI and report generator.
export { SIGNAL_ORDER, DEFAULT_WEIGHTS, DISCLAIMER };
export { tokenize };
