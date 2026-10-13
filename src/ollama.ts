/** Minimal client for a local Ollama server (https://ollama.com). */

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatResult = {
  content: string;
  /** Ollama's own timings in ms; loadMs is only non-zero when the model had to be loaded */
  loadMs: number;
  promptMs: number;
  generateMs: number;
  promptTokens: number;
  outputTokens: number;
};

export type LoadedModel = { name: string; sizeMB: number; vramMB: number };

const ns = (x: number | undefined) => (x ?? 0) / 1e6;

export class Ollama {
  constructor(
    readonly host = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(path: string, body?: unknown, timeoutMs = 60_000): Promise<T> {
    const res = await this.fetchImpl(`${this.host}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`ollama ${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  /** Names of the models pulled on this machine, or null when Ollama isn't running. */
  async models(): Promise<string[] | null> {
    try {
      const r = await this.call<{ models: { name: string }[] }>("/api/tags", undefined, 1500);
      return r.models.map((m) => m.name).sort();
    } catch {
      return null;
    }
  }

  async version(): Promise<string | null> {
    try {
      return (await this.call<{ version: string }>("/api/version", undefined, 1500)).version;
    } catch {
      return null;
    }
  }

  /** Models currently in memory, and how much of each sits in GPU memory. */
  async loaded(): Promise<LoadedModel[]> {
    try {
      const r = await this.call<{ models: { name: string; size: number; size_vram: number }[] }>("/api/ps", undefined, 1500);
      return r.models.map((m) => ({ name: m.name, sizeMB: m.size / 2 ** 20, vramMB: m.size_vram / 2 ** 20 }));
    } catch {
      return [];
    }
  }

  async chat(
    model: string,
    messages: ChatMessage[],
    opts: { temperature?: number; maxTokens?: number } = {},
  ): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model,
      messages,
      stream: false,
      options: { temperature: opts.temperature ?? 0.8, num_predict: opts.maxTokens ?? 80 },
    };
    // Qwen3 thinks before answering by default, which is far too slow for a line of dialogue
    if (/qwen3/i.test(model)) body.think = false;
    const r = await this.call<{
      message: { content: string };
      load_duration?: number;
      prompt_eval_duration?: number;
      eval_duration?: number;
      prompt_eval_count?: number;
      eval_count?: number;
    }>("/api/chat", body);
    return {
      content: r.message.content,
      loadMs: ns(r.load_duration),
      promptMs: ns(r.prompt_eval_duration),
      generateMs: ns(r.eval_duration),
      promptTokens: r.prompt_eval_count ?? 0,
      outputTokens: r.eval_count ?? 0,
    };
  }
}
