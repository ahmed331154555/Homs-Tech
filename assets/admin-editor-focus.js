/* HOMS TECH admin — editor focus helper (presentation only).
   When a list turns into an editor (phone configurator, Shop product editor,
   "Uw toestel verkopen" levels) or the editor moves to another step, bring the
   top of the editor into view. When the editor is closed, return to the place
   in the list the user came from. No data or handlers are touched. */
(function () {
  "use strict";
  var dashboard = document.getElementById("dashboard");
  if (!dashboard || !window.MutationObserver) return;

  var views = [
    {
      name: "phones",
      find: function () { return document.querySelector('#phonesList > .card[style*="max-width:1150px"]'); },
      sig: function (el) { var p = el.querySelector("p.small"); return "phones|" + (p ? p.textContent.replace(/\s+/g, " ").trim() : ""); }
    },
    {
      name: "shop",
      find: function () { return document.querySelector("#shopProductsAdmin .shop-edit"); },
      sig: function (el) { return "shop|" + el.getAttribute("data-key"); }
    },
    {
      name: "buyback",
      find: function () { return document.querySelector(".buyback-v1-shell .buyback-v1-back") && document.querySelector(".buyback-v1-shell"); },
      sig: function (el) { var b = el.querySelector(".buyback-v1-back"); return "buyback|" + (b ? b.textContent.trim() : ""); }
    }
  ];
  var state = {};
  var queued = false;

  function headerOffset() {
    var bar = document.querySelector(".topbar");
    if (bar && getComputedStyle(bar).position !== "static" && getComputedStyle(bar).position !== "relative") return Math.round(bar.getBoundingClientRect().height) + 8;
    return 12;
  }
  function scrollTo(el) {
    var top = el.getBoundingClientRect().top + window.pageYOffset - headerOffset();
    window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
  }
  // Layout can still shift right after a render (images, collapsing panels),
  // so re-align once if the editor is not where we put it.
  function settle(view, sig) {
    [220, 800].forEach(function (delay) {
      window.setTimeout(function () {
        var el = view.find();
        if (!el || view.sig(el) !== sig) return;
        var off = el.getBoundingClientRect().top - headerOffset();
        if (Math.abs(off) > 8) scrollTo(el);
      }, delay);
    });
  }
  function check() {
    queued = false;
    views.forEach(function (view) {
      var el = view.find();
      var sig = el ? view.sig(el) : "";
      var s = state[view.name] || (state[view.name] = { sig: "", back: 0 });
      if (sig === s.sig) return;
      if (sig && !s.sig) s.back = window.pageYOffset;      // list -> editor
      if (sig) {                                            // new editor or new step
        scrollTo(el);
        settle(view, sig);
      }
      else if (s.back != null) {                            // editor closed
        var y = s.back;
        window.scrollTo({ top: y, behavior: "auto" });
        s.back = null;
      }
      s.sig = sig;
    });
  }
  function schedule() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(function () { window.setTimeout(check, 0); });
  }
  new MutationObserver(schedule).observe(dashboard, { childList: true, subtree: true });
})();
