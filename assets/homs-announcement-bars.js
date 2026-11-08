(function(){
"use strict";
var path=(location.pathname||"/").toLowerCase().replace(/\/+$/,"")||"/";
var page=path==="/"||path.endsWith("/index.html")?"home":path.endsWith("/about.html")?"about":path.endsWith("/devices.html")?"devices":path.endsWith("/product.html")?"product":path.endsWith("/repair.html")?"repair":path.endsWith("/uw-toestel-verkopen.html")?"sell":path.endsWith("/prices.html")?"prices":path.endsWith("/shop.html")?"shop":path.endsWith("/account.html")?"account":path.endsWith("/cart.html")?"cart":path.endsWith("/checkout.html")?"checkout":path.endsWith("/contact.html")?"contact":path.endsWith("/payment.html")?"payment":path.endsWith("/privacybeleid.html")?"privacy":path.endsWith("/design-preview.html")?"design":"home";
function color(v,f){return /^#[0-9a-f]{6}$/i.test(String(v||""))?v:f}
function render(c){
 if(!c||c.enabled===false)return;
 var messages=Array.isArray(c.messages)?c.messages.map(function(x){return String(x||"").trim().slice(0,120)}).filter(Boolean).slice(0,8):[];
 if(!messages.length)return;
 document.querySelectorAll(".ht-topbar,.topbar").forEach(function(el){el.style.setProperty("display","none","important")});
 var old=document.getElementById("homsManagedAnnouncementBar");if(old)old.remove();
 var bg=color(c.background,"#071d2d"),fg=color(c.textColor,"#eaf4ff"),accent=color(c.accentColor,"#60a5fa");
 var height=Math.max(30,Math.min(64,Number(c.height)||42)),font=Math.max(10,Math.min(22,Number(c.fontSize)||14));
 var bar=document.createElement("div");bar.id="homsManagedAnnouncementBar";bar.setAttribute("role","region");bar.setAttribute("aria-label","HOMS TECH mededelingen");
 bar.style.cssText="height:"+height+"px;min-height:"+height+"px;width:100%;overflow:hidden;background:"+bg+";color:"+fg+";display:flex;align-items:center;position:relative;z-index:10000;box-sizing:border-box";
 var inner=document.createElement("div");inner.style.cssText="width:100%;height:100%;overflow:hidden;display:flex;align-items:center";
 var track=document.createElement("div");track.style.cssText="display:flex;align-items:center;gap:44px;width:max-content;white-space:nowrap;will-change:transform;flex:0 0 auto";
 function addMessages(){messages.forEach(function(message){var item=document.createElement("span");item.style.cssText="display:inline-flex;align-items:center;gap:8px;font-size:"+font+"px;font-weight:800;letter-spacing:.1px;color:"+fg+";white-space:nowrap";var mark=document.createElement("b");mark.textContent="✓";mark.style.color=accent;item.appendChild(mark);item.appendChild(document.createTextNode(message));track.appendChild(item)})}
 addMessages();
 var moving=c.mode!=="static"&&window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
 if(moving){
  addMessages();inner.appendChild(track);bar.appendChild(inner);
  var direction=c.direction==="ltr"?1:-1,speed=Math.max(20,Math.min(600,Number(c.speed)||140));
  requestAnimationFrame(function(){var distance=track.scrollWidth/2,duration=Math.max(3,distance/speed);track.animate(direction<0?[{transform:"translate3d(0,0,0)"},{transform:"translate3d(-"+distance+"px,0,0)"}]:[{transform:"translate3d(-"+distance+"px,0,0)"},{transform:"translate3d(0,0,0)"}],{duration:duration*1000,iterations:Infinity,easing:"linear"})});
 }else{
  inner.style.justifyContent="center";inner.style.padding="0 12px";track.style.width="100%";track.style.justifyContent="center";track.style.flexWrap="wrap";track.style.whiteSpace="normal";track.style.gap="8px 24px";
  messages.forEach(function(message){var item=document.createElement("span");item.style.cssText="font-size:"+font+"px;font-weight:800;color:"+fg+";white-space:nowrap";item.textContent=message;track.appendChild(item)});
  inner.appendChild(track);bar.appendChild(inner);
 }
 var header=document.querySelector(".ht-header,header");if(header&&header.parentNode)header.parentNode.insertBefore(bar,header);else document.body.insertBefore(bar,document.body.firstChild);
}
fetch("/api/announcement-bars?page="+encodeURIComponent(page),{cache:"no-store",credentials:"same-origin"}).then(function(r){return r.ok?r.json():null}).then(function(d){if(d&&d.settings)render(d.settings)}).catch(function(){});
})();