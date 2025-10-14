"use strict";

/**
 * Graphviz renderer
 * Assumes viz.js was loaded as a content script (manifest) so `Viz` is defined.
 */

export async function renderDOT(dotText) {
  if (typeof Viz !== "function") {
    throw new Error("Viz is not defined. Ensure vendor/graphviz/viz.js is listed before src/content_bootstrap.js in the manifest.");
  }

  const workerURL = browser.runtime.getURL("vendor/graphviz/full.render.js");
  const viz = new Viz({ workerURL });
  const svgEl = await viz.renderSVGElement(dotText);

  const mount = window.__gptHost.open();
  mount.innerHTML = "";
  mount.appendChild(svgEl);
}
