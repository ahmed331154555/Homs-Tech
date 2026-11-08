(function () {
  "use strict";
  const markerId = "homs-announcement-bars-script";
  if (document.getElementById(markerId)) return;
  const marker = document.createElement("meta");
  marker.id = markerId;
  document.head.appendChild(marker);

  const pages = [
    ["/about.html","about"],["/devices.html","devices"],["/product.html","product"],
    ["/repair.html","repair"],["/uw-toestel-verkopen.html","sell"],["/prices.html","prices"],
    ["/shop.html","shop"],["/account.html","account"],["/cart.html","cart"],
    ["/checkout.html","checkout"],["/contact.html","contact"],["/payment.html","payment"],
    ["/privacybeleid.html","privacy"],["/design-preview.html","design"]
  ];
  const path = (location.pathname || "/").toLowerCase();
  const page = path === "/" || path.endsWith("/index.html")
    ? "home"
    : (pages.find(function (entry) { return path.endsWith(entry[0]); }) || [null,"home"])[1];

  const defaults = {
    enabled:true,
    messages:["1 jaar garantie","Snel geleverd","Betrouwbare service","Betaalbare prijzen"],
    background:"#071d2d",textColor:"#eaf4ff",accentColor:"#60a5fa",
    speed:90,direction:"rtl",mode:"scroll",height:42,fontSize:14
  };

  function safeColor(value,fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
  }
  function normalize(raw) {
    const value = raw && typeof raw === "object" ? raw : {};
    const messages = Array.isArray(value.messages)
      ? value.messages.map(function (item) { return String(item || "").trim().slice(0,120); }).filter(Boolean).slice(0,8)
      : defaults.messages;
    return {
      enabled:value.enabled !== false,
      messages:messages.length ? messages : defaults.messages,
      background:safeColor(value.background,defaults.background),
      textColor:safeColor(value.textColor,defaults.textColor),
      accentColor:safeColor(value.accentColor,defaults.accentColor),
      speed:Math.max(20,Math.min(600,Number(value.speed) || defaults.speed)),
      direction:value.direction === "ltr" ? "ltr" : "rtl",
      mode:value.mode === "static" ? "static" : "scroll",
      height:Math.max(30,Math.min(64,Number(value.height) || defaults.height)),
      fontSize:Math.max(10,Math.min(22,Number(value.fontSize) || defaults.fontSize))
    };
  }
  function removeOldBars() {
    document.querySelectorAll("#homeTopBar,.ht-topbar,.topbar").forEach(function (node) { node.remove(); });
    const previous = document.getElementById("homsManagedAnnouncementBar");
    if (previous) previous.remove();
    const oldStyle = document.getElementById("homs-announcement-motion-style");
    if (oldStyle) oldStyle.remove();
  }
  function buildGroup(messages,settings) {
    const group = document.createElement("div");
    group.className = "homs-announcement-group";
    group.style.cssText = "display:flex;align-items:center;gap:44px;padding-right:44px;white-space:nowrap;flex:0 0 auto";
    messages.forEach(function (message) {
      const item = document.createElement("span");
      item.style.cssText = "display:inline-flex;align-items:center;gap:8px;white-space:nowrap;font-size:"+settings.fontSize+"px;font-weight:700;color:"+settings.textColor;
      const check = document.createElement("b");
      check.textContent = "✓";
      check.style.color = settings.accentColor;
      const label = document.createElement("span");
      label.textContent = message;
      item.append(check,label);
      group.appendChild(item);
    });
    return group;
  }
  function render(raw) {
    removeOldBars();
    const settings = normalize(raw);
    if (!settings.enabled || !settings.messages.length) return;

    const bar = document.createElement("div");
    bar.id = "homsManagedAnnouncementBar";
    bar.setAttribute("role","region");
    bar.setAttribute("aria-label","HOMS TECH mededelingen");
    bar.style.cssText = "display:flex;align-items:center;width:100%;height:"+settings.height+"px;min-height:"+settings.height+"px;overflow:hidden;position:relative;z-index:1000;box-sizing:border-box;background:"+settings.background+";color:"+settings.textColor;

    const viewport = document.createElement("div");
    viewport.style.cssText = "width:100%;height:100%;overflow:hidden;display:flex;align-items:center";
    const track = document.createElement("div");
    track.className = "homs-announcement-track";
    track.style.cssText = "display:flex;align-items:center;width:max-content;flex:0 0 auto;will-change:transform";

    const first = buildGroup(settings.messages,settings);
    track.appendChild(first);
    if (settings.mode === "scroll") {
      const second = first.cloneNode(true);
      second.setAttribute("aria-hidden","true");
      track.appendChild(second);
    } else {
      track.style.width = "100%";
      track.style.justifyContent = "center";
      first.style.width = "100%";
      first.style.justifyContent = "center";
      first.style.flexWrap = "wrap";
      first.style.whiteSpace = "normal";
      first.style.gap = "8px 24px";
    }

    viewport.appendChild(track);
    bar.appendChild(viewport);
    const header = document.querySelector(".ht-header,header");
    if (header && header.parentNode) header.parentNode.insertBefore(bar,header);
    else document.body.insertBefore(bar,document.body.firstChild);

    if (settings.mode === "scroll") {
      requestAnimationFrame(function () {
        const width = first.getBoundingClientRect().width;
        if (!width) return;
        const loopDistance = Math.ceil(width * 100) / 100;
        const duration = Math.max(3,loopDistance/settings.speed);
        const startX = settings.direction === "rtl" ? 0 : -loopDistance;
        const endX = settings.direction === "rtl" ? -loopDistance : 0;

        // Keep enough identical groups in the track to cover the viewport
        // plus one complete loop segment. This prevents blank gaps on short messages.
        const requiredWidth = viewport.clientWidth + loopDistance;
        while (track.scrollWidth < requiredWidth) {
          const clone = first.cloneNode(true);
          clone.setAttribute("aria-hidden","true");
          track.appendChild(clone);
        }
        track.style.width = "max-content";
        track.style.flex = "0 0 auto";
        const style = document.createElement("style");
        style.id = "homs-announcement-motion-style";
        style.textContent = "@keyframes homsAnnouncementMove{from{transform:translate3d("+startX+"px,0,0)}to{transform:translate3d("+endX+"px,0,0)}}" +
          "#homsManagedAnnouncementBar .homs-announcement-track{animation:homsAnnouncementMove "+duration+"s linear infinite!important}" +
          "#homsManagedAnnouncementBar:hover .homs-announcement-track{animation-play-state:paused!important}";
        document.head.appendChild(style);
      });
    }
  }

  fetch("/api/announcement-bars?page="+encodeURIComponent(page),{
    cache:"no-store",credentials:"same-origin",headers:{"Accept":"application/json"}
  })
    .then(function (response) {
      if (!response.ok) throw new Error("HTTP "+response.status);
      return response.json();
    })
    .then(function (data) { render(data && data.settings); })
    .catch(function (error) {
      console.error("[HOMS TECH] Announcement bar kon niet worden geladen:",error);
    });
})();