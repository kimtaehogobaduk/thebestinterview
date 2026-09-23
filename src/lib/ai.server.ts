// Server-only AI helpers. Only import from server handlers.

const CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

function getCerebrasKeys(): string[] {
  return [
    process.env.CEREBRAS_API_KEY_1,
    process.env.CEREBRAS_API_KEY_2,
    process.env.CEREBRAS_API_KEY_3,
  ].filter((k): k is string => !!k);
}

function getGroqKeys(): string[] {
  return [process.env.GROQ_API_KEY_1, process.env.GROQ_API_KEY_2].filter(
    (k): k is string => !!k,
  );
}

// Reasoning/generation model. Cerebras is tried first when its keys have quota;
// otherwise the same open-weight model on Groq serves the request.
const REASONING_MODEL_CEREBRAS = "gpt-oss-120b";
const REASONING_MODEL_GROQ = "openai/gpt-oss-120b";

function withJsonHint(
  messages: { role: string; content: string }[],
  json?: boolean,
) {
  if (!json) return messages;
  return [...messages, { role: "system", content: "Respond with json only." }];
}

async function openAiCompatChat(
  url: string,
  key: string,
  model: string,
  messages: { role: string; content: string }[],
  opts: { temperature?: number; max_tokens?: number; json?: boolean },
  label: string,
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages: withJsonHint(messages, opts.json),
    temperature: opts.temperature ?? 0.85,
    max_tokens: opts.max_tokens ?? 1200,
  };
  if (opts.json) body.response_format = { type: "json_object" };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`${label} ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

export async function cerebrasChat(
  keyIndex: 0 | 1 | 2,
  messages: { role: string; content: string }[],
  opts: { temperature?: number; max_tokens?: number; json?: boolean } = {},
): Promise<string> {
  const keys = getCerebrasKeys();
  const key = keys[keyIndex] ?? keys[0];
  if (key) {
    try {
      return await openAiCompatChat(
        CEREBRAS_URL,
        key,
        REASONING_MODEL_CEREBRAS,
        messages,
        opts,
        "Cerebras",
      );
    } catch (e) {
      console.warn("[AI] Cerebras unavailable, falling back to Groq", e);
    }
  }
  const groqKey = getGroqKeys()[0];
  if (!groqKey) throw new Error("No available AI provider key");
  return openAiCompatChat(
    GROQ_URL,
    groqKey,
    REASONING_MODEL_GROQ,
    messages,
    opts,
    "Groq",
  );
}

export async function groqChat(
  messages: { role: string; content: string }[],
  opts: { model?: string; json?: boolean; temperature?: number } = {},
): Promise<string> {
  const keys = getGroqKeys();
  const key = keys[0];
  if (!key) throw new Error("Groq API key missing");
  const body: Record<string, unknown> = {
    model: opts.model ?? "llama-3.3-70b-versatile",
    messages,
    temperature: opts.temperature ?? 0.5,
  };
  if (opts.json) body.response_format = { type: "json_object" };
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Groq ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Groq Whisper transcription with automatic fallback.
 * Turbo first; on failure or non-2xx, retry Large v3.
 */
export async function groqTranscribe(audio: Blob, filename: string): Promise<string> {
  const keys = getGroqKeys();
  const key = keys[0];
  if (!key) throw new Error("Groq API key missing");

  async function attempt(model: string) {
    const form = new FormData();
    form.append("file", audio, filename);
    form.append("model", model);
    form.append("language", "ko");
    form.append("response_format", "json");
    const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!r.ok) throw new Error(`Groq STT ${model} ${r.status}`);
    const j = (await r.json()) as { text?: string };
    return j.text ?? "";
  }

  try {
    return await attempt("whisper-large-v3-turbo");
  } catch (e) {
    console.warn("[STT] Turbo failed, falling back to Large v3", e);
    return await attempt("whisper-large-v3");
  }
}

export function safeParseJson<T = unknown>(txt: string): T | null {
  try {
    const m = txt.match(/\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : txt) as T;
  } catch {
    return null;
  }
}
