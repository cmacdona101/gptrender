"use strict";

/**
 * Firefox MV2 background
 * - Context menu
 * - Inject UI host + router into the tab (MV2 API)
 * - Inject Graphviz full.render.js when needed (for CSP-safe fallback)
 * - Probes the tab for router flags and Viz fallbacks
 * - Exhaustive diagnostics
 */

const MENU_ID = "gpt-diagrams-render";

function dbg(...a)  { console.log("[Diagrams DBG][BG-FF]", ...a); }
function warn(...a) { console.warn("[Diagrams DBG][BG-FF]", ...a); }
function err(...a)  { console.error("[Diagrams DBG][BG-FF]", ...a); }

/* ---------- Context menu setup ---------- */
function ensureMenu() {
  try {
    browser.contextMenus.create({
      id: MENU_ID,
      title: "Render diagram",
      contexts: ["selection", "page"]
    });
    dbg("context menu created");
  } catch (e) {
    warn("contextMenus.create:", e && e.message ? e.message : e);
  }
}
browser.runtime.onInstalled.addListener(ensureMenu);
browser.runtime.onStartup && browser.runtime.onStartup.addListener(ensureMenu);
ensureMenu();

/* ---------- Helpers ---------- */
async function tabAlert(tabId, msg) {
  try {
    await browser.tabs.executeScript(tabId, { code: `alert(${JSON.stringify(String(msg))});` });
  } catch (e) {
    warn("tabAlert failed:", e && e.message ? e.message : e);
  }
}

async function send(tabId, payload) {
  dbg("send -> content", { tabId, type: payload && payload.type });
  return browser.tabs.sendMessage(tabId, payload);
}

/** Run a function in the tab’s content world and return its result */
async function execFunc(tabId, func) {
  const code = `(${func.toString()})();`;
  const res = await browser.tabs.executeScript(tabId, { code });
  return res && res[0];
}

/** Inject a script file into the tab (content world) */
async function execFile(tabId, file) {
  dbg("execFile", { file });
  await browser.tabs.executeScript(tabId, { file });
}

/** Insert page CSS */
async function insertCSS(tabId, file) {
  try {
    await browser.tabs.insertCSS(tabId, { file });
    dbg("insertCSS ok", file);
  } catch (e) {
    warn("insertCSS failed", file, e && e.message ? e.message : e);
  }
}

/* ---------- Router flag reader (from tab) ---------- */
async function readRouterFlags(tabId) {
  const flags = await execFunc(tabId, () => ({
    realm: "content",
    tryFlag: String(window.__GPT_DIAGRAMS_ROUTER_TRY),
    loaded: !!window.__GPT_DIAGRAMS_ROUTER_LOADED,
    error: window.__GPT_DIAGRAMS_ROUTER_ERROR,
    hasHost: !!(window.__gptHost && typeof window.__gptHost.open === "function"),
    typeofViz: typeof window.Viz,
    typeofModule: typeof window.Module,
    typeofRender: typeof window.render
  }));
  dbg("readRouterFlags:", flags);
  return flags;
}

/* ---------- Inject host + router ---------- */
async function injectHostAndRouter(tabId) {
  dbg("injectHostAndRouter: start");
  await insertCSS(tabId, "ui/popup_host.css");
  await execFile(tabId, "ui/popup_host.js");
  await execFile(tabId, "src/content_router.js");
  const flags = await readRouterFlags(tabId);
  dbg("injectHostAndRouter: flags", flags);
  return flags;
}

/* ---------- Inject Graphviz runtime for CSP-safe fallback ---------- */
async function injectGraphvizModule(tabId) {
  dbg("injectGraphvizModule: start");
  await execFile(tabId, "vendor/graphviz/full.render.js");
  // Probe both global Module/render and Viz.Module/Viz.render
  const probe = await execFunc(tabId, () => ({
    realm: "content",
    hasModule: typeof window.Module,
    hasRender: typeof window.render,
    hasViz: typeof window.Viz,
    hasVizModule: (window.Viz && typeof window.Viz.Module) || "undefined",
    hasVizRender: (window.Viz && typeof window.Viz.render) || "undefined"
  }));
  dbg("injectGraphvizModule: probe", probe);
  return probe;
}

/* ---------- Messages from content (router/bootstrap) ---------- */
browser.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender && sender.tab && sender.tab.id;
  dbg("onMessage <- content", { tabId, type: msg && msg.type });

  if (!msg || typeof msg !== "object") return;

  // Router asks us to ensure host (CSS+JS) and router are present
  if (msg.type === "DIAGRAMS_ENSURE_HOST") {
    if (!tabId) return Promise.resolve({ ok: false, error: "no sender tab" });
    return injectHostAndRouter(tabId)
      .then(flags => ({ ok: !!flags && flags.loaded === true, flags }))
      .catch(e => ({ ok: false, error: String(e && e.message || e) }));
  }

  // Renderer asks us to ensure Graphviz Module+render are available (no worker)
  if (msg.type === "DIAGRAMS_ENSURE_GRAPHVIZ_MODULE") {
    if (!tabId) return Promise.resolve({ ok: false, error: "no sender tab" });
    return injectGraphvizModule(tabId)
      .then(p => ({
        ok: ((p && (p.hasModule === "function" && p.hasRender === "function")) ||
             (p && (p.hasVizModule === "function" && p.hasVizRender === "function"))),
        probe: p
      }))
      .catch(e => ({ ok: false, error: String(e && e.message || e) }));
  }
});

/* ---------- Probe for router presence ---------- */
async function probeRouter(tabId) {
  const flags = await readRouterFlags(tabId);
  const preliminary = !!(flags && flags.loaded === true);
  if (preliminary) return true;

  // Ask the router directly (bootstrap will ignore this; router responds)
  try {
    const r = await send(tabId, { type: "DIAGRAMS_ROUTER_PING" });
    dbg("probe DIAGRAMS_ROUTER_PING resp:", r);
    return !!(r && r.ok === true);
  } catch (e) {
    warn("probe DIAGRAMS_ROUTER_PING failed:", e && e.message ? e.message : e);
    return false;
  }
}

/* ---------- Context menu click flow ---------- */
browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id || info.menuItemId !== MENU_ID) return;
  const tabId = tab.id;

  dbg("onClicked", { tabId, hasSelection: !!info.selectionText });

  let hasRouter = await probeRouter(tabId);

  if (!hasRouter) {
    try {
      const flags = await injectHostAndRouter(tabId);
      dbg("after inject flags:", flags);
      hasRouter = await probeRouter(tabId);
      dbg("probe after inject:", hasRouter);
      if (!hasRouter && flags && flags.error) {
        err("Router reported fatal error:", flags.error);
      }
    } catch (e) {
      err("injectHostAndRouter failed", e && e.message ? e.message : e);
      await tabAlert(tabId, "Cannot initialize on this page. Open a normal http or https page and try again.");
      return;
    }
  }

  if (!hasRouter) {
    warn("router still not present, aborting click");
    return;
  }

  const selection =
    info.selectionText && info.selectionText.trim() ? info.selectionText.trim() : null;

  dbg("sending DIAGRAMS_RENDER", { selectionLen: selection ? selection.length : 0 });

  try {
    const resp = await send(tabId, { type: "DIAGRAMS_RENDER", selection });
    dbg("DIAGRAMS_RENDER resp:", resp);
  } catch (e) {
    err("send DIAGRAMS_RENDER failed:", e && e.message ? e.message : e);
    await tabAlert(tabId, "Failed to message content on this page.");
  }
});

dbg("Background ready");
