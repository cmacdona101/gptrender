"use strict";



(function () {
  if (window.__gptHost) return;

  const STORAGE_KEY = `gptd_host_bounds_v1:${location.host}`;
  const MIN_W = 320;
  const MIN_H = 200;

  function getViewportBounds() {
    return {
      w: window.innerWidth || document.documentElement.clientWidth || 1024,
      h: window.innerHeight || document.documentElement.clientHeight || 768
    };
  }

  function readSavedBounds() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return null;
      const { left, top, width, height } = obj;
      if (
        typeof left !== "number" ||
        typeof top !== "number" ||
        typeof width !== "number" ||
        typeof height !== "number"
      ) {
        return null;
      }
      return { left, top, width, height };
    } catch {
      return null;
    }
  }

  function coerceMinSize(rect) {
    const w = Math.max(rect.width, MIN_W);
    const h = Math.max(rect.height, MIN_H);
    return { left: rect.left, top: rect.top, width: w, height: h };
  }

  function saveBoundsFromElement(wrap) {
    const r = wrap.getBoundingClientRect();
    const rect = coerceMinSize({
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height
    });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rect));
    } catch {}
  }

  function applyBounds(wrap, rect) {
    const r = coerceMinSize(rect);
    wrap.style.left = Math.round(r.left) + "px";
    wrap.style.top = Math.round(r.top) + "px";
    wrap.style.width = Math.round(r.width) + "px";
    wrap.style.height = Math.round(r.height) + "px";
    wrap.style.right = "";
  }
  
  
  
  // Size the host so that the BODY content area is approximately bodyW x bodyH.
  // Adds host padding, clamps to viewport, optionally centers.
  function sizeTo(bodyW, bodyH, { center = true, margin = 20 } = {}) {
    const wrap = document.querySelector(".gpt-host-wrap");
    if (!wrap) return;
    // Host CSS uses padding: 12px on all sides
    const PAD = 12 * 2;
    const targetW = Math.max(MIN_W, Math.ceil(bodyW + PAD));
    const targetH = Math.max(MIN_H, Math.ceil(bodyH + PAD));

    const vp = getViewportBounds();
    const maxW = Math.max(0, vp.w - margin);
    const maxH = Math.max(0, vp.h - margin);

    const finalW = Math.min(targetW, maxW);
    const finalH = Math.min(targetH, maxH);

    // If centering, recompute left/top so the box is centered after sizing
    if (center) {
      const left = Math.max(0, Math.floor((vp.w - finalW) / 2));
      const top  = Math.max(0, Math.floor((vp.h - finalH) / 2));
      applyBounds(wrap, { left, top, width: finalW, height: finalH });
    } else {
      const r = wrap.getBoundingClientRect();
      applyBounds(wrap, { left: r.left, top: r.top, width: finalW, height: finalH });
    }
    saveBoundsFromElement(wrap);
  }
 

  function centerDefaults(wrap) {
    const vp = getViewportBounds();
    const width = Math.floor(vp.w * 0.70);
    const height = Math.floor(vp.h * 0.70);
    const left = Math.floor((vp.w - width) / 2);
    const top = Math.floor((vp.h - height) / 2);
    applyBounds(wrap, { left, top, width, height });
  }

  function makeDraggable(wrap, onDragEnd) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let prevUserSelect = "";

    function onMouseDown(e) {
      if (e.button !== 0) return;
	  if (e.target && (e.target.tagName === "BUTTON" || e.target.closest("button"))) return;
	  // Let native resize handle work if user clicks near bottom-right corner
	  const grip = 18; // px
	  const r = wrap.getBoundingClientRect();
	  if (e.clientX >= r.right - grip && e.clientY >= r.bottom - grip) {
	    // Do not start drag. Native CSS resize will take over.
	    return;
	  }

      dragging = true;
      const rect = wrap.getBoundingClientRect();

      startLeft = rect.left;
      startTop = rect.top;

      startX = e.clientX;
      startY = e.clientY;

      prevUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";

      wrap.style.right = "";
      e.preventDefault();

      window.addEventListener("mousemove", onMouseMove, true);
      window.addEventListener("mouseup", onMouseUp, true);
    }

    function onMouseMove(e) {
      if (!dragging) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      const nextLeft = startLeft + dx;
      const nextTop = startTop + dy;

      wrap.style.left = Math.round(nextLeft) + "px";
      wrap.style.top = Math.round(nextTop) + "px";
    }

    function onMouseUp() {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = prevUserSelect || "";

      window.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("mouseup", onMouseUp, true);

      try {
        onDragEnd && onDragEnd();
      } catch {}
    }

    wrap.addEventListener("mousedown", onMouseDown, true);
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
    window.addEventListener("keydown", onKey, true);
    const obs = new MutationObserver(() => {
      if (!document.body.contains(wrap)) {
        window.removeEventListener("keydown", onKey, true);
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function observeResizeAndSave(wrap) {
    // Save on native CSS resize activity
    let rafId = 0;
    const ro = new ResizeObserver(() => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        saveBoundsFromElement(wrap);
      });
    });
    ro.observe(wrap);

    // No viewport clamping on resize. We only save the new raw bounds.

    // Cleanup on removal
    const obs = new MutationObserver(() => {
      if (!document.body.contains(wrap)) {
        try { ro.disconnect(); } catch {}
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

    // Initial size and position: try restore, else center defaults
    const saved = readSavedBounds();
    if (saved) {
      applyBounds(wrap, saved);
    } else {
      wrap.style.width = "70vw";
      wrap.style.height = "70vh";
      wrap.style.left = "10px";
      wrap.style.top = "10px";
    }


    const body = document.createElement("div");
    body.className = "gpt-host-body";

    wrap.appendChild(body);

    (document.body || document.documentElement).appendChild(wrap);

	if (!saved) {
	  // Temporary reasonable size. Renderer will call sizeTo() after measuring SVG.
	  centerDefaults(wrap);
	}

    makeDraggable(wrap, () => saveBoundsFromElement(wrap));
    attachEscToClose(wrap);
    observeResizeAndSave(wrap);

    // Save initial bounds
    saveBoundsFromElement(wrap);

    return body;
  }

  window.__gptHost = { open: openHost, sizeTo };
})();
