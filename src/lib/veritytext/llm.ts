// Small LLM client used by the humanizer.
//
// Two backends are supported, in priority order:
//   1. Any OpenAI-compatible endpoint configured through environment variables
//      (LLM_BASE_URL + LLM_API_KEY + LLM_MODEL). This is the portable path.
//   2. `z-ai-web-dev-sdk`, which reads a `.z-ai-config` JSON file from the
//      project root, the user's home directory, or /etc. This is the path used
//      in the Z.ai sandbox.
//
// Both backends expose a streaming async iterator and a non-streaming call.
// All failures surface as thrown Errors so the humanizer can degrade
// gracefully (return the original text with a visible error note).
import ZAI from "z-ai-web-dev-sdk";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMRequest {
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

interface EnvConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * Resolve an OpenAI-compatible configuration from the environment, if present.
 * `LLM_*` takes precedence; the conventional `OPENAI_*` names are accepted as
 * a fallback so an existing OpenAI key "just works".
 */
export function envLLMConfig(): EnvConfig | null {
  const apiKey =
    process.env.LLM_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    "";
  if (!apiKey) return null;
  const baseUrl = (
    process.env.LLM_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    "https://api.openai.com/v1"
  ).replace(/\/+$/, "");
  const model =
    process.env.LLM_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "gpt-4o-mini";
  return { baseUrl, apiKey, model };
}

const NOT_CONFIGURED =
  "Humanizer LLM is not configured. Create a .z-ai-config file (see README) or set LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL.";

function abortError(): Error {
  const err = new Error("Humanizing cancelled.");
  err.name = "AbortError";
  return err;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

// ---------- OpenAI-compatible backend ----------

async function openAIChat(
  cfg: EnvConfig,
  req: LLMRequest,
  stream: boolean,
): Promise<Response> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: req.messages,
      temperature: req.temperature ?? 0.8,
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      stream,
    }),
    signal: req.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `LLM request failed (HTTP ${res.status})${body ? `: ${body.slice(0, 300)}` : ""}`,
    );
  }
  return res;
}

async function openAIComplete(cfg: EnvConfig, req: LLMRequest): Promise<string> {
  const res = await openAIChat(cfg, req, false);
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content ?? "";
}

// ---------- z-ai-web-dev-sdk backend ----------

let sdkPromise: Promise<ZAI> | null = null;

async function getSDK(): Promise<ZAI> {
  if (!sdkPromise) {
    sdkPromise = ZAI.create().catch((err) => {
      // Reset so a later request can retry after the config is added.
      sdkPromise = null;
      throw new Error(
        `${NOT_CONFIGURED} (${err instanceof Error ? err.message : String(err)})`,
      );
    });
  }
  return sdkPromise;
}

// ---------- SSE parsing ----------

async function* parseSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Normalize CRLF so line splitting works for both formats.
      buffer = buffer.replace(/\r\n/g, "\n");
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const rawLine = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const line = rawLine.trim();
        if (!line || line.startsWith(":")) continue;
        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (data === "[DONE]") return;
          try {
            const json = JSON.parse(data) as {
              choices?: {
                delta?: { content?: string };
                message?: { content?: string };
                text?: string;
              }[];
            };
            const choice = json.choices?.[0];
            const delta =
              choice?.delta?.content ??
              choice?.message?.content ??
              choice?.text ??
              "";
            if (delta) yield delta;
          } catch {
            // Ignore keep-alive / non-JSON SSE frames.
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ---------- Public API ----------

/**
 * Non-streaming completion with one retry on transient failure.
 */
export async function completeText(req: LLMRequest): Promise<string> {
  const env = envLLMConfig();
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    throwIfAborted(req.signal);
    try {
      if (env) return (await openAIComplete(env, req)).trim();
      const zai = await getSDK();
      const completion = await zai.chat.completions.create({
        messages: req.messages,
        temperature: req.temperature ?? 0.8,
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      });
      const content =
        (completion?.choices?.[0]?.message?.content as string | undefined) ?? "";
      return content.trim();
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Streaming completion. Yields text deltas as they arrive.
 *
 * The SDK returns a ReadableStream when `stream: true`; if the upstream ignores
 * streaming and returns a JSON object instead, we yield its content in one go.
 */
export async function* streamText(req: LLMRequest): AsyncGenerator<string> {
  const env = envLLMConfig();

  if (env) {
    const res = await openAIChat(env, req, true);
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.body || !contentType.includes("text/event-stream")) {
      // Upstream did not stream — fall back to reading the JSON body.
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = json.choices?.[0]?.message?.content ?? "";
      if (content) yield content;
      return;
    }
    yield* parseSSE(res.body, req.signal);
    return;
  }

  const zai = await getSDK();
  const result = await zai.chat.completions.create({
    messages: req.messages,
    temperature: req.temperature ?? 0.8,
    ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
    stream: true,
  });

  // The SDK returns a ReadableStream when the upstream streams.
  if (result instanceof ReadableStream) {
    yield* parseSSE(result, req.signal);
    return;
  }

  const content =
    ((result as { choices?: { message?: { content?: string } }[] })?.choices?.[0]
      ?.message?.content as string | undefined) ?? "";
  if (content) yield content;
}

export { NOT_CONFIGURED };
