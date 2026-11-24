/* HOMS TECH admin — UI state helpers (presentation only).
   Mirrors #saveStatus on #saveBtn as .is-loading / .is-success.
   Never changes data, requests or any save logic in homs-admin.js. */
(function () {
  "use strict";
  var SUCCESS_MS = 2200;
  var statusEl = document.getElementById("saveStatus");
  var saveBtn = document.getElementById("saveBtn");
  if (!statusEl || !saveBtn || typeof MutationObserver === "undefined") return;

  var timer = null;
  function clearSuccess() {
    clearTimeout(timer);
    timer = null;
    saveBtn.classList.remove("is-success");
  }
  function sync() {
    var cls = statusEl.className || "";
    var text = (statusEl.textContent || "").trim();
    var busy = /\binfo\b/.test(cls) && /\.\.\.$/.test(text);
    saveBtn.classList.toggle("is-loading", busy);
    saveBtn.setAttribute("aria-busy", busy ? "true" : "false");
    if (/\bsuccess\b/.test(cls) && /opgeslagen/i.test(text)) {
      if (!timer) {
        saveBtn.classList.add("is-success");
        timer = setTimeout(clearSuccess, SUCCESS_MS);
      }
    } else if (!busy) {
      clearSuccess();
    }
  }
  new MutationObserver(sync).observe(statusEl, {
    attributes: true, attributeFilter: ["class"],
    childList: true, characterData: true, subtree: true
  });
  sync();
})();
