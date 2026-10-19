const FAMILIES = {
  k1se: { name: "K1 SE", img: "img/printers/k1se.svg", creality: true, timelapse: true, cfs: "CFS-C", cfsLeft: true, combo: "k1se_combo" },
  k1se_combo: { name: "K1 SE Combo", img: "img/printers/k1se-combo.svg", creality: true, timelapse: true, cfs: "CFS-C", scene: true },
  k1: { name: "K1 / K1C", img: "img/printers/k1.svg", creality: true, timelapse: true },
  k1max: { name: "K1 Max", img: "img/printers/k1max.svg", creality: true, timelapse: true },
  k2se: { name: "K2 SE", img: "img/printers/k2se.svg", creality: true, timelapse: true },
  sparkx: { name: "SparkX i7", img: "img/printers/sparkx.svg", creality: true, cfs: "CFS Lite", cfsLite: true, cfsLeft: true, combo: "sparkx_combo" },
  sparkx_combo: { name: "SparkX i7 Combo", img: "img/printers/sparkx-combo.svg", creality: true, cfs: "CFS Lite", cfsLite: true, scene: true },
  cr10s: { name: "CR-10S", img: "img/printers/cr10s.svg" },
  cr6se: { name: "CR-6 SE", img: "img/printers/cr6se.svg" },
  ender3: { name: "Ender-3", img: "img/printers/ender3.svg" },
  generic: { name: "Otra con Klipper", img: "img/printers/generic.svg" },
};
const GEO = {
  k1se: [219.538, 276.756, 43.4, 259.2, 482], k1se_combo: [580, 356, 52.6, 323.9, 482],
  k1: [265, 272, 10.5, 246.5, 480], k1max: [303.6, 287.6, 11.8, 260.8, 526], k2se: [268.8, 261.8, 10.4, 236.4, 480],
  sparkx: [685, 722, 65, 708, 456], sparkx_combo: [1262, 832, 175, 818, 456],
  cr10s: [325.2, 291.2, 12.6, 261.6, 615], cr6se: [270.2, 286.2, 11.1, 260.1, 570],
  ender3: [281.8, 281.8, 10.9, 253.9, 465], generic: [256, 257, 10, 232, 450],
};
for (const [k, g] of Object.entries(GEO)) FAMILIES[k].geo = g;
const familyOf = p => FAMILIES[p && p.model] || FAMILIES.generic;
const ART_REF = 560;
function placeArt(box, el, geo, { floor = .93, top = .03, maxW = .96 } = {}) {
  const W = box.clientWidth, H = box.clientHeight;
  if (!W || !H || !geo) return false;
  const [vw, vh, pt, pb, mm] = geo;
  const fl = H * floor, tp = H * top;
  let k = (H * .86 * mm / ART_REF) / (pb - pt);
  if (vw * k > W * maxW) k = W * maxW / vw;
  if (fl - pb * k < tp) k = (fl - tp) / pb;
  Object.assign(el.style, { position: "absolute", width: vw * k + "px", height: vh * k + "px",
    left: (W - vw * k) / 2 + "px", top: fl - pb * k + "px", objectFit: "fill" });
  return true;
}
const cfsName = p => familyOf(p).cfs || "CFS";
const resolveModel = (host, hasBox) => {
  const m = familyFromHost(host);
  return hasBox && FAMILIES[m].combo ? FAMILIES[m].combo : m;
};
const nameFor = host => {
  const model = familyFromHost(host);
  return model === "generic" || model === "k1" ? nameFromHost(host) : FAMILIES[model].name;
};
const familyFromHost = h =>
  /^k2\s*se/i.test(h) ? "k2se" : /spark\s*x|^i7(-|$)/i.test(h) ? "sparkx"
  : /^k1\s*se/i.test(h) ? "k1se" : /^k1\s*max/i.test(h) ? "k1max" : /^k1c?(-|$)/i.test(h) ? "k1"
  : /cr-?10/i.test(h) ? "cr10s" : /cr-?6/i.test(h) ? "cr6se" : /ender/i.test(h) ? "ender3" : "generic";
