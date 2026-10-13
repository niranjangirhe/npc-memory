// The Benchmark view: runs a seeded game on the server and shows how long each
// step took, as it happens.

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ms = (x) => (x == null ? "n/a" : x < 10 ? `${x.toFixed(1)} ms` : x < 10000 ? `${Math.round(x)} ms` : `${(x / 1000).toFixed(1)} s`);
const mb = (x) => (x == null ? "n/a" : x >= 1024 ? `${(x / 1024).toFixed(1)} GB` : `${Math.round(x)} MB`);

let last = null;

/* ---------------- switching views ---------------- */

function show(view) {
  for (const b of document.querySelectorAll(".views button")) b.setAttribute("aria-pressed", String(b.dataset.view === view));
  $("#play-view").hidden = view !== "play";
  $("#bench-view").hidden = view !== "bench";
  if (view === "bench") describeSettings();
  history.replaceState(null, "", view === "bench" ? "#benchmark" : location.pathname);
}

function describeSettings() {
  const d = $("#decider").selectedOptions[0]?.textContent ?? "";
  const v = $("#voice").selectedOptions[0]?.textContent ?? "";
  $("#bench-using").textContent = `Decisions: ${d}. Dialogue: ${v}. Change these at the top.`;
}

/* ---------------- running ---------------- */

