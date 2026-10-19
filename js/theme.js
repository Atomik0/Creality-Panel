(() => {
  let t = "light";
  try { t = localStorage.getItem("crpanel_theme") || "light"; } catch {}
  document.documentElement.dataset.theme = t;
})();
