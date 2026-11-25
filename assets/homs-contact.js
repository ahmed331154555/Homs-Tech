/* HOMS TECH — single source for contact buttons.
 *
 * The number comes from the admin "Footer" settings (homepage.footer.phone /
 * whatsapp), falling back to the site-level phone / whatsapp. Every element
 * marked [data-wa] or [data-phone] on any page is filled from here, so changing
 * the number in the admin updates the whole website at once.
 *
 *   <a data-wa data-wa-text="Hallo…" href="contact.html">WhatsApp</a>
 *   <a data-phone href="contact.html">Bel ons</a>
 */
(() => {
  "use strict";
  if (window.HomsContact) return;
  const CACHE_KEY = "homsContactCache";
  const clean = value => String(value ?? "").trim();
  const digits = value => clean(value).replace(/\D/g, "");

  // Normalise to international digits (0612… -> 31612…, 0031… -> 31…).
  function waDigits(value) {
    let n = digits(value);
    if (n.startsWith("00")) n = n.slice(2);
    if (n.startsWith("31") && n.charAt(2) === "0") n = "31" + n.slice(3);
    else if (n.startsWith("0")) n = "31" + n.slice(1);
    return n.length >= 8 ? n : "";
  }

  let payload = {};
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (cached && typeof cached === "object" && !Array.isArray(cached)) payload = cached;
  } catch (e) {}

  function get() {
    const footer = (payload.homepage && payload.homepage.footer) || {};
    return {
      phone: clean(footer.phone || payload.phone),
      whatsapp: clean(footer.whatsapp || payload.whatsapp),
      email: clean(footer.email),
      payload
    };
  }
  const whatsappUrl = text => {
    const n = waDigits(get().whatsapp || get().phone);
    return n ? "https://wa.me/" + n + (text ? "?text=" + encodeURIComponent(text) : "") : "";
  };
  const phoneUrl = () => {
    const p = get().phone.replace(/[^\d+]/g, "");
    return p ? "tel:" + p : "";
  };

  function apply(root) {
    const scope = root && root.querySelectorAll ? root : document;
    const wa = scope.querySelectorAll("[data-wa]");
    const tel = scope.querySelectorAll("[data-phone]");
    wa.forEach(el => {
      const url = whatsappUrl(el.getAttribute("data-wa-text") || "");
      if (!url) return;
      el.setAttribute("href", url);
      if (!el.target) el.target = "_blank";
      el.rel = "noopener noreferrer";
      el.hidden = false;
    });
    tel.forEach(el => {
      const url = phoneUrl();
      if (url) el.setAttribute("href", url);
    });
  }

  let request;
  function load() {
    if (!request) {
      request = fetch("/api/site?view=footer", { headers: { Accept: "application/json" }, cache: "no-cache" })
        .then(response => {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json();
        })
        .then(data => {
          if (data && typeof data === "object" && !Array.isArray(data)) {
            payload = data;
            try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) {}
          }
          apply();
          return payload;
        })
        .catch(error => {
          console.warn("[HOMS TECH] Contact settings unavailable", error);
          return payload;
        });
    }
    return request;
  }

  window.HomsContact = { load, get, apply, whatsappUrl, phoneUrl };

  // Fill what we already know immediately, then refresh from the server.
  const start = () => { apply(); load(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  // Pages that render buttons later (product details, cards…) are covered too.
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; apply(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
