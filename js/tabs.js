async function loadMesh() {
  let bm;
  try { bm = (await get("/printer/objects/query?bed_mesh")).status.bed_mesh; } catch { return; }
  const m = bm.probed_matrix;
  if (!m || !m.length || !m[0].length) { $("mesh").innerHTML = '<div class="muted">No hay malla guardada.</div>'; return; }
  const flat = m.flat(), lo = Math.min(...flat), hi = Math.max(...flat);
  const color = v => {
    const t = hi === lo ? 0.5 : (v - lo) / (hi - lo);
    const stops = [[61, 155, 255], [30, 200, 90], [245, 165, 36], [240, 74, 79]];
    const x = t * 3, k = Math.min(2, Math.floor(x)), f = x - k;
    return `rgb(${stops[k].map((c, j) => Math.round(c + (stops[k + 1][j] - c) * f)).join(",")})`;
  };
  $("mesh").style.gridTemplateColumns = `repeat(${m[0].length}, minmax(0, 1fr))`;
  $("mesh").innerHTML = "";
  for (let r = m.length - 1; r >= 0; r--) {
    for (const v of m[r]) {
      const c = document.createElement("div");
      c.style.background = color(v);
      c.textContent = v.toFixed(2);
      $("mesh").appendChild(c);
    }
  }
  $("mProf").textContent = bm.profile_name || "—";
  $("mMinMax").textContent = `${lo.toFixed(3)} / ${hi.toFixed(3)} mm`;
  $("mRange").textContent = `${(hi - lo).toFixed(3)} mm`;
  $("mLo").textContent = lo.toFixed(2) + " mm";
  $("mHi").textContent = hi.toFixed(2) + " mm";
}

function wsGet(key) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const want = key.replace(/^req/, "").toLowerCase();
    const timer = setTimeout(() => { ws.close(); reject(new Error("sin respuesta")); }, 8000);
    ws.onopen = () => ws.send(JSON.stringify({ method: "get", params: { [key]: 1 } }));
    ws.onmessage = e => {
      let d; try { d = JSON.parse(e.data); } catch { return; }
      const k = Object.keys(d).find(x => x.toLowerCase() === want);
      if (k) { clearTimeout(timer); ws.close(); resolve(d[k]); }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error("sin conexión")); };
  });
}
function wsSet(paramsList) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { ws.close(); reject(new Error("sin respuesta")); }, 8000);
    ws.onopen = () => {
      paramsList.forEach(params => ws.send(JSON.stringify({ method: "set", params })));
      setTimeout(() => { clearTimeout(timer); ws.close(); resolve(); }, 600);
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error("sin conexión")); };
  });
}

const TL_FAILED = ["cancelled", "error", "klippy_shutdown", "interrupted", "server_exit"];
async function deleteTimelapses(items, what) {
  const n = items.length;
  what = what || (n === 1 ? `el timelapse de "${items[0].name}"` : `${n} timelapses`);
  if (!(await confirmBox(`¿Borrar ${what} de la impresora? No se puede deshacer.`))) return;
  try {
    await wsSet(items.map(t => ({ ctrlVideoFiles: { cmd: "remove", printId: "", file: t.path } })));
    await new Promise(r => setTimeout(r, 800));
    const left = (await wsGet("reqElapseVideoList")) || [];
    const kept = items.filter(t => left.some(x => x.video === t.path)).length;
    if (kept) toast(kept === n ? "La impresora no borró el timelapse" : `No se pudieron borrar ${kept} de ${n} timelapses`, true);
    else toast(n === 1 ? "Timelapse borrado" : `${n} timelapses borrados`);
  } catch (e) { toast("No se pudo borrar: " + e.message, true); }
  loadTimelapses();
}

