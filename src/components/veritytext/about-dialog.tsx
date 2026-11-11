"use client";

import { useVerityStore } from "@/lib/veritytext/store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DEFAULT_WEIGHTS } from "@/lib/veritytext/detector/weights";
import { ShieldAlert } from "lucide-react";

interface MethodologyItem {
  key: string;
  name: string;
  weight: number;
  formula: string;
  rationale: string;
  caveats: string;
}

const ITEMS: MethodologyItem[] = [
  {
    key: "perplexity",
    name: "Perplexity",
    weight: DEFAULT_WEIGHTS.perplexity,
    formula:
      "Per-sentence rare-token fraction (tokens absent from the stopword list, the ~1860-word frequent list, and the AI lexicon), then: sdScore = clamp01((0.18 − sd)/0.13), lenScore = clamp01((avgWordLen − 4.5)/1.5), meanRareScore = clamp01((0.45 − mean)/0.30); score = 0.35·sdScore + 0.45·lenScore + 0.20·meanRareScore.",
    rationale:
      "LLMs sample from the most probable next-token distribution and tend to pick common words; humans reach for rarer, more specific vocabulary. True perplexity needs a log-probability model — we use the frequency proxy to stay self-contained and fast.",
    caveats:
      "Children's writing, very plain technical writing, and second-language English can all have low perplexity without being AI. Always read alongside the other signals.",
  },
  {
    key: "burstiness",
    name: "Burstiness",
    weight: DEFAULT_WEIGHTS.burstiness,
    formula:
      "Std dev and coefficient of variation (CV) of per-sentence token counts, plus a structural-diversity index (simple/compound/complex/compound-complex mix via compromise) and the longest run of sentences within ±2 tokens. cvScore (0.55) + evennessScore (0.25) + runScore (0.20).",
    rationale:
      "Human prose has erratic sentence-length variation; LLM output is famously uniform. CV is the cleanest single number and correlates strongly with the human/AI distinction at length.",
    caveats:
      "Highly structured genres (legal contracts, recipes, lab protocols) are bursty-low by convention. Sample must be ≥ 200 words for CV to stabilize.",
  },
  {
    key: "repetitive",
    name: "Repetitive Patterns",
    weight: DEFAULT_WEIGHTS.repetitive,
    formula:
      "Counts of mechanical transitions (Furthermore, Moreover, In conclusion, …) and their density per 1000 words; repeated sentence openers (first 1–3 words); longest run of paragraphs with word counts within 15% of each other. transitionScore (0.5) + openerScore (0.25) + paragraphScore (0.25).",
    rationale:
      "LLM prose over-uses a small set of connectives and tends to produce evenly-sized paragraphs. These patterns are visible to readers and easy to count.",
    caveats:
      "Academic and bureaucratic writing legitimately uses many of these transitions. The threshold (2/1000 words) is conservative.",
  },
  {
    key: "vocabulary",
    name: "Generic Vocabulary",
    weight: DEFAULT_WEIGHTS.vocabulary,
    formula:
      "Counts occurrences of 244 curated AI-favorite words/phrases (delve, tapestry, leverage, robust, …). Density per 1000 words, normalized to [0, 1] at 8/1000.",
    rationale:
      "A specific cluster of words is statistically over-represented in LLM output. The lexicon is editable in src/lib/veritytext/detector/ai_lexicon.json.",
    caveats:
      "The list is English-only and reflects 2023–2024 model tendencies; newer models may shift their preferences. A few hits in a long document are not meaningful.",
  },
  {
    key: "specificity",
    name: "Lack of Specificity",
    weight: DEFAULT_WEIGHTS.specificity,
    formula:
      "Counts named entities (people/orgs/places via compromise NER), specific dates, numbers-with-units, direct quotes with attribution, and first-person markers. Concreteness score = 1 − density/6. Hallucination-prone 'according to a study' patterns add a small penalty. concretenessScore (0.7) + hallucinationScore (0.2) + doiScore (0.1).",
    rationale:
      "AI text tends toward abstraction; human non-fiction leans on concrete names, dates, numbers, and quotes. Hallucination-prone citation patterns are a separate, weaker indicator.",
    caveats:
      "Compromise's NER is heuristic and misses many entities, especially in informal text. Do not treat low entity count as proof of AI.",
  },
  {
    key: "tone",
    name: "Uniform Tone",
    weight: DEFAULT_WEIGHTS.tone,
    formula:
      "Per-sentence polarity variance (lexicon-based), formality index (contractions ratio, first-person pronoun ratio, avg word length), and emotional flatness (absence of exclamations, questions, hedges, intensifiers, self-corrections, fragments). polarityScore (0.4) + formalityScore (0.35) + flatnessScore (0.25).",
    rationale:
      "LLM prose is famously flat-formal: consistent sentiment, few contractions, no questions, no asides. Human prose wobbles.",
    caveats:
      "Formal academic and journalistic writing is flat-formal by convention. The sentiment lexicon is tiny and English-only.",
  },
  {
    key: "fingerprints",
    name: "Statistical Fingerprints",
    weight: DEFAULT_WEIGHTS.fingerprints,
    formula:
      "Punctuation-to-word ratio uniformity across paragraphs, sentence token-length CV, first-word diversity, repeated-bigram ratio. Composite is capped at 0.7 because this signal is weak/probabilistic.",
    rationale:
      "Some LLM outputs (especially watermarked ones) have abnormally regular statistical fingerprints. Including a weak signal is useful for the cluster, but it must never stand alone.",
    caveats:
      "This signal is intrinsically probabilistic. Many human documents have regular structure (lab reports, legal filings). Always labeled 'weak' in the UI and never used as the sole trigger.",
  },
];

