const RT = {};
const rtOf = p => RT[p.id] || (RT[p.id] = {
  st: null, online: null, moonraker: false, klippy: null, objects: null, head: null, hasBox: false, hostname: "", busy: false,
  ev: { prev: null, tempArm: {}, etaDone: false, offlineSince: 0, offlineNotified: false },
});
async function pget(p, path, ms = 4000) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(hostUrl(p.host, PORTS.api, path), { cache: "no-store", signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status}`);
    return (await r.json()).result;
  } finally { clearTimeout(timer); }
}
async function watchOne(p) {
  const rt = rtOf(p);
  if (rt.busy) return;
  rt.busy = true;
  try {
    if (!rt.objects) {
      const info = await pget(p, "/printer/info");
      rt.hostname = info.hostname || "";
      const { objects } = await pget(p, "/printer/objects/list");
      rt.objects = objects;
      rt.head = objects.find(o => /^filament_(switch|motion)_sensor /.test(o)) || null;
      rt.hasBox = objects.includes("box");
      if (p.model === "auto") { p.model = resolveModel(rt.hostname, rt.hasBox); savePrinters().catch(() => {}); hubKey = ""; }
    }
    const q = ["print_stats", "virtual_sdcard", "extruder", "heater_bed", "webhooks", rt.head, rt.hasBox && "box"].filter(Boolean);
    rt.st = (await pget(p, `/printer/objects/query?${q.map(encodeURIComponent).join("&")}`)).status;
    rt.online = true; rt.moonraker = true; rt.klippy = rt.st.webhooks.state;
    printerEvents(p, rt);
  } catch {
    rt.online = false; rt.objects = null;
    try { rt.klippy = (await pget(p, "/server/info", 3000)).klippy_state; rt.moonraker = true; }
    catch { rt.moonraker = false; rt.klippy = null; }
    offlineEvents(p, rt);
  } finally { rt.busy = false; }
  if (!$("hubView").hidden) {
    if (!hubKey) renderHub();
    else { renderCard(p); renderHubSummary(); }
  }
}
const watchAll = () => printers.forEach(watchOne);

function cardState(p) {
  const rt = RT[p.id];
  if (!rt || rt.online === null) return { cls: "", text: "Conectando" };
  if (!rt.online) return rt.moonraker ? { cls: "error", text: "Klipper no disponible" } : { cls: "offline", text: "Sin conexión" };
  const st = rt.st, state = st.webhooks.state !== "ready" ? "error" : st.print_stats.state;
  return { cls: state, state, text: STATE_ES[state] || state };
}
const slotColor = (unit, i) =>
  /^0?[0-9A-F]{6}$/i.test(String(unit.color_value[i])) ? "#" + String(unit.color_value[i]).slice(-6) : "#8a9399";
function cfsBoxSvg(box, u, label) {
  const unit = box[u];
  const spools = [0, 1, 2, 3].map(i => {
    const x = 22 + i * 26, loaded = (unit.material_sensor >> i) & 1, active = box.last_tnn === u + "ABCD"[i];
    return (active ? `<circle cx="${x}" cy="34" r="12.5" fill="none" stroke="#1ec85a" stroke-width="2.5"/>` : "") +
      (loaded ? `<circle cx="${x}" cy="34" r="10" fill="${slotColor(unit, i)}"/><circle cx="${x}" cy="34" r="3.5" fill="#20262a"/>`
              : `<circle cx="${x}" cy="34" r="9.5" fill="none" stroke="#5d676e" stroke-dasharray="3 3"/>`);
  }).join("");
  return `<svg viewBox="0 0 122 58" aria-label="${esc(label)}">
    <rect x="1" y="6" width="120" height="50" rx="8" fill="#2a3035" stroke="#4c565d"/>
    <rect x="1" y="6" width="120" height="9" rx="6" fill="#3a4248"/>
    <rect x="8" y="20" width="106" height="29" rx="5" fill="#14171a"/>${spools}
    <text x="61" y="13.5" fill="#c9d0d4" font-size="7" font-weight="700" text-anchor="middle" font-family="sans-serif">${esc(label)}</text>
  </svg>`;
}
function cfsLiteSvg(box, u, label) {
  const unit = box[u];
  const feeders = [0, 1, 2, 3].map(i => {
    const cx = 21 + i * 21;
    return `<path d="M${cx - 5.5} 31 V15 q0 -4.5 4 -5.5 l4.5 -1.2 q2.5 -.6 2.5 2 V31 z" fill="#1b1f22"/>
      <circle cx="${cx}" cy="22" r="1.6" fill="#f4f6f7"/>`;
  }).join("");
  const spools = [0, 1, 2, 3].map(i => {
    const x = 14 + i * 21, loaded = (unit.material_sensor >> i) & 1, active = box.last_tnn === u + "ABCD"[i];
    return (loaded ? `<rect x="${x}" y="49" width="19" height="50" rx="4" fill="${slotColor(unit, i)}"/>
        <rect x="${x + 4}" y="49" width="2" height="50" fill="#000" opacity=".2"/>`
      : `<rect x="${x + .5}" y="49.5" width="18" height="49" rx="4" fill="none" stroke="#5d676e" stroke-dasharray="3 3"/>`) +
      (active ? `<rect x="${x - 1.5}" y="47.5" width="22" height="53" rx="5" fill="none" stroke="#1ec85a" stroke-width="2"/>` : "");
  }).join("");
  return `<svg viewBox="0 0 110 112" aria-label="${esc(label)}">
    <rect x="10" y="22" width="90" height="16" rx="6" fill="#3a4248"/>${feeders}
    <rect x="3" y="33" width="104" height="77" rx="10" fill="#e9edef" stroke="#c4cacd"/>
    <rect x="10" y="44" width="90" height="60" rx="6" fill="#2a3136" stroke="#4c565d"/>
    <rect x="46" y="39" width="18" height="4" rx="2" fill="#f4f6f7" stroke="#c4cacd" stroke-width=".6"/>${spools}
    <text x="14" y="101" font-family="sans-serif" font-size="7" font-weight="800" fill="#f4f6f7">CFS</text>
    <rect x="31" y="95" width="13" height="7" rx="1.5" fill="#f4f6f7"/>
    <text x="37.5" y="100.6" font-family="sans-serif" font-size="5.4" font-weight="800" fill="#2a3136" text-anchor="middle">lite</text>
  </svg>`;
}
function cfsMini(box, p) {
  const units = connectedUnits(box), label = cfsName(p);
  return units.map(u => {
    const name = label + (units.length > 1 ? " " + u[1] : "");
    return familyOf(p).cfsLite ? cfsLiteSvg(box, u, name) : cfsBoxSvg(box, u, name);
  }).join("");
}

const svgCache = {};
let sceneUid = 0;
async function mountScene(a, p) {
  const url = familyOf(p).img;
  if (!(url in svgCache)) svgCache[url] = fetch(url).then(r => (r.ok ? r.text() : null)).catch(() => null);
  const txt = await svgCache[url];
  if (!txt || !a.isConnected) return;
  const id = "sc" + ++sceneUid;
  const holder = document.createElement("div");
  holder.className = "pscene";
  holder.innerHTML = txt.replace(/<\?xml[^>]*\?>/, "").replace(/id="([^"]+)"/g, `id="${id}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${id}-$1)`).replace(/href="#([^"]+)"/g, `href="#${id}-$1"`);
  a.querySelector(".pimg").prepend(holder);
  a.querySelector(".pimg > img").hidden = true;
  renderCard(p);
  layoutHub();
}
function layoutHub() {
  const grid = $("hubGrid");
  if (grid.hidden) return;
  grid.querySelectorAll(".pcard[data-id]").forEach(a => {
    const p = printers.find(x => x.id === a.dataset.id);
    if (!p) return;
    const box = a.querySelector(".pimg"), img = a.querySelector(".pimg > img");
    if (p.photo) return img.removeAttribute("style");
    placeArt(box, a.querySelector(".pscene") || img, familyOf(p).geo);
  });
}
function layoutHero() {
  if ($("hubEmpty").hidden) return;
  document.querySelectorAll("#hubEmpty .hslot").forEach(s => placeArt(s, s.querySelector("img"), FAMILIES[s.dataset.model].geo, { floor: .97, top: 0, maxW: 1 }));
}
new ResizeObserver(() => { layoutHub(); layoutHero(); }).observe(document.body);
const tint = (hex, k) => "#" + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - k) + 255 * k).toString(16).padStart(2, "0")).join("");
function paintScene(svg, box) {
  const u = box && connectedUnits(box)[0], unit = u && box[u];
  const show = (sel, on) => svg.querySelectorAll(sel).forEach(e => e.setAttribute("display", on ? "inline" : "none"));
  for (let i = 0; i < 4; i++) {
    const loaded = unit ? (unit.material_sensor >> i) & 1 : 1, color = unit && slotColor(unit, i);
    show(`[data-slot="${i}"], [data-slot-hub="${i}"]`, loaded);
    show(`[data-empty="${i}"]`, !loaded);
    show(`[data-active="${i}"]`, unit && box.last_tnn === u + "ABCD"[i]);
    if (color) svg.querySelectorAll(`[data-slot="${i}"]`).forEach(e => e.setAttribute("fill", color));
    svg.querySelectorAll(`[data-tube="${i}"]`).forEach(e => {
      if (color) e.setAttribute("stroke", tint(color, .35));
      e.setAttribute("opacity", loaded ? 1 : .3);
    });
  }
}

