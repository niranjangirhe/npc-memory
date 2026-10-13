import { test } from "node:test";
import assert from "node:assert/strict";
import { notes, replay, type Event } from "../src/memory.ts";

const acts = (...a: Event["action"][]) => a.map((action) => ({ action }));

test("helping builds trust and calms her down", () => {
  const m = replay(acts("bump", "help"));
  assert.equal(m.trust, 13);
  assert.equal(m.annoyance, 5);
});

test("feelings stay inside their bounds", () => {
  const m = replay(acts(...Array(10).fill("hit")));
  assert.deepEqual([m.trust, m.annoyance, m.fear], [-100, 100, 100]);
});

test("an offence after an apology counts as a broken apology", () => {
  const m = replay(acts("steal", "apologise", "steal", "apologise", "bump"));
  assert.equal(m.brokenApologies, 2);
});

test("a night halves annoyance and grudges fade slowly", () => {
  const m = replay(acts("steal", "wait"));
  assert.deepEqual([m.day, m.annoyance, m.trust], [2, 10, -18]);
});

test("notes describe the history in plain words", () => {
  assert.deepEqual(notes(replay(acts("help", "help", "steal"))), ["You carried her crates twice.", "You stole an apple."]);
  assert.deepEqual(notes(replay([])), []);
});
