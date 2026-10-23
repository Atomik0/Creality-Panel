let pc = null, mse = null, camGen = 0, camTimer = 0, msUrl = "";
const camList = () => (P && P.cameras) || [];
const camKey = () => `crpanel_cam_${P && P.id}`;
const currentCam = () => {
  const cams = camList();
  return cams.find(c => c.id === store.get(camKey(), "")) || cams[0] || null;
};
function camMsg(text) {
  $("camMsg").hidden = !text;
  $("camMsg").textContent = text || "";
  if (text) $("liveTag").hidden = true;
}
function camLive() { $("camMsg").hidden = true; $("liveTag").hidden = false; }

function stopCamera() {
  camGen++;
  clearTimeout(camTimer);
  if (pc) { pc.close(); pc = null; }
  if (mse) { mse.ws.onclose = null; mse.ws.close(); mse = null; }
  const v = $("video");
  v.pause(); v.srcObject = null; v.removeAttribute("src"); v.load();
  if (msUrl) { URL.revokeObjectURL(msUrl); msUrl = ""; }
  $("mjpeg").onload = $("mjpeg").onerror = null;
  $("mjpeg").removeAttribute("src"); $("mjpeg").hidden = true;
  $("liveTag").hidden = true;
}
function renderCamSel() {
  const cams = camList(), cur = currentCam();
  $("camSel").hidden = cams.length < 2;
  $("camSel").innerHTML = "";
  for (const c of cams) {
    const b = document.createElement("button");
    b.textContent = c.name || CAM_TYPES[c.type];
    b.classList.toggle("on", c === cur);
    b.onclick = () => { store.set(camKey(), c.id); renderCamSel(); startCamera(); };
    $("camSel").appendChild(b);
  }
}
async function startCamera() {
  stopCamera();
  $("video").hidden = false;
  const cam = currentCam();
  if (!cam) return camMsg("Esta impresora no tiene cámaras. Añádelas con el botón de editar (el lápiz).");
  camMsg("Conectando cámara…");
  if (cam.type === "mjpeg") return startMjpeg(cam);
  if (cam.type === "go2rtc") return startGo2rtc(cam);
  return startCreality();
}

function startMjpeg(cam) {
  const img = $("mjpeg"), gen = camGen;
  $("video").hidden = true; img.hidden = false;
  if (!cam.url) return camMsg("Falta la URL de esta cámara. Edítala con el botón del lápiz.");
  img.onload = () => gen === camGen && camLive();
  img.onerror = () => gen === camGen && camMsg("La cámara MJPEG no responde.");
  const url = viaProxy(cam.url);
  img.src = url + (url.includes("?") ? "&" : "?") + "_=" + Date.now();
}

async function startCreality() {
  const gen = camGen, video = $("video");
  const conn = pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  const retry = (text, ms) => {
    if (gen !== camGen) return;
    camMsg(text);
    clearTimeout(camTimer);
    camTimer = setTimeout(() => gen === camGen && startCamera(), ms);
  };
  conn.ontrack = ev => {
    video.srcObject = ev.streams[0];
    camMsg("Esperando imagen de la cámara…");
    camTimer = setTimeout(() => !video.videoWidth && retry("La cámara aún no envía imagen. Reconectando…", 0), 10000);
  };
  video.onloadeddata = () => gen === camGen && camLive();
  conn.oniceconnectionstatechange = () => {
    if (["failed", "disconnected"].includes(conn.iceConnectionState)) retry("Cámara desconectada. Reconectando…", 3000);
  };
  let sent = false;
  const sendOffer = async () => {
    if (sent || gen !== camGen) return;
    sent = true;
    try {
      const r = await fetch(camUrl, {
        method: "POST", headers: { "Content-Type": "plain/text" },
        body: btoa(JSON.stringify({ type: "offer", sdp: conn.localDescription.sdp })),
      });
      const ans = JSON.parse(atob(await r.text()));
      if (ans.type !== "answer") throw new Error();
      await conn.setRemoteDescription(new RTCSessionDescription(ans));
    } catch { if (gen === camGen) camMsg("La cámara de la impresora no responde."); }
  };
  conn.onicecandidate = ev => { if (ev.candidate === null) sendOffer(); };
  conn.addTransceiver("video", { direction: "sendrecv" });
  await conn.setLocalDescription(await conn.createOffer());
  setTimeout(sendOffer, 2000);
}

