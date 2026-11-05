(() => {
  "use strict";

  const MEASUREMENT_ID = "G-51JQ32MKCN";
  const STORAGE_KEY = "homsTechAnalyticsConsent";

  function loadGoogleAnalytics() {
    if (window.__homsGoogleAnalyticsLoaded) return;
    window.__homsGoogleAnalyticsLoaded = true;

    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", MEASUREMENT_ID);

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(MEASUREMENT_ID);
    document.head.appendChild(script);
  }

  function readConsent() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      return null;
    }
  }

  function saveConsent(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch (_) {
      // If storage is unavailable, keep the choice for this page only.
    }
    if (value === "accepted") loadGoogleAnalytics();
    renderStatus(value);
  }

  function renderStatus(value) {
    const banner = document.getElementById("homs-cookie-banner");
    if (banner) banner.hidden = true;
    const notice = document.getElementById("homs-cookie-settings");
    if (notice) notice.hidden = false;
    if (notice) notice.setAttribute("aria-label", value === "accepted" ? "Cookie-instellingen: analytics toegestaan" : "Cookie-instellingen: analytics geweigerd");
  }

  function showBanner() {
    const banner = document.getElementById("homs-cookie-banner");
    if (banner) banner.hidden = false;
  }

  function init() {
    if (document.getElementById("homs-cookie-banner")) return;

    const style = document.createElement("style");
    style.textContent = `
      #homs-cookie-banner{position:fixed;z-index:99999;left:16px;right:16px;bottom:16px;max-width:760px;margin:0 auto;padding:18px;background:#fff;color:#172330;border:1px solid #d9e0e7;border-radius:14px;box-shadow:0 12px 40px rgba(7,29,45,.2);font:14px/1.55 Arial,Helvetica,sans-serif}
      #homs-cookie-banner[hidden],#homs-cookie-settings[hidden]{display:none}
      #homs-cookie-banner p{margin:0 0 12px}
      #homs-cookie-banner a{color:#1d4ed8;text-decoration:underline}
      .homs-cookie-actions{display:flex;flex-wrap:wrap;gap:9px}
      .homs-cookie-actions button,#homs-cookie-settings{min-height:40px;border-radius:8px;padding:9px 14px;font:600 14px Arial,Helvetica,sans-serif;cursor:pointer}
      .homs-cookie-accept{background:#071d2d;color:#fff;border:1px solid #071d2d}
      .homs-cookie-reject{background:#fff;color:#071d2d;border:1px solid #9aa8b5}
      #homs-cookie-settings{position:fixed;z-index:99998;left:12px;bottom:12px;background:#fff;color:#071d2d;border:1px solid #9aa8b5;box-shadow:0 3px 12px rgba(7,29,45,.14);font-size:12px}
      @media(max-width:480px){#homs-cookie-banner{left:10px;right:10px;bottom:10px;padding:15px}.homs-cookie-actions button{flex:1}}
    `;
    document.head.appendChild(style);

    const banner = document.createElement("section");
    banner.id = "homs-cookie-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-modal", "false");
    banner.setAttribute("aria-labelledby", "homs-cookie-title");
    banner.hidden = true;
    banner.innerHTML = `
      <strong id="homs-cookie-title">Cookies op HOMS TECH</strong>
      <p>We gebruiken Google Analytics alleen als u daarvoor toestemming geeft. Met Analytics meten we het websitegebruik en verbeteren we onze website. U kunt weigeren; de website blijft gewoon werken. Lees meer in ons <a href="privacybeleid.html">privacybeleid</a>.</p>
      <div class="homs-cookie-actions">
        <button type="button" class="homs-cookie-accept" data-homs-consent="accepted">Accepteren</button>
        <button type="button" class="homs-cookie-reject" data-homs-consent="rejected">Weigeren</button>
      </div>
    `;
    document.body.appendChild(banner);

    const settings = document.createElement("button");
    settings.type = "button";
    settings.id = "homs-cookie-settings";
    settings.textContent = "Cookie-instellingen";
    settings.hidden = true;
    settings.addEventListener("click", showBanner);
    document.body.appendChild(settings);

    banner.addEventListener("click", (event) => {
      const button = event.target.closest("[data-homs-consent]");
      if (button) saveConsent(button.getAttribute("data-homs-consent"));
    });

    const consent = readConsent();
    if (consent === "accepted") {
      loadGoogleAnalytics();
      renderStatus(consent);
    } else if (consent === "rejected") {
      renderStatus(consent);
    } else {
      showBanner();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
