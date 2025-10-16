"use strict";

/**
 * UI host module
 * Creates a reusable modal container on demand
 * Exposes window.__gptHost.open() -> returns a mount element
 * draggable by title bar, ESC to close, on-screen clamping
 */

(function () {
  if (window.__gptHost) return;

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function makeDraggable(wrap, bar) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let prevUserSelect = "";

    function onMouseDown(e) {
      // Only left button and not on a focusable button inside the bar
      if (e.button !== 0) return;
      if (e.target && (e.target.tagName === "BUTTON" || e.target.closest("button"))) return;

      dragging = true;
      const rect = wrap.getBoundingClientRect();

      // Compute current left/top in px
      // If computed styles are percentage, use rect relative to viewport
      const cs = getComputedStyle(wrap);
      const leftPx = wrap.style.left || (cs.left || rect.left + "px");
      const topPx = wrap.style.top || (cs.top || rect.top + "px");

      startLeft = parseFloat(leftPx) || rect.left;
      startTop = parseFloat(topPx) || rect.top;

      startX = e.clientX;
      startY = e.clientY;

      // Disable text selection during drag
      prevUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";

      // Ensure we are positioned via left/top, not right
      wrap.style.right = "";
      // Prevent default to avoid text selection
      e.preventDefault();

      window.addEventListener("mousemove", onMouseMove, true);
      window.addEventListener("mouseup", onMouseUp, true);
    }

    function onMouseMove(e) {
      if (!dragging) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      // Current size for clamping
      const r = wrap.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Keep a small visible margin so it cannot disappear
      const margin = 8;

      let nextLeft = startLeft + dx;
      let nextTop = startTop + dy;

      // Clamp so at least margin area remains on screen
      nextLeft = clamp(nextLeft, margin - (r.width - margin), vw - margin);
      nextTop = clamp(nextTop, margin - (r.height - margin), vh - margin);

      wrap.style.left = Math.round(nextLeft) + "px";
      wrap.style.top = Math.round(nextTop) + "px";
    }

    function onMouseUp() {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = prevUserSelect || "";
      window.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("mouseup", onMouseUp, true);
    }

    bar.addEventListener("mousedown", onMouseDown, true);
  }

  function attachEscToClose(wrap) {
    function onKey(e) {
      if (e.key === "Escape") {
        if (document.body.contains(wrap)) {
          wrap.remove();
          e.stopPropagation();
        }
      }
    }
    // Capture so page scripts are less likely to consume it first
    window.addEventListener("keydown", onKey, true);
    // Clean up when the panel is removed
    const obs = new MutationObserver(() => {
      if (!document.body.contains(wrap)) {
        window.removeEventListener("keydown", onKey, true);
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function openHost() {
    // Reuse existing host if present
    const existing = document.querySelector(".gpt-host-wrap");
    if (existing) {
      const existingBody = existing.querySelector(".gpt-host-body");
      if (existingBody) return existingBody;
    }

    const wrap = document.createElement("div");
    wrap.className = "gpt-host-wrap";

    // Ensure explicit size even if CSS did not apply yet
    if (!wrap.style.width) wrap.style.width = "70vw";
    if (!wrap.style.height) wrap.style.height = "70vh";

    const bar = document.createElement("div");
    bar.className = "gpt-host-bar";

    const title = document.createElement("div");
    title.textContent = "Diagram";

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.addEventListener("click", () => wrap.remove());

    bar.appendChild(title);
    bar.appendChild(close);

    const body = document.createElement("div");
    body.className = "gpt-host-body";

    wrap.appendChild(bar);
    wrap.appendChild(body);

    (document.body || document.documentElement).appendChild(wrap);

    // Enable dragging via the title bar
    makeDraggable(wrap, bar);
    // Enable ESC to close
    attachEscToClose(wrap);

    return body;
  }

  window.__gptHost = { open: openHost };
})();
