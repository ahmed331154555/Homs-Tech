(() => {
  "use strict";
  const currentYear = new Date().getFullYear();
  const clean = value => String(value ?? "").trim();
  const digits = value => clean(value).replace(/\D/g, "");
  const safeHref = value => /^(https?:|mailto:|tel:)/i.test(String(value || "")) ? String(value) : "";
  const links = {
    start: [["Home","index.html"],["Over HOMS TECH","about.html"],["Contact","contact.html"]],
    services: [["Telefoons bekijken","devices.html"],["Telefoon repareren","repair.html"],["Uw toestel verkopen","uw-toestel-verkopen.html"],["Reparatieprijzen","prices.html"],["Klantbeoordelingen","reviews.html"]],
    service: [["Garantie & voorwaarden","about.html"],["Privacybeleid","privacybeleid.html"],["Cookie-instellingen","#cookie-settings"]]
  };
  const linkList = items => items.map(([label,url]) =>
    '<li><a href="'+url+'"'+(url==="#cookie-settings"?' data-footer-cookie-settings':'')+'>'+label+'</a></li>'
  ).join("");
  function render(host, settings, site) {
    const footer = settings || {};
    const description = clean(footer.description) || "Refurbished apparaten · Telefoonreparatie · Service";
    const area = clean(footer.area || site.areas);
    const email = clean(footer.email);
    const phone = clean(footer.phone || site.phone);
    const whatsapp = clean(footer.whatsapp || site.whatsapp);
    const emailLink = email ? '<a href="mailto:'+encodeURIComponent(email)+'">'+email+'</a>' : "";
    const phoneLink = phone ? '<a href="tel:'+phone.replace(/[^+\d]/g,"")+'">'+phone+'</a>' : "";
    const waDigits = digits(whatsapp);
    const waLink = waDigits ? '<a href="https://wa.me/'+waDigits+'" target="_blank" rel="noopener noreferrer">Stuur ons een WhatsApp</a>' : "";
    const contactItems = [emailLink,phoneLink,waLink].filter(Boolean);
    host.className = (host.className || "").replace(/\bht-site-footer\b/g,"").trim();
    host.classList.add("ht-site-footer","ht-site-footer--unified");
    host.setAttribute("aria-label","Footer HOMS TECH");
    host.innerHTML =
      '<div class="ht-footer-grid ht-footer-grid--unified">' +
        '<section class="ht-footer-brand"><a class="ht-footer-logo" href="index.html" aria-label="HOMS TECH – Home">HOMS <span>TECH</span></a>' +
          '<p>'+description+'</p>'+(area?'<p class="ht-footer-area"><span aria-hidden="true">⌖</span> '+area+'</p>':'')+
          '<a class="ht-footer-cta" href="contact.html">Neem contact op <span aria-hidden="true">→</span></a></section>' +
        '<nav aria-label="Start"><h2>Over ons</h2><ul>'+linkList(links.start)+'</ul></nav>' +
        '<nav aria-label="Onze diensten"><h2>Onze diensten</h2><ul>'+linkList(links.services)+'</ul></nav>' +
        '<nav aria-label="Service en contact"><h2>Service & contact</h2><ul>'+linkList(links.service)+
          (contactItems.length?contactItems.map((item)=>'<li class="ht-footer-contact-link">'+item+'</li>').join(""):'<li><a href="contact.html">Contactgegevens en openingstijden</a></li>')+
        '</ul></nav>' +
      '</div><div class="ht-footer-bottom"><span>© '+currentYear+' HOMS TECH. Alle rechten voorbehouden.</span><span>Refurbished · Reparatie · Service</span></div>';
    host.querySelector("[data-footer-cookie-settings]")?.addEventListener("click",event=>{
      event.preventDefault();
      const button=document.getElementById("homs-cookie-settings");
      if(button)button.click();
      else window.location.href="privacybeleid.html";
    });
  }
  async function init() {
    const hosts=[...document.querySelectorAll("footer")].filter(host=>!host.closest("#homs-cookie-banner"));
    if(!hosts.length)return;
    let site={};
    try{
      const response=await fetch("/api/site",{headers:{Accept:"application/json"}});
      if(response.ok){const data=await response.json();site={...data,homepage:data.homepage||{}};}
    }catch(error){console.warn("[HOMS TECH] Footer contact settings unavailable",error);}
    const settings=site.homepage?.footer||{};
    if(settings.enabled===false)return;
    hosts.forEach(host=>render(host,settings,site));
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();