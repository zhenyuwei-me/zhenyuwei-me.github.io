const root = document.documentElement;
const themeToggle = document.querySelector("#theme-toggle");
const themeColor = document.querySelector('meta[name="theme-color"]');
const themeKey = "zhenyu-wei-theme";

function applyTheme(theme) {
  const isDark = theme === "dark";
  root.dataset.theme = theme;
  themeToggle.setAttribute("aria-pressed", String(isDark));
  themeColor.content = isDark ? "#0b0e14" : "#fafafa";
}

function syncTheme() {
  try {
    const saved = localStorage.getItem(themeKey);
    applyTheme(saved === "light" || saved === "dark" ? saved : "light");
  } catch {
    applyTheme(root.dataset.theme);
  }
}

applyTheme(root.dataset.theme);
themeToggle.addEventListener("click", () => {
  const theme = root.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(theme);
  try {
    localStorage.setItem(themeKey, theme);
  } catch {
    // Keep the current page interactive when storage is disabled.
  }
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) syncTheme();
});
window.addEventListener("storage", (event) => {
  if (event.key === themeKey || event.key === null) syncTheme();
});

const reveals = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("visible");
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.08, rootMargin: "0px 0px -5% 0px" });
  reveals.forEach((item) => observer.observe(item));
} else {
  reveals.forEach((item) => item.classList.add("visible"));
}

// Fetch a later cover only when it is requested; keep the first frame usable without JS.
const coverScenes = [
  { image: 3, alt: "DexHLM human demonstrations of sweeping, cooking, and carrying a basket" },
  { image: 2, alt: "DexHLM human demonstrations of cleaning and preparing drinks in a kitchen" },
  { image: 1, alt: "DexHLM human demonstrations of reading, handling objects, and drinking in a study" },
];
const coverMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// A small optical texture sampled from the already-loaded cover. Only the outer
// bevel bends pixels; the centre stays clear. No extra image or animation library.
function makeGlassTexture(image, bounds) {
  if (!image.complete || !image.naturalWidth || bounds.width < 1) return null;
  const frame = image.getBoundingClientRect();
  if (!frame.width || !frame.height) return null;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(bounds.width * ratio);
  const height = Math.round(bounds.height * ratio);
  const margin = Math.ceil(8 * ratio);
  const source = document.createElement("canvas");
  source.width = width + 2 * margin;
  source.height = height + 2 * margin;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  const scale = Math.max(frame.width / image.naturalWidth, frame.height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  sourceContext.drawImage(image,
    (frame.left - bounds.left - (drawWidth - frame.width) / 2) * ratio + margin,
    (frame.top - bounds.top - (drawHeight - frame.height) / 2) * ratio + margin,
    drawWidth * ratio, drawHeight * ratio);
  const pixels = sourceContext.getImageData(0, 0, source.width, source.height).data;
  const texture = document.createElement("canvas");
  texture.width = width;
  texture.height = height;
  const context = texture.getContext("2d");
  const output = context.createImageData(width, height);
  const radius = bounds.height / 2;
  let brightness = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = (x + 0.5) / ratio;
      const py = (y + 0.5) / ratio;
      const centre = Math.max(radius, Math.min(bounds.width - radius, px));
      const dx = px - centre;
      const dy = py - radius;
      const length = Math.hypot(dx, dy);
      const depth = radius - length;
      if (depth < 0) continue;
      const bend = 4 * Math.pow(Math.max(0, 1 - depth / 7.5), 2);
      const sx = Math.max(0, Math.min(source.width - 2, x + margin + (length ? dx / length : 0) * bend * ratio));
      const sy = Math.max(0, Math.min(source.height - 2, y + margin + (length ? dy / length : 0) * bend * ratio));
      const ix = Math.floor(sx), iy = Math.floor(sy);
      const fx = sx - ix, fy = sy - iy;
      const a = (iy * source.width + ix) * 4;
      const b = a + source.width * 4;
      const target = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        output.data[target + channel] =
          pixels[a + channel] * (1 - fx) * (1 - fy) + pixels[a + 4 + channel] * fx * (1 - fy) +
          pixels[b + channel] * (1 - fx) * fy + pixels[b + 4 + channel] * fx * fy;
      }
      output.data[target + 3] = 255;
      brightness += output.data[target] * 0.2126 + output.data[target + 1] * 0.7152 + output.data[target + 2] * 0.0722;
      count++;
    }
  }
  context.putImageData(output, 0, 0);
  return { texture, lightBackground: brightness / count > 145 };
}

