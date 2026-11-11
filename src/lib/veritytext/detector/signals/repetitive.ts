// Signal 3 — Repetitive Patterns.
//
// Detects mechanical transitions, repetitive sentence openers, and
// suspiciously uniform paragraph lengths. Flags when:
//   - any listed transition appears >2× per 1000 words, OR
//   - ≥3 consecutive paragraphs have word counts within 15% of each other.
import {
  type Paragraph,
  type Sentence,
} from "../text-utils";
import { type SignalResult, type SignalKey, type TextSpan } from "../types";
import { DEFAULT_WEIGHTS } from "../weights";

const TRANSITIONS = [
  "furthermore",
  "moreover",
  "additionally",
  "in addition",
  "in conclusion",
  "in summary",
  "to summarize",
  "to sum up",
  "consequently",
  "nevertheless",
  "nonetheless",
  "thus",
  "hence",
  "therefore",
  "as a result",
  "it is important to note",
  "it's important to note",
  "it should be noted",
  "in today's world",
  "in todays world",
  "in today's fast-paced world",
  "in the modern world",
  "in the digital age",
  "let's dive in",
  "let us dive in",
  "let's delve",
  "delve deeper",
  "dive deep",
  "dive deeper",
  "firstly",
  "secondly",
  "thirdly",
  "finally",
  "first of all",
  "last but not least",
  "on the other hand",
  "on the flip side",
  "by and large",
  "for the most part",
  "all in all",
  "at the end of the day",
  "when it comes to",
];

export function repetitiveSignal(
  text: string,
  sentences: Sentence[],
  paragraphs: Paragraph[],
  wordCount: number,
): SignalResult {
  const key: SignalKey = "repetitive";
  const weight = DEFAULT_WEIGHTS.repetitive;
  const per1k = 1000 / Math.max(wordCount, 1);

  // Count transitions (case-insensitive).
  const lower = text.toLowerCase();
  const transitionCounts: { phrase: string; count: number }[] = [];
  let totalTransitions = 0;
  for (const t of TRANSITIONS) {
    // Count non-overlapping occurrences.
    let count = 0;
    let idx = lower.indexOf(t);
    while (idx >= 0) {
      count++;
      idx = lower.indexOf(t, idx + t.length);
    }
    if (count > 0) {
      transitionCounts.push({ phrase: t, count });
      totalTransitions += count;
    }
  }
  transitionCounts.sort((a, b) => b.count - a.count);

  // Flag transitions that appear >2× per 1000 words.
  const flaggedTransitions = transitionCounts.filter(
    (t) => t.count * per1k > 2,
  );

  // Repetitive sentence openers: take the first word of each sentence
  // (after stripping leading punctuation), lowercased. AI prose frequently
  // opens with the same connective ("Furthermore", "Moreover", "Additionally").
  const openerCounts: Record<string, number> = {};
  const openerSpans: { opener: string; sentence: Sentence }[] = [];
  for (const s of sentences) {
    const first = s.text
      .trim()
      .replace(/^[^A-Za-z"']*/, "")
      .split(/\s+/)[0]
      ?.toLowerCase()
      .replace(/[^a-z']/g, "");
    if (!first || first.length < 2) continue;
    openerCounts[first] = (openerCounts[first] || 0) + 1;
    openerSpans.push({ opener: first, sentence: s });
  }
  const topOpeners = Object.entries(openerCounts)
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Consecutive paragraphs within 15% word count of each other.
  let maxUniformRun = 0;
  let runStart = 0;
  let curStart = 0;
  let curLen = 1;
  for (let i = 1; i < paragraphs.length; i++) {
    const prev = paragraphs[i - 1].wordCount;
    const cur = paragraphs[i].wordCount;
    if (prev > 0 && Math.abs(cur - prev) / prev <= 0.15) {
      curLen++;
      if (curLen > maxUniformRun) {
        maxUniformRun = curLen;
        runStart = curStart;
      }
    } else {
      curStart = i;
      curLen = 1;
    }
  }

  // Build the AI-likelihood score.
  const transitionDensity = totalTransitions * per1k; // transitions per 1000 words
  const transitionScore = Math.max(0, Math.min(1, (transitionDensity - 2) / 12));
  const openerScore = Math.max(0, Math.min(1, topOpeners.length / 5));
  const paragraphScore = Math.max(0, Math.min(1, (maxUniformRun - 2) / 4));
  const score = transitionScore * 0.5 + openerScore * 0.25 + paragraphScore * 0.25;

  const evidence: string[] = [];
  if (flaggedTransitions.length > 0) {
    evidence.push(
      `Mechanical transitions (over the 2/1000 threshold): ${flaggedTransitions
        .map((t) => `"${t.phrase}" ×${t.count}`)
        .join(", ")}`,
    );
  } else if (transitionCounts.length > 0) {
    evidence.push(
      `Transitions found (below threshold): ${transitionCounts
        .slice(0, 5)
        .map((t) => `"${t.phrase}" ×${t.count}`)
        .join(", ")}`,
    );
  } else {
    evidence.push("No mechanical transitions detected.");
  }
  if (topOpeners.length > 0) {
    evidence.push(
      `Repeated sentence openers: ${topOpeners
        .map(([o, c]) => `"${o}" ×${c}`)
        .join(", ")}`,
    );
  }
  evidence.push(
    `Longest run of similar-length paragraphs: ${maxUniformRun} (within 15% word count).`,
  );

  // Spans for the highlighted view: transitions + repeated openers.
  const spans: TextSpan[] = [];
  for (const t of flaggedTransitions.slice(0, 6)) {
    let idx = lower.indexOf(t.phrase);
    let found = 0;
    while (idx >= 0 && found < 3) {
      spans.push({
        start: idx,
        end: idx + t.phrase.length,
        signal: key,
        label: t.phrase,
      });
      idx = lower.indexOf(t.phrase, idx + t.phrase.length);
      found++;
    }
  }
  for (const [opener, count] of topOpeners.slice(0, 3)) {
    if (count < 2) continue;
    let added = 0;
    for (const o of openerSpans) {
      if (o.opener === opener && added < 3) {
        const end = Math.min(
          o.sentence.start + opener.length,
          o.sentence.end,
        );
        spans.push({
          start: o.sentence.start,
          end,
          signal: key,
          label: "opener",
        });
        added++;
      }
    }
  }

  return {
    key,
    name: "Repetitive Patterns",
    score,
    weight,
    explanation:
      flaggedTransitions.length > 0 || maxUniformRun >= 3
        ? "Mechanical transitions and/or uniform paragraph structure detected."
        : "Sentence and paragraph structure varies naturally.",
    evidence,
    spans,
    metrics: {
      transitionsPer1000: Number(transitionDensity.toFixed(2)),
      totalTransitions,
      flaggedTransitionTypes: flaggedTransitions.length,
      repeatedOpenerTypes: topOpeners.length,
      longestUniformParagraphRun: maxUniformRun,
      paragraphCount: paragraphs.length,
    },
  };
}
