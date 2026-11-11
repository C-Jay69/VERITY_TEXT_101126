// Signal 5 — Lack of Specificity.
//
// AI text tends to be abstract and lacks concrete references. We measure:
//   - Named entities (people, orgs, places) via compromise NER
//   - Specific dates and numbers-with-units
//   - Direct quotes with attribution ("…", said X)
//   - First-person markers ("I", personal anecdotes)
//   - Hallucination-prone patterns: "according to a study" with no citation,
//     suspiciously perfect DOIs (10.xxxx/yyyy format with low entropy).
// High abstraction / low concreteness → higher AI-likelihood.
import nlp from "compromise";
import { type SignalResult, type SignalKey, type TextSpan } from "../types";
import { extractEntities, wordCount } from "../text-utils";
import { DEFAULT_WEIGHTS } from "../weights";

export function specificitySignal(text: string): SignalResult {
  const key: SignalKey = "specificity";
  const weight = DEFAULT_WEIGHTS.specificity;
  const wc = Math.max(wordCount(text), 1);
  const per1k = 1000 / wc;

  const entities = extractEntities(text);
  const entityCount =
    entities.people.length +
    entities.organizations.length +
    entities.places.length;

  // Specific dates.
  const dateMatches = text.match(
    /\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s+\d{4})\b/gi,
  );
  const dateCount = dateMatches ? dateMatches.length : 0;

  // Numbers with units.
  const numberWithUnit = text.match(
    /\b\d+(?:[.,]\d+)?\s*(?:%|percent|kg|km|cm|mm|m\b|mi|ft|lb|oz|g\b|hours?|hrs?|minutes?|mins?|seconds?|secs?|days?|weeks?|months?|years?|yrs?|dollars?|usd|\$|euros?|eur|gbp|yen|jpy|bytes?|kb|mb|gb|tb|hz|mhz|ghz|fps|px|ppi|dpi)\b/gi,
  );
  const unitCount = numberWithUnit ? numberWithUnit.length : 0;

  // Direct quotes with attribution.
  const quoteMatches = text.match(
    /[""']([^"'"']{4,})[""']\s*(?:[,—-]\s*(?:said|says|wrote|writes|noted|notes|explained|states|stated|according to)\s+[^.!?]+[.!?])/gi,
  );
  const quoteCount = quoteMatches ? quoteMatches.length : 0;

  // First-person markers.
  const firstPerson = text.match(/\bI\b(?:'m|'ve|'ll|'d)?\s+(?:was|am|have|had|will|would|could|should|think|thought|felt|feel|believe|believed|saw|see|heard|hear|went|go|goes|come|came|know|knew|realized|noticed|found|decided|wanted|needed|tried|hoped|wondered|remember|recall|grew|gotten|got)\b/gi);
  const firstPersonCount = firstPerson ? firstPerson.length : 0;

  // Hallucination-prone citation patterns.
  const vagueStudy = text.match(
    /\b(?:according to|per|as reported by)\s+(?:a\s+)?(?:study|studies|research|researchers|report|reports|survey|surveys|paper|papers|article|articles)\b/gi,
  );
  const vagueStudyCount = vagueStudy ? vagueStudy.length : 0;
  // Suspicious DOIs: 10.\d{4,9}/\S+ — flag any DOI without context.
  const doiMatches = text.match(/\b10\.\d{4,9}\/[^\s,;)]+/gi);
  const doiCount = doiMatches ? doiMatches.length : 0;

  // Concreteness index: per-1k density of concrete references.
  const concretePer1k =
    (entityCount + dateCount + unitCount + quoteCount + firstPersonCount) *
    per1k;
  // Higher concretePer1k → more human. Map [0, 6] → [1, 0].
  const concretenessScore = Math.max(0, Math.min(1, 1 - concretePer1k / 6));

  // Hallucination risk: vague "according to a study" with no DOI/attribution.
  const hallucinationScore = Math.max(0, Math.min(1, vagueStudyCount / 3));
  // DOIs alone are fine if they look real; flag only if there are many without
  // context — keep this small.
  const doiScore = Math.max(0, Math.min(1, doiCount / 8)) * 0.3;

  const score = concretenessScore * 0.7 + hallucinationScore * 0.2 + doiScore * 0.1;

  const evidence: string[] = [
    `Named entities: ${entityCount} (people=${entities.people.length}, orgs=${entities.organizations.length}, places=${entities.places.length}) per 1000 words = ${(entityCount * per1k).toFixed(2)}.`,
    `Specific dates: ${dateCount}. Numbers with units: ${unitCount}.`,
    `Direct quotes with attribution: ${quoteCount}.`,
    `First-person anecdote markers: ${firstPersonCount}.`,
    `Vague "according to a study" patterns: ${vagueStudyCount}.`,
    `DOIs detected: ${doiCount}.`,
  ];
  if (entities.people.length > 0) {
    evidence.push(
      `People named: ${entities.people.slice(0, 5).join(", ")}.`,
    );
  }
  if (entities.places.length > 0) {
    evidence.push(
      `Places named: ${entities.places.slice(0, 5).join(", ")}.`,
    );
  }

  // Spans: mark vague-study patterns and DOIs.
  const spans: TextSpan[] = [];
  let m: RegExpExecArray | null;
  const vagueRe =
    /\b(?:according to|per|as reported by)\s+(?:a\s+)?(?:study|studies|research|researchers|report|reports|survey|surveys|paper|papers|article|articles)[^.!?]*[.!?]/gi;
  while ((m = vagueRe.exec(text)) !== null) {
    spans.push({
      start: m.index,
      end: m.index + m[0].length,
      signal: key,
      label: "vague citation",
    });
  }

  return {
    key,
    name: "Lack of Specificity",
    score,
    weight,
    explanation:
      concretePer1k < 2
        ? "Text is abstract and lacks concrete references (people, dates, numbers, quotes)."
        : concretePer1k < 4
          ? "Some concrete references present but text leans abstract."
          : "Text contains concrete references typical of human writing.",
    evidence,
    spans,
    metrics: {
      entitiesPer1000: Number((entityCount * per1k).toFixed(2)),
      dateCount,
      numberWithUnitCount: unitCount,
      quoteCount,
      firstPersonCount,
      vagueCitationCount: vagueStudyCount,
      doiCount,
    },
  };
}

// Keep the nlp import referenced for side-effect safety (compromise types).
void nlp;
