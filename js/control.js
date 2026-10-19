let chartData = null;
async function drawChart() {
  if (!$("tab-control").classList.contains("on")) return;
  try { chartData = await get("/server/temperature_store"); } catch { return; }
  renderChart();
}
function renderChart() {
  const data = chartData;
  const tool = activeTool(S), nozzle = data && (data[tool] || data.extruder);
  if (!nozzle || !$("tab-control").classList.contains("on")) return;
  const cv = $("chart"), dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w) return;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext("2d"); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
  const series = [
    { v: nozzle.temperatures, c: cssVar("--nozzle") },
    data.heater_bed && { v: data.heater_bed.temperatures, c: cssVar("--bed") },
  ].filter(Boolean);
  const max = Math.max(60, ...series.flatMap(s => s.v)) * 1.1;
  const L = 34, B = 18;
  g.font = "11px Segoe UI, sans-serif"; g.fillStyle = cssVar("--muted"); g.strokeStyle = cssVar("--line"); g.lineWidth = 1;
  for (let t = 0; t <= max; t += 50) {
    const y = (h - B) - (t / max) * (h - B - 6);
    g.beginPath(); g.moveTo(L, y); g.lineTo(w, y); g.stroke();
    g.fillText(t + "°", 2, y + 4);
  }
  ["−10 min", "−5 min", "ahora"].forEach((s, i) => g.fillText(s, L + (w - L - 40) * i / 2, h - 3));
  const line = (vals, color, dash) => {
    g.beginPath(); g.setLineDash(dash || []); g.strokeStyle = color; g.lineWidth = dash ? 1 : 2;
    vals.forEach((v, i) => {
      const x = L + (w - L) * i / (vals.length - 1), y = (h - B) - (v / max) * (h - B - 6);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.stroke(); g.setLineDash([]);
  };
  if (S) {
    [S[tool] && S[tool].target, S.heater_bed && S.heater_bed.target].forEach(tg => tg && line([tg, tg], cssVar("--muted"), [4, 4]));
  }
  series.forEach(s => line(s.v, s.c));
}

$("pause").onclick = () => act(() => post("/printer/print/pause"), "Pausando…", "¿Pausar la impresión?");
$("resume").onclick = () => act(() => post("/printer/print/resume"), "Reanudando…");
$("cancel").onclick = () => act(() => post("/printer/print/cancel"), "Cancelando…", "¿Cancelar la impresión? No se puede deshacer.");
$("ledBtn").onclick = () => {
  if (!HW.led) return;
  const v = ledOn(S) ? 0 : 1;
  act(() => gcode(HW.led.startsWith("led ") ? `SET_LED LED=${pinName(HW.led)} WHITE=${v}` : `SET_PIN PIN=${pinName(HW.led)} VALUE=${v}`));
};

document.querySelectorAll("[data-heat]").forEach(b => b.onclick = () => {
  const v = b.dataset.src ? Number($(b.dataset.src).value) : Number(b.dataset.val);
  if (!isFinite(v) || v < 0) return toast("Temperatura no válida", true);
  const heater = b.dataset.heat === "extruder" ? activeTool(S) : b.dataset.heat;
  act(() => gcode(`SET_HEATER_TEMPERATURE HEATER=${heater} TARGET=${v}`),
    `${heater === "heater_bed" ? "Cama" : HW.tools.length > 1 ? `Cabezal ${toolIndex(heater) + 1}` : "Boquilla"} → ${v ? v + " °C" : "apagada"}`);
});

function bindSlider(name, cmd) {
  const r = $(name + "R");
  r.oninput = () => { busySlider = true; $(name + "O").textContent = r.value + " %"; };
  r.onchange = () => { act(() => gcode(cmd(Number(r.value))), null).finally(() => (busySlider = false)); };
}
bindSlider("spd", v => `M220 S${v}`);
bindSlider("flow", v => `M221 S${v}`);
bindSlider("fan", v => HW.fanKind === "fan" ? `M106 S${Math.round(v * 2.55)}`
  : HW.fanKind === "pin" ? `M106 P0 S${Math.round(v * 2.55)}`
    : `SET_FAN_SPEED FAN=${pinName(HW.fan || "x model_fan")} SPEED=${(v / 100).toFixed(2)}`);
document.querySelectorAll("[data-z]").forEach(b => b.onclick = () =>
  act(() => gcode(`SET_GCODE_OFFSET Z_ADJUST=${b.dataset.z} MOVE=1`), `Offset Z ${b.dataset.z}`));

$("steps").onclick = e => {
  const b = e.target.closest("button"); if (!b) return;
  step = Number(b.dataset.s);
  document.querySelectorAll("#steps button").forEach(x => x.classList.toggle("on", x === b));
};
document.querySelectorAll("#jog [data-ax]").forEach(b => b.onclick = () => {
  const ax = b.dataset.ax, d = step * Number(b.dataset.dir);
  if (!S || !S.toolhead.homed_axes.includes(ax.toLowerCase())) return toast("Haz home antes de mover ese eje", true);
  const f = ax === "Z" ? 600 : 6000;
  act(() => gcode(`G91\nG1 ${ax}${d} F${f}\nG90`));
});
$("homeXY").onclick = () => act(() => gcode("G28 X Y"), "Home X Y");
$("homeAll").onclick = () => act(() => gcode("G28"), "Haciendo home…", "¿Hacer home de todos los ejes? Comprueba que la cama esté libre.");
$("motorsOff").onclick = () => act(() => gcode("M84"), "Motores liberados");

let eStep = 10;
$("eSteps").onclick = e => {
  const b = e.target.closest("button"); if (!b) return;
  eStep = Number(b.dataset.e);
  document.querySelectorAll("#eSteps button").forEach(x => x.classList.toggle("on", x === b));
};
const extrudeMm = (mm, f) => act(() => gcode(`SAVE_GCODE_STATE NAME=crpanel_e\nM83\nG1 E${mm} F${f}\nRESTORE_GCODE_STATE NAME=crpanel_e`),
  `${mm > 0 ? "Extruyendo" : "Retrayendo"} ${Math.abs(mm)} mm`);
$("extrude").onclick = () => extrudeMm(eStep, 300);
$("retract").onclick = () => extrudeMm(-eStep, 1200);

let estopArm = null;
const estopReset = () => { clearTimeout(estopArm); estopArm = null; $("estopBtn").classList.remove("armed"); $("estopBtn").textContent = "PANIC BUTTON"; };
$("estopBtn").onclick = async () => {
  if (!estopArm) {
    $("estopBtn").classList.add("armed"); $("estopBtn").textContent = "¿Seguro? Pulsa otra vez";
    estopArm = setTimeout(estopReset, 3000);
    return;
  }
  estopReset();
  try { await post("/printer/emergency_stop"); toast("Parada de emergencia enviada. Usa «Reiniciar firmware» para volver a usar la impresora.", true); }
  catch (e) {
    try { await gcode("M112"); toast("Parada de emergencia enviada (M112)", true); }
    catch { toast("No se pudo enviar la parada de emergencia: " + e.message, true); }
  }
  setTimeout(poll, 500);
};
const restartAct = (path, msg) => act(() => post(path), msg)
  .then(ok => ok && setTimeout(() => (HW.objects.length ? poll() : connect()), 6000));
$("fwRestart").onclick = () => restartAct("/printer/firmware_restart", "Reiniciando firmware…");
$("hostRestart").onclick = () => restartAct("/printer/restart", "Reiniciando Klipper…");
$("svcRestart").onclick = () => restartAct("/machine/services/restart?service=klipper", "Reiniciando el servicio Klipper…");
