import { test } from "node:test";
import assert from "node:assert/strict";
import { GliclassModel, RulesModel } from "../src/decision.ts";
import { Ollama } from "../src/ollama.ts";
import { randomPlay, runBench, stats } from "../src/bench.ts";

test("the same seed plays the same game", () => {
  assert.deepEqual(randomPlay(20, 7), randomPlay(20, 7));
  assert.notDeepEqual(randomPlay(20, 7), randomPlay(20, 8));
  assert.ok(randomPlay(50, 1).some((e) => e.action === "say" && e.text));
});

test("stats", () => {
  assert.deepEqual(stats([5, 1, 3, 2, 4]), { mean: 3, p50: 3, p95: 5, max: 5 });
});

test("runs a benchmark and reports latency, tokens and fallbacks", async () => {
  const reply = JSON.stringify({
    message: { content: "Two coins, same as anyone." },
    eval_count: 10,
    eval_duration: 200e6,
    load_duration: 0,
  });
  const fetchImpl = (async (url: string) => {
    if (String(url).endsWith("/api/version")) return new Response(JSON.stringify({ version: "test" }));
    if (String(url).endsWith("/api/ps")) return new Response(JSON.stringify({ models: [{ name: "m:1", size: 2 ** 29, size_vram: 0 }] }));
    return new Response(reply);
  }) as typeof fetch;
  const offline = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  const seen: number[] = [];
  const r = await runBench(
    { turns: 6, seed: 3, decider: "gliclass", voice: "m:1" },
    { gliclass: new GliclassModel("http://fake", offline), rules: new RulesModel(), ollama: new Ollama("http://fake", fetchImpl) },
    (_t, done) => seen.push(done),
  );
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6]);
  assert.equal(r.turns.length, 6);
  assert.equal(r.summary.decisionFallbacks, 6);
  assert.equal(r.summary.dialogueFallbacks, 0);
  assert.equal(r.summary.tokensPerSecond, 50);
  assert.equal(r.services.voiceModel?.sizeMB, 512);
  assert.equal(r.services.decider, null);
});
