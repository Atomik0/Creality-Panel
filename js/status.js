async function loadMeta(file) {
  metaFile = file; meta = null; $("thumb").removeAttribute("src");
  if (!file) return;
  try {
    meta = await get(`/server/files/metadata?filename=${encodeURIComponent(file)}`);
    const th = bestThumb(meta.thumbnails);
    if (th) $("thumb").src = thumbUrl(file, th.relative_path);
  } catch {}
}

let polling = null;
const poll = () => polling || (polling = doPoll().catch(e => console.error(e)).finally(() => (polling = null)));
async function doPoll() {
  if (!P) return;
  const pr = P;
  let st;
  try {
    st = (await get(`/printer/objects/query?${QUERY.map(encodeURIComponent).join("&")}`)).status;
  } catch {
    if (pr === P) await pollFailed();
    return;
  }
  if (pr !== P) return;
  S = st;
  const ps = st.print_stats, sd = st.virtual_sdcard, gm = st.gcode_move, th = st.toolhead;
  if (ps.filename !== metaFile) await loadMeta(ps.filename);
  const state = st.webhooks.state !== "ready" ? "error" : ps.state;
  const active = state === "printing" || state === "paused";

  $("pill").className = "pill " + state;
  $("pill").textContent = st.webhooks.state !== "ready" ? (st.webhooks.state_message || "Error") : (STATE_ES[state] || state);

  const p = state === "complete" ? 1 : active ? sd.progress : 0;
  const pctTxt = (p * 100).toFixed(p >= 0.1 ? 0 : 1) + " %";
  $("pct").textContent = pctTxt; $("camPct").textContent = pctTxt;
  $("ring").style.strokeDashoffset = (345.6 * (1 - p)).toFixed(1);
  $("camBar").style.width = (p * 100) + "%";
  $("fname").textContent = ps.filename || "Sin trabajo";
  $("elapsed").textContent = active || state === "complete" ? fmtDur(ps.print_duration) : "—";

  let remain = null;
  if (active) {
    if (p >= 0.05) remain = ps.print_duration * (1 - p) / p;
    else if (meta && meta.estimated_time) remain = Math.max(meta.estimated_time / gm.speed_factor - ps.print_duration, 0);
  }
  $("remain").textContent = fmtDur(remain); $("camRemain").textContent = fmtDur(remain);
  $("eta").textContent = remain ? "Termina aprox. a las " + new Date(Date.now() + remain * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : (STATE_ES[state] || "");
  const info = ps.info || {};
  const totalLayers = info.total_layer || (meta && meta.layer_count) || 0;
  let layer = sd.layer || 0;
  if (info.current_layer) layer = info.current_layer;
  else if (meta && meta.layer_height && meta.layer_count) {
    const flh = meta.first_layer_height || meta.layer_height;
    layer = Math.min(meta.layer_count, Math.max(1, Math.round((gm.gcode_position[2] - flh) / meta.layer_height) + 1));
  }
  const layerTxt = active ? `${layer}${totalLayers ? " / " + totalLayers : ""}` : "—";
  $("layer").textContent = layerTxt; $("camLayer").textContent = layerTxt;
  const shown = active || state === "complete";
  const usedMm = ps.filament_used || 0, totMm = meta && meta.filament_total, totG = meta && meta.filament_weight_total;
  $("fil").textContent = shown ? `${(usedMm / 1000).toFixed(2)}${totMm ? " / " + (totMm / 1000).toFixed(2) : ""} m` : "—";
  $("weight").textContent = !shown || !totG ? "—"
    : totMm ? `${(totG * Math.min(usedMm, totMm) / totMm).toFixed(1)} / ${totG.toFixed(1)} g` : `${totG.toFixed(1)} g al final`;
  $("spd").textContent = Math.round(gm.speed_factor * 100) + " %";
  $("mat").textContent = meta ? (meta.filament_type || "—").split(";").filter((v, i, a) => a.indexOf(v) === i).join(" + ") : "—";
  $("camInfo").hidden = !active;
  document.title = active ? `${pctTxt} · ${HW.name}` : HW.name;

  $("pause").disabled = state !== "printing";
  $("resume").disabled = state !== "paused";
  $("cancel").disabled = !active;

  const tool = activeTool(st), ex = st[tool] || st.extruder, bed = st.heater_bed || { temperature: 0, target: 0 };
  $("nozTitle").textContent = HW.tools.length > 1 ? `Boquilla · cabezal ${toolIndex(tool) + 1}` : "Boquilla";
  const fo = HW.fan && st[HW.fan];
  const fan = fo ? (fo.speed ?? fo.value ?? 0) : 0;
  $("tNoz").textContent = t1(ex.temperature) + " °C";
  $("tNozT").textContent = ex.target ? `objetivo ${ex.target} °C` : "apagada";
  $("tBed").textContent = t1(bed.temperature) + " °C";
  $("tBedT").textContent = bed.target ? `objetivo ${bed.target} °C` : "apagada";
  $("camTemps").textContent = `${Math.round(ex.temperature)}° / ${Math.round(bed.temperature)}°`;
  $("tMb").textContent = HW.board && st[HW.board] ? t1(st[HW.board].temperature) + " °C" : "—";
  $("fanNow").textContent = Math.round(fan * 100) + " %";
  $("pos").textContent = th.position.slice(0, 3).map(v => v.toFixed(1)).join(" / ");
  $("homed").textContent = th.homed_axes ? th.homed_axes.toUpperCase() : "ninguno";
  $("sysload").textContent = st.system_stats ? st.system_stats.sysload.toFixed(2) : "—";
  $("mem").textContent = st.system_stats ? Math.round(st.system_stats.memavail / 1024) + " MB" : "—";
  $("zval").textContent = (gm.homing_origin[2] >= 0 ? "+" : "") + gm.homing_origin[2].toFixed(3);
  $("ledBtn").style.color = ledOn(st) ? "var(--warn)" : "";

  if (!busySlider) {
    setSlider("spd", gm.speed_factor * 100);
    setSlider("flow", gm.extrude_factor * 100);
    setSlider("fan", fan * 100);
  }

  const canMove = !active && st.webhooks.state === "ready";
  document.querySelectorAll("#jog button, #homeAll, #motorsOff").forEach(b => (b.disabled = !canMove));
  $("jogNote").textContent = active ? "Bloqueado mientras imprime." : (th.homed_axes.length < 3 ? "Haz home antes de mover." : "");
  const hot = ex.can_extrude ?? ex.temperature >= 170;
  $("extrude").disabled = $("retract").disabled = !canMove || !hot;
  $("extrNote").textContent = active ? "" : !hot ? "Calienta la boquilla (≥ 170 °C) para extruir o retraer." : "";

  if (st.webhooks.state === "ready") $("klipBanner").hidden = true;
  else showBanner(`Klipper: ${STATE_ES[st.webhooks.state] || st.webhooks.state}${st.webhooks.state_message ? " — " + st.webhooks.state_message : ""}`, false);

  if (HW.box) renderCfs(st.box, st.cutter_module);
  if (HW.tools.length > 1) renderTools(st, state);
}
async function pollFailed() {
  let si = null;
  try { si = await get("/server/info"); } catch {}
  if (si && si.klippy_state !== "ready") {
    $("pill").className = "pill error"; $("pill").textContent = "Klipper no disponible";
    showBanner(`Klipper no responde (estado: ${si.klippy_state}).`, true);
  } else {
    $("pill").className = "pill offline"; $("pill").textContent = "Sin conexión";
    $("klipBanner").hidden = true;
  }
}
function showBanner(text, svc) {
  $("klipBanner").hidden = false;
  $("klipMsg").textContent = text;
  $("svcRestart").hidden = !svc;
}
function setSlider(name, val) {
  $(name + "R").value = Math.round(val);
  $(name + "O").textContent = Math.round(val) + " %";
}