for (const carousel of document.querySelectorAll(".cover-carousel")) {
  const link = carousel.querySelector(".cover-link");
  const first = link.querySelector("img");
  const dots = [...carousel.querySelectorAll("button[data-slide]")];
  const toggle = carousel.querySelector(".cover-toggle");
  const controls = carousel.querySelector(".cover-controls");
  const square = carousel.classList.contains("grid-video");
  const frames = [first];
  const pending = new Map();
  let active = 0;
  let requested = 0;
  let revision = 0;
  let visible = false;
  let paused = coverMotion.matches;
  let hovered = false;
  let focused = false;
  let timer;
  const lens = document.createElement("canvas");
  lens.className = "cover-glass-lens";
  lens.setAttribute("aria-hidden", "true");
  controls.prepend(lens);
  let lensAnimation;

  function refreshGlass(previousImage) {
    window.cancelAnimationFrame(lensAnimation);
    const bounds = controls.getBoundingClientRect();
    let next, previous;
    try {
      next = makeGlassTexture(frames[active], bounds);
      if (!next) return;
      if (previousImage && !coverMotion.matches) previous = makeGlassTexture(previousImage, bounds);
    } catch {
      // The translucent CSS surface remains usable if canvas sampling is unavailable.
      controls.classList.remove("has-lens");
      return;
    }
    controls.classList.add("has-lens");
    controls.dataset.contrast = next.lightBackground ? "dark" : "light";
    lens.width = next.texture.width;
    lens.height = next.texture.height;
    const context = lens.getContext("2d");
    const started = performance.now();
    function paint(now) {
      const progress = previous ? Math.min(1, (now - started) / 450) : 1;
      context.clearRect(0, 0, lens.width, lens.height);
      if (previous) context.drawImage(previous.texture, 0, 0);
      context.globalAlpha = 1 - Math.pow(1 - progress, 3);
      context.drawImage(next.texture, 0, 0);
      context.globalAlpha = 1;
      // Tint the composed optical surface, including its sampled image pixels.
      context.globalCompositeOperation = "source-atop";
      context.fillStyle = "rgba(255, 255, 255, 0.07)";
      context.fillRect(0, 0, lens.width, lens.height);
      context.globalCompositeOperation = "source-over";
      if (progress < 1) lensAnimation = window.requestAnimationFrame(paint);
    }
    paint(started);
  }

  first.addEventListener("load", () => refreshGlass(), { once: true });
  if ("ResizeObserver" in window) new ResizeObserver(() => refreshGlass()).observe(controls);

  function schedule() {
    window.clearTimeout(timer);
    if (visible && !document.hidden && !paused && !hovered && !focused) {
      timer = window.setTimeout(() => select((requested + 1) % coverScenes.length), 2500);
    }
  }

  function setPaused(value) {
    paused = value;
    toggle.dataset.paused = String(paused);
    toggle.setAttribute("aria-label", paused ? "Play cover slideshow" : "Pause cover slideshow");
    schedule();
  }

  function loadFrame(index) {
    if (pending.has(index)) return pending.get(index);
    if (frames[index]) return Promise.resolve(frames[index]);
    const frame = new Image(Number(first.getAttribute("width")), Number(first.getAttribute("height")));
    frame.className = "cover-frame";
    frame.alt = coverScenes[index].alt;
    frame.decoding = "async";
    frame.setAttribute("aria-hidden", "true");
    const ready = new Promise((resolve, reject) => {
      frame.onload = resolve;
      frame.onerror = () => reject(new Error("Cover image unavailable"));
    });
    const stem = `assets/media/dexhlm-${coverScenes[index].image}`;
    if (!square) {
      frame.sizes = first.sizes;
      frame.srcset = `${stem}-480.webp 480w, ${stem}-960.webp 960w`;
    }
    frame.src = square ? `${stem}-square.webp` : `${stem}-480.webp`;
    frames[index] = frame;
    link.append(frame);
    const loaded = ready.then(async () => {
      if (frame.decode) await frame.decode();
      return frame;
    }).catch((error) => {
      frame.remove();
      frames[index] = undefined;
      throw error;
    }).finally(() => pending.delete(index));
    pending.set(index, loaded);
    return loaded;
  }

  async function select(index, manual = false) {
    const currentRevision = ++revision;
    requested = index;
    window.clearTimeout(timer);
    if (manual) setPaused(true);
    try {
      await loadFrame(index);
      // A slow download must never override a more recent selection.
      if (currentRevision !== revision) return;
      if (index !== active) {
        const previousImage = frames[active];
        frames.forEach((frame, i) => {
          if (!frame) return;
          frame.classList.toggle("is-previous", i === active);
          frame.classList.toggle("is-active", i === index);
          frame.setAttribute("aria-hidden", String(i !== index));
        });
        active = index;
        refreshGlass(previousImage);
        controls.style.setProperty("--active-slide", String(active));
        dots.forEach((dot, i) => dot.setAttribute("aria-pressed", String(i === active)));
      }
    } catch {
      // Retain the current picture; the next automatic turn tries the next scene.
    } finally {
      if (currentRevision === revision) schedule();
    }
  }

  dots.forEach((dot, index) => dot.addEventListener("click", () => select(index, true)));
  let glassFrame;
  controls.addEventListener("pointermove", (event) => {
    if (coverMotion.matches || event.pointerType !== "mouse") return;
    window.cancelAnimationFrame(glassFrame);
    glassFrame = window.requestAnimationFrame(() => {
      const bounds = controls.getBoundingClientRect();
      controls.style.setProperty("--glass-x", `${100 * (event.clientX - bounds.left) / bounds.width}%`);
    });
  });
  controls.addEventListener("pointerleave", () => {
    window.cancelAnimationFrame(glassFrame);
    controls.style.removeProperty("--glass-x");
  });
  toggle.addEventListener("click", () => {
    if (paused) {
      // An explicit Play action also resumes after keyboard or pointer interaction.
      focused = false;
      hovered = false;
    }
    setPaused(!paused);
  });
  carousel.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "mouse") return;
    hovered = true;
    schedule();
  });
  carousel.addEventListener("pointerleave", () => { hovered = false; schedule(); });
  carousel.addEventListener("focusin", () => { focused = true; schedule(); });
  carousel.addEventListener("focusout", (event) => {
    if (!carousel.contains(event.relatedTarget)) { focused = false; schedule(); }
  });
  document.addEventListener("visibilitychange", schedule);
  coverMotion.addEventListener("change", () => {
    if (coverMotion.matches) setPaused(true);
  });
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) refreshGlass();
      schedule();
    }, { threshold: 0.1 });
    observer.observe(carousel);
  } else {
    visible = true;
  }
  setPaused(paused);
  refreshGlass();
}

