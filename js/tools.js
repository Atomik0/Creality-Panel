let toolsKey = "";
let toolEls = [];
const rgbaColor = v => (/^[0-9A-F]{6}/i.test(String(v || "")) ? "#" + String(v).slice(0, 6).toUpperCase() : null);
const ptcText = (tc, k, n) => {
  const v = tc && Array.isArray(tc[k]) ? tc[k][n] : "";
  return v && v !== "NONE" ? String(v) : "";
};
function toolSlots(st) {
  if (!st) return [];
  const tc = st.print_task_config, known = !!(tc && Array.isArray(tc.filament_exist)), act = activeTool(st);
  return Object.keys(st).filter(k => /^extruder\d*$/.test(k)).sort((a, b) => toolIndex(a) - toolIndex(b)).map(t => {
    const n = toolIndex(t), type = ptcText(tc, "filament_type", n), sub = ptcText(tc, "filament_sub_type", n);
    return {
      tool: t, n, active: t === act, temp: st[t].temperature, target: st[t].target,
      loaded: known ? !!tc.filament_exist[n] : true,
      color: known ? rgbaColor(tc.filament_color_rgba && tc.filament_color_rgba[n]) : null,
      material: [type, sub && sub !== type ? sub : ""].filter(Boolean).join(" "),
      vendor: ptcText(tc, "filament_vendor", n),
    };
  });
}
function buildTools(n) {
  $("toolSlots").innerHTML = "";
  toolEls = [];
  for (let i = 0; i < n; i++) {
    const d = document.createElement("div");
    d.className = "slot tool";
    d.innerHTML = `<span class="tag">${i + 1}</span><span class="badge" hidden>EN USO</span>
      <div class="spool"></div><div class="mat"></div><div class="muted vendor"></div><div class="ttemp"></div>
      <div class="setrow"><input type="number" min="0" max="300" placeholder="°C" aria-label="Temperatura del cabezal ${i + 1}">
        <button class="set">Fijar</button><button class="off">Apagar</button></div>
      <div class="acts"><button class="use">Usar este cabezal</button></div>`;
    const heat = v => act(() => gcode(`SET_HEATER_TEMPERATURE HEATER=${toolName(i)} TARGET=${v}`),
      `Cabezal ${i + 1} → ${v ? v + " °C" : "apagado"}`);
    d.querySelector(".set").onclick = () => {
      const v = Number(d.querySelector("input").value);
      if (!d.querySelector("input").value || !isFinite(v) || v < 0 || v > 300) return toast("Temperatura no válida", true);
      heat(v);
    };
    d.querySelector(".off").onclick = () => heat(0);
    d.querySelector(".use").onclick = () => act(() => gcode(`T${i}`), `Cambiando al cabezal ${i + 1}…`,
      `¿Cambiar al cabezal ${i + 1}? La impresora moverá los cabezales.`);
    $("toolSlots").appendChild(d);
    toolEls.push(d);
  }
}
function renderTools(st, state) {
  const slots = toolSlots(st);
  if (String(slots.length) !== toolsKey) { buildTools(slots.length); toolsKey = String(slots.length); }
  const printing = isActive(state), busy = printing || st.webhooks.state !== "ready";
  slots.forEach((s, i) => {
    const d = toolEls[i];
    if (!d) return;
    d.classList.toggle("active", s.active);
    d.classList.toggle("empty", !s.loaded);
    d.querySelector(".badge").hidden = !s.active;
    d.querySelector(".spool").style.background = s.loaded ? s.color || "#8a9399" : "";
    d.querySelector(".mat").textContent = s.loaded ? s.material || "Filamento" : "Sin filamento";
    d.querySelector(".vendor").textContent = s.loaded ? s.vendor : "";
    d.querySelector(".ttemp").textContent = `${t1(s.temp)} °C${s.target ? ` · objetivo ${Math.round(s.target)} °C` : ""}`;
    d.querySelector(".use").disabled = busy || s.active;
  });
  $("toolNote").textContent = printing ? "El cambio de cabezal se bloquea mientras imprime."
    : st.print_task_config ? "El material y el color se leen de la etiqueta RFID del carrete o de lo configurado en la impresora." : "";
}
