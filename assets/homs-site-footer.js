(() => {
  "use strict";
  const year = new Date().getFullYear();
  const clean = value => String(value ?? "").trim();
  const esc = value => clean(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const digits = value => clean(value).replace(/\D/g, "");
  function installFooterStyles() {
    if (document.getElementById("homs-footer-layout-styles")) return;
    const style = document.createElement("style");
    style.id = "homs-footer-layout-styles";
    style.textContent = `
      footer.ht-site-footer.ht-site-footer--unified {
        display:block!important;width:100%!important;max-width:none!important;
        box-sizing:border-box!important;margin:36px 0 0!important;
        padding:clamp(30px,4vw,48px) clamp(18px,3vw,36px) 18px!important;
        background:#071d2d!important;color:#fff!important;overflow:visible!important;
      }
      footer.ht-site-footer--unified .ht-footer-grid--unified {
        display:grid!important;width:100%!important;max-width:1200px!important;
        margin:0 auto!important;box-sizing:border-box!important;
        grid-template-columns:minmax(0,1.35fr) minmax(130px,.8fr) minmax(170px,1.05fr) minmax(190px,1.2fr)!important;
        align-items:start!important;justify-content:stretch!important;
        gap:clamp(20px,3vw,38px)!important;
      }
      footer.ht-site-footer--unified .ht-footer-grid--unified>* {
        display:block!important;min-width:0!important;width:auto!important;
        max-width:none!important;float:none!important;box-sizing:border-box!important;
      }
      footer.ht-site-footer--unified .ht-footer-grid--unified h2 {
        margin:0 0 16px!important;color:#fff!important;font-size:17px!important;
        line-height:1.3!important;font-weight:800!important;
      }
      footer.ht-site-footer--unified .ht-footer-grid--unified ul {
        display:flex!important;flex-direction:column!important;gap:10px!important;
        margin:0!important;padding:0!important;list-style:none!important;
      }
      footer.ht-site-footer--unified .ht-footer-grid--unified li {
        display:block!important;margin:0!important;padding:0!important;
        color:#cbd5e1!important;font-size:14px!important;line-height:1.5!important;
        overflow-wrap:anywhere!important;
      }
      footer.ht-site-footer--unified .ht-footer-grid--unified li a {
        display:inline-flex!important;align-items:center!important;min-height:24px!important;
        color:#cbd5e1!important;font-size:14px!important;text-decoration:none!important;
        overflow-wrap:anywhere!important;
      }
      footer.ht-site-footer--unified .ht-footer-grid--unified li a:hover {
        color:#fff!important;text-decoration:underline!important;text-underline-offset:3px!important;
      }
      footer.ht-site-footer--unified .ht-footer-brand p {
        margin:10px 0!important;color:#cbd5e1!important;line-height:1.6!important;
      }
      footer.ht-site-footer--unified .ht-footer-logo {
        display:inline-flex!important;margin:0 0 8px!important;font-size:25px!important;
        font-weight:900!important;color:#fff!important;text-decoration:none!important;
      }
      footer.ht-site-footer--unified .ht-footer-cta {
        display:inline-flex!important;align-items:center!important;gap:8px!important;
        margin-top:12px!important;padding:11px 15px!important;border-radius:9px!important;
        background:#2563eb!important;color:#fff!important;font-weight:700!important;
        text-decoration:none!important;
      }
      footer.ht-site-footer--unified .ht-footer-bottom {
        display:flex!important;flex-wrap:wrap!important;justify-content:space-between!important;
        gap:10px 24px!important;width:100%!important;max-width:1200px!important;
        margin:30px auto 0!important;padding:16px 0 0!important;
        border-top:1px solid #334155!important;box-sizing:border-box!important;
        color:#cbd5e1!important;font-size:13px!important;line-height:1.5!important;
      }
      @media(max-width:900px) {
        footer.ht-site-footer--unified .ht-footer-grid--unified {
          grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:28px 24px!important;
        }
        footer.ht-site-footer--unified .ht-footer-brand {grid-column:1/-1!important}
      }
      @media(max-width:520px) {
        footer.ht-site-footer.ht-site-footer--unified {padding:30px 20px 16px!important}
        footer.ht-site-footer--unified .ht-footer-grid--unified {
          grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:24px 16px!important;
        }
        footer.ht-site-footer--unified .ht-footer-grid--unified h2 {font-size:15px!important;margin-bottom:12px!important}
        footer.ht-site-footer--unified .ht-footer-grid--unified li,
        footer.ht-site-footer--unified .ht-footer-grid--unified li a {font-size:12px!important}
        footer.ht-site-footer--unified .ht-footer-bottom {flex-direction:column!important;gap:5px!important;margin-top:24px!important}
      }
      @media(max-width:350px) {
        footer.ht-site-footer--unified .ht-footer-grid--unified {grid-template-columns:minmax(0,1fr)!important}
        footer.ht-site-footer--unified .ht-footer-brand {grid-column:auto!important}
      }
    `;
    document.head.appendChild(style);
  }
  const groups = {
    about: [["Home","index.html"],["Over HOMS TECH","about.html"],["Contact","contact.html"]],
    services: [["Telefoons bekijken","devices.html"],["Telefoon repareren","repair.html"],["Uw toestel verkopen","uw-toestel-verkopen.html"],["Reparatieprijzen","prices.html"],["Klantbeoordelingen","reviews.html"]],
    help: [["Garantie & voorwaarden","about.html"],["Privacybeleid","privacybeleid.html"],["Cookie-instellingen","#cookie-settings"]]
  };
  const list = items => items.map(([label,url]) => '<li><a href="'+url+'"'+(url==="#cookie-settings"?' data-footer-cookie-settings':'')+'>'+label+'</a></li>').join("");
  function render(host, settings, site) {
    const description = clean(settings.description) || "Refurbished apparaten · Telefoonreparatie · Service";
    const area = clean(settings.area || site.areas), hours = clean(settings.hours);
    const email = clean(settings.email), phone = clean(settings.phone || site.phone), whatsapp = clean(settings.whatsapp || site.whatsapp);
    const contacts = [];
    if(email) contacts.push('<li><a href="mailto:'+encodeURIComponent(email)+'">'+esc(email)+'</a></li>');
    if(phone) contacts.push('<li><a href="tel:'+phone.replace(/[^+\d]/g,"")+'">'+esc(phone)+'</a></li>');
    const wa = digits(whatsapp);
    if(wa) contacts.push('<li><a href="https://wa.me/'+wa+'" target="_blank" rel="noopener noreferrer">Stuur ons een WhatsApp</a></li>');
    host.classList.add("ht-site-footer","ht-site-footer--unified");
    host.setAttribute("aria-label","Footer HOMS TECH");
    host.innerHTML =
      '<div class="ht-footer-grid ht-footer-grid--unified">'+
      '<section class="ht-footer-brand"><a class="ht-footer-logo" href="index.html" aria-label="HOMS TECH – Home">HOMS <span>TECH</span></a>'+
      '<p>'+esc(description)+'</p>'+(area?'<p class="ht-footer-area"><span aria-hidden="true">⌖</span> '+esc(area)+'</p>':'')+(hours?'<p class="ht-footer-hours"><span aria-hidden="true">◷</span> '+esc(hours)+'</p>':'')+
      '<a class="ht-footer-cta" href="contact.html">Neem contact op <span aria-hidden="true">→</span></a></section>'+
      '<nav aria-label="Over ons"><h2>Over ons</h2><ul>'+list(groups.about)+'</ul></nav>'+
      '<nav aria-label="Onze diensten"><h2>Onze diensten</h2><ul>'+list(groups.services)+'</ul></nav>'+
      '<nav aria-label="Service en contact"><h2>Service & contact</h2><ul>'+list(groups.help)+
      (contacts.length?contacts.join(""):'<li><a href="contact.html">Contactgegevens en openingstijden</a></li>')+
      '</ul></nav></div><div class="ht-footer-bottom"><span>© '+year+' HOMS TECH. Alle rechten voorbehouden.</span><span>Refurbished · Reparatie · Service</span></div>';
    host.querySelector("[data-footer-cookie-settings]")?.addEventListener("click",event=>{
      event.preventDefault();
      const button=document.getElementById("homs-cookie-settings");
      if(button)button.click();else window.location.href="privacybeleid.html";
    });
  }
  async function init() {
    installFooterStyles();
    const hosts=[...document.querySelectorAll("footer")].filter(host=>!host.closest("#homs-cookie-banner"));
    if(!hosts.length)return;

    // Replace legacy markup immediately; never wait for the settings API before
    // showing the unified footer. This removes the visible old-to-new flash.
    const originals=hosts.map(host=>({
      host,
      html:host.innerHTML,
      className:host.className,
      ariaLabel:host.getAttribute("aria-label")
    }));
    hosts.forEach(host=>render(host,{},{}));

    try {
      const response=await fetch("/api/site",{headers:{Accept:"application/json"},cache:"no-store"});
      if(!response.ok)throw new Error("HTTP "+response.status);
      const data=await response.json();
      const site={...data,homepage:data.homepage||{}};
      const settings=site.homepage?.footer||{};
      if(settings.enabled===false){
        // Respect the administrator's disabled setting without leaving a
        // temporary generated footer behind.
        originals.forEach(({host,html,className,ariaLabel})=>{
          host.innerHTML=html;
          host.className=className;
          if(ariaLabel===null)host.removeAttribute("aria-label");
          else host.setAttribute("aria-label",ariaLabel);
        });
        return;
      }
      hosts.forEach(host=>render(host,settings,site));
    } catch(error) {
      // The immediate, lightweight footer remains usable if the API is slow
      // or temporarily unavailable.
      console.warn("[HOMS TECH] Footer settings unavailable; using defaults",error);
    }
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();
