import { test } from "node:test";
import assert from "node:assert/strict";
import { RulesModel, decide } from "../src/decision.ts";
import { cleanLine, speak } from "../src/dialogue.ts";
import { replay } from "../src/memory.ts";
import { Ollama } from "../src/ollama.ts";

function fakeOllama(reply: string | Error) {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify({ message: { content: reply } }));
  }) as typeof fetch;
  return { ollama: new Ollama("http://fake", fetchImpl), bodies };
}

const thief = replay([{ action: "steal" }, { action: "steal" }, { action: "wait" }, { action: "buy" }]);

test("cleanLine strips quotes and name prefixes", () => {
  assert.equal(cleanLine('Mira: "Three coins. I remember you."'), "Three coins. I remember you.");
  assert.equal(cleanLine("\n  Fine.  \nextra"), "Fine.");
  assert.equal(cleanLine("   "), null);
});

test("cleanLine keeps what she says and drops narration", () => {
  assert.equal(
    cleanLine("Mira's eyes dart to the apples and she feels in danger and shouts for the guards. She charges 3 coins for the apple."),
    null,
  );
  assert.equal(cleanLine('Mira narrows her eyes. "Three coins. I saw what you did."'), "Three coins. I saw what you did.");
  assert.equal(cleanLine("*crosses her arms* Two coins, like anyone else."), "Two coins, like anyone else.");
  assert.equal(cleanLine("Back off! Guards! She backs away."), "Back off! Guards!");
});

test("the language model is told the decision and only writes the line", async () => {
  const d = await decide(thief, new RulesModel());
  const { ollama, bodies } = fakeOllama("Three coins, and I'm watching you.");
  const s = await speak(thief, d, ollama, "qwen3:0.6b");
  assert.equal(s.line, "Three coins, and I'm watching you.");
  assert.equal(s.by, "qwen3:0.6b");
  const messages = bodies[0].messages as { content: string }[];
  const user = messages.at(-1)!.content;
  assert.match(user, /Sell them the apple for 3 coins/);
  assert.match(user, /they stole an apple from you/);
  assert.equal(bodies[0].think, false);
});

test("without a model, or when it fails, she uses an authored line", async () => {
  const d = await decide(thief, new RulesModel());
  const none = await speak(thief, d, fakeOllama("unused").ollama, null);
  assert.equal(none.by, "authored lines");
  assert.equal(none.line, "Three coins. For you. I remember the last ones.");
  const failed = await speak(thief, d, fakeOllama(new Error("offline")).ollama, "qwen3:0.6b");
  assert.equal(failed.line, none.line);
  assert.match(failed.fallbackReason!, /offline/);
});

test("if the model only narrates, it gets one retry and then she uses an authored line", async () => {
  const d = await decide(thief, new RulesModel());
  const { ollama, bodies } = fakeOllama("Mira glares at the player. She charges three coins.");
  const s = await speak(thief, d, ollama, "qwen3:0.6b");
  assert.equal(bodies.length, 2);
  assert.equal(s.by, "authored lines");
  assert.match(s.fallbackReason!, /only narrated/);
});
