# VerityText — AI Text Detector & Humanizer

VerityText is a self-contained Next.js 16 application that analyzes uploaded
documents (`.docx`, `.pdf`, `.txt`) for seven statistical signals of
AI-generated text, renders a verdict with evidence snippets, and optionally
rewrites ("humanizes") the text to reduce the detected signals.

> **Disclaimer:** Detection is a statistical heuristic. False positives and
> false negatives occur. Do not use as sole evidence in academic, legal, or
> employment decisions.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

or, with Bun:

```bash
bun install
bun run dev          # http://localhost:3000
```

To check types and lint:

```bash
npx tsc --noEmit
npm run lint
```

No database migration is required — all session state is in-memory.

### Environment variables

Detection needs **no configuration at all**. The only optional configuration is
the humanizer's LLM backend and the optional Prisma/SQLite history store. Copy
`.env.example` to `.env` if you want to configure them.

The humanizer supports either:

1. **Any OpenAI-compatible API** via `LLM_BASE_URL`, `LLM_API_KEY`, and
   `LLM_MODEL` (the conventional `OPENAI_*` names also work), or
2. **`z-ai-web-dev-sdk`**, which reads a `.z-ai-config` JSON file from the
   project root, your home directory, or `/etc` (the path used in the Z.ai
   sandbox).

If neither is configured, the humanizer degrades gracefully: it returns the
original text with a visible error banner, and detection still works normally.

---

## How detection works

VerityText computes **seven signals** and aggregates them as a weighted
cluster. **No single signal is ever sufficient proof.** If only one signal is
high and the rest are low, the verdict is downgraded one band and labeled
"single-signal trigger — low confidence."

| # | Signal | Weight | What it measures |
|---|--------|--------|------------------|
| 1 | Perplexity | 0.20 | Predictability of word choice (frequency-proxy surprisal). |
| 2 | Burstiness | 0.20 | Sentence-length variation and structural diversity. |
| 3 | Repetitive Patterns | 0.15 | Mechanical transitions, repeated openers, uniform paragraphs. |
| 4 | Generic Vocabulary | 0.15 | Frequency of 244 known AI-favorite words. |
| 5 | Lack of Specificity | 0.15 | Absence of named entities, dates, numbers-with-units, quotes. |
| 6 | Uniform Tone | 0.10 | Flat-formal register, low sentiment variance, few markers. |
| 7 | Statistical Fingerprints | 0.05 | Weak/probabilistic: punct-rhythm, bigram repetition, etc. |

### Verdict bands

| Range | Band |
|-------|------|
| 0–20  | Human |
| 21–40 | Likely Human |
| 41–60 | Mixed / Uncertain |
| 61–80 | Likely AI |
| 81–100 | Very Likely AI |

See **`methodology.md`** for full formulas, weight rationale, and caveats for
each signal.

---

## Tuning the engine

### Signal weights

Edit `src/lib/veritytext/detector/weights.ts`:

```typescript
export const DEFAULT_WEIGHTS: SignalWeights = {
  perplexity: 0.2,
  burstiness: 0.2,
  repetitive: 0.15,
  vocabulary: 0.15,
  specificity: 0.15,
  tone: 0.1,
  fingerprints: 0.05,
};
```

Weights need not sum to 1 — they are normalized at aggregate time.

### AI-favorite word list

Edit `src/lib/veritytext/detector/ai_lexicon.json`. Add or remove entries
freely; the detector counts occurrences per 1000 words and normalizes against
the list size. Multi-word phrases are matched case-insensitively as substrings.

### Frequent-words list (perplexity proxy)

Edit `src/lib/veritytext/detector/frequent_words.json`. Used as a proxy for
word predictability: words appearing in this list are "low surprisal"; words
not in this list contribute higher perplexity.

### Sentiment lexicon (tone signal)

Edit `src/lib/veritytext/detector/sentiment_lexicon.json` — tiny positive,
negative, intensifier, and hedging word lists.

---

## Upload constraints

- **Accepted formats:** `.docx`, `.pdf`, `.txt`
- **Max size:** 5 MB (5,242,880 bytes) — enforced at the edge (frontend + backend)
- **Validation:** extension + declared MIME type + magic bytes
  - PDF: `%PDF`
  - DOCX: ZIP (`PK\x03\x04`)
  - TXT: printable ASCII / valid UTF-8
