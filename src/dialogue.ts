/**
 * The dialogue step. The decision is already made; a small language model
 * only turns it into something Mira says to the player. If the model is off,
 * offline, or keeps narrating instead of talking, she says an authored line.
 */
import type { Decision } from "./decision.ts";
import { authoredLine } from "./lines.ts";
import type { Action, Memory } from "./memory.ts";
import type { ChatMessage, ChatResult, Ollama } from "./ollama.ts";
import type { Reaction } from "./rules.ts";

export type Spoken = {
  line: string;
  by: string;
  ms: number;
  fallbackReason?: string;
  /** what the language model was asked, for the "behind the scenes" panel */
  prompt?: ChatMessage[];
  /** Ollama's timings for the call that produced the line */
  stats?: Omit<ChatResult, "content"> & { attempts: number };
};

/* ---------------- the prompt ---------------- */

// Everything is written to Mira as "you" and about the player as "they", so a
// small model answers in her voice instead of describing her.

const THEY: Record<Action, string> = {
  greet: "said hello",
  buy: "asked to buy an apple",
  help: "carried your crates",
  bump: "walked into you",
  steal: "stole an apple from you",
  hit: "hit you",
  apologise: "apologised",
  say: "said",
  wait: "",
};

const DO: Record<Reaction, string> = {
  welcome: "Welcome them warmly, like a friend.",
  serve: "Be polite, like with any customer.",
  wary: "Be guarded. Let them know you remember what they did.",
  refuse: "Refuse to deal with them.",
  call_guards: "You feel in danger. Tell them to stay back and shout for the guards.",
};

function when(day: number, today: number) {
  const ago = today - day;
  return ago === 0 ? "Today" : ago === 1 ? "Yesterday" : `${ago} days ago`;
}

function feelings(m: Memory) {
  const out: string[] = [];
  if (m.trust > 40) out.push("you trust them");
  else if (m.trust > 10) out.push("you like them");
  else if (m.trust < -40) out.push("you deeply distrust them");
  else if (m.trust < -10) out.push("you distrust them");
  if (m.fear > 40) out.push("you are afraid of them");
  if (m.annoyance > 60) out.push("you are very annoyed");
  else if (m.annoyance > 25) out.push("you are a little annoyed");
  return out.length ? out.join(", ") : "nothing in particular";
}

export function situation(m: Memory, d: Decision): string {
  const past = m.log
    .slice(0, -1)
    .filter((e) => e.action !== "wait")
    .map((e) => (e.action === "say" ? `${when(e.day, m.day)} they said "${e.text}".` : `${when(e.day, m.day)} they ${THEY[e.action]}.`));
  const last = m.log.at(-1);
  const now =
    !last || last.action === "wait"
      ? "They just walked up to your stall."
      : last.action === "say"
        ? `They just said to you: "${last.text}"`
        : `They just ${THEY[last.action]}.`;
  const lines = [
    `What has happened: ${past.length ? past.join(" ") : "You have never met them before."}`,
    now,
    `You feel: ${feelings(m)}.`,
    `Do this: ${DO[d.reaction]}`,
  ];
  if (d.price === "no sale") lines.push("Don't sell them the apple.");
  else if (d.price) lines.push(`Sell them the apple for ${d.price}. The usual price is 2 coins.`);
  if (last?.action === "say") lines.push("Answer what they said.");
  return lines.join("\n");
}

const SYSTEM = [
  "You are Mira, an apple seller at a market stall in a small town.",
  "Reply with only the words you say out loud to the customer in front of you, in the first person.",
  "One or two short sentences. Never describe yourself or what you do, never narrate, and never use quotation marks.",
].join("\n");

// two short examples teach a small model the format better than more rules do
const EXAMPLES: ChatMessage[] = [
  {
    role: "user",
    content:
      "What has happened: Today they carried your crates.\nThey just carried your crates.\nYou feel: you like them.\nDo this: Welcome them warmly, like a friend.",
  },
  { role: "assistant", content: "You're a treasure. Here, take an apple for your trouble." },
  {
    role: "user",
    content:
      "What has happened: Yesterday they stole an apple from you. Yesterday they stole an apple from you.\nThey just asked to buy an apple.\nYou feel: you distrust them.\nDo this: Be guarded. Let them know you remember what they did.\nSell them the apple for 3 coins. The usual price is 2 coins.",
  },
  { role: "assistant", content: "Three coins. And don't think I've forgotten those two apples." },
];

export function dialoguePrompt(m: Memory, d: Decision): ChatMessage[] {
  return [{ role: "system", content: SYSTEM }, ...EXAMPLES, { role: "user", content: situation(m, d) }];
}

/* ---------------- keeping only what she says ---------------- */

const NARRATION = /\b(mira|the player|the customer)\b|^(she|her)\b/i;

/**
 * Small models still slip into narration ("Mira's eyes dart to the apples...").
 * Strip stage directions and quotes, drop any sentence that describes her, and
 * return null if nothing spoken is left.
 */
export function cleanLine(raw: string): string | null {
  let s = raw.trim().split("\n").find((l) => l.trim()) ?? "";
  s = s.replace(/\*[^*]*\*/g, " ").replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
  s = s.replace(/^\s*mira\s*:\s*/i, "");
  // if she is quoted inside narration, keep only the quoted words
  const quoted = s.match(/["“]([^"”]+)["”]/g);
  if (quoted && NARRATION.test(s)) s = quoted.map((q) => q.slice(1, -1)).join(" ");
  s = s.replace(/["“”]/g, "").replace(/\s+/g, " ").trim();
  const sentences = s.match(/[^.!?…]+[.!?…]*/g) ?? [];
  s = sentences
    .map((x) => x.trim())
    .filter((x) => x && !NARRATION.test(x))
    .join(" ");
  if (!s || s.length > 240) return null;
  return s;
}

/* ---------------- speaking ---------------- */

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
  let last: ChatResult | undefined;
  try {
    // one retry, a little cooler, if the first answer was all narration
    for (const [attempt, temperature] of [0.8, 0.4].entries()) {
      last = await ollama.chat(model, prompt, { temperature });
      const line = cleanLine(last.content);
      const { content: _content, ...rest } = last;
      if (line) return { line, by: model, ms: performance.now() - start, prompt, stats: { ...rest, attempts: attempt + 1 } };
    }
    const { content: _content, ...rest } = last!;
    return { ...authored(`${model} only narrated`), prompt, stats: { ...rest, attempts: 2 } };
  } catch (e) {
    return { ...authored(`${model} unavailable (${(e as Error).message})`), prompt };
  }
}
