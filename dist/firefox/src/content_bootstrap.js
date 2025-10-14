"use strict";

/**
 * Lightweight bootstrap content script
 * - Remembers the element that was right clicked
 * - Answers simple probes from background
 * - Router and UI host are injected by background on demand
 */

let lastContextEl = null;

document.addEventListener(
  "contextmenu",
  (e) => {
    lastContextEl = e.target;
  },
  { capture: true }
);

browser.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "DIAGRAMS_PING") {
    // Router not loaded yet
    return Promise.resolve({ ok: false });
  }

  if (msg.type === "DIAGRAMS_WHERE_AM_I") {
    return Promise.resolve({
      scheme: location.protocol.replace(":", ""),
      href: location.href
    });
  }

  if (msg.type === "DIAGRAMS_GET_CONTEXT_NODE") {
    return Promise.resolve({ ok: true, hasNode: !!lastContextEl });
  }
});