const MSE_CODECS = ["avc1.640029", "avc1.64002A", "avc1.640033", "avc1.42E01E", "hvc1.1.6.L153.B0"];
function startGo2rtc(cam) {
  if (!VIA_SERVER) return camMsg("Las cámaras go2rtc solo funcionan con el panel servido desde tu servidor.");
  if (!cam.src) return camMsg("Falta el nombre del stream de go2rtc. Edita la cámara con el botón del lápiz.");
  const MS = window.ManagedMediaSource || window.MediaSource;
  if (!MS) return camMsg("Este navegador no puede reproducir esta cámara.");
  const gen = camGen, video = $("video"), ms = new MS();
  if (window.ManagedMediaSource) { video.disableRemotePlayback = true; video.srcObject = ms; }
  else video.src = msUrl = URL.createObjectURL(ms);
  ms.addEventListener("sourceopen", () => {
    if (gen !== camGen) return;
    const ws = new WebSocket(`${WS_PROTO}://${location.host}/go2rtc/api/ws?src=${encodeURIComponent(cam.src)}`);
    ws.binaryType = "arraybuffer";
    const cur = mse = { ws, ms };
    let sb = null;
    const queue = [];
    const pump = () => {
      if (!sb || sb.updating || !queue.length) return;
      try { sb.appendBuffer(queue.shift()); } catch { queue.length = 0; }
    };
    const trim = () => {
      if (!sb || sb.updating || !sb.buffered.length) return pump();
      const end = sb.buffered.end(sb.buffered.length - 1), start = sb.buffered.start(0);
      if (end - start > 20) { sb.remove(start, end - 5); return; }
      if (end - video.currentTime > 2) video.currentTime = end - 0.3;
      pump();
    };
    ws.onopen = () => {
      const codecs = MSE_CODECS.filter(c => MS.isTypeSupported(`video/mp4; codecs="${c}"`));
      ws.send(JSON.stringify({ type: "mse", value: codecs.join(",") }));
    };
    ws.onmessage = ev => {
      if (gen !== camGen) return;
      if (typeof ev.data !== "string") { queue.push(ev.data); return pump(); }
      const msg = JSON.parse(ev.data);
      if (msg.type === "mse") {
        sb = ms.addSourceBuffer(msg.value);
        sb.mode = "segments";
        sb.addEventListener("updateend", trim);
        video.play().catch(() => {});
      } else if (msg.type === "error") camMsg("go2rtc: " + msg.value);
    };
    ws.onclose = () => {
      if (gen !== camGen || mse !== cur) return;
      camMsg("Cámara desconectada. Reconectando…");
      camTimer = setTimeout(() => gen === camGen && startCamera(), 3000);
    };
  }, { once: true });
  video.onloadeddata = () => gen === camGen && camLive();
}

const cameraAlive = () => {
  const cam = currentCam();
  if (!cam) return true;
  if (cam.type === "creality") return pc && !["failed", "disconnected", "closed"].includes(pc.iceConnectionState);
  if (cam.type === "go2rtc") return mse && mse.ws.readyState <= 1;
  return true;
};

$("camBtn").onclick = startCamera;
$("fsBtn").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : $("camCard").requestFullscreen());
function grabFrame() {
  const mj = !$("mjpeg").hidden, v = mj ? $("mjpeg") : $("video");
  const w = mj ? v.naturalWidth : v.videoWidth, h = mj ? v.naturalHeight : v.videoHeight;
  if (!w) return null;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(v, 0, 0);
  return c;
}
const snapBlob = () => new Promise(res => {
  const c = grabFrame(); if (!c) return res(null);
  try { c.toBlob(b => res(b), "image/jpeg", 0.85); } catch { res(null); }
});
$("snapBtn").onclick = () => {
  const c = grabFrame();
  if (!c) return toast("La cámara aún no tiene imagen", true);
  const a = document.createElement("a");
  try { a.href = c.toDataURL("image/png"); }
  catch { return window.open($("mjpeg").src, "_blank"); }
  a.download = `${HW.name.replace(/\W+/g, "_")}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
  a.click();
};
