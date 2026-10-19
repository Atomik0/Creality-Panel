const UNITS = ["T1", "T2", "T3", "T4"];
let slotEls = {};
let unitsKey = "";
const connectedUnits = box => UNITS.filter(u => box && box[u] && box[u].state === "connect" &&
  ["material_id", "color_value", "total_len", "remain_len"].every(k => Array.isArray(box[u][k])));
const parseTnn = t => (t && /^T[1-4][A-D]$/.test(t) ? { unit: t.slice(0, 2), n: Number(t[1]), L: t[2], i: "ABCD".indexOf(t[2]) } : null);

function buildSlots(units) {
  $("slots").innerHTML = "";
  $("slots").style.display = "block";
  slotEls = {};
  for (const u of units) {
    const wrap = document.createElement("div");
    wrap.className = "cfsunit";
    wrap.innerHTML = `${units.length > 1 ? `<h4>${esc(cfsName(P))} ${u[1]}</h4>` : ""}<div class="slots"></div>`;
    for (let i = 0; i < 4; i++) {
      const L = "ABCD"[i], id = u + L;
      const d = document.createElement("div");
      d.className = "slot";
      d.innerHTML = `<span class="tag">${units.length > 1 ? u[1] : ""}${L}</span><span class="badge" hidden>EN USO</span>
        <div class="spool"></div><div class="mat"></div><div class="temp"></div>
        <div class="meter"><div></div></div><div class="muted rem" style="font-size:12px"></div>
        <div class="acts"><button class="load">Cargar</button><button class="edit">Editar</button></div>`;
      d.querySelector(".load").onclick = () => loadSlot(id);
      d.querySelector(".edit").onclick = () => editSlot(id);
      wrap.querySelector(".slots").appendChild(d);
      slotEls[id] = d;
    }
    $("slots").appendChild(wrap);
  }
}
const slotInfo = id => {
  const t = parseTnn(id), unit = S.box[t.unit], i = t.i;
  const mat = matById(unit.material_id[i]);
  return { id, n: t.n, L: t.L, mat, name: mat ? mat[1] : "Filamento", temp: mat ? mat[2] : 220,
           color: "#" + String(unit.color_value[i]).slice(1).toUpperCase(),
           loaded: (unit.material_sensor >> i) & 1,
           remain: Number(unit.total_len[i]) > 0 ? Number(unit.remain_len[i]) : -1 };
};
const slotLabel = s => (connectedUnits(S.box).length > 1 ? `${s.n}${s.L}` : s.L);

function renderCfs(box, cutter) {
  const units = connectedUnits(box);
  if (!units.length) {
    slotEls = {}; unitsKey = "";
    $("slots").innerHTML = '<div class="muted">CFS no conectado</div>';
    return;
  }
  if (units.join() !== unitsKey) { buildSlots(units); unitsKey = units.join(); }
  const printing = ["printing", "paused"].includes(S.print_stats.state);
  for (const [id, d] of Object.entries(slotEls)) {
    const s = slotInfo(id), active = id === box.last_tnn;
    d.className = "slot" + (s.loaded ? "" : " empty") + (active ? " active" : "");
    d.querySelector(".badge").hidden = !active;
    d.querySelector(".spool").style.background = s.loaded ? s.color : "";
    d.querySelector(".mat").textContent = s.loaded ? s.name : "Vacío";
    d.querySelector(".temp").textContent = s.loaded ? `${s.temp} °C` : "Introduce un carrete";
    d.querySelector(".meter div").style.width = s.loaded && s.remain >= 0 ? s.remain + "%" : "0";
    d.querySelector(".meter").hidden = !(s.loaded && s.remain >= 0);
    d.querySelector(".rem").textContent = s.loaded ? (s.remain >= 0 ? `Restante ${s.remain} %` : "Sin RFID · restante desconocido") : "";
    d.querySelector(".load").disabled = printing || !s.loaded || active;
    d.querySelector(".edit").disabled = printing;
  }
  const cur = parseTnn(box.last_tnn);
  const head = HW.head ? S[HW.head] : null;
  const first = box[units[0]];
  $("pBox").className = "led" + (units.some(u => box[u].material_sensor) ? " on" : "");
  $("pSlot").textContent = cur ? `ranura ${units.length > 1 ? cur.n : ""}${cur.L}` : "sin ranura";
  $("pBuf").className = "led" + (cutter && cutter.state === "connect" ? " on" : "");
  $("pBufTxt").textContent = cutter ? (cutter.state === "connect" ? "conectado" : "sin conexión") : "—";
  $("pCut").className = "led" + (head && head.filament_detected ? " on" : "");
  $("pCutTxt").textContent = head ? (head.filament_detected ? "con filamento" : "vacío") : "—";
  $("unloadBtn").disabled = printing || (head ? !head.filament_detected : !cur);
  $("cfsLock").textContent = printing ? "Las acciones del CFS se bloquean mientras imprime." : "";
  $("cfsT").textContent = units.map(u => box[u].temperature + " °C").join(" · ");
  $("cfsH").textContent = units.map(u => box[u].dry_and_humidity + " %").join(" · ");
  $("cfsCuts").textContent = cutter ? cutter.cut_success_count : "—";
  $("cfsFw").textContent = first.version;
}

