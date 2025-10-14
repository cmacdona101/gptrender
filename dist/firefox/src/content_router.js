"use strict";

/**
 * Content router
 * - Ensures UI host is present
 * - Normalizes text from selection, right click, or scan
 * - Detects DOT after normalization
 * - Runs a light preflight before rendering
 * Future: add branches for Mermaid, Cytoscape, ECharts
 */

if (!window.__GPT_DIAGRAMS_ROUTER__) {
  window.__GPT_DIAGRAMS_ROUTER__ = true;

  // Track the right click target locally too
  let lastContextEl = null;
  document.addEventListener("contextmenu", e => { lastContextEl = e.target; }, { capture: true });

  async function ensureHost() {
    if (window.__gptHost && typeof window.__gptHost.open === "function") return;
    try {
      const resp = await browser.runtime.sendMessage({ type: "DIAGRAMS_ENSURE_HOST" });
      if (resp && resp.ok && window.__gptHost && typeof window.__gptHost.open === "function") return;
    } catch {}
    throw new Error("UI host not available");
  }

  // Central normalization used by every ingress
  function normalizeDiagramText(text) {
    if (!text) return "";
    let t = String(text);

    // Strip BOM and zero width characters
    t = t.replace(/^\uFEFF/, "").replace(/[\u200B-\u200D\uFEFF]/g, "");

    // Prefer fenced payload if present: ```dot, ```graphviz, or plain ```
    const fenced = t.match(/```(?:\s*(?:dot|graphviz))?\s*\n([\s\S]*?)\n```/i);
    if (fenced) t = fenced[1];

    // Normalize line endings
    t = t.replace(/\r\n?/g, "\n");

    // Drop a leading noise line such as "dot", "Copy code", "language: dot"
    const firstLineNoise = /^(?:\s*(?:dot|copy code|language:\s*dot|language:\s*graphviz|copy)\s*)\n/i;
    if (firstLineNoise.test(t)) {
      t = t.replace(firstLineNoise, "");
      console.log("[Diagrams] normalize: dropped first-line header noise");
    }

    // Remove common UI overlay lines anywhere at the start of a block
    t = t.replace(/^(?:\s*(?:copy code|copy|expand)\s*\n)+/gi, "");

    // Remove HTML comments that can break HTML-like labels
    t = t.replace(/<!--[\s\S]*?-->/g, "");

    // Escape stray ampersands for HTML-like labels
    t = t.replace(/&(?![a-zA-Z]+;|#\d+;)/g, "&amp;");

    // Trim outer whitespace
    t = t.trim();

    return t;
  }

  // Detection runs on normalized text
  function detectType(normText, className = "") {
    const t = (normText || "").trim();
    const c = (className || "").toLowerCase();

    if (/```(?:dot|graphviz)/i.test(t)) return "dot";
    if (c.includes("language-dot") || c.includes("language-graphviz")) return "dot";
    if (/(^|\n)\s*(digraph|graph)\s+\w*\s*\{/.test(t)) return "dot";

    return "unknown";
  }

  // Light preflight sanity checks before calling Graphviz
  function preflightDOT(t) {
    const hasKeyword = /(digraph|graph)\s+\w*\s*\{/.test(t);
    if (!hasKeyword) return { ok: false, reason: "Missing graph or digraph header" };

    // Simple brace balance
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
    const kind = detectType(normText, className);
    await ensureHost();

    if (kind === "dot") {
      const pf = preflightDOT(normText);
      if (!pf.ok) {
        throw new Error("Not valid DOT after cleanup: " + pf.reason);
      }
      const mod = await import(browser.runtime.getURL("src/renderers/renderer_graphviz.js"));
      return mod.renderDOT(normText);
    }

    throw new Error("Unknown diagram type");
  }

  browser.runtime.onMessage.addListener(async (msg) => {
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "DIAGRAMS_PING") {
      return Promise.resolve({ ok: true });
    }

    if (msg.type === "DIAGRAMS_RENDER") {
      try {
        // 1) selection
        let text = msg.selection ? normalizeDiagramText(msg.selection) : null;
        let cls = "";

        // 2) from right click context
        if (!text) {
          const near = extractFromContext();
          if (near && near.text) { text = near.text; cls = near.className; }
        }

        // 3) fallback scan
        if (!text) {
          const found = scanPage();
          if (found) { text = found.text; cls = found.className; }
        }

        if (!text) {
          alert("No diagram text found here.");
          return;
        }

        await routeAndRender(text, cls);
      } catch (e) {
        console.error("[Diagrams] render failed:", e);
        alert("Render failed: " + (e && e.message ? e.message : String(e)).slice(0, 200));
      }
    }
  });
}