async function loadTimelapses() {
  $("tls").innerHTML = '<div class="muted">Cargando…</div>';
  $("tlDelFailed").hidden = true;
  let list, jobs = [];
  try {
    [list, jobs] = await Promise.all([wsGet("reqElapseVideoList"),
      get("/server/history/list?limit=500&order=desc").then(r => r.jobs).catch(() => [])]);
  } catch (e) { $("tls").innerHTML = `<div class="muted">No se pudo leer la lista (${esc(e.message)}).</div>`; return; }
  list = (list || []).slice().sort((a, b) => (b.starttime || 0) - (a.starttime || 0));
  $("tlCount").textContent = list.length ? `${list.length} timelapse${list.length > 1 ? "s" : ""}` : "";
  if (!list.length) {
    $("tls").innerHTML = '<div class="muted" style="grid-column:1/-1">La impresora no tiene timelapses. Para grabarlos, activa el timelapse en la pantalla de la impresora o al enviar la impresión desde Creality Print.</div>';
    return;
  }
  $("tls").innerHTML = "";
  const items = list.map(t => {
    const file = t.videoname || String(t.video || "").split("/").pop();
    const parts = [];
    if (t.starttime) parts.push(new Date(t.starttime * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" }));
    if (t.duration) parts.push(`${t.duration} s de vídeo`);
    if (t.size) parts.push((t.size / 1048576).toFixed(1) + " MB");
    const job = jobs.find(j => j.filename === t.gcodename && Math.abs(j.start_time - t.starttime) < 120);
    const th = job && job.exists && bestThumb(job.metadata && job.metadata.thumbnails);
    const base = (t.gcodename || "").replace(/\.gcode$/i, "");
    return { file, path: t.video, name: t.gcodename || file, sub: parts.join(" · "), fps: t.render, duration: t.duration,
             status: job ? job.status : null, url: `${webUrl}/downloads/video/${encodeURIComponent(file)}`,
             thumb: th ? thumbUrl(job.filename, th.relative_path) : base ? `${webUrl}/downloads/humbnail/${encodeURIComponent(base + ".png")}` : "" };
  });
  const failed = items.filter(t => TL_FAILED.includes(t.status));
  $("tlDelFailed").hidden = !failed.length;
  $("tlDelFailed").textContent = `Borrar fallidos (${failed.length})`;
  $("tlDelFailed").onclick = () => deleteTimelapses(failed, failed.length === 1 ? "el timelapse de la impresión fallida" : `los ${failed.length} timelapses de impresiones canceladas o fallidas`);
  items.forEach((t, i) => {
    const d = document.createElement("div");
    d.className = "tl";
    d.innerHTML = `<div class="tlthumb" role="button" tabindex="0" aria-label="Reproducir">
        <img alt="" loading="lazy"><span class="pi">${ICONS.play}</span><span class="dur"></span></div>
      <div class="info"><div style="min-width:0"><div class="n"></div><div class="muted" style="font-size:12px"></div></div>
      <div class="acts"><button class="icon" aria-label="Descargar vídeo" title="Descargar vídeo">${ICONS.dl}</button>
      <button class="icon danger" aria-label="Borrar timelapse" title="Borrar timelapse">${ICONS.trash}</button></div></div>`;
    d.querySelector(".n").textContent = t.name; d.querySelector(".n").title = t.name;
    d.querySelector(".muted").textContent = t.sub;
    d.querySelector(".dur").textContent = t.duration ? fmtClock(t.duration).replace(/\.\d$/, "") : "";
    if (t.status && t.status !== "completed") {
      const s = document.createElement("span");
      s.className = `pill tlst ${t.status === "in_progress" ? "printing" : TL_FAILED.includes(t.status) ? "cancelled" : ""}`;
      s.textContent = STATE_ES[t.status] || t.status;
      d.querySelector(".tlthumb").appendChild(s);
    }
    const img = d.querySelector("img");
    img.onerror = () => img.remove();
    if (t.thumb) img.src = t.thumb; else img.remove();
    const th = d.querySelector(".tlthumb");
    th.onclick = () => openPlayer(items, i);
    th.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPlayer(items, i); } };
    const [dl, del] = d.querySelectorAll(".acts button");
    dl.onclick = () => saveFile(t.url, t.file);
    del.disabled = t.status === "in_progress";
    if (del.disabled) del.title = "Se está grabando: espera a que termine la impresión";
    del.onclick = () => deleteTimelapses([t]);
    $("tls").appendChild(d);
  });
}
$("tlRefresh").onclick = loadTimelapses;

let lastConsoleTime = 0;
async function loadConsole() {
  if (!$("tab-console").classList.contains("on")) return;
  try {
    const { gcode_store } = await get("/server/gcode_store?count=150");
    const box = $("console");
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
    const fresh = gcode_store.filter(e => e.time > lastConsoleTime);
    if (!fresh.length) return;
    if (!lastConsoleTime) box.innerHTML = "";
    for (const e of fresh) {
      const line = document.createElement("div");
      line.className = e.type === "command" ? "c" : "r";
      const t = document.createElement("span");
      t.className = "t"; t.textContent = new Date(e.time * 1000).toLocaleTimeString();
      line.append(t, (e.type === "command" ? "> " : "") + e.message);
      box.appendChild(line);
    }
    while (box.childElementCount > 500) box.firstElementChild.remove();
    lastConsoleTime = gcode_store[gcode_store.length - 1].time;
    if (atBottom) box.scrollTop = box.scrollHeight;
  } catch {}
}
let gcHist = [];
try { gcHist = JSON.parse(store.get("crpanel_gchist", "[]")); } catch {}
let gcIdx = gcHist.length;
$("gcIn").onkeydown = e => {
  if (e.key === "ArrowUp" && gcIdx > 0) { gcIdx--; $("gcIn").value = gcHist[gcIdx]; e.preventDefault(); }
  else if (e.key === "ArrowDown" && gcIdx < gcHist.length) { gcIdx++; $("gcIn").value = gcHist[gcIdx] || ""; e.preventDefault(); }
};
$("gcForm").onsubmit = e => {
  e.preventDefault();
  const cmd = $("gcIn").value.trim();
  if (!cmd) return;
  $("gcIn").value = "";
  if (gcHist[gcHist.length - 1] !== cmd) gcHist.push(cmd);
  gcHist = gcHist.slice(-50); gcIdx = gcHist.length;
  store.set("crpanel_gchist", JSON.stringify(gcHist));
  gcode(cmd).then(() => setTimeout(loadConsole, 300)).catch(err => toast(err.message, true));
};

