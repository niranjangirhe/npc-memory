/**
 * The decision step. A typed decision model gets Mira's history and the
 * current game state, and picks from the actions the game supports. It
 * returns a score for every option, so game code can use the answer directly.
 *
 * Two models answer the same questions:
 *  - GLiClass, an open-source zero-shot classifier, run by decider/server.py
 *  - the built-in rules in rules.ts, used when GLiClass isn't running
 */
import type { Action, Memory } from "./memory.ts";
import { PRICES, REACTIONS, best, scoreWithRules, type Option, type Price, type Reaction } from "./rules.ts";

/** What the game lets Mira do right now. She only names a price after a sale. */
export function supportedOptions(m: Memory) {
  return { reaction: [...REACTIONS], price: m.last === "buy" ? [...PRICES] : [] };
}

export type Decision = {
  reaction: Reaction;
  price: Price | null;
  scores: { reaction: Option<Reaction>[]; price: Option<Price>[] };
  by: string;
  ms: number;
  /** set when the preferred model failed and the rules answered instead */
  fallbackReason?: string;
};

export interface DecisionModel {
  readonly name: string;
  scores(m: Memory): Promise<Decision["scores"]>;
}

export class RulesModel implements DecisionModel {
  readonly name = "built-in rules";
  async scores(m: Memory) {
    return scoreWithRules(m);
  }
}

/* ---------------- describing the game state ---------------- */

const PAST: Record<Action, string> = {
  greet: "said hello",
  buy: "bought an apple",
  help: "carried her crates",
  bump: "bumped into her",
  steal: "stole an apple from her",
  hit: "hit her",
  apologise: "apologised",
  say: "said",
  wait: "stayed away until the next day",
};

function level(v: number, words: [number, string][]) {
  return words.find(([limit]) => v >= limit)?.[1] ?? words.at(-1)![1];
}

/** The text the decision model classifies: her history, then the state now. */
export function describe(m: Memory): string {
  const history = m.log.map((e) =>
    e.action === "say" ? `Day ${e.day}: the player said "${e.text}".` : `Day ${e.day}: the player ${PAST[e.action]}.`,
  );
  const c = m.counts;
  const n = (k: number, one: string, many: string) => (k === 1 ? one : `${k} ${many}`);
  const totals = [
    c.help && `carried her crates ${n(c.help, "once", "times")}`,
    c.buy && `bought ${n(c.buy, "one apple", "apples")}`,
    c.steal && `stolen ${n(c.steal, "one apple", "apples")}`,
    c.hit && `hit her ${n(c.hit, "once", "times")}`,
    c.bump && `bumped into her ${n(c.bump, "once", "times")}`,
    m.brokenApologies && `broken ${n(m.brokenApologies, "an apology", "apologies")}`,
  ].filter(Boolean);
  const trust = level(m.trust, [
    [40, "She trusts the player."],
    [10, "She mostly likes the player."],
    [-10, "She has no strong feelings about the player."],
    [-40, "She distrusts the player."],
    [-101, "She deeply distrusts the player."],
  ]);
  const annoyed = level(m.annoyance, [
    [60, "She is very annoyed."],
    [25, "She is a little annoyed."],
    [0, "She is calm."],
  ]);
  const afraid = level(m.fear, [
    [40, "She is afraid of the player."],
    [10, "She is a little nervous."],
    [0, ""],
  ]);
  const now =
    m.last === null
      ? "The player walks up to her stall."
      : m.last === "say"
        ? `The player just said: "${m.log.at(-1)?.text}".`
        : `The player just ${PAST[m.last]}.`;
  return [
    "Mira sells apples at a market stall.",
    history.length ? history.join(" ") : "She has never met the player.",
    totals.length ? `In total the player has ${totals.join(", ")}.` : "",
    trust,
    annoyed,
    afraid,
    now,
  ]
    .filter(Boolean)
    .join(" ");
}

/* ---------------- GLiClass ---------------- */

/** Each option is described in words, because GLiClass matches text to labels. */
export const REACTION_LABELS: Record<Reaction, string> = {
  welcome: "Mira greets the player warmly, like a friend",
  serve: "Mira serves the player politely, business as usual",
  wary: "Mira is guarded and lets the player know she remembers what they did",
  refuse: "Mira refuses to deal with the player",
  call_guards: "Mira feels in danger and shouts for the guards",
};

export const PRICE_LABELS: Record<Price, string> = {
  "1 coin": "Mira gives the player a discount of one coin",
  "2 coins": "Mira charges the usual price of two coins",
  "3 coins": "Mira charges the player extra, three coins",
  "no sale": "Mira won't sell to the player",
};

const TASK = "Decide how Mira, an apple seller, responds to the player, given everything the player has done to her.";

function normalise<T extends string>(ids: readonly T[], labels: Record<T, string>, raw: Record<string, number>): Option<T>[] {
  const s = ids.map((id) => raw[labels[id]] ?? 0);
  const total = s.reduce((a, b) => a + b, 0) || 1;
  return ids.map((id, i) => ({ id, p: s[i] / total }));
}

export class GliclassModel implements DecisionModel {
  readonly name = "GLiClass";

  constructor(
    readonly url = process.env.DECIDER_URL ?? "http://127.0.0.1:8765",
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  async health(): Promise<{ model: string; device: string } | null> {
    try {
      const res = await this.fetchImpl(`${this.url}/health`, { signal: AbortSignal.timeout(1500) });
      return res.ok ? ((await res.json()) as { model: string; device: string }) : null;
    } catch {
      return null;
    }
  }

  async scores(m: Memory) {
    const options = supportedOptions(m);
    const questions: Record<string, string[]> = { reaction: options.reaction.map((r) => REACTION_LABELS[r]) };
    if (options.price.length) questions.price = options.price.map((p) => PRICE_LABELS[p]);
    const res = await this.fetchImpl(`${this.url}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: describe(m), prompt: TASK, questions }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`decider: ${res.status} ${await res.text()}`);
    const { scores } = (await res.json()) as { scores: Record<string, Record<string, number>> };
    return {
      reaction: normalise(REACTIONS, REACTION_LABELS, scores.reaction ?? {}),
      price: options.price.length ? normalise(PRICES, PRICE_LABELS, scores.price ?? {}) : [],
    };
  }
}

/* ---------------- deciding ---------------- */

export async function decide(m: Memory, preferred: DecisionModel, rules: DecisionModel = new RulesModel()): Promise<Decision> {
  const start = performance.now();
  let by = preferred.name;
  let fallbackReason: string | undefined;
  let scores: Decision["scores"];
  try {
    scores = await preferred.scores(m);
  } catch (e) {
    by = rules.name;
    fallbackReason = `${preferred.name} unavailable (${(e as Error).message})`;
    scores = await rules.scores(m);
  }
  if (m.last !== "buy") scores = { ...scores, price: [] };
  return {
    reaction: best(scores.reaction).id,
    price: scores.price.length ? best(scores.price).id : null,
    scores,
    by,
    ms: performance.now() - start,
    fallbackReason,
  };
}
