import { miraSvg } from "./mira.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const ACTIONS = [
  { id: "greet", label: "Say hello", tone: "kind" },
  { id: "buy", label: "Buy an apple", tone: "kind" },
  { id: "help", label: "Carry her crates", tone: "kind" },
  { id: "apologise", label: "Apologise", tone: "kind" },
  { id: "bump", label: "Walk into her", tone: "rude" },
  { id: "steal", label: "Steal an apple", tone: "rude" },
  { id: "hit", label: "Hit her", tone: "rude" },
  { id: "wait", label: "Come back tomorrow", tone: "" },
];

const DID = {
  greet: "You said hello.",
  buy: "You asked for an apple.",
  help: "You carried her crates.",
  apologise: "You apologised.",
  bump: "You walked into her.",
  steal: "You stole an apple.",
  hit: "You hit her.",
  wait: "A night passes.",
};

const REACTION_TEXT = {
  welcome: "Welcomes you",
  serve: "Serves you",
  wary: "Wary of you",
  refuse: "Won't deal with you",
  call_guards: "Calls the guards",
};

const START_COINS = 10;
const fresh = () => ({ events: [], story: [], coins: START_COINS, apples: 0 });
let game = fresh();
let undoStack = [];
let busy = false;

/* ---------------- talking to the server ---------------- */

