/* HOMS TECH admin — UI state helpers (presentation only).
   1) Mirrors #saveStatus on #saveBtn as .is-loading / .is-success.
   2) Replaces emoji in the sidebar with one consistent line-icon set.
   3) Shows the save bar only while there are unsaved changes (or while saving).
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

/* ---- 2. Sidebar line icons -------------------------------------------- */
(function () {
  "use strict";
  var P = {
    megaphone: "M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12",
    check: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 12l3 3 5-6",
    star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
    home: "M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6",
    wrench: "M14.5 6.5a4 4 0 0 0 5 5l-9.2 9.2a2 2 0 0 1-2.8-2.8z",
    tools: "M4 20l7-7M13 5l6 6-3 3-6-6z",
    phone: "M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18h2",
    bag: "M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2",
    tag: "M3 12V4h8l10 10-8 8zM7.5 8.5h.01",
    box: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10",
    users: "M16 11a3 3 0 1 0 0-6M8 11a3 3 0 1 0 0-6M2 20c0-3 3-5 6-5s6 2 6 5M16 15c3 0 6 2 6 5",
    clipboard: "M9 4h6v3H9zM7 5H5v16h14V5h-2M9 12h6M9 16h4",
    download: "M12 3v12M7 10l5 5 5-5M4 20h16",
    shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4",
    chat: "M4 5h16v11H9l-5 4z",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6",
    mail: "M3 5h18v14H3zM3 6l9 7 9-7",
    receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
    sliders: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M14 4v4M10 10v4M16 16v4",
    search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
    list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
    logout: "M9 4H5v16h4M16 8l4 4-4 4M20 12H9"
  };
  var BY_PAGE = {
    general: "home", services: "wrench", repair: "tools", phones: "phone", shop: "bag",
    discounts: "tag", inventory: "box", partners: "users", "device-register": "clipboard",
    buyback: "download", why: "shield", "live-chat": "chat", customers: "user", emails: "mail",
    invoices: "receipt", "order-settings": "sliders", search: "search", admins: "shield",
    "all-orders": "list"
  };
  var BY_HREF = { "announcement-bars": "megaphone", "benefits-strip": "check", reviews: "star" };
  function iconFor(el) {
    var page = el.getAttribute("data-page");
    if (page && BY_PAGE[page]) return BY_PAGE[page];
    var href = el.getAttribute("href") || "";
    for (var k in BY_HREF) if (href.indexOf(k) > -1) return BY_HREF[k];
    if (el.classList.contains("admin-logout-btn")) return "logout";
    return null;
  }
  function apply() {
    var items = document.querySelectorAll("#adminNav .nav-btn");
    Array.prototype.forEach.call(items, function (el) {
      if (el.querySelector(".nav-ico")) return;
      var name = iconFor(el);
      if (!name) return;
      var node = null;
      for (var i = 0; i < el.childNodes.length; i++) {
        var n = el.childNodes[i];
        if (n.nodeType === 3 && n.nodeValue.trim()) { node = n; break; }
      }
      if (!node) return;
      node.nodeValue = " " + node.nodeValue.replace(/^[\s‍️]*[^\p{L}\p{N}]*\s*/u, "");
      var span = document.createElement("span");
      span.className = "nav-ico";
      span.setAttribute("aria-hidden", "true");
      span.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + P[name] + '"/></svg>';
      el.insertBefore(span, node);
    });
  }
  apply();
  document.addEventListener("DOMContentLoaded", apply);
  window.addEventListener("load", apply);
})();

/* ---- 3. Smart save bar ------------------------------------------------- */
(function () {
  "use strict";
  var bar = document.querySelector(".save-bar");
  var statusEl = document.getElementById("saveStatus");
  var btn = document.getElementById("saveBtn");
  if (!bar || !statusEl || !btn) return;
  var hideTimer = null;
  function setClean(clean) {
    clearTimeout(hideTimer);
    bar.classList.toggle("is-clean", clean);
  }
  function fromStatus() {
    var text = (statusEl.textContent || "").trim();
    var cls = statusEl.className || "";
    if (/\.\.\.$/.test(text)) return setClean(false);
    if (/\bsuccess\b/.test(cls) && /opgeslagen/i.test(text)) {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () { setClean(true); }, 2600);
      return;
    }
    if (/geladen/i.test(text) && !/\berror\b/.test(cls)) return setClean(true);
    setClean(false);
  }
  new MutationObserver(fromStatus).observe(statusEl, { attributes: true, attributeFilter: ["class"], childList: true, characterData: true, subtree: true });
  // Any edit inside the admin content counts as a change, even if a form
  // does not call markChanged().
  ["input", "change"].forEach(function (type) {
    document.addEventListener(type, function (event) {
      if (event.target && event.target.closest && event.target.closest("#dashboard") && !event.target.closest(".save-bar") && !event.target.closest("[data-no-dirty]") && !event.target.matches("#dashboard .phone-tree-search input, #dashboard input[type=search]")) setClean(false);
    }, true);
  });
  fromStatus();
})();
