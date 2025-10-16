"use strict";

/**
 * UI host module
 * Creates a reusable modal container on demand
 * Exposes window.__gptHost.open() -> returns a mount element
 */

(function () {
  if (window.__gptHost) return;

  function openHost() {
    // Reuse existing host if present
    const existing = document.querySelector(".gpt-host-wrap");
    if (existing) {
      const existingBody = existing.querySelector(".gpt-host-body");
      if (existingBody) return existingBody;
    }

    const wrap = document.createElement("div");
    wrap.className = "gpt-host-wrap";

    // Ensure explicit size even if CSS has not applied yet
    if (!wrap.style.width) wrap.style.width = "70vw";
    if (!wrap.style.height) wrap.style.height = "70vh";

    const bar = document.createElement("div");
    bar.className = "gpt-host-bar";

    const title = document.createElement("div");
    title.textContent = "Diagram";

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.addEventListener("click", () => {
      wrap.remove();
    });

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
