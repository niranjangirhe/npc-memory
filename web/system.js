// Live system stats under the header: CPU, RAM, GPU and what each model uses.

const el = document.querySelector("#system");
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const gb = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);

function gauge(share) {
  const cls = share > 0.9 ? "full" : share > 0.6 ? "busy" : "";
  return `<span class="gauge ${cls}"><span style="width:${Math.round(share * 100)}%"></span></span>`;
}

function stat(label, share, text, title = "") {
  return `<span class="stat" title="${esc(title)}">${label} ${gauge(share)} <b>${text}</b></span>`;
}

function render(s) {
  const parts = [
    stat("CPU", s.cpu.usage, `${Math.round(s.cpu.usage * 100)}%`, `${s.cpu.model}, ${s.cpu.cores} cores`),
    stat("RAM", s.memory.usedMB / s.memory.totalMB, `${gb(s.memory.usedMB)} / ${gb(s.memory.totalMB)}`),
  ];
  if (s.gpus) {
    for (const g of s.gpus) {
      parts.push(stat("GPU", g.utilisation, `${Math.round(g.utilisation * 100)}%`, g.name));
      parts.push(stat("VRAM", g.memoryUsedMB / g.memoryTotalMB, `${gb(g.memoryUsedMB)} / ${gb(g.memoryTotalMB)}`, g.name));
    }
  } else {
    parts.push(`<span class="stat" title="GPU stats need an NVIDIA card with nvidia-smi">GPU <b>not detected</b></span>`);
  }

  const models = [];
  if (s.decider) {
    const mem = [s.decider.rss_mb != null && `${gb(s.decider.rss_mb)} RAM`, s.decider.gpu_mb != null && `${gb(s.decider.gpu_mb)} GPU`].filter(Boolean);
    models.push(`GLiClass on ${esc(s.decider.device)}${mem.length ? ` <b>${mem.join(", ")}</b>` : ""}`);
  }
  for (const m of s.ollama) {
    const onGpu = m.sizeMB > 0 ? Math.round((m.vramMB / m.sizeMB) * 100) : 0;
    models.push(`${esc(m.name)} <b>${gb(m.sizeMB)}</b> ${onGpu > 0 ? `(${onGpu}% on GPU)` : "(CPU)"}`);
  }
  models.push(`game server <b>${gb(s.serverMB)}</b>`);
  parts.push(`<span class="stat models">Models: ${models.join(" · ")}</span>`);
  el.innerHTML = parts.join("");
}

let timer;
async function poll() {
  clearTimeout(timer);
  try {
    render(await (await fetch("/api/system")).json());
  } catch {
    el.textContent = "";
  }
  if (!document.hidden) timer = setTimeout(poll, 2000);
}

document.addEventListener("visibilitychange", () => !document.hidden && poll());
poll();
