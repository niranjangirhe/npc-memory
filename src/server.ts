/**
 * Local server for the game page. Serves web/ and these endpoints:
 *
 *   GET  /api/status  which decision model and which language models are running
 *   POST /api/turn    { events, decider, voice } -> Mira's memory, decision and line
 *   POST /api/bench   { turns, seed, decider, voice } -> one JSON line per turn, then the result
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { runBench } from "./bench.ts";
import { ACTIONS, type Event } from "./memory.ts";
import { defaultServices, takeTurn, type Services } from "./turn.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const MAX_EVENTS = 300;
const MAX_BENCH_TURNS = 500;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new HttpError(413, "request too large");
  }
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new HttpError(400, "body is not JSON");
  }
}

function parseEvents(v: unknown): Event[] {
  const ok = Array.isArray(v) && v.length <= MAX_EVENTS && v.every((e) => e && ACTIONS.includes(e.action));
  if (!ok) throw new HttpError(400, "events must be a list of { action }");
  return (v as Event[]).map((e) => ({ action: e.action }));
}

export function createApp(root: string, services: Services = defaultServices()) {
  const webDir = resolve(root, "web");

  async function api(req: IncomingMessage, path: string) {
    if (req.method === "GET" && path === "/api/status") {
      const [gliclass, models] = await Promise.all([services.gliclass.health(), services.ollama.models()]);
      return { gliclass, ollama: models === null ? null : { models } };
    }
    if (req.method === "POST" && path === "/api/turn") {
      const body = await readJson(req);
      return takeTurn(
        parseEvents(body.events),
        {
          decider: body.decider === "gliclass" ? "gliclass" : "rules",
          voice: typeof body.voice === "string" && body.voice ? body.voice : null,
        },
        services,
      );
    }
    throw new HttpError(404, "not found");
  }

  let benchRunning = false;

  /** Streams progress as newline-delimited JSON so the page can draw it live. */
  async function bench(req: IncomingMessage, res: ServerResponse) {
    if (benchRunning) throw new HttpError(409, "a benchmark is already running");
    const body = await readJson(req);
    const opts = {
      turns: Math.max(1, Math.min(MAX_BENCH_TURNS, Number(body.turns) || 30)),
      seed: Number(body.seed) || 1,
      decider: body.decider === "gliclass" ? "gliclass" : "rules",
      voice: typeof body.voice === "string" && body.voice ? body.voice : null,
    };
    benchRunning = true;
    res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8" });
    const line = (o: unknown) => res.write(JSON.stringify(o) + "\n");
    try {
      const result = await runBench(opts, services, (turn, done) => line({ type: "turn", done, total: opts.turns, turn }));
      line({ type: "done", result });
    } catch (e) {
      line({ type: "error", error: (e as Error).message });
    } finally {
      benchRunning = false;
      res.end();
    }
  }

  return createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    try {
      if (req.method === "POST" && path === "/api/bench") return await bench(req, res);
      if (path.startsWith("/api/")) return send(res, 200, await api(req, path));
      const target = resolve(webDir, "." + (path === "/" ? "/index.html" : path));
      if (!target.startsWith(webDir + sep)) throw new HttpError(404, "not found");
      const data = await readFile(target).catch(() => {
        throw new HttpError(404, "not found");
      });
      res.writeHead(200, { "content-type": TYPES[extname(target)] ?? "application/octet-stream" });
      res.end(data);
    } catch (e) {
      send(res, e instanceof HttpError ? e.status : 500, { error: (e as Error).message });
    }
  });
}
