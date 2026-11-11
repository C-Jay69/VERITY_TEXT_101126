// VerityText humanizer engine — uses z-ai-web-dev-sdk server-side only.
//
// Builds a tightly engineered system prompt that inverts each detected signal,
// then calls the LLM. Wraps in try/catch; on failure returns the original
// text with an error so the UI can surface a banner. Never returns blank.
import ZAI from "z-ai-web-dev-sdk";
import { type DetectionReport, type SignalResult } from "./detector/types";

export interface HumanizeOptions {
  strength: "light" | "balanced" | "strong";
  tone: "original" | "casual" | "academic" | "professional";
  preserve: string[]; // "citations", "names", "dates", "quotes"
}

export interface HumanizeResult {
  text: string;
  error?: string;
  warning?: string;
}

const BASE_PROMPT = `You are an expert human editor. Rewrite the following text so it reads as genuinely human-written, while preserving ALL facts, citations, names, dates, numbers, quotes, and the original meaning and language. Do NOT add or invent information. Do NOT remove substantive content.

Apply these revisions, in priority order based on the detection report:
1. PERPLEXITY: Replace predictable, generic word choices with varied, specific, occasionally surprising vocabulary. Avoid the most statistically likely next word.
2. BURSTINESS: Vary sentence length aggressively. Mix very short punchy sentences (3–7 words) with longer complex ones (20+ words). Occasionally use fragments.
3. REPETITIVE PATTERNS: Eliminate mechanical transitions ("Furthermore", "Moreover", "In conclusion", "Additionally"). Replace with natural connectives or omit them. Vary paragraph lengths deliberately.
4. GENERIC VOCABULARY: Never use these words: [inject flagged AI-favorite words]. Replace with concrete, specific alternatives.
5. LACK OF SPECIFICITY: Where the original is vague, do NOT invent specifics, but restructure sentences to foreground whatever concrete details already exist. Add natural first-person framing only where the source text already implies a perspective.
6. UNIFORM TONE: Introduce natural tone variation — occasional informality, a question, a hedging phrase, mild subjectivity, an aside. Allow minor, natural imperfections (a sentence starting with "And" or "But", a conversational aside in parentheses). Do NOT introduce errors that damage credibility.
7. PRESERVE EXACTLY (never alter): all proper nouns, dates, numbers, statistics, direct quotes and their attributions, citations, and any code or formulas.

Output ONLY the rewritten text. No preamble, no commentary.`;

const STRENGTH_DIRECTIVES: Record<HumanizeOptions["strength"], string> = {
  light:
    "Apply revisions conservatively. Keep the original voice mostly intact. Change roughly 10–15% of the wording.",
  balanced:
    "Apply revisions at a moderate level. Restructure ~25% of sentences and replace ~30% of generic wording.",
  strong:
    "Apply revisions aggressively. Restructure the majority of sentences, replace all generic vocabulary, introduce clear tone variation. Target a detection-score reduction of at least 15 points.",
};

const TONE_DIRECTIVES: Record<HumanizeOptions["tone"], string> = {
  original: "Match the original tone.",
  casual:
    "Lean toward a casual, conversational tone — contractions, occasional informality, lighter punctuation.",
  academic:
    "Lean toward a measured academic tone — precise vocabulary, hedged claims, but still vary sentence length and avoid generic transitions.",
  professional:
    "Lean toward a clean professional tone — direct, active voice, no fluff — but still vary sentence length and avoid generic transitions.",
};

const PRESERVE_DIRECTIVES: Record<string, string> = {
  citations: "Preserve every citation verbatim, including any (Author, Year) or footnote-style references.",
  names: "Preserve every proper noun (people, organizations, places) verbatim.",
  dates: "Preserve every date and number verbatim.",
  quotes: "Preserve every direct quote (text inside quotation marks) verbatim, including its attribution.",
};

const ACCEPTABLE_USE_REFUSAL =
  "This text appears to be intended for deceptive academic submission. VerityText will not humanize text marked as the submitter's own original work when it is clearly destined for assignment submission. If you are editing your own draft for clarity, remove statements like \"I personally wrote this\" combined with submission markers and try again. See our acceptable-use policy in the About / Methodology dialog.";

/**
 * Soft-refuse if the text looks like academic ghostwriting for submission.
 */
export function shouldRefuse(text: string): boolean {
  const lower = text.toLowerCase();
  const ownershipPhrases = [
    "i personally wrote this",
    "this is my own original work",
    "this is my original work",
    "i wrote this myself",
    "my own writing",
  ];
  const submissionMarkers = [
    "submit",
    "submission",
    "assignment",
    "due date",
    "professor",
    "instructor",
    "canvas",
    "turnitin",
    "moodle",
    "blackboard",
    "grading",
    "graded",
    "plagiarism",
  ];
  const hasOwnership = ownershipPhrases.some((p) => lower.includes(p));
  const submissionHits = submissionMarkers.filter((p) => lower.includes(p)).length;
  return hasOwnership && submissionHits >= 2;
}

/**
 * Build the dynamic system prompt: base + signal-specific directives + options.
 */
