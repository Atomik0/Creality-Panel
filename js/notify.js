let actx = null;
const audio = () => {
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); }
  catch {}
  return actx;
};
document.addEventListener("pointerdown", audio, { once: true });
function beep(err) {
  const a = audio(); if (!a) return;
  const notes = err ? [520, 390, 520, 390] : [660, 880, 1320];
  notes.forEach((f, i) => {
    const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + i * 0.18;
    o.type = err ? "square" : "sine"; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(err ? 0.12 : 0.25, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.17);
  });
}
function browserNotif(title, body, tag) {
  if (!("Notification" in window) || Notification.permission !== "granted") return false;
  try {
    const n = new Notification(title, { body, tag });
    n.onclick = () => { window.focus(); n.close(); };
    return true;
  } catch { return false; }
}
async function sendRemote(title, body, blob, err) {
  const jobs = [];
  if (cfg.ntfyTopic) {
    const base = `${(cfg.ntfyServer || DEFAULTS.ntfyServer).replace(/\/+$/, "")}/${encodeURIComponent(cfg.ntfyTopic)}`;
    const q = new URLSearchParams({ title, priority: err ? "high" : "default", tags: err ? "warning" : "white_check_mark" });
    if (blob) { q.set("message", body); q.set("filename", "camara.jpg"); }
    jobs.push(["ntfy", fetch(`${base}?${q}`, { method: blob ? "PUT" : "POST", body: blob || body })]);
  }
  if (cfg.tgToken && cfg.tgChat) {
    const fd = new FormData(), text = `${title}\n${body}`;
    fd.append("chat_id", cfg.tgChat);
    if (blob) { fd.append("photo", blob, "camara.jpg"); fd.append("caption", text); } else fd.append("text", text);
    jobs.push(["Telegram", fetch(`https://api.telegram.org/bot${cfg.tgToken}/${blob ? "sendPhoto" : "sendMessage"}`, { method: "POST", body: fd })]);
  }
  return Promise.all(jobs.map(([name, pr]) => pr.then(
    r => ({ ok: r.ok, text: r.ok ? `${name}: enviado` : `${name}: error ${r.status}` }),
    e => ({ ok: false, text: `${name}: ${e.message}` }))));
}
async function notify(kind, title, body, { err = false, snap = false, pid = null } = {}) {
  if (!cfg.notif[kind]) return;
  const pr = printers.find(x => x.id === pid), who = pr ? pr.name : HW.name;
  toast(`${who}: ${title} · ${body}`, err);
  if (cfg.notif.sound) beep(err);
  browserNotif(`${title} · ${who}`, body, `crpanel-${kind}-${pid}`);
  if (!cfg.ntfyTopic && !(cfg.tgToken && cfg.tgChat)) return;
  const blob = snap && cfg.snap && P && P.id === pid ? await snapBlob() : null;
  const bad = (await sendRemote(`${title} · ${who}`, body, blob, err)).filter(r => !r.ok);
  if (bad.length) toast("No se pudo enviar el aviso al móvil: " + bad.map(r => r.text).join(", "), true);
}

const isActive = s => s === "printing" || s === "paused";
function printerEvents(pr, rt) {
  const st = rt.st, ps = st.print_stats, ev = rt.ev, file = ps.filename || "", pid = pr.id;
  const state = st.webhooks.state !== "ready" ? "error" : ps.state;
  const active = isActive(state), wasActive = isActive(ev.prev);
  const p = state === "complete" ? 1 : active ? st.virtual_sdcard.progress : 0;
  const remain = active && p >= 0.05 ? ps.print_duration * (1 - p) / p : null;
  ev.offlineSince = 0; ev.offlineNotified = false;
  if (ev.prev && ev.prev !== state) {
    if (wasActive && state === "complete") notify("end", "Impresión terminada", `${file} · ${fmtDur(ps.print_duration)}`, { snap: true, pid });
    else if (wasActive && state === "cancelled") notify("error", "Impresión cancelada", file, { err: true, snap: true, pid });
    else if (state === "error") notify("error", wasActive ? "Error durante la impresión" : "Klipper con error",
      st.webhooks.state_message || ps.message || file, { err: true, snap: wasActive, pid });
    else if (ev.prev === "printing" && state === "paused") {
      const head = rt.head && st[rt.head];
      const runout = !!head && head.enabled !== false && !head.filament_detected;
      notify("pause", runout ? "Filamento agotado" : "Impresión en pausa", runout ? `${file} · carga filamento y reanuda` : file,
        { err: runout, snap: runout, pid });
    }
  }
  if (!active) ev.etaDone = false;
  else if (!ev.etaDone && state === "printing" && remain != null && remain <= 600 && p >= 0.5) {
    ev.etaDone = true;
    if (ev.prev) notify("eta", "Faltan unos 10 minutos",
      `${file} · termina aprox. a las ${new Date(Date.now() + remain * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, { pid });
  }
  const tools = Object.keys(st).filter(k => /^extruder\d*$/.test(k));
  const heaters = tools.map(t => [t, tools.length > 1 ? `Cabezal ${toolIndex(t) + 1}` : "Boquilla"]).concat([["heater_bed", "Cama"]]);
  for (const [h, label] of heaters) {
    const o = st[h]; if (!o) continue;
    const a = ev.tempArm[h] || (ev.tempArm[h] = { target: 0, armed: false });
    if (o.target !== a.target) { a.target = o.target; a.armed = o.target > 0 && o.temperature < o.target - 3; }
    if (a.armed && o.temperature >= o.target - 1.5) {
      a.armed = false;
      if (!active && !(cfsBusy && P && P.id === pid)) notify("temp", "Temperatura alcanzada", `${label} a ${Math.round(o.target)} °C`, { pid });
    }
  }
  ev.prev = state;
}
function offlineEvents(pr, rt) {
  const ev = rt.ev;
  if (!ev.offlineSince) ev.offlineSince = Date.now();
  if (!ev.offlineNotified && isActive(ev.prev) && Date.now() - ev.offlineSince > 30000) {
    ev.offlineNotified = true;
    const file = rt.st && rt.st.print_stats.filename;
    notify("error", "Sin conexión con la impresora", `Se perdió la conexión durante la impresión${file ? " de " + file : ""}`,
      { err: true, pid: pr.id });
  }
}

const paintNotifBtns = () => document.querySelectorAll(".js-notif").forEach(b =>
  (b.style.color = "Notification" in window && Notification.permission === "granted" ? "var(--accent)" : ""));
document.querySelectorAll(".js-notif").forEach(b => b.onclick = async () => {
  if (!window.isSecureContext)
    return toast("Los avisos del navegador solo funcionan por https://. Abre el panel con la dirección https de Tailscale.", true);
  if (!("Notification" in window)) return toast("Este navegador no admite avisos", true);
  const p = await Notification.requestPermission();
  toast(p === "granted" ? "Te avisaré cuando termine una impresión"
      : "Avisos bloqueados para esta página: actívalos en el candado de la barra de direcciones", p !== "granted");
  paintNotifBtns();
});
paintNotifBtns();
