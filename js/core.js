const $ = id => document.getElementById(id);
const STATE_ES = { standby: "En espera", printing: "Imprimiendo", paused: "En pausa", complete: "Terminado", completed: "Terminado",
  cancelled: "Cancelado", error: "Error", in_progress: "En curso", interrupted: "Interrumpido", server_exit: "Interrumpido", klippy_shutdown: "Apagado" };
const MATERIALS = [
  ["01001", "Hyper PLA", 220], ["01002", "Hyper L-W PLA", 220], ["02001", "Hyper PLA-CF", 220], ["06002", "Hyper PETG", 250],
  ["03001", "Hyper ABS", 260], ["04001", "CR-PLA", 220], ["05001", "CR-Silk", 220], ["06001", "CR-PETG", 250],
  ["07001", "CR-ABS", 260], ["10001", "HP-TPU", 215], ["00001", "Generic PLA", 220], ["00002", "Generic PLA-Silk", 220],
  ["00003", "Generic PETG", 240], ["00004", "Generic ABS", 260], ["00005", "Generic TPU", 220], ["00006", "Generic PLA-CF", 220],
  ["00007", "Generic ASA", 260],
];
const matById = id => MATERIALS.find(m => m[0] === String(id).slice(-5));
const SWATCHES = ["#FFFFFF", "#000000", "#7F7F7F", "#E53935", "#FB8C00", "#FDD835", "#3DDF57", "#1E88E5",
                  "#3949AB", "#8E24AA", "#F06292", "#795548", "#00ACC1", "#C0CA33", "#BDBDBD", "#5D4037"];

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const DEFAULTS = { poll: 1500,
                   notif: { end: true, error: true, pause: true, eta: true, temp: false, sound: true },
                   ntfyServer: "https://ntfy.sh", ntfyTopic: "", tgToken: "", tgChat: "", snap: true };
let cfg;
try { cfg = { ...DEFAULTS, ...JSON.parse(store.get("crpanel_cfg", "{}")) }; } catch { cfg = { ...DEFAULTS }; }
if (!store.get("crpanel_cfg", null) && store.get("k1se_ip", null)) cfg.ip = store.get("k1se_ip");
cfg.notif = { ...DEFAULTS.notif, ...(cfg.notif || {}) };
const saveCfg = () => store.set("crpanel_cfg", JSON.stringify(cfg));

const VIA_SERVER = /^https?:$/.test(location.protocol) && !["localhost", "127.0.0.1"].includes(location.hostname);
const PORTS = { api: 7125, cam: 8000, ws: 9999, web: 80 };
const WS_PROTO = location.protocol === "https:" ? "wss" : "ws";
const hostUrl = (host, port, path = "") =>
  VIA_SERVER ? `${location.origin}/p/${host}/${port}${path}` : `http://${host}${port === 80 ? "" : ":" + port}${path}`;
const hostWs = (host, port, path = "/") =>
  VIA_SERVER ? `${WS_PROTO}://${location.host}/p/${host}/${port}${path}` : `ws://${host}:${port}${path}`;
let P = null;
let api, camUrl, wsUrl, webUrl;
function setEndpoints() {
  api = hostUrl(P.host, PORTS.api);
  camUrl = hostUrl(P.host, PORTS.cam, "/call/webrtc_local");
  wsUrl = hostWs(P.host, PORTS.ws);
  webUrl = hostUrl(P.host, PORTS.web);
}

const HW = { objects: [], fan: null, fanKind: null, led: null, board: null, head: null, box: false, cutter: false, sys: false, name: "Impresora" };
function detectHardware(objects) {
  const has = o => objects.includes(o);
  const fans = objects.filter(o => o.startsWith("fan_generic "));
  HW.objects = objects;
  HW.fan = has("fan") ? "fan" : fans.find(o => /model|part|cool/i.test(o)) || fans[0] || (has("output_pin fan0") ? "output_pin fan0" : null);
  HW.fanKind = !HW.fan ? null : HW.fan === "fan" ? "fan" : HW.fan.startsWith("output_pin ") ? "pin" : "generic";
  HW.led = objects.filter(o => o.startsWith("output_pin ")).find(o => /led|light|lamp/i.test(o)) || null;
  const sensors = objects.filter(o => o.startsWith("temperature_sensor "));
  HW.board = sensors.find(o => /main|board|mcu/i.test(o)) || sensors.find(o => /chamber/i.test(o)) || sensors[0] || null;
  HW.head = objects.find(o => /^filament_(switch|motion)_sensor /.test(o)) || null;
  HW.box = has("box");
  HW.cutter = has("cutter_module");
  HW.sys = has("system_stats");
  return ["print_stats", "virtual_sdcard", "extruder", "heater_bed", "webhooks", "gcode_move", "toolhead",
          HW.fan, HW.led, HW.board, HW.head, HW.box && "box", HW.cutter && "cutter_module", HW.sys && "system_stats"]
         .filter(o => o && has(o));
}
let QUERY = ["print_stats", "virtual_sdcard", "extruder", "heater_bed", "webhooks", "gcode_move", "toolhead"];
const nameFromHost = h => (h || "").replace(/-[0-9A-F]{4,}$/i, "").replace(/([0-9])([A-Z][A-Za-z]+)$/, "$1 $2") || "Impresora";
const pinName = o => o.split(" ").slice(1).join(" ");
let S = null;
let meta = null, metaFile = null;
let pollTimer = null, slowTimer = null;
let step = 10;
let busySlider = false;
let cfsBusy = false;

const fmtDur = s => {
  if (s == null || !isFinite(s) || s < 0) return "—";
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, "0")} m` : `${m} m ${String(s % 60).padStart(2, "0")} s`;
};
const t1 = v => (typeof v === "number" ? v.toFixed(1) : "—");
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const thumbUrl = (file, rel) => {
  const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/") + 1) : "";
  return `${api}/server/files/gcodes/${encodeURI(dir + rel)}`;
};
const bestThumb = list => (list || []).slice().sort((a, b) => b.width - a.width)[0];

async function get(path) {
  const r = await fetch(api + path, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status}`);
  return (await r.json()).result;
}
async function post(path) {
  const r = await fetch(api + path, { method: "POST" });
  if (!r.ok) {
    let m = `${r.status}`;
    try { m = (await r.json()).error.message; } catch {}
    throw new Error(m);
  }
  return r.json();
}
const gcode = script => post(`/printer/gcode/script?script=${encodeURIComponent(script)}`);

function toast(msg, err) {
  const d = document.createElement("div");
  d.className = "toast" + (err ? " err" : "");
  d.textContent = msg;
  $("toasts").appendChild(d);
  setTimeout(() => d.remove(), err ? 6000 : 3000);
}
let confirmDone = null;
function confirmBox(text) {
  return new Promise(res => {
    if (confirmDone) confirmDone(false);
    $("modalText").textContent = text;
    $("modal").classList.add("on");
    const done = v => { confirmDone = null; $("modal").classList.remove("on"); $("modalYes").onclick = $("modalNo").onclick = null; res(v); };
    confirmDone = done;
    $("modalYes").onclick = () => done(true);
    $("modalNo").onclick = () => done(false);
  });
}
async function act(fn, okMsg, confirmText) {
  if (confirmText && !(await confirmBox(confirmText))) return;
  try { await fn(); if (okMsg) toast(okMsg); setTimeout(poll, 400); return true; }
  catch (e) { toast("No se pudo ejecutar: " + e.message, true); return false; }
}
