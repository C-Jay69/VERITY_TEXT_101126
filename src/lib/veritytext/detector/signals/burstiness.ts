// Signal 2 — Burstiness.
//
// Humans write with erratic sentence-length variation and structural diversity.
// LLMs tend toward uniform sentence lengths and a flat mix of structure types.
// We measure:
//   - std dev of sentence token counts
//   - coefficient of variation (CV)
//   - structural diversity index (simple/compound/complex mix)
// Low burstiness → higher AI-likelihood.
import {
  type Sentence,
  classifySentence,
  coefficientOfVariation,
  stdDev,
  mean,
} from "../text-utils";
import { type SignalResult, type SignalKey, type TextSpan } from "../types";
import { DEFAULT_WEIGHTS } from "../weights";

export function burstinessSignal(
  _text: string,
  sentences: Sentence[],
): SignalResult {
  const key: SignalKey = "burstiness";
  const weight = DEFAULT_WEIGHTS.burstiness;

  if (sentences.length < 2) {
    return {
      key,
      name: "Burstiness",
      score: 0.5,
      weight,
      explanation: "Not enough sentences to measure variation.",
      evidence: [],
      metrics: { sentenceCount: sentences.length },
    };
  }

  const lengths = sentences.map((s) => s.tokenCount);
  const cv = coefficientOfVariation(lengths);
  const sd = stdDev(lengths);
  const m = mean(lengths);

  // Structural diversity: how many distinct structure types are used and
  // how evenly they're distributed.
  const types = sentences.map((s) => classifySentence(s.text).type);
  const counts: Record<string, number> = {};
  for (const t of types) counts[t] = (counts[t] || 0) + 1;
  const distinctTypes = Object.keys(counts).length;
  const total = sentences.length;
  // Evenness via 1 - normalized Herfindahl index.
  const herfindahl =
    Object.values(counts).reduce((acc, c) => acc + (c / total) ** 2, 0) || 1;
  const evenness = 1 - herfindahl; // 0 = one type dominates, →1 = perfectly mixed

  // Longest run of sentences within ±2 tokens of each other (mechanical run).
  let bestRun = 1;
  let curRun = 1;
  for (let i = 1; i < lengths.length; i++) {
    if (Math.abs(lengths[i] - lengths[i - 1]) <= 2) {
      curRun++;
      bestRun = Math.max(bestRun, curRun);
    } else {
      curRun = 1;
    }
  }

  // AI-likelihood score: low CV + low evenness + long mechanical runs → high.
  // CV thresholds: human prose typically CV > 0.45; AI prose often 0.15–0.35.
  const cvScore = Math.max(0, Math.min(1, (0.5 - cv) / 0.4));
  const evennessScore = Math.max(0, Math.min(1, 1 - evenness));
  const runScore = Math.max(0, Math.min(1, (bestRun - 2) / 6));
  const score = cvScore * 0.55 + evennessScore * 0.25 + runScore * 0.2;

  // Evidence: histogram description + the longest mechanical run.
  const histogram = buildHistogram(lengths);
  const runEvidence = findRunSentences(sentences, lengths);

  const evidence: string[] = [
    `Sentence-length distribution: ${histogram}`,
    `Longest mechanical run (sentences within ±2 tokens): ${bestRun} consecutive.`,
  ];
  if (runEvidence.length > 0) {
    evidence.push(
      `Most repetitive run: "${truncate(runEvidence[0].text, 180)}"`,
    );
  }
  evidence.push(
    `Structure mix: ${Object.entries(counts)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}`,
  );

  const spans: TextSpan[] = runEvidence.slice(0, 3).map((s) => ({
    start: s.start,
    end: s.end,
    signal: key,
    label: "uniform",
  }));

  return {
    key,
    name: "Burstiness",
    score,
    weight,
    explanation:
      cv < 0.25
        ? "Sentence lengths are very uniform — a strong AI signal."
        : cv < 0.45
          ? "Sentence-length variation is low."
          : "Sentence lengths vary naturally.",
    evidence,
    spans,
    metrics: {
      meanSentenceLength: Number(m.toFixed(2)),
      stdDev: Number(sd.toFixed(2)),
      coefficientOfVariation: Number(cv.toFixed(3)),
      distinctStructureTypes: distinctTypes,
      evenness: Number(evenness.toFixed(3)),
      longestMechanicalRun: bestRun,
    },
  };
}

function buildHistogram(lengths: number[]): string {
  const buckets = [0, 0, 0, 0, 0, 0];
  for (const l of lengths) {
    if (l <= 5) buckets[0]++;
    else if (l <= 10) buckets[1]++;
    else if (l <= 15) buckets[2]++;
    else if (l <= 20) buckets[3]++;
    else if (l <= 30) buckets[4]++;
    else buckets[5]++;
  }
  const labels = ["1-5", "6-10", "11-15", "16-20", "21-30", "31+"];
  return labels
    .map((l, i) => `${l}: ${buckets[i]}`)
    .join("  |  ");
}

function findRunSentences(
  sentences: Sentence[],
  lengths: number[],
): Sentence[] {
  let bestStart = 0;
  let bestLen = 1;
  let curStart = 0;
  let curLen = 1;
  for (let i = 1; i < lengths.length; i++) {
    if (Math.abs(lengths[i] - lengths[i - 1]) <= 2) {
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = i;
      curLen = 1;
    }
  }
  return sentences.slice(bestStart, bestStart + bestLen);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
