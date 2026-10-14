function applyHardwareUi() {
  $("modelName").textContent = HW.name;
  $("cfsTag").hidden = !HW.box;
  $("cfsTabBtn").hidden = !HW.box;
  if (!HW.box && $("tab-cfs").classList.contains("on")) document.querySelector('.tabs [data-tab="control"]').click();
  $("ledBtn").hidden = !HW.led;
  $("tMbBox").hidden = !HW.board;
  if (HW.board) {
    const n = pinName(HW.board);
    $("tMbLabel").textContent = /main|board|mcu/i.test(n) ? "Placa base" : /chamber/i.test(n) ? "Cámara (recinto)" : n.replace(/_/g, " ");
  }
  $("fanR").closest(".slider").hidden = !HW.fan;
}

async function connect() {
  setEndpoints();
  metaFile = null; lastConsoleTime = 0; prevState = null; unitsKey = ""; tasks = null;
  tempArm = {}; etaDone = false; offlineSince = 0; offlineNotified = false;
  clearInterval(pollTimer); clearInterval(slowTimer);
  if (!VIA_SERVER && !cfg.ip) {
    $("pill").className = "pill offline"; $("pill").textContent = "Sin configurar";
    $("hostname").textContent = "Indica la IP de la impresora en Ajustes";
    $("camMsg").textContent = "Sin impresora configurada.";
    $("settingsBtn").click();
    return;
  }
  $("pill").className = "pill"; $("pill").textContent = "Conectando";
  let host = "";
  try {
    const info = await get("/printer/info");
    host = info.hostname || "";
    $("hostname").textContent = `Creality · ${host}`;
    const { objects } = await get("/printer/objects/list");
    QUERY = detectHardware(objects);
  } catch {
    $("hostname").textContent = VIA_SERVER ? "Sin conexión con el servidor" : `Sin conexión con ${cfg.ip}`;
  }
  HW.name = cfg.name.trim() || nameFromHost(host);
  applyHardwareUi();
  await poll();
  drawChart(); loadHistory(); startCamera();
  const tab = document.querySelector(`.tabs button[data-tab="${store.get("k1se_tab", "control")}"]:not([hidden])`);
  if (tab) tab.click();
  pollTimer = setInterval(() => { poll(); loadConsole(); }, Number(cfg.poll) || 1500);
  slowTimer = setInterval(() => { drawChart(); loadHistory(); }, 10000);
}

const CFG_FIELDS = { cfgIp: "ip", cfgName: "name", cfgCam: "cam", cfgMjpeg: "mjpeg", cfgPoll: "poll",
                     cfgApiPort: "apiPort", cfgCamPort: "camPort", cfgWsPort: "wsPort", cfgWebPort: "webPort",
                     cfgNtfyServer: "ntfyServer", cfgNtfyTopic: "ntfyTopic", cfgTgToken: "tgToken", cfgTgChat: "tgChat" };
const NF_FIELDS = { nfEnd: "end", nfError: "error", nfPause: "pause", nfEta: "eta", nfTemp: "temp", nfSound: "sound" };
function fillSettings(c) {
  for (const [el, k] of Object.entries(CFG_FIELDS)) $(el).value = c[k] ?? "";
  for (const [el, k] of Object.entries(NF_FIELDS)) $(el).checked = !!(c.notif || DEFAULTS.notif)[k];
  $("nfSnap").checked = !!c.snap;
  $("cfgMjpegBox").hidden = $("cfgCam").value !== "mjpeg";
  $("testRes").innerHTML = "";
}
function readSettings() {
  const c = { ...cfg };
  for (const [el, k] of Object.entries(CFG_FIELDS)) c[k] = $(el).value.trim();
  for (const k of ["poll", "apiPort", "camPort", "wsPort", "webPort"]) c[k] = Number(c[k]) || DEFAULTS[k];
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
$("settingsBtn").onclick = () => {
  fillSettings(cfg);
  $("setServerNote").hidden = !VIA_SERVER;
  ["cfgIp", "cfgApiPort", "cfgCamPort", "cfgWsPort", "cfgWebPort"].forEach(id => ($(id).disabled = VIA_SERVER));
  $("settingsModal").classList.add("on");
};
$("cfgCam").onchange = () => ($("cfgMjpegBox").hidden = $("cfgCam").value !== "mjpeg");
$("cfgNo").onclick = () => $("settingsModal").classList.remove("on");
$("cfgReset").onclick = () => fillSettings({ ...DEFAULTS });
$("cfgSave").onclick = () => {
  cfg = readSettings();
  saveCfg();
  $("settingsModal").classList.remove("on");
  toast("Ajustes guardados");
  connect();
};
$("cfgTest").onclick = async () => {
  const saved = cfg;
  cfg = readSettings(); setEndpoints();
  $("testRes").innerHTML = "";
  try {
    const info = await get("/printer/info");
    const { objects } = await get("/printer/objects/list");
    testLine(true, `Klipper: ${info.hostname} (${info.state})`);
    testLine(objects.includes("box"), objects.includes("box") ? "CFS detectado" : "Sin CFS");
  } catch { testLine(false, "Klipper no responde en " + api); }
  if (cfg.cam === "webrtc") {
    try { const r = await fetch(camUrl); testLine(r.ok, r.ok ? "Cámara WebRTC" : `Cámara WebRTC (error ${r.status})`); }
    catch { testLine(false, "La cámara WebRTC no responde"); }
  } else if (cfg.cam === "mjpeg") {
    testLine(!!cfg.mjpeg, cfg.mjpeg ? "Cámara MJPEG configurada (se prueba al guardar)" : "Falta la URL MJPEG");
  }
  try { await wsGet("reqElapseVideoList"); testLine(true, "WebSocket de Creality (timelapses)"); }
  catch { testLine(false, "WebSocket de Creality no responde (los timelapses no estarán disponibles)"); }
  cfg = saved; setEndpoints();
};
$("settingsModal").onclick = e => { if (e.target === $("settingsModal")) $("settingsModal").classList.remove("on"); };

$("nfTest").onclick = async () => {
  const saved = cfg;
  cfg = readSettings();
  $("testRes").innerHTML = "";
  if (cfg.notif.sound) beep(false);
  testLine(browserNotif(`Aviso de prueba · ${HW.name}`, "Si ves esto, los avisos del navegador funcionan.", "crpanel-test"),
    "Aviso del navegador (permítelo con el botón de la campana)");
  if (!cfg.ntfyTopic && !(cfg.tgToken && cfg.tgChat)) testLine(false, "Sin ntfy ni Telegram configurados");
  else {
    const blob = cfg.snap ? await snapBlob() : null;
    (await sendRemote(`Aviso de prueba · ${HW.name}`, blob ? "Prueba con foto de la cámara" : "Prueba de aviso", blob, false))
      .forEach(r => testLine(r.ok, r.text));
  }
  cfg = saved;
};

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  poll();
  if (cfg.cam === "webrtc" && (!pc || ["failed", "disconnected", "closed"].includes(pc.iceConnectionState))) startCamera();
});
let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { renderChart(); if ($("tab-stats").classList.contains("on")) drawDayChart(); }, 150);
});
connect();
