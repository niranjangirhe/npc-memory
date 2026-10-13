import { test } from "node:test";
import assert from "node:assert/strict";
import { GliclassModel, PRICE_LABELS, REACTION_LABELS, RulesModel, decide, describe, supportedOptions } from "../src/decision.ts";
import { replay, type Event } from "../src/memory.ts";

const acts = (...a: Event["action"][]) => a.map((action) => ({ action }));

/** A stand-in for decider/server.py that scores the labels it is given. */
function fakeDecider(score: (label: string) => number) {
  const bodies: { text: string; questions: Record<string, string[]> }[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const scores = Object.fromEntries(
      Object.entries(body.questions as Record<string, string[]>).map(([q, labels]) => [q, Object.fromEntries(labels.map((l) => [l, score(l)]))]),
    );
    return new Response(JSON.stringify({ scores, ms: 5 }));
  }) as typeof fetch;
  return { model: new GliclassModel("http://fake", fetchImpl), bodies };
}

test("the game only asks about price after a purchase", () => {
  assert.deepEqual(supportedOptions(replay(acts("greet"))).price, []);
  assert.equal(supportedOptions(replay(acts("buy"))).price.length, 4);
});

test("the rules: a regular gets a discount and a thief pays more", async () => {
  const regular = await decide(replay(acts("help", "help", "wait", "buy", "help", "wait", "buy")), new RulesModel());
  assert.deepEqual([regular.reaction, regular.price], ["welcome", "1 coin"]);
  const thief = await decide(replay(acts("steal", "steal", "wait", "buy")), new RulesModel());
  assert.deepEqual([thief.reaction, thief.price], ["wary", "3 coins"]);
});

test("GLiClass gets her history and the supported options, and its best option wins", async () => {
  const { model, bodies } = fakeDecider((l) => (l === REACTION_LABELS.refuse || l === PRICE_LABELS["no sale"] ? 0.9 : 0.1));
  const d = await decide(replay(acts("steal", "wait", "buy")), model);
  assert.equal(d.by, "GLiClass");
  assert.deepEqual([d.reaction, d.price], ["refuse", "no sale"]);
  assert.match(bodies[0].text, /stole an apple/);
  assert.deepEqual(Object.keys(bodies[0].questions), ["reaction", "price"]);
  const total = d.scores.reaction.reduce((s, o) => s + o.p, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
});

test("when GLiClass is down the built-in rules decide", async () => {
  const down = new GliclassModel("http://fake", (async () => {
    throw new Error("connection refused");
  }) as typeof fetch);
  const d = await decide(replay(acts("hit")), down);
  assert.equal(d.by, "built-in rules");
  assert.match(d.fallbackReason!, /connection refused/);
});

test("the description covers her history and what just happened", () => {
  const text = describe(replay(acts("help", "wait", "steal")));
  assert.match(text, /Day 1: the player carried her crates\. .*Day 2: the player stole an apple from her\./);
  assert.match(text, /The player just stole an apple from her\./);
});

test("refusing or calling the guards means no sale, whatever the price scores say", async () => {
  const { model } = fakeDecider((l) => (l === REACTION_LABELS.call_guards || l === PRICE_LABELS["3 coins"] ? 0.9 : 0.1));
  const d = await decide(replay(acts("hit", "buy")), model);
  assert.deepEqual([d.reaction, d.price], ["call_guards", "no sale"]);
});
