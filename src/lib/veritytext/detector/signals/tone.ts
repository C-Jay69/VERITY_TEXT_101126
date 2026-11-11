// Signal 6 — Uniform Tone.
//
// AI prose tends toward a flat, formal register: consistent sentiment, few
// contractions, no questions/exclamations, no hedges or self-correction.
// We measure:
//   - sentiment polarity variance (per-sentence, lexicon-based)
//   - formality index (contractions ratio, pronoun ratio, avg word length,
//     absence of intensifiers/hedges/exclamations/questions)
//   - emotional flatness
// High "flat-formal" → higher AI-likelihood.
import sentimentLexicon from "../sentiment_lexicon.json";
import {
  type Sentence,
  mean,
  stdDev,
  coefficientOfVariation,
} from "../text-utils";
import { type SignalResult, type SignalKey, type TextSpan } from "../types";
import { DEFAULT_WEIGHTS } from "../weights";

const POS = new Set((sentimentLexicon as { positive: string[] }).positive);
const NEG = new Set((sentimentLexicon as { negative: string[] }).negative);
const INTENSIFIERS = new Set(
  (sentimentLexicon as { intensifiers: string[] }).intensifiers,
);
const HEDGES = new Set((sentimentLexicon as { hedging: string[] }).hedging);

function sentencePolarity(sentence: string): number {
  const tokens = (sentence.toLowerCase().match(/[a-z']+/g)) ?? [];
  if (tokens.length === 0) return 0;
  let pos = 0;
  let neg = 0;
  for (const t of tokens) {
    if (POS.has(t)) pos++;
    if (NEG.has(t)) neg++;
  }
  return (pos - neg) / tokens.length; // -1..1
}

export function toneSignal(
  text: string,
  sentences: Sentence[],
): SignalResult {
  const key: SignalKey = "tone";
  const weight = DEFAULT_WEIGHTS.tone;

  if (sentences.length < 2) {
    return {
      key,
      name: "Uniform Tone",
      score: 0.5,
      weight,
      explanation: "Not enough sentences to measure tone variation.",
      evidence: [],
      metrics: {},
    };
  }

  // Per-sentence polarity.
  const polarities = sentences.map((s) => sentencePolarity(s.text));
  const polarityStdDev = stdDev(polarities);
  const polarityCV = coefficientOfVariation(polarities.map((p) => p + 2)); // shift to avoid div-by-zero

  // Formality index.
  const lower = text.toLowerCase();
  const tokens = lower.match(/[a-z'’-]+/g) ?? [];
  const totalTokens = Math.max(tokens.length, 1);
  const contractionMatches = lower.match(/\b\w+'(t|s|re|ve|ll|d|m)\b/g) ?? [];
  const contractionsRatio = contractionMatches.length / totalTokens;
  const firstPersonPronouns = (lower.match(/\b(i|me|my|mine|we|us|our|ours)\b/g) ?? []).length;
  const pronounRatio = firstPersonPronouns / totalTokens;
  const wordLens = tokens.map((t) => t.length);
  const avgWordLen = mean(wordLens);

  // Emotional flatness markers.
  const exclamations = (text.match(/!/g) ?? []).length;
  const questions = (text.match(/\?/g) ?? []).length;
  const hedgeMatches = tokens.filter((t) => HEDGES.has(t)).length;
  const intensifierMatches = tokens.filter((t) => INTENSIFIERS.has(t)).length;
  const selfCorrection = (text.match(/\([^)]*(?:actually|well|or rather|sorry|wait)\)/gi) ?? []).length;
  const fragments = sentences.filter((s) => s.tokenCount <= 4).length;

  // Build scores. Lower polarity variance + high formality + low emotional
  // markers → higher AI-likelihood.
  // Polarity std dev: human prose typically > 0.06; AI prose often < 0.04.
  const polarityScore = Math.max(0, Math.min(1, (0.08 - polarityStdDev) / 0.08));
  // Formality: low contractions + low first-person + longer words → more formal.
  const formality =
    (1 - Math.min(1, contractionsRatio * 50)) * 0.4 +
    (1 - Math.min(1, pronounRatio * 20)) * 0.3 +
    Math.min(1, avgWordLen / 6) * 0.3;
  const formalityScore = Math.max(0, Math.min(1, (formality - 0.5) / 0.5));
  // Flatness: absence of exclamations/questions/hedges/intensifiers/self-correction.
  const emotionalMarkers =
    exclamations + questions + hedgeMatches + intensifierMatches + selfCorrection + fragments;
  const markersPer1k = emotionalMarkers / (totalTokens / 1000);
  const flatnessScore = Math.max(0, Math.min(1, 1 - markersPer1k / 8));

  const score = polarityScore * 0.4 + formalityScore * 0.35 + flatnessScore * 0.25;

  // Spans: mark sentences with extreme (flat-zero) polarity if the overall
  // tone is uniform.
  const spans: TextSpan[] = [];
  if (polarityStdDev < 0.04) {
    // Tag the first few "neutral" sentences.
    let added = 0;
    for (let i = 0; i < sentences.length && added < 4; i++) {
      if (Math.abs(polarities[i]) < 0.02) {
        spans.push({
          start: sentences[i].start,
          end: sentences[i].end,
          signal: key,
          label: "flat tone",
        });
        added++;
      }
    }
  }

  const evidence: string[] = [
    `Sentiment polarity std dev: ${polarityStdDev.toFixed(4)} (coefficient of variation ${polarityCV.toFixed(3)}).`,
    `Contractions ratio: ${(contractionsRatio * 100).toFixed(2)}%. First-person pronouns: ${firstPersonPronouns} (${(pronounRatio * 100).toFixed(2)}%).`,
    `Average word length: ${avgWordLen.toFixed(2)} chars.`,
    `Emotional markers: exclamations=${exclamations}, questions=${questions}, hedges=${hedgeMatches}, intensifiers=${intensifierMatches}, self-corrections=${selfCorrection}, fragments=${fragments}.`,
  ];

  return {
    key,
    name: "Uniform Tone",
    score,
    weight,
    explanation:
      polarityStdDev < 0.03 && emotionalMarkers < 4
        ? "Tone is flat and formal — typical of AI prose."
        : polarityStdDev < 0.05
          ? "Tone varies little across sentences."
          : "Tone varies naturally across the text.",
    evidence,
    spans,
    metrics: {
      polarityStdDev: Number(polarityStdDev.toFixed(4)),
      contractionsPer1000: Number((contractionsRatio * 50000).toFixed(2)),
      firstPersonPer1000: Number((pronounRatio * 50000).toFixed(2)),
      avgWordLength: Number(avgWordLen.toFixed(2)),
      emotionalMarkersPer1000: Number(markersPer1k.toFixed(2)),
      formalityIndex: Number(formality.toFixed(3)),
    },
  };
}
