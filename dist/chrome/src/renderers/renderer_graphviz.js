"use strict";

/**
 * Graphviz renderer with exhaustive diagnostics.
 * Tries worker path first. If CSP blocks it, falls back to Module+render.
 * Important: Viz 2.1.x attaches fallback APIs to `Viz` (Viz.Module, Viz.render).
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

  // 1) Fast path: worker (will fail on GitHub due to worker-src CSP)
  const workerURL = rtGetURL("vendor/graphviz/full.render.js");
  try {
    dbg("renderDOT: trying workerURL", workerURL);
    const viz = new VizGlobal({ workerURL });
    const svgEl = await viz.renderSVGElement(dotText);
    dbg("renderDOT: worker path success");
    const mount = window.__gptHost.open();
    mount.innerHTML = "";
    mount.appendChild(svgEl);
    return;
  } catch (e) {
    warn("renderDOT: worker path failed, will fallback. reason:", e && e.message ? e.message : e);
  }

  // 2) CSP-safe fallback: ask BG to inject full.render.js into ISOLATED world
  dbg("renderDOT: asking BG to inject Module+render");
  const resp = await rtSendMessage({ type: "DIAGRAMS_ENSURE_GRAPHVIZ_MODULE" });
  dbg("renderDOT: inject response", resp);

  if (!resp || !resp.ok) {
    throw new Error("Failed to inject Graphviz runtime (full.render.js) into content context"
      + (resp && resp.error ? " — " + resp.error : ""));
  }
  if (resp.probe) dbg("renderDOT: probe after injection", resp.probe);

  // 3) Wait for either global Module/render, or Viz.Module/Viz.render
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

  // Prefer Viz.Module/Viz.render if present (that’s how Viz 2.1.x advertises them)
  const ModuleFromViz = VizGlobal && VizGlobal.Module;
  const renderFromViz = VizGlobal && VizGlobal.render;

  const ModuleGlobal = (typeof globalThis.Module === "function") ? globalThis.Module : ModuleFromViz;
  const renderGlobal = (typeof globalThis.render === "function") ? globalThis.render : renderFromViz;

  dbg("renderDOT: final globals",
      { typeofModule: typeof ModuleGlobal, typeofRender: typeof renderGlobal });

  if (typeof ModuleGlobal !== "function" || typeof renderGlobal !== "function") {
    throw new Error("Graphviz Module/render not available after injection");
  }

  // 4) Run fallback without worker
  const viz2 = new VizGlobal({ Module: ModuleGlobal, render: renderGlobal });
  const svgEl = await viz2.renderSVGElement(dotText);
  dbg("renderDOT: Module+render path success");
  const mount = window.__gptHost.open();
  mount.innerHTML = "";
  mount.appendChild(svgEl);
}
