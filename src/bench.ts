/**
 * Benchmark: plays a seeded random game for a number of turns with the chosen
 * models and measures how long each step takes, how fast the language model
 * generates, how often each step falls back, and how much memory the models
 * use. Used by both the Benchmark page and `npm run bench`.
 */
import os from "node:os";
import type { DeciderHealth } from "./decision.ts";
import type { Action, Event } from "./memory.ts";
import type { LoadedModel } from "./ollama.ts";
import { takeTurn, type Services, type Settings } from "./turn.ts";

export type BenchOptions = Settings & { turns: number; seed: number };

export type BenchTurn = {
  turn: number;
  event: Event;
  reaction: string;
  price: string | null;
  line: string;
  decisionBy: string;
  voiceBy: string;
  decisionMs: number;
  /** time inside GLiClass itself, without the HTTP round trip */
  decisionModelMs: number | null;
  dialogueMs: number;
  totalMs: number;
  outputTokens: number | null;
  tokensPerSecond: number | null;
  /** non-zero when Ollama had to load the model for this call */
  loadMs: number | null;
  attempts: number | null;
  decisionFellBack: boolean;
  dialogueFellBack: boolean;
};

type Stats = { mean: number; p50: number; p95: number; max: number };

export type BenchResult = {
  options: BenchOptions;
  startedAt: string;
  wallSeconds: number;
  machine: { cpu: string; cores: number; ramGB: number; platform: string; node: string };
  services: {
    decider: DeciderHealth | null;
    ollamaVersion: string | null;
    /** the language model as Ollama reports it after the run */
    voiceModel: LoadedModel | null;
    serverRssMB: number;
  };
  summary: {
    firstTurnMs: number;
    /** all latencies below leave out the first turn, which includes warm-up */
    decisionMs: Stats;
    decisionModelMs: Stats | null;
    dialogueMs: Stats;
    turnMs: Stats;
    tokensPerSecond: number | null;
    outputTokens: number | null;
    modelLoadMs: number | null;
    retries: number;
    decisionFallbacks: number;
    dialogueFallbacks: number;
    reactions: Record<string, number>;
    prices: Record<string, number>;
  };
  turns: BenchTurn[];
};

/* ---------------- a seeded random player ---------------- */

const SAYINGS = [
  "Good morning!",
  "How much for an apple?",
  "Sorry about yesterday.",
  "Your apples look great today.",
  "Can I get a discount?",
  "I didn't take anything, I swear.",
  "Need a hand with those crates?",
  "Why are you looking at me like that?",
];

const WEIGHTS: [Action, number][] = [
  ["greet", 3],
  ["buy", 4],
  ["help", 2],
  ["apologise", 1],
  ["bump", 1],
  ["steal", 1.5],
  ["hit", 0.5],
  ["say", 3],
  ["wait", 2],
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The same seed always gives the same game, so runs can be compared. */
export function randomPlay(turns: number, seed: number): Event[] {
  const rand = mulberry32(seed);
  const total = WEIGHTS.reduce((s, [, w]) => s + w, 0);
  const events: Event[] = [];
  for (let i = 0; i < turns; i++) {
    let r = rand() * total;
    const action = WEIGHTS.find(([, w]) => (r -= w) < 0)?.[0] ?? "greet";
    events.push(action === "say" ? { action, text: SAYINGS[Math.floor(rand() * SAYINGS.length)] } : { action });
  }
  return events;
}

/* ---------------- statistics ---------------- */

export function stats(xs: number[]): Stats {
  if (!xs.length) return { mean: 0, p50: 0, p95: 0, max: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { mean: s.reduce((a, b) => a + b, 0) / s.length, p50: at(0.5), p95: at(0.95), max: s.at(-1)! };
}

const count = (xs: string[]) => xs.reduce<Record<string, number>>((o, x) => ((o[x] = (o[x] ?? 0) + 1), o), {});

/* ---------------- running ---------------- */

export async function runBench(
  opts: BenchOptions,
  services: Services,
  onTurn?: (t: BenchTurn, done: number) => void,
): Promise<BenchResult> {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const play = randomPlay(opts.turns, opts.seed);
  const turns: BenchTurn[] = [];

  for (let i = 0; i < play.length; i++) {
    const t0 = performance.now();
    const r = await takeTurn(play.slice(0, i + 1), opts, services);
    const st = r.spoken.stats;
    const row: BenchTurn = {
      turn: i + 1,
      event: play[i],
      reaction: r.decision.reaction,
      price: r.decision.price,
      line: r.spoken.line,
      decisionBy: r.decision.by,
      voiceBy: r.spoken.by,
      decisionMs: r.decision.ms,
      decisionModelMs: r.decision.modelMs ?? null,
      dialogueMs: r.spoken.ms,
      totalMs: performance.now() - t0,
      outputTokens: st ? st.outputTokens : null,
      tokensPerSecond: st && st.generateMs > 0 ? (st.outputTokens / st.generateMs) * 1000 : null,
      loadMs: st ? st.loadMs : null,
      attempts: st ? st.attempts : null,
      decisionFellBack: Boolean(r.decision.fallbackReason),
      dialogueFellBack: Boolean(r.spoken.fallbackReason),
    };
    turns.push(row);
    onTurn?.(row, i + 1);
  }

  const warm = turns.length > 1 ? turns.slice(1) : turns;
  const nums = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);
  const modelMs = nums(warm.map((t) => t.decisionModelMs));
  const tps = nums(warm.map((t) => t.tokensPerSecond));
  const tokens = nums(turns.map((t) => t.outputTokens));
  const loads = nums(turns.map((t) => t.loadMs));

  const [decider, ollamaVersion, loaded] = await Promise.all([
    services.gliclass.health(),
    services.ollama.version(),
    services.ollama.loaded(),
  ]);
  const voice = opts.voice;

  return {
    options: opts,
    startedAt,
    wallSeconds: (performance.now() - start) / 1000,
    machine: {
      cpu: os.cpus()[0]?.model.trim() ?? "unknown",
      cores: os.cpus().length,
      ramGB: Math.round(os.totalmem() / 2 ** 30),
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      node: process.version,
    },
    services: {
      decider: opts.decider === "gliclass" ? decider : null,
      ollamaVersion: voice ? ollamaVersion : null,
      voiceModel: voice ? (loaded.find((m) => m.name === voice || m.name === `${voice}:latest`) ?? null) : null,
      serverRssMB: process.memoryUsage().rss / 2 ** 20,
    },
    summary: {
      firstTurnMs: turns[0]?.totalMs ?? 0,
      decisionMs: stats(warm.map((t) => t.decisionMs)),
      decisionModelMs: modelMs.length ? stats(modelMs) : null,
      dialogueMs: stats(warm.map((t) => t.dialogueMs)),
      turnMs: stats(warm.map((t) => t.totalMs)),
      tokensPerSecond: tps.length ? tps.reduce((a, b) => a + b, 0) / tps.length : null,
      outputTokens: tokens.length ? tokens.reduce((a, b) => a + b, 0) / tokens.length : null,
      modelLoadMs: loads.length ? Math.max(...loads) : null,
      retries: turns.filter((t) => (t.attempts ?? 1) > 1).length,
      decisionFallbacks: turns.filter((t) => t.decisionFellBack).length,
      dialogueFallbacks: turns.filter((t) => t.dialogueFellBack).length,
      reactions: count(turns.map((t) => t.reaction)),
      prices: count(turns.flatMap((t) => (t.price ? [t.price] : []))),
    },
    turns,
  };
}
