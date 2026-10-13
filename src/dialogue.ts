/**
 * The dialogue step. The decision is already made; a small language model
 * only turns it into something Mira says. If the model is off, offline or
 * returns something unusable, she says an authored line instead.
 */
import { describe, type Decision } from "./decision.ts";
import { authoredLine } from "./lines.ts";
import type { Memory } from "./memory.ts";
import type { ChatMessage, Ollama } from "./ollama.ts";
import type { Reaction } from "./rules.ts";

export type Spoken = {
  line: string;
  by: string;
  ms: number;
  fallbackReason?: string;
  /** what the language model was asked, for the "behind the scenes" panel */
  prompt?: ChatMessage[];
};

const DOES: Record<Reaction, string> = {
  welcome: "She welcomes the player warmly, like a friend.",
  serve: "She serves the player politely, business as usual.",
  wary: "She is guarded and lets the player know she remembers what they did.",
  refuse: "She refuses to deal with the player.",
  call_guards: "She feels in danger and shouts for the guards.",
};

const SYSTEM = [
  "You write dialogue for Mira, an apple seller at a market stall in a small town.",
  "The game has already decided how she reacts. Your line must match that decision exactly; never change her mind or her price.",
  "Write only the words she says out loud: one or two short sentences, plain and natural.",
  "No quotation marks, no narration, no name prefix.",
].join("\n");

export function dialoguePrompt(m: Memory, d: Decision): ChatMessage[] {
  const lines = [describe(m), "", `Decision: ${DOES[d.reaction]}`];
  if (d.price === "no sale") lines.push("She won't sell the apple.");
  else if (d.price) lines.push(`She charges ${d.price} for the apple. The usual price is 2 coins.`);
  if (m.last === "say") lines.push("Answer what the player just said.");
  lines.push("", "What does Mira say?");
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: lines.join("\n") },
  ];
}

/** Small models like to wrap the line in quotes or prefix it with her name. */
export function cleanLine(raw: string): string | null {
  let s = raw.trim().split("\n").find((l) => l.trim()) ?? "";
  s = s.replace(/^\s*(mira)\s*:\s*/i, "").trim();
  s = s.replace(/^["“'](.*)["”']$/s, "$1").trim();
  if (!s || s.length > 240) return null;
  return s;
}

export async function speak(m: Memory, d: Decision, ollama: Ollama, model: string | null): Promise<Spoken> {
  const start = performance.now();
  const authored = (fallbackReason?: string): Spoken => ({
    line: authoredLine(m, d.reaction, d.price),
    by: "authored lines",
    ms: performance.now() - start,
    fallbackReason,
  });
  if (!model) return authored();

  const prompt = dialoguePrompt(m, d);
  try {
    const line = cleanLine(await ollama.chat(model, prompt));
    if (!line) return { ...authored(`${model} gave an unusable line`), prompt };
    return { line, by: model, ms: performance.now() - start, prompt };
  } catch (e) {
    return { ...authored(`${model} unavailable (${(e as Error).message})`), prompt };
  }
}