const CAM_TYPES = {
  creality: "De la impresora (Creality)",
  go2rtc: "Tapo o RTSP (go2rtc)",
  mjpeg: "MJPEG por URL",
};
const PRIVATE_IP = /^(10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})$/;
const isPrivateIp = h => PRIVATE_IP.test(h) && h.split(".").every(n => Number(n) <= 255);
const validHost = h => (VIA_SERVER ? isPrivateIp(h) : /^[\w.-]+$/.test(h));
const PROXY_PORTS = [80, 81, 7125, 8000, 8080, 9999];
const newId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
const DATA = "panel-data/";

let printers = [];
async function loadPrinters() {
  if (VIA_SERVER) {
    const r = await fetch(DATA + "printers.json", { cache: "no-store" });
    if (r.status === 404) printers = [];
    else if (!r.ok) throw new Error(`error ${r.status}`);
    else printers = (await r.json()).printers || [];
    return;
  }
  try { printers = JSON.parse(store.get("crpanel_printers", "[]")); } catch { printers = []; }
  if (!printers.length && cfg.ip) {
    printers = [{
      id: newId(), name: (cfg.name || "").trim() || "Impresora", model: "auto", host: cfg.ip,
      cameras: cfg.cam === "off" ? [] : cfg.cam === "mjpeg" ? [{ id: newId(), name: "Cámara", type: "mjpeg", url: cfg.mjpeg || "" }]
        : [{ id: newId(), name: "Cámara de la impresora", type: "creality" }],
    }];
    await savePrinters();
  }
}
async function savePrinters() {
  const body = JSON.stringify({ version: 1, printers }, null, 2);
  if (!VIA_SERVER) return store.set("crpanel_printers", body);
  const r = await fetch(DATA + "printers.json", { method: "PUT", headers: { "Content-Type": "application/json" }, body });
  if (!r.ok) throw new Error(`el servidor respondió ${r.status}`);
}

const printerImg = p => (p.photo ? `${DATA}${p.photo}?v=${p.photoV || 0}` : familyOf(p).img);
async function shrinkImage(file, max = 640) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, "image/jpeg", 0.85));
}
async function putPhoto(id, file) {
  const path = `photos/${id}.jpg`;
  const r = await fetch(DATA + path, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: await shrinkImage(file) });
  if (!r.ok) throw new Error(`el servidor respondió ${r.status}`);
  return path;
}
const deletePhoto = path => fetch(DATA + path, { method: "DELETE" }).catch(() => {});

function viaProxy(url) {
  if (!VIA_SERVER) return url;
  try {
    const u = new URL(url), port = Number(u.port || 80);
    if (u.protocol === "http:" && isPrivateIp(u.hostname) && PROXY_PORTS.includes(port))
      return hostUrl(u.hostname, port, u.pathname + u.search);
  } catch {}
  return url;
}

async function probePrinter(host, ms = 2500) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(hostUrl(host, PORTS.api, "/printer/info"), { signal: ctl.signal, cache: "no-store" });
    return r.ok ? (await r.json()).result : null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}
async function scanNetwork(prefix, onStep) {
  const found = [];
  let next = 1, done = 0;
  const worker = async () => {
    while (next <= 254) {
      const host = `${prefix}.${next++}`, info = await probePrinter(host);
      if (info) found.push({ host, info });
      onStep(++done, found);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return found.sort((a, b) => Number(a.host.split(".")[3]) - Number(b.host.split(".")[3]));
}
const defaultNet = () => {
  const h = isPrivateIp(location.hostname) ? location.hostname : printers.map(p => p.host).find(isPrivateIp);
  return h ? h.split(".").slice(0, 3).join(".") : store.get("crpanel_scan", "192.168.1");
};
