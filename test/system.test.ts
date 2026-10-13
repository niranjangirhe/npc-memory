import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNvidiaSmi } from "../src/system.ts";

test("reads nvidia-smi's CSV output", () => {
  assert.deepEqual(parseNvidiaSmi("NVIDIA GeForce RTX 3060, 41, 2350, 12288\n"), [
    { name: "NVIDIA GeForce RTX 3060", utilisation: 0.41, memoryUsedMB: 2350, memoryTotalMB: 12288 },
  ]);
  assert.deepEqual(parseNvidiaSmi(""), []);
});
