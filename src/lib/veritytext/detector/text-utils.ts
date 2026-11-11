// Shared text-analysis helpers used by the detector signals.
import nlp from "compromise";

export interface Sentence {
  text: string;
  /** Start offset in the parent text. */
  start: number;
  /** End offset (exclusive). */
  end: number;
  /** Token count (rough word count). */
  tokenCount: number;
  tokens: string[];
}

export interface Paragraph {
  text: string;
  start: number;
  end: number;
  wordCount: number;
}

const SENTENCE_BOUNDARY = /[^.!?]+[.!?]+(?:["')\]]+)?|\S[^.!?]*$/g;

/**
 * Split text into sentences with character offsets. Uses a regex first pass
 * then refines with compromise for robustness.
 */
export function splitSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  const trimmed = text;
  let match: RegExpExecArray | null;
  SENTENCE_BOUNDARY.lastIndex = 0;
  let lastEnd = 0;
  while ((match = SENTENCE_BOUNDARY.exec(trimmed)) !== null) {
    const raw = match[0];
    if (!raw) continue;
    // Find the actual start offset of this slice in the source.
    const start = trimmed.indexOf(raw, lastEnd);
    if (start < 0) continue;
    const end = start + raw.length;
    lastEnd = end;
    const clean = raw.trim();
    if (!clean) continue;
    const tokens = tokenize(clean);
    sentences.push({
      text: clean,
      start,
      end,
      tokenCount: tokens.length,
      tokens,
    });
  }
  // Fallback: if regex produced nothing, treat the whole text as one sentence.
  if (sentences.length === 0 && text.trim().length > 0) {
    const tokens = tokenize(text);
    sentences.push({
      text: text.trim(),
      start: 0,
      end: text.length,
      tokenCount: tokens.length,
      tokens,
    });
  }
  return sentences;
}

export function splitParagraphs(text: string): Paragraph[] {
  const parts = text.split(/\n\s*\n/);
  const paragraphs: Paragraph[] = [];
  let cursor = 0;
  for (const part of parts) {
    if (!part.trim()) {
      cursor += part.length + 2;
      continue;
    }
    const start = text.indexOf(part, cursor);
    if (start < 0) {
      cursor += part.length + 2;
      continue;
    }
    const end = start + part.length;
    cursor = end + 2;
    paragraphs.push({
      text: part.trim(),
      start,
      end,
      wordCount: tokenize(part).length,
    });
  }
  return paragraphs.filter((p) => p.wordCount > 0);
}

export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9'’-]+/g);
  return matches ?? [];
}

export function wordCount(text: string): number {
  return tokenize(text).length;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance =
    values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function coefficientOfVariation(values: number[]): number {
  const m = mean(values);
  if (m === 0) return 0;
  return stdDev(values) / m;
}

/**
 * Returns a Set of frequent words for O(1) lookups.
 */
export function buildFrequentWordSet(words: string[]): Set<string> {
  const set = new Set<string>();
  for (const w of words) set.add(w.toLowerCase());
  return set;
}

/**
 * Use compromise to classify a sentence as simple/compound/complex/compound-complex.
 * Heuristic based on clauses and conjunctions.
 */
export function classifySentence(sentence: string): {
  type: "simple" | "compound" | "complex" | "compound-complex" | "fragment";
  clauses: number;
} {
  const doc = nlp(sentence);
  const clauses = doc.clauses().length;
  const hasCommaConjunction = /,\s*(and|but|or|so|yet|for|nor)\s/i.test(
    sentence,
  );
  const hasSubordinating =
    /\b(because|although|though|since|unless|while|whereas|if|whether|after|before|when|whenever|where|wherever|as|until|once|provided)\b/i.test(
      sentence,
    );
  if (clauses <= 1 && !hasSubordinating && !hasCommaConjunction) {
    return { type: "simple", clauses: 1 };
  }
  if (hasSubordinating && hasCommaConjunction) {
    return { type: "compound-complex", clauses: Math.max(clauses, 2) };
  }
  if (hasSubordinating) return { type: "complex", clauses: Math.max(clauses, 2) };
  if (hasCommaConjunction) return { type: "compound", clauses: 2 };
  return { type: "simple", clauses: 1 };
}

/**
 * Extract named entities using compromise. Returns normalized strings.
 * compromise v14's core build exposes people / organizations / places /
 * values out of the box; `.dates()` requires a plugin we don't ship, so we
 * leave `dates` empty here and let the specificity signal detect dates via
 * its own regex.
 */
export function extractEntities(text: string): {
  people: string[];
  organizations: string[];
  places: string[];
  dates: string[];
  values: string[];
} {
  const doc = nlp(text);
  // Some compromise builds expose `.dates()` / `.values()`, others don't.
  // Guard both so a missing helper degrades to an empty list rather than a
  // runtime TypeError.
  const docAny = doc as unknown as {
    dates?: () => { out: (m: string) => string[] };
    values?: () => { out: (m: string) => string[] };
  };
  const datesOut: string[] =
    typeof docAny.dates === "function" ? docAny.dates().out("array") : [];
  const valuesOut: string[] =
    typeof docAny.values === "function" ? docAny.values().out("array") : [];
  return {
    people: doc.people().out("array"),
    organizations: doc.organizations().out("array"),
    places: doc.places().out("array"),
    dates: datesOut,
    values: valuesOut,
  };
}

/**
 * Clamp a number into [0, 1].
 */
export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/**
 * Linearly map x from [inMin, inMax] to [outMin, outMax], clamped to the
 * output range.
 */
export function mapRange(
  x: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  if (inMax === inMin) return outMin;
  const t = (x - inMin) / (inMax - inMin);
  return clamp01(outMin + t * (outMax - outMin));
}