const newsToggle = document.querySelector("#news-more");
if (newsToggle) {
  const extraNews = document.querySelectorAll(".news-extra");
  const label = newsToggle.querySelector(".news-more-label");
  newsToggle.hidden = !extraNews.length;
  label.textContent = extraNews.length + " more";
  newsToggle.addEventListener("click", () => {
    const open = newsToggle.getAttribute("aria-expanded") === "true";
    newsToggle.setAttribute("aria-expanded", String(!open));
    extraNews.forEach((item) => { item.hidden = open; });
    label.textContent = open ? extraNews.length + " more" : "Show less";
  });
}

const researchToggle = document.querySelector("#research-expand-toggle");
if (researchToggle) {
  const grid = document.querySelector("#research-grid-view");
  const list = document.querySelector("#research-list-view");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let previousY = window.scrollY;
  let touchStart;

  function toggleInView(fraction = 1) {
    const { top, bottom } = researchToggle.getBoundingClientRect();
    return bottom > 0 && top < innerHeight * fraction;
  }

  // A short page (or the bottom of a page) cannot emit another downward scroll.
  function atScrollEnd() {
    const scroller = document.scrollingElement;
    return scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 1;
  }

  function expandAtBoundary() {
    if (atScrollEnd() && toggleInView()) expand();
  }

  // Fade the grid, then replace it in one update so both views never take up space together.
  function expand() {
    if (researchToggle.getAttribute("aria-expanded") === "true") return;
    researchToggle.setAttribute("aria-expanded", "true");
    window.removeEventListener("scroll", expandOnScroll);
    window.removeEventListener("wheel", expandOnWheel);
    window.removeEventListener("keydown", expandOnKey);
    window.removeEventListener("touchstart", rememberTouch);
    window.removeEventListener("touchend", expandOnSwipe);

    function showList() {
      const moveFocus = grid.contains(document.activeElement);
      grid.hidden = true;
      list.removeAttribute("data-collapsed");
      if (moveFocus) list.focus({ preventScroll: true });
    }

    if (reducedMotion.matches) {
      showList();
    } else {
      grid.classList.add("collapsed-hidden");
      window.setTimeout(showList, 240);
    }
  }

  function expandOnScroll() {
    const currentY = window.scrollY;
    const movingDown = currentY > previousY;
    previousY = currentY;
    if (!movingDown) return;
    if (toggleInView(0.8)) expand();
  }

  function expandOnWheel(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.deltaY > 0 && event.deltaY > Math.abs(event.deltaX)) expandAtBoundary();
  }

  function expandOnKey(event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!["ArrowDown", "PageDown", "End", " "].includes(event.key)) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, button, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='dialog']")) return;
    expandAtBoundary();
  }

  function rememberTouch(event) {
    touchStart = event.touches.length === 1 ? event.touches[0] : null;
  }

  function expandOnSwipe(event) {
    const start = touchStart;
    touchStart = null;
    if (!start || event.defaultPrevented || event.touches.length) return;
    const end = Array.from(event.changedTouches).find(touch => touch.identifier === start.identifier);
    if (!end) return;
    const down = start.clientY - end.clientY;
    if (down >= 24 && down > Math.abs(start.clientX - end.clientX)) expandAtBoundary();
  }

  researchToggle.addEventListener("click", expand);
  window.addEventListener("scroll", expandOnScroll, { passive: true });
  window.addEventListener("wheel", expandOnWheel, { passive: true });
  window.addEventListener("keydown", expandOnKey);
  window.addEventListener("touchstart", rememberTouch, { passive: true });
  window.addEventListener("touchend", expandOnSwipe, { passive: true });
}

