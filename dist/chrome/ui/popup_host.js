"use strict";

/**
 * UI host module
 * Creates a reusable modal container on demand
 * Exposes window.__gptHost.open() -> returns a mount element
 */

(function () {
  if (window.__gptHost) return;

  function openHost() {
    const wrap = document.createElement("div");
    wrap.className = "gpt-host-wrap";

    const bar = document.createElement("div");
    bar.className = "gpt-host-bar";

    const title = document.createElement("div");
    title.textContent = "Diagram";

    const close = document.createElement("button");
    close.textContent = "Close";
    close.onclick = () => wrap.remove();

    bar.appendChild(title);
    bar.appendChild(close);

    const body = document.createElement("div");
    body.className = "gpt-host-body";

    wrap.appendChild(bar);
    wrap.appendChild(body);

    (document.body || document.documentElement).appendChild(wrap);
    return body;
  }

  window.__gptHost = { open: openHost };
})();
