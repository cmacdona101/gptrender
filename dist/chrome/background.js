"use strict";

/**
 * Chrome MV3 service worker (background)
 * - Context menu
 * - Inject UI host + router in ISOLATED world
 * - Inject Graphviz full.render.js in ISOLATED world
 * - PROBE: also report Viz.Module/Viz.render
 * - Extremely verbose logs
 */
const MENU_ID = "gpt-diagrams-render";
function dbg(...a)  { console.log("[Diagrams DBG][BG]", ...a); }
function warn(...a) { console.warn("[Diagrams DBG][BG]", ...a); }
function err(...a)  { console.error("[Diagrams DBG][BG]", ...a); }

chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Render diagram",
      contexts: ["selection", "page"]
    }, () => {
      const e = chrome.runtime.lastError;
      if (e) warn("contextMenus.create reported:", e.message || e);
      else   dbg("context menu created");
    });
  } catch (e) {
    warn("contextMenus.create threw:", e?.message || e);
  }
});

async function send(tabId, payload) {
  dbg("send -> content", { tabId, type: payload?.type });
  return chrome.tabs.sendMessage(tabId, payload);
}
async function insertCSS(tabId, file) {
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: [file] });
    dbg("insertCSS ok", file);
  } catch (e) {
    warn("insertCSS failed", file, e?.message || e);
  }
}
async function execFile(tabId, file, world) {
  dbg("execFile", { file, world });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [file],
    world: world || "ISOLATED"
  });
}
async function execFunc(tabId, func, world) {
  dbg("execFunc", { world });
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    world: world || "ISOLATED"
  });
  return res && res[0] ? res[0].result : undefined;
}

async function readRouterFlags(tabId) {
  return execFunc(tabId, () => ({
    realm: "isolated",
    tryFlag: String(window.__GPT_DIAGRAMS_ROUTER_TRY),
    loaded: !!window.__GPT_DIAGRAMS_ROUTER_LOADED,
    error: window.__GPT_DIAGRAMS_ROUTER_ERROR,
    hasHost: !!(window.__gptHost && typeof window.__gptHost.open === "function"),
    typeofViz: typeof globalThis.Viz,
    typeofModule: typeof globalThis.Module,
    typeofRender: typeof globalThis.render
  }), "ISOLATED");
}

async function injectHostAndRouter(tabId) {
  dbg("injectHostAndRouter: start");
  await insertCSS(tabId, "ui/popup_host.css");
  await execFile(tabId, "ui/popup_host.js", "ISOLATED");
  await execFile(tabId, "src/content_router.js", "ISOLATED");
  const flags = await readRouterFlags(tabId);
  dbg("injectHostAndRouter: flags", flags);
  return flags;
}

// PROBE also returns Viz.Module/Viz.render visibility
async function injectGraphvizModule(tabId) {
  dbg("injectGraphvizModule: start");
  await execFile(tabId, "vendor/graphviz/full.render.js", "ISOLATED");
  const probe = await execFunc(tabId, () => ({
    realm: "isolated",
    hasModule: typeof globalThis.Module,
    hasRender: typeof globalThis.render,
    hasViz:    typeof globalThis.Viz,
    hasVizModule: (globalThis.Viz && typeof globalThis.Viz.Module) || "undefined",
    hasVizRender: (globalThis.Viz && typeof globalThis.Viz.render) || "undefined",
  }), "ISOLATED");
  dbg("injectGraphvizModule: probe", probe);
  return probe;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;
  const tabId = sender?.tab?.id;
  dbg("onMessage <- content", { tabId, type: msg.type });

  if (msg.type === "DIAGRAMS_ENSURE_HOST") {
    if (!tabId) return sendResponse({ ok: false, error: "no sender tab" });
    injectHostAndRouter(tabId)
      .then(flags => sendResponse({ ok: !!flags && flags.loaded === true, flags }))
      .catch(e => {
        err("injectHostAndRouter error", e?.message || e);
        sendResponse({ ok: false, error: String(e?.message || e) });
      });
    return true;
  }

  if (msg.type === "DIAGRAMS_ENSURE_GRAPHVIZ_MODULE") {
    if (!tabId) return sendResponse({ ok: false, error: "no sender tab" });
    injectGraphvizModule(tabId)
      .then(p => sendResponse({
        ok: ((p && (p.hasModule === "function" && p.hasRender === "function"))
          || (p && (p.hasVizModule === "function" && p.hasVizRender === "function"))),
        probe: p
      }))
      .catch(e => {
        err("injectGraphvizModule error", e?.message || e);
        sendResponse({ ok: false, error: String(e?.message || e) });
      });
    return true;
  }
});

async function probeRouter(tabId) {
  const flags = await readRouterFlags(tabId);
  dbg("probe flags:", flags);
  const preliminary = !!(flags && flags.loaded === true);
  if (preliminary) return true;

  try {
    const r = await send(tabId, { type: "DIAGRAMS_ROUTER_PING" });
    dbg("probe DIAGRAMS_ROUTER_PING resp:", r);
    return !!(r && r.ok === true);
  } catch (e) {
    warn("probe DIAGRAMS_ROUTER_PING failed:", e?.message || e);
    return false;
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
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
      err("injectHostAndRouter failed", e?.message || e);
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (m) => alert(m),
        args: ["Cannot initialize on this page. Open a normal http or https page and try again."]
      });
      return;
    }
  }

  if (!hasRouter) {
    warn("router still not present, aborting click");
    return;
  }

  const selection = info.selectionText && info.selectionText.trim() ? info.selectionText.trim() : null;
  dbg("sending DIAGRAMS_RENDER", { selectionLen: selection ? selection.length : 0 });

  try {
    const resp = await send(tabId, { type: "DIAGRAMS_RENDER", selection });
    dbg("DIAGRAMS_RENDER resp:", resp);
  } catch (e) {
    err("send DIAGRAMS_RENDER failed:", e?.message || e);
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (m) => alert(m),
      args: ["Failed to message content on this page."]
    });
  }
});

dbg("Background ready");
