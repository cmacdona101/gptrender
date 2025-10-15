"use strict";

/**
 * Content router (ISOLATED world)
 * - No direct references to `browser` symbol (Chrome MV3 does not define it)
 * - Exposes status flags the background probes after injection
 * - Very verbose diagnostics
 */

(function () {
  const DBG_PREFIX = "[Diagrams DBG][ROUTER]";
  const log = (...a) => { try { console.log(DBG_PREFIX, ...a); } catch {} };
  const warn = (...a) => { try { console.warn(DBG_PREFIX, ...a); } catch {} };
  const error = (...a) => { try { console.error(DBG_PREFIX, ...a); } catch {} };

  // Status flags visible to the background
  try {
    window.__GPT_DIAGRAMS_ROUTER_TRY = "entered";
    window.__GPT_DIAGRAMS_ROUTER_ERROR = undefined;
    window.__GPT_DIAGRAMS_ROUTER_LOADED = false;

    // Safe runtime shim (no direct `browser` usage)
    const haveBrowser = (typeof browser !== "undefined" && !!browser.runtime && !!browser.runtime.sendMessage);
    const haveChrome  = (typeof chrome  !== "undefined" && !!chrome.runtime  && !!chrome.runtime.sendMessage);
    const RT = haveBrowser ? browser : haveChrome ? chrome : null;
    const RT_NAME = haveBrowser ? "browser" : haveChrome ? "chrome" : "none";

    log("file evaluating on", location.href, "| realm: ISOLATED");
    log("globals at entry:", {
      typeofViz: typeof globalThis.Viz,
      typeofModule: typeof globalThis.Module,
      typeofRender: typeof globalThis.render
    });
    log("runtime detected:", RT_NAME);

    if (!RT) {
      warn("no runtime available (neither chrome.runtime nor browser.runtime)");
      window.__GPT_DIAGRAMS_ROUTER_TRY = "no-runtime";
      // Still proceed; listener will fail and we capture error below if needed.
    }

    window.__GPT_DIAGRAMS_ROUTER_TRY = "loading";

    if (!window.__GPT_DIAGRAMS_ROUTER__) {
      window.__GPT_DIAGRAMS_ROUTER__ = true;
      log("router loaded in isolated world on", location.href);

      // Remember right-click target
      let lastContextEl = null;
      document.addEventListener("contextmenu", e => { lastContextEl = e.target; }, { capture: true });

      async function ensureHost() {
        log("ensureHost: request");
        try {
          const resp = await RT.runtime.sendMessage({ type: "DIAGRAMS_ENSURE_HOST" });
          log("ensureHost: resp", resp);
          if (resp && resp.ok && window.__gptHost && typeof window.__gptHost.open === "function") return;
        } catch (e) {
          error("ensureHost error:", e?.message || e);
        }
        throw new Error("UI host not available");
      }

      function normalizeDiagramText(text) {
        if (!text) return "";
        let t = String(text);
        t = t.replace(/^\uFEFF/, "").replace(/[\u200B-\u200D\uFEFF]/g, "");
        const fenced = t.match(/```(?:\s*(?:dot|graphviz))?\s*\n([\s\S]*?)\n```/i);
        if (fenced) t = fenced[1];
        t = t.replace(/\r\n?/g, "\n");
        const firstLineNoise = /^(?:\s*(?:dot|copy code|language:\s*dot|language:\s*graphviz|copy)\s*)\n/i;
        if (firstLineNoise.test(t)) {
          log("normalize: dropped first-line header");
          t = t.replace(firstLineNoise, "");
        }
        t = t.replace(/^(?:\s*(?:copy code|copy|expand)\s*\n)+/gi, "");
        t = t.replace(/<!--[\s\S]*?-->/g, "");
        t = t.replace(/&(?![a-zA-Z]+;|#\d+;)/g, "&amp;");
        return t.trim();
      }

      function detectType(normText, className = "") {
        const t = (normText || "").trim();
        const c = (className || "").toLowerCase();
        if (/```(?:dot|graphviz)/i.test(t)) return "dot";
        if (c.includes("language-dot") || c.includes("language-graphviz")) return "dot";
        if (/(^|\n)\s*(digraph|graph)\s+\w*\s*\{/.test(t)) return "dot";
        return "unknown";
      }

      function preflightDOT(t) {
        const hasKeyword = /(digraph|graph)\s+\w*\s*\{/.test(t);
        if (!hasKeyword) return { ok: false, reason: "Missing graph or digraph header" };
        let depth = 0;
        for (const ch of t) {
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
          if (depth < 0) return { ok: false, reason: "Unbalanced braces" };
        }
        if (depth !== 0) return { ok: false, reason: "Unbalanced braces" };
        return { ok: true };
      }

      function extractFromContext() {
        if (!lastContextEl) return null;
        let host =
          lastContextEl.closest("pre code") ||
          lastContextEl.closest("pre") ||
          lastContextEl.closest("code");
        if (!host) {
          const box = lastContextEl.closest("div,article,section");
          if (box) host = box.querySelector("pre code, pre, code");
        }
        if (!host) return null;
        const codeEl = host.matches("code") ? host : host.querySelector("code") || host;
        const raw = codeEl.innerText || codeEl.textContent || "";
        const norm = normalizeDiagramText(raw);
        return { text: norm, className: codeEl.className || "" };
      }

      function scanPage() {
        const els = Array.from(document.querySelectorAll("pre, code"));
        for (const el of els) {
          const raw = el.innerText || el.textContent || "";
          const norm = normalizeDiagramText(raw);
          if (!norm) continue;
          const kind = detectType(norm, el.className || "");
          if (kind !== "unknown") return { text: norm, className: el.className || "", kind };
        }
        return null;
      }

      async function routeAndRender(normText, className) {
        log("routeAndRender: start", { len: normText.length, className });
        const kind = detectType(normText, className);
        log("routeAndRender: detected kind", kind);
        await ensureHost();

        if (kind === "dot") {
          const pf = preflightDOT(normText);
          log("routeAndRender: preflight", pf);
          if (!pf.ok) throw new Error("Not valid DOT after cleanup: " + pf.reason);
          log("routeAndRender: import renderer_graphviz");
          const mod = await import(RT.runtime.getURL("src/renderers/renderer_graphviz.js"));
          log("routeAndRender: calling renderDOT");
          return mod.renderDOT(normText);
        }

        throw new Error("Unknown diagram type");
      }

      // Message handler (router)
      RT && RT.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
        if (!msg || typeof msg !== "object") return;

        if (msg.type === "DIAGRAMS_ROUTER_PING") {
          log("DIAGRAMS_ROUTER_PING -> ok");
          sendResponse && sendResponse({ ok: true, realm: "isolated" });
          return;
        }

        if (msg.type === "DIAGRAMS_RENDER") {
          log("DIAGRAMS_RENDER received", { hasSelection: !!msg.selection, href: location.href });
          try {
            let text = msg.selection ? normalizeDiagramText(msg.selection) : null;
            let cls = "";

            if (!text) {
              const near = extractFromContext();
              log("extractFromContext:", !!near, near && near.text && near.text.slice(0, 60));
              if (near && near.text) { text = near.text; cls = near.className; }
            }

            if (!text) {
              const found = scanPage();
              log("scanPage:", !!found, found && found.text && found.text.slice(0, 60));
              if (found) { text = found.text; cls = found.className; }
            }

            if (!text) {
              warn("no diagram text found");
              alert("No diagram text found here.");
              sendResponse && sendResponse({ ok: false, reason: "no text" });
              return;
            }

            await routeAndRender(text, cls);
            sendResponse && sendResponse({ ok: true });
          } catch (e) {
            error("render failed:", e);
            alert("Render failed: " + (e && e.message ? e.message : String(e)).slice(0, 200));
            sendResponse && sendResponse({ ok: false, error: String(e && e.message || e) });
          }
          return true; // async
        }
      });

      // Success
      window.__GPT_DIAGRAMS_ROUTER_LOADED = true;
      window.__GPT_DIAGRAMS_ROUTER_TRY = "ok";
      log("router fully initialized");
    } else {
      log("router already present, leaving as is");
      window.__GPT_DIAGRAMS_ROUTER_TRY = "already";
      window.__GPT_DIAGRAMS_ROUTER_LOADED = true;
    }
  } catch (e) {
    const message = (e && e.stack) ? e.stack : String(e && e.message || e);
    try {
      window.__GPT_DIAGRAMS_ROUTER_ERROR = message;
      window.__GPT_DIAGRAMS_ROUTER_TRY = "error";
    } catch {}
    error("FATAL during router evaluate:", message);
  }
})();
