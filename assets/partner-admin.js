"use strict";
(function(){
  let partners=[], selectedPartnerId=null, priceItems=[], partnerOrders=[];
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  const money=value=>new Intl.NumberFormat("nl-NL",{style:"currency",currency:"EUR"}).format(Number(value)||0);
  async function request(url,options={}){
    const response=await fetch(url,{credentials:"same-origin",cache:"no-store",...options,headers:{Accept:"application/json",...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||"De aanvraag is mislukt.");
    return data;
  }
  function status(id,message,type="info"){
    const node=$(id);if(!node)return;
    node.className="status "+type;node.textContent=message;
  }
  window.loadPartnersAdmin=async function(){
    const list=$("partnerList");if(!list)return;
    list.textContent="Partners laden…";
    try{
      const data=await request("/api/admin/partners");
      partners=Array.isArray(data.partners)?data.partners:[];
      $("partnerCount").textContent=String(partners.length);
      renderPartners();
      await loadPartnerOrders();
      if(selectedPartnerId&&partners.some(p=>Number(p.id)===Number(selectedPartnerId)))await selectPartner(selectedPartnerId,true);
      else if(partners.length)await selectPartner(partners[0].id,true);
      else{$("partnerPriceTitle").textContent="Selecteer een partner";$("partnerPricePanel").textContent="Maak eerst een partner aan.";}
    }catch(error){list.textContent=error.message;status("partnerCreateStatus",error.message,"error");}
  };
  function renderPartners(){
    const list=$("partnerList");if(!list)return;
    if(!partners.length){list.innerHTML='<p class="ht-partner-empty">Nog geen partners aangemaakt.</p>';return;}
    list.innerHTML=partners.map(p=>'<article class="ht-partner-row '+(Number(p.id)===Number(selectedPartnerId)?"is-selected":"")+'"><button class="ht-partner-select" type="button" onclick="selectPartner('+Number(p.id)+')"><strong>'+esc(p.name)+'</strong><span>'+esc(p.email||"Geen e-mailadres")+'</span><small>Partner #'+Number(p.id)+' · '+(p.active?"Actief":"Uitgeschakeld")+'</small></button><button class="btn btn-light ht-partner-toggle" type="button" onclick="togglePartner('+Number(p.id)+')">'+(p.active?"Uitschakelen":"Activeren")+'</button></article>').join("");
  }
  window.selectPartner=async function(id,silent=false){
    const partner=partners.find(p=>Number(p.id)===Number(id));if(!partner)return;
    selectedPartnerId=Number(id);renderPartners();
    $("partnerPriceTitle").textContent=partner.name+" · Groothandelsprijzen";
    const panel=$("partnerPricePanel");panel.textContent="Productcatalogus laden…";
    try{
      const data=await request("/api/admin/partners/"+selectedPartnerId+"/prices");
      priceItems=Array.isArray(data.items)?data.items:[];
      renderPartnerPrices();
    }catch(error){panel.textContent=error.message;if(!silent)status("partnerCreateStatus",error.message,"error");}
  };
  function renderPartnerPrices(){
    const panel=$("partnerPricePanel");
    if(!priceItems.length){panel.innerHTML='<p class="ht-partner-empty">Geen actieve telefoonuitvoeringen gevonden in de catalogus.</p>';return;}
    const rows=priceItems.map((item,index)=>{
      const variant=[item.storage,item.color,item.condition].filter(Boolean).join(" · ")||"Standaard uitvoering";
      const assigned=item.wholesalePrice!==null&&item.wholesalePrice!==undefined;
      return '<tr data-partner-price-row data-index="'+index+'"><td><label class="ht-partner-assignment"><input type="checkbox" data-assigned '+(assigned?"checked":"")+' aria-label="Uitvoering beschikbaar maken voor partner"><span><strong>'+esc(item.name)+'</strong><small>'+esc(variant)+(item.sku?" · "+esc(item.sku):"")+'</small></span></label></td><td>'+ (item.stock===null?"—":Number(item.stock)) +'</td><td><label class="ht-partner-price-input"><span>€</span><input type="number" min="0" max="100000" step="0.01" data-wholesale-price value="'+(assigned?esc(item.wholesalePrice):"")+'" placeholder="Niet ingesteld" aria-label="Groothandelsprijs"></label></td></tr>';
    }).join("");
    panel.innerHTML='<div class="ht-partner-price-toolbar"><label>Zoeken <input id="partnerPriceSearch" type="search" placeholder="Model, kleur, opslag…" oninput="filterPartnerPriceRows()"></label><span>'+priceItems.length+' uitvoeringen</span></div><div class="ht-partner-table-wrap"><table class="ht-partner-table"><thead><tr><th>Telefoon / uitvoering</th><th>Voorraad</th><th>Groothandel</th></tr></thead><tbody>'+rows+'</tbody></table></div><div class="ht-partner-save-row"><span>Alleen aangevinkte regels worden aan deze partner aangeboden.</span><button class="btn btn-green" type="button" onclick="savePartnerPrices()">💾 Prijzen opslaan</button></div><p id="partnerPriceStatus" class="status" role="status"></p>';
  }
  window.filterPartnerPriceRows=function(){
    const query=String($("partnerPriceSearch")?.value||"").trim().toLowerCase();
    document.querySelectorAll("[data-partner-price-row]").forEach(row=>{row.hidden=!row.textContent.toLowerCase().includes(query);});
  };
  window.savePartnerPrices=async function(){
    if(!selectedPartnerId)return;
    const prices=[];
    try{
      for(const row of document.querySelectorAll("[data-partner-price-row]")){
        const item=priceItems[Number(row.dataset.index)];
        if(!item||!row.querySelector("[data-assigned]")?.checked)continue;
        const raw=row.querySelector("[data-wholesale-price]")?.value;
        const value=Number(raw);
        if(raw===""||!Number.isFinite(value)||value<0)throw new Error("Vul voor iedere aangevinkte uitvoering een geldige groothandelsprijs in.");
        prices.push({productId:item.productId,variantKey:item.variantKey,wholesalePrice:value});
      }
    }catch(error){status("partnerPriceStatus",error.message,"error");return;}
    const button=document.querySelector("#partnerPricePanel .ht-partner-save-row button");
    try{
      if(button){button.disabled=true;button.textContent="Opslaan…";}
      await request("/api/admin/partners/"+selectedPartnerId+"/prices",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({prices})});
      await selectPartner(selectedPartnerId,true);
      status("partnerPriceStatus","✓ "+prices.length+" groothandelsprijzen opgeslagen.","success");
    }catch(error){status("partnerPriceStatus",error.message,"error");}
    finally{if(button){button.disabled=false;button.textContent="💾 Prijzen opslaan";}}
  };
  window.togglePartner=async function(id){
    const partner=partners.find(p=>Number(p.id)===Number(id));if(!partner)return;
    try{
      const data=await request("/api/admin/partners/"+id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({active:!partner.active})});
      partners=partners.map(p=>Number(p.id)===Number(id)?data.partner:p);renderPartners();
      status("partnerCreateStatus",partner.active?"Partner is uitgeschakeld.":"Partner is geactiveerd.","success");
    }catch(error){status("partnerCreateStatus",error.message,"error");}
  };
  let freshApiKey="";
  window.copyPartnerApiKey=async function(){
    if(!freshApiKey)return;
    try{await navigator.clipboard.writeText(freshApiKey);status("partnerCreateStatus","API-sleutel gekopieerd. Bewaar hem veilig; hij wordt niet opnieuw getoond.","success");}
    catch{status("partnerCreateStatus","Kopiëren is niet gelukt. Selecteer de sleutel en kopieer hem handmatig.","error");}
  };
  $("partnerCreateForm")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const button=event.currentTarget.querySelector("button[type=submit]");
    try{
      button.disabled=true;
      const data=await request("/api/admin/partners",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:$("partnerNewName").value.trim(),email:$("partnerNewEmail").value.trim()})});
      freshApiKey=data.apiKey||"";
      $("partnerNewApiKey").textContent=freshApiKey;
      $("partnerKeyReveal").hidden=!freshApiKey;
      $("partnerNewName").value="";$("partnerNewEmail").value="";
      status("partnerCreateStatus","Partner aangemaakt. Kopieer de API-sleutel nu; later is deze niet meer zichtbaar.","success");
      await loadPartnersAdmin();
      if(data.partner?.id)await selectPartner(data.partner.id,true);
    }catch(error){status("partnerCreateStatus",error.message,"error");}
    finally{button.disabled=false;}
  });
  const orderStatuses=["Nieuw","In behandeling","Goedgekeurd","Afgewezen","Verzonden","Afgerond"];
  window.loadPartnerOrders=async function(){
    const box=$("partnerOrdersList");if(!box)return;
    box.textContent="Bestellingen laden…";
    try{
      const data=await request("/api/admin/partner-orders");partnerOrders=Array.isArray(data.orders)?data.orders:[];
      renderPartnerOrders();status("partnerOrdersStatus",partnerOrders.length+" partnerbestellingen geladen.","success");
    }catch(error){box.textContent=error.message;status("partnerOrdersStatus",error.message,"error");}
  };
  function renderPartnerOrders(){
    const box=$("partnerOrdersList");
    if(!partnerOrders.length){box.innerHTML='<p class="ht-partner-empty">Er zijn nog geen partnerbestellingen ontvangen.</p>';return;}
    box.innerHTML=partnerOrders.map(order=>{
      const address=order.shipping_address||{};
      const items=Array.isArray(order.items)?order.items:[];
      const lines=items.map(item=>'<li><strong>'+esc(item.name)+'</strong> · '+esc([item.storage,item.color,item.condition].filter(Boolean).join(" / "))+' · '+Number(item.quantity||0)+' × '+money(item.wholesaleUnitPrice)+' = '+money(item.lineTotal)+'</li>').join("");
      return '<article class="ht-partner-order"><div class="ht-partner-order-head"><div><strong>Bestelling #'+Number(order.id)+' · '+esc(order.partner_name)+'</strong><small>'+esc(new Date(order.created_at).toLocaleString("nl-NL"))+' · '+esc(order.status)+'</small></div><strong>'+money(order.wholesale_total)+'</strong></div><div class="ht-partner-customer"><div><b>Klant</b><span>'+esc(order.customer_name)+'</span><a href="mailto:'+esc(order.customer_email)+'">'+esc(order.customer_email)+'</a><a href="tel:'+esc(order.customer_phone)+'">'+esc(order.customer_phone)+'</a></div><div><b>Verzendadres</b><span>'+esc([address.street,address.houseNumber].filter(Boolean).join(" "))+'</span><span>'+esc([address.postcode,address.city].filter(Boolean).join(" "))+'</span><span>'+esc(address.country||"")+'</span></div></div><ul class="ht-partner-order-items">'+lines+'</ul><div class="ht-partner-order-edit"><label>Status<select data-order-status="'+Number(order.id)+'">'+orderStatuses.map(s=>'<option value="'+s+'" '+(order.status===s?"selected":"")+'>'+s+'</option>').join("")+'</select></label><label>Interne notitie<textarea data-order-note="'+Number(order.id)+'" rows="2" maxlength="1000">'+esc(order.admin_note||"")+'</textarea></label><button class="btn btn-green" type="button" onclick="savePartnerOrder('+Number(order.id)+')">Status en notitie opslaan</button></div></article>';
    }).join("");
  }
  window.savePartnerOrder=async function(id){
    const statusSelect=document.querySelector('[data-order-status="'+id+'"]');
    const note=document.querySelector('[data-order-note="'+id+'"]');
    try{
      await request("/api/admin/partner-orders/"+id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:statusSelect?.value,adminNote:note?.value||""})});
      status("partnerOrdersStatus","✓ Bestelling #"+id+" bijgewerkt.","success");await loadPartnerOrders();
    }catch(error){status("partnerOrdersStatus",error.message,"error");}
  };
})();
