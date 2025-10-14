"use strict";

/**
 * Firefox MV2 background for GPT Diagrams (Graphviz only step)
 * - Creates the context menu
 * - Injects UI host (CSS + JS) and the router on demand
 * - Probes content for readiness and routes render requests
 */

const MENU_ID = "gpt-diagrams-render";

/* ---------- Menu setup ---------- */
function ensureMenu() {
  try {
    browser.contextMenus.create({
      id: MENU_ID,
      title: "Render diagram",
      contexts: ["selection", "page"]
    });
  } catch (e) {
    // Duplicate ids throw. Safe to ignore.
    console.warn("[Diagrams BG] contextMenus.create:", e && e.message ? e.message : e);
  }
}
browser.runtime.onInstalled.addListener(ensureMenu);
if (browser.runtime.onStartup) browser.runtime.onStartup.addListener(ensureMenu);
ensureMenu();

/* ---------- Helpers ---------- */
async function tabAlert(tabId, msg) {
  try {
    await browser.tabs.executeScript(tabId, {
      code: `alert(${JSON.stringify(String(msg))});`
    });
  } catch (e) {
    console.error("[Diagrams BG] tabAlert failed:", e);
  }
}
async function send(tabId, payload) {
  return browser.tabs.sendMessage(tabId, payload);
}

/* Inject UI host and router into a tab in a safe order */
async function injectHostAndRouter(tabId) {
  // CSS
  try {
    if (browser.tabs.insertCSS) {
      await browser.tabs.insertCSS(tabId, { file: "ui/popup_host.css" });
    }
  } catch (e) {
    console.warn("[Diagrams BG] insertCSS:", e && e.message ? e.message : e);
  }
  // Host JS (defines window.__gptHost)
  await browser.tabs.executeScript(tabId, { file: "ui/popup_host.js" });
  // Router (detects, normalizes, lazy loads renderer)
  await browser.tabs.executeScript(tabId, { file: "src/content_router.js" });
}

/* Allow router to ask the background to inject host+router */
browser.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "DIAGRAMS_ENSURE_HOST") {
    const tabId = sender && sender.tab && sender.tab.id;
    if (!tabId) return Promise.resolve({ ok: false, error: "no sender tab" });
    return injectHostAndRouter(tabId)
      .then(() => ({ ok: true }))
      .catch((e) => {
        console.error("[Diagrams BG] injectHostAndRouter:", e);
        return { ok: false };
      });
  }
});

/* ---------- Click handler ---------- */
browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id || info.menuItemId !== MENU_ID) return;
  const tabId = tab.id;

  // Is router already present
  let hasRouter = false;
  try {
    const probe = await send(tabId, { type: "DIAGRAMS_PING" });
    hasRouter = !!(probe && probe.ok);
  } catch {
    hasRouter = false;
  }

  // If not, inject host + router
  if (!hasRouter) {
    try {
      await injectHostAndRouter(tabId);
    } catch (e) {
      // Show scheme and URL to help debugging restricted pages
      let where = null;
      try { where = await send(tabId, { type: "DIAGRAMS_WHERE_AM_I" }); } catch {}
      const scheme = where && where.scheme ? where.scheme : "(unknown)";
      const href = where && where.href ? where.href : "";
      await tabAlert(
        tabId,
        `Cannot initialize on this page (scheme: ${scheme}). Open a normal http or https page and try again.\n${href}`
      );
      return;
    }
  }

  const selection =
    info.selectionText && info.selectionText.trim() ? info.selectionText.trim() : null;

  try {
    await send(tabId, { type: "DIAGRAMS_RENDER", selection });
  } catch (e) {
    await tabAlert(tabId, "Failed to message content on this page.");
  }
});

/* ---------- Startup log ---------- */
console.log("[Diagrams BG] Background ready");
