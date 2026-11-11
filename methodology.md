# VerityText — Detection Methodology

This document describes each of the seven signals, its formula, the rationale
for its weight, and the false-positive caveats. The implementation lives in
`src/lib/veritytext/detector/`.

> **Disclaimer (mandatory, appears on report view, PDF, and JSON):**
> Detection is a statistical heuristic. False positives and false negatives
> occur. Do not use as sole evidence in academic, legal, or employment
> decisions.

---

## The cluster rule

VerityText computes seven signals and aggregates them as a weighted cluster.
**No single signal is ever sufficient proof.** If exactly one signal is "high"
(score ≥ 0.6) and the rest are all "low" (score < 0.4), the verdict is
downgraded one band and the report notes "single-signal trigger — low
confidence."

The aggregate is computed as a weighted sum, normalized by the total weight,
then scaled to a 0–100 integer AI probability:

```
aggregate = (Σ signal.score × signal.weight) / (Σ signal.weight)
aiProbability = round(aggregate × 100)
```

The Statistical Fingerprints signal is intrinsically weak and is capped at 0.7
internally; it is always labeled "weak/probabilistic" in the UI.

---

## Signal 1 — Perplexity (weight 0.20)

**What it measures:** Predictability of word choice.

**Formula:**
1. Tokenize each sentence, lowercasing and keeping `[a-z0-9'’-]+`.
2. For each token, mark it "rare" if it is **not** in the stopword allow-list,
   the bundled ~1860-word frequent-words list, or the AI-favorite lexicon
   (so `delve`/`tapestry` do not inflate rarity — they are predictable for AI).
3. Per-sentence rare fraction = rare tokens / tokens.
4. Compute three sub-metrics over the document:
   - `sdRare` — standard deviation of the per-sentence rare fractions
     (uniform vocabulary → low variation → AI-like).
   - `avgWordLen` — mean token length (longer, more "academic" words → AI-like).
   - `meanRare` — mean rare fraction (lower → more predictable → AI-like).
5. Composite score:
   ```
   sdScore       = clamp01((0.18 − sdRare) / 0.13)
   lenScore      = clamp01((avgWordLen − 4.5) / 1.5)
   meanRareScore = clamp01((0.45 − meanRare) / 0.30)
   score = 0.35·sdScore + 0.45·lenScore + 0.20·meanRareScore
   ```

**Evidence reported:** the 5 lowest-rare-fraction sentences (most predictable),
each prefixed with its rare fraction.

**Why this weight:** Perplexity is the single most-cited signal in the
literature and tends to have the largest effect size between human and AI text
at length. 0.20 reflects that prominence without letting it dominate the
cluster.

**Caveats:**
- Children's writing, plain technical writing, and second-language English can
  all have low perplexity without being AI.
- True perplexity requires a log-probability model. The frequency-proxy
  correlates but is not equivalent — rarer-than-LLM human vocabulary inflates
  human perplexity; this is desirable (it pushes human text away from AI) but
  means the absolute number is not a "true" perplexity.
- Sample must be ≥ 50 words to be meaningful; the engine rejects shorter
  samples outright.

---

## Signal 2 — Burstiness (weight 0.20)

**What it measures:** Variation in sentence length and structural diversity.

**Formula:**
1. Sentence token counts (rough word counts).
2. Coefficient of variation (CV) = stdDev / mean.
3. Structural diversity via compromise: classify each sentence as
   simple/compound/complex/compound-complex/fragment. Compute an evenness
   score = 1 − Herfindahl index over the type distribution.
4. Longest "mechanical run": the longest run of consecutive sentences whose
   token counts are within ±2 of each other.
5. Score = `cvScore × 0.55 + evennessScore × 0.25 + runScore × 0.20`, where
   - `cvScore = clamp01((0.50 − CV) / 0.40)`
   - `evennessScore = clamp01(1 − evenness)`
   - `runScore = clamp01((longestRun − 2) / 6)`

**Evidence reported:** sentence-length histogram, longest mechanical run with
an example sentence, structure-type counts.

**Why this weight:** Burstiness is the second most-cited signal and is
remarkably stable across model families. 0.20 matches perplexity.

**Caveats:**
- Highly structured genres (legal contracts, recipes, lab protocols) are
  bursty-low by convention.
- CV stabilizes around 200 words; below that, single long or short sentences
  dominate the variance.
- The structure classifier is heuristic (regex + compromise clause count) and
  occasionally misclassifies fragments.

