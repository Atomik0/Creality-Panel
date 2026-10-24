let filesCache = [];
async function loadFiles() {
  try {
    const r = await get("/server/files/directory?path=gcodes&extended=true");
    filesCache = r.files.sort((a, b) => b.modified - a.modified);
    renderFiles();
  } catch { $("files").innerHTML = '<div class="muted">No se pudieron cargar los archivos.</div>'; }
}
function renderFiles() {
  const q = $("search").value.trim().toLowerCase();
  const list = filesCache.filter(f => f.filename.toLowerCase().includes(q));
  $("files").innerHTML = list.length ? "" : '<div class="muted">Sin archivos.</div>';
  const printing = S && ["printing", "paused"].includes(S.print_stats.state);
  for (const f of list) {
    const d = document.createElement("div");
    d.className = "file";
    const th = bestThumb(f.thumbnails);
    const parts = [];
    if (f.estimated_time) parts.push(fmtDur(f.estimated_time));
    if (f.filament_weight_total) parts.push(f.filament_weight_total.toFixed(1) + " g");
    if (f.filament_type) parts.push([...new Set(f.filament_type.split(";"))].join("+"));
    parts.push(new Date(f.modified * 1000).toLocaleDateString());
    d.innerHTML = `${th ? `<img alt="" src="${esc(thumbUrl(f.filename, th.relative_path))}">` : '<div class="nothumb"></div>'}
      <div style="min-width:0"><div class="n"></div><div class="d"></div></div>
      <div class="acts"><button class="primary" ${printing ? "disabled" : ""}>Imprimir</button></div>`;
    d.querySelector(".n").textContent = f.filename;
    d.querySelector(".n").title = f.filename;
    d.querySelector(".d").textContent = parts.join(" · ");
    d.querySelector(".acts").prepend(downloadBtn(f.filename));
    d.querySelector(".primary").onclick = () => act(() => post(`/printer/print/start?filename=${encodeURIComponent(f.filename)}`),
      "Impresión iniciada", `¿Imprimir "${f.filename}"? Comprueba que la cama esté libre.`);
    $("files").appendChild(d);
  }
}
$("search").oninput = renderFiles;
$("refreshFiles").onclick = loadFiles;

function upload(file) {
  if (!file || !file.name.toLowerCase().endsWith(".gcode")) return toast("Elige un archivo .gcode", true);
  const fd = new FormData();
  fd.append("file", file); fd.append("root", "gcodes");
  if ($("printAfter").checked) fd.append("print", "true");
  const xhr = new XMLHttpRequest();
  const bar = $("upBar"); bar.style.display = "block";
  xhr.upload.onprogress = e => { if (e.lengthComputable) bar.firstElementChild.style.width = (100 * e.loaded / e.total) + "%"; };
  xhr.onload = () => {
    bar.style.display = "none"; bar.firstElementChild.style.width = "0";
    if (xhr.status < 300) { toast(`Subido: ${file.name}`); loadFiles(); }
    else toast("Error al subir: " + xhr.status, true);
  };
  xhr.onerror = () => { bar.style.display = "none"; toast("Error de red al subir", true); };
  xhr.open("POST", api + "/server/files/upload");
  xhr.send(fd);
}
$("fileIn").onchange = e => { upload(e.target.files[0]); e.target.value = ""; };
const drop = $("drop");
drop.onclick = e => { if (!e.target.closest("#printAfterLbl")) $("fileIn").click(); };
drop.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("fileIn").click(); } };
["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => upload(e.dataTransfer.files[0]));
