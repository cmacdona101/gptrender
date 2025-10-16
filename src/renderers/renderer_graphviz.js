"use strict";

/**
 * Graphviz renderer with zoom controls.
 * Notes:
 *  - The SVG produced by Viz is not modified.
 *  - Zoom is applied via CSS transform on a wrapper around the SVG.
 *  - Controls: Zoom In, Zoom Out, 100%, Fit.
 *  - Shortcuts on the overlay while focused:
 *      Ctrl + '+' or '=' -> Zoom In
 *      Ctrl + '-'        -> Zoom Out
 *      Ctrl + '0'        -> 100%
 *      Ctrl + 'f'        -> Fit to overlay body
 *  - Ctrl + wheel over the diagram adjusts zoom.
 */

function dbg(...a)  { console.log("[Diagrams DBG][GV]", ...a); }
function warn(...a) { console.warn("[Diagrams DBG][GV]", ...a); }
function err(...a)  { console.error("[Diagrams DBG][GV]", ...a); }

function rtGetURL(path) {
  if (typeof browser !== "undefined" && browser.runtime) return browser.runtime.getURL(path);
  if (typeof chrome  !== "undefined" && chrome.runtime)  return chrome.runtime.getURL(path);
  throw new Error("runtime.getURL unavailable");
}
function rtSendMessage(payload) {
  if (typeof browser !== "undefined" && browser.runtime && browser.runtime.sendMessage) {
    return browser.runtime.sendMessage(payload);
  }
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(payload, (resp) => {
        const e = chrome.runtime.lastError;
        if (e) reject(e);
        else   resolve(resp);
      });
    });
  }
  return Promise.reject(new Error("runtime.sendMessage unavailable"));
}

/* ---------- Zoom UI helpers ---------- */

function createZoomUI(mount) {
  // mount is the .gpt-host-body element supplied by the host
  // Build:
  //   controls (top bar inside body)
  //   viewport (scroll container)
  //     canvas (scaled element that holds the SVG)
  const controls = document.createElement("div");
  controls.style.display = "flex";
  controls.style.alignItems = "center";
  controls.style.gap = "8px";
  controls.style.marginBottom = "8px";
  controls.style.fontFamily = "ui-sans-serif, system-ui, Arial, sans-serif";
  controls.style.fontSize = "12px";

  const btn = (label, title) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title || label;
    b.style.padding = "4px 8px";
    b.style.border = "1px solid #bbb";
    b.style.background = "#f8f8f8";
    b.style.borderRadius = "6px";
    b.style.cursor = "pointer";
    b.addEventListener("mouseenter", () => { b.style.background = "#f0f0f0"; });
    b.addEventListener("mouseleave", () => { b.style.background = "#f8f8f8"; });
    return b;
  };

  const zoomOutBtn = btn("−", "Zoom out");
  const zoomInBtn  = btn("+", "Zoom in");
  const resetBtn   = btn("100%", "Reset zoom to 100%");
  const fitBtn     = btn("Fit", "Fit to overlay");

  const spacer = document.createElement("div");
  spacer.style.flex = "1 1 auto";

  const pct = document.createElement("span");
  pct.textContent = "100%";
  pct.style.minWidth = "48px";
  pct.style.textAlign = "right";

  controls.appendChild(zoomOutBtn);
  controls.appendChild(zoomInBtn);
  controls.appendChild(resetBtn);
  controls.appendChild(fitBtn);
  controls.appendChild(spacer);
  controls.appendChild(pct);

  const viewport = document.createElement("div");
  // The outer .gpt-host-body already scrolls, but an inner viewport prevents
  // accidental style coupling and gives us a stable wheel target.
  viewport.style.position = "relative";
  viewport.style.width = "100%";
  viewport.style.height = "calc(100% - 32px)";
  viewport.style.overflow = "auto";
  viewport.style.background = "#fff";

  const canvas = document.createElement("div");
  canvas.style.transformOrigin = "0 0";
  canvas.style.display = "inline-block";

  viewport.appendChild(canvas);
  mount.innerHTML = "";
  mount.appendChild(controls);
  mount.appendChild(viewport);

  return { controls, zoomOutBtn, zoomInBtn, resetBtn, fitBtn, pct, viewport, canvas };
}

