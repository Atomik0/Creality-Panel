let dbShared = true;
async function dbGet(key, def) {
  try {
    const r = await fetch(`${api}/server/database/item?namespace=crpanel&key=${key}`, { cache: "no-store" });
    if (r.status === 404) return def;
    if (!r.ok) throw new Error(r.status);
    const v = (await r.json()).result.value;
    return v == null || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length) ? def : v;
  } catch {
    dbShared = false;
    try { return JSON.parse(store.get(`crpanel_${P ? P.id + "_" : ""}${key}`, "null")) ?? def; } catch { return def; }
  }
}
async function dbSet(key, value) {
  store.set(`crpanel_${P ? P.id + "_" : ""}${key}`, JSON.stringify(value));
  try {
    const r = await fetch(`${api}/server/database/item`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ namespace: "crpanel", key, value }),
    });
    if (!r.ok) throw new Error(r.status);
    dbShared = true;
  } catch { dbShared = false; }
}

let histJobs = [], priceCfg = { perKg: 20, cur: "$" };
function jobGrams(j) {
  const m = j.metadata || {};
  if (!m.filament_weight_total || !m.filament_total) return [];
  const used = j.status === "completed" ? m.filament_total : Math.min(j.filament_used || 0, m.filament_total);
  const scale = m.filament_weight_total * used / m.filament_total;
  const types = String(m.filament_type || "").split(";");
  const colors = String(m.filament_color || "").split(";");
  const mm = String(m.filament_color_used || "").split(",").map(Number);
  const sum = mm.reduce((a, b) => a + (b || 0), 0);
  if (!sum) return [{ type: types[0] || "?", color: colors[0] || "", g: scale }];
  return mm.map((v, i) => ({ type: types[i] || types[0] || "?", color: colors[i] || "", g: scale * (v || 0) / sum })).filter(x => x.g > 0.05);
}
const money = v => `${priceCfg.cur}${v.toLocaleString(undefined, { maximumFractionDigits: v < 100 ? 2 : 0 })}`;

async function loadStats() {
  let totals;
  try {
    [{ jobs: histJobs }, { job_totals: totals }] = await Promise.all([
      get("/server/history/list?limit=1000&order=desc"), get("/server/history/totals")]);
  } catch { return; }
  priceCfg = await dbGet("price", priceCfg);
  $("pricePerKg").value = priceCfg.perKg; $("currency").value = priceCfg.cur;

  const done = histJobs.filter(j => j.status !== "in_progress");
  const ok = done.filter(j => j.status === "completed").length;
  const parts = histJobs.flatMap(jobGrams);
  const grams = parts.reduce((a, p) => a + p.g, 0);
  $("stHours").textContent = (totals.total_print_time / 3600).toFixed(1) + " h";
  $("stJobs").textContent = `${totals.total_jobs} (${ok} ok)`;
  $("stOk").textContent = done.length ? Math.round(100 * ok / done.length) + " %" : "—";
  $("stFil").textContent = grams >= 1000 ? (grams / 1000).toFixed(2) + " kg" : Math.round(grams) + " g";
  $("stCost").textContent = money(grams / 1000 * priceCfg.perKg);
  $("stLong").textContent = fmtDur(totals.longest_print);

  const sumBy = (key) => {
    const o = {};
    for (const p of parts) { const k = key(p); if (k) o[k] = (o[k] || 0) + p.g; }
    return Object.entries(o).sort((a, b) => b[1] - a[1]);
  };
  const mats = sumBy(p => p.type), max = mats.length ? mats[0][1] : 1;
  $("byMat").innerHTML = mats.length ? "" : '<div class="muted">Sin datos</div>';
  for (const [t, g] of mats) {
    const d = document.createElement("div");
    d.className = "b";
    d.innerHTML = `<span></span><div class="track"><div style="width:${(100 * g / max).toFixed(1)}%"></div></div><span class="num"></span>`;
    d.firstChild.textContent = t;
    d.lastChild.textContent = `${Math.round(g)} g · ${money(g / 1000 * priceCfg.perKg)}`;
    $("byMat").appendChild(d);
  }
  const cols = sumBy(p => /^#[0-9A-F]{6}/i.test(p.color) ? p.color.slice(0, 7).toUpperCase() : null).slice(0, 10);
  $("byColor").innerHTML = cols.length ? "" : '<span class="muted">Sin datos</span>';
  for (const [c, g] of cols) {
    const s = document.createElement("span");
    s.innerHTML = `<i style="background:${c}"></i>`;
    s.append(`${Math.round(g)} g`);
    $("byColor").appendChild(s);
  }
  drawDayChart();
  setTimeout(drawDayChart, 300);
  renderMaintenance();
}

function drawDayChart() {
  const cv = $("dayChart"), dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (!w) { if ($("tab-stats").classList.contains("on")) requestAnimationFrame(drawDayChart); return; }
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext("2d"); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    days.push({ t: d.getTime(), h: 0 });
  }
  for (const j of histJobs) {
    const d = new Date(j.start_time * 1000); d.setHours(0, 0, 0, 0);
    const slot = days.find(x => x.t === d.getTime());
    if (slot) slot.h += (j.print_duration || 0) / 3600;
  }
  const max = Math.max(1, ...days.map(d => d.h)), B = 18, L = 26, bw = (w - L) / days.length;
  g.font = "11px Segoe UI, sans-serif"; g.fillStyle = cssVar("--muted"); g.strokeStyle = cssVar("--line");
  for (let v = 0; v <= max; v += Math.max(1, Math.ceil(max / 4))) {
    const y = (h - B) - (v / max) * (h - B - 8);
    g.beginPath(); g.moveTo(L, y); g.lineTo(w, y); g.stroke();
    g.fillText(v + "h", 0, y + 4);
  }
  const accent = cssVar("--accent");
  days.forEach((d, i) => {
    const bh = (d.h / max) * (h - B - 8);
    g.fillStyle = accent;
    if (bh > 0) g.fillRect(L + i * bw + 2, (h - B) - bh, Math.max(2, bw - 4), bh);
    if (i % 7 === 2 || i === 29) {
      g.fillStyle = cssVar("--muted");
      g.fillText(i === 29 ? "hoy" : new Date(d.t).toLocaleDateString([], { day: "numeric", month: "short" }), L + i * bw - 6, h - 3);
    }
  });
}

