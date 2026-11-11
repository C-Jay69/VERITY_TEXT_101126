// Signal 1 — Perplexity proxy.
//
// True perplexity requires a language model and per-token log-probabilities.
// We use a composite rarity proxy with three sub-metrics:
//   1) std dev of per-sentence rare-fraction (uniformity of vocabulary
//      "rarity" across sentences — AI prose is uniform; human prose varies).
//   2) average token length (a proxy for vocabulary sophistication — AI
//      prose skews toward longer, more "academic" words).
//   3) mean rare-fraction (absolute density of out-of-list tokens; secondary
//      because the bundled frequent-words list is intentionally compact).
// "Rare" tokens are those NOT in: a stopword allow-list, a bundled ~1000-word
// frequent-words list, or the AI-favorite lexicon (so "delve"/"tapestry" do
// not inflate rarity — they're predictable for AI text).
import frequentWords from "../frequent_words.json";
import aiLexicon from "../ai_lexicon.json";
import {
  type SignalResult,
  type TextSpan,
  type SignalKey,
} from "../types";
import {
  type Sentence,
  mean,
  stdDev,
  clamp01,
} from "../text-utils";
import { DEFAULT_WEIGHTS } from "../weights";

const FREQ_SET = new Set<string>(
  (frequentWords as { words: string[] }).words.map((w) => w.toLowerCase()),
);
const AI_SET = new Set<string>(
  (aiLexicon as { words: string[] }).words
    .filter((w) => !w.includes(" "))
    .map((w) => w.toLowerCase()),
);

// Stopwords: highly predictable by design (articles, prepositions, pronouns).
const STOPWORDS = new Set([
  "the","a","an","and","or","but","if","then","of","to","in","on","at","for",
  "with","by","from","as","is","are","was","were","be","been","being","this",
  "that","these","those","it","its","i","you","he","she","we","they","me","him",
  "her","us","them","my","your","his","our","their","not","no","so","do","does",
  "did","done","have","has","had","will","would","can","could","should","may",
  "might","must","than","too","also","just","only","up","out","over","into",
  "about","which","who","whom","whose","what","when","where","why","how","all",
  "any","both","each","few","more","most","other","some","such","nor","own",
  "same","very","shall","let","lets","there","here","off","down","under","again",
  "further","once",
]);

function isCommon(token: string): boolean {
  if (!token) return true;
  if (STOPWORDS.has(token)) return true;
  if (FREQ_SET.has(token)) return true;
  if (AI_SET.has(token)) return true;
  return false;
}

export function perplexitySignal(
  _text: string,
  sentences: Sentence[],
): SignalResult {
  const key: SignalKey = "perplexity";
  const weight = DEFAULT_WEIGHTS.perplexity;

  if (sentences.length === 0) {
    return {
      key,
      name: "Perplexity",
      score: 0.5,
      weight,
      explanation: "No sentences available to analyze.",
      evidence: [],
      metrics: { rareFraction: 0, sentenceCount: 0 },
    };
  }

  // Per-sentence "rare fraction" = fraction of tokens that are NOT common.
  const perSentence = sentences.map((s) => {
    const tokens = s.tokens.filter((t) => t.length > 0);
    if (tokens.length === 0) return { sentence: s, rareFraction: 0 };
    let rare = 0;
    for (const t of tokens) if (!isCommon(t)) rare++;
    return { sentence: s, rareFraction: rare / tokens.length };
  });

  const rareFractions = perSentence.map((p) => p.rareFraction);
  const meanRare = mean(rareFractions);
  const sdRare = stdDev(rareFractions);

  // Average token length across the whole text.
  const allTokens = sentences.flatMap((s) => s.tokens).filter((t) => t.length > 0);
  const avgWordLen = allTokens.length > 0
    ? mean(allTokens.map((t) => t.length))
    : 0;

  // Sub-scores:
  //   sdScore: low std dev → uniform vocabulary → high AI-likelihood.
  //   lenScore: longer avg word length → academic / LLM-favored vocabulary.
  //   meanRareScore: lower rare-fraction → more predictable → AI-likelihood.
  const sdScore = clamp01((0.18 - sdRare) / 0.13);
  const lenScore = clamp01((avgWordLen - 4.5) / 1.5);
  const meanRareScore = clamp01((0.45 - meanRare) / 0.30);

  const score = sdScore * 0.35 + lenScore * 0.45 + meanRareScore * 0.20;

  // Evidence: 5 lowest-rare-fraction sentences (most predictable).
  const sorted = [...perSentence].sort((a, b) => a.rareFraction - b.rareFraction);
  const evidence = sorted
    .slice(0, 5)
    .filter((p) => p.sentence.text.trim().length > 0)
    .map(
      (p) =>
        `[rare-fraction ${p.rareFraction.toFixed(2)}] ${truncate(p.sentence.text, 220)}`,
    );

  // Spans: mark the lowest-rare-fraction sentences in the highlighted view.
  const spans: TextSpan[] = sorted
    .slice(0, 5)
    .map((p) => ({
      start: p.sentence.start,
      end: p.sentence.end,
      signal: key,
      label: "predictable",
    }));

  // Distribution description for the metrics panel.
  const low = rareFractions.filter((r) => r < 0.15).length;
  const mid = rareFractions.filter((r) => r >= 0.15 && r < 0.3).length;
  const high = rareFractions.filter((r) => r >= 0.3).length;

  return {
    key,
    name: "Perplexity",
    score,
    weight,
    explanation:
      score > 0.6
        ? "Word choices are highly predictable — a strong AI signal."
        : score > 0.35
          ? "Word choices skew toward common, predictable vocabulary."
          : "Word choices include enough rare/specific terms to look human.",
    evidence,
    spans,
    metrics: {
      rareFraction: Number(meanRare.toFixed(3)),
      rareFractionStdDev: Number(sdRare.toFixed(3)),
      avgWordLength: Number(avgWordLen.toFixed(2)),
      sentenceCount: sentences.length,
      lowRareSentences: low,
      midRareSentences: mid,
      highRareSentences: high,
    },
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
