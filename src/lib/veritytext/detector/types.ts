// Shared types for the VerityText detection engine.

export interface SignalResult {
  /** Internal signal key (e.g. "perplexity"). */
  key: SignalKey;
  /** Human-readable label. */
  name: string;
  /** AI-likelihood score 0..1 (1 = very likely AI). */
  score: number;
  /** Weight used in the aggregate (pre-normalization). */
  weight: number;
  /** Short one-line explanation shown on the card. */
  explanation: string;
  /** Evidence snippets (sentences / phrases) supporting the score. */
  evidence: string[];
  /** Optional set of structured sub-metrics for the methodology view. */
  metrics?: Record<string, number | string>;
  /** Whether this signal is intrinsically weak/probabilistic (e.g. fingerprints). */
  weak?: boolean;
  /** Spans (character offsets) used by the highlighted-text view. */
  spans?: TextSpan[];
}

export interface TextSpan {
  /** Inclusive start offset in the analyzed text. */
  start: number;
  /** Exclusive end offset in the analyzed text. */
  end: number;
  /** Which signal produced this span. */
  signal: SignalKey;
  /** Short label for the margin tag (e.g. "delve"). */
  label?: string;
}

export interface AggregateResult {
  /** 0..100 integer AI probability. */
  aiProbability: number;
  /** Band label, e.g. "Likely AI". */
  verdict: string;
  /** Band machine key, e.g. "likely-ai". */
  band: BandKey;
  /** Confidence in the verdict (0..100). Heuristic. */
  confidence: number;
  /** True if only a single signal was high → verdict downgraded one band. */
  singleSignalTrigger: boolean;
  /** True if the text was very short (50–200 words). */
  lowConfidence: boolean;
  /** True if the text was truncated at MAX_ANALYZED_CHARS. */
  partialAnalysis: boolean;
  /** Notes (e.g. "single-signal trigger — low confidence"). */
  notes: string[];
}

export type BandKey =
  | "human"
  | "likely-human"
  | "mixed"
  | "likely-ai"
  | "very-likely-ai";

export interface DetectionReport {
  signals: SignalResult[];
  aggregate: AggregateResult;
  meta: {
    extractedLength: number;
    analyzedLength: number;
    wordCount: number;
    sentenceCount: number;
    partialAnalysis: boolean;
    lowConfidence: boolean;
    mixedLanguage: boolean;
    warnings: string[];
  };
  disclaimer: string;
  timestamp: string;
}

export type SignalKey =
  | "perplexity"
  | "burstiness"
  | "repetitive"
  | "vocabulary"
  | "specificity"
  | "tone"
  | "fingerprints";

export const DISCLAIMER =
  "Detection is a statistical heuristic. False positives and false negatives occur. Do not use as sole evidence in academic, legal, or employment decisions.";

export const BANDS: { key: BandKey; min: number; max: number; label: string }[] = [
  { key: "human", min: 0, max: 20, label: "Human" },
  { key: "likely-human", min: 21, max: 40, label: "Likely Human" },
  { key: "mixed", min: 41, max: 60, label: "Mixed / Uncertain" },
  { key: "likely-ai", min: 61, max: 80, label: "Likely AI" },
  { key: "very-likely-ai", min: 81, max: 100, label: "Very Likely AI" },
];

export function bandFor(probability: number): { key: BandKey; label: string } {
  for (const b of BANDS) {
    if (probability >= b.min && probability <= b.max) {
      return { key: b.key, label: b.label };
    }
  }
  // Should never happen, but guard anyway.
  return { key: "mixed", label: "Mixed / Uncertain" };
}

/**
 * Downgrade a band by one step. Used for the single-signal rule.
 */
export function downgradeBand(key: BandKey): BandKey {
  const order: BandKey[] = [
    "very-likely-ai",
    "likely-ai",
    "mixed",
    "likely-human",
    "human",
  ];
  const idx = order.indexOf(key);
  if (idx < 0) return key;
  return order[Math.min(order.length - 1, idx + 1)];
}