---

## Signal 3 — Repetitive Patterns (weight 0.15)

**What it measures:** Mechanical transitions, repeated sentence openers, and
uniform paragraph lengths.

**Formula:**
1. Counts occurrences of ~40 listed mechanical transitions ("Furthermore",
   "Moreover", "In conclusion", "Additionally", "It is important to note",
   "In today's world", "Let's dive in", …).
2. Density = total transitions × (1000 / wordCount).
3. Repeated sentence openers: the first 1–3 words of each sentence; count
   distinct openers that appear ≥ 2×.
4. Consecutive paragraphs within 15% word count of each other — longest run.
5. Score =
   `transitionScore × 0.5 + openerScore × 0.25 + paragraphScore × 0.25`, where
   - `transitionScore = clamp01((transitionDensity − 2) / 12)`
   - `openerScore = clamp01(repeatedOpenerTypes / 5)`
   - `paragraphScore = clamp01((longestUniformParagraphRun − 2) / 4)`

**Flag rule:** a transition is flagged when it appears > 2× per 1000 words.
Paragraph uniformity is flagged when ≥ 3 consecutive paragraphs are within
15% word count of each other.

**Evidence reported:** flagged transitions with counts, repeated openers with
counts, longest uniform-paragraph run.

**Why this weight:** Repetitive patterns are very visible to readers and easy
to count, but they're also genre-dependent (academic prose legitimately uses
many transitions). 0.15 balances visibility against genre noise.

**Caveats:**
- Academic and bureaucratic writing legitimately uses many of these
  transitions; the 2/1000 threshold is conservative.
- "Firstly / Secondly / Finally" appears in many human-written essays; the
  flag is on density, not presence.

---

## Signal 4 — Generic Vocabulary (weight 0.15)

**What it measures:** Frequency of a curated list of 244 AI-favorite words
and phrases.

**Formula:**
1. The lexicon lives in `src/lib/veritytext/detector/ai_lexicon.json`. Entries
   are matched case-insensitively as substrings (multi-word phrases included).
2. For each lexicon entry, count non-overlapping occurrences in the lowercased
   text. Attribute each hit to its containing sentence.
3. Total matches = sum across all entries.
4. Density = totalMatches × (1000 / wordCount).
5. Score = `clamp01(density / 8)` — 0 matches/1k → 0; 8+ matches/1k → 1.

**Evidence reported:** matched words with counts and example sentences.

**Why this weight:** The signal is highly interpretable (you can show the user
the exact words flagged), but the lexicon is English-only and reflects
2023–2024 model tendencies. 0.15 reflects moderate confidence.

**Caveats:**
- Newer models shift their preferences; the lexicon must be maintained.
- A few hits in a long document are not meaningful — the density normalization
  handles this.
- Some words (e.g. "transformative") have legitimate uses in many domains.

---

## Signal 5 — Lack of Specificity (weight 0.15)

**What it measures:** Absence of concrete references — named entities, dates,
numbers-with-units, direct quotes, first-person markers — plus hallucination-
prone citation patterns.

**Formula:**
1. Named entities via compromise NER: people, organizations, places.
2. Specific dates via regex (full-month dates, ISO dates, MM/DD/YYYY, etc.).
3. Numbers with units via regex (% , kg, km, hours, dollars, etc.).
4. Direct quotes with attribution: `"..." [,—] (said|wrote|noted|…) ...`.
5. First-person anecdote markers: `I (was|have|think|felt|…)`.
6. Concrete density per 1000 words =
   `(entities + dates + numbersWithUnits + quotes + firstPerson) × (1000 / wordCount)`.
7. Concreteness score = `clamp01(1 − concreteDensity / 6)`.
8. Hallucination-prone patterns: "according to a study" with no citation.
   `hallucinationScore = clamp01(vagueStudyCount / 3)`.
9. DOIs: tiny penalty if many DOIs appear without surrounding context.
10. Score = `concretenessScore × 0.7 + hallucinationScore × 0.2 + doiScore × 0.1`.

**Evidence reported:** per-1k counts of each concrete-reference type, plus
named entities and flagged vague citations.

**Why this weight:** Specificity is a strong human/AI discriminator for non-
fiction but depends on genre (fiction and poetry legitimately lack many of
these markers). 0.15 is a balanced choice.

**Caveats:**
- `compromise`'s NER is heuristic and misses many entities, especially
  informal ones. Low entity count alone is NOT proof of AI.
