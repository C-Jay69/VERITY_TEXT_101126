// Signal 4 — Generic Vocabulary / AI-Favorite Words.
//
// Counts occurrences of a curated lexicon of words LLMs over-use (delve,
// tapestry, leverage, robust, etc.). Score = frequency per 1000 words,
// normalized.
import aiLexicon from "../ai_lexicon.json";
import { type SignalResult, type SignalKey, type TextSpan } from "../types";
import { tokenize } from "../text-utils";
import { DEFAULT_WEIGHTS } from "../weights";

const LEXICON: string[] = (aiLexicon as { words: string[] }).words;

export function vocabularySignal(
  text: string,
  wordCount: number,
): SignalResult {
  const key: SignalKey = "vocabulary";
  const weight = DEFAULT_WEIGHTS.vocabulary;
  const per1k = 1000 / Math.max(wordCount, 1);

  const lower = text.toLowerCase();
  const matches: { phrase: string; count: number; sentences: string[] }[] = [];

  // Split into sentences to attribute hits.
  const sentenceBuckets = splitForEvidence(text);

  for (const phrase of LEXICON) {
    // For single-word entries, match word-boundary; for phrases, substring.
    let count = 0;
    let idx = lower.indexOf(phrase);
    const hitSentences = new Set<string>();
    while (idx >= 0) {
      count++;
      const containing = sentenceContainingOffset(sentenceBuckets, idx);
      if (containing) hitSentences.add(containing.text);
      idx = lower.indexOf(phrase, idx + phrase.length);
    }
    if (count > 0) {
      matches.push({
        phrase,
        count,
        sentences: Array.from(hitSentences).slice(0, 2),
      });
    }
  }

  matches.sort((a, b) => b.count - a.count);
  const totalMatches = matches.reduce((acc, m) => acc + m.count, 0);
  const density = totalMatches * per1k;

  // Normalize: 0 matches/1k → 0; 8+/1k → 1 (clearly saturated).
  const score = Math.max(0, Math.min(1, density / 8));

  const evidence: string[] = [];
  if (matches.length === 0) {
    evidence.push("No AI-favorite words detected.");
  } else {
    for (const m of matches.slice(0, 8)) {
      const sent = m.sentences[0] ? ` — e.g. "${truncate(m.sentences[0], 140)}"` : "";
      evidence.push(`"${m.phrase}" ×${m.count}${sent}`);
    }
  }

  const spans: TextSpan[] = [];
  for (const m of matches.slice(0, 12)) {
    let idx = lower.indexOf(m.phrase);
    let found = 0;
    while (idx >= 0 && found < 4) {
      spans.push({
        start: idx,
        end: idx + m.phrase.length,
        signal: key,
        label: m.phrase,
      });
      idx = lower.indexOf(m.phrase, idx + m.phrase.length);
      found++;
    }
  }

  return {
    key,
    name: "Generic Vocabulary",
    score,
    weight,
    explanation:
      density > 6
        ? "Heavy use of AI-favorite vocabulary (delve, tapestry, robust…)."
        : density > 2
          ? "Some AI-favorite vocabulary present."
          : "Vocabulary avoids the common AI-favorite word list.",
    evidence,
    spans,
    metrics: {
      matchesPer1000: Number(density.toFixed(2)),
      totalMatches,
      distinctLexiconHits: matches.length,
      lexiconSize: LEXICON.length,
    },
  };
}

interface Bucket {
  start: number;
  end: number;
  text: string;
}

function splitForEvidence(text: string): Bucket[] {
  const re = /[^.!?]+[.!?]+|\S[^.!?]*$/g;
  const buckets: Bucket[] = [];
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(text)) !== null) {
    const start = text.indexOf(m[0], last);
    if (start < 0) continue;
    buckets.push({ start, end: start + m[0].length, text: m[0].trim() });
    last = start + m[0].length;
  }
  return buckets;
}

function sentenceContainingOffset(
  buckets: Bucket[],
  offset: number,
): Bucket | null {
  for (const b of buckets) {
    if (offset >= b.start && offset < b.end) return b;
  }
  return null;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// Re-export so other modules can grab the lexicon if needed.
export { LEXICON, tokenize };