- **Minimum text:** ≥ 50 words after extraction (else: "Not enough text to
  analyze reliably.")
- **Maximum analysis:** first 50,000 characters (longer text is flagged
  "partial analysis")
- **Sanitization:** strip nulls, NFC-normalize, collapse excessive whitespace
  while preserving paragraph breaks.

---

## API surface

All routes are relative (e.g. `POST /api/veritytext/upload`).

| Method | Route | Body / Query | Returns |
|--------|-------|--------------|---------|
| `POST` | `/api/veritytext/upload` | multipart `file` | `{ sessionId, meta, report }` |
| `GET`  | `/api/veritytext/report/[sessionId]` | — | `{ sessionId, meta, report, humanized }` |
| `POST` | `/api/veritytext/humanize/[sessionId]` | `{ strength, tone, preserve, reRun?, stream? }` | JSON, or `text/event-stream` when `stream: true` |
| `GET`  | `/api/veritytext/download/[sessionId]` | `?format=pdf\|json\|docx\|txt\|original&variant=original\|humanized` | binary file |
| `GET`  | `/api/veritytext/sample/[name]` | `name = ai_sample \| human_sample \| hybrid_sample` | `{ sessionId, meta, report }` |

Sessions live in server memory for up to 1 hour and are never written to disk.

---

## The humanizer

The humanizer calls a configured LLM server-side — either an OpenAI-compatible
endpoint (environment variables) or `z-ai-web-dev-sdk` (`.z-ai-config`) — with a
tightly engineered system prompt that inverts each detected signal. It always
preserves all facts, citations, names, dates, numbers, and quotes. Output is
streamed token-by-token (Server-Sent Events) and is re-scored automatically so
you can see the improvement. Long-running rewrites are cancellable.

**Strengths:**
- **Light** — conservative, ~10–15% wording changes.
- **Balanced** — moderate restructuring, ~30% vocabulary replacement.
- **Strong** — aggressive restructuring; targets ≥15-point score reduction. If
  the first strong pass doesn't hit that target, the UI surfaces a warning and
  offers a "Run stronger pass" button.

**Re-score safety net.** If the rewritten text does not score *lower* than the
original (any strength), the UI warns you and offers a stronger pass — a worse
result is never shipped silently.

**Acceptable use.** VerityText refuses to humanize text that combines ownership
claims ("I personally wrote this") with academic submission markers ("submit",
"assignment", "professor"). Legitimate editing is never blocked.

**Honesty.** The humanizer reduces detected signals. It does NOT "pass all
detectors." Do not use it to deceive evaluators.

---

## Project structure

```
src/
├── app/
│   ├── api/veritytext/
│   │   ├── upload/route.ts
│   │   ├── report/[sessionId]/route.ts
│   │   ├── humanize/[sessionId]/route.ts
│   │   ├── download/[sessionId]/route.ts
│   │   └── sample/[name]/route.ts
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/veritytext/
│   ├── about-dialog.tsx
│   ├── footer.tsx
│   ├── highlighted-text.tsx
│   ├── humanize-view.tsx
│   ├── nav.tsx
│   ├── report-view.tsx
│   ├── signal-card.tsx
│   └── upload-view.tsx
└── lib/veritytext/
    ├── detector/
    │   ├── signals/{perplexity,burstiness,repetitive,vocabulary,specificity,tone,fingerprints}.ts
    │   ├── ai_lexicon.json
    │   ├── frequent_words.json
    │   ├── sentiment_lexicon.json
    │   ├── index.ts
    │   ├── text-utils.ts
    │   ├── types.ts
    │   └── weights.ts
    ├── humanizer.ts
    ├── llm.ts
    ├── parsing.ts
    ├── report.ts
    ├── session.ts
    └── store.ts

samples/
├── ai_sample.txt
├── human_sample.txt
└── hybrid_sample.txt

methodology.md
README.md
.env.example
```

---

## Known limitations

- **English-tuned.** All lexicons and NER are English; non-English text gets a
  warning and reduced confidence.
- **No OCR.** Scanned PDFs (image-only) are detected and rejected with a clear
  message; OCR is not supported in v1.
- **Perplexity is a proxy.** True perplexity requires a language model with
  per-token log-probabilities. We use a frequency-based proxy to keep the
  detector self-contained and fast.
- **NER is heuristic.** `compromise`'s named-entity recognition is fast but
  misses many entities, especially informal ones.
- **Sample-length sensitivity.** Samples < 200 words are labeled
  "low-confidence"; samples < 50 words are rejected.
- **Session TTL.** In-memory sessions expire after 1 hour; refresh the page
  after that and you'll need to re-upload.
- **Single-process state.** The session store is in-process memory; if the dev
  server restarts, sessions are lost. This is intentional for v1 (no document
  persistence beyond the TTL).

---

## License & attribution

Built on Next.js 16, TypeScript, Tailwind CSS 4, and shadcn/ui. Document
parsing via `mammoth` (DOCX), `pdf-parse` (PDF), and `Buffer.toString('utf8')`
(TXT). PDF report generation via `pdfkit`. DOCX regeneration via the `docx`
package. Language-model humanization via `z-ai-web-dev-sdk`.
