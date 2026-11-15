(() => {
  "use strict";
  const year = new Date().getFullYear();
  const clean = value => String(value ?? "").trim();
  const esc = value => clean(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const digits = value => clean(value).replace(/\D/g, "");
  const groups = {
    about: [["Home","index.html"],["Over HOMS TECH","about.html"],["Contact","contact.html"]],
    services: [["Telefoons bekijken","devices.html"],["Telefoon repareren","repair.html"],["Uw toestel verkopen","uw-toestel-verkopen.html"],["Reparatieprijzen","prices.html"],["Klantbeoordelingen","reviews.html"]],
    help: [["Garantie & voorwaarden","about.html"],["Privacybeleid","privacybeleid.html"],["Cookie-instellingen","#cookie-settings"]]
  };
  const list = items => items.map(([label,url]) => '<li><a href="'+url+'"'+(url==="#cookie-settings"?' data-footer-cookie-settings':'')+'>'+label+'</a></li>').join("");
  function render(host, settings, site) {
    const description = clean(settings.description) || "Refurbished apparaten · Telefoonreparatie · Service";
    const area = clean(settings.area || site.areas);
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
      '<p>'+esc(description)+'</p>'+(area?'<p class="ht-footer-area"><span aria-hidden="true">⌖</span> '+esc(area)+'</p>':'')+
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
    const hosts=[...document.querySelectorAll("footer")].filter(host=>!host.closest("#homs-cookie-banner"));
    if(!hosts.length)return;
    let site={};
    try {
      const response=await fetch("/api/site",{headers:{Accept:"application/json"}});
      if(response.ok){const data=await response.json();site={...data,homepage:data.homepage||{}};}
    } catch(error) { console.warn("[HOMS TECH] Footer settings unavailable",error); }
    const settings=site.homepage?.footer||{};
    if(settings.enabled===false)return;
    hosts.forEach(host=>render(host,settings,site));
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();