export function buildSystemPrompt(
  report: DetectionReport,
  options: HumanizeOptions,
): string {
  const parts: string[] = [BASE_PROMPT, ""];

  // Signal-specific directives.
  parts.push(`STRENGTH: ${options.strength.toUpperCase()}`);
  parts.push(STRENGTH_DIRECTIVES[options.strength]);
  parts.push("");

  parts.push(`TONE: ${options.tone}`);
  parts.push(TONE_DIRECTIVES[options.tone]);
  parts.push("");

  // Preserve list — always preserve by default; only mention unchecked ones
  // to remind the model (it's instructed to preserve them by default above,
  // but if a user unchecked something we leave it alone).
  const preserve = options.preserve.length > 0 ? options.preserve : ["citations", "names", "dates", "quotes"];
  parts.push("PRESERVE:");
  for (const p of preserve) {
    parts.push(`- ${PRESERVE_DIRECTIVES[p] ?? p}`);
  }
  parts.push("");

  // Inject signal-specific directives.
  parts.push("SIGNAL-SPECIFIC DIRECTIVES (from the detection report):");
  for (const sig of report.signals) {
    const directive = signalDirective(sig, options.strength);
    if (directive) parts.push(`- ${directive}`);
  }
  parts.push("");

  // Inject the actual flagged AI-favorite words for the GENERIC VOCABULARY rule.
  const vocab = report.signals.find((s) => s.key === "vocabulary");
  if (vocab && vocab.evidence.length > 0) {
    const flagged = vocab.evidence
      .map((e) => {
        const m = e.match(/^"([^"]+)"/);
        return m ? m[1] : null;
      })
      .filter((x): x is string => Boolean(x));
    if (flagged.length > 0) {
      parts.push(`FLAGGED AI-FAVORITE WORDS TO AVOID: ${flagged.join(", ")}`);
      parts.push("");
    }
  }

  parts.push("Output ONLY the rewritten text. No preamble, no commentary.");
  return parts.join("\n");
}

function signalDirective(
  sig: SignalResult,
  strength: HumanizeOptions["strength"],
): string | null {
  switch (sig.key) {
    case "perplexity": {
      const m = sig.metrics?.meanPerplexity;
      if (typeof m === "number") {
        return `PERPLEXITY: current mean is ${m.toFixed(2)}; raise it by replacing common/predictable words with rarer, more specific ones.`;
      }
      return "PERPLEXITY: replace predictable word choices with rarer alternatives.";
    }
    case "burstiness": {
      const cv = sig.metrics?.coefficientOfVariation;
      if (typeof cv === "number") {
        const target = strength === "strong" ? 0.5 : strength === "balanced" ? 0.4 : 0.3;
        return `BURSTINESS: current sentence-length CV is ${cv.toFixed(2)} — raise it above ${target.toFixed(2)} by mixing very short and very long sentences.`;
      }
      return "BURSTINESS: vary sentence length aggressively.";
    }
    case "repetitive": {
      const t = sig.metrics?.transitionsPer1000;
      const run = sig.metrics?.longestUniformParagraphRun;
      return `REPETITIVE PATTERNS: ${typeof t === "number" ? `~${t.toFixed(1)} mechanical transitions per 1000 words` : "mechanical transitions present"}; ${typeof run === "number" ? `${run} similar-length paragraphs in a row` : "uniform paragraph structure"}. Eliminate mechanical transitions and vary paragraph lengths.`;
    }
    case "vocabulary": {
      return `GENERIC VOCABULARY: ${sig.metrics?.totalMatches ?? 0} AI-favorite word occurrences — replace every one with a concrete alternative.`;
    }
    case "specificity": {
      const e = sig.metrics?.entitiesPer1000;
      return `LACK OF SPECIFICITY: ${typeof e === "number" ? `~${e.toFixed(1)} named entities per 1000 words` : "low concreteness"}. Foreground existing concrete details; do NOT invent new ones.`;
    }
    case "tone": {
      const sd = sig.metrics?.polarityStdDev;
      const markers = sig.metrics?.emotionalMarkersPer1000;
      return `UNIFORM TONE: ${typeof sd === "number" ? `polarity std dev ${sd.toFixed(3)}` : "flat polarity"}, ${typeof markers === "number" ? `${markers.toFixed(1)} emotional markers per 1000 words` : "few emotional markers"}. Introduce tone variation — a question, a hedge, mild subjectivity.`;
    }
    case "fingerprints": {
      return "STATISTICAL FINGERPRINTS: vary punctuation rhythm and sentence openings; do not start consecutive sentences with the same word.";
    }
  }
  return null;
}

/**
 * Run the humanizer. Returns the rewritten text. On LLM failure, returns the
 * original text plus an `error` field so the UI can show a banner.
 */
export async function humanizeText(
  originalText: string,
  report: DetectionReport,
  options: HumanizeOptions,
): Promise<HumanizeResult> {
  if (shouldRefuse(originalText)) {
    return { text: originalText, error: ACCEPTABLE_USE_REFUSAL };
  }

  const systemPrompt = buildSystemPrompt(report, options);
  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: originalText.slice(0, 50_000) },
      ],
      temperature: options.strength === "strong" ? 0.9 : options.strength === "balanced" ? 0.8 : 0.6,
    });
    const rewritten =
      (completion?.choices?.[0]?.message?.content as string | undefined) ?? "";
    if (!rewritten || !rewritten.trim()) {
      return {
        text: originalText,
        error: "Humanizer returned an empty response — showing original text.",
      };
    }
    return { text: rewritten.trim() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: originalText,
      error: `Humanizer unavailable — showing original text. (${msg})`,
    };
  }
}

export { BASE_PROMPT, ACCEPTABLE_USE_REFUSAL };