$("savePrice").onclick = async () => {
  priceCfg = { perKg: Math.max(0, Number($("pricePerKg").value) || 0), cur: $("currency").value.trim() || "$" };
  await dbSet("price", priceCfg);
  toast("Precio guardado");
  loadStats();
};

const DEFAULT_TASKS = [
  { id: "lube", name: "Lubricar ejes y varillas", every: 200, unit: "h" },
  { id: "belts", name: "Revisar tensión de correas", every: 300, unit: "h" },
  { id: "nozzle", name: "Revisar y limpiar la boquilla", every: 100, unit: "h" },
  { id: "bed", name: "Limpiar la cama con agua y jabón", every: 14, unit: "days" },
  { id: "cutter", name: "Revisar la cuchilla del cortador", every: 1000, unit: "cuts" },
];
let tasks = null;
const UNIT_TXT = { h: "h", cuts: "cortes", days: "días" };
function taskProgress(t) {
  const since = t.doneAt || (histJobs.length ? Math.min(...histJobs.map(j => j.start_time)) : Date.now() / 1000);
  if (t.unit === "days") return (Date.now() / 1000 - since) / 86400;
  if (t.unit === "cuts") {
    const now = S && S.cutter_module ? S.cutter_module.cut_success_count : 0;
    return Math.max(0, now - (t.doneCuts || 0));
  }
  return histJobs.filter(j => j.start_time >= since)
    .reduce((a, j) => a + (j.status === "in_progress" && S ? S.print_stats.print_duration : j.print_duration || 0), 0) / 3600;
}
async function renderMaintenance() {
  if (!tasks) tasks = await dbGet("maintenance", DEFAULT_TASKS);
  $("mtStore").textContent = dbShared ? "Guardado en la impresora (compartido entre dispositivos)" : "Guardado solo en este navegador";
  $("mtList").innerHTML = tasks.length ? "" : '<div class="muted">Sin tareas.</div>';
  tasks.forEach((t, idx) => {
    const p = taskProgress(t), ratio = p / t.every;
    const d = document.createElement("div");
    d.className = "mt" + (ratio >= 1 ? " due" : ratio >= 0.8 ? " soon" : "");
    d.innerHTML = `<div><div class="t"></div><div class="d"></div></div>
      <div class="acts"><button class="primary">Hecho</button><button class="danger" title="Eliminar" aria-label="Eliminar">✕</button></div>
      <div class="bar"><div style="width:${Math.min(100, ratio * 100).toFixed(1)}%"></div></div>`;
    d.querySelector(".t").textContent = t.name;
    const u = UNIT_TXT[t.unit];
    d.querySelector(".d").textContent = `${t.unit === "h" ? p.toFixed(1) : Math.floor(p)} de ${t.every} ${u}` +
      (t.doneAt ? ` · último: ${new Date(t.doneAt * 1000).toLocaleDateString()}` : " · nunca marcado");
    const [doneBtn, delBtn] = d.querySelectorAll("button");
    doneBtn.onclick = async () => {
      if (!(await confirmBox(`¿Marcar "${t.name}" como hecho hoy? El contador vuelve a cero.`))) return;
      tasks[idx] = { ...t, doneAt: Math.floor(Date.now() / 1000), doneCuts: S && S.cutter_module ? S.cutter_module.cut_success_count : 0 };
      await dbSet("maintenance", tasks); renderMaintenance(); toast("Mantenimiento registrado");
    };
    delBtn.onclick = async () => {
      if (!(await confirmBox(`¿Eliminar la tarea "${t.name}"?`))) return;
      tasks.splice(idx, 1);
      await dbSet("maintenance", tasks); renderMaintenance();
    };
    $("mtList").appendChild(d);
  });
}
$("mtForm").onsubmit = async e => {
  e.preventDefault();
  const name = $("mtName").value.trim(), every = Number($("mtEvery").value);
  if (!name || !(every > 0)) return toast("Escribe el nombre y cada cuánto", true);
  tasks = tasks || DEFAULT_TASKS.slice();
  tasks.push({ id: "t" + Date.now(), name, every, unit: $("mtUnit").value });
  await dbSet("maintenance", tasks);
  $("mtName").value = ""; $("mtEvery").value = "";
  renderMaintenance();
};