- Quotes with attribution are rare in much human writing (blogs, emails); the
  signal relies on the *cluster* of concrete-reference types, not any single
  one.
- Hallucination-prone citation patterns are weak evidence on their own — the
  0.2 weight reflects that.

---

## Signal 6 — Uniform Tone (weight 0.10)

**What it measures:** Flat-formal register — consistent sentiment, few
contractions, no questions/exclamations, no hedges or self-correction.

**Formula:**
1. Per-sentence polarity via a tiny sentiment lexicon (positive minus negative
   word counts, normalized by token count).
2. `polarityStdDev` = std dev of per-sentence polarity. Human prose typically
   > 0.06; AI prose often < 0.04.
3. Formality index = `(1 − min(1, contractionsRatio × 50)) × 0.4 + (1 −
   min(1, firstPersonPronounRatio × 20)) × 0.3 + min(1, avgWordLen / 6) × 0.3`.
4. Emotional markers: exclamations, questions, hedges (lexicon), intensifiers
   (lexicon), self-corrections (regex), fragments (sentences ≤ 4 tokens).
   `markersPer1k = totalMarkers / (wordCount / 1000)`.
5. Score =
   `polarityScore × 0.4 + formalityScore × 0.35 + flatnessScore × 0.25`, where
   - `polarityScore = clamp01((0.08 − polarityStdDev) / 0.08)`
   - `formalityScore = clamp01((formality − 0.5) / 0.5)`
   - `flatnessScore = clamp01(1 − markersPer1k / 8)`

**Evidence reported:** polarity std dev, contractions ratio, first-person
pronoun ratio, average word length, emotional-marker counts.

**Why this weight:** Tone is meaningful but very genre-dependent — formal
academic and journalistic writing is flat-formal by convention. 0.10 reflects
that caution.

**Caveats:**
- The sentiment lexicon is tiny and English-only.
- Formal genres (legal filings, academic papers, press releases) routinely
  score high on this signal; the cluster rule prevents a single high tone
  signal from dominating.
- Self-correction detection is regex-based and only catches explicit
  parentheticals.

---

## Signal 7 — Statistical Fingerprints (weight 0.05, always labeled weak)

**What it measures:** Heuristic statistical anomalies that sometimes indicate
LLM output or watermarking.

**Formula:**
1. Punctuation-to-word ratio and its CV across paragraphs.
2. Sentence token-length CV (re-used from burstiness but scored separately).
3. First-word diversity = distinct first words / total sentences.
4. Bigram repetition: fraction of unique bigrams that appear > 2×.
5. Score =
   `punctScore × 0.25 + lengthScore × 0.3 + firstWordScore × 0.25 + bigramScore × 0.20`,
   then capped at **0.7** because this signal is intrinsically probabilistic.

**Evidence reported:** punctuation-ratio CV, sentence-length CV, first-word
diversity, repeated-bigram ratio, list of anomalies found.

**Why this weight (and the cap):** Statistical fingerprints are the weakest
signal by design. They're useful in the cluster — watermarked text does
exhibit detectable regularities — but they are never sufficient on their own
and produce many false positives on highly structured human documents. The
0.05 weight and the 0.7 cap both reflect this.

**Caveats:**
- Many human documents (lab reports, legal filings, recipes) have regular
  structure.
- Watermark detection is adversarial: model providers can change their
  watermark schemes at any time. This signal will not catch every watermarked
  text and may flag some non-watermarked text.
- The signal is always labeled "weak / probabilistic" in the UI and the
  report.

---

## Aggregate verdict

```
aggregate  = Σ (signal.score × signal.weight) / Σ signal.weight
aiProbability = round(clamp(aggregate × 100, 0, 100))
```

| Range | Band | Label |
|-------|------|-------|
| 0–20  | `human`           | Human |
| 21–40 | `likely-human`    | Likely Human |
| 41–60 | `mixed`           | Mixed / Uncertain |
| 61–80 | `likely-ai`       | Likely AI |
| 81–100| `very-likely-ai`  | Very Likely AI |

### Single-signal rule

If exactly one signal is "high" (score ≥ 0.6) and all others are "low"
(score < 0.4), the verdict is downgraded one band and labeled
"single-signal trigger — low confidence."

### Confidence

Confidence is a 0–100 heuristic combining signal-agreement (lower variance →
higher confidence) and sample length (longer → higher confidence). It is
capped at 40 for short samples (50–200 words), at 50 for mixed-language text,
and at 50 for single-signal triggers. It is never below 15.