function parseSvgIntrinsicSize(svgEl) {
  // Keep the SVG unchanged. Use attributes or layout to estimate natural size.
  // Graphviz typically sets width/height attributes in px or pt.
  const wAttr = svgEl.getAttribute("width");
  const hAttr = svgEl.getAttribute("height");

  function parseLen(s) {
    if (!s) return NaN;
    const m = String(s).match(/([0-9]*\.?[0-9]+)/);
    return m ? parseFloat(m[1]) : NaN;
  }

  let w = parseLen(wAttr);
  let h = parseLen(hAttr);

  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { w, h };
  }

  // Fallback: use bounding box after it is in the DOM
  try {
    const bb = svgEl.getBBox();
    if (bb && bb.width && bb.height) {
      return { w: bb.width, h: bb.height };
    }
  } catch {}

  // Last resort: client box
  try {
    const r = svgEl.getBoundingClientRect();
    if (r && r.width && r.height) {
      return { w: r.width, h: r.height };
    }
  } catch {}

  // Fallback guess
  return { w: 1000, h: 600 };
}

function installZoomBehavior(ctx, svgEl) {
  const { zoomOutBtn, zoomInBtn, resetBtn, fitBtn, pct, viewport, canvas } = ctx;

  let scale = 1.0;
  const MIN = 0.1;
  const MAX = 8.0;
  const STEP = 0.1;

  // Insert SVG into canvas at scale 1 by default
  canvas.innerHTML = "";
  canvas.appendChild(svgEl);

  function applyScale(next, opts = {}) {
    scale = Math.max(MIN, Math.min(MAX, next));
    canvas.style.transform = `scale(${scale})`;
    pct.textContent = Math.round(scale * 100) + "%";

    if (opts.centerOnZoom && viewport) {
      // Try to keep the center of the viewport approximately stable
      const cx = viewport.scrollLeft + viewport.clientWidth / 2;
      const cy = viewport.scrollTop + viewport.clientHeight / 2;
      const ratio = next / (opts.prevScale || scale);
      viewport.scrollLeft = Math.max(0, cx * ratio - viewport.clientWidth / 2);
      viewport.scrollTop  = Math.max(0, cy * ratio - viewport.clientHeight / 2);
    }
  }

  function zoomIn() {
    applyScale(scale + STEP, { prevScale: scale, centerOnZoom: true });
  }
  function zoomOut() {
    applyScale(scale - STEP, { prevScale: scale, centerOnZoom: true });
  }
  function reset() {
    applyScale(1.0);
  }
  function fit() {
    // Fit the full SVG into the visible viewport
    const size = parseSvgIntrinsicSize(svgEl);
    // Guard divide by zero
    const sx = size.w > 0 ? (viewport.clientWidth  - 16) / size.w : 1.0;
    const sy = size.h > 0 ? (viewport.clientHeight - 16) / size.h : 1.0;
    const s = Math.max(0.05, Math.min(MAX, Math.min(sx, sy)));
    applyScale(s);
    // Scroll to top-left to show the whole graph starting point
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
  }

  zoomInBtn.addEventListener("click", zoomIn);
  zoomOutBtn.addEventListener("click", zoomOut);
  resetBtn.addEventListener("click", reset);
  fitBtn.addEventListener("click", fit);

  // Ctrl + wheel to zoom
  viewport.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const delta = e.deltaY || 0;
    if (delta > 0) zoomOut();
    else if (delta < 0) zoomIn();
  }, { passive: false });

  // Keyboard shortcuts while the overlay is focused
  const keyHandler = (e) => {
    if (!e.ctrlKey) return;

    const k = e.key;
    if (k === "+" || k === "=") {
      e.preventDefault();
      zoomIn();
    } else if (k === "-") {
      e.preventDefault();
      zoomOut();
    } else if (k === "0") {
      e.preventDefault();
      reset();
    } else if (k.toLowerCase && k.toLowerCase() === "f") {
      e.preventDefault();
      fit();
    }
  };
  // Use capture so page scripts are less likely to eat the event first
  window.addEventListener("keydown", keyHandler, true);

  // Cleanup the key handler if the mount is removed
  const cleanupObs = new MutationObserver(() => {
    if (!document.body.contains(viewport)) {
      window.removeEventListener("keydown", keyHandler, true);
      cleanupObs.disconnect();
    }
  });
  cleanupObs.observe(document.body, { childList: true, subtree: true });

  // Start at 100%
  applyScale(1.0);
}

