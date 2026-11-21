(() => {
  const root = document.documentElement;
  let saved;
  try {
    saved = localStorage.getItem("zhenyu-wei-theme");
  } catch {
    // Use the default light theme when storage is unavailable.
  }
  const theme = saved === "light" || saved === "dark" ? saved : "light";
  root.dataset.theme = theme;
  root.classList.add("is-interactive");
  // Keep the biography and papers readable if the interactive script cannot load.
  window.addEventListener("error", (event) => {
    if (event.target instanceof HTMLScriptElement && /\/assets\/site\.js(?:\?|$)/.test(event.target.src)) {
      root.classList.remove("is-interactive");
    }
  }, true);
  document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#0b0e14" : "#fafafa";
})();