async function post(path, body) {
  const res = await fetch(path, { method: "POST", body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

async function loadStatus() {
  const s = await (await fetch("/api/status")).json();

  $("#decider-dot").className = `dot ${s.gliclass ? "on" : "off"}`;
  $("#decider-dot").title = s.gliclass
    ? `${s.gliclass.model} on ${s.gliclass.device}`
    : "GLiClass isn't running, so the built-in rules decide. Start it with: python decider/server.py";
  if (!s.gliclass) $("#decider").value = "rules";

  const models = s.ollama?.models ?? [];
  $("#voice").innerHTML =
    models.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("") + `<option value="">Authored lines</option>`;
  $("#voice").value = models.find((m) => m.startsWith("qwen3")) ?? models[0] ?? "";
  $("#voice-dot").className = `dot ${models.length ? "on" : "off"}`;
  $("#voice-dot").title = models.length
    ? "Ollama is running"
    : "No Ollama models found, so Mira uses authored lines. Start Ollama and pull a model, e.g. ollama pull qwen3:0.6b";
}

/* ---------------- one turn ---------------- */

async function play(event) {
  if (busy) return;
  busy = true;
  setBusy(true);
  undoStack.push(structuredClone(game));
  game.events.push(event);
  try {
    const turn = await post("/api/turn", {
      events: game.events,
      decider: $("#decider").value,
      voice: $("#voice").value,
    });
    const result = settle(event, turn);
    game.story.push({ event, line: turn.spoken.line, result, turn });
    render(turn, result);
  } catch (e) {
    game = undoStack.pop();
    $("#line").textContent = `Something went wrong: ${e.message}`;
  } finally {
    busy = false;
    setBusy(false);
  }
}

/** Coins and apples change hands after she has decided. */
function settle(event, turn) {
  const d = turn.decision;
  if (event.action === "steal") {
    game.apples++;
    return "You got away with an apple.";
  }
  if (event.action !== "buy") return null;
  if (d.reaction === "call_guards" || d.reaction === "refuse" || d.price === "no sale") return "She wouldn't sell.";
  const cost = Number.parseInt(d.price ?? "2 coins", 10);
  if (cost > game.coins) return `You couldn't afford ${d.price}.`;
  game.coins -= cost;
  game.apples++;
  return `You paid ${d.price}.`;
}

function setBusy(on) {
  for (const b of document.querySelectorAll(".actions button, .say button, #undo, #restart")) b.disabled = on;
  if (on) {
    $("#line").classList.add("thinking");
    $("#line").textContent = "…";
    $("#credit").textContent = "Mira is thinking";
  } else {
    $("#line").classList.remove("thinking");
  }
}

/* ---------------- drawing ---------------- */

function meter(label, value, min, max, color) {
  const centred = min < 0;
  const w = centred ? (Math.abs(value) / (max - min)) * 100 : (value / max) * 100;
  const pos = centred ? (value >= 0 ? `left:50%;width:${w}%` : `left:${50 - w}%;width:${w}%`) : `left:0;width:${w}%`;
  return `<div class="meter">
    <div class="lbl"><span>${label}</span><b>${Math.round(value)}</b></div>
    <div class="track">${centred ? '<span class="mid"></span>' : ""}<span class="fill" style="${pos};background:${color}"></span></div>
  </div>`;
}

function bars(title, options, chosen) {
  if (!options.length) return "";
  const rows = options
    .map(
      (o) => `<div class="bar ${o.id === chosen ? "chosen" : ""}">
        <span class="name">${esc(o.id)}</span>
        <span class="track"><span class="fill" style="width:${(o.p * 100).toFixed(1)}%"></span></span>
        <span class="num">${Math.round(o.p * 100)}%</span>
      </div>`,
    )
    .join("");
  return `<p class="small muted">${title}</p><div class="bars">${rows}</div>`;
}

function render(turn, result) {
  const m = turn.memory;
  const d = turn.decision;
  const s = turn.spoken;

  $("#portrait").innerHTML = miraSvg(turn.mood);
  $("#line").textContent = s.line;
  const credit = [`Decided by ${d.by}`, `voiced by ${s.by}`, `${((d.ms + s.ms) / 1000).toFixed(1)} s`];
  const fallbacks = [d.fallbackReason, s.fallbackReason].filter(Boolean);
  $("#credit").textContent = credit.join(" · ") + (fallbacks.length ? ` (${fallbacks.join("; ")})` : "");

  const tags = [`<span class="tag ${d.reaction === "welcome" || d.reaction === "serve" ? "good" : "bad"}">${REACTION_TEXT[d.reaction]}</span>`];
  if (d.price) tags.push(`<span class="tag ${d.price === "1 coin" ? "good" : d.price === "2 coins" ? "" : "bad"}">${d.price === "no sale" ? "No sale" : `Price: ${d.price}`}</span>`);
  if (result) tags.push(`<span class="tag">${esc(result)}</span>`);
  $("#outcome").innerHTML = tags.join("");

  $("#day").textContent = m.day;
  $("#coins").textContent = game.coins;
  $("#apples").textContent = game.apples;

  $("#meters").innerHTML =
    meter("Trust", m.trust, -100, 100, m.trust >= 0 ? "var(--trust)" : "var(--distrust)") +
    meter("Annoyance", m.annoyance, 0, 100, "var(--annoyance)") +
    meter("Fear", m.fear, 0, 100, "var(--fear)");
  $("#notes").innerHTML = turn.notes.map((n) => `<li>${esc(n)}</li>`).join("");

  renderStory();

  $("#situation").textContent = turn.situation;
  $("#scores").innerHTML = bars("Her reaction", d.scores.reaction, d.reaction) + bars("Her price", d.scores.price, d.price);
  // the two fixed examples in the middle of the prompt are the same every turn
  $("#prompt").textContent = s.prompt
    ? `${s.prompt[0].content}\n\n(two short example exchanges)\n\n${s.prompt.at(-1).content}`
    : "No language model this turn; she used an authored line.";
}

function renderStory() {
  $("#story").innerHTML = game.story
    .map(({ event, line }) => {
      if (event.action === "wait") return `<li class="night">${DID.wait}</li>`;
      const you = event.action === "say" ? `You: “${esc(event.text)}”` : DID[event.action];
      return `<li><div class="you">${you}</div><div>Mira: ${esc(line)}</div></li>`;
    })
    .join("");
  $("#story").scrollTop = $("#story").scrollHeight;
}

function renderEmpty() {
  $("#portrait").innerHTML = miraSvg("neutral");
  $("#line").textContent = "Fresh apples! Two coins each.";
  $("#credit").textContent = "";
  $("#outcome").innerHTML = "";
  $("#day").textContent = 1;
  $("#coins").textContent = game.coins;
  $("#apples").textContent = game.apples;
  $("#meters").innerHTML =
    meter("Trust", 0, -100, 100, "var(--trust)") + meter("Annoyance", 0, 0, 100, "var(--annoyance)") + meter("Fear", 0, 0, 100, "var(--fear)");
  $("#notes").innerHTML = "";
  $("#story").innerHTML = "";
  $("#situation").textContent = "Nothing has happened yet.";
  $("#scores").innerHTML = "";
  $("#prompt").textContent = "";
}

/* ---------------- start ---------------- */

$("#actions").innerHTML = ACTIONS.map((a) => `<button data-action="${a.id}" class="${a.tone}">${a.label}</button>`).join("");
$("#actions").addEventListener("click", (e) => {
  const action = e.target.closest("button")?.dataset.action;
  if (action) play({ action });
});
$("#say").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("#say-text").value.trim();
  if (!text) return;
  $("#say-text").value = "";
  play({ action: "say", text });
});
$("#undo").addEventListener("click", () => {
  if (!undoStack.length) return;
  game = undoStack.pop();
  const last = game.story.at(-1);
  if (last) render(last.turn, last.result);
  else renderEmpty();
});
$("#restart").addEventListener("click", () => {
  game = fresh();
  undoStack = [];
  renderEmpty();
});

renderEmpty();
loadStatus().catch(() => {});
