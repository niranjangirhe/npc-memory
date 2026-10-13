/**
 * Live system stats for the page: CPU and RAM for the whole machine, the GPU
 * when an NVIDIA card and nvidia-smi are present, and how much memory each
 * model is using.
 */
import { execFile } from "node:child_process";
import os from "node:os";
import type { DeciderHealth } from "./decision.ts";
import type { LoadedModel } from "./ollama.ts";
import type { Services } from "./turn.ts";

export type Gpu = { name: string; utilisation: number; memoryUsedMB: number; memoryTotalMB: number };

export type SystemStats = {
  cpu: { model: string; cores: number; usage: number };
  memory: { usedMB: number; totalMB: number };
  /** null when no NVIDIA GPU (or no nvidia-smi) was found */
  gpus: Gpu[] | null;
  decider: DeciderHealth | null;
  ollama: LoadedModel[];
  serverMB: number;
};

/* ---------------- CPU ---------------- */

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.irq + c.times.idle;
  }
  return { idle, total };
}

let previous = cpuTimes();

/** Share of CPU time spent busy since the last call, across all cores. */
function cpuUsage() {
  const now = cpuTimes();
  const total = now.total - previous.total;
  const idle = now.idle - previous.idle;
  previous = now;
  return total > 0 ? Math.max(0, Math.min(1, 1 - idle / total)) : 0;
}

/* ---------------- GPU ---------------- */

export function parseNvidiaSmi(out: string): Gpu[] {
  return out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, util, used, total] = line.split(",").map((x) => x.trim());
      return { name, utilisation: Number(util) / 100, memoryUsedMB: Number(used), memoryTotalMB: Number(total) };
    })
    .filter((g) => g.name && Number.isFinite(g.memoryTotalMB));
}

let noNvidiaSmi = false;

function nvidiaSmi(): Promise<Gpu[] | null> {
  if (noNvidiaSmi) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      "nvidia-smi",
      ["--query-gpu=name,utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"],
      { timeout: 2000, windowsHide: true },
      (err, stdout) => {
        if (err) {
          // not installed: stop asking. Any other error: try again next time.
          if ((err as NodeJS.ErrnoException).code === "ENOENT") noNvidiaSmi = true;
          return resolve(null);
        }
        const gpus = parseNvidiaSmi(stdout);
        resolve(gpus.length ? gpus : null);
      },
    );
  });
}

/* ---------------- all together ---------------- */

export async function systemStats(services: Services): Promise<SystemStats> {
  const [gpus, decider, ollama] = await Promise.all([nvidiaSmi(), services.gliclass.health(), services.ollama.loaded()]);
  const totalMB = os.totalmem() / 2 ** 20;
  return {
    cpu: { model: os.cpus()[0]?.model.trim() ?? "unknown", cores: os.cpus().length, usage: cpuUsage() },
    memory: { usedMB: totalMB - os.freemem() / 2 ** 20, totalMB },
    gpus,
    decider,
    ollama,
    serverMB: process.memoryUsage().rss / 2 ** 20,
  };
}
