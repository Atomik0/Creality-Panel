const ICONS = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1" /><rect x="13.5" y="5" width="4" height="14" rx="1" /></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 6v12M18 6l-8 6 8 6Z" /></svg>',
  fwd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 6v12M6 6l8 6-8 6Z" /></svg>',
  loop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 11V9a3 3 0 0 1 3-3h12l-3-3M20 13v2a3 3 0 0 1-3 3H5l3 3" /></svg>',
  full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>',
  dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m15 5-7 7 7 7" /></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m9 5 7 7-7 7" /></svg>',
};
const SPEEDS = [0.25, 0.5, 1, 2, 4];
const fmtClock = s => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r < 10 ? "0" : ""}${r.toFixed(1)}`;
};

async function fetchBlob(url, onProgress) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}`);
  const total = Number(r.headers.get("content-length")) || 0;
  if (!r.body || !total) return r.blob();
  const reader = r.body.getReader(), chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    onProgress(got / total);
  }
  return new Blob(chunks, { type: r.headers.get("content-type") || "video/mp4" });
}
async function saveFile(url, name) {
  try {
    const href = URL.createObjectURL(await fetchBlob(url, () => {}));
    Object.assign(document.createElement("a"), { href, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

const player = { list: [], i: 0, blobUrl: null, token: 0, speed: 2, loop: store.get("crpanel_tl_loop", "0") === "1", raf: 0 };
const pv = $("pvVideo");

function openPlayer(list, i) {
  player.list = list;
  $("player").classList.add("on");
  loadPlayerItem(i);
}
function closePlayer() {
  if (!$("player").classList.contains("on")) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  $("player").classList.remove("on");
  pv.pause(); pv.removeAttribute("src"); pv.load();
  player.token++;
  if (player.blobUrl) { URL.revokeObjectURL(player.blobUrl); player.blobUrl = null; }
}
async function loadPlayerItem(i) {
  const t = player.list[i];
  if (!t) return;
  player.i = i;
  const token = ++player.token;
  pv.pause(); pv.removeAttribute("src"); pv.load();
  if (player.blobUrl) { URL.revokeObjectURL(player.blobUrl); player.blobUrl = null; }
  $("pvName").textContent = t.name; $("pvName").title = t.name;
  $("pvSub").textContent = t.sub;
  $("pvPos").textContent = player.list.length > 1 ? `${i + 1} de ${player.list.length}` : "";
  $("pvPrev").disabled = i === 0;
  $("pvNext").disabled = i === player.list.length - 1;
  $("pvMsg").hidden = false; $("pvMsg").textContent = "Cargando vídeo…";
  setPlayerUi();
  let src;
  try {
    const blob = await fetchBlob(t.url, p => { if (token === player.token) $("pvMsg").textContent = `Cargando vídeo… ${Math.round(p * 100)} %`; });
    if (token !== player.token) return;
    src = player.blobUrl = URL.createObjectURL(blob);
  } catch {
    if (token !== player.token) return;
    src = t.url;
  }
  pv.src = src;
  pv.playbackRate = player.speed;
  pv.play().catch(() => {});
}

function setPlayerUi() {
  const d = pv.duration, c = pv.currentTime;
  const p = isFinite(d) && d > 0 ? c / d : 0;
  $("pvSeek").value = Math.round(p * 1000);
  $("pvSeek").style.setProperty("--p", (p * 100).toFixed(2) + "%");
  $("pvTime").textContent = `${fmtClock(c)} / ${fmtClock(d)}`;
  const playing = !pv.paused && !pv.ended;
  $("pvPlay").innerHTML = playing ? ICONS.pause : ICONS.play;
  $("pvPlay").setAttribute("aria-label", playing ? "Pausar" : "Reproducir");
  $("pvBig").hidden = playing || !pv.getAttribute("src") || !$("pvMsg").hidden;
  $("pvSpeed").textContent = player.speed + "×";
  $("pvLoop").classList.toggle("on", player.loop);
  $("pvLoop").setAttribute("aria-pressed", player.loop);
}
function tick() {
  setPlayerUi();
  player.raf = !pv.paused && !pv.ended ? requestAnimationFrame(tick) : 0;
}
const togglePlay = () => {
  if (!pv.getAttribute("src")) return;
  if (pv.paused || pv.ended) pv.play().catch(() => {}); else pv.pause();
};
const fps = () => (player.list[player.i] && player.list[player.i].fps) || 15;
function stepFrame(dir) {
  if (!pv.getAttribute("src")) return;
  pv.pause();
  pv.currentTime = Math.min(Math.max(pv.currentTime + dir / fps(), 0), pv.duration || 0);
}
function seekBy(s) {
  if (!pv.getAttribute("src") || !isFinite(pv.duration)) return;
  pv.currentTime = Math.min(Math.max(pv.currentTime + s, 0), pv.duration);
  setPlayerUi();
}

pv.addEventListener("loadeddata", () => { $("pvMsg").hidden = true; setPlayerUi(); });
pv.addEventListener("error", () => {
  if (!pv.getAttribute("src")) return;
  $("pvMsg").hidden = false; $("pvMsg").textContent = "No se pudo reproducir el vídeo.";
});
pv.addEventListener("play", () => { if (!player.raf) tick(); });
pv.addEventListener("pause", setPlayerUi);
pv.addEventListener("seeked", setPlayerUi);
pv.addEventListener("durationchange", setPlayerUi);
pv.addEventListener("ended", () => {
  if (player.loop) { pv.currentTime = 0; pv.play().catch(() => {}); } else setPlayerUi();
});
pv.addEventListener("click", togglePlay);
$("pvBig").onclick = togglePlay;
$("pvPlay").onclick = togglePlay;
$("pvBack").onclick = () => stepFrame(-1);
$("pvFwd").onclick = () => stepFrame(1);
$("pvSeek").oninput = () => {
  if (isFinite(pv.duration)) pv.currentTime = $("pvSeek").value / 1000 * pv.duration;
  setPlayerUi();
};
$("pvSpeed").onclick = () => {
  player.speed = SPEEDS[(SPEEDS.indexOf(player.speed) + 1) % SPEEDS.length];
  pv.playbackRate = player.speed;
  setPlayerUi();
};
$("pvLoop").onclick = () => {
  player.loop = !player.loop;
  store.set("crpanel_tl_loop", player.loop ? "1" : "0");
  setPlayerUi();
};
$("pvFull").onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else $("pvFrame").requestFullscreen().catch(() => {});
};
$("pvDl").onclick = () => {
  const t = player.list[player.i];
  if (!t) return;
  if (player.blobUrl) Object.assign(document.createElement("a"), { href: player.blobUrl, download: t.file }).click();
  else saveFile(t.url, t.file);
};
$("pvPrev").onclick = () => loadPlayerItem(player.i - 1);
$("pvNext").onclick = () => loadPlayerItem(player.i + 1);
$("pvClose").onclick = closePlayer;
$("player").onclick = e => { if (e.target === $("player")) closePlayer(); };

document.addEventListener("keydown", e => {
  if (!$("player").classList.contains("on") || (e.target.closest && e.target.closest("input:not([type=range]), textarea, select"))) return;
  const keys = {
    " ": togglePlay, k: togglePlay, ArrowLeft: () => seekBy(-1), ArrowRight: () => seekBy(1),
    ",": () => stepFrame(-1), ".": () => stepFrame(1), Home: () => seekBy(-Infinity), End: () => seekBy(Infinity),
    f: () => $("pvFull").click(), l: () => $("pvLoop").click(), s: () => $("pvSpeed").click(),
    PageUp: () => $("pvPrev").disabled || $("pvPrev").click(), PageDown: () => $("pvNext").disabled || $("pvNext").click(),
    Escape: () => document.fullscreenElement || closePlayer(),
  };
  const fn = keys[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!fn) return;
  e.preventDefault();
  fn();
});

$("pvPrev").innerHTML = ICONS.prev; $("pvNext").innerHTML = ICONS.next;
$("pvBig").innerHTML = ICONS.play;
$("pvBack").innerHTML = ICONS.back; $("pvFwd").innerHTML = ICONS.fwd;
$("pvLoop").innerHTML = ICONS.loop; $("pvFull").innerHTML = ICONS.full; $("pvDl").innerHTML = ICONS.dl;