async function loadHistory() {
  try {
    const { jobs } = await get("/server/history/list?limit=20&order=desc");
    const busy = S && ["printing", "paused"].includes(S.print_stats.state);
    $("hist").innerHTML = "";
    for (const j of jobs) {
      const tr = document.createElement("tr");
      const d = new Date(j.start_time * 1000);
      tr.innerHTML = "<td class='f'><div class='fc'><img alt=''><span></span></div></td><td></td><td></td><td></td><td></td><td></td>";
      const c = tr.children;
      const th = bestThumb(j.metadata && j.metadata.thumbnails);
      if (th && j.exists) c[0].querySelector("img").src = thumbUrl(j.filename, th.relative_path);
      else c[0].querySelector("img").replaceWith(Object.assign(document.createElement("div"), { className: "nothumb" }));
      c[0].querySelector("span").textContent = j.filename; c[0].title = j.filename;
      const btn = document.createElement("button");
      btn.textContent = "Reimprimir";
      btn.disabled = busy || !j.exists;
      btn.title = j.exists ? "" : "El archivo ya no está en la impresora";
      btn.onclick = () => act(() => post(`/printer/print/start?filename=${encodeURIComponent(j.filename)}`),
        "Impresión iniciada", `¿Volver a imprimir "${j.filename}"? Comprueba que la cama esté libre${HW.box ? ` y que el ${cfsName(P)} tenga los colores correctos` : ""}.`);
      const acts = document.createElement("div");
      acts.className = "acts";
      acts.append(downloadBtn(j.filename, j.exists), btn);
      c[5].appendChild(acts);
      c[1].innerHTML = `<span class="pill ${esc(j.status === "completed" ? "complete" : j.status === "in_progress" ? "printing" : j.status)}">${esc(STATE_ES[j.status] || j.status)}</span>`;
      c[2].textContent = `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      c[3].textContent = j.print_duration ? fmtDur(j.print_duration) : "—";
      c[4].textContent = j.filament_used ? (j.filament_used / 1000).toFixed(2) + " m" : "—";
      $("hist").appendChild(tr);
    }
    if (!jobs.length) $("hist").innerHTML = '<tr><td class="muted" colspan="6">Sin trabajos</td></tr>';
  } catch {}
}

document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => {
  document.querySelectorAll(".tabs button").forEach(x => x.setAttribute("aria-selected", x === b));
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("on", t.id === "tab-" + b.dataset.tab));
  store.set("k1se_tab", b.dataset.tab);
  ({ control: drawChart, mesh: loadMesh, timelapse: loadTimelapses, stats: loadStats, files: loadFiles, console: loadConsole, history: loadHistory }[b.dataset.tab] || (() => {}))();
});

const ZOOM_SEL = "#thumb, .file img, .hist .fc img";
function openLightbox(img) {
  if (!img.getAttribute("src") || !img.naturalWidth) return;
  const row = img.closest(".file, tr");
  const name = img.id === "thumb" ? $("fname").textContent
    : row ? (row.querySelector(".n, .fc span") || {}).textContent : "";
  let sub = "";
  if (img.id === "thumb") sub = $("eta").textContent;
  else if (row && row.querySelector(".d")) sub = row.querySelector(".d").textContent;
  else if (row && row.tagName === "TR") sub = [...row.children].slice(1, 5).map(td => td.textContent.trim()).filter(t => t && t !== "—").join(" · ");
  $("lbImg").src = img.src;
  $("lbCap").textContent = name || "";
  $("lbSub").textContent = sub || "";
  $("lightbox").classList.add("on");
}
const closeLightbox = () => $("lightbox").classList.remove("on");
document.addEventListener("click", e => {
  const img = e.target.closest(ZOOM_SEL);
  if (img) openLightbox(img);
});
$("lbClose").onclick = closeLightbox;
$("lightbox").onclick = e => { if (e.target === $("lightbox")) closeLightbox(); };
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (confirmDone) return confirmDone(false);
  closeLightbox();
  ["slotModal", "settingsModal", "printerModal", "scanModal"].forEach(id => $(id).classList.remove("on"));
});
