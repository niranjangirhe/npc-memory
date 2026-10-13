/**
 * What Mira remembers about the player. Every action nudges a few numbers and
 * goes into a short log; both her scripted rules and the language model read
 * from this.
 */

export const ACTIONS = ["greet", "buy", "help", "bump", "steal", "hit", "apologise", "wait"] as const;
export type Action = (typeof ACTIONS)[number];

export const OFFENCES: Action[] = ["bump", "steal", "hit"];

/** One thing the player did. */
export type Event = { action: Action };

export type Memory = {
  day: number;
  trust: number; // -100..100
  annoyance: number; // 0..100
  fear: number; // 0..100
  counts: Record<Action, number>;
  /** apologised, then offended again */
  brokenApologies: number;
  apologisedSinceOffence: boolean;
  last: Action | null;
  /** the last ten events, each tagged with the day it happened */
  log: (Event & { day: number })[];
};

export const fresh = (): Memory => ({
  day: 1,
  trust: 0,
  annoyance: 0,
  fear: 0,
  counts: { greet: 0, buy: 0, help: 0, bump: 0, steal: 0, hit: 0, apologise: 0, wait: 0 },
  brokenApologies: 0,
  apologisedSinceOffence: false,
  last: null,
  log: [],
});

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function apply(m: Memory, e: Event): Memory {
  const a = e.action;
  const n: Memory = {
    ...m,
    counts: { ...m.counts, [a]: m.counts[a] + 1 },
    last: a,
    log: [...m.log, { ...e, day: m.day }].slice(-10),
  };
  if (OFFENCES.includes(a) && m.apologisedSinceOffence) {
    n.brokenApologies++;
    n.apologisedSinceOffence = false;
  }
  // an apology is worth less every time it was followed by another offence
  const sincerity = 1 / (1 + n.brokenApologies);
  switch (a) {
    case "greet":
      if (m.annoyance < 50) n.trust += 3;
      n.annoyance -= 2;
      break;
    case "buy":
      n.trust += 5;
      break;
    case "help":
      n.trust += 15;
      n.annoyance -= 10;
      break;
    case "bump":
      n.annoyance += m.counts.bump >= 2 ? 25 : 15;
      n.trust -= 2;
      break;
    case "steal":
      n.trust -= 20;
      n.annoyance += 20;
      break;
    case "hit":
      n.fear += 35;
      n.trust -= 30;
      n.annoyance += 20;
      break;
    case "apologise":
      n.annoyance -= 20 * sincerity;
      n.trust += 5 * sincerity;
      n.apologisedSinceOffence = true;
      break;
    case "wait":
      n.day++;
      n.annoyance *= 0.5;
      n.fear *= 0.6;
      // goodwill holds; grudges fade slowly
      if (n.trust < 0) n.trust *= 0.9;
      break;
  }
  n.trust = clamp(n.trust, -100, 100);
  n.annoyance = clamp(n.annoyance, 0, 100);
  n.fear = clamp(n.fear, 0, 100);
  return n;
}

export const replay = (events: readonly Event[]): Memory => events.reduce(apply, fresh());

/** Plain-language notes for the side panel. */
export function notes(m: Memory): string[] {
  const c = m.counts;
  const out: string[] = [];
  if (c.help) out.push(`You carried her crates ${times(c.help)}.`);
  if (c.buy) out.push(`You bought from her ${times(c.buy)}.`);
  if (c.steal) out.push(`You stole ${c.steal === 1 ? "an apple" : `${c.steal} apples`}.`);
  if (c.hit) out.push(`You hit her ${times(c.hit)}.`);
  if (c.bump >= 2) out.push(`You keep walking into her (${c.bump} times).`);
  if (m.brokenApologies >= 2) out.push("She no longer believes your apologies.");
  else if (m.brokenApologies === 1) out.push("You apologised once and did it again.");
  if (m.fear > 40) out.push("She keeps her distance.");
  else if (m.annoyance > 60) out.push("She turns away when you come near.");
  if (m.trust > 40) out.push("She thinks of you as a friend.");
  else if (m.trust < -30) out.push("She has been warning the other stalls about you.");
  return out;
}

const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
