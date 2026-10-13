/** Minimal client for a local Ollama server (https://ollama.com). */

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export class Ollama {
  constructor(
    readonly host = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
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

  async chat(model: string, messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number } = {}) {
    const body: Record<string, unknown> = {
      model,
      messages,
      stream: false,
      options: { temperature: opts.temperature ?? 0.8, num_predict: opts.maxTokens ?? 80 },
    };
    // Qwen3 thinks before answering by default, which is far too slow for a line of dialogue
    if (/qwen3/i.test(model)) body.think = false;
    const r = await this.call<{ message: { content: string } }>("/api/chat", body);
    return r.message.content;
  }
}