let hubKey = "";
function buildHub() {
  const grid = $("hubGrid");
  grid.innerHTML = "";
  for (const p of printers) {
    const a = document.createElement("article");
    a.className = "pcard"; a.dataset.id = p.id; a.tabIndex = 0;
    a.innerHTML = `<div class="pimg"><img alt=""><div class="cfsmini"></div>
        <button class="icon pedit" title="Editar" aria-label="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="M13.5 6.5l4 4"/></svg></button></div>
      <div class="pinfo">
        <div class="ptop"><div class="ptitle"><b class="pname"></b><span class="pmodel"></span></div><span class="pill"></span></div>
        <div class="pfile"></div>
        <div class="phint"></div>
        <div class="pbar"><div></div></div>
        <div class="prow"><b class="ppct"></b><span class="pwhen"></span></div>
        <div class="ptemps"><span><i style="background:var(--nozzle)"></i><span class="tn">—</span></span>
          <span><i style="background:var(--bed)"></i><span class="tb">—</span></span><span class="go">Abrir ›</span></div>
      </div>`;
    a.querySelector("img").src = printerImg(p);
    a.classList.toggle("wide", !!familyOf(p).scene && !p.photo);
    if (familyOf(p).scene && !p.photo) mountScene(a, p);
    a.querySelector(".pname").textContent = p.name;
    a.querySelector(".pmodel").textContent = p.model === "auto" ? "Detectando modelo…" : familyOf(p).name;
    a.querySelector(".pedit").onclick = e => { e.stopPropagation(); openPrinterDialog(p); };
    a.onclick = () => (location.hash = `#/p/${p.id}`);
    a.onkeydown = e => { if (e.key === "Enter") a.click(); };
    grid.appendChild(a);
  }
  const add = document.createElement("button");
  add.className = "pcard addcard js-add";
  add.innerHTML = `<span class="plus">+</span><span class="addtxt"><b>Agregar impresora</b><span class="muted">o búscala en tu red</span></span>`;
  add.onclick = () => openPrinterDialog(null);
  grid.appendChild(add);
}
function renderCard(p) {
  const a = document.querySelector(`.pcard[data-id="${p.id}"]`);
  if (!a) return;
  const rt = RT[p.id], cs = cardState(p), st = rt && rt.online ? rt.st : null;
  const pill = a.querySelector(".pill");
  pill.className = "pill " + cs.cls; pill.textContent = cs.text;
  a.classList.toggle("off", !(rt && rt.online));
  const box = st && st.box;
  const mini = a.querySelector(".cfsmini"), scene = a.querySelector(".pscene svg");
  mini.innerHTML = box && !scene ? cfsMini(box, p) : "";
  if (scene) paintScene(scene, box);
  mini.classList.toggle("lite", !!familyOf(p).cfsLite);
  mini.classList.toggle("left", !!familyOf(p).cfsLeft);
  a.querySelector(".pimg").classList.toggle("withleft", !!(familyOf(p).cfsLeft && mini.innerHTML));
  const active = st && isActive(cs.state), ps = st && st.print_stats;
  const p01 = !st ? 0 : cs.state === "complete" ? 1 : active ? st.virtual_sdcard.progress : 0;
  const showProg = active || cs.state === "complete";
  a.dataset.state = cs.state || "";
  a.querySelector(".pfile").textContent = ps && ps.filename ? ps.filename : st ? "Sin trabajo" : "Sin conexión";
  const hint = a.querySelector(".phint");
  hint.hidden = showProg;
  hint.textContent = !rt || rt.online === null ? "Conectando con la impresora…" : st ? (cs.state === "error" ? "Revisa la impresora" : "Lista para imprimir") : "Revisa que esté encendida";
  a.querySelector(".pbar").hidden = a.querySelector(".prow").hidden = !showProg;
  a.querySelector(".pbar div").style.width = (p01 * 100).toFixed(1) + "%";
  const remain = cs.state === "printing" && p01 >= 0.05 ? ps.print_duration * (1 - p01) / p01 : null;
  a.querySelector(".ppct").textContent = Math.floor(p01 * 100) + " %";
  a.querySelector(".pwhen").textContent = remain ? "Termina " + new Date(Date.now() + remain * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : cs.state === "paused" ? "En pausa" : cs.state === "complete" ? "Terminado" : cs.state === "printing" ? "Calculando…" : "";
  const tt = o => (o ? `${Math.round(o.temperature)}°${o.target ? " / " + Math.round(o.target) + "°" : ""}` : "—");
  a.querySelector(".tn").textContent = st ? tt(st.extruder) : "—";
  a.querySelector(".tb").textContent = st ? tt(st.heater_bed) : "—";
}
function renderHubSummary() {
  const n = printers.length, count = s => printers.filter(p => cardState(p).state === s).length;
  const printing = count("printing"), paused = count("paused");
  const offline = printers.filter(p => RT[p.id] && RT[p.id].online === false).length;
  $("hubSub").textContent = !n ? "Panel para impresoras con Klipper"
    : [`${n} impresora${n > 1 ? "s" : ""}`, printing && `${printing} imprimiendo`, paused && `${paused} en pausa`,
       offline && `${offline} sin conexión`].filter(Boolean).join(" · ");
  if (!$("hubView").hidden) document.title = printing ? `${printing} imprimiendo · Impresoras` : "Impresoras";
}
function renderHub() {
  $("hubEmpty").hidden = printers.length > 0;
  $("hubGrid").hidden = !printers.length;
  $("hubAddBtn").hidden = $("hubScanBtn").hidden = !printers.length;
  const key = printers.map(p => [p.id, p.name, p.model, p.photoV || 0].join("|")).join();
  if (key !== hubKey) { buildHub(); hubKey = key; }
  printers.forEach(renderCard);
  layoutHub(); layoutHero();
  renderHubSummary();
}

function showHub() {
  stopPanel();
  $("panelView").hidden = true; $("hubView").hidden = false;
  window.scrollTo(0, 0);
  renderHub();
}
function openPanel(p) {
  $("hubView").hidden = true; $("panelView").hidden = false;
  window.scrollTo(0, 0);
  if (P !== p) { P = p; connect(); }
}
function route() {
  ["printerModal", "scanModal", "settingsModal", "slotModal"].forEach(id => $(id).classList.remove("on"));
  const m = location.hash.match(/^#\/p\/([\w-]+)/);
  const p = m && printers.find(x => x.id === m[1]);
  if (p) openPanel(p);
  else { if (m) history.replaceState(null, "", "#/"); showHub(); }
}
window.addEventListener("hashchange", route);

let pmEdit = null, pmPhoto = null;
function camRow(c) {
  const d = document.createElement("div");
  d.className = "pmcam";
  d.innerHTML = `<input type="text" class="cname" placeholder="Nombre"><select class="ctype">${
    Object.entries(CAM_TYPES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select>
    <input type="text" class="cval" spellcheck="false"><button type="button" class="icon danger cdel" title="Quitar cámara" aria-label="Quitar cámara">✕</button>
    <div class="chint muted"></div>`;
  d.dataset.id = c.id || newId();
  d.querySelector(".cname").value = c.name || "";
  d.querySelector(".ctype").value = c.type || "creality";
  d.querySelector(".cval").value = c.type === "go2rtc" ? c.src || "" : c.url || "";
  const sync = () => {
    const t = d.querySelector(".ctype").value, v = d.querySelector(".cval");
    v.hidden = t === "creality";
    v.placeholder = t === "go2rtc" ? "Nombre del stream, p. ej. tapo_k1" : "http://192.168.1.x:8080/video";
    d.querySelector(".chint").textContent = t === "creality" ? "La cámara de las K1, a través de la propia impresora."
      : t === "go2rtc" ? "El nombre con el que la cámara está configurada en go2rtc, en tu servidor."
      : "Por ejemplo un móvil con IP Webcam o una ESP32-CAM. Si es de tu red local, el servidor la reenvía.";
  };
  d.querySelector(".ctype").onchange = sync;
  d.querySelector(".cdel").onclick = () => d.remove();
  sync();
  $("pmCams").appendChild(d);
}
function readCams() {
  return [...document.querySelectorAll("#pmCams .pmcam")].map(d => {
    const type = d.querySelector(".ctype").value, val = d.querySelector(".cval").value.trim();
    const c = { id: d.dataset.id, name: d.querySelector(".cname").value.trim() || { creality: "Cámara de la impresora", go2rtc: "Tapo", mjpeg: "Cámara" }[type], type };
    if (type === "go2rtc") c.src = val;
    if (type === "mjpeg") c.url = val;
    return c;
  });
}
function pmPreview() {
  const model = $("pmModel").value;
  $("pmImg").src = pmPhoto && pmPhoto.url ? pmPhoto.url
    : pmEdit && pmEdit.photo && !(pmPhoto && pmPhoto.remove) ? printerImg(pmEdit) : (FAMILIES[model] || FAMILIES.generic).img;
  $("pmPhotoDel").hidden = !(pmPhoto && pmPhoto.url) && !(pmEdit && pmEdit.photo && !(pmPhoto && pmPhoto.remove));
}
function openPrinterDialog(p, preset) {
  pmEdit = p; pmPhoto = null;
  const d = p || { name: "", model: "auto", host: "", cameras: [], ...preset };
  $("pmTitle").textContent = p ? "Editar impresora" : "Agregar impresora";
  $("pmModel").innerHTML = `<option value="auto">Detectar automáticamente</option>` +
    Object.entries(FAMILIES).map(([k, f]) => `<option value="${k}">${esc(f.name)}</option>`).join("");
  $("pmName").value = d.name; $("pmModel").value = d.model; $("pmHost").value = d.host;
  $("pmCams").innerHTML = "";
  d.cameras.forEach(camRow);
  $("pmRes").innerHTML = "";
  $("pmDel").hidden = !p;
  $("pmPhotoActs").hidden = !VIA_SERVER;
  pmPreview();
  $("printerModal").classList.add("on");
  setTimeout(() => (p ? $("pmName") : $("pmHost")).focus(), 50);
}
const pmLine = (ok, text) => {
  const d = document.createElement("div");
  d.innerHTML = `<span class="${ok ? "ok" : "bad"}">${ok ? "✔" : "✖"}</span><span></span>`;
  d.lastChild.textContent = text;
  $("pmRes").appendChild(d);
};
$("pmModel").onchange = pmPreview;
$("pmPhotoBtn").onclick = () => $("pmPhotoIn").click();
$("pmPhotoIn").onchange = e => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  if (pmPhoto && pmPhoto.url) URL.revokeObjectURL(pmPhoto.url);
  pmPhoto = { file: f, url: URL.createObjectURL(f) };
  pmPreview();
};
$("pmPhotoDel").onclick = () => { pmPhoto = { remove: true }; pmPreview(); };
$("pmAddCam").onclick = () => camRow({ type: "go2rtc" });
$("pmNo").onclick = () => $("printerModal").classList.remove("on");
$("printerModal").onclick = e => { if (e.target === $("printerModal")) $("printerModal").classList.remove("on"); };
$("pmTest").onclick = async () => {
  const host = $("pmHost").value.trim();
  $("pmRes").innerHTML = "";
  if (!validHost(host)) return pmLine(false, VIA_SERVER ? "Escribe una IP de tu red local, por ejemplo 192.168.1.50" : "Escribe la IP de la impresora");
  const info = await probePrinter(host, 5000);
  if (!info) return pmLine(false, `No hay Klipper (Moonraker) respondiendo en ${host}`);
  pmLine(true, `Klipper: ${info.hostname} (${STATE_ES[info.state] || info.state})`);
  if ($("pmModel").value === "auto") pmLine(true, `Modelo detectado: ${familyOf({ model: familyFromHost(info.hostname) }).name}`);
  if (!$("pmName").value.trim()) $("pmName").value = nameFor(info.hostname);
};
$("pmSave").onclick = async () => {
  const host = $("pmHost").value.trim();
  if (!validHost(host)) return toast(VIA_SERVER ? "Escribe una IP de tu red local, por ejemplo 192.168.1.50" : "Escribe la IP de la impresora", true);
  if (printers.some(x => x.host === host && x !== pmEdit)) return toast("Ya tienes una impresora con esa IP", true);
  const p = pmEdit || { id: newId() };
  const before = pmEdit && JSON.stringify(pmEdit), oldHost = pmEdit && pmEdit.host;
  Object.assign(p, { name: $("pmName").value.trim() || nameFromHost(""), model: $("pmModel").value, host, cameras: readCams() });
  try {
    if (pmPhoto && pmPhoto.file) { p.photo = await putPhoto(p.id, pmPhoto.file); p.photoV = Date.now(); }
    else if (pmPhoto && pmPhoto.remove && p.photo) { deletePhoto(p.photo); delete p.photo; delete p.photoV; }
    if (!pmEdit) printers.push(p);
    await savePrinters();
  } catch (e) {
    if (pmEdit) Object.assign(pmEdit, JSON.parse(before)); else printers = printers.filter(x => x !== p);
    return toast("No se pudo guardar: " + e.message, true);
  }
  $("printerModal").classList.remove("on");
  toast(pmEdit ? "Impresora actualizada" : "Impresora agregada");
  if (oldHost !== host) delete RT[p.id];
  hubKey = "";
  watchOne(p);
  if (P === p) { applyPrinterUi(); connect(); }
  else renderHub();
};
$("pmDel").onclick = async () => {
  const p = pmEdit;
  if (!p || !(await confirmBox(`¿Eliminar "${p.name}" del panel? La impresora no se modifica.`))) return;
  printers = printers.filter(x => x !== p);
  try { await savePrinters(); } catch (e) { printers.push(p); return toast("No se pudo guardar: " + e.message, true); }
  if (p.photo) deletePhoto(p.photo);
  delete RT[p.id];
  $("printerModal").classList.remove("on");
  toast("Impresora eliminada");
  if (P === p) location.hash = "#/"; else renderHub();
};
$("editPrinterBtn").onclick = () => P && openPrinterDialog(P);

let scanFound = [], scanning = false;
function openScan() {
  $("scNet").value = defaultNet();
  $("scList").innerHTML = ""; $("scStatus").textContent = ""; $("scBar").hidden = true;
  $("scAdd").disabled = true; scanFound = [];
  $("scanModal").classList.add("on");
}
$("scGo").onclick = async () => {
  const net = $("scNet").value.trim().replace(/\.$/, "");
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(net) || (VIA_SERVER && !isPrivateIp(net + ".1")))
    return toast("Escribe los tres primeros números de tu red local, por ejemplo 192.168.1", true);
  if (scanning) return;
  scanning = true; store.set("crpanel_scan", net);
  $("scGo").disabled = true; $("scBar").hidden = false; $("scList").innerHTML = ""; $("scAdd").disabled = true;
  scanFound = await scanNetwork(net, (done, found) => {
    $("scBar").firstElementChild.style.width = (done / 254 * 100).toFixed(1) + "%";
    $("scStatus").textContent = `Revisando ${done} de 254 direcciones · ${found.length} encontrada${found.length === 1 ? "" : "s"}`;
  });
  scanning = false; $("scGo").disabled = false;
  $("scStatus").textContent = scanFound.length ? `Encontré ${scanFound.length} impresora${scanFound.length > 1 ? "s" : ""} con Klipper.`
    : "No encontré ninguna impresora con Klipper en esa red.";
  for (const f of scanFound) {
    const known = printers.find(p => p.host === f.host), model = familyFromHost(f.info.hostname);
    const row = document.createElement("label");
    row.className = "scrow" + (known ? " known" : "");
    row.innerHTML = `<input type="checkbox" ${known ? "disabled" : "checked"}><img alt=""><span><b></b><span class="muted"></span></span>`;
    row.querySelector("img").src = FAMILIES[model].img;
    row.querySelector("b").textContent = nameFor(f.info.hostname);
    row.querySelector(".muted").textContent = `${FAMILIES[model].name} · ${f.host}${known ? ` · ya agregada como "${known.name}"` : ""}`;
    row.querySelector("input").onchange = () => ($("scAdd").disabled = !document.querySelector("#scList input:checked"));
    f.row = row;
    $("scList").appendChild(row);
  }
  $("scAdd").disabled = !document.querySelector("#scList input:checked");
};
$("scAdd").onclick = async () => {
  const pick = scanFound.filter(f => f.row.querySelector("input").checked && !printers.some(p => p.host === f.host));
  const added = pick.map(f => {
    const model = familyFromHost(f.info.hostname);
    return { id: newId(), name: nameFor(f.info.hostname), model: "auto", host: f.host,
             cameras: FAMILIES[model].creality ? [{ id: newId(), name: "Cámara de la impresora", type: "creality" }] : [] };
  });
  printers.push(...added);
  try { await savePrinters(); }
  catch (e) { printers = printers.filter(p => !added.includes(p)); return toast("No se pudo guardar: " + e.message, true); }
  $("scanModal").classList.remove("on");
  toast(`${added.length} impresora${added.length > 1 ? "s agregadas" : " agregada"}`);
  added.forEach(watchOne);
  renderHub();
};
$("scClose").onclick = () => $("scanModal").classList.remove("on");
$("scanModal").onclick = e => { if (e.target === $("scanModal")) $("scanModal").classList.remove("on"); };
document.querySelectorAll(".js-scan").forEach(b => (b.onclick = openScan));
document.querySelectorAll(".js-add").forEach(b => (b.onclick = () => openPrinterDialog(null)));
$("hubRetry").onclick = () => boot();
