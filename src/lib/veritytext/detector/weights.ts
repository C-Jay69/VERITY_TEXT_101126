// Default signal weights for the VerityText detection engine.
// These are intentionally NOT dominated by any single signal — detection
// is always a weighted cluster, never a single-signal verdict.
// Edit this file to tune the engine. Weights need not sum to 1; they are
// normalized at aggregate time. See methodology.md for the rationale.

export interface SignalWeights {
  perplexity: number;
  burstiness: number;
  repetitive: number;
  vocabulary: number;
  specificity: number;
  tone: number;
  fingerprints: number;
}

export const DEFAULT_WEIGHTS: SignalWeights = {
  perplexity: 0.2,
  burstiness: 0.2,
  repetitive: 0.15,
  vocabulary: 0.15,
  specificity: 0.15,
  tone: 0.1,
  fingerprints: 0.05,
};

export const SIGNAL_NAMES = [
  "perplexity",
  "burstiness",
  "repetitive",
  "vocabulary",
  "specificity",
  "tone",
  "fingerprints",
] as const;

export type SignalKey = (typeof SIGNAL_NAMES)[number];

export const SIGNAL_LABELS: Record<SignalKey, string> = {
  perplexity: "Perplexity",
  burstiness: "Burstiness",
  repetitive: "Repetitive Patterns",
  vocabulary: "Generic Vocabulary",
  specificity: "Lack of Specificity",
  tone: "Uniform Tone",
  fingerprints: "Statistical Fingerprints",
};

export const SIGNAL_ORDER: SignalKey[] = [
  "perplexity",
  "burstiness",
  "repetitive",
  "vocabulary",
  "specificity",
  "tone",
  "fingerprints",
];
