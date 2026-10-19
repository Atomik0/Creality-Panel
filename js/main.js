function applyHardwareUi() {
  $("cfsTag").hidden = !HW.box;
  $("cfsTag").textContent = "· " + cfsName(P);
  $("cfsTabBtn").hidden = !HW.box;
  $("cfsTabBtn").textContent = cfsName(P);
  $("tlTabBtn").hidden = !familyOf(P).timelapse;
  if ($("tlTabBtn").hidden && $("tab-timelapse").classList.contains("on")) document.querySelector('.tabs [data-tab="control"]').click();
  if (!HW.box && $("tab-cfs").classList.contains("on")) document.querySelector('.tabs [data-tab="control"]').click();
  $("ledBtn").hidden = !HW.led;
  $("tMbBox").hidden = !HW.board;
  if (HW.board) {
    const n = pinName(HW.board);
    $("tMbLabel").textContent = /main|board|mcu/i.test(n) ? "Placa base" : /chamber/i.test(n) ? "Cámara (recinto)" : n.replace(/_/g, " ");
  }
  $("fanR").closest(".slider").hidden = !HW.fan;
}
function applyPrinterUi() {
  HW.name = P.name;
  $("modelName").textContent = P.name;
  document.title = P.name;
  renderCamSel();
}

function stopPanel() {
  clearInterval(pollTimer); clearInterval(slowTimer);
  if (P) stopCamera();
  P = null; S = null;
}
async function connect() {
  const pr = P;
  setEndpoints();
  metaFile = null; lastConsoleTime = 0; unitsKey = ""; tasks = null; S = null;
  clearInterval(pollTimer); clearInterval(slowTimer);
  $("console").innerHTML = ""; $("klipBanner").hidden = true;
  $("pill").className = "pill"; $("pill").textContent = "Conectando";
  applyPrinterUi();
  let host = "";
  try {
    const info = await get("/printer/info");
    host = info.hostname || "";
    const { objects } = await get("/printer/objects/list");
    if (pr !== P) return;
    QUERY = detectHardware(objects);
  } catch {}
  if (pr !== P) return;
  if (P.model === "auto" && host) { P.model = resolveModel(host, HW.box); savePrinters().catch(() => {}); hubKey = ""; }
  $("hostname").textContent = host ? `${familyOf(P).name} · ${host}` : `Sin conexión con ${P.host}`;
  applyHardwareUi();
  await poll();
  if (pr !== P) return;
  drawChart(); loadHistory(); startCamera();
  const tab = document.querySelector(`.tabs button[data-tab="${store.get("k1se_tab", "control")}"]:not([hidden])`);
  if (tab) tab.click();
  pollTimer = setInterval(() => { poll(); loadConsole(); }, Number(cfg.poll) || 1500);
  slowTimer = setInterval(() => { drawChart(); loadHistory(); }, 10000);
}

const CFG_FIELDS = { cfgPoll: "poll", cfgNtfyServer: "ntfyServer", cfgNtfyTopic: "ntfyTopic", cfgTgToken: "tgToken", cfgTgChat: "tgChat" };
const NF_FIELDS = { nfEnd: "end", nfError: "error", nfPause: "pause", nfEta: "eta", nfTemp: "temp", nfSound: "sound" };
function fillSettings(c) {
  for (const [el, k] of Object.entries(CFG_FIELDS)) $(el).value = c[k] ?? "";
  for (const [el, k] of Object.entries(NF_FIELDS)) $(el).checked = !!(c.notif || DEFAULTS.notif)[k];
  $("nfSnap").checked = !!c.snap;
  $("testRes").innerHTML = "";
}
function readSettings() {
  const c = { ...cfg };
  for (const [el, k] of Object.entries(CFG_FIELDS)) c[k] = $(el).value.trim();
  c.poll = Number(c.poll) || DEFAULTS.poll;
  c.ntfyServer = c.ntfyServer || DEFAULTS.ntfyServer;
  c.notif = {};
  for (const [el, k] of Object.entries(NF_FIELDS)) c.notif[k] = $(el).checked;
  c.snap = $("nfSnap").checked;
  return c;
}
function testLine(ok, text) {
  const d = document.createElement("div");
  d.innerHTML = `<span class="${ok ? "ok" : "bad"}">${ok ? "✔" : "✖"}</span><span></span>`;
  d.lastChild.textContent = text;
  $("testRes").appendChild(d);
}
document.querySelectorAll(".js-settings").forEach(b => b.onclick = () => {
  fillSettings(cfg);
  $("settingsModal").classList.add("on");
});
$("cfgNo").onclick = () => $("settingsModal").classList.remove("on");
$("cfgReset").onclick = () => fillSettings({ ...DEFAULTS });
$("cfgSave").onclick = () => {
  const pollChanged = Number(readSettings().poll) !== Number(cfg.poll);
  cfg = readSettings();
  saveCfg();
  $("settingsModal").classList.remove("on");
  toast("Ajustes guardados");
  if (P && pollChanged) connect();
};
$("settingsModal").onclick = e => { if (e.target === $("settingsModal")) $("settingsModal").classList.remove("on"); };

$("nfTest").onclick = async () => {
  const saved = cfg;
  cfg = readSettings();
  $("testRes").innerHTML = "";
  const who = P ? P.name : "Panel";
  if (cfg.notif.sound) beep(false);
  testLine(browserNotif(`Aviso de prueba · ${who}`, "Si ves esto, los avisos del navegador funcionan.", "crpanel-test"),
    "Aviso del navegador (permítelo con el botón de la campana)");
  if (!cfg.ntfyTopic && !(cfg.tgToken && cfg.tgChat)) testLine(false, "Sin ntfy ni Telegram configurados");
  else {
    const blob = cfg.snap && P ? await snapBlob() : null;
    (await sendRemote(`Aviso de prueba · ${who}`, blob ? "Prueba con foto de la cámara" : "Prueba de aviso", blob, false))
      .forEach(r => testLine(r.ok, r.text));
  }
  cfg = saved;
};

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  watchAll();
  if (!P) return;
  poll();
  if (!cameraAlive()) startCamera();
});
document.querySelectorAll(".js-theme").forEach(b => b.onclick = () => {
  const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  store.set("crpanel_theme", t);
  renderChart();
  if ($("tab-stats").classList.contains("on")) drawDayChart();
});
let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { renderChart(); if ($("tab-stats").classList.contains("on")) drawDayChart(); }, 150);
});

let watchTimer = 0;
async function boot() {
  $("hubError").hidden = true;
  try { await loadPrinters(); }
  catch (e) {
    $("hubErrorMsg").textContent = `No se pudo leer la lista de impresoras del servidor (${e.message}).`;
    $("hubError").hidden = false;
  }
  clearInterval(watchTimer);
  watchTimer = setInterval(watchAll, 3000);
  watchAll();
  route();
}
boot();
