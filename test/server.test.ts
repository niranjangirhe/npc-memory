import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { GliclassModel, RulesModel } from "../src/decision.ts";
import { Ollama } from "../src/ollama.ts";
import { createApp } from "../src/server.ts";

const offline = (async () => {
  throw new Error("offline");
}) as typeof fetch;
const server = createApp(process.cwd(), {
  gliclass: new GliclassModel("http://fake", offline),
  rules: new RulesModel(),
  ollama: new Ollama("http://fake", offline),
}).listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

const turn = (body: unknown) => fetch(`${base}/api/turn`, { method: "POST", body: JSON.stringify(body) });

test("serves the game page", async () => {
  const res = await fetch(base);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Mira's apple stall/);
});

test("reports what is running", async () => {
  assert.deepEqual(await (await fetch(`${base}/api/status`)).json(), { gliclass: null, ollama: null });
});

test("plays a turn, falling back to the rules and authored lines when nothing else runs", async () => {
  const r = await (await turn({ events: [{ action: "hit" }], decider: "gliclass", voice: "qwen3:0.6b" })).json();
  assert.equal(r.decision.by, "built-in rules");
  assert.equal(r.spoken.by, "authored lines");
  assert.equal(r.memory.counts.hit, 1);
  assert.ok(r.spoken.line.length > 0);
});

test("rejects bad input and paths outside web/", async () => {
  assert.equal((await turn({ events: [{ action: "dance" }] })).status, 400);
  assert.equal((await turn({ events: [{ action: "say", text: "" }] })).status, 400);
  assert.equal((await fetch(`${base}/..%2Fpackage.json`)).status, 404);
});

test("streams a benchmark one turn at a time", async () => {
  const res = await fetch(`${base}/api/bench`, { method: "POST", body: JSON.stringify({ turns: 3, decider: "rules" }) });
  const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.type), ["turn", "turn", "turn", "done"]);
  assert.equal(lines.at(-1).result.turns.length, 3);
});
