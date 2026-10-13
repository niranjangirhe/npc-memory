/**
 * npm run bench -- --turns 50 --decider gliclass --voice qwen3:0.6b
 *
 * In Windows PowerShell, quote the separator: npm run bench '--' --turns 50 ...
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { runBench, type BenchResult } from "./bench.ts";
import { defaultServices } from "./turn.ts";

const { values } = parseArgs({
  options: {
    turns: { type: "string", default: "30" },
    seed: { type: "string", default: "1" },
    decider: { type: "string", default: "gliclass" },
    voice: { type: "string", default: "" },
    out: { type: "string" },
  },
});

const opts = {
  turns: Math.max(1, Number(values.turns) || 30),
  seed: Number(values.seed) || 1,
  decider: values.decider === "rules" ? "rules" : "gliclass",
  voice: values.voice || null,
};

console.log(`${opts.turns} turns, seed ${opts.seed}, decisions: ${opts.decider}, dialogue: ${opts.voice ?? "authored lines"}\n`);
const r = await runBench(opts, defaultServices(), (_t, done) => {
  process.stdout.write(`\rturn ${done}/${opts.turns}`);
});
process.stdout.write("\n\n");
console.log(report(r));

const out = values.out ?? `benchmarks/${r.startedAt.replace(/[:.]/g, "-")}.json`;
mkdirSync("benchmarks", { recursive: true });
writeFileSync(out, JSON.stringify(r, null, 2) + "\n");
console.log(`\nSaved to ${out}`);

function report(r: BenchResult) {
  const s = r.summary;
  const ms = (x: number) => `${x < 10 ? x.toFixed(1) : x.toFixed(0)} ms`;
  const row = (name: string, st: { p50: number; p95: number; mean: number; max: number }) =>
    `  ${name.padEnd(18)} p50 ${ms(st.p50).padStart(8)}   p95 ${ms(st.p95).padStart(8)}   mean ${ms(st.mean).padStart(8)}   max ${ms(st.max).padStart(8)}`;
  const lines = [
    `Machine     ${r.machine.cpu}, ${r.machine.cores} cores, ${r.machine.ramGB} GB RAM`,
    `Decisions   ${r.turns[0]?.decisionBy ?? ""}` +
      (r.services.decider
        ? ` (${r.services.decider.model} on ${r.services.decider.device}, loaded in ${(r.services.decider.load_seconds ?? 0).toFixed(1)} s` +
          (r.services.decider.rss_mb != null ? `, ${r.services.decider.rss_mb.toFixed(0)} MB RAM` : "") +
          (r.services.decider.gpu_mb != null ? `, ${r.services.decider.gpu_mb.toFixed(0)} MB GPU` : "") +
          ")"
        : ""),
    `Dialogue    ${r.turns[0]?.voiceBy ?? ""}` +
      (r.services.voiceModel
        ? ` (Ollama ${r.services.ollamaVersion}, ${r.services.voiceModel.sizeMB.toFixed(0)} MB loaded, ${r.services.voiceModel.vramMB.toFixed(0)} MB of it on GPU)`
        : ""),
    "",
    `First turn  ${ms(s.firstTurnMs)} (includes warm-up)`,
    "Latency after the first turn:",
    row("decision", s.decisionMs),
    ...(s.decisionModelMs ? [row("  inside GLiClass", s.decisionModelMs)] : []),
    row("dialogue", s.dialogueMs),
    row("whole turn", s.turnMs),
    "",
    s.tokensPerSecond !== null ? `Generation  ${s.tokensPerSecond.toFixed(1)} tokens/s, ${s.outputTokens?.toFixed(0)} tokens per line` : "",
    s.modelLoadMs ? `Model load  ${ms(s.modelLoadMs)} (Ollama loading the model on first use)` : "",
    `Fallbacks   decision ${s.decisionFallbacks}, dialogue ${s.dialogueFallbacks}, retries ${s.retries}`,
    `Reactions   ${Object.entries(s.reactions).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    `Total       ${r.wallSeconds.toFixed(1)} s, server ${r.services.serverRssMB.toFixed(0)} MB RAM`,
  ];
  return lines.filter((l) => l !== "").join("\n");
}
