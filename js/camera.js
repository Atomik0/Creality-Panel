let pc = null;
function startMjpeg() {
  const img = $("mjpeg");
  $("video").hidden = true; img.hidden = false;
  if (!cfg.mjpeg) { $("camMsg").hidden = false; $("camMsg").textContent = "Pon la URL de la cámara en Ajustes."; return; }
  img.onload = () => { $("camMsg").hidden = true; $("liveTag").hidden = false; };
  img.onerror = () => { $("camMsg").hidden = false; $("liveTag").hidden = true; $("camMsg").textContent = "La cámara MJPEG no responde."; };
  img.src = cfg.mjpeg + (cfg.mjpeg.includes("?") ? "&" : "?") + "_=" + Date.now();
}
async function startCamera() {
  if (pc) { pc.close(); pc = null; }
  $("mjpeg").removeAttribute("src"); $("mjpeg").hidden = true; $("video").hidden = false;
  $("camMsg").hidden = false; $("camMsg").textContent = "Conectando cámara…"; $("liveTag").hidden = true;
  if (cfg.cam === "off") { $("camMsg").textContent = "Cámara desactivada en Ajustes."; return; }
  if (cfg.cam === "mjpeg") return startMjpeg();
  const conn = pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  conn.ontrack = ev => { $("video").srcObject = ev.streams[0]; $("camMsg").hidden = true; $("liveTag").hidden = false; };
  conn.oniceconnectionstatechange = () => {
    if (conn === pc && ["failed", "disconnected"].includes(conn.iceConnectionState)) {
      $("camMsg").hidden = false; $("liveTag").hidden = true;
      $("camMsg").textContent = "Cámara desconectada. Reconectando…";
      setTimeout(() => conn === pc && startCamera(), 3000);
    }
  };
  let sent = false;
  const sendOffer = async () => {
    if (sent || conn !== pc) return;
    sent = true;
    try {
      const r = await fetch(camUrl, {
        method: "POST", headers: { "Content-Type": "plain/text" },
        body: btoa(JSON.stringify({ type: "offer", sdp: conn.localDescription.sdp })),
      });
      const ans = JSON.parse(atob(await r.text()));
      if (ans.type !== "answer") throw new Error();
      await conn.setRemoteDescription(new RTCSessionDescription(ans));
    } catch { $("camMsg").textContent = "No hay cámara disponible o no responde."; }
  };
  conn.onicecandidate = ev => { if (ev.candidate === null) sendOffer(); };
  conn.addTransceiver("video", { direction: "sendrecv" });
  await conn.setLocalDescription(await conn.createOffer());
  setTimeout(sendOffer, 2000);
}
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
  catch { return window.open(cfg.mjpeg, "_blank"); }
  a.download = `${HW.name.replace(/\W+/g, "_")}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
  a.click();
};