---

## The humanizer

The humanizer inverts each detected signal. The system prompt (verbatim):

```
You are an expert human editor. Rewrite the following text so it reads as
genuinely human-written, while preserving ALL facts, citations, names, dates,
numbers, quotes, and the original meaning and language. Do NOT add or invent
information. Do NOT remove substantive content.

Apply these revisions, in priority order based on the detection report:
1. PERPLEXITY: Replace predictable, generic word choices with varied, specific,
   occasionally surprising vocabulary. Avoid the most statistically likely
   next word.
2. BURSTINESS: Vary sentence length aggressively. Mix very short punchy
   sentences (3–7 words) with longer complex ones (20+ words). Occasionally
   use fragments.
3. REPETITIVE PATTERNS: Eliminate mechanical transitions ("Furthermore",
   "Moreover", "In conclusion", "Additionally"). Replace with natural
   connectives or omit them. Vary paragraph lengths deliberately.
4. GENERIC VOCABULARY: Never use these words: [inject flagged AI-favorite
   words]. Replace with concrete, specific alternatives.
5. LACK OF SPECIFICITY: Where the original is vague, do NOT invent specifics,
   but restructure sentences to foreground whatever concrete details already
   exist. Add natural first-person framing only where the source text already
   implies a perspective.
6. UNIFORM TONE: Introduce natural tone variation — occasional informality, a
   question, a hedging phrase, mild subjectivity, an aside. Allow minor,
   natural imperfections (a sentence starting with "And" or "But", a
   conversational aside in parentheses). Do NOT introduce errors that damage
   credibility.
7. PRESERVE EXACTLY (never alter): all proper nouns, dates, numbers,
   statistics, direct quotes and their attributions, citations, and any code
   or formulas.

Output ONLY the rewritten text. No preamble, no commentary.
```

Appended dynamically:
- Strength directive (Light / Balanced / Strong).
- Tone directive (original / casual / academic / professional).
- Preserve list (citations / names / dates / quotes — all default).
- Signal-specific directives generated from the detection report (e.g.
  "Sentence-length CV is currently 0.12 — raise it above 0.50.").
- The actual flagged AI-favorite words to avoid.

The output is re-scored by the same detector. If a "Strong" pass doesn't
improve the score by ≥ 15 points, the UI surfaces a warning and offers a
"Run stronger pass" button (which calls back with `reRun=true` and
`strength="strong"`, basing the rewrite on the already-humanized text).

### Acceptable-use refusal

The humanizer refuses (soft refusal + link to acceptable-use policy) if the
text combines ownership claims ("I personally wrote this", "this is my own
original work") with academic submission markers ("submit", "assignment",
"due date", "professor", "canvas", "turnitin", "moodle", "blackboard",
"grading", "plagiarism"). This is a conservative heuristic; legitimate
editing is never blocked.

### Failure modes

- **LLM failure / timeout** → returns the original text with
  `error: "Humanizer unavailable — showing original text"`. The UI shows a
  banner. Never returns blank.
- **Soft refusal** → returns the original text with the refusal message as
  `error`.

---

## Opt-in history

Session state is in-memory by default and expires after one hour. When the
upload form's **Save to history** toggle is on, the session is also written to
the configured Postgres database (`HistorySession` table) and survives server
restarts until the user deletes it. Rows are scoped to an anonymous httpOnly
owner cookie — there are no accounts, and a different browser cannot read them.
History is off by default and the database is optional; without `DATABASE_URL`
the feature is hidden and nothing is persisted.

## Privacy

Uploaded documents live only in server memory for up to 1 hour and are never
written to disk, except for opt-in history rows (see above). Sessions expire
automatically and are evicted on the next request after their TTL. The
humanizer sends the extracted text to the configured language-model provider
(OpenRouter, OpenAI, or Z.ai) — do not upload text you cannot send to an LLM.

---

## Tuning guide

- **Weights:** `src/lib/veritytext/detector/weights.ts`
- **AI-favorite lexicon:** `src/lib/veritytext/detector/ai_lexicon.json`
- **Frequent words (perplexity proxy):** `src/lib/veritytext/detector/frequent_words.json`
- **Sentiment / intensifier / hedging lexicons:** `src/lib/veritytext/detector/sentiment_lexicon.json`
- **Mechanical transitions list:** in `src/lib/veritytext/detector/signals/repetitive.ts`