export function AboutDialog() {
  const open = useVerityStore((s) => s.aboutOpen);
  const setOpen = useVerityStore((s) => s.setAboutOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden p-0">
        <DialogHeader className="border-b border-stone-200 px-6 py-4">
          <DialogTitle className="font-serif text-xl text-stone-900">
            About VerityText — methodology &amp; acceptable use
          </DialogTitle>
          <DialogDescription>
            How detection works, the weight of each signal, and the limits of statistical heuristics.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[65vh] px-6 py-4">
          <div className="space-y-4 text-sm text-stone-700">
            <section>
              <h3 className="font-serif text-base font-semibold text-stone-900">The cluster rule</h3>
              <p className="mt-1">
                VerityText computes seven statistical signals and aggregates them as a weighted
                cluster. <strong>No single signal is ever sufficient proof.</strong> If only one
                signal is high and the rest are low, the verdict is downgraded one band and labeled
                &ldquo;single-signal trigger — low confidence.&rdquo;
              </p>
            </section>

            <section>
              <h3 className="font-serif text-base font-semibold text-stone-900">The seven signals</h3>
              <div className="mt-2 space-y-3">
                {ITEMS.map((it) => (
                  <div key={it.key} className="rounded-md border border-stone-200 bg-stone-50/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-stone-900">{it.name}</div>
                      <Badge variant="outline" className="border-stone-300 text-stone-700">
                        weight {it.weight.toFixed(2)}
                      </Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                      <div>
                        <div className="font-medium uppercase tracking-wide text-stone-500">Formula</div>
                        <div className="text-stone-700">{it.formula}</div>
                      </div>
                      <div>
                        <div className="font-medium uppercase tracking-wide text-stone-500">Rationale</div>
                        <div className="text-stone-700">{it.rationale}</div>
                      </div>
                      <div>
                        <div className="font-medium uppercase tracking-wide text-stone-500">Caveats</div>
                        <div className="text-stone-700">{it.caveats}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="font-serif text-base font-semibold text-stone-900">Verdict bands</h3>
              <ul className="mt-1 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                <li><strong>0–20</strong> — Human</li>
                <li><strong>21–40</strong> — Likely Human</li>
                <li><strong>41–60</strong> — Mixed / Uncertain</li>
                <li><strong>61–80</strong> — Likely AI</li>
                <li><strong>81–100</strong> — Very Likely AI</li>
              </ul>
            </section>

            <section>
              <h3 className="font-serif text-base font-semibold text-stone-900">Tuning</h3>
              <p className="mt-1">
                Edit <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">src/lib/veritytext/detector/weights.ts</code>{" "}
                to change signal weights. Edit{" "}
                <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">ai_lexicon.json</code> to
                extend the AI-favorite word list. See <code>methodology.md</code> for full details.
              </p>
            </section>

            <section className="rounded-md border border-amber-300 bg-amber-50 p-3">
              <div className="flex items-center gap-2 font-medium text-amber-800">
                <ShieldAlert className="size-4" /> Disclaimer
              </div>
              <p className="mt-1 text-xs text-amber-800">
                Detection is a statistical heuristic. False positives and false negatives occur. Do
                not use as sole evidence in academic, legal, or employment decisions.
              </p>
            </section>

            <section>
              <h3 className="font-serif text-base font-semibold text-stone-900">Humanizer &amp; acceptable use</h3>
              <p className="mt-1">
                The humanizer rewrites text to reduce detected AI signals while preserving all facts,
                citations, names, dates, numbers, and quotes. It does <strong>not</strong> guarantee
                that the output will &ldquo;pass&rdquo; any specific detector, and it should be used
                to improve the naturalness of your own writing, not to deceive evaluators.
              </p>
              <p className="mt-1">
                VerityText will refuse to humanize text that combines ownership claims
                (&ldquo;I personally wrote this&rdquo;) with academic submission markers
                (&ldquo;submit&rdquo;, &ldquo;assignment&rdquo;, &ldquo;professor&rdquo;). This is a
                conservative heuristic; legitimate editing is never blocked.
              </p>
            </section>

            <section>
              <h3 className="font-serif text-base font-semibold text-stone-900">Privacy</h3>
              <p className="mt-1">
                Uploaded documents live only in server memory for up to 1 hour and are never written
                to disk. Sessions expire automatically. The humanizer sends the extracted text to the
                configured language-model provider (OpenRouter, OpenAI, or Z.ai) — do not upload text
                you cannot send to an LLM.
              </p>
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