for (const button of document.querySelectorAll(".pub-tag-tldr[aria-controls]")) {
  const summary = document.getElementById(button.getAttribute("aria-controls"));

  function showSummary(open) {
    summary.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  }

  button.addEventListener("click", () => showSummary(summary.hidden));
  document.addEventListener("click", (event) => {
    if (!summary.hidden && !summary.contains(event.target) && !button.contains(event.target)) {
      showSummary(false);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !summary.hidden) {
      showSummary(false);
      button.focus();
    }
  });
}

const filters = [...document.querySelectorAll(".pub-filter")];
if (filters.length) {
  const papers = [...document.querySelectorAll(".pub[data-topics]")];
  const groups = new Set(papers.map((paper) => paper.closest("section")));

  for (const filter of filters) {
    filter.addEventListener("click", () => {
      const topic = filter.dataset.topic;

      for (const option of filters) {
        const active = option === filter;
        option.classList.toggle("active", active);
        option.setAttribute("aria-pressed", String(active));
      }

      for (const paper of papers) {
        const matches = topic === "all" || (paper.dataset.topics || "").split(/\s+/).includes(topic);
        paper.classList.toggle("hidden", !matches);
      }

      for (const group of groups) {
        group.hidden = !group.querySelector(".pub[data-topics]:not(.hidden)");
      }
    });
  }
}

const year = document.querySelector("#year");
if (year) year.textContent = String(new Date().getFullYear());

const fox = document.querySelector("#footer-fox");
if (fox) {
  fox.addEventListener("click", () => fox.classList.toggle("revealed"));
}

for (const cover of document.querySelectorAll("button[data-video-src]")) {
  cover.addEventListener("click", () => {
    const frame = cover.closest(".pub-media");
    const video = document.createElement("video");
    const poster = cover.querySelector("img");
    const status = frame.querySelector("[data-video-status]");
    const hadFocus = document.activeElement === cover;

    video.controls = true;
    video.playsInline = true;
    video.preload = "none";
    video.tabIndex = 0;
    video.setAttribute("aria-label", cover.dataset.videoLabel || "Research video");
    if (poster) video.poster = poster.currentSrc || poster.src;
    if (status) status.textContent = "";

    video.addEventListener("error", () => {
      const returnFocus = document.activeElement === video;
      video.remove();
      cover.hidden = false;
      if (status) status.textContent = "Video unavailable. Try again.";
      if (returnFocus) cover.focus({ preventScroll: true });
    }, { once: true });

    cover.hidden = true;
    frame.append(video);
    video.src = cover.dataset.videoSrc;
    if (hadFocus) video.focus({ preventScroll: true });
    // The native controls remain available if the browser declines playback.
    video.play().catch(() => {});
  });
}
