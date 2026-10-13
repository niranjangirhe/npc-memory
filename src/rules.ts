/**
 * Built-in decision rules. Hand-tuned formulas turn Mira's memory into a
 * score for each option the game supports. They answer the same questions as
 * the typed decision model and take over when it isn't running.
 */
import type { Memory } from "./memory.ts";

export const REACTIONS = ["welcome", "serve", "wary", "refuse", "call_guards"] as const;
export type Reaction = (typeof REACTIONS)[number];

export const PRICES = ["1 coin", "2 coins", "3 coins", "no sale"] as const;
export type Price = (typeof PRICES)[number];

export type Option<T extends string> = { id: T; p: number };

export type Scores = { reaction: Option<Reaction>[]; price: Option<Price>[] };

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

function softmax<T extends string>(ids: readonly T[], logits: number[], temp: number): Option<T>[] {
  const e = logits.map((l) => Math.exp(l / temp));
  const s = e.reduce((a, b) => a + b, 0);
  return ids.map((id, i) => ({ id, p: e[i] / s }));
}

export const best = <T extends string>(o: Option<T>[]) => o.reduce((a, b) => (b.p > a.p ? b : a));

export function scoreWithRules(m: Memory): Scores {
  const t = m.trust / 100;
  const a = m.annoyance / 100;
  const f = m.fear / 100;
  const c = m.counts;

  let deliberate = 0;
  if (m.last === "bump") {
    // one bump is an accident; a pattern, or a broken promise, isn't
    deliberate = sigmoid(-1.1 + 1.1 * (c.bump - 1) + 1.4 * m.brokenApologies - 3 * t);
  } else if (m.last === "steal") deliberate = 0.94;
  else if (m.last === "hit") deliberate = 0.97;

  const logits = [
    /* welcome */ 3.5 * t - 2 * a - 3 * f - 2 * deliberate + (m.last === "help" ? 0.8 : 0),
    /* serve */ 1 - 1.8 * Math.abs(t) - a - 1.5 * f,
    /* wary */ 1.2 * a + (t < 0 ? -1.5 * t : 0) + 2.2 * deliberate + (m.last === "steal" ? 1 : 0),
    /* refuse */ -3.5 * t - 1.8 + (m.last === "steal" ? 0.6 * c.steal : 0),
    /* call_guards */ 5 * f + 1.5 * c.hit - 3.5 + (m.last === "hit" ? 1.5 : 0),
  ];
  const reaction = softmax(REACTIONS, logits, 0.5);

  // Goodwill pulls the price down and grievances push it up. They are weighed
  // separately, so a friend who once stole leaves her torn, not average.
  const goodwill = 0.9 * c.help + 0.3 * Math.max(0, c.buy - (m.last === "buy" ? 1 : 0)) + 0.1 * c.greet;
  const grievance = 1.6 * c.steal + 2 * c.hit + 0.5 * m.brokenApologies + 0.2 * c.bump;
  const weights = [goodwill ** 2, 1, grievance ** 2, Math.max(0, grievance - 3.5) ** 2 * 4].map((w) => w + 0.04);
  const total = weights.reduce((x, y) => x + y, 0);
  const price = PRICES.map((id, k) => ({ id, p: weights[k] / total }));

  return { reaction, price };
}
