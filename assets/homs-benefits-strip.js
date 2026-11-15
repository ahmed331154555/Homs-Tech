(function () {
  "use strict";
  if (document.getElementById("homs-benefits-strip")) return;
  const defaults = {enabled:true,items:["Snelle service","Betrouwbaar","Aan huis","Betaalbare prijzen"],background:"#ffffff",textColor:"#334155",accentColor:"#2563eb",speed:90,direction:"rtl",mode:"scroll",fontSize:16,fontWeight:"700",fontStyle:"normal",height:84};
  const color = (v,f) => /^#[0-9a-f]{6}$/i.test(String(v||"")) ? v : f;
  function normalize(raw) {
    const v=raw&&typeof raw==="object"?raw:{};
    const items=Array.isArray(v.items)?v.items.map(x=>String(x||"").trim().slice(0,100)).filter(Boolean).slice(0,10):defaults.items;
    return {...defaults,...v,items:items.length?items:defaults.items,background:color(v.background,defaults.background),textColor:color(v.textColor,defaults.textColor),accentColor:color(v.accentColor,defaults.accentColor),speed:Math.max(20,Math.min(500,Number(v.speed)||90)),direction:v.direction==="ltr"?"ltr":"rtl",mode:v.mode==="static"?"static":"scroll",fontSize:Math.max(11,Math.min(24,Number(v.fontSize)||16)),fontWeight:["400","500","600","700","800"].includes(String(v.fontWeight))?String(v.fontWeight):"700",fontStyle:v.fontStyle==="italic"?"italic":"normal",height:Math.max(48,Math.min(120,Number(v.height)||84))};
  }
  function render(raw) {
    const s=normalize(raw);
    const old=document.getElementById("homs-benefits-strip"); if(old)old.remove();
    if(!s.enabled||!s.items.length)return;
    const bar=document.createElement("section");bar.id="homs-benefits-strip";bar.setAttribute("aria-label","Voordelen van HOMS TECH");
    bar.style.cssText="width:100%;min-height:"+s.height+"px;display:flex;align-items:center;overflow:hidden;box-sizing:border-box;background:"+s.background+";color:"+s.textColor+";border-top:1px solid #e8edf3;border-bottom:1px solid #e8edf3";
    const viewport=document.createElement("div");viewport.style.cssText="width:100%;overflow:hidden;display:flex;align-items:center";
    const track=document.createElement("div");track.style.cssText="display:flex;align-items:center;flex:0 0 auto;width:max-content";
    const group=document.createElement("div");group.style.cssText="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:center;gap:22px 42px;padding:16px 28px;white-space:nowrap;flex:0 0 auto";
    s.items.forEach(label=>{const item=document.createElement("span");item.style.cssText="display:inline-flex;align-items:center;gap:12px;white-space:nowrap;font-size:"+s.fontSize+"px;font-weight:"+s.fontWeight+";font-style:"+s.fontStyle;
      const icon=document.createElement("span");icon.textContent="✓";icon.setAttribute("aria-hidden","true");icon.style.cssText="width:42px;height:42px;flex:0 0 42px;display:inline-flex;align-items:center;justify-content:center;border-radius:14px;background:#eaf2ff;color:"+s.accentColor+";font-size:27px;font-weight:800";
      const text=document.createElement("span");text.textContent=label;item.append(icon,text);group.appendChild(item);});
    track.appendChild(group);
    if(s.mode==="scroll"){const clone=group.cloneNode(true);clone.setAttribute("aria-hidden","true");track.appendChild(clone);}
    else{track.style.width="100%";track.style.justifyContent="center";group.style.whiteSpace="normal";group.style.gridTemplateColumns="repeat(auto-fit,minmax(180px,1fr))";group.style.width="100%";group.style.boxSizing="border-box";}
    viewport.appendChild(track);bar.appendChild(viewport);
    const header=document.querySelector(".ht-header,header");
    if(header&&header.parentNode)header.parentNode.insertBefore(bar,header);else document.body.insertBefore(bar,document.body.firstChild);
    if(s.mode==="scroll"&&!window.matchMedia("(prefers-reduced-motion: reduce)").matches){
      requestAnimationFrame(()=>{const distance=group.getBoundingClientRect().width;if(!distance)return;const needed=viewport.clientWidth+distance;while(track.scrollWidth<needed){const c=group.cloneNode(true);c.setAttribute("aria-hidden","true");track.appendChild(c);}
        const from=s.direction==="rtl"?0:-distance,to=s.direction==="rtl"?-distance:0;
        track.animate([{transform:"translate3d("+from+"px,0,0)"},{transform:"translate3d("+to+"px,0,0)"}],{duration:Math.max(3,distance/s.speed)*1000,iterations:Infinity,easing:"linear"});
      });
    }
  }
  fetch("/api/benefits-strip",{cache:"no-store",credentials:"same-origin",headers:{Accept:"application/json"}}).then(r=>{if(!r.ok)throw new Error("HTTP "+r.status);return r.json();}).then(d=>render(d&&d.settings)).catch(e=>console.error("[HOMS TECH] Benefits strip failed:",e));
})();