async function run(e) {
  e.preventDefault();
  const turns = Number($("#bench-turns").value) || 30;
  const body = { turns, seed: Number($("#bench-seed").value) || 1, decider: $("#decider").value, voice: $("#voice").value };
  $("#bench-run").disabled = true;
  $("#bench-progress").hidden = false;
  $("#bench-progress span").style.width = "0";
  $("#bench-status").textContent = "Starting…";
  const live = [];

  try {
    const res = await fetch("/api/bench", { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const msg = JSON.parse(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (msg.type === "turn") {
          live.push(msg.turn);
          $("#bench-progress span").style.width = `${(msg.done / msg.total) * 100}%`;
          $("#bench-status").textContent = `Turn ${msg.done} of ${msg.total}: ${ms(msg.turn.totalMs)}`;
          $("#bench-results").hidden = false;
          chart(live);
        } else if (msg.type === "done") {
          last = msg.result;
          render(last);
          $("#bench-status").textContent = `Finished ${last.turns.length} turns in ${last.wallSeconds.toFixed(1)} s.`;
        } else if (msg.type === "error") {
          throw new Error(msg.error);
        }
      }
    }
  } catch (err) {
    $("#bench-status").textContent = `Benchmark failed: ${err.message}`;
  } finally {
    $("#bench-run").disabled = false;
    $("#bench-progress").hidden = true;
  }
}

/* ---------------- results ---------------- */

function tile(k, v, s = "") {
  return `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;
}

function render(r) {
  const s = r.summary;
  const tiles = [
    tile("Whole turn", ms(s.turnMs.p50), `median · p95 ${ms(s.turnMs.p95)}`),
    tile(
      "Decision",
      ms(s.decisionMs.p50),
      `median · p95 ${ms(s.decisionMs.p95)}` + (s.decisionModelMs ? ` · ${ms(s.decisionModelMs.p50)} in GLiClass` : ""),
    ),
    tile("Dialogue", ms(s.dialogueMs.p50), `median · p95 ${ms(s.dialogueMs.p95)}`),
    tile("First turn", ms(s.firstTurnMs), "includes warm-up"),
  ];
  if (s.tokensPerSecond != null) tiles.push(tile("Generation", `${s.tokensPerSecond.toFixed(1)} tok/s`, `${Math.round(s.outputTokens)} tokens per line`));
  if (s.modelLoadMs) tiles.push(tile("Model load", ms(s.modelLoadMs), "Ollama loading the model"));
  tiles.push(
    tile("Fallbacks", `${s.decisionFallbacks + s.dialogueFallbacks}`, `decision ${s.decisionFallbacks} · dialogue ${s.dialogueFallbacks} · retries ${s.retries}`),
  );
  $("#bench-tiles").innerHTML = tiles.join("");

  chart(r.turns);

  const d = r.services.decider;
  const v = r.services.voiceModel;
  const rows = [
    ["Machine", `${esc(r.machine.cpu)}, ${r.machine.cores} cores, ${r.machine.ramGB} GB RAM`],
    [
      "Decisions",
      d
        ? `${esc(d.model)} on ${esc(d.device)}, loaded in ${(d.load_seconds ?? 0).toFixed(1)} s` +
          (d.rss_mb != null ? `, ${mb(d.rss_mb)} RAM` : "") +
          (d.gpu_mb != null ? `, ${mb(d.gpu_mb)} GPU` : "")
        : esc(r.turns[0]?.decisionBy ?? ""),
    ],
    [
      "Dialogue",
      v
        ? `${esc(v.name)} on Ollama ${esc(r.services.ollamaVersion ?? "")}, ${mb(v.sizeMB)} in memory, ${v.vramMB > 0 ? `${Math.round((v.vramMB / v.sizeMB) * 100)}% on GPU` : "CPU only"}`
        : esc(r.turns[0]?.voiceBy ?? ""),
    ],
    ["Game server", `${mb(r.services.serverRssMB)} RAM`],
    ["Run", `${r.options.turns} turns, seed ${r.options.seed}, ${new Date(r.startedAt).toLocaleString()}`],
  ];
  $("#bench-resources").innerHTML = rows.map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join("");

  $("#bench-table").innerHTML =
    `<thead><tr><th class="num">#</th><th>Player</th><th>Decision</th><th>Mira</th><th class="num">Decision</th><th class="num">Dialogue</th><th class="num">Tokens/s</th></tr></thead><tbody>` +
    r.turns
      .map((t) => {
        const player = t.event.action;
        const decision = esc(t.reaction) + (t.price ? ` · ${esc(t.price)}` : "");
        const fb = [t.decisionFellBack && "decision fell back", t.dialogueFellBack && "dialogue fell back"].filter(Boolean).join(", ");
        return `<tr><td class="num">${t.turn}</td><td>${player}</td><td>${decision}</td>
          <td class="line">${esc(t.line)}${fb ? `<div class="fb">${fb}</div>` : ""}</td>
          <td class="num">${ms(t.decisionMs)}</td><td class="num">${ms(t.dialogueMs)}</td>
          <td class="num">${t.tokensPerSecond != null ? t.tokensPerSecond.toFixed(1) : ""}</td></tr>`;
      })
      .join("") +
    "</tbody>";
}

/* ---------------- the chart: decision + dialogue time, stacked per turn ---------------- */

function niceMax(x) {
  if (x <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((m) => m >= x);
}

function chart(turns) {
  const el = $("#bench-chart");
  // draw at the container's real width so the labels stay readable on a phone
  const W = Math.max(300, Math.round(el.clientWidth || 900));
  const H = W < 600 ? 200 : 240;
  const pad = { l: 52, r: 8, t: 8, b: 24 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const total = Math.max(turns.length, Number($("#bench-turns").value) || turns.length);
  const max = niceMax(Math.max(...turns.map((t) => t.decisionMs + t.dialogueMs), 1));
  const y = (v) => pad.t + ih - (v / max) * ih;
  const slot = iw / total;
  const bw = Math.max(2, Math.min(28, slot - 2));
  const gap = 2; // surface gap between the stacked segments

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const grid = ticks
    .map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`)
    .join("");
  const yLabels = ticks.map((v) => `<text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${v === 0 ? "0" : ms(v)}</text>`).join("");
  const every = Math.ceil(total / Math.max(4, Math.floor(iw / 60)));
  const xLabels = turns
    .filter((t) => t.turn === 1 || t.turn % every === 0)
    .map((t) => `<text x="${pad.l + (t.turn - 0.5) * slot}" y="${H - 6}" text-anchor="middle">${t.turn}</text>`)
    .join("");

  const r = Math.min(4, bw / 2);
  const bars = turns
    .map((t) => {
      const x = pad.l + (t.turn - 1) * slot + (slot - bw) / 2;
      const dH = Math.max(0, y(0) - y(t.decisionMs));
      const vH = Math.max(0, y(0) - y(t.dialogueMs));
      // decision sits on the baseline; dialogue on top with the rounded end
      const dTop = y(0) - dH;
      const top = dTop - (vH > 0 ? gap + vH : 0);
      const decision = dH > 0 ? `<rect x="${x}" y="${dTop}" width="${bw}" height="${dH}" fill="var(--series-1)" rx="${vH > 0 ? 0 : r}"/>` : "";
      const dialogue =
        vH > 0
          ? `<path d="M${x},${dTop - gap} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${dTop - gap} Z" fill="var(--series-2)"/>`
          : "";
      const hit = `<rect class="hit" data-turn="${t.turn}" x="${pad.l + (t.turn - 1) * slot}" y="${pad.t}" width="${slot}" height="${ih}"/>`;
      return decision + dialogue + hit;
    })
    .join("");

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Time per turn, decision and dialogue stacked">
    <g class="grid">${grid}</g><g class="axis">${yLabels}${xLabels}</g>${bars}</svg><div class="tooltip" hidden></div>`;

  const tip = el.querySelector(".tooltip");
  el.querySelector("svg").addEventListener("mousemove", (e) => {
    const n = Number(e.target.dataset?.turn);
    const t = turns.find((x) => x.turn === n);
    if (!t) return (tip.hidden = true);
    tip.hidden = false;
    tip.innerHTML = `<b>Turn ${t.turn}: ${esc(t.event.action)}</b>
      <div><i style="background:var(--series-1)"></i>Decision ${ms(t.decisionMs)}</div>
      <div><i style="background:var(--series-2)"></i>Dialogue ${ms(t.dialogueMs)}</div>
      <div class="muted">${esc(t.reaction)}${t.price ? ` · ${esc(t.price)}` : ""}</div>`;
    const box = el.getBoundingClientRect();
    const left = Math.min(e.clientX - box.left + 12, box.width - 270);
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${e.clientY - box.top + 12}px`;
  });
  el.querySelector("svg").addEventListener("mouseleave", () => (tip.hidden = true));
}

/* ---------------- start ---------------- */

for (const b of document.querySelectorAll(".views button")) b.addEventListener("click", () => show(b.dataset.view));
$("#bench-form").addEventListener("submit", run);
$("#decider").addEventListener("change", describeSettings);
$("#voice").addEventListener("change", describeSettings);
$("#bench-save").addEventListener("click", () => {
  if (!last) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(last, null, 2)], { type: "application/json" }));
  a.download = `mira-benchmark-${last.startedAt.replace(/[:.]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => last && chart(last.turns), 150);
});
if (location.hash === "#benchmark") show("bench");
