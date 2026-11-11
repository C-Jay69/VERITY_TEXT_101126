// Signal 7 — Statistical Fingerprints (heuristic only, always labeled weak).
//
// This signal is probabilistic and never cited as proof. We look for:
//   - abnormally uniform punctuation spacing
//   - suspiciously regular paragraph-transition entropy
//   - repetitive token-length distributions
//   - known watermark-style token patterns (high repetition of specific
//     punctuation-to-word ratios)
import {
  type Paragraph,
  type Sentence,
  mean,
  stdDev,
  coefficientOfVariation,
} from "../text-utils";
import { type SignalResult, type SignalKey, type TextSpan } from "../types";
import { DEFAULT_WEIGHTS } from "../weights";

export function fingerprintsSignal(
  text: string,
  sentences: Sentence[],
  paragraphs: Paragraph[],
): SignalResult {
  const key: SignalKey = "fingerprints";
  const weight = DEFAULT_WEIGHTS.fingerprints;

  // 1) Punctuation spacing uniformity: ratio of (punctuation chars) / words.
  const punct = (text.match(/[.,;:!?]/g) ?? []).length;
  const wordCt = Math.max(
    (text.toLowerCase().match(/[a-z0-9'’-]+/g) ?? []).length,
    1,
  );
  const punctRatio = punct / wordCt;

  // 2) Per-paragraph punctuation-ratio uniformity.
  const perParaRatios = paragraphs.map((p) => {
    const pPunct = (p.text.match(/[.,;:!?]/g) ?? []).length;
    const pWords = Math.max(
      (p.text.toLowerCase().match(/[a-z0-9'’-]+/g) ?? []).length,
      1,
    );
    return pPunct / pWords;
  });
  const punctRatioCV = coefficientOfVariation(perParaRatios);

  // 3) Sentence-token-length entropy (lower entropy = more uniform = more AI-like).
  const lengths = sentences.map((s) => s.tokenCount);
  const lenMean = mean(lengths);
  const lenSD = stdDev(lengths);
  const lenCV = coefficientOfVariation(lengths);

  // 4) First-word diversity (LLMs over-start with the same word).
  const firstWords = sentences.map((s) => {
    const t = s.text.trim().split(/\s+/);
    return t[0]?.toLowerCase() ?? "";
  });
  const distinctFirstWords = new Set(firstWords.filter(Boolean)).size;
  const firstWordDiversity =
    firstWords.length > 0 ? distinctFirstWords / firstWords.length : 1;

  // 5) Bigram repetition: how many bigrams repeat >2 times.
  const tokens = (text.toLowerCase().match(/[a-z0-9'’-]+/g)) ?? [];
  const bigramCounts: Record<string, number> = {};
  for (let i = 0; i < tokens.length - 1; i++) {
    const bg = `${tokens[i]} ${tokens[i + 1]}`;
    bigramCounts[bg] = (bigramCounts[bg] || 0) + 1;
  }
  const repeatedBigrams = Object.values(bigramCounts).filter((c) => c > 2).length;
  const bigramRepetitionRatio = repeatedBigrams / Math.max(Object.keys(bigramCounts).length, 1);

  // Compose score (always capped low because this is weak/probabilistic).
  const punctScore = Math.max(0, Math.min(1, 1 - punctRatioCV * 2)); // uniform punct → high
  const lengthScore = Math.max(0, Math.min(1, (0.4 - lenCV) / 0.4));
  const firstWordScore = Math.max(0, Math.min(1, 1 - firstWordDiversity));
  const bigramScore = Math.max(0, Math.min(1, bigramRepetitionRatio * 4));
  let score =
    punctScore * 0.25 + lengthScore * 0.3 + firstWordScore * 0.25 + bigramScore * 0.2;
  // Cap at 0.7 because this signal is weak/probabilistic.
  score = Math.min(0.7, score);

  const anomalies: string[] = [];
  if (punctRatioCV < 0.15 && paragraphs.length > 2)
    anomalies.push(
      `Punctuation-to-word ratio is suspiciously uniform across paragraphs (CV=${punctRatioCV.toFixed(3)}).`,
    );
  if (lenCV < 0.25 && sentences.length > 4)
    anomalies.push(
      `Sentence token-length distribution is abnormally uniform (CV=${lenCV.toFixed(3)}).`,
    );
  if (firstWordDiversity < 0.5 && sentences.length > 5)
    anomalies.push(
      `Low first-word diversity (${(firstWordDiversity * 100).toFixed(0)}%) — sentences open with few distinct words.`,
    );
  if (bigramRepetitionRatio > 0.05)
    anomalies.push(
      `Elevated bigram repetition (${(bigramRepetitionRatio * 100).toFixed(1)}% of bigrams appear >2×).`,
    );
  if (anomalies.length === 0)
    anomalies.push("No strong statistical anomalies detected.");

  const evidence: string[] = [
    `Punctuation-to-word ratio: ${punctRatio.toFixed(3)} (CV across paragraphs: ${punctRatioCV.toFixed(3)}).`,
    `Sentence token-length CV: ${lenCV.toFixed(3)} (mean=${lenMean.toFixed(1)}, sd=${lenSD.toFixed(1)}).`,
    `First-word diversity: ${(firstWordDiversity * 100).toFixed(1)}%.`,
    `Repeated bigrams (>2×): ${repeatedBigrams} (${(bigramRepetitionRatio * 100).toFixed(1)}% of unique bigrams).`,
    ...anomalies.slice(0, 2),
  ];

  const spans: TextSpan[] = [];
  // No specific text spans for fingerprints — it's a global signal. We tag
  // the most uniform-paragraph region if it exists.
  if (punctRatioCV < 0.15 && paragraphs.length > 0) {
    const mid = paragraphs[Math.floor(paragraphs.length / 2)];
    if (mid) {
      spans.push({
        start: mid.start,
        end: mid.end,
        signal: key,
        label: "uniform structure",
      });
    }
  }

  return {
    key,
    name: "Statistical Fingerprints",
    score,
    weight,
    weak: true,
    explanation:
      "Weak/probabilistic signal. " +
      (anomalies.length > 1
        ? "Several statistical anomalies present."
        : "No strong statistical anomalies."),
    evidence,
    spans,
    metrics: {
      punctRatio: Number(punctRatio.toFixed(3)),
      punctRatioCV: Number(punctRatioCV.toFixed(3)),
      sentenceLenCV: Number(lenCV.toFixed(3)),
      firstWordDiversity: Number(firstWordDiversity.toFixed(3)),
      repeatedBigramRatio: Number(bigramRepetitionRatio.toFixed(3)),
    },
  };
}