async function cfsHeated(temp, cmd) {
  const back = S && S.extruder ? S.extruder.target : 0;
  cfsBusy = true;
  try { await gcode(`M109 S${temp}\n${cmd}\nM104 S${back}`); }
  catch (e) { await gcode(`M104 S${back}`).catch(() => {}); throw e; }
  finally { cfsBusy = false; }
}
function loadSlot(id) {
  const s = slotInfo(id), L = slotLabel(s);
  act(async () => {
    toast(`Calentando a ${s.temp} °C y cargando la ranura ${L}…`);
    await cfsHeated(s.temp, `BOX_EXTRUDE_MATERIAL TNN=${id}`);
  }, `Ranura ${L} cargada`,
  `¿Cargar la ranura ${L} (${s.name})? La boquilla se calentará a ${s.temp} °C; si hay otro filamento en el cabezal, se cortará y se retirará primero.`);
}
$("unloadBtn").onclick = () => {
  const cur = parseTnn(S.box.last_tnn);
  const temp = cur && S.box[cur.unit] ? slotInfo(S.box.last_tnn).temp : 220;
  act(async () => {
    toast(`Calentando a ${temp} °C y descargando…`);
    await cfsHeated(temp, "BOX_RETRUDE_MATERIAL");
  }, "Filamento descargado", `¿Descargar el filamento del cabezal? La boquilla se calentará a ${temp} °C, se cortará el filamento y volverá al CFS.`);
};

let editing = null;
function editSlot(id) {
  const s = slotInfo(id);
  editing = s;
  $("smSlot").textContent = slotLabel(s);
  $("smMat").innerHTML = MATERIALS.map(m => `<option value="${m[0]}">${esc(m[1])} · ${m[2]} °C</option>`).join("");
  $("smMat").value = s.mat ? s.mat[0] : "00001";
  $("smColor").value = /^#[0-9A-F]{6}$/.test(s.color) ? s.color.toLowerCase() : "#ffffff";
  $("slotModal").classList.add("on");
}
$("smSw").innerHTML = SWATCHES.map(c => `<button type="button" style="background:${c}" data-c="${c}" aria-label="${c}"></button>`).join("");
$("smSw").onclick = e => { const b = e.target.closest("button"); if (b) $("smColor").value = b.dataset.c.toLowerCase(); };
$("smNo").onclick = () => $("slotModal").classList.remove("on");
$("smYes").onclick = () => {
  const s = editing, id = $("smMat").value, hex = $("smColor").value.slice(1).toUpperCase();
  $("slotModal").classList.remove("on");
  act(() => gcode(`BOX_MODIFY_TN_DATA ADDR=${s.n} NUM=${s.L} PART=material_type DATA=1${id}\n` +
                  `BOX_MODIFY_TN_DATA ADDR=${s.n} NUM=${s.L} PART=color_value DATA=0${hex}`), `Ranura ${slotLabel(s)} actualizada`);
};

document.querySelectorAll(".seg[data-cmd]").forEach(seg => {
  const mark = v => seg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === v));
  mark(store.get(seg.dataset.key, null));
  seg.onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    act(() => gcode(seg.dataset.cmd + b.dataset.v), "Opción del CFS actualizada")
      .then(ok => { if (ok) { store.set(seg.dataset.key, b.dataset.v); mark(b.dataset.v); } });
  };
});
