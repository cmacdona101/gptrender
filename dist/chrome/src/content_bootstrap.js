"use strict";

/**
 * Content bootstrap — simple probes and right-click capture
 */
const RT = (typeof browser !== "undefined" && browser.runtime && browser.runtime.sendMessage)
  ? browser
  : (typeof chrome !== "undefined" ? chrome : null);
function dbg(...a) { console.log("[Diagrams DBG][BOOT]", ...a); }

dbg("bootstrap realm:",
  (typeof chrome !== "undefined" ? "chrome" : typeof browser !== "undefined" ? "browser" : "unknown"),
  "| typeof Viz=", typeof globalThis.Viz,
  "| typeof Module=", typeof globalThis.Module,
  "| typeof render=", typeof globalThis.render,
  "| href=", location.href
);

let lastContextEl = null;
document.addEventListener("contextmenu", (e) => { lastContextEl = e.target; }, { capture: true });

RT && RT.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  dbg("onMessage", msg && msg.type, "senderTab?", !!(sender && sender.tab));
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "DIAGRAMS_PING") {
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === "DIAGRAMS_WHERE_AM_I") {
    sendResponse({ scheme: location.protocol.replace(":", ""), href: location.href });
    return;
  }
  if (msg.type === "DIAGRAMS_GET_CONTEXT_NODE") {
    sendResponse({ ok: true, hasNode: !!lastContextEl });
    return;
  }
  // Router handles DIAGRAMS_ROUTER_PING and DIAGRAMS_RENDER.
});