/* ---------- Main rendering flow (unchanged paths) ---------- */

export async function renderDOT(dotText) {
  const VizGlobal = globalThis.Viz;
  dbg("renderDOT: entry", {
    href: location.href,
    typeofViz: typeof VizGlobal,
    typeofModule: typeof globalThis.Module,
    typeofRender: typeof globalThis.render,
    typeofVizModule: VizGlobal && typeof VizGlobal.Module,
    typeofVizRender: VizGlobal && typeof VizGlobal.render,
    textLen: dotText.length
  });

  if (typeof VizGlobal !== "function") {
    throw new Error("Viz is not defined. Ensure viz.js is listed before content_bootstrap.js in the manifest.");
  }

  // 1) Worker path
  const workerURL = rtGetURL("vendor/graphviz/full.render.js");
  try {
    dbg("renderDOT: trying workerURL", workerURL);
    const viz = new VizGlobal({ workerURL });
    const svgEl = await viz.renderSVGElement(dotText);
    const mount = window.__gptHost.open();
    const ctx = createZoomUI(mount);
    installZoomBehavior(ctx, svgEl);
    dbg("renderDOT: worker path success with zoom UI");
    return;
  } catch (e) {
    warn("renderDOT: worker path failed, will fallback. reason:", e && e.message ? e.message : e);
  }

  // 2) Ask BG to inject full.render.js as fallback
  dbg("renderDOT: asking BG to inject Module+render");
  const resp = await rtSendMessage({ type: "DIAGRAMS_ENSURE_GRAPHVIZ_MODULE" });
  dbg("renderDOT: inject response", resp);

  if (!resp || !resp.ok) {
    throw new Error("Failed to inject Graphviz runtime (full.render.js) into content context"
      + (resp && resp.error ? " - " + resp.error : ""));
  }
  if (resp.probe) dbg("renderDOT: probe after injection", resp.probe);

  // 3) Wait for globals
  let tries = 0;
  while (
    !(
      (typeof globalThis.Module === "function" && typeof globalThis.render === "function") ||
      (VizGlobal && typeof VizGlobal.Module === "function" && typeof VizGlobal.render === "function")
    ) && tries < 20
  ) {
    await new Promise(r => setTimeout(r, 100));
    tries += 1;
    dbg("renderDOT: waiting fallback",
        { tries,
          typeofModule: typeof globalThis.Module,
          typeofRender: typeof globalThis.render,
          typeofVizModule: VizGlobal && typeof VizGlobal.Module,
          typeofVizRender: VizGlobal && typeof VizGlobal.render });
  }

  // Prefer Viz.Module/Viz.render when present
  const ModuleFromViz = VizGlobal && VizGlobal.Module;
  const renderFromViz = VizGlobal && VizGlobal.render;

  const ModuleGlobal = (typeof globalThis.Module === "function") ? globalThis.Module : ModuleFromViz;
  const renderGlobal = (typeof globalThis.render === "function") ? globalThis.render : renderFromViz;

  dbg("renderDOT: final globals",
      { typeofModule: typeof ModuleGlobal, typeofRender: typeof renderGlobal });

  if (typeof ModuleGlobal !== "function" || typeof renderGlobal !== "function") {
    throw new Error("Graphviz Module/render not available after injection");
  }

  // 4) Module+render fallback without worker
  const viz2 = new VizGlobal({ Module: ModuleGlobal, render: renderGlobal });
  const svgEl = await viz2.renderSVGElement(dotText);
  const mount = window.__gptHost.open();
  const ctx = createZoomUI(mount);
  installZoomBehavior(ctx, svgEl);
  dbg("renderDOT: Module+render path success with zoom UI");
}
