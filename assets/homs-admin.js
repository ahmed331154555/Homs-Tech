

let data = {};
let loading = false;
let autoSaveTimer = null;
let autoSaveAgain = false;
let currentPage = (()=>{try{return localStorage.getItem("homsAdminCurrentPage")||"general";}catch{return "general";}})();
let currentUser = {username:"",role:"admin",permissions:[]};
let selectedBuybackBrandId = "";
let buybackSearch = "";
let buybackAdminLevel = "brands"; // V2: brands -> models -> editor (internal types preserved)
let selectedBuybackTypeId = "";
let selectedBuybackModelId = "";
let buybackOptionsOpen = false;
let buybackTypeSettingsOpen = false;
let buybackQuestionOpenId = "";
let buybackCatalogDeleteLock = false;
const deletingBuybackOrderIds = new Set();
const deletingWebshopOrderIds = new Set();

const PAGE_PERMISSIONS = {
  "all-orders":"orders.view","live-chat":"orders.view",
  general:"general.view",services:"services.view",repair:"site.save",phones:"phones.view",shop:"site.save",categories:"categories.view",
why:"why.view",customers:"customers.view",orders:"orders.view","repair-requests":"orders.view",
  "webshop-orders":"webshop_orders.view","invoices":"site.save","order-settings":"site.save",search:"search",admins:"admins.manage",
  buyback:"buyback.view", "buyback-orders":"buyback_orders.view", inventory:"site.save", "device-register":"device_register.view", emails:"site.save"
};

const ADMIN_PERMISSION_LABELS = {
  "general.view":"Algemeen bekijken","services.view":"Diensten bekijken",
  "phones.view":"Telefoons & prijzen bekijken","phones.update":"Telefoons & prijzen wijzigen","categories.view":"Apparaten & categorieën bekijken",
"why.view":"Waarom HOMS TECH bekijken",
  "customers.view":"Klanten bekijken","customers.update":"Klanten aanmaken en wijzigen","customers.delete":"Klanten verwijderen","orders.view":"Reparatieaanvragen bekijken","orders.update":"Reparatieaanvraag-status wijzigen",
  "webshop_orders.view":"Webshop bestellingen bekijken","webshop_orders.update":"Webshop order-status wijzigen","webshop_orders.delete":"Webshop bestellingen verwijderen",
  "orders.delete":"Reparatieaanvragen verwijderen",
  "device_register.view":"Toestelregister bekijken","device_register.update":"Toestelregister wijzigen",
  "buyback.view":"Inkooptelefoons bekijken","buyback.update":"Inkooptelefoons wijzigen",
  "buyback_orders.view":"Verkoopaanvragen bekijken","buyback_orders.update":"Verkoopaanvraag-status wijzigen","buyback_orders.delete":"Verkoopaanvragen verwijderen",
  "repair_page.view":"Reparatiepagina bekijken","repair_page.update":"Reparatiepagina wijzigen","site.save":"Websitegegevens opslaan","search":"Admin zoeken","admins.manage":"Admins beheren"
};

function hasPermission(p){return currentUser.role==="superadmin"||currentUser.permissions.includes("*")||currentUser.permissions.includes(p)||(["buyback_orders.delete","webshop_orders.delete"].includes(p)&&currentUser.permissions.includes("site.save"));}
function canEditSite(){return hasPermission("site.save");}
function canEditCurrentPage(){
  if(currentPage==="phones") return hasPermission("phones.update") || canEditSite();
  if(currentPage==="shop") return canEditSite();
  if(currentPage==="repair") return hasPermission("repair_page.update") || canEditSite();
  if(currentPage==="device-register") return hasPermission("device_register.update");
  return canEditSite();
}
function firstAllowedPage(){
  const pages=["general","services","repair","phones","shop","buyback","buyback-orders","categories","why","customers","orders","repair-requests","webshop-orders","emails","invoices","inventory","device-register","search","admins"];
  return pages.find(p=>hasPermission(PAGE_PERMISSIONS[p]))||null;
}
function applyPermissionUI(){
  document.querySelectorAll("[data-permission]").forEach(el=>el.style.display=hasPermission(el.dataset.permission)?"":"none");
  const saveBtn=document.getElementById("saveBtn"); if(saveBtn) saveBtn.style.display=canEditCurrentPage()?"":"none";
  document.querySelectorAll(".admin-page").forEach(page=>{
    const n=(page.id||"").replace(/^page-/,"");
    if(!["general","services","repair","phones","buyback","categories","why"].includes(n))return;
    page.querySelectorAll("input,textarea").forEach(el=>el.disabled=!canEditCurrentPage());
    page.querySelectorAll("button").forEach(btn=>{
      if(!btn.classList.contains("nav-btn")&&!/Vernieuwen|↻/.test(btn.textContent||""))btn.disabled=!canEditCurrentPage();
    });
  });
  document.querySelectorAll(".order-status-select").forEach(el=>{const section=el.closest("[data-order-category]");const key=section?.dataset.orderCategory;const category=unifiedOrderCategories.find(item=>item.key===key);const permission=category?.updatePermission||(el.closest("#page-repair-requests")?"orders.update":"webshop_orders.update");el.disabled=!hasPermission(permission);});
}
let liveChatCurrentId=null,liveChatRefreshTimer=null;
function liveChatEsc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\'/g,"&#39;");}
async function loadLiveChat(){const list=document.getElementById("liveChatList");if(!list)return;try{const r=await fetch("/api/admin/live-chat",{credentials:"same-origin",cache:"no-store"}),d=await r.json();if(!r.ok)throw Error(d.error||"Gesprekken laden mislukt");const rows=d.conversations||[];list.innerHTML=rows.length?rows.map(c=>'<button type="button" onclick="openLiveChat('+Number(c.id)+')" style="display:block;width:100%;text-align:left;padding:11px;margin-bottom:7px;border:1px solid #e2e8f0;border-radius:10px;background:'+(Number(c.id)===liveChatCurrentId?"#eff6ff":"white")+';cursor:pointer"><strong>Gesprek #'+Number(c.id)+(Number(c.unread)>0?" · 🔵 "+Number(c.unread):"")+'</strong><div style="font-size:12px;color:#64748b;margin-top:4px">'+liveChatEsc((c.last_message||"Nog geen bericht").slice(0,90))+'</div><small>'+liveChatEsc(new Date(c.updated_at).toLocaleString("nl-NL"))+" · "+(c.status==="closed"?"Gesloten":"Open")+'</small></button>').join(""):'<p style="color:#64748b;padding:12px">Nog geen chatgesprekken.</p>';if(liveChatCurrentId)await openLiveChat(liveChatCurrentId,true);}catch(e){list.textContent=e.message;}}
async function openLiveChat(id,silent){liveChatCurrentId=Number(id);try{const r=await fetch("/api/admin/live-chat/"+id+"/messages",{credentials:"same-origin",cache:"no-store"}),d=await r.json();if(!r.ok)throw Error(d.error||"Gesprek laden mislukt");document.getElementById("liveChatTitle").textContent="Gesprek #"+id+" · "+(d.conversation.status==="closed"?"Gesloten":"Open");document.getElementById("liveChatMessages").innerHTML=(d.messages||[]).map(m=>'<div style="align-self:'+(m.sender==="admin"?"flex-end":"flex-start")+' ;max-width:88%;background:'+(m.sender==="admin"?"#dcfce7":"#f1f5f9")+ ';padding:10px 12px;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere"><div>'+liveChatEsc(m.message)+'</div><small style="display:block;color:#64748b;margin-top:5px">'+(m.sender==="admin"?"Jij":"Klant")+" · "+liveChatEsc(new Date(m.created_at).toLocaleString("nl-NL"))+'</small></div>').join("");const closed=d.conversation.status==="closed";document.getElementById("liveChatReply").disabled=closed;document.querySelector("#liveChatReplyForm button").disabled=closed;const b=document.getElementById("liveChatCloseBtn");b.disabled=false;b.textContent=closed?"Gesprek heropenen":"Gesprek sluiten";b.dataset.status=closed?"open":"closed";const box=document.getElementById("liveChatMessages");box.scrollTop=box.scrollHeight;if(!silent)await refreshLiveChatListOnly();}catch(e){document.getElementById("liveChatMessages").textContent=e.message;}}
async function refreshLiveChatListOnly(){try{const r=await fetch("/api/admin/live-chat",{credentials:"same-origin",cache:"no-store"}),d=await r.json();const list=document.getElementById("liveChatList");if(r.ok)list.innerHTML=(d.conversations||[]).map(c=>'<button type="button" onclick="openLiveChat('+Number(c.id)+')" style="display:block;width:100%;text-align:left;padding:11px;margin-bottom:7px;border:1px solid #e2e8f0;border-radius:10px;background:'+(Number(c.id)===liveChatCurrentId?"#eff6ff":"white")+' ;cursor:pointer"><strong>Gesprek #'+Number(c.id)+(Number(c.unread)>0?" · 🔵 "+Number(c.unread):"")+'</strong><div style="font-size:12px;color:#64748b;margin-top:4px">'+liveChatEsc((c.last_message||"Nog geen bericht").slice(0,90))+'</div><small>'+liveChatEsc(new Date(c.updated_at).toLocaleString("nl-NL"))+" · "+(c.status==="closed"?"Gesloten":"Open")+'</small></button>').join("")||'<p style="color:#64748b;padding:12px">Nog geen chatgesprekken.</p>';}catch{}}
document.getElementById("liveChatReplyForm")?.addEventListener("submit",async e=>{e.preventDefault();if(!liveChatCurrentId)return;const input=document.getElementById("liveChatReply"),message=input.value.trim();if(!message)return;const btn=e.currentTarget.querySelector("button");btn.disabled=true;try{const r=await fetch("/api/admin/live-chat/"+liveChatCurrentId+"/messages",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({message})}),d=await r.json();if(!r.ok)throw Error(d.error||"Antwoord versturen mislukt");input.value="";await openLiveChat(liveChatCurrentId,true);await refreshLiveChatListOnly();}catch(err){alert(err.message)}finally{btn.disabled=false;}});
document.getElementById("liveChatCloseBtn")?.addEventListener("click",async e=>{if(!liveChatCurrentId)return;const status=e.currentTarget.dataset.status||"closed";const r=await fetch("/api/admin/live-chat/"+liveChatCurrentId+"/status",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})});if(r.ok){await openLiveChat(liveChatCurrentId,true);await refreshLiveChatListOnly();}});
function showPage(page){
  if(["orders","repair-requests","webshop-orders","buyback-orders"].includes(page))page="all-orders";
  const unifiedOrdersAllowed=page==="all-orders"&&(hasPermission("orders.view")||hasPermission("webshop_orders.view")||hasPermission("buyback_orders.view"));
  if(!unifiedOrdersAllowed&&!hasPermission(PAGE_PERMISSIONS[page]||""))page=firstAllowedPage();
  if(!page)return;
  currentPage=page;
  if(page!=="all-orders")document.body.classList.remove("phone-orders-page-active");
  try{localStorage.setItem("homsAdminCurrentPage",page);}catch{}
  document.querySelectorAll(".admin-page").forEach(s=>s.classList.remove("active"));
  const target=document.getElementById("page-"+page);
  if(target){
    target.classList.add("active");
    if(adminSiteDataLoaded&&adminRenderedDataPage!==page){
      renderAdminPageData(page);
      adminRenderedDataPage=page;
    }
    if(page==="customers")loadCustomers();
    if(page==="emails")loadAdminEmails();
    if(page==="invoices"){if(!document.querySelector("#invoiceLines tr"))addInvoiceLine();loadInvoices();}
    if(page==="inventory")loadInventory();
    if(page==="device-register")loadDeviceRegister();
    if(page==="live-chat"){loadLiveChat();if(liveChatRefreshTimer)clearInterval(liveChatRefreshTimer);liveChatRefreshTimer=setInterval(()=>{if(currentPage==="live-chat")loadLiveChat();},8000);}
    if(page==="all-orders"){const key=unifiedOrdersActiveKey||unifiedOrderCategories.find(item=>hasPermission(item.permission))?.key;if(key)showUnifiedOrderSection(key,true);}
    if(page==="orders"||page==="repair-requests")loadOrders();
    if(page==="webshop-orders")loadWebshopOrders();
    if(page==="order-settings")loadOrderSettings();
    if(page==="shop")loadShopVisibility();
    if(page==="buyback-orders")loadBuybackOrders();
    if(page==="admins")loadAdmins();
    }
  document.querySelectorAll(".nav-btn").forEach(b=>{const isCurrent=b.dataset.page===page;b.classList.toggle("active",isCurrent);if(isCurrent)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");});
  applyPermissionUI();
}

/* ---------------- LOGIN ---------------- */

async function loadCurrentUser(){
  const r=await fetch("/api/me",{credentials:"same-origin"});
  const x=await r.json().catch(()=>({}));
  if(!r.ok||!x.authenticated)throw new Error("Not authenticated");
  currentUser={id:x.id||null,username:x.username||"",role:x.role||"admin",permissions:Array.isArray(x.permissions)?x.permissions:[]};
}
async function checkLogin(){
  // Only a failed /api/me response means the session is invalid.
  // Errors while rendering/loading the dashboard must never send an authenticated
  // administrator back to the login screen.
  try{
    await loadCurrentUser();
  }catch(e){
    console.warn("[HOMS TECH] Session check failed:",e);
    showLogin();
    return;
  }

  try{
    showDashboard();
  }catch(e){
    console.error("[HOMS TECH] Dashboard initialization failed:",e);
    const loginStatus=document.getElementById("loginStatus");
    if(loginStatus){
      loginStatus.style.display="block";
      loginStatus.className="status error";
      loginStatus.textContent="Dashboard kon niet volledig laden. Vernieuw de pagina of controleer de browserconsole.";
    }
  }

  try{
    await loadData();
  }catch(e){
    console.error("[HOMS TECH] Initial data loading failed:",e);
  }
}
function showLogin(){
  document.getElementById("loginBox").style.display="block";
  document.getElementById("dashboard").style.display="none";
  document.getElementById("logoutBtn").style.display="none";
  document.getElementById("adminNav").style.display="none";
}
function showDashboard(){
  document.getElementById("loginBox").style.display="none";
  document.getElementById("dashboard").style.display="block";
  document.getElementById("logoutBtn").style.display="block";
  document.getElementById("adminNav").style.display="block";
  if(!hasPermission(PAGE_PERMISSIONS[currentPage]||""))currentPage=firstAllowedPage()||"general";
  // Build the unified orders workspace before the large site-catalog request.
  // This lets the selected orders tab render and fetch its own data immediately.
  try{setupUnifiedOrdersAdmin();}catch(error){console.error("[HOMS TECH] Orders workspace initialization failed:",error);}
  applyPermissionUI();showPage(currentPage);
}
async function login(){
  const username=document.getElementById("username").value.trim();
  const password=document.getElementById("password").value;
  const status=document.getElementById("loginStatus");
  status.style.display="block";
  status.className="status info";
  status.textContent="Inloggen...";
  try{
    const r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",cache:"no-store",body:JSON.stringify({username,password})});
    const x=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(x.error||("Inloggen mislukt (HTTP "+r.status+")"));
    await loadCurrentUser();
    status.className="status success";
    status.textContent="✓ Inloggen gelukt";
    showDashboard();
    await loadData();
  }catch(e){
    status.style.display="block";
    status.className="status error";
    status.textContent="✕ "+(e&&e.message?e.message:"Inloggen mislukt");
  }
}
window.login=login;

async function logout(){

  await fetch("/api/logout",{
    method:"POST"
  });

  location.reload();
}

/* ---------------- DATA ---------------- */

  function normalizePhoneOption(x, fallbackLabel, fallbackPrice, isCondition=false, phonePrice=0){
    if(typeof x === "string"){
      return isCondition
        ? {label:x, enabled:true, active:true, available:true, basePrice:Number(phonePrice||0)}
        : {label:x, enabled:true, active:true, available:true, priceDelta:0};
    }
    x=x||{};
    const active=x.active !== undefined ? x.active !== false : x.enabled !== false;
    if(isCondition){
      // New model: a condition owns the absolute base price.
      // Keep older priceDelta data compatible by converting it to phone base + delta.
      const oldDelta = Number(x.priceDelta ?? x.delta ?? x.priceAdjustment ?? x.extra ?? fallbackPrice ?? 0);
      const base = x.basePrice ?? x.conditionBasePrice ?? x.price;
      return {
        label:String(x.label || x.name || fallbackLabel || ""),
        enabled:active,
        active:active,
        available:x.available !== false,
        basePrice: Number(base !== undefined && base !== "" ? base : (Number(phonePrice||0) + oldDelta))
      };
    }
    return {
      label:String(x.label || x.name || fallbackLabel || ""),
      enabled:active,
      active:active,
      available:x.available !== false,
      priceDelta:x.priceDelta ?? x.delta ?? x.priceAdjustment ?? x.extra ?? fallbackPrice ?? 0,
      description:String(x.description || ""),
      image:String(x.image || "")
    };
  }

function handleBatteryOptionImage(event, phoneIndex, optionIndex){
  const file=event.target.files && event.target.files[0];
  if(!file)return;
  if(!file.type || !file.type.startsWith("image/")){
    alert("Kies een afbeeldingsbestand.");
    event.target.value="";
    return;
  }
  if(file.size>5*1024*1024){
    alert("De afbeelding mag maximaal 5 MB zijn.");
    event.target.value="";
    return;
  }
  const reader=new FileReader();
  reader.onload=()=>{
    const phone=data.phones && data.phones[phoneIndex];
    const option=phone && Array.isArray(phone.batteryOptions) ? phone.batteryOptions[optionIndex] : null;
    if(!option)return;
    option.image=String(reader.result||"");
    renderPhones();
    markChanged();
  };
  reader.onerror=()=>alert("De afbeelding kon niet worden gelezen. Probeer het opnieuw.");
  reader.readAsDataURL(file);
}
function removeBatteryOptionImage(phoneIndex, optionIndex){
  const phone=data.phones && data.phones[phoneIndex];
  const option=phone && Array.isArray(phone.batteryOptions) ? phone.batteryOptions[optionIndex] : null;
  if(!option)return;
  option.image="";
  renderPhones();
  markChanged();
}

function canonicalPhoneOptionLabel(key,label){
  const raw=String(label??'').trim(), low=raw.toLowerCase();
  if(key==='color'){
    if(low==='blue'||low==='blauw') return 'Blauw';
    if(low==='red'||low==='rood') return 'Rood';
    if(low==='white'||low==='wit') return 'Wit';
    if(low==='black'||low==='zwart') return 'Zwart';
  }
  if(key==='storage'){
    if(/^64\s*gb$/i.test(raw)) return '64 GB';
    if(/^128\s*gb$/i.test(raw)) return '128 GB';
    if(/^256\s*gb$/i.test(raw)) return '256 GB';
    if(/^512\s*gb$/i.test(raw)) return '512 GB';
    if(/^1\s*tb$/i.test(raw)) return '1 TB';
  }
  if(key==='vatOptions'){
    if(low.includes('zonder btw')) return 'Zonder BTW';
    if(low.includes('met btw')) return 'Met BTW';
  }
  if(key==='batteryOptions'){
    if(low.includes('nieuw')) return 'Nieuw (100%)';
    if(low.includes('standaard')) return 'Standaard';
  }
  if(key==='tradeInOptions'){
    if(low==='ja') return 'Ja';
    if(low==='nee') return 'Nee';
  }
  return raw;
}

function canonicalPhoneStorageLabel(value){
  const raw=String(value??"").trim().replace(/\s+/g," ");
  const m=raw.match(/^(\d+)\s*(GB|TB|MB)$/i);
  return m?m[1]+" "+m[2].toUpperCase():raw;
}
function canonicalPhoneVariantText(value){
  return String(value??"").trim().replace(/\s+/g," ").toLocaleLowerCase();
}
function normalizePhoneOptions(phone){
    if(phone.pricingMode!=="variant") phone.pricingMode="legacy";
    if(!Array.isArray(phone.variantPrices)) phone.variantPrices=[];
    // Normalize equivalent storage labels and collapse duplicate variant rows (e.g. "128GB" vs "128 GB").
    if(phone.pricingMode==="variant" && phone.variantPrices.length){
      const unique=new Map();
      phone.variantPrices.forEach((source)=>{
        if(!source||typeof source!=="object")return;
        const row={...source,storage:canonicalPhoneStorageLabel(source.storage)};
        const key=JSON.stringify([canonicalPhoneVariantText(row.condition),canonicalPhoneVariantText(row.color),canonicalPhoneVariantText(row.storage)]);
        const previous=unique.get(key);
        if(!previous){unique.set(key,row);return;}
        const prevHasPrice=previous.price!==""&&previous.price!==null&&previous.price!==undefined&&Number(previous.price)>0;
        const rowHasPrice=row.price!==""&&row.price!==null&&row.price!==undefined&&Number(row.price)>0;
        const chosen=rowHasPrice&&!prevHasPrice?row:previous;
        unique.set(key,{...previous,...row,...chosen,
          storage:canonicalPhoneStorageLabel(chosen.storage),
          stock:Math.max(0,Number(previous.stock||0),Number(row.stock||0)),
          active:previous.active!==false||row.active!==false,
          available:previous.available!==false||row.available!==false
        });
      });
      phone.variantPrices=[...unique.values()];
    }
    const defaults={
      conditionOptions:[],
      storageOptions:[],
      colorOptions:[],
      batteryOptions:[
        {label:"Standaard",enabled:true,active:true,available:true,priceDelta:0},
        {label:"Nieuw (100%)",enabled:true,active:true,available:true,priceDelta:30}
      ],
      vatOptions:[
        {label:"Zonder BTW",enabled:true,active:true,available:true,priceDelta:0},
        {label:"Met BTW",enabled:true,active:true,available:true,priceDelta:10}
      ],
      tradeInOptions:[
        {label:"Nee",enabled:true,active:true,available:true,priceDelta:0},
        {label:"Ja",enabled:true,active:true,available:true,priceDelta:0}
      ]
    };
    Object.keys(defaults).forEach(key=>{
      const incoming=Array.isArray(phone[key]) ? phone[key] : [];
      const normalized=incoming.map((x,i)=>{
        const d=defaults[key][i] || (key==='conditionOptions' ? {basePrice:Number(phone.price||0)} : {priceDelta:0});
        const n=normalizePhoneOption(x,d.label,d.priceDelta,key==='conditionOptions',Number(phone.price||0));
        n.label=canonicalPhoneOptionLabel(key,n.label);
        if(key==='conditionOptions' && n.basePrice===undefined) n.basePrice=Number(phone.price||0);
        if(key==='batteryOptions') n.priceDelta=String(n.label).toLowerCase().includes('nieuw') ? 30 : 0;
        if(key==='vatOptions') n.priceDelta=String(n.label).toLowerCase().includes('met btw') ? 10 : 0;
        return n;
      });
      const deduped=[],seen=new Set();
      normalized.forEach(n=>{
        if(!n || !n.label) return;
        const id=String(n.label).toLowerCase();
        if(seen.has(id)) return;
        if(key==='vatOptions' && n.label!=='Zonder BTW' && n.label!=='Met BTW') return;
        if(key==='batteryOptions' && n.label!=='Standaard' && n.label!=='Nieuw (100%)') return;
        seen.add(id);deduped.push(n);
      });
      // Never invent model-specific condition, color, or storage options.
      if(!["conditionOptions","storageOptions","colorOptions"].includes(key)){
        const labels=new Set(deduped.map(x=>String(x.label).toLowerCase()));
        defaults[key].forEach(d=>{if(!labels.has(String(d.label).toLowerCase()))deduped.push({...d});});
      }
      phone[key]=deduped;
    });
  }

function normalizeGlobalConditionDetails(){
  const defaults=[
    {title:"Zo goed als nieuw",text:"Geen of zeer minimale gebruikssporen. Scherm meestal als nieuw. Technisch 100% in orde.",image:""},
    {title:"Licht gebruikt",text:"Enkele kleine gebruikssporen en lichte krasjes op de behuizing. Technisch 100% in orde.",image:""},
    {title:"Zichtbaar gebruikt",text:"Duidelijke gebruikssporen, krasjes en kleine deukjes op de behuizing. Face ID / Touch ID werkt niet.",image:""}
  ];
  if(!Array.isArray(data.globalConditionDetails) || !data.globalConditionDetails.length){
    data.globalConditionDetails=defaults.map(x=>({...x}));
  }else{
    const current=data.globalConditionDetails.slice(0,3);
    data.globalConditionDetails=defaults.map((d,i)=>({
      title:String(current[i]?.title || d.title),
      text:String(current[i]?.text || d.text),
      image:String(current[i]?.image || d.image)
    }));
  }
}

function handleGlobalConditionOverviewImage(event){
  const file=event.target.files && event.target.files[0];
  if(!file) return;
  if(!file.type || !file.type.startsWith('image/')){
    alert('Kies een afbeelding.');
    event.target.value='';
    return;
  }
  if(file.size>5*1024*1024){
    alert('De afbeelding mag maximaal 5 MB zijn.');
    event.target.value='';
    return;
  }
  const reader=new FileReader();
  reader.onload=()=>{
    data.globalConditionOverviewImage=reader.result;
    renderGlobalConditionDetails();
    markChanged();
  };
  reader.readAsDataURL(file);
}

function renderGlobalConditionDetails(){
  normalizeGlobalConditionDetails();
  const overview=document.getElementById('globalConditionOverviewBox');
  if(overview){
    const img=String(data.globalConditionOverviewImage||'');
    overview.innerHTML=`
      <div style="border:1px solid #dbe4f0;border-radius:14px;padding:14px;margin-bottom:14px;background:#fff">
        <label style="font-weight:800;display:block;margin-bottom:7px">🖼️ Eén afbeelding voor «Wat is dat?»</label>
        <div class="small" style="margin-bottom:10px">Upload hier de afbeelding met de 3 condities. Deze afbeelding wordt centraal gebruikt op alle productpagina's.</div>
        <input type="file" accept="image/*" onchange="handleGlobalConditionOverviewImage(event)">
        <input value="${esc(img)}" placeholder="Of plak een afbeelding URL" oninput="data.globalConditionOverviewImage=this.value;renderGlobalConditionDetails();markChanged()" style="margin-top:8px">
        ${img?`<img src="${esc(img)}" alt="Productcondities" style="display:block;width:100%;max-width:900px;max-height:420px;object-fit:contain;border-radius:12px;margin-top:10px;background:#f8fafc">`:''}
      </div>`;
  }
  const box=document.getElementById('globalConditionDetailsList');
  if(!box) return;
  box.innerHTML=data.globalConditionDetails.map((x,i)=>`
    <div style="border:1px solid #e5e7eb;border-radius:12px;padding:14px;margin-bottom:12px;background:#fff">
      <div style="font-weight:800;margin-bottom:8px">${i+1}. ${esc(x.title)}</div>
      <div class="field">
        <label>Naam conditie</label>
        <input value="${esc(x.title||'')}" oninput="data.globalConditionDetails[${i}].title=this.value;markChanged()">
      </div>
      <div class="field" style="margin-top:8px">
        <label>Uitleg voor de klant</label>
        <textarea rows="3" oninput="data.globalConditionDetails[${i}].text=this.value;markChanged()">${esc(x.text||'')}</textarea>
      </div>
    </div>
  `).join('');
}

function normalizeDeviceCategories(){
  if(!Array.isArray(data.deviceCategories)){
    data.deviceCategories = [];
  }

  data.deviceCategories = data.deviceCategories.map(x => ({
    title: x.title || "Nieuwe categorie",
    image: x.image || "",
    link: x.link || "devices.html",
    buttonText: x.buttonText || "Bekijk",
    active: x.active !== false
  }));
}

function renderDeviceCategories(){
  normalizeDeviceCategories();
  normalizeGlobalConditionDetails();
  renderGlobalConditionDetails();

  const box=document.getElementById("deviceCategoriesList");
  if(!box) return;

  if(!data.deviceCategories.length){
    box.innerHTML='<div class="empty">Nog geen categorieën. Voeg er één toe.</div>';
    return;
  }

  if(typeof selectedDeviceCategoryIndex!=="number") selectedDeviceCategoryIndex=-1;
  if(selectedDeviceCategoryIndex>=data.deviceCategories.length) selectedDeviceCategoryIndex=-1;

  box.innerHTML=`
    <div class="device-category-accordion">
      ${data.deviceCategories.map((x,i)=>{
        const open=i===selectedDeviceCategoryIndex;
        return `
          <div class="device-category-item ${open?'open':''}">
            <button type="button" class="device-category-toggle" onclick="toggleDeviceCategory(${i})">
              <span class="device-category-toggle-main">
                <span class="device-category-icon">🖼️</span>
                <span class="device-category-text">
                  <strong>${esc(x.title||"Nieuwe categorie")}</strong>
                  <small>Homepage categorie</small>
                </span>
              </span>
              <span class="device-category-chevron">${open?"−":"+"}</span>
            </button>

            ${open?`
              <div class="device-category-content">
                <div class="card-head">
                  <div>
                    <div class="card-title">${esc(x.title||"Nieuwe categorie")}</div>
                    <div class="small">Beheer de categorie van de homepage.</div>
                  </div>
                  <button class="btn btn-red" onclick="deleteDeviceCategory(${i})">Verwijderen</button>
                </div>

                <div class="grid">
                  <div class="field">
                    <label>Naam</label>
                    <input value="${esc(x.title)}" oninput="data.deviceCategories[${i}].title=this.value;markChanged()">
                  </div>

                  <div class="field">
                    <label>Link</label>
                    <input value="${esc(x.link)}" oninput="data.deviceCategories[${i}].link=this.value;markChanged()">
                  </div>

                  <div class="field">
                    <label>Tekst knop</label>
                    <input value="${esc(x.buttonText)}" oninput="data.deviceCategories[${i}].buttonText=this.value;markChanged()">
                  </div>

                  <div class="field">
                    <label>Actief</label>
                    <label style="display:flex;align-items:center;gap:8px;margin-top:9px">
                      <input type="checkbox" ${x.active!==false?"checked":""} onchange="data.deviceCategories[${i}].active=this.checked;markChanged()">
                      Tonen op homepage
                    </label>
                  </div>

                  <div class="field" style="grid-column:1/-1">
                    <label>Afbeelding</label>
                    <input type="file" accept="image/*" onchange="handleCategoryImage(event,${i})">
                    <input value="${esc(x.image)}" placeholder="Of plak een afbeelding URL" oninput="data.deviceCategories[${i}].image=this.value;markChanged()">
                    ${x.image?`<img src="${esc(x.image)}" alt="" style="display:block;width:220px;height:120px;object-fit:cover;border-radius:12px;margin-top:10px">`:""}
                    <div class="small">Upload een afbeelding of gebruik een URL. De gekozen afbeelding wordt in de website opgeslagen.</div>
                  </div>
                </div>
              </div>
            `:""}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function toggleDeviceCategory(i){
  selectedDeviceCategoryIndex = selectedDeviceCategoryIndex===i ? -1 : i;
  renderDeviceCategories();
}

function handleCategoryImage(event,i){
  const file=event.target.files && event.target.files[0];
  if(!file) return;
  const reader=new FileReader();
  reader.onload=()=>{
    data.deviceCategories[i].image=reader.result;
    renderDeviceCategories();
    markChanged();
  };
  reader.readAsDataURL(file);
}

function addDeviceCategory(){
  normalizeDeviceCategories();
  data.deviceCategories.push({
    title:"Nieuwe categorie",
    image:"",
    link:"devices.html",
    buttonText:"Bekijk",
    active:true
  });
  selectedDeviceCategoryIndex=data.deviceCategories.length-1;
  renderDeviceCategories();
  markChanged();
}

function deleteDeviceCategory(i){
  if(confirm("Deze categorie verwijderen?")){
    data.deviceCategories.splice(i,1);
    if(selectedDeviceCategoryIndex===i) selectedDeviceCategoryIndex=-1;
    else if(selectedDeviceCategoryIndex>i) selectedDeviceCategoryIndex--;
    renderDeviceCategories();
    markChanged();
  }
}

// Safety: never automatically remove catalog products during normalization.
function isRemovedLegacyPhone(phone){return false;}

function normalizeData(){

  if(!data || typeof data!=="object"){
    data={};
  }

  normalizeBuybackPhones();
  normalizeBuybackCatalog();

  /* why */

  if(!Array.isArray(data.why)){

    if(Array.isArray(data.features)){

      data.why=data.features.map(x=>[
        "⭐",
        String(x || ""),
        ""
      ]);

    }else{
      data.why=[];
    }
  }

  data.why=data.why.map(x=>{

    if(Array.isArray(x)){
      return [
        x[0] || "⭐",
        x[1] || "",
        x[2] || ""
      ];
    }

    return [
      "⭐",
      String(x || ""),
      ""
    ];
  });
}

/* Phone editor safety draft: saved locally in IndexedDB while editing.
   This survives refreshes and server/API failures, including product photos. */
const PHONE_DRAFT_DB="homsTechAdminDrafts";
const PHONE_DRAFT_STORE="drafts";
const PHONE_DRAFT_KEY="phone-editor-current";
let phoneDraftTimer=null;
let phoneDraftCommitted=false;
function openPhoneDraftDb(){
  return new Promise((resolve,reject)=>{
    if(!("indexedDB" in window)){reject(new Error("Lokale conceptopslag niet beschikbaar"));return;}
    const req=indexedDB.open(PHONE_DRAFT_DB,1);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(PHONE_DRAFT_STORE))db.createObjectStore(PHONE_DRAFT_STORE,{keyPath:"id"});};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error("Conceptopslag openen mislukt"));
  });
}
async function writePhoneDraft(){
  if(currentPage!=="phones"||!phoneEditOnly||!data.phones?.[selectedPhoneIndex])return;
  const phone=JSON.parse(JSON.stringify(data.phones[selectedPhoneIndex]));
  const record={id:PHONE_DRAFT_KEY,phone,index:selectedPhoneIndex,isNew:!phoneWizardExistingEdit,updatedAt:Date.now()};
  const db=await openPhoneDraftDb();
  try{await new Promise((resolve,reject)=>{const tx=db.transaction(PHONE_DRAFT_STORE,"readwrite");tx.objectStore(PHONE_DRAFT_STORE).put(record);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("Concept niet opgeslagen"));});}
  finally{db.close();}
}
function schedulePhoneDraftSave(){
  if(currentPage!=="phones"||!phoneEditOnly)return;
  phoneDraftCommitted=false;
  clearTimeout(phoneDraftTimer);
  phoneDraftTimer=setTimeout(()=>writePhoneDraft().catch(e=>console.warn("[HOMS TECH] Lokale productconceptopslag:",e)),250);
}
async function restorePhoneDraft(){
  let db;
  try{
    db=await openPhoneDraftDb();
    const draft=await new Promise((resolve,reject)=>{const tx=db.transaction(PHONE_DRAFT_STORE,"readonly");const req=tx.objectStore(PHONE_DRAFT_STORE).get(PHONE_DRAFT_KEY);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);});
    if(!draft?.phone)return false;
    if(!Array.isArray(data.phones))data.phones=[];
    let index=Number.isInteger(draft.index)?draft.index:data.phones.length;
    if(draft.isNew){
      // Recover genuinely new, unsaved products, but never duplicate one already on the server.
      const duplicate=data.phones.findIndex(p=>
        String(p?.id||"")===String(draft.phone?.id||"") && !!draft.phone?.id
      );
      if(duplicate>=0){await clearPhoneDraft();return false;}
      if(index>=data.phones.length)data.phones.push(draft.phone);
      else data.phones.splice(index,0,draft.phone);
    }else{
      // Existing-product drafts are device-local and may be older than the shared
      // database version edited from another device. Never let a phone/desktop
      // draft overwrite the canonical server product on load.
      await clearPhoneDraft();
      return false;
    }
    selectedPhoneIndex=index;phoneEditOnly=true;phoneWizardExistingEdit=!draft.isNew;
    setStatus("✓ Er is een lokaal opgeslagen productconcept hersteld. Controleer het en sla het opnieuw op.","info");
    return true;
  }catch(e){console.warn("[HOMS TECH] Productconcept herstellen:",e);return false;}
  finally{if(db)db.close();}
}
async function clearPhoneDraft(){
  clearTimeout(phoneDraftTimer);
  let db;
  try{
    db=await openPhoneDraftDb();
    await new Promise((resolve,reject)=>{const tx=db.transaction(PHONE_DRAFT_STORE,"readwrite");tx.objectStore(PHONE_DRAFT_STORE).delete(PHONE_DRAFT_KEY);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
  }catch(e){console.warn("[HOMS TECH] Productconcept wissen:",e);}
  finally{if(db)db.close();}
}
window.addEventListener("pagehide",()=>{if(currentPage==="phones"&&phoneEditOnly&&!phoneDraftCommitted)writePhoneDraft().catch(()=>{});});

async function loadData(){

  loading=true;

  setStatus("Gegevens laden...","info");

  try{

    const r=await fetch("/api/site");

    if(!r.ok){
      throw new Error("Websitegegevens konden niet worden geladen");
    }

    data=await r.json();
    shopCatalogOriginalSnapshot=JSON.parse(JSON.stringify(Array.isArray(data.shopProducts)?data.shopProducts:[]));
    phoneOriginalIdentities=(Array.isArray(data.phones)?data.phones:[]).map(p=>({id:p?.id??null,name:String(p?.name||""),brand:String(p?.brand||"")}));
    buybackCatalogDeleteLock=false;

    normalizeData();

    // The guided setup wizard is a temporary editor state, not product data.
    // Older saves may have persisted setupWizard=true and reopened the same
    // existing product editor on every reload. Clear it for server products;
    // genuinely new unsaved drafts are restored immediately below.
    if(Array.isArray(data.phones)){
      data.phones.forEach(phone=>{
        if(phone && phone.setupWizard){
          phone.setupWizard=false;
          delete phone.setupStep;
          delete phone.setupDone;
        }
      });
    }

    const phoneDraftRestored=await restorePhoneDraft();
    renderAll();

    setStatus("✓ Gegevens geladen","success");

  }catch(e){

    setStatus("✕ "+e.message,"error");

  }

  loading=false;
}

/* ---------------- GENERAL ---------------- */

function renderGeneral(){

  document.querySelectorAll("[data-u]").forEach(el=>{

    const key=el.dataset.u;

    el.value=data[key] ?? "";

    el.oninput=()=>{

      data[key]=el.value;

      markChanged();

    };
  });
}

/* Editor selections */
let selectedServiceIndex=0;
let selectedPhoneIndex=0;
let phoneOriginalIdentities=[];
let phoneEditOnly=false;
let phoneWizardExistingEdit=false;
let phoneBulkPricingView=false;
let phoneBulkPricingModelIndex="";
let phoneBulkSearchText="";
let phoneBulkSelectedRows=new Set();
let phoneBulkFilterColor="";
let phoneBulkFilterStorage="";
let phoneBulkFilterCondition="";
let phoneTreeSearch="";
let phoneTreeBrand="Alle";
let phoneTreeCustomGroups=[];
try{phoneTreeCustomGroups=JSON.parse(localStorage.getItem("homsTechPhoneGroups")||"[]").filter(Boolean);}catch(e){phoneTreeCustomGroups=[];}
let selectedUsedPhoneIndex=0;
let selectedWhyIndex=0;
let selectedDeviceCategoryIndex=-1;
/* ---------------- HOMEPAGE SETTINGS ---------------- */
let homepageOpenSection="hero";

const HOMEPAGE_DEFAULTS={
  topBar:{
    enabled:true,
    items:["1 jaar garantie","Snel geleverd","Betrouwbare service","Betaalbare prijzen"]
  },
  hero:{
    enabled:true,
    titleTop:"Is uw telefoon kapot?",
    titleBottom:"Wij komen naar u toe!",
    text:"Reparatie van alle soorten telefoons bij u thuis — snelle service, professioneel werk en betaalbare prijzen.",
    button1Text:"💬 Afspraak via WhatsApp",
    button1Link:"",
    button2Text:"📞 Bel nu",
    button2Link:"",
    showDevice:true
  },
  banners:{
    enabled:true,
    buybackTitle:"Uw toestel verkopen?",
    buybackText:"Heeft u een oude iPhone, Samsung, iPad of Mac? Laat HOMS TECH uw toestel beoordelen en ontvang een eerlijke prijs.",
    buybackButton:"Bekijk wat uw toestel waard is →",
    buybackLink:"/uw-toestel-verkopen.html",
    buybackArt:"♻️📱",
    refurbishedTitle:"Refurbished apparaten",
    refurbishedText:"Geteste apparaten met duidelijke informatie en garantie.",
    refurbishedButton:"Bekijk apparaten →",
    refurbishedLink:"devices.html",
    refurbishedArt:"📱"
  },
  categories:{enabled:true,title:"Refurbished apparaten"},
  popular:{enabled:true,title:"Populaire apparaten",limit:12,indexes:[]},
  homeVisit:{
    enabled:true,
    title:"📍 Wij komen bij u thuis!",
    text:"Rotterdam en omgeving · Professionele reparatie aan huis",
    buttonText:"💬 WhatsApp"
  },
  services:{enabled:true,title:"Onze reparatie diensten"},
  why:{enabled:true,title:"Waarom HOMS TECH?"},
  footer:{
    enabled:true,
    description:"Refurbished apparaten · Reparatie aan huis · ",
    area:"Rotterdam en omgeving",
    contact:"WhatsApp · Telefoon · E-mail",
    email:"", phone:"", whatsapp:"", hours:"", address:"", mapUrl:""
  }
};

function mergeHomepageDefaults(target,source){
  const out={...source,...(target||{})};
  ["topBar","hero","banners","categories","popular","homeVisit","services","why","footer"].forEach(k=>{
    if(source[k] && typeof source[k]==="object" && !Array.isArray(source[k])){
      out[k]={...source[k],...(target&&typeof target[k]==="object"?target[k]:{})};
    }
  });
  if(!Array.isArray(out.topBar.items))out.topBar.items=[...source.topBar.items];
  if(!Array.isArray(out.popular.indexes))out.popular.indexes=[];
  return out;
}

function normalizeHomepageSettings(){
  data.homepage=mergeHomepageDefaults(data.homepage,HOMEPAGE_DEFAULTS);
  data.homepage.topBar.items=data.homepage.topBar.items.map(x=>String(x||"")).filter(Boolean);
}

function homepageInput(label,key,value,extra=""){
  return `<div class="field"><label>${esc(label)}</label><input value="${esc(value??"")}" oninput="data.homepage.${key}=this.value;markChanged()" ${extra}></div>`;
}
function homepageToggle(path,label,checked){
  return `<label class="homepage-toggle"><input type="checkbox" ${checked?"checked":""} onchange="data.homepage.${path}=this.checked;markChanged();renderHomepageSettings()"> ${esc(label)}</label>`;
}
function homepageAccordionItem(key,icon,title,subtitle,body){
  const open=homepageOpenSection===key;
  return `<div class="homepage-acc-item">
    <button type="button" class="homepage-acc-head ${open?"open":""}" onclick="toggleHomepagePanel('${key}')">
      <span class="homepage-acc-icon">${icon}</span>
      <span class="homepage-acc-title"><strong>${esc(title)}</strong><small>${esc(subtitle)}</small></span>
      <span class="homepage-acc-arrow">${open?"−":"+"}</span>
    </button>
    ${open?`<div class="homepage-acc-body">${body}</div>`:""}
  </div>`;
}
function toggleHomepagePanel(key){
  homepageOpenSection=homepageOpenSection===key?"":key;
  renderHomepageSettings();
}
function homepageServiceEditor(){
  if(!Array.isArray(data.services))data.services=[];
  return `
    <div class="homepage-preview-note">Deze lijst is dezelfde reparatiedienstenlijst die op de homepage wordt getoond.</div>
    <div class="homepage-mini-list">
      ${data.services.map((x,i)=>`<div class="homepage-mini-row">
        <input value="${esc(x[0]||"🔧")}" aria-label="Icoon" oninput="data.services[${i}][0]=this.value;markChanged()">
        <div><input value="${esc(x[1]||"")}" placeholder="Naam dienst" oninput="data.services[${i}][1]=this.value;markChanged()"><textarea rows="2" placeholder="Korte beschrijving" oninput="data.services[${i}][2]=this.value;markChanged()" style="margin-top:6px">${esc(x[2]||"")}</textarea></div>
        <div class="homepage-mini-actions"><button class="btn btn-red" type="button" onclick="data.services.splice(${i},1);renderHomepageSettings();markChanged()">Verwijderen</button></div>
      </div>`).join("")}
    </div>
    <button class="btn btn-green" type="button" style="margin-top:10px" onclick="data.services.push(["🔧","Nieuwe dienst",""]);renderHomepageSettings();homepageOpenSection='services';markChanged()">+ Dienst toevoegen</button>
  `;
}
function homepageWhyEditor(){
  if(!Array.isArray(data.why))data.why=[];
  return `
    <div class="homepage-mini-list">
      ${data.why.map((x,i)=>`<div class="homepage-mini-row">
        <input value="${esc(x[0]||"⭐")}" aria-label="Icoon" oninput="data.why[${i}][0]=this.value;markChanged()">
        <div><input value="${esc(x[1]||"")}" placeholder="Titel" oninput="data.why[${i}][1]=this.value;markChanged()"><textarea rows="2" placeholder="Beschrijving" oninput="data.why[${i}][2]=this.value;markChanged()" style="margin-top:6px">${esc(x[2]||"")}</textarea></div>
        <div class="homepage-mini-actions"><button class="btn btn-red" type="button" onclick="data.why.splice(${i},1);renderHomepageSettings();markChanged()">Verwijderen</button></div>
      </div>`).join("")}
    </div>
    <button class="btn btn-green" type="button" style="margin-top:10px" onclick="data.why.push(["⭐","Nieuw voordeel",""]);renderHomepageSettings();homepageOpenSection='why';markChanged()">+ Voordeel toevoegen</button>
  `;
}
function homepageCategoryEditor(){
  normalizeDeviceCategories();
  return `
    <div class="homepage-preview-note">Dit zijn dezelfde homepage-categorieën die je al beheert. De bestaande categorie-editor blijft ongewijzigd.</div>
    <div class="homepage-mini-list">
      ${data.deviceCategories.map((x,i)=>`<div class="homepage-mini-row">
        <span style="font-size:20px">🖼️</span>
        <div>
          <input value="${esc(x.title||"Nieuwe categorie")}" placeholder="Naam categorie" oninput="data.deviceCategories[${i}].title=this.value;markChanged()">
          <div class="small" style="margin-top:5px">${x.active!==false?"✓ Zichtbaar op homepage":"○ Verborgen"}</div>
        </div>
        <div class="homepage-mini-actions"><button class="btn btn-light" type="button" onclick="selectedDeviceCategoryIndex=${i};showPage('categories')">Volledige instellingen</button></div>
      </div>`).join("")}
    </div>
    <div class="small" style="margin-top:10px">Afbeeldingen, links en zichtbaarheid kun je hier via «Volledige instellingen» verder beheren.</div>
  `;
}
function homepagePopularEditor(){
  normalizeHomepageSettings();
  const selected=new Set((data.homepage.popular.indexes||[]).map(Number));
  const phones=Array.isArray(data.phones)?data.phones:[];
  return `
    <div class="homepage-two">
      <div class="field"><label>Titel</label><input value="${esc(data.homepage.popular.title)}" oninput="data.homepage.popular.title=this.value;markChanged()"></div>
      <div class="field"><label>Maximaal aantal</label><input type="number" min="1" max="50" value="${Number(data.homepage.popular.limit)||12}" oninput="data.homepage.popular.limit=Math.max(1,Math.min(50,Number(this.value)||12));markChanged()"></div>
    </div>
    <div class="homepage-preview-note">Kies eventueel specifieke telefoons. Laat alles uitgevinkt om automatisch de eerste beschikbare telefoons te tonen.</div>
    <div class="homepage-mini-list">
      ${phones.map((p,i)=>`<label class="homepage-mini-row" style="grid-template-columns:32px minmax(0,1fr)">
        <input type="checkbox" ${selected.has(i)?"checked":""} onchange="toggleHomepagePopularPhone(${i},this.checked)" style="width:18px;height:18px;accent-color:#25d366">
        <span><strong>${esc(p.name||"Apparaat")}</strong><small class="small" style="display:block">${esc(p.brand||"")}${p.storage?" · "+esc(p.storage):""}${p.color?" · "+esc(p.color):""}</small></span>
      </label>`).join("") || '<div class="small">Geen telefoons toegevoegd.</div>'}
    </div>`;
}
function toggleHomepagePopularPhone(i,checked){
  normalizeHomepageSettings();
  let arr=Array.isArray(data.homepage.popular.indexes)?data.homepage.popular.indexes:[];
  arr=arr.map(Number).filter(Number.isFinite);
  if(checked&&!arr.includes(i))arr.push(i);
  if(!checked)arr=arr.filter(x=>x!==i);
  data.homepage.popular.indexes=arr;
  markChanged();
}
function renderHomepageSettings(){
  normalizeHomepageSettings();
  const box=document.getElementById("homepageSettingsAccordion");
  if(!box)return;

  const h=data.homepage.hero,b=data.homepage.banners,t=data.homepage.topBar,c=data.homepage.categories,p=data.homepage.popular,v=data.homepage.homeVisit,s=data.homepage.services,w=data.homepage.why,f=data.homepage.footer;

  const heroBody=`
    ${homepageToggle("hero.enabled","Hero tonen",h.enabled)}
    <div class="homepage-two" style="margin-top:12px">
      ${homepageInput("Titel regel 1","hero.titleTop",h.titleTop)}
      ${homepageInput("Titel regel 2","hero.titleBottom",h.titleBottom)}
    </div>
    <div class="field"><label>Hero tekst</label><textarea oninput="data.homepage.hero.text=this.value;markChanged()">${esc(h.text)}</textarea></div>
    <div class="homepage-two">
      ${homepageInput("Knop 1 tekst","hero.button1Text",h.button1Text)}
      ${homepageInput("Knop 1 link","hero.button1Link",h.button1Link)}
      ${homepageInput("Knop 2 tekst","hero.button2Text",h.button2Text)}
      ${homepageInput("Knop 2 link","hero.button2Link",h.button2Link)}
    </div>
    ${homepageToggle("hero.showDevice","Telefoonvorm in hero tonen",h.showDevice)}
  `;

  const topBody=`
    ${homepageToggle("topBar.enabled","Bovenste balk tonen",t.enabled)}
    <div class="homepage-mini-list" style="margin-top:12px">
      ${t.items.map((x,i)=>`<div class="homepage-mini-row"><span style="font-size:18px">📢</span><input value="${esc(x)}" oninput="data.homepage.topBar.items[${i}]=this.value;markChanged()"><div class="homepage-mini-actions"><button class="btn btn-red" type="button" onclick="data.homepage.topBar.items.splice(${i},1);renderHomepageSettings();homepageOpenSection='topbar';markChanged()">حذف</button></div></div>`).join("")}
    </div>
    <button class="btn btn-green" type="button" style="margin-top:10px" onclick="data.homepage.topBar.items.push('Nieuw bericht');renderHomepageSettings();homepageOpenSection='topbar';markChanged()">+ Bericht toevoegen</button>
  `;

  const bannersBody=`
    ${homepageToggle("banners.enabled","Banners tonen",b.enabled)}
    <div class="card"><div class="card-title">♻️ Uw toestel verkopen</div><div class="grid">
      ${homepageInput("Titel","banners.buybackTitle",b.buybackTitle)}
      ${homepageInput("Knop","banners.buybackButton",b.buybackButton)}
      <div class="field" style="grid-column:1/-1"><label>Tekst</label><textarea oninput="data.homepage.banners.buybackText=this.value;markChanged()">${esc(b.buybackText)}</textarea></div>
      ${homepageInput("Link","banners.buybackLink",b.buybackLink)}
      ${homepageInput("Icoon / art","banners.buybackArt",b.buybackArt)}
    </div></div>
    <div class="card"><div class="card-title">📱 Refurbished apparaten</div><div class="grid">
      ${homepageInput("Titel","banners.refurbishedTitle",b.refurbishedTitle)}
      ${homepageInput("Knop","banners.refurbishedButton",b.refurbishedButton)}
      <div class="field" style="grid-column:1/-1"><label>Tekst</label><textarea oninput="data.homepage.banners.refurbishedText=this.value;markChanged()">${esc(b.refurbishedText)}</textarea></div>
      ${homepageInput("Link","banners.refurbishedLink",b.refurbishedLink)}
      ${homepageInput("Icoon / art","banners.refurbishedArt",b.refurbishedArt)}
    </div></div>`;

  const categoriesBody=`
    ${homepageToggle("categories.enabled","Categorieën tonen",c.enabled)}
    <div class="field" style="margin-top:12px"><label>Titel</label><input value="${esc(c.title)}" oninput="data.homepage.categories.title=this.value;markChanged()"></div>
    ${homepageCategoryEditor()}`;

  const popularBody=`
    ${homepageToggle("popular.enabled","Populaire apparaten tonen",p.enabled)}
    <div style="margin-top:12px">${homepagePopularEditor()}</div>`;

  const visitBody=`
    ${homepageToggle("homeVisit.enabled","Thuisservice-banner tonen",v.enabled)}
    <div class="grid" style="margin-top:12px">
      ${homepageInput("Titel","homeVisit.title",v.title)}
      ${homepageInput("Knop","homeVisit.buttonText",v.buttonText)}
      <div class="field" style="grid-column:1/-1"><label>Tekst</label><textarea oninput="data.homepage.homeVisit.text=this.value;markChanged()">${esc(v.text)}</textarea></div>
    </div>`;

  const servicesBody=`
    ${homepageToggle("services.enabled","Reparaties tonen",s.enabled)}
    <div class="field" style="margin-top:12px"><label>Titel</label><input value="${esc(s.title)}" oninput="data.homepage.services.title=this.value;markChanged()"></div>
    <div style="margin-top:12px">${homepageServiceEditor()}</div>`;

  const whyBody=`
    ${homepageToggle("why.enabled","Waarom HOMS TECH tonen",w.enabled)}
    <div class="field" style="margin-top:12px"><label>Titel</label><input value="${esc(w.title)}" oninput="data.homepage.why.title=this.value;markChanged()"></div>
    <div style="margin-top:12px">${homepageWhyEditor()}</div>`;

  const footerBody=`
    ${homepageToggle("footer.enabled","Footer tonen",f.enabled)}
    <div class="grid" style="margin-top:12px">
      <div class="field"><label>Omschrijving</label><input value="${esc(f.description)}" oninput="data.homepage.footer.description=this.value;markChanged()"></div>
      <div class="field"><label>Werkgebied</label><input value="${esc(f.area)}" oninput="data.homepage.footer.area=this.value;markChanged()"></div>
      <div class="field" style="grid-column:1/-1"><label>Contactregel</label><input value="${esc(f.contact)}" oninput="data.homepage.footer.contact=this.value;markChanged()"></div>
      <div class="field"><label>E-mailadres contact</label><input type="email" value="${esc(f.email)}" placeholder="info@homs-tech.nl" oninput="data.homepage.footer.email=this.value;markChanged()"></div>
      <div class="field"><label>Telefoonnummer</label><input value="${esc(f.phone)}" placeholder="+31 ..." oninput="data.homepage.footer.phone=this.value;markChanged()"></div>
      <div class="field"><label>WhatsApp nummer</label><input value="${esc(f.whatsapp)}" placeholder="316..." oninput="data.homepage.footer.whatsapp=this.value;markChanged()"></div>
      <div class="field"><label>Openingstijden</label><input value="${esc(f.hours)}" placeholder="Ma–Vr 09:00–18:00" oninput="data.homepage.footer.hours=this.value;markChanged()"></div>
      <div class="field"><label>Adres</label><input value="${esc(f.address)}" placeholder="Straat, postcode en plaats" oninput="data.homepage.footer.address=this.value;markChanged()"></div>
      <div class="field"><label>Google Maps link</label><input type="url" value="${esc(f.mapUrl)}" placeholder="https://maps.google.com/..." oninput="data.homepage.footer.mapUrl=this.value;markChanged()"></div>
    </div>`;

  box.innerHTML=
    homepageAccordionItem("hero","🎯","Hero / Hoofdbanner","Titel, tekst en knoppen",heroBody)+
    homepageAccordionItem("topbar","📢","Top Bar (bovenste balk)","Garantie, levering en vertrouwen",topBody)+
    homepageAccordionItem("banners","🖼️","Banners","Uw toestel verkopen + Refurbished",bannersBody)+
        homepageAccordionItem("categories","🗂️","Refurbished apparaten","Categorieën en zichtbaarheid",categoriesBody)+
    homepageAccordionItem("popular","📱","Populaire apparaten","Titel, aantal en selectie",popularBody)+
    homepageAccordionItem("services","🔧","Reparaties","Titel en reparatiediensten",servicesBody)+
    homepageAccordionItem("why","⭐","Waarom HOMS TECH","Voordelen وثيقة",whyBody)+
    homepageAccordionItem("visit","📍","Wij komen bij u thuis","Thuisservice-banner",visitBody)+
    homepageAccordionItem("footer","📞","Contact & Footer","Contactgegevens en footer",footerBody);
}

/* ---------------- SERVICES ---------------- */

function renderServices(){
  const box=document.getElementById("servicesList");
  if(!box) return;
  if(!data.services.length){
    box.innerHTML=`<div class="editor-layout"><div class="editor-list"><div class="editor-list-title">Diensten</div><div class="small" style="padding:10px">Nog geen diensten toegevoegd.</div></div><div class="editor-panel editor-empty">Nog geen dienst toegevoegd.</div></div>`;
    return;
  }
  if(selectedServiceIndex>=data.services.length) selectedServiceIndex=data.services.length-1;
  const service=data.services[selectedServiceIndex];
  const list=data.services.map((x,i)=>`<button type="button" class="editor-list-item ${i===selectedServiceIndex?'active':''}" onclick="selectedServiceIndex=${i};renderServices()">🔧 ${esc(x[1]||'Nieuwe dienst')}<small>${esc(x[2]||'')}</small></button>`).join('');
  box.innerHTML=`
    <div class="editor-layout">
      <div class="editor-list">
        <div class="editor-list-title">Diensten</div>
        ${list}
      </div>
      <div class="editor-panel">
        <div class="card-head">
          <div><div class="card-title" style="font-size:20px">🔧 ${esc(service[1]||'Nieuwe dienst')}</div><div class="small">Bewerk hier de gegevens van deze dienst.</div></div>
          <button class="btn btn-red" onclick="deleteService(${selectedServiceIndex})">Verwijderen</button>
        </div>
        <div class="grid">
          <div class="field"><label>Icoon / emoji</label><input value="${esc(service[0]||'🔧')}" oninput="data.services[${selectedServiceIndex}][0]=this.value;markChanged()"></div>
          <div class="field"><label>Naam dienst</label><input value="${esc(service[1]||'')}" oninput="data.services[${selectedServiceIndex}][1]=this.value;markChanged();renderServices()"></div>
          <div class="field" style="grid-column:1/-1"><label>Beschrijving</label><textarea oninput="data.services[${selectedServiceIndex}][2]=this.value;markChanged()">${esc(service[2]||'')}</textarea></div>
          <div class="field service-image-field" style="grid-column:1/-1">
            <label>Afbeelding van de dienst</label>
            <div class="service-image-upload">
              <div class="service-image-preview">${service[3] ? '<img src="'+esc(service[3])+'" alt="Voorbeeld service-afbeelding">' : '<span>🖼️</span><small>Nog geen afbeelding</small>'}</div>
              <div class="service-image-controls">
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" aria-label="Afbeelding uploaden" onchange="handleServiceImageUpload(event,${selectedServiceIndex})">
                <small>JPG, PNG, WebP of GIF · maximaal 1,5 MB</small>
                ${service[3] ? '<button class="btn btn-light" type="button" onclick="clearServiceImage('+selectedServiceIndex+')">Afbeelding verwijderen</button>' : ''}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function handleServiceImageUpload(event,index){
  const file=event.target.files&&event.target.files[0];
  if(!file)return;
  if(!["image/jpeg","image/png","image/webp","image/gif"].includes(file.type)){alert("Kies een JPG-, PNG-, WebP- of GIF-afbeelding.");event.target.value="";return;}
  if(file.size>1.5*1024*1024){alert("De afbeelding mag maximaal 1,5 MB zijn.");event.target.value="";return;}
  const reader=new FileReader();
  reader.onload=()=>{if(!Array.isArray(data.services[index]))return;data.services[index][3]=String(reader.result||"");markChanged();renderServices();};
  reader.onerror=()=>alert("De afbeelding kon niet worden gelezen. Probeer het opnieuw.");
  reader.readAsDataURL(file);
}
function clearServiceImage(index){
  if(!Array.isArray(data.services[index]))return;
  data.services[index][3]="";
  markChanged();
  renderServices();
}
function addService(){
  data.services.push(["🔧","Nieuwe dienst","",""]);
  selectedServiceIndex=data.services.length-1;
  renderServices();
  markChanged();
}

function deleteService(i){
  if(confirm("Deze dienst verwijderen?")){
    data.services.splice(i,1);
    selectedServiceIndex=Math.max(0,Math.min(selectedServiceIndex,data.services.length-1));
    renderServices();
    markChanged();
  }
}

function repairField(label,html,full=false){return `<div class="repair-admin-field${full?' full':''}"><label>${label}</label>${html}</div>`;}
function repairInput(path,value,label){
  return repairField(label,`<input value="${esc(value)}" oninput="${path}=this.value;markChanged()">`);
}
function repairTextarea(path,value,label){
  return repairField(label,`<textarea oninput="${path}=this.value;markChanged()">${esc(value)}</textarea>`,true);
}
function renderRepairImagePreview(image){
  return image?`<div class="repair-admin-image-preview"><img src="${esc(image)}" alt=""></div>`:'<div class="repair-admin-image-preview">Geen foto</div>';
}
function handleRepairImage(section,index,event){
  const file=event.target.files&&event.target.files[0];
  if(!file)return;
  if(!file.type.startsWith("image/")){alert("Kies een afbeelding.");event.target.value="";return;}
  if(file.size>5*1024*1024){alert("De afbeelding mag maximaal 5 MB zijn.");event.target.value="";return;}
  const reader=new FileReader();
  reader.onload=()=>{
    if(section==="hero") data.repairPage.hero.image=reader.result;
    if(section==="option") data.repairPage.options[index].image=reader.result;
    renderRepairPageAdmin();
    markChanged();
  };
  reader.readAsDataURL(file);
}
function addRepairCheck(){
  data.repairPage.hero.checks.push("Nieuwe belofte");
  renderRepairPageAdmin();markChanged();
}
function deleteRepairCheck(i){
  data.repairPage.hero.checks.splice(i,1);
  renderRepairPageAdmin();markChanged();
}
function addRepairOption(){
  data.repairPage.options.push({icon:"🔧",title:"Nieuwe optie",description:"Beschrijving van deze reparatieoptie.",ticks:["Snel en eenvoudig"],button:"Aanmelden →",method:"home",image:""});
  renderRepairPageAdmin();markChanged();
}
function deleteRepairOption(i){
  if(data.repairPage.options.length<=1){alert("Er moet minstens één optie blijven staan.");return;}
  if(!confirm("Deze optie van de Reparatiepagina verwijderen?"))return;
  data.repairPage.options.splice(i,1);renderRepairPageAdmin();markChanged();
}
function addRepairTick(i){
  data.repairPage.options[i].ticks.push("Nieuwe informatie");
  renderRepairPageAdmin();markChanged();
}
function deleteRepairTick(i,j){
  data.repairPage.options[i].ticks.splice(j,1);renderRepairPageAdmin();markChanged();
}
function addRepairStep(){
  data.repairPage.steps.items.push({icon:"🔧",title:"Nieuwe stap",description:"Beschrijving van deze stap."});
  renderRepairPageAdmin();markChanged();
}
function deleteRepairStep(i){
  if(data.repairPage.steps.items.length<=1){alert("Er moet minstens één stap blijven staan.");return;}
  data.repairPage.steps.items.splice(i,1);renderRepairPageAdmin();markChanged();
}
function addRepairFeature(){
  data.repairPage.features.push({icon:"✓",title:"Nieuw voordeel",text:"Beschrijving"});
  renderRepairPageAdmin();markChanged();
}
function deleteRepairFeature(i){
  if(data.repairPage.features.length<=1){alert("Er moet minstens één voordeel blijven staan.");return;}
  data.repairPage.features.splice(i,1);renderRepairPageAdmin();markChanged();
}
function enforceRepairAccordion(container){
  if(!container)return;
  container.querySelectorAll("details.repair-admin-item").forEach(d=>{
    d.addEventListener("toggle",()=>{
      if(!d.open)return;
      container.querySelectorAll("details.repair-admin-item[open]").forEach(other=>{
        if(other!==d)other.open=false;
      });
    });
  });
}

function renderRepairPageAdmin(){
  const box=document.getElementById("repairPageEditor");
  if(!box)return;
  const p=data.repairPage;
  const heroChecks=p.hero.checks.map((x,i)=>`<div class="repair-admin-line"><span class="repair-admin-icon">✓</span><input value="${esc(x)}" oninput="data.repairPage.hero.checks[${i}]=this.value;markChanged()"><button class="btn btn-red" type="button" onclick="deleteRepairCheck(${i})">×</button></div>`).join("");
  const optionCards=p.options.map((o,i)=>`
    <details class="repair-admin-item">
      <summary>
        <div class="repair-admin-summary-title"><strong>🧩 Optie ${i+1}</strong><span class="repair-admin-summary-meta">${esc(o.title||"Nieuwe optie")} · ${o.method==="send"?"Toestel opsturen":"Afspraak aan huis"}</span></div>
        <div class="repair-admin-summary-actions"><button class="btn btn-red" type="button" onclick="event.preventDefault();event.stopPropagation();deleteRepairOption(${i})">Verwijderen</button></div>
      </summary>
      <div class="repair-admin-item-body">
        <div class="repair-admin-grid">
          ${repairField("Icoon",`<input value="${esc(o.icon)}" oninput="data.repairPage.options[${i}].icon=this.value;markChanged()">`)}
          ${repairField("Knop actie",`<select onchange="data.repairPage.options[${i}].method=this.value;markChanged()"><option value="home" ${o.method==="home"?"selected":""}>Afspraak aan huis</option><option value="send" ${o.method==="send"?"selected":""}>Toestel opsturen</option></select>`)}
          ${repairField("Titel",`<input value="${esc(o.title)}" oninput="data.repairPage.options[${i}].title=this.value;markChanged()">`,true)}
          ${repairField("Beschrijving",`<textarea oninput="data.repairPage.options[${i}].description=this.value;markChanged()">${esc(o.description)}</textarea>`,true)}
          ${repairField("Knoptekst",`<input value="${esc(o.button)}" oninput="data.repairPage.options[${i}].button=this.value;markChanged()">`,true)}
          <div class="repair-admin-field full"><label>Voordelen in deze kaart</label><div class="repair-admin-ticks">${o.ticks.map((t,j)=>`<div class="repair-admin-line"><span class="repair-admin-icon">✓</span><input value="${esc(t)}" oninput="data.repairPage.options[${i}].ticks[${j}]=this.value;markChanged()"><button class="btn btn-red" type="button" onclick="deleteRepairTick(${i},${j})">×</button></div>`).join("")}</div><div class="repair-admin-actions"><button class="btn btn-light" type="button" onclick="addRepairTick(${i})">＋ Voordeel toevoegen</button></div></div>
          <div class="repair-admin-field full"><label>Afbeelding</label><div class="repair-admin-image"><div>${renderRepairImagePreview(o.image)}</div><div><input type="file" accept="image/*" onchange="handleRepairImage('option',${i},event)"><div class="small">Max. 5 MB. Wordt op de kaart gebruikt.</div></div></div></div>
        </div>
      </div>
    </details>`).join("");
  const steps=p.steps.items.map((s,i)=>`
    <details class="repair-admin-item">
      <summary>
        <div class="repair-admin-summary-title"><strong>🔢 Stap ${i+1}</strong><span class="repair-admin-summary-meta">${esc(s.title||"Nieuwe stap")}</span></div>
        <div class="repair-admin-summary-actions"><button class="btn btn-red" type="button" onclick="event.preventDefault();event.stopPropagation();deleteRepairStep(${i})">Verwijderen</button></div>
      </summary>
      <div class="repair-admin-item-body">
        <div class="repair-admin-grid">
          ${repairField("Icoon",`<input value="${esc(s.icon)}" oninput="data.repairPage.steps.items[${i}].icon=this.value;markChanged()">`)}
          ${repairField("Titel",`<input value="${esc(s.title)}" oninput="data.repairPage.steps.items[${i}].title=this.value;markChanged()">`)}
          ${repairField("Beschrijving",`<textarea oninput="data.repairPage.steps.items[${i}].description=this.value;markChanged()">${esc(s.description)}</textarea>`,true)}
        </div>
      </div>
    </details>`).join("");
  const features=p.features.map((x,i)=>`
    <details class="repair-admin-item">
      <summary>
        <div class="repair-admin-summary-title"><strong>⭐ Voordeel ${i+1}</strong><span class="repair-admin-summary-meta">${esc(x.title||"Nieuw voordeel")}</span></div>
        <div class="repair-admin-summary-actions"><button class="btn btn-red" type="button" onclick="event.preventDefault();event.stopPropagation();deleteRepairFeature(${i})">Verwijderen</button></div>
      </summary>
      <div class="repair-admin-item-body">
        <div class="repair-admin-grid">
          ${repairField("Icoon",`<input value="${esc(x.icon)}" oninput="data.repairPage.features[${i}].icon=this.value;markChanged()">`)}
          ${repairField("Titel",`<input value="${esc(x.title)}" oninput="data.repairPage.features[${i}].title=this.value;markChanged()">`)}
          ${repairField("Korte tekst",`<input value="${esc(x.text)}" oninput="data.repairPage.features[${i}].text=this.value;markChanged()">`,true)}
        </div>
      </div>
    </details>`).join("");
  box.innerHTML=`
    <div class="repair-admin-note">كل تعديل هون بيأثر مباشرة على صفحة <strong>Reparaties</strong>. الصور والنصوص والخيارات محفوظة ضمن بيانات الموقع، والحفظ النهائي يتم من زر «Wijzigingen opslaan» أسفل لوحة التحكم.</div>

    <div class="repair-admin-section">
      <div class="repair-admin-head"><div><h3>🖼️ Hero / الصورة الرئيسية</h3><p>العنوان، النص، النقاط والصورة الكبيرة.</p></div></div>
      <div class="repair-admin-body">
        <div class="repair-admin-grid">
          ${repairInput("data.repairPage.hero.eyebrow",p.hero.eyebrow,"السطر الصغير فوق العنوان")}
          ${repairInput("data.repairPage.hero.title",p.hero.title,"العنوان الرئيسي")}
          ${repairInput("data.repairPage.hero.accent",p.hero.accent,"الجزء الأزرق من العنوان")}
          ${repairTextarea("data.repairPage.hero.subtitle",p.hero.subtitle,"الوصف تحت العنوان")}
          <div class="repair-admin-field full"><label>النقاط الخضراء</label><div class="repair-admin-checks">${heroChecks}</div><div class="repair-admin-actions"><button class="btn btn-light" type="button" onclick="addRepairCheck()">＋ نقطة جديدة</button></div></div>
          <div class="repair-admin-field full"><label>الصورة الرئيسية</label><div class="repair-admin-image"><div>${renderRepairImagePreview(p.hero.image)}</div><div><input type="file" accept="image/*" onchange="handleRepairImage('hero',0,event)"><div class="small">الصورة الكبيرة في Hero · Max. 5 MB</div></div></div></div>
        </div>
      </div>
    </div>

    <div class="repair-admin-section">
      <div class="repair-admin-head"><div><h3>🧩 بطاقات طريقة الإصلاح</h3><p>كل بطاقة فيها عنوان، وصف، مزايا، زر وصورة. يمكنك إضافة بطاقة جديدة.</p></div><button class="btn btn-green" type="button" onclick="addRepairOption()">＋ إضافة بطاقة</button></div>
      <div class="repair-admin-body"><div class="repair-admin-card-grid">${optionCards}</div></div>
    </div>

    <div class="repair-admin-section">
      <div class="repair-admin-head"><div><h3>🔢 كيف تعمل الخدمة</h3><p>العنوان والخطوات الظاهرة أسفل البطاقات.</p></div><button class="btn btn-green" type="button" onclick="addRepairStep()">＋ خطوة</button></div>
      <div class="repair-admin-body">
        <div class="repair-admin-grid">
          ${repairInput("data.repairPage.steps.kicker",p.steps.kicker,"العنوان الصغير")}
          ${repairInput("data.repairPage.steps.title",p.steps.title,"العنوان")}
          ${repairTextarea("data.repairPage.steps.subtitle",p.steps.subtitle,"الوصف")}
        </div>
        <div class="repair-admin-card-grid" style="margin-top:12px">${steps}</div>
      </div>
    </div>

    <div class="repair-admin-section">
      <div class="repair-admin-head"><div><h3>🔧 قسم الخدمات</h3><p>عنوان القسم فقط. الخدمات نفسها تُدار من «Diensten» حتى لا تتكرر البيانات.</p></div></div>
      <div class="repair-admin-body">
        <div class="repair-admin-grid">
          ${repairInput("data.repairPage.servicesSection.kicker",p.servicesSection.kicker,"العنوان الصغير")}
          ${repairInput("data.repairPage.servicesSection.title",p.servicesSection.title,"العنوان")}
          ${repairTextarea("data.repairPage.servicesSection.subtitle",p.servicesSection.subtitle,"الوصف")}
        </div>
      </div>
    </div>

    <div class="repair-admin-section">
      <div class="repair-admin-head"><div><h3>⭐ المزايا أسفل الصفحة</h3><p>النقاط مثل سرعة الخدمة والموثوقية والخبرة.</p></div><button class="btn btn-green" type="button" onclick="addRepairFeature()">＋ ميزة</button></div>
      <div class="repair-admin-body"><div class="repair-admin-card-grid">${features}</div></div>
    </div>
  `;
  enforceRepairAccordion(box);

}

/* ---------------- PHONES ---------------- */

function phoneFolderInfo(phone){
  const rawName=String(phone?.name||'Nieuw product').trim();
  const rawBrand=String(phone?.brand||'').trim();
  const rawCategory=String(phone?.category||'').trim();
  const text=`${rawBrand} ${rawCategory} ${rawName}`.toLowerCase();

  let group='Overige';
  const customMatch=phoneTreeCustomGroups.find(g=>text.includes(String(g).toLowerCase()));
  if(customMatch) group=customMatch;
  else if(/ipad/.test(text) || /tablet/.test(rawCategory.toLowerCase()) && /apple/.test(text)) group='iPad';
  else if(/samsung/.test(text)) group='Samsung';
  else if(/apple|iphone|macbook|ipad|airpods|apple watch/.test(text)) group='Apple';

  const storageMatch=rawName.match(/(?:^|[\s\-_])(64|128|256|512)\s*GB\b|(?:^|[\s\-_])1\s*TB\b/i);
  const storage=String(phone?.storage||phone?.geheugen||'').trim() || (storageMatch ? storageMatch[0].trim().replace(/^[-_\s]+/,'') : '');

  const colors=[
    'space grey','space gray','midnight','starlight','deep purple','natural titanium','black titanium','white titanium',
    'zwart','wit','blauw','groen','rood','roze','paars','geel','oranje','bruin','grijs','goud','zilver','koraal',
    'black','white','blue','green','red','pink','purple','yellow','orange','brown','grey','gray','gold','silver','coral'
  ];
  let color=String(phone?.color||phone?.kleur||'').trim();
  if(!color){
    const lower=rawName.toLowerCase();
    color=colors.find(c=>lower.includes(c)) || '';
  }

  let model=rawName;
  if(storage) model=model.replace(new RegExp(storage.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'ig'),' ');
  if(color) model=model.replace(new RegExp(color.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'ig'),' ');
  model=model.replace(/\s+/g,' ').replace(/\s*[-|–—]\s*/g,' ').trim();
  if(!model) model=rawName;

  return {group,model,storage:storage||'Algemeen',color:color||'Algemeen'};
}

function phoneTreeBrandIcon(group){
  const icons={Apple:'',Samsung:'▣','iPad':'▱',Mac:'',Xiaomi:'◆',Google:'G',OnePlus:'＋',Overige:'•'};
  return icons[group]||'•';
}

function phoneTreeMatches(phone,info){
  const q=String(phoneTreeSearch||'').trim().toLowerCase();
  const brandOk=phoneTreeBrand==='Alle' || info.group===phoneTreeBrand;
  if(!brandOk) return false;
  if(!q) return true;
  const hay=[phone.name,phone.brand,phone.category,phone.sku,phone.storage,phone.color,phone.kleur,info.group,info.model,info.storage,info.color]
    .filter(v=>v!==undefined&&v!==null).join(' ').toLowerCase();
  return hay.includes(q);
}

function renderPhoneFolderTree(){
  const products=data.phones.map((phone,index)=>({phone,index,info:phoneFolderInfo(phone)}))
    .filter(({phone,info})=>phoneTreeMatches(phone,info))
    .sort((a,b)=>{
      const brandOrder=['Apple','Samsung','iPad','Mac','Xiaomi','Google','OnePlus','Overige'];
      const ai=brandOrder.indexOf(a.info.group),bi=brandOrder.indexOf(b.info.group);
      if(ai!==bi)return (ai<0?999:ai)-(bi<0?999:bi);
      const brandCompare=String(a.info.group||'').localeCompare(String(b.info.group||''),undefined,{numeric:true,sensitivity:'base'});
      if(brandCompare!==0)return brandCompare;
      const modelCompare=String(a.info.model||a.phone.name||'').localeCompare(String(b.info.model||b.phone.name||''),undefined,{numeric:true,sensitivity:'base'});
      if(modelCompare!==0)return modelCompare;
      const storageCompare=String(a.info.storage||'').localeCompare(String(b.info.storage||''),undefined,{numeric:true,sensitivity:'base'});
      if(storageCompare!==0)return storageCompare;
      return String(a.info.color||'').localeCompare(String(b.info.color||''),undefined,{numeric:true,sensitivity:'base'});
    });
  if(!products.length)return `<div class="phone-tree-empty"><div class="phone-tree-empty-icon">⌕</div><strong>Geen producten gevonden</strong><span>Probeer een andere zoekterm of kies een ander merk.</span></div>`;
  const rows=products.map(({phone,index,info})=>{
    const model=String(info.model||phone.name||'Telefoon').trim();
    const storage=String(info.storage||'').trim();
    const color=String(info.color||'').trim();
    const label=[model,storage&&storage!=='Algemeen'?storage:'',color&&color!=='Algemeen'?color:''].filter(Boolean).join(' ');
    const price=Number(phone.price||phone.salePrice||phone.sellPrice||0);
    const stock=phone.stock===undefined||phone.stock===null||phone.stock===''?'':String(phone.stock);
    const isSelected=index===selectedPhoneIndex&&phoneEditOnly;
    return `<div class="phone-variant-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-bottom:1px solid #e5e7eb;background:${isSelected?'#eff6ff':'#fff'}">
      <div class="phone-variant-main" style="min-width:0;flex:1;display:flex;flex-direction:column;gap:4px">
        <strong style="overflow-wrap:anywhere">${esc(label)}</strong>
        <span style="color:#64748b;font-size:13px">${esc(info.group||phone.brand||'Overige')}${phone.condition?' · '+esc(phone.condition):''}${stock!==''?' · Voorraad: '+esc(stock):''}${price>0?' · €'+price.toFixed(2).replace('.',','):''}</span>
      </div>
      <div style="display:flex;gap:6px;flex:0 0 auto;align-items:center">
        <button type="button" class="phone-variant-edit" onclick="openPhoneEditor(${index})">✎ Bewerken</button>
        <button type="button" class="phone-product-card-delete" style="border:1px solid #fecaca;background:#fee2e2;color:#b91c1c;border-radius:8px;padding:8px 10px;cursor:pointer;font-weight:800" onclick="deletePhone(${index})" aria-label="Product verwijderen" title="Product verwijderen">🗑 Verwijderen</button>
      </div>
    </div>`;
  }).join('');
  return `<div class="phone-folder-group" style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
    <div class="phone-folder-group-head" style="padding:14px 16px;border-bottom:1px solid #e2e8f0">
      <div class="phone-folder-group-title">📱 Alle telefoons</div>
      <span class="phone-folder-group-count">${products.length} producten · alfabetisch en per geheugen/kleur</span>
    </div>
    <div class="phone-flat-list">${rows}</div>
  </div>`;
}

function openPhoneEditor(i){
  phoneWizardExistingEdit=true;
  selectedPhoneIndex=Number(i);
  const phone=data.phones[selectedPhoneIndex];
  if(!phone){return;}
  // Use the same guided editor for both adding and editing. Reconstruct the
  // selectable combinations from existing variant rows first; never from a
  // generic list of possible phone capacities/colors.
  const rows=Array.isArray(phone.variantPrices)?phone.variantPrices:[];
  const unique=(values)=>[...new Set(values.map(v=>String(v||"").trim()).filter(Boolean))];
  const fromRows=key=>unique(rows.filter(row=>row&&row.active!==false).map(row=>row[key]));
  const fromOptions=key=>unique((Array.isArray(phone[key])?phone[key]:[]).filter(x=>x&&x.active!==false&&x.enabled!==false).map(x=>x.label));
  const scalar=(key)=>String(phone[key]||"").trim();
  const conditions=fromRows("condition"), colors=fromRows("color"), storages=fromRows("storage");
  // Keep colors that already have photos/options even when no active price row references them.
  const photoColorKeys=Object.keys(phone.colorGalleryImages&&typeof phone.colorGalleryImages==="object"?phone.colorGalleryImages:{});
  const legacyColorKeys=Object.keys(phone.colorImages&&typeof phone.colorImages==="object"?phone.colorImages:{});
  const optionColorKeys=(Array.isArray(phone.colorOptions)?phone.colorOptions:[]).map(o=>o?.label);
  phone.setupColors=[...new Set([...colors,...fromOptions("colorOptions"),...optionColorKeys,...photoColorKeys,...legacyColorKeys,scalar("color")].map(v=>String(v||"").trim()).filter(Boolean))];
  phone.setupStorages=storages.length?storages:(fromOptions("storageOptions").length?fromOptions("storageOptions"):(scalar("storage")?[scalar("storage")]:[]));
  phone.setupConditions=conditions.length?conditions:(fromOptions("conditionOptions").length?fromOptions("conditionOptions"):(scalar("condition")?[scalar("condition")]:[]));
  phone.setupStorages=storages.length?storages:(fromOptions("storageOptions").length?fromOptions("storageOptions"):(scalar("storage")?[scalar("storage")]:[]));
  phone.setupStep=1;
  phone.setupWizard=true;
  phone.setupDone=false;
  if(!Array.isArray(phone.images))phone.images=["","","",""];
  while(phone.images.length<4)phone.images.push("");
  if(!phone.colorImages||typeof phone.colorImages!=="object")phone.colorImages={};
  if(!phone.colorGalleryImages||typeof phone.colorGalleryImages!=="object")phone.colorGalleryImages={};

  // Restore all legacy photo formats into the four-slot editor without overwriting
  // any existing gallery photo. Older catalog entries used colorImages,
  // colorOptions[].image, variantPrices[].image, or a single product image.
  const findColorKey=(object,color)=>{
    const wanted=String(color||"").trim().toLocaleLowerCase();
    return Object.keys(object||{}).find(key=>String(key).trim().toLocaleLowerCase()===wanted);
  };
  const photoValues=value=>{
    if(typeof value==="string")return value.trim()?[value]:[];
    if(Array.isArray(value))return value.flatMap(photoValues);
    return [];
  };
  const basePhotos=photoValues(phone.images);
  if(!basePhotos.length){
    const legacyBase=photoValues(phone.image||phone.imageUrl||phone.photo||phone.galleryImages);
    if(legacyBase.length)phone.images=legacyBase.slice(0,4);
  }
  (phone.setupColors||[]).forEach(color=>{
    const galleryKey=findColorKey(phone.colorGalleryImages,color);
    let gallery=galleryKey?phone.colorGalleryImages[galleryKey]:null;
    if(!Array.isArray(gallery))gallery=[];
    gallery=gallery.slice(0,4);
    while(gallery.length<4)gallery.push("");

    const imageKey=findColorKey(phone.colorImages,color);
    const option=(phone.colorOptions||[]).find(o=>String(o?.label||"").trim().toLocaleLowerCase()===String(color).trim().toLocaleLowerCase());
    const variantRows=(Array.isArray(phone.variantPrices)?phone.variantPrices:[]).filter(row=>String(row?.color||"").trim().toLocaleLowerCase()===String(color).trim().toLocaleLowerCase());
    const legacyPhotos=[
      ...photoValues(imageKey?phone.colorImages[imageKey]:""),
      ...photoValues(option?.image),
      // Do not use "row.images || row.image": an empty images array is truthy
      // and masks a valid legacy row.image/row.imageUrl/photo used by the storefront.
      ...variantRows.flatMap(row=>[
        ...photoValues(row?.images),
        ...photoValues(row?.image),
        ...photoValues(row?.imageUrl),
        ...photoValues(row?.photo)
      ])
    ];
    let next=0;
    for(const photo of legacyPhotos){
      while(next<4&&gallery[next])next++;
      if(next>=4)break;
      gallery[next++]=photo;
    }
    phone.colorGalleryImages[color]=gallery;
    if(!phone.colorImages[color]&&gallery.some(Boolean))phone.colorImages[color]=gallery.find(Boolean);
  });
  phoneEditOnly=true;
  renderPhones();
  window.scrollTo({top:0,behavior:'smooth'});
}

function showPhoneCatalog(){
  phoneEditOnly=false;
  const phone=data.phones&&data.phones[selectedPhoneIndex];
  if(phone&&phone.setupWizard){
    phone.setupWizard=false;
    delete phone.setupDone;
  }
  renderPhones();
  window.scrollTo({top:0,behavior:'smooth'});
}

function setPhoneTreeBrand(brand){
  phoneTreeBrand=brand;
  renderPhones();
}

function addPhoneTreeGroup(){
  const name=prompt('Naam van de nieuwe map, bijvoorbeeld iPhone 18 Pro of Galaxy S26:');
  const clean=String(name||'').trim();
  if(!clean) return;
  const brand=prompt('Merk voor deze map:',phoneTreeBrand!=='Alle'?phoneTreeBrand:'Apple');
  const cleanBrand=String(brand||'').trim()||'Overige';
  if(!Array.isArray(data.phoneFolders)) data.phoneFolders=[];
  const exists=data.phoneFolders.some(x=>String(x.model||'').toLowerCase()===clean.toLowerCase()&&String(x.group||'').toLowerCase()===cleanBrand.toLowerCase());
  const alreadyHasPhone=data.phones.some(x=>{const info=phoneFolderInfo(x);return info.model.toLowerCase()===clean.toLowerCase()&&info.group.toLowerCase()===cleanBrand.toLowerCase();});
  if(exists||alreadyHasPhone){phoneTreeBrand=cleanBrand;renderPhones();alert('Deze map bestaat al.');return;}
  data.phoneFolders.push({group:cleanBrand,model:clean});
  phoneTreeBrand=cleanBrand;
  markChanged();
  renderPhones();
}

function handlePhoneFolderImage(event,group,model){
  const file=event.target.files && event.target.files[0];
  if(!file) return;
  if(!file.type.startsWith('image/')){alert('Kies een afbeelding.');event.target.value='';return;}
  if(file.size>2*1024*1024){alert('De afbeelding mag maximaal 2 MB zijn.');event.target.value='';return;}
  if(!Array.isArray(data.phoneFolders)) data.phoneFolders=[];
  let folder=data.phoneFolders.find(x=>String(x.group||'').toLowerCase()===String(group||'').toLowerCase()&&String(x.model||'').toLowerCase()===String(model||'').toLowerCase());
  if(!folder){
    folder={group:String(group||'Overige').trim()||'Overige',model:String(model||'').trim(),image:''};
    data.phoneFolders.push(folder);
  }
  const reader=new FileReader();
  reader.onload=()=>{
    folder.image=reader.result;
    markChanged();
    renderPhones();
  };
  reader.readAsDataURL(file);
}

function addPhoneInFolder(group,model){
  const cleanGroup=String(group||'Overige').trim()||'Overige';
  const cleanModel=String(model||'Nieuwe telefoon').trim()||'Nieuwe telefoon';
  data.phones.push({
    name:cleanModel,brand:cleanGroup,price:"",storage:"",color:"",
    condition:"Zichtbaar gebruikt",warranty:"12 maanden",description:"",subtitle:"",
    sku:"",stock:0,category:"Smartphones",connectivity:"",processor:"",memory:"",
    gpu:"",screenSize:"",releaseYear:"",images:["","","",""],conditionDetails:[],specifications:[]
  });
  normalizePhoneOptions(data.phones[data.phones.length-1]);
  selectedPhoneIndex=data.phones.length-1;
  phoneEditOnly=true;
  markChanged();
  renderPhones();
  window.scrollTo({top:0,behavior:'smooth'});
}

// Re-render the phone editor without losing the active input or cursor position.
function renderPhonesPreserveFocus(input){
  const key = input?.dataset?.focusKey;
  const start = typeof input?.selectionStart === "number" ? input.selectionStart : null;
  const end = typeof input?.selectionEnd === "number" ? input.selectionEnd : null;
  renderPhones();
  if(!key) return;
  const next = document.querySelector('[data-focus-key="' + key + '"]');
  if(!next) return;
  next.focus({preventScroll:true});
  if(start !== null && end !== null && typeof next.setSelectionRange === "function"){
    try{ next.setSelectionRange(start,end); }catch{}
  }
}

function phoneBulkModelFamily(name){
  return String(name||"").trim().toLocaleLowerCase().replace(/\s+/g," ");
}
function phoneBulkMatchesSearch(name,query){
  const q=String(query||"").trim().toLocaleLowerCase().replace(/\s+/g," ");
  if(!q)return true;
  return phoneBulkModelFamily(name).includes(q);
}
function renderPhoneBulkModelResultsHtml(){
  const products=(data.phones||[]).map((p,i)=>({p,i})).filter(x=>Array.isArray(x.p.variantPrices)&&x.p.variantPrices.some(r=>r&&r.active!==false));
  const query=String(phoneBulkSearchText||"").trim();
  const matches=products.filter(x=>phoneBulkMatchesSearch(x.p.name,query));
  if(!matches.length)return '<div class="small" style="padding:10px">Geen modellen gevonden. Probeer bijvoorbeeld iPhone 11 of iPhone 12.</div>';
  return matches.map(x=>`<button type="button" style="display:block;width:100%;text-align:left;border:0;border-bottom:1px solid #edf0f5;background:${x.i===phoneBulkPricingModelIndex?'#e8f5ee':'white'};padding:10px 12px" onclick="phoneBulkPricingModelIndex=${x.i};phoneBulkSelectedRows.clear();renderPhoneBulkPricing()">${esc(x.p.name||"Onbenoemd product")} <span class="small">· ${x.p.variantPrices.filter(r=>r&&r.active!==false).length} uitvoeringen</span></button>`).join("");
}
function renderPhoneBulkModelResults(){
  const el=document.getElementById("phone-bulk-model-results");
  if(el)el.innerHTML=renderPhoneBulkModelResultsHtml();
}
function phoneBulkRowKey(modelIndex,rowIndex){return String(modelIndex)+":"+String(rowIndex);}
let phoneBulkCurrentProductIndexes=[];
function phoneBulkFamilyName(phone){
  let name=String(phone?.name||"Onbenoemd product").trim();
  const colors=[...new Set((phone?.variantPrices||[]).map(r=>String(r?.color||"").trim()).filter(Boolean))].sort((a,b)=>b.length-a.length);
  for(const color of colors){if(name.toLocaleLowerCase().endsWith(" "+color.toLocaleLowerCase())){name=name.slice(0,-color.length-1).trim();break;}}
  name=name.replace(/\s+\d+\s*(?:GB|TB|MB)\s*$/i,"").trim();
  return name||String(phone?.name||"Onbenoemd product").trim();
}
function phoneBulkSetRow(modelIndex,rowIndex,checked){
  const key=phoneBulkRowKey(modelIndex,rowIndex);
  if(checked)phoneBulkSelectedRows.add(key);else phoneBulkSelectedRows.delete(key);
}
function phoneBulkRenderStorageGroup(group){
  let html='<section style="border:1px solid #dbe2ea;border-radius:12px;overflow:hidden;margin:14px 0">'
    +'<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#f1f5f9;padding:12px 14px"><input type="checkbox" aria-label="Selecteer alle '+esc(group.storage)+' uitvoeringen" onchange="phoneBulkSelectStorage(\''+String(group.storage).replace(/\'/g,"\\\\\'")+'\',this.checked)" '+(group.rows.length&&group.rows.every(x=>phoneBulkSelectedRows.has(phoneBulkRowKey(x.modelIndex,x.rowIndex)))?'checked':'')+'><strong style="font-size:17px">'+esc(group.storage)+'</strong><span class="small">'+group.conditionGroups.reduce((n,c)=>n+c.colors.length,0)+' unieke kleur/staat-combinaties</span></div>';
  group.conditionGroups.forEach(cg=>{
    html+='<div style="border-top:1px solid #dbe2ea"><div style="background:#f8fafc;padding:11px 14px;font-weight:800;color:#334155"> '+esc(cg.condition)+'</div><div style="overflow:auto"><table style="width:100%;border-collapse:collapse;min-width:720px"><thead><tr><th style="padding:9px;text-align:center">Kies</th><th style="padding:9px;text-align:left">Kleur</th><th style="padding:9px;text-align:left">Geheugen</th><th style="padding:9px;text-align:left">Voorraad</th><th style="padding:9px;text-align:left">Prijs (€)</th><th style="padding:9px;text-align:center">Beschikbaar</th></tr></thead><tbody>';
    cg.colors.forEach(entry=>{
      const first=entry.rows[0];if(!first)return;const row=first.row,phone=first.phone;
      const q=JSON.stringify([group.storage,cg.condition,entry.color]);
      const selected=entry.rows.every(x=>phoneBulkSelectedRows.has(phoneBulkRowKey(x.modelIndex,x.rowIndex)));
      html+='<tr style="border-top:1px solid #edf0f5"><td style="text-align:center;padding:9px"><input type="checkbox" '+(selected?'checked':'')+' onchange="phoneBulkSetVariantGroup.apply(null,'+esc(JSON.stringify([group.storage,cg.condition,entry.color]))+' .concat([this.checked]))"></td><td style="padding:9px">' +esc(entry.color||"—")+'</td><td style="padding:9px">' +esc(group.storage)+'</td><td style="padding:9px"><input type="number" min="0" step="1" value="'+esc(row.stock??phone.stock??0)+'" style="width:85px" oninput="phoneBulkUpdateVariantGroup.apply(null,'+esc(JSON.stringify([group.storage,cg.condition,entry.color,"stock"]))+' .concat([this.value]))"></td><td style="padding:9px"><input type="number" min="0" step="0.01" value="'+esc(row.price??0)+'" style="width:100px" oninput="phoneBulkUpdateVariantGroup.apply(null,'+esc(JSON.stringify([group.storage,cg.condition,entry.color,"price"]))+' .concat([this.value]))"></td><td style="text-align:center;padding:9px"><input type="checkbox" '+(row.available!==false?'checked':'')+' onchange="phoneBulkUpdateVariantGroup.apply(null,'+esc(JSON.stringify([group.storage,cg.condition,entry.color,"available"]))+' .concat([this.checked]))"></td></tr>';
    });
    html+='</tbody></table></div></div>';
  });
  return html+'</section>';
}
function phoneBulkMatchingVariantRows(storage,condition,color){
  const matches=[];const sk=canonicalPhoneStorageLabel(storage).toLocaleLowerCase(),ck=String(condition||"").trim().toLocaleLowerCase(),col=String(color||"").trim().toLocaleLowerCase();
  phoneBulkCurrentProductIndexes.forEach(modelIndex=>{const p=data.phones?.[modelIndex];if(!p)return;(p.variantPrices||[]).forEach((row,rowIndex)=>{if(!row||row.active===false)return;if(canonicalPhoneStorageLabel(row.storage).toLocaleLowerCase()!==sk)return;if(String(row.condition||row.state||"").trim().toLocaleLowerCase()!==ck)return;if(String(row.color||"").trim().toLocaleLowerCase()!==col)return;matches.push({modelIndex,rowIndex,row});});});return matches;
}
function phoneBulkSetVariantGroup(storage,condition,color,checked){phoneBulkMatchingVariantRows(storage,condition,color).forEach(x=>phoneBulkSetRow(x.modelIndex,x.rowIndex,checked));renderPhoneBulkPricing();}
function phoneBulkUpdateVariantGroup(storage,condition,color,field,value){const next=field==="available"?Boolean(value):field==="stock"?Math.max(0,Number(value||0)):Number(value||0);phoneBulkMatchingVariantRows(storage,condition,color).forEach(x=>{data.phones[x.modelIndex].variantPrices[x.rowIndex][field]=next;});markChanged();}
function phoneBulkSelectStorage(storage,checked){
  phoneBulkCurrentProductIndexes.forEach(modelIndex=>{
    const phone=data.phones?.[modelIndex];if(!phone)return;
    (phone.variantPrices||[]).forEach((row,i)=>{if(canonicalPhoneStorageLabel(row.storage)===canonicalPhoneStorageLabel(storage))phoneBulkSetRow(modelIndex,i,checked);});
  });
  renderPhoneBulkPricing();
}
function phoneBulkSelectFiltered(checked){
  const color=phoneBulkFilterColor,storage=phoneBulkFilterStorage,condition=phoneBulkFilterCondition;
  phoneBulkCurrentProductIndexes.forEach(modelIndex=>{
    const phone=data.phones?.[modelIndex];if(!phone)return;
    (phone.variantPrices||[]).forEach((row,i)=>{
      if(!row||row.active===false)return;
      const matchColor=!color||String(row.color||"").trim()===color;
      const matchStorage=!storage||canonicalPhoneStorageLabel(row.storage)===canonicalPhoneStorageLabel(storage);
      const matchCondition=!condition||String(row.condition||"").trim()===condition;
      if(matchColor&&matchStorage&&matchCondition)phoneBulkSetRow(modelIndex,i,checked);
    });
  });
  renderPhoneBulkPricing();
}
function phoneBulkSelectAll(checked){
  phoneBulkCurrentProductIndexes.forEach(modelIndex=>{
    const phone=data.phones?.[modelIndex];if(!phone)return;
    (phone.variantPrices||[]).forEach((row,i)=>{if(row&&row.active!==false)phoneBulkSetRow(modelIndex,i,checked);});
  });
  renderPhoneBulkPricing();
}
function phoneBulkApply(kind){
  const selected=[];
  phoneBulkCurrentProductIndexes.forEach(modelIndex=>{
    const phone=data.phones?.[modelIndex];if(!phone)return;
    (phone.variantPrices||[]).forEach((row,i)=>{if(row&&phoneBulkSelectedRows.has(phoneBulkRowKey(modelIndex,i)))selected.push({row,modelIndex,i});});
  });
  if(!selected.length){alert("Selecteer eerst minimaal één uitvoering.");return;}
  if(kind==="price"){
    const input=document.getElementById("phone-bulk-price"),value=Number(input?.value);
    if(!input||input.value.trim()===""||!Number.isFinite(value)||value<=0){alert("Vul een geldige prijs groter dan € 0 in.");return;}
    selected.forEach(x=>x.row.price=value);
  }else if(kind==="stock"){
    const input=document.getElementById("phone-bulk-stock"),value=Number(input?.value);
    if(!input||input.value.trim()===""||!Number.isInteger(value)||value<0){alert("Vul een geldig voorraad-aantal in (0 of hoger).");return;}
    selected.forEach(x=>x.row.stock=value);
  }else if(kind==="available"){
    const value=document.getElementById("phone-bulk-available")?.value;
    if(!["yes","no"].includes(value)){alert("Kies eerst een beschikbaarheidsstatus.");return;}
    selected.forEach(x=>x.row.available=value==="yes");
  }
  markChanged();renderPhoneBulkPricing();
}
function phoneBulkReturnToCatalog(){phoneBulkPricingView=false;phoneEditOnly=false;renderPhones();}
function renderPhoneBulkPricing(){
  const box=document.getElementById("phonesList");if(!box)return;
  const products=(data.phones||[]).map((p,i)=>({p,i,family:phoneBulkFamilyName(p)})).filter(x=>Array.isArray(x.p.variantPrices)&&x.p.variantPrices.length);
  const familyMap=new Map();
  products.forEach(x=>{if(!familyMap.has(x.family))familyMap.set(x.family,[]);familyMap.get(x.family).push(x);});
  const families=[...familyMap.keys()].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  if(!families.length){
    box.innerHTML='<div class="card"><h2>Collectieve prijzen</h2><p>Er zijn nog geen producten met uitvoeringen/prijzen. Stel eerst per telefoon de uitvoeringen in.</p><button type="button" class="btn btn-light" onclick="phoneBulkReturnToCatalog()">← Terug naar telefoons</button></div>';return;
  }
  if(!families.includes(phoneBulkPricingModelIndex))phoneBulkPricingModelIndex=families[0];
  const family=phoneBulkPricingModelIndex;
  const familyProducts=familyMap.get(family)||[];
  phoneBulkCurrentProductIndexes=familyProducts.map(x=>x.i);
  const allRows=[];
  familyProducts.forEach(({p,i})=>(p.variantPrices||[]).forEach((row,j)=>{if(row&&row.active!==false)allRows.push({row,modelIndex:i,rowIndex:j,phone:p});}));
  const storages=[...new Set(allRows.map(x=>canonicalPhoneStorageLabel(x.row.storage)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const colors=[...new Set(allRows.map(x=>String(x.row.color||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const groups=storages.map(storage=>{
    const storageRows=allRows.filter(x=>canonicalPhoneStorageLabel(x.row.storage)===storage);
    const conditions=[...new Set(storageRows.map(x=>String(x.row.condition||x.row.state||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    const conditionGroups=conditions.map(condition=>{
      const matching=storageRows.filter(x=>String(x.row.condition||x.row.state||"").trim().toLocaleLowerCase()===condition.toLocaleLowerCase());
      const colors=[...new Set(matching.map(x=>String(x.row.color||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
      return {condition,colors:colors.map(color=>({color,rows:matching.filter(x=>String(x.row.color||"").trim().toLocaleLowerCase()===color.toLocaleLowerCase())}))};
    });
    return {storage,rows:storageRows,conditionGroups};
  });
  const countSelected=allRows.filter(x=>phoneBulkSelectedRows.has(phoneBulkRowKey(x.modelIndex,x.rowIndex))).length;
  box.innerHTML=`<div class="card" style="max-width:1500px;margin:0 auto;padding:clamp(14px,2vw,26px)">
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">
      <div><div class="small">HOMS TECH · PRIJZENBEHEER</div><h2 style="margin:5px 0">Collectieve prijzen per iPhone</h2><p class="small">Kies het basismodel. Alle geregistreerde kleuren, geheugens en toestanden van dit model worden hieronder getoond.</p></div>
      <button type="button" class="btn btn-light" onclick="phoneBulkReturnToCatalog()">← Terug naar telefoons</button>
    </div>
    <div class="grid" style="margin:16px 0">
      <div class="field"><label>Zoek iPhone-model</label><input id="phone-bulk-model-search" type="search" placeholder="Bijv. iPhone 11, iPhone 12 Pro, iPhone 11 Pro Max" value="${esc(family)}" oninput="phoneBulkFilterModels(this.value)"><div id="phone-bulk-model-results" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">${families.filter(f=>f.toLocaleLowerCase().includes(family.toLocaleLowerCase())).map(f=>`<button type="button" class="btn ${f===family?'btn-green':'btn-light'}" onclick="phoneBulkChooseFamily('${f.replace(/\\/g,"\\\\").replace(/'/g,"\\'")}')">${esc(f)}</button>`).join("")}</div></div>
      <div class="field"><label>Geselecteerde uitvoeringen</label><div style="padding:12px;border:1px solid #dbe2ea;border-radius:9px;font-weight:800">${countSelected}</div><div class="small">${familyProducts.length} productrecord(s) samengevoegd</div></div>
    </div>
    <section style="border:1px solid #dbe2ea;border-radius:12px;padding:14px;margin:16px 0;background:#fff">
      <h3 style="margin:0 0 6px">Kleuren en geheugens beheren</h3>
      <p class="small">Je kunt kleuren en geheugens toevoegen of verwijderen voor alleen dit model. Verwijderen wist de bijbehorende uitvoeringen; controleer eerst voorraad en prijzen.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0"><input id="phone-bulk-new-color" type="text" maxlength="60" placeholder="Nieuwe kleur, bijvoorbeeld Roze" style="min-width:220px;flex:1"><button type="button" class="btn btn-green" onclick="phoneBulkAddColor()">Kleur toevoegen</button></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0"><select id="phone-bulk-remove-color" style="min-width:200px"><option value="">Kleur verwijderen...</option>${colors.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join("")}</select><button type="button" class="btn btn-light" onclick="phoneBulkRemoveColor()">Verwijder kleur en uitvoeringen</button></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0"><input id="phone-bulk-new-storage" type="text" maxlength="20" placeholder="Nieuwe geheugen, bijvoorbeeld 2 TB" style="min-width:220px;flex:1"><button type="button" class="btn btn-green" onclick="phoneBulkAddStorage()">Geheugen toevoegen</button></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0"><select id="phone-bulk-remove-storage" style="min-width:200px"><option value="">Geheugen verwijderen...</option>${storages.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join("")}</select><button type="button" class="btn btn-light" onclick="phoneBulkRemoveStorage()">Verwijder geheugen en uitvoeringen</button></div>
      <h4 style="margin:18px 0 8px">Vier fotos per kleur</h4><p class="small">Voeg maximaal vier afbeeldingen toe aan iedere kleur.</p>
      ${colors.map(color=>phoneBulkColorGalleryHtml(color)).join("")}
    </section>
    <section style="padding:14px;border:1px solid #dbe2ea;border-radius:12px;margin:16px 0;background:#fff">
      <h3 style="margin:0 0 5px">Selecteer uitvoeringen op kenmerken</h3>
      <p class="small" style="margin-bottom:12px">Kies optioneel kleur, geheugen en staat. Gebruik daarna de knop om alle overeenkomende uitvoeringen te selecteren voor dezelfde prijs of voorraad.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
        <div class="field"><label>Kleur</label><select id="phone-bulk-filter-color" onchange="phoneBulkFilterColor=this.value"><option value="">Alle kleuren</option>${colors.map(v=>'<option value="'+esc(v)+'"'+(phoneBulkFilterColor===v?' selected':'')+'>'+esc(v)+'</option>').join('')}</select></div>
        <div class="field"><label>Geheugen</label><select id="phone-bulk-filter-storage" onchange="phoneBulkFilterStorage=this.value"><option value="">Alle geheugens</option>${storages.map(v=>'<option value="'+esc(v)+'"'+(phoneBulkFilterStorage===v?' selected':'')+'>'+esc(v)+'</option>').join('')}</select></div>
        <div class="field"><label>Staat</label><select id="phone-bulk-filter-condition" onchange="phoneBulkFilterCondition=this.value"><option value="">Alle staten</option>${[...new Set(allRows.map(x=>String(x.row.condition||'').trim()).filter(Boolean))].sort().map(v=>'<option value="'+esc(v)+'"'+(phoneBulkFilterCondition===v?' selected':'')+'>'+esc(v)+'</option>').join('')}</select></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button type="button" class="btn btn-green" onclick="phoneBulkSelectFiltered(true)">Selecteer alle overeenkomende uitvoeringen</button><button type="button" class="btn btn-light" onclick="phoneBulkSelectFiltered(false)">Deselecteer overeenkomende uitvoeringen</button></div>
    </section>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;padding:14px;background:#f8fafc;border:1px solid #dbe2ea;border-radius:12px;margin-bottom:16px">
      <div class="field" style="margin:0;min-width:150px;flex:1"><label>Prijs voor selectie (€)</label><input id="phone-bulk-price" type="number" min="0.01" step="0.01" placeholder="Bijv. 229"></div>
      <button type="button" class="btn btn-green" onclick="phoneBulkApply('price')">Pas prijs toe</button>
      <div class="field" style="margin:0;min-width:120px;flex:1"><label>Voorraad voor selectie</label><input id="phone-bulk-stock" type="number" min="0" step="1" placeholder="Bijv. 1"></div>
      <button type="button" class="btn btn-light" onclick="phoneBulkApply('stock')">Pas voorraad toe</button>
      <div class="field" style="margin:0;min-width:150px;flex:1"><label>Beschikbaarheid</label><select id="phone-bulk-available"><option value="">Kies status</option><option value="yes">Verkrijgbaar</option><option value="no">Niet beschikbaar</option></select></div>
      <button type="button" class="btn btn-light" onclick="phoneBulkApply('available')">Pas status toe</button>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"><button class="btn btn-light" type="button" onclick="phoneBulkSelectAll(true)">Selecteer alle uitvoeringen</button><button class="btn btn-light" type="button" onclick="phoneBulkSelectAll(false)">Deselecteer alles</button><span class="small" style="align-self:center">De prijs wordt alleen aangepast bij de aangevinkte rijen.</span></div>
    ${groups.map(group=>phoneBulkRenderStorageGroup(group)).join("")}
    <div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:18px"><button type="button" class="btn btn-light" onclick="phoneBulkReturnToCatalog()">Terug</button><button type="button" class="btn btn-green" onclick="save(false)">💾 Wijzigingen opslaan</button></div>
  </div>`;
}
let phoneBulkColorGalleryDraft={};
function phoneBulkGetColorGallery(color){if(!phoneBulkColorGalleryDraft[color]){const family=(data.phones||[]).filter(p=>phoneBulkFamilyName(p)===phoneBulkPricingModelIndex);let imgs=[];for(const p of family){if(Array.isArray(p.colorGalleryImages?.[color])){imgs=p.colorGalleryImages[color].slice(0,4);break;}}if(!imgs.length){const p=family.find(p=>p.colorImages&&p.colorImages[color]);imgs=[p?.colorImages?.[color]||'','','',''];}while(imgs.length<4)imgs.push('');phoneBulkColorGalleryDraft[color]=imgs;}return phoneBulkColorGalleryDraft[color];}
function phoneBulkAddColor(){
  const input=document.getElementById("phone-bulk-new-color");
  const color=String(input?.value||"").trim();
  if(!color){alert("Vul eerst een kleurnaam in.");return;}
  const family=(data.phones||[]).filter(p=>phoneBulkFamilyName(p)===phoneBulkPricingModelIndex&&Array.isArray(p.variantPrices));
  if(!family.length){alert("Geen uitvoeringen gevonden voor dit model.");return;}
  const existing=[...new Set(family.flatMap(p=>(p.variantPrices||[]).map(r=>String(r?.color||"").trim())).filter(Boolean))];
  if(existing.some(x=>x.toLocaleLowerCase()===color.toLocaleLowerCase())){alert("Deze kleur bestaat al voor dit model. Kies hem in de lijst en voeg de fotos toe.");return;}
  const rows=family.flatMap(p=>(p.variantPrices||[]).filter(r=>r&&r.active!==false).map(r=>({row:r,phone:p,storage:canonicalPhoneStorageLabel(r.storage||""),condition:String(r.condition||r.state||"").trim()})));
  const storages=[...new Set(rows.map(x=>x.storage).filter(Boolean))];
  let conditions=[...new Set(rows.map(x=>x.condition).filter(Boolean))];
  if(!conditions.length)conditions=[...new Set(family.flatMap(p=>(p.conditionOptions||[]).map(o=>String(typeof o==="string"?o:o?.label||o?.value||"").trim())).filter(Boolean))];
  if(!storages.length||!conditions.length){alert("Dit model mist geheugen- of conditiegegevens in de uitvoeringen. Controleer eerst de opties van het model; er zijn geen varianten aangemaakt.");return;}
  const target=family[0];if(!Array.isArray(target.variantPrices))target.variantPrices=[];
  const added=[];
  storages.forEach(storage=>conditions.forEach(condition=>{
    const exists=family.some(p=>(p.variantPrices||[]).some(r=>r&&String(r.color||"").trim().toLocaleLowerCase()===color.toLocaleLowerCase()&&canonicalPhoneStorageLabel(r.storage)===storage&&String(r.condition||r.state||"").trim().toLocaleLowerCase()===condition.toLocaleLowerCase()));
    if(exists)return;
    const base=rows.find(x=>x.storage===storage&&(x.condition.toLocaleLowerCase()===condition.toLocaleLowerCase()||!x.condition))?.row||rows.find(x=>x.storage===storage)?.row||rows[0]?.row||{};
    const clone={...base,color,storage,condition,price:Number(base.price||0),stock:0,available:false,active:true};
    delete clone.image;delete clone.imageUrl;delete clone.photo;delete clone.images;
    target.variantPrices.push(clone);added.push(clone);
  }));
  if(!added.length){alert("Deze kleur heeft al alle geheugen- en conditiecombinaties.");return;}
  family.forEach(p=>{if(!p.colorImages||typeof p.colorImages!=="object")p.colorImages={};if(!p.colorGalleryImages||typeof p.colorGalleryImages!=="object")p.colorGalleryImages={};p.colorGalleryImages[color]=["","","",""];});
  phoneBulkColorGalleryDraft[color]=["","","",""];
  if(input)input.value="";
  markChanged();
  alert("Kleur toegevoegd met "+added.length+" combinaties. Voorraad is 0 en beschikbaarheid staat uit totdat je dit aanpast.");
  renderPhoneBulkPricing();
}
function phoneBulkFamilyRecords(){return (data.phones||[]).map((p,i)=>({p,i})).filter(x=>phoneBulkFamilyName(x.p)===phoneBulkPricingModelIndex&&Array.isArray(x.p.variantPrices));}
function phoneBulkResetAfterStructureChange(){phoneBulkSelectedRows.clear();phoneBulkColorGalleryDraft={};markChanged();renderPhoneBulkPricing();}
function phoneBulkRemoveColor(){
 const color=String(document.getElementById("phone-bulk-remove-color")?.value||"").trim();if(!color){alert("Kies eerst een kleur.");return;}
 const family=phoneBulkFamilyRecords();const count=family.reduce((n,x)=>n+x.p.variantPrices.filter(r=>String(r?.color||"").trim().toLocaleLowerCase()===color.toLocaleLowerCase()).length,0);
 if(!count){alert("Geen uitvoeringen gevonden voor deze kleur.");return;}if(!confirm("Kleur "+color+" en "+count+" bijbehorende uitvoeringen verwijderen? Deze actie kan niet ongedaan worden gemaakt nadat je opslaat."))return;
 family.forEach(({p})=>{p.variantPrices=p.variantPrices.filter(r=>String(r?.color||"").trim().toLocaleLowerCase()!==color.toLocaleLowerCase());if(p.colorImages)Object.keys(p.colorImages).filter(k=>k.toLocaleLowerCase()===color.toLocaleLowerCase()).forEach(k=>delete p.colorImages[k]);if(p.colorGalleryImages)Object.keys(p.colorGalleryImages).filter(k=>k.toLocaleLowerCase()===color.toLocaleLowerCase()).forEach(k=>delete p.colorGalleryImages[k]);});
 phoneBulkResetAfterStructureChange();
}
function phoneBulkAddStorage(){
 const input=document.getElementById("phone-bulk-new-storage");const storage=canonicalPhoneStorageLabel(String(input?.value||"").trim());if(!storage){alert("Vul een geheugen in, bijvoorbeeld 2 TB.");return;}
 const family=phoneBulkFamilyRecords();const rows=family.flatMap(x=>(x.p.variantPrices||[]).filter(r=>r&&r.active!==false).map(r=>({row:r,color:String(r.color||"").trim(),condition:String(r.condition||r.state||"").trim()})));
 if(!rows.length){alert("Geen uitvoeringen gevonden voor dit model.");return;}
 const existing=[...new Set(rows.map(x=>canonicalPhoneStorageLabel(x.row.storage)).filter(Boolean))];if(existing.some(x=>x.toLocaleLowerCase()===storage.toLocaleLowerCase())){alert("Dit geheugen bestaat al voor dit model.");return;}
 const colors=[...new Set(rows.map(x=>x.color).filter(Boolean))];
 let conditions=[...new Set(rows.map(x=>x.condition).filter(Boolean))];
 if(!conditions.length)conditions=[...new Set(family.flatMap(x=>(x.p.conditionOptions||[]).map(o=>String(typeof o==="string"?o:o?.label||o?.value||"").trim())).filter(Boolean))];
 if(!colors.length||!conditions.length){alert("Dit model mist kleur- of conditiegegevens. Er zijn geen varianten aangemaakt.");return;}
 const target=family[0].p;const added=[];
 colors.forEach(color=>conditions.forEach(condition=>{
   const exists=family.some(x=>(x.p.variantPrices||[]).some(r=>r&&canonicalPhoneStorageLabel(r.storage)===storage&&String(r.color||"").trim().toLocaleLowerCase()===color.toLocaleLowerCase()&&String(r.condition||r.state||"").trim().toLocaleLowerCase()===condition.toLocaleLowerCase()));
   if(exists)return;
   const base=rows.find(x=>x.color.toLocaleLowerCase()===color.toLocaleLowerCase()&&(x.condition.toLocaleLowerCase()===condition.toLocaleLowerCase()||!x.condition))?.row||rows.find(x=>x.color.toLocaleLowerCase()===color.toLocaleLowerCase())?.row||rows[0].row;
   const clone={...base,storage,color,condition,price:Number(base.price||0),stock:0,available:false,active:true};delete clone.image;delete clone.imageUrl;delete clone.photo;delete clone.images;target.variantPrices.push(clone);added.push(clone);
 }));
 if(!added.length){alert("Dit geheugen heeft al alle bestaande combinaties.");return;}
 if(input)input.value="";phoneBulkResetAfterStructureChange();alert("Geheugen "+storage+" toegevoegd voor "+added.length+" combinaties. Voorraad is 0 en verkoop staat uit totdat je dit aanpast.");
}
function phoneBulkRemoveStorage(){
 const storage=canonicalPhoneStorageLabel(String(document.getElementById("phone-bulk-remove-storage")?.value||"").trim());if(!storage){alert("Kies eerst een geheugen.");return;}
 const family=phoneBulkFamilyRecords();const count=family.reduce((n,x)=>n+x.p.variantPrices.filter(r=>canonicalPhoneStorageLabel(r?.storage)===storage).length,0);if(!count){alert("Geen uitvoeringen gevonden voor dit geheugen.");return;}
 if(!confirm("Geheugen "+storage+" en "+count+" bijbehorende uitvoeringen verwijderen uit dit model? Deze actie kan niet ongedaan worden gemaakt nadat je opslaat."))return;
 family.forEach(({p})=>{p.variantPrices=p.variantPrices.filter(r=>canonicalPhoneStorageLabel(r?.storage)!==storage);});phoneBulkResetAfterStructureChange();
}
function phoneBulkColorGalleryHtml(color){const imgs=phoneBulkGetColorGallery(color);let html='<div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin:12px 0"><strong style="display:block;margin-bottom:10px">'+esc(color)+'</strong><div style="display:grid;grid-template-columns:repeat(4,minmax(100px,1fr));gap:10px">';for(let slot=0;slot<4;slot++){html+='<div style="min-width:0;border:1px solid #e2e8f0;border-radius:8px;padding:8px">';html+=imgs[slot]?'<img src="'+esc(imgs[slot])+'" alt="" style="width:100%;height:105px;object-fit:contain;display:block;background:#f8fafc;border-radius:6px;margin-bottom:7px">':'<div style="height:105px;display:flex;align-items:center;justify-content:center;background:#f8fafc;border-radius:6px;margin-bottom:7px;color:#64748b;font-size:12px">Geen foto</div>';html+='<label class="small" style="display:block;margin-bottom:5px">Foto '+(slot+1)+'</label><input type="file" accept="image/*" onchange="phoneBulkHandleColorImage(event,'+JSON.stringify(color)+','+slot+')" style="width:100%;font-size:11px">';if(imgs[slot])html+='<button type="button" class="btn btn-light" style="margin-top:6px;padding:6px 8px;font-size:11px" onclick="phoneBulkRemoveColorImage('+JSON.stringify(color)+','+slot+')">Verwijderen</button>';html+='</div>';}return html+'</div></div>';}
function phoneBulkHandleColorImage(event,color,slot){const file=event.target.files&&event.target.files[0];if(!file)return;if(!file.type.startsWith('image/')){alert('Kies een afbeeldingsbestand.');event.target.value='';return;}if(file.size>2*1024*1024){alert('De afbeelding mag maximaal 2 MB zijn.');event.target.value='';return;}const reader=new FileReader();reader.onload=()=>{const imgs=phoneBulkGetColorGallery(color);imgs[slot]=String(reader.result||'');const family=(data.phones||[]).filter(p=>phoneBulkFamilyName(p)===phoneBulkPricingModelIndex);family.forEach(p=>{if(!p.colorGalleryImages||typeof p.colorGalleryImages!=='object')p.colorGalleryImages={};p.colorGalleryImages[color]=imgs.slice(0,4);if(!p.colorImages||typeof p.colorImages!=='object')p.colorImages={};if(imgs[0])p.colorImages[color]=imgs[0];else delete p.colorImages[color];});markChanged();renderPhoneBulkPricing();};reader.readAsDataURL(file);}
function phoneBulkRemoveColorImage(color,slot){const imgs=phoneBulkGetColorGallery(color);imgs[slot]='';const family=(data.phones||[]).filter(p=>phoneBulkFamilyName(p)===phoneBulkPricingModelIndex);family.forEach(p=>{if(!p.colorGalleryImages||typeof p.colorGalleryImages!=='object')p.colorGalleryImages={};p.colorGalleryImages[color]=imgs.slice(0,4);if(!p.colorImages||typeof p.colorImages!=='object')p.colorImages={};if(imgs[0])p.colorImages[color]=imgs[0];else delete p.colorImages[color];});markChanged();renderPhoneBulkPricing();}
function phoneBulkChooseFamily(family){phoneBulkPricingModelIndex=family;phoneBulkSelectedRows.clear();phoneBulkColorGalleryDraft={};phoneBulkFilterColor="";phoneBulkFilterStorage="";phoneBulkFilterCondition="";renderPhoneBulkPricing();}
function phoneBulkFilterModels(query){
  const products=(data.phones||[]).map(p=>phoneBulkFamilyName(p));
  const families=[...new Set((data.phones||[]).filter(p=>Array.isArray(p.variantPrices)&&p.variantPrices.length).map(p=>phoneBulkFamilyName(p)))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const q=String(query||"").trim().toLocaleLowerCase();
  const box=document.getElementById("phone-bulk-model-results");if(!box)return;
  box.innerHTML=families.filter(f=>f.toLocaleLowerCase().includes(q)).map(f=>`<button type="button" class="btn ${f===phoneBulkPricingModelIndex?'btn-green':'btn-light'}" onclick="phoneBulkChooseFamily('${f.replace(/\\/g,"\\\\").replace(/'/g,"\\'")}')">${esc(f)}</button>`).join("")||'<span class="small">Geen iPhone-modellen gevonden.</span>';
}
function renderPhones(){
  const box=document.getElementById("phonesList");
  if(!box) return;
  if(!Array.isArray(data.phones)) data.phones=[];
  if(phoneBulkPricingView){renderPhoneBulkPricing();return;}
  if(!data.phones.length){
    box.innerHTML=`<div class="editor-layout"><div class="editor-list"><div class="editor-list-title">Producten</div><div class="small" style="padding:10px">Nog geen producten toegevoegd.</div></div><div class="editor-panel editor-empty">Voeg een product toe om te beginnen.</div></div>`;
    return;
  }
  if(selectedPhoneIndex>=data.phones.length) selectedPhoneIndex=data.phones.length-1;
  const phone=data.phones[selectedPhoneIndex];
  if(phone.setupWizard){
    if(!Array.isArray(phone.images))phone.images=["","","",""];
    while(phone.images.length<4)phone.images.push("");
    if(!phone.colorImages||typeof phone.colorImages!=="object")phone.colorImages={};
    box.innerHTML=phoneWizardStageHtml(phone,selectedPhoneIndex);
    return;
  }
  normalizePhoneOptions(phone);
  while(!Array.isArray(phone.images)) phone.images=[];
  while(phone.images.length<4) phone.images.push("");
  if(!Array.isArray(phone.specifications)) phone.specifications=[];
  const list=renderPhoneFolderTree();

  const optionEditor=(key,title,help)=>{
    const opts=phone[key]||[];
    const isCondition=key==='conditionOptions';
    return `<div class="card" style="margin-top:16px">
      <div class="card-title">${title}</div>
      <div class="small" style="margin-bottom:12px">${help}</div>
      ${opts.map((o,i)=>`
        <div style="display:grid;grid-template-columns:minmax(180px,1fr) 125px 125px 125px 120px ${key==='storageOptions'?'105px':'0px'};gap:10px;align-items:center;margin-bottom:9px">
          <input value="${esc(o.label)}" oninput="data.phones[${selectedPhoneIndex}].${key}[${i}].label=this.value;markChanged()">
          <label style="display:flex;align-items:center;gap:7px;font-weight:700"><input type="checkbox" ${o.active!==false?'checked':''} onchange="data.phones[${selectedPhoneIndex}].${key}[${i}].active=this.checked;data.phones[${selectedPhoneIndex}].${key}[${i}].enabled=this.checked;markChanged()"> Actief</label>
          <label style="display:flex;align-items:center;gap:7px;font-weight:700"><input type="checkbox" ${o.available!==false?'checked':''} onchange="data.phones[${selectedPhoneIndex}].${key}[${i}].available=this.checked;markChanged()"> Beschikbaar</label>
          ${isCondition
            ? `<input type="number" step="0.01" min="0" value="${esc(o.basePrice??0)}" placeholder="€ Basisprijs" oninput="data.phones[${selectedPhoneIndex}].${key}[${i}].basePrice=Number(this.value||0);markChanged()">`
            : `<input type="number" step="0.01" value="${esc(o.priceDelta??0)}" placeholder="+/- €" oninput="data.phones[${selectedPhoneIndex}].${key}[${i}].priceDelta=Number(this.value||0);markChanged()">`
          }
          <span class="small">${isCondition?'Basisprijs':'Prijsverschil'}</span>
          ${key==='storageOptions'?'<button type="button" class="btn btn-red" onclick="removePhoneOption('+selectedPhoneIndex+',\'storageOptions\','+i+')">Verwijderen</button>':''}
        </div>${key==='batteryOptions' ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 12px">
          <div class="field"><label>Beschrijving batterij</label><textarea placeholder="Beschrijving van deze batterijoptie" oninput="data.phones[${selectedPhoneIndex}].${key}[${i}].description=this.value;markChanged()">${esc(o.description||'')}</textarea></div>
          <div class="field"><label>Foto van de batterij uploaden</label><input type="file" accept="image/*" onchange="handleBatteryOptionImage(event,${selectedPhoneIndex},${i})"><div class="small">Kies een foto uit je telefoon of computer (maximaal 5 MB).</div>${o.image ? '<img src="'+esc(o.image)+'" alt="Batterij" style="display:block;max-width:160px;max-height:130px;object-fit:contain;margin-top:8px;border:1px solid #dbe2ea;border-radius:8px;padding:5px;background:#fff"><button type="button" class="btn btn-light" style="margin-top:6px" onclick="removeBatteryOptionImage(${selectedPhoneIndex},${i})">Foto verwijderen</button>' : '<div class="small" style="margin-top:6px">Nog geen foto gekozen.</div>'}</div>
        </div>` : ''}`).join('')}
    </div>`;
  };

  const customOptionsEditor = renderCustomProductOptionsEditor(phone, selectedPhoneIndex);

  const pricingModeEditor = `
    <div class="card" style="margin-top:16px;border:1px solid #cfe0ff">
      <div class="card-title">💶 Prijsinstelling voor dit product</div>
      <div class="small" style="margin:7px 0 12px">Kies één methode. De oude methode blijft behouden. De nieuwe methode geeft iedere combinatie van conditie, kleur en opslag een eigen vaste prijs.</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <label style="display:flex;gap:8px;align-items:center;padding:10px 13px;border:1px solid #d7deea;border-radius:10px;background:white">
          <input type="radio" name="pricingMode-${selectedPhoneIndex}" ${phone.pricingMode!=="variant"?"checked":""} onchange="setPhonePricingMode('legacy')"> Oude prijsberekening
        </label>
        <label style="display:flex;gap:8px;align-items:center;padding:10px 13px;border:1px solid #d7deea;border-radius:10px;background:white">
          <input type="radio" name="pricingMode-${selectedPhoneIndex}" ${phone.pricingMode==="variant"?"checked":""} onchange="setPhonePricingMode('variant')"> Vaste prijs per combinatie
        </label>
        <button type="button" class="btn btn-light" onclick="generatePhoneVariantPrices(true)">Combinaties bijwerken</button>
      </div>
      ${phone.pricingMode==="variant" ? renderPhoneVariantPriceTable(phone) : '<div class="small" style="margin-top:10px">De bestaande basisprijs en prijsverschillen blijven actief.</div>'}
    </div>`;

  const specs=phone.specifications.map((s,i)=>`
    <div style="display:grid;grid-template-columns:1fr 1fr 44px;gap:10px;align-items:center;margin-bottom:9px">
      <input value="${esc(s.label||'')}" placeholder="Specificatie" oninput="data.phones[${selectedPhoneIndex}].specifications[${i}].label=this.value;markChanged()">
      <input value="${esc(s.value||'')}" placeholder="Waarde" oninput="data.phones[${selectedPhoneIndex}].specifications[${i}].value=this.value;markChanged()">
      <button class="btn btn-red" type="button" onclick="data.phones[${selectedPhoneIndex}].specifications.splice(${i},1);renderPhones();markChanged()">×</button>
    </div>`).join('');

  if(!phoneEditOnly){
    box.innerHTML=`
      <div class="phone-catalog-only">
        <div class="phone-catalog-head">
          <div><div class="phone-catalog-title">📦 Catalogus</div><div class="phone-catalog-subtitle">${data.phones.length} producten · zelfde catalogus als de website</div></div>
          <div class="phone-catalog-actions"><button type="button" class="btn btn-light" onclick="phoneBulkPricingView=true;phoneBulkPricingModelIndex=selectedPhoneIndex;phoneBulkSelectedRows.clear();renderPhones()">💶 Collectieve prijzen</button><button type="button" class="btn btn-light" onclick="addPhoneTreeGroup()">＋ Map toevoegen</button><button type="button" class="btn btn-green" onclick="addPhone()">＋ Telefoon toevoegen</button></div>
        </div>
        <div class="phone-tree-search"><span>⌕</span><input data-focus-key="phone-tree-search" value="${esc(phoneTreeSearch)}" placeholder="Zoek model, kleur, geheugen..." oninput="phoneTreeSearch=this.value;renderPhonesPreserveFocus(this)"/><button type="button" onclick="phoneTreeSearch='';renderPhones()" aria-label="Zoekopdracht wissen">×</button></div>
        <div class="phone-brand-tabs">${['Alle','Apple','Samsung','iPad',...phoneTreeCustomGroups].map(b=>`<button type="button" class="phone-brand-tab ${phoneTreeBrand===b?'active':''}" onclick="setPhoneTreeBrand('${b.replace(/'/g,"\\'")}')">${phoneTreeBrandIcon(b)} ${esc(b)}</button>`).join('')}<button type="button" class="phone-brand-tab phone-brand-add" onclick="addPhoneTreeGroup()">＋ Toevoegen</button></div>
        <div class="phone-tree-hint">Website gebruikt <strong>data.phones</strong> · <span>Alle</span> toont elk product zonder merkfilter</div>
        <div class="phone-folder-list">${list}</div>
      </div>`;
    return;
  }

  box.innerHTML=`
    <div class="editor-layout phone-edit-mode">
      <div class="editor-list phone-catalog-sidebar" style="display:none!important">
        <div class="phone-catalog-head">
          <div>
            <div class="phone-catalog-title">📦 Catalogus</div>
            <div class="phone-catalog-subtitle">${data.phones.length} producten · zelfde catalogus als de website</div>
          </div>
          <span class="phone-catalog-total">${data.phones.length}</span>
        </div>
        <div class="phone-tree-search"><span>⌕</span><input data-focus-key="phone-tree-search" value="${esc(phoneTreeSearch)}" placeholder="Zoek model, kleur, geheugen..." oninput="phoneTreeSearch=this.value;renderPhonesPreserveFocus(this)"/><button type="button" onclick="phoneTreeSearch='';renderPhones()" aria-label="Zoekopdracht wissen">×</button></div>
        <div class="phone-brand-tabs">
          ${['Alle','Apple','Samsung','iPad',...phoneTreeCustomGroups].map(b=>`<button type="button" class="phone-brand-tab ${phoneTreeBrand===b?'active':''}" onclick="setPhoneTreeBrand('${b.replace(/'/g,"\\'")}')">${phoneTreeBrandIcon(b)} ${esc(b)}</button>`).join('')}
          <button type="button" class="phone-brand-tab phone-brand-add" onclick="addPhoneTreeGroup()">＋ Toevoegen</button>
        </div>
        <div class="phone-tree-hint">Website gebruikt <strong>data.phones</strong> · <span>Alle</span> toont elk product zonder merkfilter</div>
        <div class="phone-folder-list">${list}</div>
      </div>
      <div class="editor-panel">
        <div class="card-head">
          <div>
            ${phoneEditOnly?`<button type="button" class="btn btn-light phone-back-catalog" onclick="showPhoneCatalog()">← Terug naar telefoons</button>`:''}
            <div class="card-title" style="font-size:20px">🛒 ${esc(phone.name||'Nieuw product')}</div><div class="small">Dit is het verkoopsysteem van HOMS TECH. Staat los van Uw toestel verkopen / Protocol 1–8.</div></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn btn-light" onclick="duplicatePhone(${selectedPhoneIndex})">⧉ Product kopiëren</button><button type="button" class="btn btn-red" onclick="deletePhone(${selectedPhoneIndex})">Verwijderen</button></div>
        </div>

        <div class="grid">
          <div class="field"><label>Model / Productnaam</label><input data-focus-key="phone-name" value="${esc(phone.name||'')}" oninput="data.phones[${selectedPhoneIndex}].name=this.value;markChanged();renderPhonesPreserveFocus(this)"></div>
          <div class="field"><label>Merk</label><input value="${esc(phone.brand||'')}" oninput="data.phones[${selectedPhoneIndex}].brand=this.value;markChanged()"></div>
          <div class="field"><label>Subtitel</label><input value="${esc(phone.subtitle||'')}" placeholder="Krachtiger. Slimmer. Mooier." oninput="data.phones[${selectedPhoneIndex}].subtitle=this.value;markChanged()"></div>
          <div class="field"><label>Categorie</label><input value="${esc(phone.category||'Smartphones')}" placeholder="Smartphones / Tablets / MacBook..." oninput="data.phones[${selectedPhoneIndex}].category=this.value;markChanged()"></div>
          <div class="field"><label>Standaardprijs / fallback (€)</label><input type="number" step="0.01" value="${esc(phone.price||'')}" oninput="data.phones[${selectedPhoneIndex}].price=Number(this.value||0);markChanged()"></div>
          <div class="field"><label>Voorraad</label><input type="number" min="0" step="1" value="${esc(phone.stock||0)}" oninput="data.phones[${selectedPhoneIndex}].stock=Number(this.value||0);markChanged()"></div>
          <div class="field"><label>SKU</label><input value="${esc(phone.sku||'')}" placeholder="HT-IPH12-64" oninput="data.phones[${selectedPhoneIndex}].sku=this.value;markChanged()"></div>
          <div class="field"><label>Garantie</label><input value="${esc(phone.warranty||'')}" placeholder="12 maanden" oninput="data.phones[${selectedPhoneIndex}].warranty=this.value;markChanged()"></div>
          <div class="field" style="grid-column:1/-1"><label>Korte beschrijving</label><textarea oninput="data.phones[${selectedPhoneIndex}].description=this.value;markChanged()">${esc(phone.description||'')}</textarea></div>
        </div>

        <div class="card" style="margin-top:16px">
          <div class="card-title">⚙️ Productspecificaties</div>
          <div class="small" style="margin:10px 0;padding:10px 12px;background:#f4f8ff;border:1px solid #dce9ff;border-radius:10px">
            <strong>Prijsberekening:</strong> gekozen conditie = basisprijs. Daarna worden opslag, kleur, batterij, BTW en andere opties als +/- prijsverschil toegevoegd.
          </div>
          <div class="grid">
            <div class="field"><label>Connectiviteit</label><input value="${esc(phone.connectivity||'')}" placeholder="Origineel / Wi-Fi / Wi-Fi + Cellular" oninput="data.phones[${selectedPhoneIndex}].connectivity=this.value;markChanged()"></div>
            <div class="field"><label>Schermgrootte</label><input value="${esc(phone.screenSize||'')}" placeholder="6.1 inch" oninput="data.phones[${selectedPhoneIndex}].screenSize=this.value;markChanged()"></div>
            <div class="field"><label>Processor</label><input value="${esc(phone.processor||'')}" placeholder="Apple A..." oninput="data.phones[${selectedPhoneIndex}].processor=this.value;markChanged()"></div>
            <div class="field"><label>Geheugen / RAM</label><input value="${esc(phone.memory||'')}" placeholder="8GB RAM" oninput="data.phones[${selectedPhoneIndex}].memory=this.value;markChanged()"></div>
            <div class="field"><label>Grafische kaart</label><input value="${esc(phone.gpu||'')}" placeholder="Built-in" oninput="data.phones[${selectedPhoneIndex}].gpu=this.value;markChanged()"></div>
            <div class="field"><label>Jaar</label><input value="${esc(phone.releaseYear||'')}" placeholder="2025" oninput="data.phones[${selectedPhoneIndex}].releaseYear=this.value;markChanged()"></div>
          </div>
          <div style="margin-top:14px"><strong>Extra specificaties</strong>${specs}<button class="btn btn-light" type="button" onclick="data.phones[${selectedPhoneIndex}].specifications.push({label:'',value:''});renderPhones();markChanged()">+ Specificatie</button></div>
        </div>

        ${customOptionsEditor}
        ${pricingModeEditor}
        ${optionEditor('conditionOptions','1. Productconditie','Hier beheer je de beschikbare condities. In de nieuwe methode wordt de prijs per conditie + kleur + opslag apart ingesteld.')}
        ${optionEditor('storageOptions','2. Geheugen / opslag','Opslag is altijd een prijsverschil (+/-) bovenop de gekozen conditie.')}
        ${optionEditor('colorOptions','3. Kleur','Kleuren kunnen actief/beschikbaar worden gezet en een eigen +/- prijs krijgen.')}
        ${optionEditor('batteryOptions','4. Batterij','Batterij is altijd een prijsverschil (+/-). Bijvoorbeeld Nieuw (100%) +€30.')}
        ${optionEditor('vatOptions','5. BTW','BTW-opties met eigen +/- prijs.')}
        ${optionEditor('tradeInOptions','6. Inruil oude telefoon','Voor later gebruik met het inruilsysteem; staat los van de buyback-protocollen.')}

        <div class="card" style="margin-top:16px">
          <div class="card-title">📷 Productfoto's</div>
          <div class="images-grid">${phone.images.map((img,j)=>`
            <div class="image-box">
              ${img?`<img src="${esc(img)}" class="image-preview">`:`<div class="empty-preview">Geen foto</div>`}
              <input type="file" accept="image/*" onchange="handlePhoneImage(event,${selectedPhoneIndex},${j})">
              ${img?`<button class="btn btn-light" type="button" style="margin-top:7px" onclick="removePhoneImage(${selectedPhoneIndex},${j})">Verwijder foto</button>`:""}
            </div>`).join('')}</div>
          <p class="small">Maximaal 4 foto's per product.</p>
        </div>
      </div>
    </div>`;
}

function removePhoneOption(phoneIndex,key,optionIndex){
  const phone=data.phones?.[phoneIndex];
  if(!phone||!Array.isArray(phone[key])||!phone[key][optionIndex])return;
  const option=phone[key][optionIndex];
  const label=String(option.label||"").trim();
  const matchingRows=(phone.variantPrices||[]).filter(row=>String(row?.storage||"").trim()===label);
  const message='Geheugenoptie "'+label+'" verwijderen?'+(matchingRows.length?'\n\nOok '+matchingRows.length+' prijscombinaties met exact deze schrijfwijze worden verwijderd. Andere schrijfwijzen blijven behouden.':'')+'\n\nDeze actie wordt pas definitief nadat je op Wijzigingen opslaan drukt.';
  if(!confirm(message))return;
  phone[key].splice(optionIndex,1);
  if(key==="storageOptions"&&Array.isArray(phone.variantPrices)&&matchingRows.length){
    phone.variantPrices=phone.variantPrices.filter(row=>String(row?.storage||"").trim()!==label);
  }
  renderPhones();markChanged();
}

function renderCustomProductOptionsEditor(phone,index){
  if(!Array.isArray(phone.optionGroups)) phone.optionGroups=[];
  if(!Array.isArray(phone.addonGroups)) phone.addonGroups=[];
  const renderGroups=(groups,type,title,help)=>`
    <div class="card" style="margin-top:16px;border:1px solid #cbd5e1">
      <div class="card-head"><div><div class="card-title">${title}</div><div class="small">${help}</div></div>
      <button type="button" class="btn btn-light" onclick="addCustomOptionGroup(${index},'${type}')">＋ Groep</button></div>
      ${groups.map((group,gi)=>`
        <div style="border:1px solid #e2e8f0;border-radius:12px;padding:13px;margin:12px 0">
          <div class="grid">
            <div class="field"><label>Naam van de groep</label><input value="${esc(group.name||'')}" oninput="data.phones[${index}].${type}[${gi}].name=this.value;markChanged()"></div>
            <div class="field"><label>Keuze</label><select onchange="data.phones[${index}].${type}[${gi}].singleSelect=this.value==='true';markChanged()"><option value="true" ${group.singleSelect!==false?'selected':''}>Kies één optie</option><option value="false" ${group.singleSelect===false?'selected':''}>Meerdere opties</option></select></div>
          </div>
          ${(Array.isArray(group.options)?group.options:[]).map((option,oi)=>`
            <div style="display:grid;grid-template-columns:minmax(120px,1fr) minmax(90px,.55fr) minmax(140px,1fr) auto;gap:9px;align-items:center;border-top:1px solid #edf0f5;padding:12px 0">
              <input aria-label="Optienaam" placeholder="Naam optie" value="${esc(option.label||'')}" oninput="data.phones[${index}].${type}[${gi}].options[${oi}].label=this.value;markChanged()">
              <input aria-label="Prijsverschil" type="number" step="0.01" value="${esc(option.priceDelta??0)}" placeholder="Prijs +/-" oninput="data.phones[${index}].${type}[${gi}].options[${oi}].priceDelta=Number(this.value||0);markChanged()">
              <div style="min-width:0"><div class="small">Afbeelding</div>${option.image?'<img src="'+esc(option.image)+'" alt="" style="width:42px;height:42px;object-fit:cover;border-radius:8px">':''}<input type="file" accept="image/*" aria-label="Afbeelding optie" onchange="handleCustomOptionImage(event,${index},'${type}',${gi},${oi})" style="max-width:160px"></div>
              <button type="button" class="btn btn-red" onclick="removeCustomOption(${index},'${type}',${gi},${oi})">×</button>
            </div>
            <div class="grid" style="margin-bottom:10px">
              <div class="field"><label>Beschikbaarheid</label><select onchange="data.phones[${index}].${type}[${gi}].options[${oi}].available=this.value==='true';markChanged()"><option value="true" ${option.available!==false?'selected':''}>Beschikbaar</option><option value="false" ${option.available===false?'selected':''}>Niet beschikbaar</option></select></div>
              <div class="field"><label>Voorraad (اختياري)</label><input type="number" min="0" step="1" value="${esc(option.stock??'')}" oninput="data.phones[${index}].${type}[${gi}].options[${oi}].stock=this.value===''?null:Number(this.value);markChanged()"></div>
            </div>`).join('')}
          <button type="button" class="btn btn-light" onclick="addCustomOption(${index},'${type}',${gi})">＋ Optie toevoegen</button>
          <button type="button" class="btn btn-red" onclick="removeCustomOptionGroup(${index},'${type}',${gi})">Groep verwijderen</button>
        </div>`).join('')}
    </div>`;
  return renderGroups(phone.optionGroups,'optionGroups','🎛️ Extra varianten','Voeg zelf eigenschappen toe, met waarden, prijsverschillen, voorraad en afbeeldingen.')
    + renderGroups(phone.addonGroups,'addonGroups','➕ Extra’s / add-ons','Bijvoorbeeld een batterij-upgrade. De prijs wordt bij het product opgeteld.');
}
function addCustomOptionGroup(index,type){
  const phone=data.phones[index];if(!phone)return;
  if(!Array.isArray(phone[type]))phone[type]=[];
  phone[type].push({name:type==='addonGroups'?'Nieuwe extra':'Nieuwe eigenschap',singleSelect:true,options:[{label:'Nieuwe optie',priceDelta:0,available:true,stock:null,image:''}]});
  renderPhones();markChanged();
}
function addCustomOption(index,type,groupIndex){
  const group=data.phones[index]?.[type]?.[groupIndex];if(!group)return;
  if(!Array.isArray(group.options))group.options=[];
  group.options.push({label:'',priceDelta:0,available:true,stock:null,image:''});
  renderPhones();markChanged();
}
function removeCustomOption(index,type,groupIndex,optionIndex){
  data.phones[index]?.[type]?.[groupIndex]?.options?.splice(optionIndex,1);
  renderPhones();markChanged();
}
function removeCustomOptionGroup(index,type,groupIndex){
  data.phones[index]?.[type]?.splice(groupIndex,1);
  renderPhones();markChanged();
}
function handleCustomOptionImage(event,index,type,groupIndex,optionIndex){
  const file=event.target.files?.[0];if(!file)return;
  if(!file.type.startsWith('image/')){alert('Kies een afbeelding.');event.target.value='';return;}
  if(file.size>2*1024*1024){alert('Afbeelding maximaal 2 MB.');event.target.value='';return;}
  const reader=new FileReader();
  reader.onload=()=>{const option=data.phones[index]?.[type]?.[groupIndex]?.options?.[optionIndex];if(option){option.image=reader.result;renderPhones();markChanged();}};
  reader.readAsDataURL(file);
}

function handlePhoneImage(event,i,j){
  const phone=data.phones[i];
  const file=event.target.files && event.target.files[0];
  if(!phone || !file) return;
  if(!file.type.startsWith('image/')){alert('Kies een afbeelding.');event.target.value='';return;}
  if(file.size>2*1024*1024){alert('De afbeelding mag maximaal 2 MB zijn.');event.target.value='';return;}
  const reader=new FileReader();
  reader.onload=()=>{phone.images[j]=reader.result;renderPhones();markChanged();};
  reader.readAsDataURL(file);
}

function removePhoneImage(i,j){
  if(!data.phones[i]) return;
  data.phones[i].images[j]="";
  renderPhones();
  markChanged();
}

function renderPhoneTitle(i){ renderPhones(); }

function setPhonePricingMode(mode){
  const phone=data.phones[selectedPhoneIndex]; if(!phone) return;
  if(mode==="variant" && phone.pricingMode!=="variant" && (!Array.isArray(phone.variantPrices)||!phone.variantPrices.length)){
    phone.pricingMode="legacy";
    generatePhoneVariantPrices(false);
  }
  phone.pricingMode=mode==="variant"?"variant":"legacy";
  renderPhones(); markChanged();
}
function generatePhoneVariantPrices(preserve=true){
  const phone=data.phones[selectedPhoneIndex]; if(!phone) return;
  const conditions=(phone.conditionOptions||[]).filter(x=>x&&x.label&&x.active!==false&&x.enabled!==false);
  const colors=(phone.colorOptions||[]).filter(x=>x&&x.label&&x.active!==false&&x.enabled!==false);
  const storages=(phone.storageOptions||[]).filter(x=>x&&x.label&&x.active!==false&&x.enabled!==false);
  const old=Array.isArray(phone.variantPrices)?phone.variantPrices:[];
  const oldByKey=new Map(old.map(x=>[JSON.stringify([x.condition,x.color,x.storage]),x]));
  const rows=[];
  for(const c of conditions) for(const col of colors) for(const st of storages){
    const key=JSON.stringify([c.label,col.label,st.label]);
    const previous=preserve?oldByKey.get(key):null;
    const legacyBase=Number(c.basePrice ?? c.conditionBasePrice ?? phone.price ?? 0)||0;
    const legacyPrice=Math.max(0,Math.round((legacyBase+(Number(st.priceDelta)||0)+(Number(col.priceDelta)||0))*100)/100);
    rows.push(previous?{...previous,condition:c.label,color:col.label,storage:st.label}:{condition:c.label,color:col.label,storage:st.label,price:legacyPrice,active:true,available:true});
  }
  phone.variantPrices=rows;
  if(preserve) { renderPhones(); markChanged(); }
}
function renderPhoneVariantPriceTable(phone){
  const rows=Array.isArray(phone.variantPrices)?phone.variantPrices:[];
  if(!rows.length) return '<div class="small" style="margin-top:12px">Geen combinaties gevonden. Klik op “Combinaties bijwerken”.</div>';
  return '<div style="margin-top:14px;overflow:auto"><div class="small" style="margin-bottom:8px">Elke rij heeft een eigen vaste basisprijs. Batterij, BTW en inruil blijven eventuele toeslagen volgens de bestaande instellingen.</div><table style="width:100%;border-collapse:collapse;min-width:620px"><thead><tr><th style="text-align:left;padding:9px;border-bottom:1px solid #e2e8f0">Conditie</th><th style="text-align:left;padding:9px;border-bottom:1px solid #e2e8f0">Kleur</th><th style="text-align:left;padding:9px;border-bottom:1px solid #e2e8f0">Opslag</th><th style="text-align:left;padding:9px;border-bottom:1px solid #e2e8f0">Vaste prijs (€)</th><th style="padding:9px;border-bottom:1px solid #e2e8f0">Beschikbaar</th></tr></thead><tbody>'+rows.map((r,i)=>'<tr><td style="padding:7px;border-bottom:1px solid #edf0f5">'+esc(r.condition)+'</td><td style="padding:7px;border-bottom:1px solid #edf0f5">'+esc(r.color)+'</td><td style="padding:7px;border-bottom:1px solid #edf0f5">'+esc(r.storage)+'</td><td style="padding:7px;border-bottom:1px solid #edf0f5"><input aria-label="Prijs '+esc(r.condition)+' '+esc(r.color)+' '+esc(r.storage)+'" type="number" min="0" step="0.01" value="'+esc(r.price??0)+'" style="width:120px;padding:8px;border:1px solid #cbd5e1;border-radius:8px" oninput="data.phones['+selectedPhoneIndex+'].variantPrices['+i+'].price=Number(this.value||0);markChanged()"></td><td style="text-align:center;padding:7px;border-bottom:1px solid #edf0f5"><input type="checkbox" '+(r.available!==false?'checked':'')+' onchange="data.phones['+selectedPhoneIndex+'].variantPrices['+i+'].available=this.checked;markChanged()"></td></tr>').join('')+'</tbody></table></div>';
}

function addPhone(){
  phoneWizardExistingEdit=false;
  const phone={
    name:"",brand:"Apple",price:"",storage:"",color:"",condition:"Zo goed als nieuw",
    warranty:"12 maanden",description:"",subtitle:"",sku:"",stock:0,stockStatus:"available",
    category:"Smartphones",images:["","","",""],colorImages:{},specifications:[],
    pricingMode:"variant",variantPrices:[],conditionOptions:[],storageOptions:[],colorOptions:[],
    batteryOptions:[{label:"Standaard",active:true,enabled:true,available:true,priceDelta:0},{label:"Nieuw (100%)",active:true,enabled:true,available:true,priceDelta:30}],
    vatOptions:[{label:"Zonder BTW",active:true,enabled:true,available:true,priceDelta:0}],
    tradeInOptions:[{label:"Nee",active:true,enabled:true,available:true,priceDelta:0}],
    setupWizard:true,setupStep:1,setupColors:[],setupStorages:[],setupConditions:["Zo goed als nieuw"],setupDone:false
  };
  data.phones.push(phone);
  selectedPhoneIndex=data.phones.length-1;
  phoneEditOnly=true;
  renderPhones();markChanged();
}
async function phoneWizardUploadMultiple(input,index,kind,color){
 const phone=data.phones[index],files=Array.from(input?.files||[]);if(!phone||!files.length)return;
 if(files.length>4){alert("Kies maximaal 4 foto's tegelijk.");input.value="";return;}
 for(const file of files){if(!file.type.startsWith("image/")){alert("Selecteer alleen afbeeldingen.");input.value="";return;}if(file.size>2*1024*1024){alert("Maximaal 2 MB per foto.");input.value="";return;}}
 const read=file=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error("Foto lezen mislukt"));r.readAsDataURL(file);});
 try{const images=await Promise.all(files.map(read));if(kind==="base"){phone.images=Array.isArray(phone.images)?phone.images:["","","",""];while(phone.images.length<4)phone.images.push("");images.forEach((v,i)=>phone.images[i]=v);}else{phone.colorGalleryImages=phone.colorGalleryImages||{};phone.colorGalleryImages[color]=Array.isArray(phone.colorGalleryImages[color])?phone.colorGalleryImages[color]:["","","",""];while(phone.colorGalleryImages[color].length<4)phone.colorGalleryImages[color].push("");images.forEach((v,i)=>phone.colorGalleryImages[color][i]=v);phone.colorImages=phone.colorImages||{};phone.colorImages[color]=phone.colorGalleryImages[color].find(Boolean)||"";}markChanged();renderPhones();setStatus("✓ "+images.length+" foto's toegevoegd. Sla het product op.","success");}catch(e){alert(e.message||"Upload mislukt");}finally{input.value="";}
}
function phoneWizardUpload(event,index,kind,slot,color){
  const phone=data.phones[index],file=event.target.files?.[0];if(!phone||!file)return;
  if(!file.type.startsWith("image/")){alert("Kies een afbeeldingsbestand.");event.target.value="";return;}
  if(file.size>2*1024*1024){alert("Elke afbeelding mag maximaal 2 MB zijn.");event.target.value="";return;}
  const reader=new FileReader();
  reader.onload=()=>{
    if(kind==="base")phone.images[slot]=reader.result;
    else if(kind==="color"){
      if(!phone.colorGalleryImages||typeof phone.colorGalleryImages!=="object")phone.colorGalleryImages={};
      if(!Array.isArray(phone.colorGalleryImages[color]))phone.colorGalleryImages[color]=["","","",""];
      while(phone.colorGalleryImages[color].length<4)phone.colorGalleryImages[color].push("");
      phone.colorGalleryImages[color][slot]=reader.result;
      phone.colorImages=phone.colorImages||{};
      phone.colorImages[color]=phone.colorGalleryImages[color].find(Boolean)||"";
    } else {if(!phone.colorImages||typeof phone.colorImages!=="object")phone.colorImages={};phone.colorImages[color]=reader.result;}
    renderPhones();markChanged();
  };
  reader.readAsDataURL(file);
}
function phoneWizardSetList(index,key,value,checked){
  const phone=data.phones[index];if(!phone)return;
  if(!Array.isArray(phone[key]))phone[key]=[];
  phone[key]=checked?[...new Set([...phone[key],value])]:phone[key].filter(x=>x!==value);
  renderPhones();markChanged();
}
function phoneWizardGenerate(index){
  const p=data.phones[index];if(!p)return;
  if(!String(p.name||"").trim()){alert("Vul eerst de modelnaam in.");return;}
  if(!(p.setupColors||[]).length){alert("Selecteer minstens één kleur.");return;}
  if(!(p.setupStorages||[]).length){alert("Selecteer minstens één geheugengrootte.");return;}
  if(!(p.setupConditions||[]).length){alert("Selecteer minstens één staat.");return;}
  p.colorOptions=p.setupColors.map(label=>{const old=(p.colorOptions||[]).find(x=>x&&x.label===label)||{};return {...old,label,active:true,enabled:true,available:old.available!==false,priceDelta:Number(old.priceDelta||0),image:p.colorImages?.[label]||old.image||""};});
  p.storageOptions=p.setupStorages.map(label=>{const old=(p.storageOptions||[]).find(x=>x&&x.label===label)||{};return {...old,label,active:true,enabled:true,available:old.available!==false,priceDelta:Number(old.priceDelta||0)};});
  p.conditionOptions=p.setupConditions.map(label=>{const old=(p.conditionOptions||[]).find(x=>x&&x.label===label)||{};return {...old,label,active:true,enabled:true,available:old.available!==false,basePrice:Number(old.basePrice??p.price??0)};});
  const old=Array.isArray(p.variantPrices)?p.variantPrices:[];
  const oldByKey=new Map(old.map(x=>[JSON.stringify([x.condition,x.color,x.storage]),x]));
  p.variantPrices=[];
  for(const condition of p.setupConditions)for(const color of p.setupColors)for(const storage of p.setupStorages){
    const key=JSON.stringify([condition,color,storage]),prev=oldByKey.get(key);
    p.variantPrices.push(prev?{...prev}:{condition,color,storage,price:"",stock:Number(p.stock||0),active:true,available:p.stockStatus!=="unavailable",images:p.images.slice()});
  }
  p.pricingMode="variant";p.setupDone=true;p.setupStep=5;
  renderPhones();markChanged();
}
function phoneWizardApplyBulkPrice(index){
  const input=document.getElementById('phoneBulkPrice-'+index);
  const price=Number(input&&input.value);
  if(!input || input.value.trim()==='' || !Number.isFinite(price) || price<=0){alert('Vul eerst een geldige prijs groter dan € 0 in.');return;}
  const selected=[...document.querySelectorAll('input[data-phone-bulk-index="'+index+'"]:checked')];
  if(!selected.length){alert('Selecteer eerst minimaal één uitvoering.');return;}
  const phone=data.phones[index];
  if(!phone || !Array.isArray(phone.variantPrices)) return;
  selected.forEach(el=>{const rowIndex=Number(el.getAttribute('data-phone-bulk-row'));if(Number.isInteger(rowIndex)&&phone.variantPrices[rowIndex])phone.variantPrices[rowIndex].price=price;});
  markChanged();renderPhones();
}
function phoneWizardVariantTitle(phone,row){
  let model=String(phone?.name||'').trim();
  const color=String(row?.color||'').trim();
  if(color && model.toLowerCase().endsWith(' '+color.toLowerCase())) model=model.slice(0,-color.length-1).trim();
  // Strip a capacity already embedded at the end of the model name before adding the variant capacity.
  if(row?.storage && /^(?:\d+\s*(?:GB|TB)|\d+\s*MB)$/i.test(String(row.storage).trim())) model=model.replace(/\s+\d+\s*(?:GB|TB|MB)\s*$/i,'').trim();
  return [model,row?.storage,row?.color].filter(Boolean).join(' ')+' · '+String(row?.condition||'');
}
function phoneWizardStageHtml(phone,index){
  const step=Number(phone.setupStep||1);
  const stepButton=(n,label)=>`<button type="button" class="btn ${step===n?'btn-green':'btn-light'}" onclick="data.phones[${index}].setupStep=${n};renderPhones()">${n}. ${label}</button>`;
  const field=(label,html)=>`<div class="field"><label>${label}</label>${html}</div>`;
  const colors=["Zwart","Wit","Blauw","Groen","Rood","Paars","Roze","Geel","Goud","Zilver","Middernacht","Sterrenlicht","Titanium naturel","Anders"];
  const storages=["32 GB","64 GB","128 GB","256 GB","512 GB","1 TB","2 TB"];
  const conditions=["Zo goed als nieuw","Licht gebruikt","Zichtbaar gebruikt","Nieuw"];
  const imageCard=(src,label,kind,slot,color)=>`<div style="border:1px solid #e2e8f0;border-radius:12px;padding:10px;min-width:0"><div style="height:100px;background:#f8fafc;border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden;margin-bottom:8px">${src?`<img src="${esc(src)}" alt="" style="max-width:100%;max-height:100%;object-fit:contain">`:'<span style="color:#94a3b8">Geen foto</span>'}</div><strong style="display:block;margin-bottom:6px">${label}</strong><input type="file" accept="image/*" onchange="phoneWizardUpload(event,${index},'${kind}',${slot},'${String(color||'').replace(/'/g,"\\'")}')" style="width:100%;font-size:12px"></div>`;
  let body="";
  if(step===1){
    body=`<div class="grid">${field("Naam / model",`<input data-focus-key="phone-name" value="${esc(phone.name||'')}" placeholder="iPhone 13" oninput="data.phones[${index}].name=this.value;markChanged()">`)}${field("Merk",`<select onchange="data.phones[${index}].brand=this.value;markChanged()">${["Apple","Samsung","Google","Xiaomi","OnePlus","Overige"].map(x=>`<option ${phone.brand===x?'selected':''}>${x}</option>`).join("")}</select>`)}${field("Voorraad totaal",`<input type="number" min="0" step="1" value="${esc(phone.stock??0)}" oninput="data.phones[${index}].stock=Math.max(0,Number(this.value||0));markChanged()">`)}${field("Beschikbaarheid",`<select onchange="data.phones[${index}].stockStatus=this.value;markChanged()"><option value="available" ${phone.stockStatus!=="unavailable"?'selected':''}>Verkrijgbaar</option><option value="unavailable" ${phone.stockStatus==="unavailable"?'selected':''}>Niet beschikbaar</option></select>`)}</div><h3>Vier basisfoto's</h3><p class="small">Upload maximaal 4 foto's. Per kleur kun je in de volgende stap een aparte foto koppelen.</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:12px">${[0,1,2,3].map(i=>imageCard(phone.images?.[i],"Foto "+(i+1),"base",i,"")).join("")}</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><input id="phone-base-multi-${index}" type="file" accept="image/*" multiple><button type="button" class="btn btn-green" onclick='phoneWizardUploadMultiple(document.getElementById("phone-base-multi-${index}"),${index},"base","")'>Upload geselecteerde foto's</button><span class="small">Maximaal 4 foto's tegelijk, 2 MB per foto.</span></div>`;
  }else if(step===2){
    body=`<p class="small">Selecteer de kleuren die je echt aanbiedt. Voor iedere geselecteerde kleur kun je hieronder maximaal 4 eigen foto's uploaden.</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px">${(phoneWizardExistingEdit&&!phone.setupShowAllColors&&(phone.setupColors||[]).length?(phone.setupColors||[]):colors).map(c=>`<label style="border:1px solid #e2e8f0;border-radius:10px;padding:12px;display:flex;align-items:center;gap:8px;font-weight:700"><input type="checkbox" ${(phone.setupColors||[]).includes(c)?'checked':''} onchange="phoneWizardSetList(${index},'setupColors','${c}',this.checked)">${c}</label>`).join("")}</div>${phoneWizardExistingEdit&&!phone.setupShowAllColors?`<button type="button" class="btn btn-light" style="margin-top:10px" onclick="data.phones[${index}].setupShowAllColors=true;renderPhones()">＋ Andere kleur toevoegen</button>`:""}<div class="field" style="margin-top:12px"><label>Eigen kleur toevoegen</label><div style="display:flex;gap:8px"><input id="customPhoneColor" placeholder="Bijv. Titanium blauw"><button class="btn btn-light" type="button" onclick="(()=>{const e=document.getElementById('customPhoneColor');const v=e.value.trim();if(v){phoneWizardSetList(${index},'setupColors',v,true);e.value='';}})()">＋ Toevoegen</button></div></div><div style="margin-top:20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">${(phone.setupColors||[]).map(c=>{const imgs=Array.isArray(phone.colorGalleryImages?.[c])?phone.colorGalleryImages[c]:[];return `<section style="border:1px solid #cbd5e1;border-radius:12px;padding:12px"><h3 style="margin:0 0 10px">${c} — foto's</h3><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">${[0,1,2,3].map(i=>imageCard(imgs[i]||"",c+" · Foto "+(i+1),"color",i,c)).join("")}</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><input type="file" accept="image/*" multiple data-phone-color="${c}"><button type="button" class="btn btn-green" onclick='phoneWizardUploadMultiple(this.previousElementSibling,${index},"color",this.previousElementSibling.dataset.phoneColor)'>Upload geselecteerde foto\'s</button><span class="small">Maximaal 4 foto\'s tegelijk, 2 MB per foto.</span></div></section>`;}).join("")}</div>`;
  }else if(step===3){
    body=`<p class="small">Selecteer de geheugengroottes die je voor dit model wilt aanbieden.</p><div style="display:flex;flex-wrap:wrap;gap:10px">${storages.map(v=>`<label style="border:1px solid #cbd5e1;border-radius:10px;padding:12px;display:flex;gap:8px;align-items:center"><input type="checkbox" ${(phone.setupStorages||[]).includes(v)?'checked':''} onchange="phoneWizardSetList(${index},'setupStorages','${v}',this.checked)">${v}</label>`).join("")}</div><div class="field" style="margin-top:12px"><label>Andere geheugengrootte</label><div style="display:flex;gap:8px"><input id="customPhoneStorage" placeholder="Bijv. 2 TB"><button class="btn btn-light" type="button" onclick="(()=>{const e=document.getElementById('customPhoneStorage');const v=e.value.trim();if(v){phoneWizardSetList(${index},'setupStorages',v,true);e.value='';}})()">＋ Toevoegen</button></div></div>`;
  }else if(step===4){
    body=`<p class="small">Selecteer de uiterlijke staat die je wilt aanbieden. Je kunt later de prijs per combinatie instellen.</p><div style="display:flex;flex-wrap:wrap;gap:10px">${conditions.map(v=>`<label style="border:1px solid #cbd5e1;border-radius:10px;padding:12px;display:flex;gap:8px;align-items:center"><input type="checkbox" ${(phone.setupConditions||[]).includes(v)?'checked':''} onchange="phoneWizardSetList(${index},'setupConditions','${v}',this.checked)">${v}</label>`).join("")}</div><div class="field" style="margin-top:12px"><label>Andere staat toevoegen</label><div style="display:flex;gap:8px"><input id="customPhoneCondition" placeholder="Bijv. Grade B"><button class="btn btn-light" type="button" onclick="(()=>{const e=document.getElementById('customPhoneCondition');const v=e.value.trim();if(v){phoneWizardSetList(${index},'setupConditions',v,true);e.value='';}})()">＋ Toevoegen</button></div></div>`;
  }else{
    body=`<h3>Prijzen en voorraad per uitvoering</h3><p class="small">Selecteer de uitvoeringen die dezelfde prijs moeten krijgen. Vul de prijs één keer in en pas deze toe op alle geselecteerde rijen.</p><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0 14px;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px"><input id="phoneBulkPrice-${index}" type="number" min="0.01" step="0.01" placeholder="Prijs voor selectie (€)" aria-label="Prijs voor geselecteerde uitvoeringen" style="width:180px;max-width:100%;padding:9px;border:1px solid #cbd5e1;border-radius:8px"><button type="button" class="btn btn-green" onclick="phoneWizardApplyBulkPrice(${index})">Pas prijs toe op selectie</button><span class="small">Alleen aangevinkte uitvoeringen worden aangepast.</span></div><div style="overflow:auto"><table style="width:100%;border-collapse:collapse;min-width:700px"><thead><tr><th style="text-align:center;padding:9px">Kies</th><th style="text-align:left;padding:9px">Uitvoering</th><th style="text-align:left;padding:9px">Prijs (€)</th><th style="text-align:left;padding:9px">Voorraad</th><th style="padding:9px">Verkrijgbaar</th></tr></thead><tbody>${(phone.variantPrices||[]).map((r,i)=>`<tr><td style="text-align:center;padding:8px;border-top:1px solid #e2e8f0"><input type="checkbox" data-phone-bulk-index="${index}" data-phone-bulk-row="${i}" aria-label="Selecteer uitvoering ${esc(r.storage)} ${esc(r.color)} ${esc(r.condition)}"></td><td style="padding:8px;border-top:1px solid #e2e8f0">${esc(phoneWizardVariantTitle(phone,r))}</td><td style="padding:8px;border-top:1px solid #e2e8f0"><input type="number" min="0" step="0.01" value="${esc(r.price??'')}" placeholder="0,00" style="width:120px" oninput="data.phones[${index}].variantPrices[${i}].price=this.value===''?'':Number(this.value);markChanged()"></td><td style="padding:8px;border-top:1px solid #e2e8f0"><input type="number" min="0" step="1" value="${esc(r.stock??phone.stock??0)}" style="width:90px" oninput="data.phones[${index}].variantPrices[${i}].stock=Math.max(0,Number(this.value||0));markChanged()"></td><td style="text-align:center;padding:8px;border-top:1px solid #e2e8f0"><input type="checkbox" ${r.available!==false?'checked':''} onchange="data.phones[${index}].variantPrices[${i}].available=this.checked;markChanged()"></td></tr>`).join("")}</tbody></table></div><h3 style="margin-top:20px">Batterij</h3><p class="small">Kies welke batterijopties de klant ziet en bepaal de toeslag voor een nieuwe batterij.</p>${(phone.batteryOptions||[]).map((b,i)=>`<div style="display:grid;grid-template-columns:minmax(140px,1fr) 130px auto;gap:10px;align-items:center;margin:8px 0"><input value="${esc(b.label)}" oninput="data.phones[${index}].batteryOptions[${i}].label=this.value;markChanged()"><input type="number" step="0.01" value="${esc(b.priceDelta??0)}" aria-label="Toeslag batterij" oninput="data.phones[${index}].batteryOptions[${i}].priceDelta=Number(this.value||0);markChanged()"><span class="small">Toeslag (€)</span></div>`).join("")}<button class="btn btn-light" type="button" onclick="data.phones[${index}].batteryOptions.push({label:'Nieuwe batterij',active:true,enabled:true,available:true,priceDelta:0});renderPhones();markChanged()">＋ Batterijoptie toevoegen</button>`;
  }
  return `<div class="card" style="max-width:1150px;margin:0 auto;border:1px solid #dbe5f1;border-radius:16px;padding:clamp(14px,3vw,28px)"><div style="display:flex;justify-content:space-between;gap:12px;align-items:start;flex-wrap:wrap"><div><div class="small">HOMS TECH · PRODUCT CONFIGURATOR</div><h2 style="margin:6px 0">${esc(phone.name||"Nieuwe telefoon toevoegen")}</h2><p class="small">Stap ${step} van 5 — vul de gegevens in en ga verder.</p></div><button type="button" class="btn btn-light" onclick="showPhoneCatalog()">← Terug naar telefoons</button></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 22px">${stepButton(1,"Basis & foto's")}${stepButton(2,"Kleuren")}${stepButton(3,"Geheugen")}${stepButton(4,"Staat")}${stepButton(5,"Prijs & batterij")}</div><div>${body}</div><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0"><button type="button" class="btn btn-light" ${step===1?'disabled':''} onclick="data.phones[${index}].setupStep=${step-1};renderPhones()">← Vorige</button><div style="display:flex;gap:8px;flex-wrap:wrap">${step<4?`<button type="button" class="btn btn-green" onclick="data.phones[${index}].setupStep=${step+1};renderPhones()">Volgende →</button>`:step===4?`<button type="button" class="btn btn-green" onclick="phoneWizardGenerate(${index})">✓ Klaar — maak uitvoeringen</button>`:`<button type="button" class="btn btn-green" onclick="save(false)">💾 Opslaan en publiceren</button>`}</div></div></div>`;
}

function duplicatePhone(i){
  const source=data.phones[i];
  if(!source) return;
  // Clone the complete product, including option settings and photos, without sharing nested objects.
  const copy=JSON.parse(JSON.stringify(source));
  const baseName=String(source.name||"Telefoon").trim()||"Telefoon";
  copy.name=baseName+" (kopie)";
  copy.sku="";
  copy.stock=0;
  copy.createdAt=undefined;
  if(Array.isArray(copy.variantPrices)){
    copy.variantPrices=copy.variantPrices.map(row=>({...row,available:true,stock:0}));
  }
  data.phones.push(copy);
  selectedPhoneIndex=data.phones.length-1;
  phoneEditOnly=true;
  markChanged();
  renderPhones();
  window.scrollTo({top:0,behavior:"smooth"});
}

function deletePhone(i){
  if(confirm("Dit verkoopproduct verwijderen?")){
    data.phones.splice(i,1);
    selectedPhoneIndex=Math.max(0,Math.min(selectedPhoneIndex,data.phones.length-1));
    renderPhones();
    markChanged();
  }
}

/* ---------------- BUYBACK / UW TOESTEL VERKOPEN ---------------- */
function defaultBuybackProtocol2(){
  return {
    storageOptions:[
      {label:'128 GB',priceDelta:0,active:true},
      {label:'256 GB',priceDelta:0,active:true},
      {label:'512 GB',priceDelta:0,active:true},
      {label:'1 TB',priceDelta:0,active:false}
    ],
    conditionOptions:[
      {label:'Bijna als nieuw',priceDelta:0,active:true},
      {label:'Zichtbaar gebruikt',priceDelta:-73,active:true},
      {label:'Gebruikt',priceDelta:-276,active:true},
      {label:'Kapot',priceDelta:-458,active:true}
    ],
    checklist:[
      {text:'Het toestel bevat op enkele gebruikssporen na geen diepe krassen of beschadigingen.',active:true},
      {text:'Er zijn geen deuken, scheuren of barsten.',active:true},
      {text:'De behuizing is schoon en vertoont geen ernstige verkleuring.',active:true},
      {text:'Het toestel is niet krom of gebogen.',active:true},
      {text:'Er is geen iCloud-account meer op het toestel en Zoek mijn iPhone is uitgeschakeld.',active:true},
      {text:'Let op: gestolen of verloren apparaten en apparaten met MDM-beheer komen niet in aanmerking voor inruil.',active:true}
    ],
    functions:{
      label:'Werken alle functies van het toestel goed, zoals Face-/Touch ID ontgrendeling, opladen, verbindingen (wifi), geluid (luidspreker en microfoon), camera’s, knoppen, zaklamp en trillen?',
      yesDelta:0,noDelta:-100,active:true
    },
    battery:{
      label:'Is de batterijcapaciteit minimaal 85%?',
      yesDelta:0,noDelta:-25,active:true
    }
  };
}
function normalizeBuybackProtocol2(x){
  const d=defaultBuybackProtocol2(), p=(x&&x.protocol2)||{};
  const normOpts=(incoming,fallback)=>Array.isArray(incoming)&&incoming.length?incoming.map(o=>({label:String(o.label||''),priceDelta:Number(o.priceDelta||0),conditionPrices:{new:Number(o.conditionPrices?.new??0),light:Number(o.conditionPrices?.light??0),visible:Number(o.conditionPrices?.visible??0)},active:o.active!==false})):fallback.map(o=>({...o,conditionPrices:{...(o.conditionPrices||{})}}));
  return {
    storageOptions:normOpts(p.storageOptions,d.storageOptions),
    conditionOptions:normOpts(p.conditionOptions,d.conditionOptions),
    checklist:Array.isArray(p.checklist)&&p.checklist.length?p.checklist.map(o=>({text:String(o.text||''),active:o.active!==false})):d.checklist.map(o=>({...o})),
    functions:{...d.functions,...(p.functions||{}),yesPercent:Number((p.functions||{}).yesPercent??0),noPercent:Number((p.functions||{}).noPercent??-30),active:(p.functions||{}).active!==false},
    battery:{...d.battery,...(p.battery||{}),yesDelta:Number((p.battery||{}).yesDelta??d.battery.yesDelta),noDelta:Number((p.battery||{}).noDelta??d.battery.noDelta),active:(p.battery||{}).active!==false}
  };
}

function defaultBuybackProtocol3(){
  return {
    connectivity:{
      active:false,
      options:[
        {label:'Bluetooth / WiFi',priceDelta:0,active:true},
        {label:'Bluetooth / WiFi + 4G LTE',priceDelta:0,active:true}
      ]
    },
    capacity:{
      active:true,
      options:[
        {label:'44mm',priceDelta:0,active:true}
      ]
    },
    condition:{
      active:true,
      options:[{label:'Zo goed als nieuw',buyPrice:0,conditionPrice:0,priceDelta:0,active:true},{label:'Licht gebruikt',buyPrice:0,conditionPrice:0,priceDelta:0,active:true},{label:'Zichtbaar gebruikt',buyPrice:0,conditionPrice:0,priceDelta:0,active:true},{label:'Kapot',buyPrice:0,conditionPrice:0,priceDelta:0,active:true}]
    },
    checklist:{
      active:false,
      items:[
        {text:'De Apple Watch ziet er als nieuw uit of heeft kleine gebruikssporen.',active:true},
        {text:'Scherm en behuizing zijn vrij van krassen en deuken.',active:true},
        {text:'Ziet eruit alsof het apparaat nauwelijks is gebruikt.',active:true},
        {text:'Het apparaat heeft geen waterschade en is niet gebogen.',active:true},
        {text:'Er bevindt zich geen iCloud-account op het toestel en Zoek mijn iPhone is uitgeschakeld.',active:true},
        {text:'LET OP: Watches die verloren of gestolen zijn of gekoppeld zijn aan een MDM komen niet in aanmerking voor inruil.',active:true}
      ]
    },
    functions:{
      active:true,
      label:'Werken alle functies van de Watch goed, zoals opstarten, opladen, touch/display, geluid, hartslagmeting en GPS?',
      yesDelta:0,
      noDelta:-100
    },
    battery:{
      active:true,
      label:'Batterijconditie',
      options:[
        {label:'85% of hoger',priceDelta:0,active:true},
        {label:'80–84%',priceDelta:-15,active:true},
        {label:'Onder 80%',priceDelta:-35,active:true}
      ]
    }
  };
}
function normalizeBuybackProtocol3(x){
  const d=defaultBuybackProtocol3(), p=(x&&x.protocol3)||{};
  const normOpts=(incoming,fallback)=>Array.isArray(incoming)&&incoming.length?incoming.map(o=>({label:String(o.label||''),buyPrice:(o.buyPrice!==undefined&&o.buyPrice!=='')?Number(o.buyPrice):((o.conditionPrice!==undefined&&o.conditionPrice!=='')?Number(o.conditionPrice):((o.priceDelta!==undefined&&o.priceDelta!=='')?Number(o.priceDelta):undefined)),conditionPrice:(o.conditionPrice!==undefined&&o.conditionPrice!=='')?Number(o.conditionPrice):((o.buyPrice!==undefined&&o.buyPrice!=='')?Number(o.buyPrice):((o.priceDelta!==undefined&&o.priceDelta!=='')?Number(o.priceDelta):undefined)),priceDelta:Number(o.priceDelta||0),active:o.active!==false})):fallback.map(o=>({...o}));
  const normSection=(incoming,fallback)=>({
    ...fallback,
    ...(incoming||{}),
    active:(incoming||{}).active===undefined ? true : !!(incoming||{}).active,
    options:normOpts((incoming||{}).options,fallback.options)
  });
  return {
    connectivity:normSection(p.connectivity,d.connectivity),
    capacity:normSection(p.capacity,d.capacity),
    condition:normSection(p.condition,d.condition),
    checklist:{
      ...d.checklist,
      ...(p.checklist||{}),
      active:(p.checklist||{}).active===undefined ? true : !!(p.checklist||{}).active,
      items:Array.isArray(p.checklist&&p.checklist.items)&&p.checklist.items.length?p.checklist.items.map(o=>({text:String(o.text||''),active:o.active!==false})):d.checklist.items.map(o=>({...o}))
    },
    functions:{...d.functions,...(p.functions||{}),yesDelta:Number((p.functions||{}).yesDelta??d.functions.yesDelta),noDelta:Number((p.functions||{}).noDelta??d.functions.noDelta),active:(p.functions||{}).active!==false},
    battery:{...d.battery,...(p.battery||{}),noPercent:Number((p.battery||{}).noPercent??-10),active:(p.battery||{}).active!==false}
  };
}
function defaultBuybackProtocol8(){
  return {
    screenSize:{active:true,options:[{label:'13-inch',priceDelta:0,active:true},{label:'14-inch',priceDelta:0,active:true},{label:'16-inch',priceDelta:0,active:true}]},
    yearModel:{active:true,options:[{label:'2021 Apple M1 Pro 14-inch MacBook Pro',priceDelta:0,active:true},{label:'2021 Apple M1 Pro 16-inch MacBook Pro',priceDelta:0,active:true}]},
    processor:{active:true,options:[{label:'Apple M1 Pro Chip — 10-Core CPU / 16-Core GPU',priceDelta:0,active:true}]},
    storage:{active:true,options:[{label:'512GB Flash Opslag',priceDelta:0,active:true},{label:'1TB Flash Opslag',priceDelta:0,active:true},{label:'2TB Flash Opslag',priceDelta:0,active:true}]},
    memory:{active:true,options:[{label:'16GB unified memory',priceDelta:0,active:true},{label:'32GB unified memory',priceDelta:0,active:true}]},
    graphics:{active:true,options:[{label:'Built-in',priceDelta:0,active:true}]},
    condition:{active:true,options:[
      {label:'Zo goed als nieuw',buyPrice:660,conditionPrice:660,priceDelta:0,active:true},
      {label:'Licht gebruikt',buyPrice:484,conditionPrice:484,priceDelta:0,active:true},
      {label:'Zichtbaar gebruikt',buyPrice:264,conditionPrice:264,priceDelta:0,active:true},
      {label:'Kapot',buyPrice:83,conditionPrice:83,priceDelta:0,active:true}
    ]},
    checklist:{active:true,items:[
      {text:'De MacBook ziet er als nieuw uit of heeft kleine gebruikssporen.',active:true},
      {text:'Scherm en behuizing zijn vrij van krassen en deuken.',active:true},
      {text:'Zie eruit alsof het apparaat nauwelijks is gebruikt.',active:true},
      {text:'Het apparaat heeft geen waterschade en is niet gebogen.',active:true},
      {text:'De MacBook heeft geen iCloud / Activation Lock.',active:true},
      {text:'Er bevindt zich geen ander account of beheerprofiel op het toestel.',active:true},
      {text:'LET OP: MacBooks die verloren of gestolen zijn opgegeven of aan MDM zijn gekoppeld, komen niet in aanmerking voor inruil.',active:true}
    ]},
    functions:{active:true,label:'Werken alle functies van de MacBook goed, zoals opstarten, opladen, speakers, microfoon, camera, trackpad/toetsenbord en alle poorten?',yesDelta:0,noDelta:0},
    battery:{active:true,options:[{label:'Goed',priceDelta:0,active:true},{label:'Slecht',priceDelta:0,active:true}]}
  };
}
function normalizeBuybackProtocol8(x){
  const d=defaultBuybackProtocol8(), p=(x&&x.protocol8)||{};
  const normOpts=(incoming,fallback)=>Array.isArray(incoming)&&incoming.length?incoming.map(o=>({label:String(o.label||''),buyPrice:(o.buyPrice!==undefined&&o.buyPrice!=='')?Number(o.buyPrice):((o.conditionPrice!==undefined&&o.conditionPrice!=='')?Number(o.conditionPrice):((o.priceDelta!==undefined&&o.priceDelta!=='')?Number(o.priceDelta):undefined)),conditionPrice:(o.conditionPrice!==undefined&&o.conditionPrice!=='')?Number(o.conditionPrice):((o.buyPrice!==undefined&&o.buyPrice!=='')?Number(o.buyPrice):((o.priceDelta!==undefined&&o.priceDelta!=='')?Number(o.priceDelta):undefined)),priceDelta:Number(o.priceDelta||0),active:o.active!==false})):fallback.map(o=>({...o}));
  const normSection=(incoming,fallback)=>({...fallback,...(incoming||{}),active:(incoming||{}).active===undefined ? true : !!(incoming||{}).active,options:normOpts((incoming||{}).options,fallback.options)});
  return {
    screenSize:normSection(p.screenSize,d.screenSize),yearModel:normSection(p.yearModel,d.yearModel),processor:normSection(p.processor,d.processor),storage:normSection(p.storage,d.storage),memory:normSection(p.memory,d.memory),graphics:normSection(p.graphics,d.graphics),condition:normSection(p.condition,d.condition),
    checklist:{...d.checklist,...(p.checklist||{}),active:(p.checklist||{}).active===undefined ? true : !!(p.checklist||{}).active,items:Array.isArray(p.checklist&&p.checklist.items)&&p.checklist.items.length?p.checklist.items.map(o=>({text:String(o.text||''),active:o.active!==false})):d.checklist.items.map(o=>({...o}))},
    functions:{...d.functions,...(p.functions||{}),yesDelta:Number((p.functions||{}).yesDelta??d.functions.yesDelta),noDelta:Number((p.functions||{}).noDelta??d.functions.noDelta),active:(p.functions||{}).active!==false},
    battery:{...d.battery,...(p.battery||{}),active:(p.battery||{}).active!==false,options:normOpts((p.battery||{}).options,d.battery.options)}
  };
}
function defaultBuybackProtocol7(){
  return {
    connectivity:{active:true,options:[{label:'Wi-Fi',priceDelta:0,active:true}]},
    capacity:{active:true,options:[{label:'256GB',priceDelta:0,active:true}]},
    condition:{active:true,options:[
            {label:'Zo goed als nieuw',buyPrice:100,conditionPrice:100,priceDelta:0,active:true},
      {label:'Licht gebruikt',buyPrice:80,conditionPrice:80,priceDelta:0,active:true},
      {label:'Zichtbaar gebruikt',buyPrice:60,conditionPrice:60,priceDelta:0,active:true},
      {label:'Kapot',buyPrice:15,conditionPrice:15,priceDelta:0,active:true}
    ]},
    checklist:{active:true,items:[
      {text:'De Samsung Tab heeft enkele lichte gebruikssporen, zoals kleine krasjes.',active:true},
      {text:'Geen diepe krassen, barsten of deuken.',active:true},
      {text:'Het scherm is intact en vertoont geen vlekken of verkleuringen.',active:true},
      {text:'Het apparaat heeft geen waterschade en is niet gebogen.',active:true},
      {text:'Er bevindt zich geen Google-account meer op het toestel.',active:true},
      {text:'LET OP: Samsung Tab-apparaten die als verloren of gestolen zijn opgegeven, zijn vergrendeld met een account of gekoppeld aan een MDM en komen niet in aanmerking voor inruil.',active:true}
    ]},
    functions:{active:true,label:'Werken alle functies van de Samsung Tab goed, zoals vingerafdrukscanner, opstarten, opladen, geluid (luidsprekers en microfoon), camera’s (voor en achter), knoppen, touchscreen, trillen en verbindingen (Wi-Fi, Bluetooth, GPS en netwerk)?',yesDelta:0,noDelta:0},
    battery:{active:true,label:'Wat is de status van de batterij?',options:[{label:'Goed',priceDelta:0,active:true},{label:'Normaal',priceDelta:0,active:true},{label:'Zwak',priceDelta:0,active:true}]}
  };
}
function normalizeBuybackProtocol7(x){
  const d=defaultBuybackProtocol7(), p=(x&&x.protocol7)||{};
  const normOpts=(incoming,fallback)=>Array.isArray(incoming)&&incoming.length?incoming.map(o=>({label:String(o.label||''),buyPrice:(o.buyPrice!==undefined&&o.buyPrice!=='')?Number(o.buyPrice):((o.conditionPrice!==undefined&&o.conditionPrice!=='')?Number(o.conditionPrice):((o.priceDelta!==undefined&&o.priceDelta!=='')?Number(o.priceDelta):undefined)),conditionPrice:(o.conditionPrice!==undefined&&o.conditionPrice!=='')?Number(o.conditionPrice):((o.buyPrice!==undefined&&o.buyPrice!=='')?Number(o.buyPrice):((o.priceDelta!==undefined&&o.priceDelta!=='')?Number(o.priceDelta):undefined)),priceDelta:Number(o.priceDelta||0),active:o.active!==false})):fallback.map(o=>({...o}));
  const normSection=(incoming,fallback)=>({...fallback,...(incoming||{}),active:(incoming||{}).active===undefined ? true : !!(incoming||{}).active,options:normOpts((incoming||{}).options,fallback.options)});
  return {connectivity:normSection(p.connectivity,d.connectivity),capacity:normSection(p.capacity,d.capacity),condition:normSection(p.condition,d.condition),checklist:{...d.checklist,...(p.checklist||{}),active:(p.checklist||{}).active===undefined ? true : !!(p.checklist||{}).active,items:Array.isArray(p.checklist&&p.checklist.items)&&p.checklist.items.length?p.checklist.items.map(o=>({text:String(o.text||''),active:o.active!==false})):d.checklist.items.map(o=>({...o}))},functions:{...d.functions,...(p.functions||{}),yesDelta:Number((p.functions||{}).yesDelta??d.functions.yesDelta),noDelta:Number((p.functions||{}).noDelta??d.functions.noDelta),active:(p.functions||{}).active!==false},battery:{...d.battery,...(p.battery||{}),active:(p.battery||{}).active!==false,options:normOpts((p.battery||{}).options,d.battery.options)}};
}
function defaultBuybackProtocol6(){
  return {
    connectivity:{active:true,options:[{label:'🔓 Ontgrendeld',priceDelta:0,active:true}]},
    capacity:{active:true,options:[{label:'128GB',priceDelta:0,active:true},{label:'256GB',priceDelta:0,active:true}]},
    ram:{active:true,options:[{label:'6GB RAM',priceDelta:0,active:true},{label:'8GB RAM',priceDelta:0,active:true}]},
    condition:{active:true,options:[{label:'Zo goed als nieuw',buyPrice:160,conditionPrice:160,priceDelta:0,active:true},{label:'Licht gebruikt',buyPrice:155,conditionPrice:155,priceDelta:0,active:true},{label:'Zichtbaar gebruikt',buyPrice:85,conditionPrice:85,priceDelta:0,active:true},{label:'Kapot',buyPrice:27,conditionPrice:27,priceDelta:0,active:true}]},
    checklist:{active:true,items:[
      {text:'De Samsung Galaxy smartphone heeft enkele lichte gebruikssporen, zoals kleine krasjes.',active:true},
      {text:'Geen diepe krassen, barsten of deuken.',active:true},
      {text:'Het scherm is intact en vertoont geen vlekken of verkleuringen (geen OLED burn-in).',active:true},
      {text:'Het apparaat heeft geen waterschade en is niet gebogen.',active:true},
      {text:'Er bevindt zich geen Google-account meer op het toestel.',active:true},
      {text:'LET OP: Samsung Galaxy smartphones die als verloren of gestolen zijn opgegeven, zijn vergrendeld met een account of zijn gekoppeld aan een MDM, komen niet in aanmerking voor inruil.',active:true}
    ]},
    functions:{active:true,label:'Werken alle functies van de Samsung Galaxy smartphone goed, zoals vingerafdrukscanner, opstarten, opladen, verbindingen (bellen, geluid luidspreker en microfoon), camera’s, knoppen, touchscreen, zaklamp en trillen?',yesDelta:0,noDelta:0},
    battery:{active:true,label:'Wat is de status van de batterij?',options:[{label:'Goed',priceDelta:0,active:true},{label:'Normaal',priceDelta:0,active:true},{label:'Zwak',priceDelta:0,active:true}]}
  };
}
function normalizeBuybackProtocol6(x){
  const d=defaultBuybackProtocol6(), p=(x&&x.protocol6)||{};
  const normOpts=(incoming,fallback)=>Array.isArray(incoming)&&incoming.length?incoming.map(o=>({label:String(o.label||''),buyPrice:(o.buyPrice!==undefined&&o.buyPrice!=='')?Number(o.buyPrice):((o.conditionPrice!==undefined&&o.conditionPrice!=='')?Number(o.conditionPrice):((o.priceDelta!==undefined&&o.priceDelta!=='')?Number(o.priceDelta):undefined)),conditionPrice:(o.conditionPrice!==undefined&&o.conditionPrice!=='')?Number(o.conditionPrice):((o.buyPrice!==undefined&&o.buyPrice!=='')?Number(o.buyPrice):((o.priceDelta!==undefined&&o.priceDelta!=='')?Number(o.priceDelta):undefined)),priceDelta:Number(o.priceDelta||0),active:o.active!==false})):fallback.map(o=>({...o}));
  const normSection=(incoming,fallback)=>({...fallback,...(incoming||{}),active:(incoming||{}).active===undefined ? true : !!(incoming||{}).active,options:normOpts((incoming||{}).options,fallback.options)});
  return {connectivity:normSection(p.connectivity,d.connectivity),capacity:normSection(p.capacity,d.capacity),ram:normSection(p.ram,d.ram),condition:normSection(p.condition,d.condition),checklist:{...d.checklist,...(p.checklist||{}),active:(p.checklist||{}).active===undefined ? true : !!(p.checklist||{}).active,items:Array.isArray(p.checklist&&p.checklist.items)&&p.checklist.items.length?p.checklist.items.map(o=>({text:String(o.text||''),active:o.active!==false})):d.checklist.items.map(o=>({...o}))},functions:{...d.functions,...(p.functions||{}),yesDelta:Number((p.functions||{}).yesDelta??d.functions.yesDelta),noDelta:Number((p.functions||{}).noDelta??d.functions.noDelta),active:(p.functions||{}).active!==false},battery:{...d.battery,...(p.battery||{}),active:(p.battery||{}).active!==false,options:normOpts((p.battery||{}).options,d.battery.options)}};
}
function defaultBuybackProtocol5(){
  return {
    connectivity:{
      active:true,
      options:[
        {label:'Wi-Fi',priceDelta:0,active:true},
        {label:'Wi-Fi + Cellular',priceDelta:0,active:true}
      ]
    },
    capacity:{
      active:true,
      options:[
        {label:'256GB',priceDelta:0,active:true},
        {label:'512GB',priceDelta:0,active:true},
        {label:'1TB',priceDelta:0,active:true},
        {label:'2TB',priceDelta:0,active:true}
      ]
    },
    condition:{
      active:true,
      options:[
              {label:'Zo goed als nieuw',buyPrice:650,conditionPrice:650,priceDelta:0,active:true},
      {label:'Licht gebruikt',buyPrice:520,conditionPrice:520,priceDelta:0,active:true},
      {label:'Zichtbaar gebruikt',buyPrice:390,conditionPrice:390,priceDelta:0,active:true},
      {label:'Kapot',buyPrice:98,conditionPrice:98,priceDelta:0,active:true}
      ]
    },
    checklist:{
      active:true,
      items:[
        {text:'De iPad ziet er als nieuw uit of heeft kleine gebruikssporen.',active:true},
        {text:'Scherm en behuizing zijn vrij van krassen en deuken.',active:true},
        {text:'Ziet eruit alsof het apparaat nauwelijks is gebruikt.',active:true},
        {text:'Het apparaat heeft geen waterschade en is niet gebogen.',active:true},
        {text:'Het apparaat is volledig functioneel en klaar voor gebruik.',active:true},
        {text:'Let op: gestolen of verloren apparaten en apparaten met MDM-beheer komen niet in aanmerking voor inruil.',active:true}
      ]
    },
    functions:{
      active:true,
      label:'Werken alle functies van de iPad goed, zoals ontgrendeling, opladen, geluid, camera’s, knoppen, scherm, verbindingen en trillen?',
      yesDelta:0,
      noDelta:-100
    },
    battery:{
      active:true,
      label:'Batterijconditie',
      options:[
        {label:'85% of hoger',priceDelta:0,active:true},
        {label:'80–84%',priceDelta:-15,active:true},
        {label:'Onder 80%',priceDelta:-35,active:true}
      ]
    }
  };
}
function defaultBuybackProtocol4(){
  return {
    connectivity:{
      active:true,
      options:[
        {label:'🔓 Ontgrendeld',priceDelta:0,active:true}
      ]
    },
    capacity:{
      active:true,
      options:[
        {label:'64GB',priceDelta:0,conditionPrices:{new:0,light:0,visible:0,broken:0},active:true},
        {label:'256GB',priceDelta:0,conditionPrices:{new:0,light:0,visible:0,broken:0},active:true},
        {label:'512GB',priceDelta:0,conditionPrices:{new:0,light:0,visible:0,broken:0},active:true}
      ]
    },
    condition:{
      active:true,
      options:[
        {label:'Zo goed als nieuw',priceDelta:0,active:true},
        {label:'Licht gebruikt',priceDelta:-25,active:true},
        {label:'Zichtbaar gebruikt',priceDelta:-60,active:true},
        {label:'Kapot',priceDelta:0,active:true}
      ]
    },
    checklist:{
      active:true,
      items:[
        {text:'De iPhone ziet er als nieuw uit of heeft kleine gebruikssporen.',active:true},
        {text:'Scherm en behuizing zijn vrij van krassen en deuken.',active:true},
        {text:'Het scherm en de behuizing hebben geen ernstige beschadigingen.',active:true},
        {text:'Het apparaat is niet krom of gebogen.',active:true},
        {text:'Het apparaat heeft geen waterschade en is volledig functioneel.',active:true},
        {text:'Zoek mijn iPhone is uitgeschakeld en het toestel is niet meer aan een Apple-account gekoppeld.',active:true},
        {text:'Let op: gestolen of verloren apparaten en apparaten met MDM-beheer komen niet in aanmerking voor inruil.',active:true}
      ]
    },
    functions:{
      active:true,
      label:'Werken alle functies van de iPhone goed, zoals Face ID/Touch ID, opladen, verbindingen (wifi), geluid, camera’s, knoppen en scherm?',
      yesDelta:0,
      noDelta:-100
    },
    battery:{
      active:true,
      label:'Batterijconditie',
      options:[
        {label:'85% of hoger',priceDelta:0,active:true},
        {label:'80–84%',priceDelta:-15,active:true},
        {label:'Onder 80%',priceDelta:-35,active:true}
      ]
    }
  };
}
function normalizeBuybackProtocol5(x){
  const d=defaultBuybackProtocol5(), p=(x&&x.protocol5)||{};
  const normOpts=(incoming,fallback)=>Array.isArray(incoming)&&incoming.length?incoming.map(o=>({label:String(o.label||''),buyPrice:(o.buyPrice!==undefined&&o.buyPrice!=='')?Number(o.buyPrice):((o.conditionPrice!==undefined&&o.conditionPrice!=='')?Number(o.conditionPrice):((o.priceDelta!==undefined&&o.priceDelta!=='')?Number(o.priceDelta):undefined)),conditionPrice:(o.conditionPrice!==undefined&&o.conditionPrice!=='')?Number(o.conditionPrice):((o.buyPrice!==undefined&&o.buyPrice!=='')?Number(o.buyPrice):((o.priceDelta!==undefined&&o.priceDelta!=='')?Number(o.priceDelta):undefined)),priceDelta:Number(o.priceDelta||0),active:o.active!==false})):fallback.map(o=>({...o}));
  const normSection=(incoming,fallback)=>({
    ...fallback,
    ...(incoming||{}),
    active:(incoming||{}).active===undefined ? true : !!(incoming||{}).active,
    options:normOpts((incoming||{}).options,fallback.options)
  });
  return {
    connectivity:normSection(p.connectivity,d.connectivity),
    capacity:normSection(p.capacity,d.capacity),
    condition:normSection(p.condition,d.condition),
    checklist:{
      ...d.checklist,
      ...(p.checklist||{}),
      active:(p.checklist||{}).active===undefined ? true : !!(p.checklist||{}).active,
      items:Array.isArray(p.checklist&&p.checklist.items)&&p.checklist.items.length?p.checklist.items.map(o=>({text:String(o.text||''),active:o.active!==false})):d.checklist.items.map(o=>({...o}))
    },
    functions:{...d.functions,...(p.functions||{}),yesDelta:Number((p.functions||{}).yesDelta??d.functions.yesDelta),noDelta:Number((p.functions||{}).noDelta??d.functions.noDelta),active:(p.functions||{}).active!==false},
    battery:{...d.battery,...(p.battery||{}),yesDelta:Number((p.battery||{}).yesDelta??d.battery.yesDelta),noDelta:Number((p.battery||{}).noDelta??d.battery.noDelta),active:(p.battery||{}).active!==false}
  };
}
function normalizeBuybackProtocol4(x){
  const d=defaultBuybackProtocol4(), p=(x&&x.protocol4)||{};
  const normOpts=(incoming,fallback)=>Array.isArray(incoming)&&incoming.length?incoming.map(o=>({label:String(o.label||''),priceDelta:Number(o.priceDelta||0),conditionPrices:{new:Number(o.conditionPrices&&o.conditionPrices.new||0),light:Number(o.conditionPrices&&o.conditionPrices.light||0),visible:Number(o.conditionPrices&&o.conditionPrices.visible||0),broken:Number(o.conditionPrices&&o.conditionPrices.broken||0)},active:o.active!==false})):fallback.map(o=>({...o,conditionPrices:{...(o.conditionPrices||{})}}));
  const storedConditions=Array.isArray(p.condition&&p.condition.options)?p.condition.options:[];
  const conditionOpts=d.condition.options.map(def=>{
    const old=storedConditions.find(o=>String(o.label||'').trim().toLowerCase()===def.label.toLowerCase());
    if(!old)return {...def};
    return {...def,active:old.active!==false,...(def.label==='Beschadigd'||def.label==='Kapot'?{buyPrice:old.buyPrice,conditionPrice:old.conditionPrice,priceDelta:Number(old.priceDelta||def.priceDelta||0)}:{priceDelta:0})};
  });
  const normSection=(incoming,fallback)=>({
    ...fallback,
    ...(incoming||{}),
    active:(incoming||{}).active===undefined ? true : !!(incoming||{}).active,
    options:normOpts((incoming||{}).options,fallback.options)
  });
  return {
    connectivity:normSection(p.connectivity,d.connectivity),
    capacity:normSection(p.capacity,d.capacity),
    condition:{...d.condition,...(p.condition||{}),active:(p.condition||{}).active===undefined?true:!!(p.condition||{}).active,options:conditionOpts},
    checklist:{
      ...d.checklist,
      ...(p.checklist||{}),
      active:(p.checklist||{}).active===undefined ? true : !!(p.checklist||{}).active,
      items:Array.isArray(p.checklist&&p.checklist.items)&&p.checklist.items.length?p.checklist.items.map(o=>({text:String(o.text||''),active:o.active!==false})):d.checklist.items.map(o=>({...o}))
    },
    functions:{...d.functions,...(p.functions||{}),yesDelta:Number((p.functions||{}).yesDelta??d.functions.yesDelta),noDelta:Number((p.functions||{}).noDelta??d.functions.noDelta),active:(p.functions||{}).active!==false},
    battery:{...d.battery,...(p.battery||{}),active:(p.battery||{}).active!==false,options:Array.isArray(p.battery&&p.battery.options)&&p.battery.options.length?p.battery.options.map(o=>({label:String(o.label||''),priceDelta:Number(o.priceDelta||0),active:o.active!==false})):d.battery.options.map(o=>({...o}))}
  };
}

function normalizeBuybackPhones(){
  if(!Array.isArray(data.buybackPhones)) data.buybackPhones=[];
  data.buybackPhones=data.buybackPhones.map((x,i)=>({
    id:x.id || ('buyback-'+Date.now()+'-'+i),
    name:x.name||'', brand:x.brand||'', image:x.image||'', price:Number(x.price||0), scrapPrice:Math.max(0,Number(x.scrapPrice??0)||0), active:x.active!==false,
    protocol:x.protocol==='protocol8'?'protocol8':(x.protocol==='protocol7'?'protocol7':(x.protocol==='protocol6'?'protocol6':(x.protocol==='protocol5'?'protocol5':(x.protocol==='protocol4'?'protocol4':(x.protocol==='protocol3'?'protocol3':(x.protocol==='protocol2'?'protocol2':'protocol1')))))),
    protocol2:normalizeBuybackProtocol2(x),
    protocol3:normalizeBuybackProtocol3(x),
    protocol4:normalizeBuybackProtocol4(x),
    protocol5:normalizeBuybackProtocol5(x),
    protocol6:normalizeBuybackProtocol6(x),
    protocol7:normalizeBuybackProtocol7(x),
    protocol8:normalizeBuybackProtocol8(x),
    storageOptions:Array.isArray(x.storageOptions)?x.storageOptions:[
      {label:'128 GB',priceDelta:0,active:true},{label:'256 GB',priceDelta:30,active:true},{label:'512 GB',priceDelta:80,active:true}
    ],
    conditionOptions:Array.isArray(x.conditionOptions)?x.conditionOptions:[
      {label:'Zo goed als nieuw',priceDelta:0,active:true},{label:'Licht gebruikt',priceDelta:-40,active:true},{label:'Zichtbaar gebruikt',priceDelta:-90,active:true},{label:'Kapot',priceDelta:-200,active:true}
    ],
    batteryOptions:[
      {label:'85% of hoger',priceDelta:(Array.isArray(x.batteryOptions)&&x.batteryOptions[0]?Number(x.batteryOptions[0].priceDelta||0):0),active:true},
      {label:'Onder 85%',priceDelta:(Array.isArray(x.batteryOptions)&&x.batteryOptions.length>2?Number(x.batteryOptions[x.batteryOptions.length-1].priceDelta||-25):-25),active:true}
    ],
    faceIdOptions:Array.isArray(x.faceIdOptions)?x.faceIdOptions:[
      {label:'Face ID werkt',priceDelta:0,active:true},{label:'Face ID werkt niet',priceDelta:-100,active:true}
    ],
    screenOptions:Array.isArray(x.screenOptions)?x.screenOptions:[
      {label:'Scherm goed',priceDelta:0,active:true},{label:'Kleine beschadigingen',priceDelta:-50,active:true},{label:'Scherm gebroken',priceDelta:-150,active:true}
    ]
  }));
}

function newBuybackId(prefix){
  return prefix+"-"+Date.now()+"-"+Math.random().toString(36).slice(2,8);
}

function normalizeBuybackCatalog(){
  if(!Array.isArray(data.buybackCatalog)) data.buybackCatalog=[];

  /* Safe migration: existing flat buybackPhones are grouped by brand → Telefoon → model. */
  if(!data.buybackCatalog.length && !buybackCatalogDeleteLock && Array.isArray(data.buybackPhones) && data.buybackPhones.length){
    const byBrand={};
    data.buybackPhones.forEach(phone=>{
      const brand=(phone.brand||"Overig").trim()||"Overig";
      if(!byBrand[brand]) byBrand[brand]={id:newBuybackId("brand"),name:brand,types:[]};
      let type=byBrand[brand].types.find(t=>t.name==="Telefoon");
      if(!type){
        type={id:newBuybackId("type"),name:"Telefoon",questions:[],models:[]};
        byBrand[brand].types.push(type);
      }
      type.models.push({id:newBuybackId("model"),name:phone.name||"Nieuw model",buybackId:phone.id});
    });
    data.buybackCatalog=Object.values(byBrand);
  }

  data.buybackCatalog=data.buybackCatalog.map(brand=>{
    brand=brand||{};
    return {
      id:brand.id||newBuybackId("brand"),
      name:String(brand.name||"Nieuw merk"),
      image:brand.image||brand.brandImage||"",
      types:Array.isArray(brand.types)?brand.types.map(type=>({
        id:type.id||newBuybackId("type"),
        name:String(type.name||"Telefoon"),
        questions:Array.isArray(type.questions)?type.questions:[],
        models:Array.isArray(type.models)?type.models.map(model=>({
          id:model.id||newBuybackId("model"),
          name:String(model.name||"Nieuw model"),
          buybackId:model.buybackId||""
        })): []
      })): []
    };
  });
}

function defaultBuybackQuestionsForType(typeName){
  const n=String(typeName||'').toLowerCase();
  const isWatch=n.includes('watch')||n.includes('smartwatch');
  const isTablet=n.includes('tablet')||n.includes('ipad');
  const isIphone=n.includes('iphone');
  const qs=[];
  if(isWatch){
    qs.push({id:newBuybackId("q"),label:'Werkt het apparaat?',type:'yesno',required:true,options:[{label:'Ja',priceDelta:0,active:true},{label:'Nee',priceDelta:-100,active:true}]});
    qs.push({id:newBuybackId("q"),label:'Conditie',type:'options',required:true,options:[{label:'Zo goed als nieuw',priceDelta:0,active:true},{label:'Licht gebruikt',priceDelta:-30,active:true},{label:'Zichtbaar gebruikt',priceDelta:-70,active:true},{label:'Kapot',priceDelta:-150,active:true}]});
    qs.push({id:newBuybackId("q"),label:'Batterij',type:'options',required:true,options:[{label:'85% of hoger',priceDelta:0,active:true},{label:'Onder 85%',priceDelta:-25,active:true}]});
  }else if(isTablet){
    qs.push({id:newBuybackId("q"),label:'Opslag',type:'options',required:true,options:[{label:'64 GB',priceDelta:0,active:true},{label:'128 GB',priceDelta:25,active:true},{label:'256 GB',priceDelta:60,active:true},{label:'512 GB',priceDelta:100,active:true}]});
    qs.push({id:newBuybackId("q"),label:'Conditie',type:'options',required:true,options:[{label:'Zo goed als nieuw',priceDelta:0,active:true},{label:'Licht gebruikt',priceDelta:-40,active:true},{label:'Zichtbaar gebruikt',priceDelta:-90,active:true},{label:'Kapot',priceDelta:-200,active:true}]});
    qs.push({id:newBuybackId("q"),label:'Scherm',type:'options',required:true,options:[{label:'Scherm goed',priceDelta:0,active:true},{label:'Beschadigd',priceDelta:-75,active:true},{label:'Gebroken',priceDelta:-175,active:true}]});
  }else if(isIphone){
    qs.push({id:newBuybackId("q"),label:'Opslag',type:'options',required:true,options:[{label:'128 GB',priceDelta:0,active:true},{label:'256 GB',priceDelta:30,active:true},{label:'512 GB',priceDelta:80,active:true},{label:'1 TB',priceDelta:140,active:true}]});
    qs.push({id:newBuybackId("q"),label:'Conditie',type:'options',required:true,options:[{label:'Zo goed als nieuw',priceDelta:0,active:true},{label:'Licht gebruikt',priceDelta:-40,active:true},{label:'Zichtbaar gebruikt',priceDelta:-90,active:true},{label:'Kapot',priceDelta:-200,active:true}]});
    qs.push({id:newBuybackId("q"),label:'Batterij',type:'options',required:true,options:[{label:'85% of hoger',priceDelta:0,active:true},{label:'Onder 85%',priceDelta:-25,active:true}]});
    qs.push({id:newBuybackId("q"),label:'Face ID',type:'options',required:true,options:[{label:'Face ID werkt',priceDelta:0,active:true},{label:'Face ID werkt niet',priceDelta:-100,active:true}]});
    qs.push({id:newBuybackId("q"),label:'Scherm',type:'options',required:true,options:[{label:'Scherm goed',priceDelta:0,active:true},{label:'Kleine beschadigingen',priceDelta:-50,active:true},{label:'Scherm gebroken',priceDelta:-150,active:true}]});
    qs.push({id:newBuybackId("q"),label:'iCloud / account verwijderd',type:'yesno',required:true,options:[{label:'Ja',priceDelta:0,active:true},{label:'Nee',priceDelta:-200,active:true}]});
  }else{
    qs.push({id:newBuybackId("q"),label:'Opslag',type:'options',required:true,options:[{label:'128 GB',priceDelta:0,active:true},{label:'256 GB',priceDelta:30,active:true},{label:'512 GB',priceDelta:80,active:true}]});
    qs.push({id:newBuybackId("q"),label:'Conditie',type:'options',required:true,options:[{label:'Zo goed als nieuw',priceDelta:0,active:true},{label:'Licht gebruikt',priceDelta:-40,active:true},{label:'Zichtbaar gebruikt',priceDelta:-90,active:true},{label:'Kapot',priceDelta:-200,active:true}]});
    qs.push({id:newBuybackId("q"),label:'Batterij',type:'options',required:true,options:[{label:'85% of hoger',priceDelta:0,active:true},{label:'Onder 85%',priceDelta:-25,active:true}]});
    qs.push({id:newBuybackId("q"),label:'Scherm',type:'options',required:true,options:[{label:'Scherm goed',priceDelta:0,active:true},{label:'Beschadigd',priceDelta:-75,active:true},{label:'Gebroken',priceDelta:-150,active:true}]});
    qs.push({id:newBuybackId("q"),label:'Account / vergrendeling verwijderd',type:'yesno',required:true,options:[{label:'Ja',priceDelta:0,active:true},{label:'Nee',priceDelta:-200,active:true}]});
  }
  return qs;
}

function normalizeBuybackTypeSettings(){
  (data.buybackCatalog||[]).forEach(b=>(b.types||[]).forEach(t=>{
    if(!Array.isArray(t.questions)||!t.questions.length) t.questions=defaultBuybackQuestionsForType(t.name);
    t.questions=t.questions.map(q=>({
      id:q.id||newBuybackId("q"),
      label:String(q.label||'Vraag'),
      type:q.type||'options',
      required:q.required!==false,
      options:Array.isArray(q.options)?q.options.map(o=>({label:String(o.label||''),priceDelta:Number(o.priceDelta||0),active:o.active!==false})):[],
    }));
  }));
}

function getBuybackQuestionTypeLabel(type){
  return type==='yesno'?'Ja / Nee':type==='text'?'Tekst':'Keuze met prijsaanpassing';
}

function renderBuybackTypeSettings(){
  normalizeBuybackTypeSettings();
  const t=getBuybackType();
  if(!t)return '';
  if(!buybackTypeSettingsOpen)return '';
  const qs=t.questions||[];
  return `<div class="bb-type-settings">
    <div class="bb-type-settings-head">
      <div><h4>⚙️ Vragen voor ${esc(t.name)}</h4><div class="small">Deze vragen gelden voor alle modellen binnen dit type apparaat.</div></div>
      <button class="btn btn-light" type="button" onclick="buybackTypeSettingsOpen=false;renderBuybackModelEditor()">Sluiten</button>
    </div>
    <div class="bb-question-list">
      ${qs.length?qs.map(q=>`
        <div class="bb-question-row">
          <input value="${esc(q.label)}" oninput="updateBuybackQuestion('${esc(q.id)}','label',this.value)">
          <select onchange="updateBuybackQuestion('${esc(q.id)}','type',this.value)">
            <option value="options" ${q.type==='options'?'selected':''}>Keuzes + prijs</option>
            <option value="yesno" ${q.type==='yesno'?'selected':''}>Ja / Nee</option>
            <option value="text" ${q.type==='text'?'selected':''}>Tekst</option>
          </select>
          <label style="display:flex;gap:6px;align-items:center;font-size:12px;font-weight:800"><input type="checkbox" ${q.required!==false?'checked':''} onchange="updateBuybackQuestion('${esc(q.id)}','required',this.checked)"> Verplicht</label>
          <div class="bb-question-type">${getBuybackQuestionTypeLabel(q.type)}</div>
          <div class="bb-question-actions">
            ${q.type!=='text'?`<button class="bb-q-edit" type="button" onclick="toggleBuybackQuestion('${esc(q.id)}')">${buybackQuestionOpenId===q.id?'Sluit opties':'Opties'}</button>`:''}
            <button class="bb-q-delete" type="button" onclick="deleteBuybackQuestion('${esc(q.id)}')">×</button>
          </div>
        </div>
        ${buybackQuestionOpenId===q.id&&q.type!=='text'?renderBuybackQuestionOptions(q):''}
      `).join(''):'<div class="buyback-tree-empty">Nog geen vragen toegevoegd.</div>'}
    </div>
    <div class="bb-type-actions">
      <button class="btn btn-green" type="button" onclick="addBuybackQuestion('options')">+ Keuzevraag</button>
      <button class="btn btn-light" type="button" onclick="addBuybackQuestion('yesno')">+ Ja/Nee-vraag</button>
      <button class="btn btn-light" type="button" onclick="addBuybackQuestion('text')">+ Tekstvraag</button>
    </div>
  </div>`;
}

function renderBuybackQuestionOptions(q){
  return `<div class="bb-option-editor">
    ${(q.options||[]).map((o,i)=>`<div class="bb-option-line">
      <input value="${esc(o.label)}" oninput="updateBuybackQuestionOption('${esc(q.id)}',${i},'label',this.value)">
      <input type="number" step="1" value="${Number(o.priceDelta||0)}" oninput="updateBuybackQuestionOption('${esc(q.id)}',${i},'priceDelta',this.value)" placeholder="+ / - prijs">
      <select aria-label="Prijsactie" onchange="updateBuybackQuestionOption('${esc(q.id)}',${i},'action',this.value)">
        <option value="price" ${(o.action||'price')==='price'?'selected':''}>Prijs aanpassen</option>
        <option value="scrap" ${o.action==='scrap'?'selected':''}>Scrapprijs gebruiken</option>
        <option value="reject" ${o.action==='reject'?'selected':''}>Inkoop weigeren</option>
      </select>
      <label style="font-size:11px;font-weight:800"><input type="checkbox" ${o.active!==false?'checked':''} onchange="updateBuybackQuestionOption('${esc(q.id)}',${i},'active',this.checked)"> Actief</label>
      <button class="bb-q-delete" type="button" onclick="deleteBuybackQuestionOption('${esc(q.id)}',${i})">×</button>
    </div>`).join('')}
    <button class="btn btn-light" type="button" onclick="addBuybackQuestionOption('${esc(q.id)}')">+ Optie</button>
  </div>`;
}

function updateBuybackQuestion(id,key,value){
  const t=getBuybackType();const q=t&&t.questions.find(x=>x.id===id);if(!q)return;
  if(key==='required')q.required=!!value;
  else if(key==='type'){
    q.type=value;
    q.options=value==='text'?[]:[{label:'Ja',priceDelta:0,active:true},{label:'Nee',priceDelta:-25,active:true}];
    markChanged();
    renderBuybackTypeSettings();
    return;
  }else q[key]=value;
  markChanged();
}
function toggleBuybackQuestion(id){buybackQuestionOpenId=buybackQuestionOpenId===id?'':id;renderBuybackTypeSettings();}
function addBuybackQuestion(type){
  const t=getBuybackType();if(!t)return;
  const label=prompt('Naam van de vraag:','Nieuwe vraag');if(!label||!label.trim())return;
  t.questions=t.questions||[];
  t.questions.push({id:newBuybackId("q"),label:label.trim(),type,required:true,options:type==='text'?[]:[{label:type==='yesno'?'Ja':'Optie 1',priceDelta:0,active:true},{label:type==='yesno'?'Nee':'Optie 2',priceDelta:-25,active:true}]});
  markChanged();renderBuybackTypeSettings();
}
function deleteBuybackQuestion(id){
  const t=getBuybackType();if(!t)return;
  if(!confirm('Deze vraag verwijderen voor dit type apparaat?'))return;
  t.questions=t.questions.filter(q=>q.id!==id);buybackQuestionOpenId='';markChanged();renderBuybackTypeSettings();
}
function updateBuybackQuestionOption(qid,index,key,value){
  const t=getBuybackType();const q=t&&t.questions.find(x=>x.id===qid);if(!q||!q.options[index])return;
  q.options[index][key]=key==='priceDelta'?Number(value||0):key==='active'?!!value:value;
  markChanged();
}
function addBuybackQuestionOption(qid){
  const t=getBuybackType();const q=t&&t.questions.find(x=>x.id===qid);if(!q)return;
  q.options.push({label:'Nieuwe optie',priceDelta:0,active:true});markChanged();renderBuybackTypeSettings();
}
function deleteBuybackQuestionOption(qid,index){
  const t=getBuybackType();const q=t&&t.questions.find(x=>x.id===qid);if(!q)return;
  q.options.splice(index,1);markChanged();renderBuybackTypeSettings();
}

function getBuybackBrand(){
  return data.buybackCatalog.find(x=>x.id===selectedBuybackBrandId)||null;
}
function getBuybackType(){
  const b=getBuybackBrand();
  return b ? (b.types||[]).find(x=>x.id===selectedBuybackTypeId)||null : null;
}
function getBuybackModel(){
  const t=getBuybackType();
  return t ? (t.models||[]).find(x=>x.id===selectedBuybackModelId)||null : null;
}
function getBuybackPhoneById(id){
  return data.buybackPhones.find(x=>x.id===id)||null;
}

function getSelectedBuybackPhone(){
  const m=getBuybackModel();
  return m ? getBuybackPhoneById(m.buybackId) : null;
}

function updateSelectedBuybackPhoneField(key,value){
  const phone=getSelectedBuybackPhone();
  if(!phone)return;
  if(key==='price') phone.price=Number(value||0);
  else if(key==='active') phone.active=!!value;
  else phone[key]=value;
  markChanged();
}

function updateSelectedBuybackPhoneOption(key,index,field,value){
  const phone=getSelectedBuybackPhone();
  if(!phone || !Array.isArray(phone[key]) || !phone[key][index])return;
  phone[key][index][field]=field==='priceDelta'
    ? Number(value||0)
    : field==='active'
      ? !!value
      : value;
  markChanged();
}
function ensureBuybackSelection(){
  const brands=data.buybackCatalog||[];
  if(!brands.length){selectedBuybackBrandId="";selectedBuybackTypeId="";selectedBuybackModelId="";return;}
  if(!brands.some(x=>x.id===selectedBuybackBrandId)) selectedBuybackBrandId=brands[0].id;
  const b=getBuybackBrand();
  const types=b&&b.types||[];
  if(!types.some(x=>x.id===selectedBuybackTypeId)) selectedBuybackTypeId=types[0]?types[0].id:"";
  const t=getBuybackType();
  const models=t&&t.models||[];
  if(!models.some(x=>x.id===selectedBuybackModelId)) selectedBuybackModelId=models[0]?models[0].id:"";
}

function buybackSteps(step){
  const labels=['Merk','Toestel','Details'];
  return '<div class="fz-steps">'+labels.map((l,i)=>
    '<div class="fz-step'+(i<=step?' done':'')+'"><div class="fz-dot"></div><span>'+l+'</span></div>'+
    (i<labels.length-1?'<div class="fz-line"></div>':'')
  ).join('')+'</div>';
}
function buybackSearchBox(placeholder){
  return '<div class="fz-search"><input id="buybackSearchInput" type="search" placeholder="'+placeholder+'" value="'+esc(buybackSearch)+'" oninput="onBuybackSearch(this.value)"></div>';
}
function onBuybackSearch(v){
  buybackSearch=v;
  renderBuybackPhones();
  const el=document.getElementById('buybackSearchInput');
  if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);}
}
function buybackMatches(name){
  const q=buybackSearch.trim().toLowerCase();
  return !q || String(name||'').toLowerCase().includes(q);
}

function renderBuybackPhones(){
  normalizeBuybackPhones();
  normalizeBuybackCatalog();
  normalizeBuybackTypeSettings();

  const box=document.getElementById('buybackHierarchy');
  const editor=document.getElementById('buybackModelEditor');
  if(!box||!editor)return;
  editor.innerHTML='';

  const brands=data.buybackCatalog||[];
  if(!brands.length){
    buybackAdminLevel='brands';
    box.innerHTML='<div class="buyback-v1-empty">Nog geen merk toegevoegd.<br><br><button class="btn btn-green" type="button" onclick="addBuybackBrand()">+ Eerste merk toevoegen</button></div>';
    return;
  }

  const imageHtml=(src,emoji='📱')=>src
    ? `<img src="${esc(src)}" alt="">`
    : `<div class="buyback-v1-placeholder">${emoji}</div>`;

  // LEVEL 1 — BRANDS
  if(buybackAdminLevel==='brands'){
    box.innerHTML=`<div class="buyback-v1-shell">
      ${buybackSteps(0)}
      ${buybackSearchBox('Zoek een merk...')}
      <div class="buyback-v1-head">
        <div class="buyback-v1-title"><h3>Merken</h3><p>Kies een merk om de apparaten te beheren.</p></div>
        <button class="btn btn-green" type="button" onclick="addBuybackBrand()">+ Merk toevoegen</button>
      </div>
      <div class="buyback-v1-grid">
        ${brands.filter(b=>buybackMatches(b.name)).map(b=>`<div class="buyback-v1-card" role="button" tabindex="0" onclick="selectBuybackBrand('${esc(b.id)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectBuybackBrand('${esc(b.id)}')}">
          <div class="buyback-v1-image">${imageHtml(b.image,'🏷️')}</div>
          <div class="buyback-v1-name">${esc(b.name)}</div>
          <div class="buyback-v1-meta">${(b.types||[]).reduce((n,t)=>n+(t.models||[]).length,0)} telefoon${((b.types||[]).reduce((n,t)=>n+(t.models||[]).length,0))===1?'':'s'}</div>
          <div class="buyback-v1-card-actions" onclick="event.stopPropagation()">
            <button type="button" class="buyback-v1-card-action" onclick="editBuybackBrand('${esc(b.id)}')">✏️ Bewerken</button>
            <button type="button" class="buyback-v1-card-action danger" onclick="deleteBuybackBrand('${esc(b.id)}')">🗑️ Verwijderen</button>
          </div>
        </div>`).join('')}
        <button type="button" class="buyback-v1-card buyback-v1-add" onclick="addBuybackBrand()"><div><strong>+ Merk toevoegen</strong><span>Bijvoorbeeld Apple, Samsung...</span></div></button>
      </div>
    </div>`;
    return;
  }

  const b=getBuybackBrand();
  if(!b){buybackAdminLevel='brands';return renderBuybackPhones();}

  // V2 — DIRECT FROM BRAND TO DEVICES/MODELS
  // The existing internal type structure is preserved for compatibility and type-specific questions,
  // but it is no longer shown as a separate navigation step.
  if(buybackAdminLevel==='models') {
    const modelEntries=[];
    (b.types||[]).forEach(t=>(t.models||[]).forEach(m=>modelEntries.push({type:t,model:m,phone:getBuybackPhoneById(m.buybackId)})));
    box.innerHTML=`<div class="buyback-v1-shell">
      ${buybackSteps(1)}
      ${buybackSearchBox('Zoek jouw apparaat...')}
      <div class="buyback-v1-head">
        <div class="buyback-v1-head-left">
          <button class="buyback-v1-back" type="button" onclick="buybackGoBrands()">← Merken</button>
          <div class="buyback-v1-title"><h3>${esc(b.name)}</h3><p>Kies direct het toestel.</p></div>
        </div>
        <button class="btn btn-green" type="button" onclick="addBuybackModel()">+ Telefoon toevoegen</button>
      </div>
      <div class="buyback-v1-grid">
        ${modelEntries.filter(({model:pModel,phone:p})=>buybackMatches((p&&p.name)||pModel.name)).map(({type,model:pModel,phone:p})=>`<div class="buyback-v1-card" role="button" tabindex="0" onclick="selectBuybackModel('${esc(pModel.id)}','${esc(type.id)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectBuybackModel('${esc(pModel.id)}','${esc(type.id)}')}">
          <div class="buyback-v1-image">${imageHtml(p&&p.image,'📱')}</div>
          <div class="buyback-v1-name">${esc((p&&p.name)||pModel.name)}</div>
          <div class="buyback-v1-brand-badge">${esc(type.name||'Telefoon')} · ${p&&p.active===false?'Verborgen':'Zichtbaar'}</div>
          <div class="buyback-v1-price">€ ${Number(p&&p.price||0).toFixed(2)}</div>
          <div class="buyback-v1-card-actions" onclick="event.stopPropagation()">
            <button type="button" class="buyback-v1-card-action" onclick="editBuybackModel('${esc(pModel.id)}','${esc(type.id)}')">✏️ Bewerken</button>
            <button type="button" class="buyback-v1-card-action danger" onclick="deleteBuybackModelById('${esc(pModel.id)}','${esc(type.id)}')">🗑️ Verwijderen</button>
          </div>
        </div>`).join('')}
        <button type="button" class="buyback-v1-card buyback-v1-add" onclick="addBuybackModel()"><div><strong>+ Telefoon toevoegen</strong><span>Voeg een nieuw toestel toe</span></div></button>
      </div>
      ${modelEntries.length?'':'<div class="buyback-tree-empty" style="margin-top:12px">Nog geen telefoons voor dit merk.</div>'}
    </div>`;
    return;
  }

  // LEVEL 3 — existing detailed model editor.
  const t=getBuybackType();
  if(!t){
    // A model can be selected directly from the brand list; if the internal type was missing,
    // fall back safely to the first available type without deleting or changing data.
    const firstType=(b.types||[])[0];
    if(firstType){ selectedBuybackTypeId=firstType.id; return renderBuybackPhones(); }
    buybackAdminLevel='models';
    return renderBuybackPhones();
  }

  renderBuybackModelEditor();
  box.innerHTML=`${buybackSteps(2)}<div class="buyback-v1-head">
    <div class="buyback-v1-head-left">
      <button class="buyback-v1-back" type="button" onclick="buybackGoModels()">← ${esc(b.name)}</button>
      <div class="buyback-v1-title"><h3>${esc(b.name)} → ${esc(getBuybackModel()?.name||'Telefoon')}</h3><p>Bewerk alleen dit toestel.</p></div>
    </div>
  </div>`;
  const existingEditor=document.getElementById('buybackModelEditor');
  if(existingEditor) existingEditor.classList.add('buyback-v1-editor-wrap');
}

function updateBuybackProtocol(value){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol=value==='protocol8'?'protocol8':(value==='protocol7'?'protocol7':(value==='protocol6'?'protocol6':(value==='protocol5'?'protocol5':(value==='protocol4'?'protocol4':(value==='protocol3'?'protocol3':(value==='protocol2'?'protocol2':'protocol1'))))));
  if(phone.protocol==='protocol2') phone.protocol2=normalizeBuybackProtocol2(phone);
  if(phone.protocol==='protocol3') phone.protocol3=normalizeBuybackProtocol3(phone);
  if(phone.protocol==='protocol4') phone.protocol4=normalizeBuybackProtocol4(phone);
  if(phone.protocol==='protocol5') phone.protocol5=normalizeBuybackProtocol5(phone);
  if(phone.protocol==='protocol6') phone.protocol6=normalizeBuybackProtocol6(phone);
  if(phone.protocol==='protocol7') phone.protocol7=normalizeBuybackProtocol7(phone);
  if(phone.protocol==='protocol8') phone.protocol8=normalizeBuybackProtocol8(phone);
  markChanged();renderBuybackModelEditor();
}
function updateProtocol2Field(path,value){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol2=normalizeBuybackProtocol2(phone);
  const parts=String(path).split('.'); let obj=phone.protocol2;
  for(let i=0;i<parts.length-1;i++) obj=obj[parts[i]];
  const k=parts[parts.length-1];
  obj[k]=['yesDelta','noDelta'].includes(k)?Number(value||0):value;
  markChanged();
}
function updateProtocol2Option(key,index,field,value){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol2=normalizeBuybackProtocol2(phone);
  const arr=phone.protocol2[key];if(!Array.isArray(arr)||!arr[index])return;
  arr[index][field]=field==='priceDelta'?Number(value||0):field==='active'?!!value:String(value);
  markChanged();
}
function updateProtocol2Checklist(index,field,value){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol2=normalizeBuybackProtocol2(phone);
  const row=phone.protocol2.checklist[index];if(!row)return;
  row[field]=field==='active'?!!value:String(value);
  markChanged();
}
function addProtocol2Option(key){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol2=normalizeBuybackProtocol2(phone);
  phone.protocol2[key].push({label:'Nieuwe keuze',priceDelta:0,active:true});
  markChanged();renderBuybackModelEditor();
}
function deleteProtocol2Option(key,index){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol2=normalizeBuybackProtocol2(phone);
  phone.protocol2[key].splice(index,1);
  markChanged();renderBuybackModelEditor();
}
function addProtocol2Checklist(){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol2=normalizeBuybackProtocol2(phone);
  phone.protocol2.checklist.push({text:'Nieuwe controlezin',active:true});
  markChanged();renderBuybackModelEditor();
}
function deleteProtocol2Checklist(index){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol2=normalizeBuybackProtocol2(phone);
  phone.protocol2.checklist.splice(index,1);
  markChanged();renderBuybackModelEditor();
}
function updateProtocol3Section(section,value){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  if(!phone.protocol3 || typeof phone.protocol3!=="object") phone.protocol3=normalizeBuybackProtocol3(phone);
  if(!phone.protocol3[section] || typeof phone.protocol3[section]!=="object") phone.protocol3=normalizeBuybackProtocol3(phone);
  phone.protocol3[section].active = value === true || value === "true" || value === 1 || value === "1";
  markChanged();renderBuybackModelEditor();
}
function updateProtocol3Option(section,index,field,value){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol3=normalizeBuybackProtocol3(phone);
  const arr=phone.protocol3[section].options;if(!Array.isArray(arr)||!arr[index])return;
  if(field==='buyPrice'){const v=Number(value||0);arr[index].buyPrice=v;arr[index].conditionPrice=v;arr[index].priceDelta=0;}else if(field==='priceDelta'){arr[index].priceDelta=Number(value||0);delete arr[index].buyPrice;delete arr[index].conditionPrice;}else if(field==='active')arr[index].active=!!value;else arr[index][field]=String(value);
  markChanged();
}
function updateProtocol3Checklist(index,field,value){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol3=normalizeBuybackProtocol3(phone);
  const row=phone.protocol3.checklist.items[index];if(!row)return;
  row[field]=field==='active'?!!value:String(value);
  markChanged();
}
function updateProtocol3Field(path,value){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol3=normalizeBuybackProtocol3(phone);
  const parts=String(path).split('.');let obj=phone.protocol3;
  for(let i=0;i<parts.length-1;i++) obj=obj[parts[i]];
  const k=parts[parts.length-1];
  obj[k]=['yesDelta','noDelta'].includes(k)?Number(value||0):value;
  markChanged();
}
function addProtocol3Option(section){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol3=normalizeBuybackProtocol3(phone);
  phone.protocol3[section].options.push({label:'Nieuwe keuze',buyPrice:0,conditionPrice:0,priceDelta:0,active:true});
  markChanged();renderBuybackModelEditor();
}
function deleteProtocol3Option(section,index){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol3=normalizeBuybackProtocol3(phone);
  phone.protocol3[section].options.splice(index,1);
  markChanged();renderBuybackModelEditor();
}
function addProtocol3Checklist(){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol3=normalizeBuybackProtocol3(phone);
  phone.protocol3.checklist.items.push({text:'Nieuwe controlezin',active:true});
  markChanged();renderBuybackModelEditor();
}
function deleteProtocol3Checklist(index){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol3=normalizeBuybackProtocol3(phone);
  phone.protocol3.checklist.items.splice(index,1);
  markChanged();renderBuybackModelEditor();
}
function updateProtocol8Section(section,value){const phone=getSelectedBuybackPhone();if(!phone)return;if(!phone.protocol8 || typeof phone.protocol8!=="object") phone.protocol8=normalizeBuybackProtocol8(phone);if(!phone.protocol8[section] || typeof phone.protocol8[section]!=="object") phone.protocol8=normalizeBuybackProtocol8(phone);phone.protocol8[section].active=value===true||value==="true"||value===1||value==="1";markChanged();renderBuybackModelEditor();}
function updateProtocol8Option(section,index,field,value){const phone=getSelectedBuybackPhone();if(!phone)return;phone.protocol8=normalizeBuybackProtocol8(phone);const arr=phone.protocol8[section].options;if(!Array.isArray(arr)||!arr[index])return;if(field==='buyPrice'){const v=Number(value||0);arr[index].buyPrice=v;arr[index].conditionPrice=v;arr[index].priceDelta=0;}else if(field==='priceDelta')arr[index].priceDelta=Number(value||0);else if(field==='active')arr[index].active=!!value;else arr[index][field]=String(value);markChanged();}
function updateProtocol8Checklist(index,field,value){const phone=getSelectedBuybackPhone();if(!phone)return;phone.protocol8=normalizeBuybackProtocol8(phone);const row=phone.protocol8.checklist.items[index];if(!row)return;row[field]=field==='active'?!!value:String(value);markChanged();}
function updateProtocol8Field(path,value){const phone=getSelectedBuybackPhone();if(!phone)return;phone.protocol8=normalizeBuybackProtocol8(phone);const parts=String(path).split('.');let obj=phone.protocol8;for(let i=0;i<parts.length-1;i++)obj=obj[parts[i]];const k=parts[parts.length-1];obj[k]=['yesDelta','noDelta'].includes(k)?Number(value||0):value;markChanged();}
function addProtocol8Option(section){const phone=getSelectedBuybackPhone();if(!phone)return;phone.protocol8=normalizeBuybackProtocol8(phone);phone.protocol8[section].options.push({label:'Nieuwe keuze',buyPrice:0,conditionPrice:0,priceDelta:0,active:true});markChanged();renderBuybackModelEditor();}
function deleteProtocol8Option(section,index){const phone=getSelectedBuybackPhone();if(!phone)return;phone.protocol8=normalizeBuybackProtocol8(phone);phone.protocol8[section].options.splice(index,1);markChanged();renderBuybackModelEditor();}
function addProtocol8Checklist(){const phone=getSelectedBuybackPhone();if(!phone)return;phone.protocol8=normalizeBuybackProtocol8(phone);phone.protocol8.checklist.items.push({text:'Nieuwe controlezin',active:true});markChanged();renderBuybackModelEditor();}
function deleteProtocol8Checklist(index){const phone=getSelectedBuybackPhone();if(!phone)return;phone.protocol8=normalizeBuybackProtocol8(phone);phone.protocol8.checklist.items.splice(index,1);markChanged();renderBuybackModelEditor();}
function updateProtocol7Section(section,value){const phone=getSelectedBuybackPhone();if(!phone)return;if(!phone.protocol7 || typeof phone.protocol7!=="object") phone.protocol7=normalizeBuybackProtocol7(phone);if(!phone.protocol7[section] || typeof phone.protocol7[section]!=="object") phone.protocol7=normalizeBuybackProtocol7(phone);phone.protocol7[section].active=value===true||value==="true"||value===1||value==="1";markChanged();renderBuybackModelEditor();}
function updateProtocol7Option(section,index,field,value){const phone=getSelectedBuybackPhone();if(!phone)return;phone.protocol7=normalizeBuybackProtocol7(phone);const arr=phone.protocol7[section].options;if(!Array.isArray(arr)||!arr[index])return;if(field==='buyPrice'){const v=Number(value||0);arr[index].buyPrice=v;arr[index].conditionPrice=v;arr[index].priceDelta=0;}else if(field==='priceDelta')arr[index].priceDelta=Number(value||0);else if(field==='active')arr[index].active=!!value;else arr[index][field]=String(value);markChanged();}
function updateProtocol7Checklist(index,field,value){const phone=getSelectedBuybackPhone();if(!phone)return;phone.protocol7=normalizeBuybackProtocol7(phone);const row=phone.protocol7.checklist.items[index];if(!row)return;row[field]=field==='active'?!!value:String(value);markChanged();}
function updateProtocol7Field(path,value){const phone=getSelectedBuybackPhone();if(!phone)return;phone.protocol7=normalizeBuybackProtocol7(phone);const parts=String(path).split('.');let obj=phone.protocol7;for(let i=0;i<parts.length-1;i++)obj=obj[parts[i]];const k=parts[parts.length-1];obj[k]=['yesDelta','noDelta'].includes(k)?Number(value||0):value;markChanged();}
function addProtocol7Option(section){const phone=getSelectedBuybackPhone();if(!phone)return;phone.protocol7=normalizeBuybackProtocol7(phone);phone.protocol7[section].options.push({label:'Nieuwe keuze',buyPrice:0,conditionPrice:0,priceDelta:0,active:true});markChanged();renderBuybackModelEditor();}
function deleteProtocol7Option(section,index){const phone=getSelectedBuybackPhone();if(!phone)return;phone.protocol7=normalizeBuybackProtocol7(phone);phone.protocol7[section].options.splice(index,1);markChanged();renderBuybackModelEditor();}
function addProtocol7Checklist(){const phone=getSelectedBuybackPhone();if(!phone)return;phone.protocol7=normalizeBuybackProtocol7(phone);phone.protocol7.checklist.items.push({text:'Nieuwe controlezin',active:true});markChanged();renderBuybackModelEditor();}
function deleteProtocol7Checklist(index){const phone=getSelectedBuybackPhone();if(!phone)return;phone.protocol7=normalizeBuybackProtocol7(phone);phone.protocol7.checklist.items.splice(index,1);markChanged();renderBuybackModelEditor();}
function updateProtocol6Section(section,value){const phone=getSelectedBuybackPhone();if(!phone)return;if(!phone.protocol6 || typeof phone.protocol6!=="object") phone.protocol6=normalizeBuybackProtocol6(phone);if(!phone.protocol6[section] || typeof phone.protocol6[section]!=="object") phone.protocol6=normalizeBuybackProtocol6(phone);phone.protocol6[section].active=value===true||value==="true"||value===1||value==="1";markChanged();renderBuybackModelEditor();}
function updateProtocol6Option(section,index,field,value){const phone=getSelectedBuybackPhone();if(!phone)return;phone.protocol6=normalizeBuybackProtocol6(phone);const arr=phone.protocol6[section].options;if(!Array.isArray(arr)||!arr[index])return;if(field==='buyPrice'){const v=Number(value||0);arr[index].buyPrice=v;arr[index].conditionPrice=v;arr[index].priceDelta=0;}else if(field==='priceDelta')arr[index].priceDelta=Number(value||0);else if(field==='active')arr[index].active=!!value;else arr[index][field]=String(value);markChanged();}
function updateProtocol6Checklist(index,field,value){const phone=getSelectedBuybackPhone();if(!phone)return;phone.protocol6=normalizeBuybackProtocol6(phone);const row=phone.protocol6.checklist.items[index];if(!row)return;row[field]=field==='active'?!!value:String(value);markChanged();}
function updateProtocol6Field(path,value){const phone=getSelectedBuybackPhone();if(!phone)return;phone.protocol6=normalizeBuybackProtocol6(phone);const parts=String(path).split('.');let obj=phone.protocol6;for(let i=0;i<parts.length-1;i++)obj=obj[parts[i]];const k=parts[parts.length-1];obj[k]=['yesDelta','noDelta'].includes(k)?Number(value||0):value;markChanged();}
function addProtocol6Option(section){const phone=getSelectedBuybackPhone();if(!phone)return;phone.protocol6=normalizeBuybackProtocol6(phone);phone.protocol6[section].options.push({label:'Nieuwe keuze',buyPrice:0,conditionPrice:0,priceDelta:0,active:true});markChanged();renderBuybackModelEditor();}
function deleteProtocol6Option(section,index){const phone=getSelectedBuybackPhone();if(!phone)return;phone.protocol6=normalizeBuybackProtocol6(phone);phone.protocol6[section].options.splice(index,1);markChanged();renderBuybackModelEditor();}
function addProtocol6Checklist(){const phone=getSelectedBuybackPhone();if(!phone)return;phone.protocol6=normalizeBuybackProtocol6(phone);phone.protocol6.checklist.items.push({text:'Nieuwe controlezin',active:true});markChanged();renderBuybackModelEditor();}
function deleteProtocol6Checklist(index){const phone=getSelectedBuybackPhone();if(!phone)return;phone.protocol6=normalizeBuybackProtocol6(phone);phone.protocol6.checklist.items.splice(index,1);markChanged();renderBuybackModelEditor();}
function updateProtocol5Section(section,value){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol5=normalizeBuybackProtocol5(phone);
  phone.protocol5[section].active=!!value;
  markChanged();renderBuybackModelEditor();
}
function updateProtocol5Option(section,index,field,value){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol5=normalizeBuybackProtocol5(phone);
  const arr=phone.protocol5[section].options;if(!Array.isArray(arr)||!arr[index])return;
  if(field==='buyPrice'){const v=Number(value||0);arr[index].buyPrice=v;arr[index].conditionPrice=v;arr[index].priceDelta=0;}else if(field==='priceDelta')arr[index].priceDelta=Number(value||0);else if(field==='active')arr[index].active=!!value;else arr[index][field]=String(value);
  markChanged();
}
function updateProtocol5Checklist(index,field,value){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol5=normalizeBuybackProtocol5(phone);
  const row=phone.protocol5.checklist.items[index];if(!row)return;
  row[field]=field==='active'?!!value:String(value);
  markChanged();
}
function updateProtocol5Field(path,value){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol5=normalizeBuybackProtocol5(phone);
  const parts=String(path).split('.');let obj=phone.protocol5;
  for(let i=0;i<parts.length-1;i++) obj=obj[parts[i]];
  const k=parts[parts.length-1];
  obj[k]=['yesDelta','noDelta'].includes(k)?Number(value||0):value;
  markChanged();
}
function addProtocol5Option(section){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol5=normalizeBuybackProtocol5(phone);
  phone.protocol5[section].options.push({label:'Nieuwe keuze',buyPrice:0,conditionPrice:0,priceDelta:0,active:true});
  markChanged();renderBuybackModelEditor();
}
function deleteProtocol5Option(section,index){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol5=normalizeBuybackProtocol5(phone);
  phone.protocol5[section].options.splice(index,1);
  markChanged();renderBuybackModelEditor();
}
function addProtocol5Checklist(){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol5=normalizeBuybackProtocol5(phone);
  phone.protocol5.checklist.items.push({text:'Nieuwe controlezin',active:true});
  markChanged();renderBuybackModelEditor();
}
function deleteProtocol5Checklist(index){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol5=normalizeBuybackProtocol5(phone);
  phone.protocol5.checklist.items.splice(index,1);
  markChanged();renderBuybackModelEditor();
}
function updateProtocol4Section(section,value){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol4=normalizeBuybackProtocol4(phone);
  phone.protocol4[section].active=!!value;
  markChanged();renderBuybackModelEditor();
}
function updateProtocol4Option(section,index,field,value){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol4=normalizeBuybackProtocol4(phone);
  const arr=phone.protocol4[section].options;if(!Array.isArray(arr)||!arr[index])return;
  if(field==='buyPrice'){const v=Number(value||0);arr[index].buyPrice=v;arr[index].conditionPrice=v;arr[index].priceDelta=0;}else if(field==='priceDelta')arr[index].priceDelta=Number(value||0);else if(field==='active')arr[index].active=!!value;else arr[index][field]=String(value);
  markChanged();
}
function updateProtocol4CapacityConditionPrice(index,state,value){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol4=normalizeBuybackProtocol4(phone);
  const row=phone.protocol4.capacity.options[index];if(!row)return;
  if(!row.conditionPrices)row.conditionPrices={new:0,light:0,visible:0,broken:0};
  row.conditionPrices[state]=Number(value||0);
  markChanged();
}
function updateProtocol4Checklist(index,field,value){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol4=normalizeBuybackProtocol4(phone);
  const row=phone.protocol4.checklist.items[index];if(!row)return;
  row[field]=field==='active'?!!value:String(value);
  markChanged();
}
function updateProtocol4Field(path,value){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol4=normalizeBuybackProtocol4(phone);
  const parts=String(path).split('.');let obj=phone.protocol4;
  for(let i=0;i<parts.length-1;i++) obj=obj[parts[i]];
  const k=parts[parts.length-1];
  obj[k]=['yesDelta','noDelta'].includes(k)?Number(value||0):value;
  markChanged();
}
function addProtocol4Option(section){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol4=normalizeBuybackProtocol4(phone);
  phone.protocol4[section].options.push(section==='condition'?{label:'Nieuwe keuze',buyPrice:0,conditionPrice:0,priceDelta:0,active:true}:section==='capacity'?{label:'Nieuwe opslag',priceDelta:0,conditionPrices:{new:0,light:0,visible:0,broken:0},active:true}:{label:'Nieuwe keuze',priceDelta:0,active:true});
  markChanged();renderBuybackModelEditor();
}
function deleteProtocol4Option(section,index){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol4=normalizeBuybackProtocol4(phone);
  phone.protocol4[section].options.splice(index,1);
  markChanged();renderBuybackModelEditor();
}
function addProtocol4Checklist(){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol4=normalizeBuybackProtocol4(phone);
  phone.protocol4.checklist.items.push({text:'Nieuwe controlezin',active:true});
  markChanged();renderBuybackModelEditor();
}
function deleteProtocol4Checklist(index){
  const phone=getSelectedBuybackPhone();if(!phone)return;
  phone.protocol4=normalizeBuybackProtocol4(phone);
  phone.protocol4.checklist.items.splice(index,1);
  markChanged();renderBuybackModelEditor();
}
function renderProtocol8Settings(phone){
  const p=normalizeBuybackProtocol8(phone);phone.protocol8=p;
  const optionEditor=(section,title,addText)=>`<div class="card bb-proto8-card"><div class="bb-proto8-card-head"><div><div class="card-title">${title}</div><div class="small">Keuzes, prijsaanpassingen en zichtbaarheid</div></div><label class="bb-proto8-switch"><input type="checkbox" ${p[section].active!==false?'checked':''} onchange="updateProtocol8Section('${section}',this.checked)"><span>Op website tonen</span></label></div>${p[section].options.map((o,i)=>`<div class="bb-proto8-row"><input value="${esc(o.label)}" oninput="updateProtocol8Option('${section}',${i},'label',this.value)"><input type="number" step="1" value="${section==='condition'?Number(o.conditionPrice ?? o.buyPrice ?? o.priceDelta ?? 0):Number(o.priceDelta||0)}" oninput="updateProtocol8Option('${section}',${i},'${section==='condition'?'buyPrice':'priceDelta'}',this.value)" placeholder="+ / -"><label class="bb-proto8-switch"><input type="checkbox" ${o.active!==false?'checked':''} onchange="updateProtocol8Option('${section}',${i},'active',this.checked)"><span>Actief</span></label><button type="button" class="btn btn-light" onclick="deleteProtocol8Option('${section}',${i})">🗑️</button></div>`).join('')}<button type="button" class="btn btn-light" onclick="addProtocol8Option('${section}')">+ ${addText}</button></div>`;
  return `<div class="bb-protocol8-settings"><div class="bb-protocol8-title"><div><h4>💻 Protocol 8 instellingen</h4><div class="small">Opbouw zoals de MacBook Pro-verkoopstap: schermgrootte, model/jaar, processor, opslag, geheugen, grafische kaart, staat, controlepunten, functies en batterij.</div></div><div class="bb-protocol8-badge">PROTOCOL 8</div></div>
    ${optionEditor('screenSize','Schermgrootte','Schermformaat toevoegen')}
    ${optionEditor('yearModel','Jaar en type','Model/jaar toevoegen')}
    ${optionEditor('processor','Processor','Processor toevoegen')}
    ${optionEditor('storage','Opslag','Opslagoptie toevoegen')}
    ${optionEditor('memory','Geheugen','Geheugenoptie toevoegen')}
    ${optionEditor('graphics','Grafische kaart','Grafische kaart toevoegen')}
    ${optionEditor('condition','Staat van de iPhone — prijsaanpassing (€)','Conditie toevoegen')}
    <div class="card bb-proto8-card"><div class="bb-proto8-card-head"><div><div class="card-title">Controlepunten</div><div class="small">Deze tekst verschijnt als toelichting bij de gekozen staat.</div></div><label class="bb-proto8-switch"><input type="checkbox" ${p.checklist.active!==false?'checked':''} onchange="updateProtocol8Section('checklist',this.checked)"><span>Op website tonen</span></label></div>${p.checklist.items.map((o,i)=>`<div class="bb-proto8-row bb-proto8-check"><input value="${esc(o.text)}" oninput="updateProtocol8Checklist(${i},'text',this.value)"><label class="bb-proto8-switch"><input type="checkbox" ${o.active!==false?'checked':''} onchange="updateProtocol8Checklist(${i},'active',this.checked)"><span>Actief</span></label><button type="button" class="btn btn-light" onclick="deleteProtocol8Checklist(${i})">🗑️</button></div>`).join('')}<button type="button" class="btn btn-light" onclick="addProtocol8Checklist()">+ Controlepunt toevoegen</button></div>
    <div class="card bb-proto8-card"><div class="bb-proto8-card-head"><div><div class="card-title">Alle functies werken?</div><div class="small">Ja/Nee kan een eigen prijsaanpassing krijgen.</div></div><label class="bb-proto8-switch"><input type="checkbox" ${p.functions.active!==false?'checked':''} onchange="updateProtocol8Field('functions.active',this.checked)"><span>Op website tonen</span></label></div><div class="field"><label>Vraag</label><textarea oninput="updateProtocol8Field('functions.label',this.value)">${esc(p.functions.label)}</textarea></div><div class="bb-proto8-two"><div class="field"><label>Ja: prijsaanpassing</label><input type="number" step="1" value="${Number(p.functions.yesDelta||0)}" oninput="updateProtocol8Field('functions.yesDelta',this.value)"></div><div class="field"><label>Nee: prijsaanpassing</label><input type="number" step="1" value="${Number(p.functions.noDelta||0)}" oninput="updateProtocol8Field('functions.noDelta',this.value)"></div></div></div>
    <div class="card bb-proto8-card"><div class="bb-proto8-card-head"><div><div class="card-title">Batterijstatus</div><div class="small">Meerdere batterijstatussen met een eigen prijsaanpassing.</div></div><label class="bb-proto8-switch"><input type="checkbox" ${p.battery.active!==false?'checked':''} onchange="updateProtocol8Section('battery',this.checked)"><span>Op website tonen</span></label></div>${p.battery.options.map((o,i)=>`<div class="bb-proto8-row"><input value="${esc(o.label)}" oninput="updateProtocol8Option('battery',${i},'label',this.value)"><input type="number" step="1" value="${Number(o.priceDelta||0)}" oninput="updateProtocol8Option('battery',${i},'priceDelta',this.value)" placeholder="Prijsaanpassing"><label class="bb-proto8-switch"><input type="checkbox" ${o.active!==false?'checked':''} onchange="updateProtocol8Option('battery',${i},'active',this.checked)"><span>Actief</span></label><button type="button" class="btn btn-light" onclick="deleteProtocol8Option('battery',${i})">🗑️</button></div>`).join('')}<button type="button" class="btn btn-light" onclick="addProtocol8Option('battery')">+ Batterijstatus toevoegen</button></div>
  </div>`;
}

function renderProtocol7Settings(phone){
  const p=normalizeBuybackProtocol7(phone);phone.protocol7=p;
  const optionEditor=(section,title,addText)=>`<div class="card bb-proto7-card"><div class="bb-proto7-card-head"><div><div class="card-title">${title}</div><div class="small">Keuzes, prijsaanpassingen en zichtbaarheid</div></div><label class="bb-proto7-switch"><input type="checkbox" ${p[section].active!==false?'checked':''} onchange="updateProtocol7Section('${section}',this.checked)"><span>Op website tonen</span></label></div>${p[section].options.map((o,i)=>`<div class="bb-proto7-row"><input value="${esc(o.label)}" oninput="updateProtocol7Option('${section}',${i},'label',this.value)"><input type="number" step="1" value="${section==='condition'?Number(o.conditionPrice ?? o.buyPrice ?? o.priceDelta ?? 0):Number(o.priceDelta||0)}" oninput="updateProtocol7Option('${section}',${i},'${section==='condition'?'buyPrice':'priceDelta'}',this.value)" placeholder="+ / -"><label class="bb-proto7-switch"><input type="checkbox" ${o.active!==false?'checked':''} onchange="updateProtocol7Option('${section}',${i},'active',this.checked)"><span>Actief</span></label><button type="button" class="btn btn-light" onclick="deleteProtocol7Option('${section}',${i})">🗑️</button></div>`).join('')}<button type="button" class="btn btn-light" onclick="addProtocol7Option('${section}')">+ ${addText}</button></div>`;
  return `<div class="bb-protocol7-settings"><div class="bb-protocol7-title"><div><h4>📱 Protocol 7 instellingen</h4><div class="small">Opbouw zoals de Samsung Galaxy Tab S10 FE Plus-verkoopstap: Wi-Fi, capaciteit, staat, controlepunten, functies en batterijstatus.</div></div><div class="bb-protocol7-badge">PROTOCOL 7</div></div>
    ${optionEditor('connectivity','Connectiviteit','Verbindingsoptie toevoegen')}
    ${optionEditor('capacity','Capaciteit','Opslag toevoegen')}
    ${optionEditor('condition','Staat van de iPhone — prijsaanpassing (€)','Conditie toevoegen')}
    <div class="card bb-proto7-card"><div class="bb-proto7-card-head"><div><div class="card-title">Controlepunten</div><div class="small">Deze tekst verschijnt als toelichting bij de gekozen staat.</div></div><label class="bb-proto7-switch"><input type="checkbox" ${p.checklist.active!==false?'checked':''} onchange="updateProtocol7Section('checklist',this.checked)"><span>Op website tonen</span></label></div>${p.checklist.items.map((o,i)=>`<div class="bb-proto7-row bb-proto7-check"><input value="${esc(o.text)}" oninput="updateProtocol7Checklist(${i},'text',this.value)"><label class="bb-proto7-switch"><input type="checkbox" ${o.active!==false?'checked':''} onchange="updateProtocol7Checklist(${i},'active',this.checked)"><span>Actief</span></label><button type="button" class="btn btn-light" onclick="deleteProtocol7Checklist(${i})">🗑️</button></div>`).join('')}<button type="button" class="btn btn-light" onclick="addProtocol7Checklist()">+ Controlepunt toevoegen</button></div>
    <div class="card bb-proto7-card"><div class="bb-proto7-card-head"><div><div class="card-title">Alle functies werken?</div><div class="small">Ja/Nee kan een eigen prijsaanpassing krijgen.</div></div><label class="bb-proto7-switch"><input type="checkbox" ${p.functions.active!==false?'checked':''} onchange="updateProtocol7Field('functions.active',this.checked)"><span>Op website tonen</span></label></div><div class="field"><label>Vraag</label><textarea oninput="updateProtocol7Field('functions.label',this.value)">${esc(p.functions.label)}</textarea></div><div class="bb-proto7-two"><div class="field"><label>Ja: prijsaanpassing</label><input type="number" step="1" value="${Number(p.functions.yesDelta||0)}" oninput="updateProtocol7Field('functions.yesDelta',this.value)"></div><div class="field"><label>Nee: prijsaanpassing</label><input type="number" step="1" value="${Number(p.functions.noDelta||0)}" oninput="updateProtocol7Field('functions.noDelta',this.value)"></div></div></div>
    <div class="card bb-proto7-card"><div class="bb-proto7-card-head"><div><div class="card-title">Batterijstatus</div><div class="small">Meerdere batterijstatussen met een eigen prijsaanpassing.</div></div><label class="bb-proto7-switch"><input type="checkbox" ${p.battery.active!==false?'checked':''} onchange="updateProtocol7Section('battery',this.checked)"><span>Op website tonen</span></label></div>${p.battery.options.map((o,i)=>`<div class="bb-proto7-row"><input value="${esc(o.label)}" oninput="updateProtocol7Option('battery',${i},'label',this.value)"><input type="number" step="1" value="${Number(o.priceDelta||0)}" oninput="updateProtocol7Option('battery',${i},'priceDelta',this.value)" placeholder="Prijsaanpassing"><label class="bb-proto7-switch"><input type="checkbox" ${o.active!==false?'checked':''} onchange="updateProtocol7Option('battery',${i},'active',this.checked)"><span>Actief</span></label><button type="button" class="btn btn-light" onclick="deleteProtocol7Option('battery',${i})">🗑️</button></div>`).join('')}<button type="button" class="btn btn-light" onclick="addProtocol7Option('battery')">+ Batterijstatus toevoegen</button></div>
  </div>`;
}

function renderProtocol6Settings(phone){
  const p=normalizeBuybackProtocol6(phone);phone.protocol6=p;
  const optionEditor=(section,title,addText)=>`<div class="card bb-proto6-card"><div class="bb-proto6-card-head"><div><div class="card-title">${title}</div><div class="small">Keuzes, prijsaanpassingen en zichtbaarheid</div></div><label class="bb-proto6-switch"><input type="checkbox" ${p[section].active!==false?'checked':''} onchange="updateProtocol6Section('${section}',this.checked)"><span>Op website tonen</span></label></div>${p[section].options.map((o,i)=>`<div class="bb-proto6-row"><input value="${esc(o.label)}" oninput="updateProtocol6Option('${section}',${i},'label',this.value)"><input type="number" step="1" value="${section==='condition'?Number(o.conditionPrice ?? o.buyPrice ?? o.priceDelta ?? 0):Number(o.priceDelta||0)}" oninput="updateProtocol6Option('${section}',${i},'${section==='condition'?'buyPrice':'priceDelta'}',this.value)" placeholder="+ / -"><label class="bb-proto6-switch"><input type="checkbox" ${o.active!==false?'checked':''} onchange="updateProtocol6Option('${section}',${i},'active',this.checked)"><span>Actief</span></label><button type="button" class="btn btn-light" onclick="deleteProtocol6Option('${section}',${i})">🗑️</button></div>`).join('')}<button type="button" class="btn btn-light" onclick="addProtocol6Option('${section}')">+ ${addText}</button></div>`;
  return `<div class="bb-protocol6-settings"><div class="bb-protocol6-title"><div><h4>📱 Protocol 6 instellingen</h4><div class="small">Opbouw zoals de Samsung Galaxy A56-verkoopstap: ontgrendeling, capaciteit, RAM, staat, controlepunten, functies en batterijstatus.</div></div><div class="bb-protocol6-badge">PROTOCOL 6</div></div>
    ${optionEditor('connectivity','Connectiviteit','Verbindingsoptie toevoegen')}
    ${optionEditor('capacity','Capaciteit','Opslag toevoegen')}
    ${optionEditor('ram','Geheugen-grootte (RAM)','RAM-optie toevoegen')}
    ${optionEditor('condition','Staat van het toestel — vaste prijs (€)','Conditie toevoegen')}
    <div class="card bb-proto6-card"><div class="bb-proto6-card-head"><div><div class="card-title">Controlepunten</div><div class="small">Deze tekst verschijnt als toelichting bij de gekozen staat.</div></div><label class="bb-proto6-switch"><input type="checkbox" ${p.checklist.active!==false?'checked':''} onchange="updateProtocol6Section('checklist',this.checked)"><span>Op website tonen</span></label></div>${p.checklist.items.map((o,i)=>`<div class="bb-proto6-row bb-proto6-check"><input value="${esc(o.text)}" oninput="updateProtocol6Checklist(${i},'text',this.value)"><label class="bb-proto6-switch"><input type="checkbox" ${o.active!==false?'checked':''} onchange="updateProtocol6Checklist(${i},'active',this.checked)"><span>Actief</span></label><button type="button" class="btn btn-light" onclick="deleteProtocol6Checklist(${i})">🗑️</button></div>`).join('')}<button type="button" class="btn btn-light" onclick="addProtocol6Checklist()">+ Controlepunt toevoegen</button></div>
    <div class="card bb-proto6-card"><div class="bb-proto6-card-head"><div><div class="card-title">Alle functies werken?</div><div class="small">Ja/Nee kan een eigen prijsaanpassing krijgen.</div></div><label class="bb-proto6-switch"><input type="checkbox" ${p.functions.active!==false?'checked':''} onchange="updateProtocol6Field('functions.active',this.checked)"><span>Op website tonen</span></label></div><div class="field"><label>Vraag</label><textarea oninput="updateProtocol6Field('functions.label',this.value)">${esc(p.functions.label)}</textarea></div><div class="bb-proto6-two"><div class="field"><label>Ja: prijsaanpassing</label><input type="number" step="1" value="${Number(p.functions.yesDelta||0)}" oninput="updateProtocol6Field('functions.yesDelta',this.value)"></div><div class="field"><label>Nee: prijsaanpassing</label><input type="number" step="1" value="${Number(p.functions.noDelta||0)}" oninput="updateProtocol6Field('functions.noDelta',this.value)"></div></div></div>
    <div class="card bb-proto6-card"><div class="bb-proto6-card-head"><div><div class="card-title">Batterijstatus</div><div class="small">Meerdere batterijstatussen met een eigen prijsaanpassing.</div></div><label class="bb-proto6-switch"><input type="checkbox" ${p.battery.active!==false?'checked':''} onchange="updateProtocol6Section('battery',this.checked)"><span>Op website tonen</span></label></div>${p.battery.options.map((o,i)=>`<div class="bb-proto6-row"><input value="${esc(o.label)}" oninput="updateProtocol6Option('battery',${i},'label',this.value)"><input type="number" step="1" value="${Number(o.priceDelta||0)}" oninput="updateProtocol6Option('battery',${i},'priceDelta',this.value)" placeholder="Prijsaanpassing"><label class="bb-proto6-switch"><input type="checkbox" ${o.active!==false?'checked':''} onchange="updateProtocol6Option('battery',${i},'active',this.checked)"><span>Actief</span></label><button type="button" class="btn btn-light" onclick="deleteProtocol6Option('battery',${i})">🗑️</button></div>`).join('')}<button type="button" class="btn btn-light" onclick="addProtocol6Option('battery')">+ Batterijstatus toevoegen</button></div>
  </div>`;
}

function renderProtocol5Settings(phone){
  const p=normalizeBuybackProtocol5(phone);phone.protocol5=p;
  const optionEditor=(section,title,addText)=>`<div class="card bb-proto4-card"><div class="bb-proto4-card-head"><div><div class="card-title">${title}</div><div class="small">Alle keuzes worden als prijsaanpassing (+ / -) op de basisprijs berekend.</div></div><label class="bb-proto4-switch"><input type="checkbox" ${p[section].active!==false?'checked':''} onchange="updateProtocol5Section('${section}',this.checked)"><span>Op website tonen</span></label></div>${p[section].options.map((o,i)=>`<div class="bb-proto4-row"><input value="${esc(o.label)}" oninput="updateProtocol5Option('${section}',${i},'label',this.value)"><input type="number" step="1" value="${section==='condition'?Number(o.conditionPrice ?? o.buyPrice ?? o.priceDelta ?? 0):Number(o.priceDelta||0)}" oninput="updateProtocol5Option('${section}',${i},'${section==='condition'?'buyPrice':'priceDelta'}',this.value)" placeholder="+ / -"><label class="bb-proto4-switch"><input type="checkbox" ${o.active!==false?'checked':''} onchange="updateProtocol5Option('${section}',${i},'active',this.checked)"><span>Actief</span></label><button type="button" class="btn btn-light" onclick="deleteProtocol5Option('${section}',${i})">🗑️</button></div>`).join('')}<button type="button" class="btn btn-light" onclick="addProtocol5Option('${section}')">+ ${addText}</button></div>`;
  return `<div class="bb-protocol5-settings">
    <div class="bb-protocol5-title"><div><h4>📱 Protocol 4 instellingen</h4><div class="small">Opbouw zoals de iPad-verkoopstap: connectiviteit, capaciteit, staat, controlepunten, functies en batterij.</div></div><div class="bb-protocol5-badge">PROTOCOL 4</div></div>
    ${optionEditor('connectivity','Connectiviteit','Verbindingsoptie toevoegen')}
    ${optionEditor('capacity','Capaciteit','Opslag toevoegen')}
    ${optionEditor('condition','Staat van het toestel — vaste prijs (€)','Conditie toevoegen')}
    <div class="card bb-proto4-card"><div class="bb-proto4-card-head"><div><div class="card-title">Controlepunten</div><div class="small">Deze tekst verschijnt als toelichting bij de gekozen staat.</div></div><label class="bb-proto4-switch"><input type="checkbox" ${p.checklist.active!==false?'checked':''} onchange="updateProtocol5Section('checklist',this.checked)"><span>Op website tonen</span></label></div>${p.checklist.items.map((o,i)=>`<div class="bb-proto4-row bb-proto4-check"><input value="${esc(o.text)}" oninput="updateProtocol5Checklist(${i},'text',this.value)"><label class="bb-proto4-switch"><input type="checkbox" ${o.active!==false?'checked':''} onchange="updateProtocol5Checklist(${i},'active',this.checked)"><span>Actief</span></label><button type="button" class="btn btn-light" onclick="deleteProtocol5Checklist(${i})">🗑️</button></div>`).join('')}<button type="button" class="btn btn-light" onclick="addProtocol5Checklist()">+ Controlepunt toevoegen</button></div>
    <div class="card bb-proto4-card"><div class="bb-proto4-card-head"><div><div class="card-title">Alle functies werken?</div><div class="small">Ja/Nee kan een eigen prijsaanpassing krijgen.</div></div><label class="bb-proto4-switch"><input type="checkbox" ${p.functions.active!==false?'checked':''} onchange="updateProtocol5Field('functions.active',this.checked)"><span>Op website tonen</span></label></div><div class="field"><label>Vraag</label><textarea oninput="updateProtocol5Field('functions.label',this.value)">${esc(p.functions.label)}</textarea></div><div class="bb-proto4-two"><div class="field"><label>Ja: prijsaanpassing</label><input type="number" step="1" value="${Number(p.functions.yesDelta||0)}" oninput="updateProtocol5Field('functions.yesDelta',this.value)"></div><div class="field"><label>Nee: prijsaanpassing</label><input type="number" step="1" value="${Number(p.functions.noDelta||0)}" oninput="updateProtocol5Field('functions.noDelta',this.value)"></div></div></div>
        ${optionEditor('battery','Batterijconditie — prijsaanpassing (€)','Batterijoptie toevoegen')}
  </div>`;
}

function renderProtocol4Settings(phone){
  const p=normalizeBuybackProtocol4(phone);phone.protocol4=p;
  const capacityEditor=()=>`<div class="card bb-proto4-card"><div class="bb-proto4-card-head"><div><div class="card-title">Opslag en prijzen per staat</div><div class="small">Per opslag een vaste prijs voor elke staat. Deze prijs vervangt de basisprijs.</div></div><label class="bb-proto4-switch"><input type="checkbox" ${p.capacity.active!==false?'checked':''} onchange="updateProtocol4Section('capacity',this.checked)"><span>Op website tonen</span></label></div>${p.capacity.options.map((o,i)=>`<div class="bb-proto4-row"><input value="${esc(o.label)}" oninput="updateProtocol4Option('capacity',${i},'label',this.value)"><label class="bb-proto4-switch"><input type="checkbox" ${o.active!==false?'checked':''} onchange="updateProtocol4Option('capacity',${i},'active',this.checked)"><span>Actief</span></label><button type="button" class="btn btn-light" onclick="deleteProtocol4Option('capacity',${i})">🗑️</button></div><div class="bb-proto4-two"><div class="field"><label>Zo goed als nieuw (€)</label><input type="number" step="1" value="${Number(o.conditionPrices?.new||0)}" oninput="updateProtocol4CapacityConditionPrice(${i},'new',this.value)"></div><div class="field"><label>Licht gebruikt (€)</label><input type="number" step="1" value="${Number(o.conditionPrices?.light||0)}" oninput="updateProtocol4CapacityConditionPrice(${i},'light',this.value)"></div><div class="field"><label>Zichtbaar gebruikt (€)</label><input type="number" step="1" value="${Number(o.conditionPrices?.visible||0)}" oninput="updateProtocol4CapacityConditionPrice(${i},'visible',this.value)"></div><div class="field"><label>Kapot (€)</label><input type="number" step="1" value="${Number(o.conditionPrices?.broken||0)}" oninput="updateProtocol4CapacityConditionPrice(${i},'broken',this.value)"></div></div>`).join('')}<button type="button" class="btn btn-light" onclick="addProtocol4Option('capacity')">+ Opslag toevoegen</button></div>`;
  const optionEditor=(section,title,addText)=>`<div class="card bb-proto4-card"><div class="bb-proto4-card-head"><div><div class="card-title">${title}</div><div class="small">Staat wordt per opslag vast ingesteld. Batterij = prijsaanpassing (+ / -).</div></div><label class="bb-proto4-switch"><input type="checkbox" ${p[section].active!==false?'checked':''} onchange="updateProtocol4Section('${section}',this.checked)"><span>Op website tonen</span></label></div>${p[section].options.map((o,i)=>`<div class="bb-proto4-row"><input value="${esc(o.label)}" oninput="updateProtocol4Option('${section}',${i},'label',this.value)"><input type="number" step="1" value="${section==='condition'?Number(o.conditionPrice ?? o.buyPrice ?? 0):Number(o.priceDelta||0)}" oninput="updateProtocol4Option('${section}',${i},'${section==='condition'?'buyPrice':'priceDelta'}',this.value)" placeholder="${section==='condition'?'Vaste prijs (€)':' + / - (€)'}"><label class="bb-proto4-switch"><input type="checkbox" ${o.active!==false?'checked':''} onchange="updateProtocol4Option('${section}',${i},'active',this.checked)"><span>Actief</span></label><button type="button" class="btn btn-light" onclick="deleteProtocol4Option('${section}',${i})">🗑️</button></div>`).join('')}<button type="button" class="btn btn-light" onclick="addProtocol4Option('${section}')">+ ${addText}</button></div>`;
  return `<div class="bb-protocol4-settings">
    <div class="bb-protocol4-title"><div><h4>📱 Protocol 4 instellingen</h4><div class="small">Opbouw zoals de iPhone-verkoopstap: ontgrendeling, capaciteit, staat, controlepunten, functies en batterij.</div></div><div class="bb-protocol4-badge">PROTOCOL 4</div></div>
    ${optionEditor('connectivity','Connectiviteit','Verbindingsoptie toevoegen')}
    ${capacityEditor()}
    <div class="card bb-proto4-card"><div class="bb-proto4-card-head"><div><div class="card-title">Controlepunten</div><div class="small">Deze tekst verschijnt als toelichting bij de gekozen staat.</div></div><label class="bb-proto4-switch"><input type="checkbox" ${p.checklist.active!==false?'checked':''} onchange="updateProtocol4Section('checklist',this.checked)"><span>Op website tonen</span></label></div>${p.checklist.items.map((o,i)=>`<div class="bb-proto4-row bb-proto4-check"><input value="${esc(o.text)}" oninput="updateProtocol4Checklist(${i},'text',this.value)"><label class="bb-proto4-switch"><input type="checkbox" ${o.active!==false?'checked':''} onchange="updateProtocol4Checklist(${i},'active',this.checked)"><span>Actief</span></label><button type="button" class="btn btn-light" onclick="deleteProtocol4Checklist(${i})">🗑️</button></div>`).join('')}<button type="button" class="btn btn-light" onclick="addProtocol4Checklist()">+ Controlepunt toevoegen</button></div>
    <div class="card bb-proto4-card"><div class="bb-proto4-card-head"><div><div class="card-title">Alle functies werken?</div><div class="small">Prijsaanpassing als percentage van de basisprijs.</div></div><label class="bb-proto4-switch"><input type="checkbox" ${p.functions.active!==false?'checked':''} onchange="updateProtocol4Field('functions.active',this.checked)"><span>Op website tonen</span></label></div><div class="field"><label>Vraag</label><textarea oninput="updateProtocol4Field('functions.label',this.value)">${esc(p.functions.label)}</textarea></div><div class="bb-proto4-two"><div class="field"><label>Ja: prijsaanpassing (%)</label><input type="number" step="1" value="${Number(p.functions.yesPercent||0)}" oninput="updateProtocol4Field('functions.yesPercent',this.value)"></div><div class="field"><label>Nee: prijsaanpassing (%)</label><input type="number" step="1" value="${Number(p.functions.noPercent??-30)}" oninput="updateProtocol4Field('functions.noPercent',this.value)"></div></div></div>
    <div class="card bb-proto4-card"><div class="bb-proto4-card-head"><div><div class="card-title">Batterij 85%</div><div class="small">Korting wordt als percentage van de basisprijs berekend.</div></div><label class="bb-proto4-switch"><input type="checkbox" ${p.battery.active!==false?'checked':''} onchange="updateProtocol4Field('battery.active',this.checked)"><span>Op website tonen</span></label></div><div class="field"><label>Vraag</label><input value="${esc(p.battery.label||'Is de batterijcapaciteit minimaal 85%?')}" oninput="updateProtocol4Field('battery.label',this.value)"></div><div class="field"><label>Nee: prijsaanpassing (%)</label><input type="number" step="1" value="${Number(p.battery.noPercent??-10)}" oninput="updateProtocol4Field('battery.noPercent',this.value)"></div></div>
  </div>`;
}

function renderProtocol3Settings(phone){
  const p=normalizeBuybackProtocol3(phone);phone.protocol3=p;
  const optionEditor=(section,title,addText)=>`<div class="card bb-proto3-card"><div class="bb-proto3-card-head"><div><div class="card-title">${title}</div><div class="small">Keuzes: staat = vaste prijs · overige keuzes = +/-</div></div><label class="bb-proto3-switch"><input type="checkbox" ${p[section].active!==false?'checked':''} onchange="updateProtocol3Section('${section}',this.checked)"><span>Op website tonen</span></label></div>${p[section].options.map((o,i)=>`<div class="bb-proto3-row"><input value="${esc(o.label)}" oninput="updateProtocol3Option('${section}',${i},'label',this.value)"><input type="number" step="1" value="${section==='condition'?Number(o.conditionPrice ?? o.buyPrice ?? o.priceDelta ?? 0):Number(o.priceDelta||0)}" oninput="updateProtocol3Option('${section}',${i},'${section==='condition'?'buyPrice':'priceDelta'}',this.value)" placeholder="+ / -"><label class="bb-proto3-switch"><input type="checkbox" ${o.active!==false?'checked':''} onchange="updateProtocol3Option('${section}',${i},'active',this.checked)"><span>Actief</span></label><button type="button" class="btn btn-light" onclick="deleteProtocol3Option('${section}',${i})">🗑️</button></div>`).join('')}<button type="button" class="btn btn-light" onclick="addProtocol3Option('${section}')">+ ${addText}</button></div>`;
  return `<div class="bb-protocol3-settings">
    <div class="bb-protocol3-title"><div><h4>⌚ Protocol 3 instellingen</h4><div class="small">Zelfde opbouw als de verkoopstap: verbindingsoptie, maat, staat, controlepunten, functies en batterij.</div></div><div class="bb-protocol3-badge">PROTOCOL 3</div></div>
    ${optionEditor('connectivity','Connectiviteit','Verbindingsoptie toevoegen')}
    ${optionEditor('capacity','Capaciteit / maat','Maat toevoegen')}
    ${optionEditor('condition','Staat van het toestel — vaste prijs (€)','Conditie toevoegen')}
    <div class="card bb-proto3-card"><div class="bb-proto3-card-head"><div><div class="card-title">Controlepunten</div><div class="small">Deze tekst verschijnt als toelichting bij de gekozen staat.</div></div><label class="bb-proto3-switch"><input type="checkbox" ${p.checklist.active!==false?'checked':''} onchange="updateProtocol3Section('checklist',this.checked)"><span>Op website tonen</span></label></div>${p.checklist.items.map((o,i)=>`<div class="bb-proto3-row bb-proto3-check"><input value="${esc(o.text)}" oninput="updateProtocol3Checklist(${i},'text',this.value)"><label class="bb-proto3-switch"><input type="checkbox" ${o.active!==false?'checked':''} onchange="updateProtocol3Checklist(${i},'active',this.checked)"><span>Actief</span></label><button type="button" class="btn btn-light" onclick="deleteProtocol3Checklist(${i})">🗑️</button></div>`).join('')}<button type="button" class="btn btn-light" onclick="addProtocol3Checklist()">+ Controlepunt toevoegen</button></div>
    <div class="card bb-proto3-card"><div class="bb-proto3-card-head"><div><div class="card-title">Alle functies werken?</div><div class="small">Ja/Nee kan een eigen prijsaanpassing krijgen.</div></div><label class="bb-proto3-switch"><input type="checkbox" ${p.functions.active!==false?'checked':''} onchange="updateProtocol3Field('functions.active',this.checked)"><span>Op website tonen</span></label></div><div class="field"><label>Vraag</label><textarea oninput="updateProtocol3Field('functions.label',this.value)">${esc(p.functions.label)}</textarea></div><div class="bb-proto3-two"><div class="field"><label>Ja: prijsaanpassing</label><input type="number" step="1" value="${Number(p.functions.yesDelta||0)}" oninput="updateProtocol3Field('functions.yesDelta',this.value)"></div><div class="field"><label>Nee: prijsaanpassing</label><input type="number" step="1" value="${Number(p.functions.noDelta||0)}" oninput="updateProtocol3Field('functions.noDelta',this.value)"></div></div></div>
    <div class="card bb-proto3-card"><div class="bb-proto3-card-head"><div><div class="card-title">Batterij 85%</div><div class="small">Batterijvraag met eigen prijsaanpassing.</div></div><label class="bb-proto3-switch"><input type="checkbox" ${p.battery.active!==false?'checked':''} onchange="updateProtocol3Field('battery.active',this.checked)"><span>Op website tonen</span></label></div><div class="field"><label>Vraag</label><input value="${esc(p.battery.label)}" oninput="updateProtocol3Field('battery.label',this.value)"></div><div class="bb-proto3-two"><div class="field"><label>Ja: prijsaanpassing</label><input type="number" step="1" value="${Number(p.battery.yesDelta||0)}" oninput="updateProtocol3Field('battery.yesDelta',this.value)"></div><div class="field"><label>Nee: prijsaanpassing</label><input type="number" step="1" value="${Number(p.battery.noDelta||0)}" oninput="updateProtocol3Field('battery.noDelta',this.value)"></div></div></div>
  </div>`;
}

function renderProtocol2Settings(phone){
  const p=normalizeBuybackProtocol2(phone);phone.protocol2=p;
  const optionEditor=(key,title,addText)=>`<div class="card bb-proto-card"><div class="card-title">${title}</div>${p[key].map((o,i)=>`<div class="bb-proto-row"><input value="${esc(o.label)}" oninput="updateProtocol2Option('${key}',${i},'label',this.value)"><input type="number" step="1" value="${Number(o.priceDelta||0)}" oninput="updateProtocol2Option('${key}',${i},'priceDelta',this.value)"><label><input type="checkbox" ${o.active!==false?'checked':''} onchange="updateProtocol2Option('${key}',${i},'active',this.checked)"> Actief</label><button type="button" class="btn btn-light" onclick="deleteProtocol2Option('${key}',${i})">🗑️</button></div>`).join('')}<button type="button" class="btn btn-light" onclick="addProtocol2Option('${key}')">+ ${addText}</button></div>`;
  return `<div class="bb-protocol2-settings">
    <div class="bb-protocol2-title"><div><h4>⚙️ Protocol 2 instellingen</h4><div class="small">Deze waarden worden gebruikt op Uw toestel verkopen. Prijs = basisprijs + gekozen aanpassingen.</div></div></div>
    ${optionEditor('storageOptions','Opslag / geheugen','Geheugen toevoegen')}
    ${optionEditor('conditionOptions','Staat van het toestel','Conditie toevoegen')}
    <div class="card bb-proto-card"><div class="card-title">Controlepunten — tekst per regel</div>${p.checklist.map((o,i)=>`<div class="bb-proto-row bb-proto-check"><input value="${esc(o.text)}" oninput="updateProtocol2Checklist(${i},'text',this.value)"><label><input type="checkbox" ${o.active!==false?'checked':''} onchange="updateProtocol2Checklist(${i},'active',this.checked)"> Actief</label><button type="button" class="btn btn-light" onclick="deleteProtocol2Checklist(${i})">🗑️</button></div>`).join('')}<button type="button" class="btn btn-light" onclick="addProtocol2Checklist()">+ Controlepunt toevoegen</button></div>
    <div class="card bb-proto-card"><div class="card-title">Alle functies werken?</div><div class="field"><label>Vraag</label><textarea oninput="updateProtocol2Field('functions.label',this.value)">${esc(p.functions.label)}</textarea></div><div class="bb-proto-two"><div class="field"><label>Ja: prijsaanpassing</label><input type="number" step="1" value="${Number(p.functions.yesDelta||0)}" oninput="updateProtocol2Field('functions.yesDelta',this.value)"></div><div class="field"><label>Nee: prijsaanpassing</label><input type="number" step="1" value="${Number(p.functions.noDelta||0)}" oninput="updateProtocol2Field('functions.noDelta',this.value)"></div></div><label class="buyback-check-v5"><input type="checkbox" ${p.functions.active!==false?'checked':''} onchange="updateProtocol2Field('functions.active',this.checked)"> Deze vraag tonen</label></div>
    <div class="card bb-proto-card"><div class="card-title">Batterij 85%</div><div class="field"><label>Vraag</label><input value="${esc(p.battery.label)}" oninput="updateProtocol2Field('battery.label',this.value)"></div><div class="bb-proto-two"><div class="field"><label>Ja: prijsaanpassing</label><input type="number" step="1" value="${Number(p.battery.yesDelta||0)}" oninput="updateProtocol2Field('battery.yesDelta',this.value)"></div><div class="field"><label>Nee: prijsaanpassing</label><input type="number" step="1" value="${Number(p.battery.noDelta||0)}" oninput="updateProtocol2Field('battery.noDelta',this.value)"></div></div><label class="buyback-check-v5"><input type="checkbox" ${p.battery.active!==false?'checked':''} onchange="updateProtocol2Field('battery.active',this.checked)"> Deze vraag tonen</label></div>
  </div>`;
}

function renderBuybackModelEditor(){
  const editor=document.getElementById('buybackModelEditor');
  if(!editor)return;
  const b=getBuybackBrand(), t=getBuybackType(), m=getBuybackModel();
  if(!b||!t||!m){editor.innerHTML='';return;}

  const phone=getBuybackPhoneById(m.buybackId);
  if(!phone){
    editor.innerHTML=`<div class="buyback-model-panel">
      <h3>${esc(m.name)}</h3>
      <div class="small">Dit model heeft nog geen gekoppeld inkooptoestel.</div>
      <div class="panel-actions"><button class="btn btn-green" onclick="attachBuybackModel()">Koppelen aan inkooptoestel</button><button class="btn buyback-danger" onclick="deleteBuybackModel()">Model verwijderen</button></div>
    </div>`;
    return;
  }

  editor.innerHTML=`
    <div class="buyback-model-panel">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
        <div><h3>📱 ${esc(phone.name||m.name)}</h3><div class="small">${esc(b.name)} → ${esc(m.name)}</div></div>
        <div class="actions">
          ${phone.protocol==='protocol2'||phone.protocol==='protocol3'||phone.protocol==='protocol4'||phone.protocol==='protocol5'||phone.protocol==='protocol6'||phone.protocol==='protocol8'?'':`<button class="btn btn-light" type="button" onclick="toggleBuybackTypeSettings()">⚙️ Vragen voor type</button>
          <button class="btn btn-light" type="button" onclick="toggleBuybackPhoneOptions()">📱 Modelopties</button>`}
          <button class="btn btn-red" type="button" onclick="deleteBuybackModel()">Verwijderen</button>
        </div>
      </div>
      <div class="grid" style="margin-top:15px">
        <div class="field"><label>Merk</label><input value="${esc(b.name)}" oninput="renameBuybackBrand(this.value)"></div>
        <div class="field"><label>📷 Afbeelding van merk</label><div class="buyback-photo-line-v5">${b.image?`<img src="${esc(b.image)}" alt="">`:'<div class="buyback-no-photo-v5">Geen merkafbeelding</div>'}<input type="file" accept="image/*" onchange="handleBuybackBrandImage(event)"></div></div>
        <div class="field"><label>Model</label><input value="${esc(phone.name||m.name)}" oninput="renameBuybackModel(this.value)"></div>
        <div class="field"><label>Basis inkoopprijs (€)</label><input type="number" step="1" value="${Number(phone.price||0)}" oninput="updateSelectedBuybackPhoneField('price',this.value)"></div>
        <div class="field"><label>Scrapprijs / prijs voor onderdelen (€)</label><input type="number" min="0" step="1" value="${Number(phone.scrapPrice||0)}" oninput="updateSelectedBuybackPhoneField('scrapPrice',this.value)"><div class="small">Wordt gebruikt als de klant aangeeft dat het toestel kapot is.</div></div>
        <div class="field"><label>Protocol voor dit toestel</label><select onchange="updateBuybackProtocol(this.value)"><option value="protocol1" ${phone.protocol!=='protocol2'&&phone.protocol!=='protocol3'&&phone.protocol!=='protocol4'&&phone.protocol!=='protocol5'&&phone.protocol!=='protocol6'&&phone.protocol!=='protocol8'&&phone.protocol!=='protocol7'?'selected':''}>Protocol 1 — bestaand</option><option value="protocol2" ${phone.protocol==='protocol2'?'selected':''}>Protocol 2 — nieuwe controle</option><option value="protocol3" ${phone.protocol==='protocol3'?'selected':''}>Protocol 3 — Watch / uitgebreid</option><option value="protocol4" ${phone.protocol==='protocol4'?'selected':''}>Protocol 4 — iPhone / ontgrendeld</option><option value="protocol5" ${phone.protocol==='protocol5'?'selected':''}>Protocol 5 — iPad / Wi-Fi & Cellular</option><option value="protocol6" ${phone.protocol==='protocol6'?'selected':''}>Protocol 6 — Samsung Galaxy / RAM & batterijstatus</option><option value="protocol7" ${phone.protocol==='protocol7'?'selected':''}>Protocol 7 — Samsung Tab / Wi-Fi & tablet</option><option value="protocol8" ${phone.protocol==='protocol8'?'selected':''}>Protocol 8 — MacBook Pro / uitgebreide configuratie</option></select></div>
        <div class="field"><label>Website</label><label class="buyback-check-v5"><input type="checkbox" ${phone.active!==false?'checked':''} onchange="updateSelectedBuybackPhoneField('active',this.checked);renderBuybackPhones()"> Tonen op Uw toestel verkopen</label></div>
        <div class="field buyback-photo-v5"><label>📷 Foto van toestel</label><div class="buyback-photo-line-v5">${phone.image?`<img src="${esc(phone.image)}" alt="">`:'<div class="buyback-no-photo-v5">Geen foto</div>'}<input type="file" accept="image/*" onchange="handleBuybackImageForModel(event)"></div></div>
      </div>
      ${phone.protocol==='protocol2' ? renderProtocol2Settings(phone) : (phone.protocol==='protocol3' ? renderProtocol3Settings(phone) : (phone.protocol==='protocol4' ? renderProtocol4Settings(phone) : (phone.protocol==='protocol5' ? renderProtocol5Settings(phone) : (phone.protocol==='protocol6' ? renderProtocol6Settings(phone) : (phone.protocol==='protocol8' ? renderProtocol8Settings(phone) : (phone.protocol==='protocol7' ? renderProtocol7Settings(phone) : renderBuybackTypeSettings()))))))}
      <div id="buybackOptionsArea" class="buyback-model-options" style="display:${phone.protocol==='protocol2'||phone.protocol==='protocol3'||phone.protocol==='protocol4'||phone.protocol==='protocol5'||phone.protocol==='protocol6'||phone.protocol==='protocol8'||phone.protocol==='protocol7'?'none':(buybackOptionsOpen?'block':'none')}">
        ${buybackOptionEditorForModel(phone,'Opslag','storageOptions')}
        ${buybackOptionEditorForModel(phone,'Conditie','conditionOptions')}
        ${buybackOptionEditorForModel(phone,'Batterij','batteryOptions')}
        ${buybackOptionEditorForModel(phone,'Face ID','faceIdOptions')}
        ${buybackOptionEditorForModel(phone,'Scherm','screenOptions')}
      </div>
    </div>`;
}

function buybackOptionEditorForModel(phone,title,key){
  const opts=phone[key]||[];
  return `<div class="card buyback-option-card"><div class="card-title">${title}</div><div class="small" style="margin-bottom:12px">Pas de keuze en prijsaanpassing zelf aan.</div>${opts.map((o,i)=>`<div class="buyback-option-row"><input value="${esc(o.label||'')}" oninput="updateSelectedBuybackPhoneOption('${key}',${i},'label',this.value)"><input type="number" step="1" value="${Number(o.priceDelta||0)}" oninput="updateSelectedBuybackPhoneOption('${key}',${i},'priceDelta',this.value)"><label style="display:flex;gap:6px;align-items:center;font-weight:700"><input type="checkbox" ${o.active!==false?'checked':''} onchange="updateSelectedBuybackPhoneOption('${key}',${i},'active',this.checked)"> Actief</label></div>`).join('')}</div>`;
}

function toggleBuybackTypeSettings(){
  buybackTypeSettingsOpen=!buybackTypeSettingsOpen;
  buybackQuestionOpenId="";
  renderBuybackModelEditor();
}
function toggleBuybackPhoneOptions(){
  buybackOptionsOpen=!buybackOptionsOpen;
  renderBuybackModelEditor();
}
function selectBuybackBrand(id){
  buybackSearch="";selectedBuybackBrandId=id;selectedBuybackTypeId="";selectedBuybackModelId="";buybackOptionsOpen=false;buybackAdminLevel='models';renderBuybackPhones();
}
function selectBuybackType(id){
  selectedBuybackTypeId=id;selectedBuybackModelId="";buybackOptionsOpen=false;buybackAdminLevel='models';renderBuybackPhones();
}
function selectBuybackModel(id,typeId){
  selectedBuybackModelId=id;
  selectedBuybackTypeId=typeId||selectedBuybackTypeId||((getBuybackBrand()?.types||[])[0]?.id||'');
  buybackOptionsOpen=false;
  buybackAdminLevel='editor';
  renderBuybackPhones();
}
function buybackGoBrands(){
  buybackSearch="";selectedBuybackTypeId="";selectedBuybackModelId="";buybackOptionsOpen=false;buybackAdminLevel='brands';renderBuybackPhones();
}
function buybackGoModels(){
  selectedBuybackModelId="";buybackOptionsOpen=false;buybackAdminLevel='models';renderBuybackPhones();
}

function editBuybackBrand(id){
  const b=(data.buybackCatalog||[]).find(x=>x.id===id);
  if(!b)return;
  const name=prompt('Naam van het merk:',b.name||'');
  if(name===null)return;
  const clean=name.trim();
  if(!clean)return;
  b.name=clean;
  (b.types||[]).forEach(t=>(t.models||[]).forEach(m=>{const p=getBuybackPhoneById(m.buybackId);if(p)p.brand=clean;}));
  markChanged();
  renderBuybackPhones();
}

function deleteBuybackBrand(id){
  const catalog=Array.isArray(data.buybackCatalog)?data.buybackCatalog:[];
  const b=catalog.find(x=>x.id===id);
  if(!b)return;

  const count=(b.types||[]).reduce((n,t)=>n+(t.models||[]).length,0);
  const msg='Merk "'+(b.name||'')+'" verwijderen?'+
    (count?'\n\nHiermee worden ook de '+count+' telefoon(en) van dit merk verwijderd.':'');
  if(!confirm(msg))return;

  const phoneIds=[];
  (b.types||[]).forEach(t=>{
    (t.models||[]).forEach(m=>{
      if(m && m.buybackId) phoneIds.push(String(m.buybackId));
    });
  });

  // Remove the brand from the visible catalog.
  data.buybackCatalog=catalog.filter(x=>x.id!==id);

  // Remove every phone belonging to this brand.
  // We use both the model IDs and the brand name as a safety net,
  // because older catalog records may not contain buybackId.
  const brandName=String(b.name||'').trim().toLowerCase();
  data.buybackPhones=(Array.isArray(data.buybackPhones)?data.buybackPhones:[])
    .filter(p=>{
      const pid=String(p?.id||'');
      const pbrand=String(p?.brand||'').trim().toLowerCase();
      return !phoneIds.includes(pid) && !(brandName && pbrand===brandName);
    });

  // If this was the last brand, there must be no legacy phones left.
  // Otherwise normalizeBuybackCatalog() would recreate the deleted brands
  // from the old compatibility list.
  if(!data.buybackCatalog.length){
    data.buybackPhones=[];
    buybackCatalogDeleteLock=true;
  }

  selectedBuybackBrandId='';
  selectedBuybackTypeId='';
  selectedBuybackModelId='';
  buybackOptionsOpen=false;
  buybackAdminLevel='brands';

  // Save the deletion immediately through the normal autosave mechanism.
  markChanged();
  renderBuybackPhones();
}

function editBuybackModel(modelId,typeId){
  selectedBuybackTypeId=typeId||'';
  selectedBuybackModelId=modelId||'';
  buybackOptionsOpen=false;
  buybackAdminLevel='editor';
  renderBuybackPhones();
}

function deleteBuybackModelById(modelId,typeId){
  const catalog=Array.isArray(data.buybackCatalog)?data.buybackCatalog:[];
  const b=catalog.find(x=>x.id===selectedBuybackBrandId);
  const t=b&&(b.types||[]).find(x=>x.id===typeId);
  if(!b||!t)return;

  const m=(t.models||[]).find(x=>x.id===modelId);
  if(!m)return;

  const phone=getBuybackPhoneById(m.buybackId);
  const modelName=(phone&&phone.name)||m.name||'';
  if(!confirm('Telefoon "'+modelName+'" verwijderen?'))return;

  const linkedId=m.buybackId ? String(m.buybackId) : '';

  // Remove the model from the selected type.
  t.models=(t.models||[]).filter(x=>x.id!==modelId);

  // Also remove the linked phone from the flat compatibility list.
  if(linkedId){
    data.buybackPhones=(Array.isArray(data.buybackPhones)?data.buybackPhones:[])
      .filter(p=>String(p.id)!==linkedId);
  }else{
    // Older model records can miss buybackId. Remove the matching phone
    // by model name + current brand as a compatibility fallback.
    const modelNameLower=String(m.name||'').trim().toLowerCase();
    const brandNameLower=String(b.name||'').trim().toLowerCase();
    data.buybackPhones=(Array.isArray(data.buybackPhones)?data.buybackPhones:[])
      .filter(p=>{
        const pn=String(p?.name||'').trim().toLowerCase();
        const pb=String(p?.brand||'').trim().toLowerCase();
        return !(modelNameLower && pn===modelNameLower && pb===brandNameLower);
      });
  }

  // Safety cleanup: remove any duplicate catalog references to the same phone.
  if(linkedId){
    data.buybackCatalog.forEach(brand=>{
      (brand.types||[]).forEach(type=>{
        type.models=(type.models||[]).filter(model=>String(model.buybackId||'')!==linkedId);
      });
    });
  }

  selectedBuybackModelId='';
  buybackOptionsOpen=false;
  buybackAdminLevel='models';

  markChanged();
  renderBuybackPhones();
}

function addBuybackBrand(){
  const name=prompt("Naam van het merk (bijvoorbeeld Apple of Samsung):","Nieuw merk");
  if(!name||!name.trim())return;
  const brand={id:newBuybackId("brand"),name:name.trim(),image:"",types:[]};
  data.buybackCatalog.push(brand);
  buybackCatalogDeleteLock=false;
  selectedBuybackBrandId=brand.id;selectedBuybackTypeId="";selectedBuybackModelId="";buybackAdminLevel='models';
  markChanged();renderBuybackPhones();
}

function addBuybackModel(){
  const b=getBuybackBrand();
  if(!b){alert("Kies eerst een merk.");return;}
  // Keep the internal type structure for compatibility, but do not expose it as a navigation step.
  let t=(b.types||[]).find(x=>String(x.name||'').toLowerCase()==='telefoon');
  if(!t){
    t=(b.types||[])[0];
    if(!t){
      t={id:newBuybackId("type"),name:"Telefoon",questions:defaultBuybackQuestionsForType("Telefoon"),models:[]};
      b.types.push(t);
    }
  }
  const name=prompt("Telefoon / modelnaam (bijvoorbeeld iPhone 17):","Nieuw model");
  if(!name||!name.trim())return;

  const phone={
    id:newBuybackId("buyback"),name:name.trim(),brand:b.name,image:'',price:0,active:true,protocol:'protocol1',protocol2:defaultBuybackProtocol2(),protocol3:defaultBuybackProtocol3(),protocol4:defaultBuybackProtocol4(),protocol5:defaultBuybackProtocol5(),protocol6:defaultBuybackProtocol6(),protocol7:defaultBuybackProtocol7(),protocol8:defaultBuybackProtocol8(),
    storageOptions:[{label:'128 GB',priceDelta:0,active:true},{label:'256 GB',priceDelta:30,active:true},{label:'512 GB',priceDelta:80,active:true}],
    conditionOptions:[{label:'Zo goed als nieuw',priceDelta:0,active:true},{label:'Licht gebruikt',priceDelta:-40,active:true},{label:'Zichtbaar gebruikt',priceDelta:-90,active:true},{label:'Kapot',priceDelta:-200,active:true}],
    batteryOptions:[{label:'85% of hoger',priceDelta:0,active:true},{label:'Onder 85%',priceDelta:-25,active:true}],
    faceIdOptions:[{label:'Face ID werkt',priceDelta:0,active:true},{label:'Face ID werkt niet',priceDelta:-100,active:true}],
    screenOptions:[{label:'Scherm goed',priceDelta:0,active:true},{label:'Kleine beschadigingen',priceDelta:-50,active:true},{label:'Scherm gebroken',priceDelta:-150,active:true}]
  };
  data.buybackPhones.push(phone);
  const model={id:newBuybackId("model"),name:name.trim(),buybackId:phone.id};
  t.models=t.models||[];
  t.models.push(model);
  selectedBuybackTypeId=t.id;
  selectedBuybackModelId=model.id;
  buybackAdminLevel='editor';
  markChanged();renderBuybackPhones();
}

function renameBuybackBrand(value){
  const b=getBuybackBrand();if(!b)return;
  b.name=value||"";
  (b.types||[]).forEach(t=>(t.models||[]).forEach(m=>{const p=getBuybackPhoneById(m.buybackId);if(p)p.brand=b.name;}));
  markChanged();
  renderBuybackPhones();
}
function renameBuybackType(value){
  const t=getBuybackType();if(!t)return;
  t.name=value||"";markChanged();renderBuybackPhones();
}
function renameBuybackModel(value){
  const m=getBuybackModel(),p=m&&getBuybackPhoneById(m.buybackId);if(!m||!p)return;
  m.name=value||"";p.name=value||"";markChanged();
  renderBuybackPhones();
}

function deleteBuybackModel(){
  const b=getBuybackBrand(),t=getBuybackType();
  if(!b||!t)return;
  const m=getBuybackModel();if(!m)return;
  if(!confirm("Dit model en het gekoppelde inkooptoestel verwijderen?"))return;
  const idx=t.models.findIndex(x=>x.id===m.id);
  if(idx>=0)t.models.splice(idx,1);
  const pidx=data.buybackPhones.findIndex(x=>x.id===m.buybackId);
  if(pidx>=0)data.buybackPhones.splice(pidx,1);
  selectedBuybackModelId="";
  buybackOptionsOpen=false;buybackAdminLevel='models';
  markChanged();renderBuybackPhones();
}

function attachBuybackModel(){
  const b=getBuybackBrand(),t=getBuybackType(),m=getBuybackModel();
  if(!b||!t||!m)return;
  const name=prompt("Naam van het bestaande inkooptoestel:","Nieuwe telefoon");
  if(!name||!name.trim())return;
  const phone={id:newBuybackId("buyback"),name:name.trim(),brand:b.name,image:'',price:0,active:true,protocol:'protocol1',protocol2:defaultBuybackProtocol2(),protocol3:defaultBuybackProtocol3(),protocol4:defaultBuybackProtocol4(),protocol5:defaultBuybackProtocol5(),protocol6:defaultBuybackProtocol6(),protocol7:defaultBuybackProtocol7(),protocol8:defaultBuybackProtocol8(),
    storageOptions:[{label:'128 GB',priceDelta:0,active:true},{label:'256 GB',priceDelta:30,active:true},{label:'512 GB',priceDelta:80,active:true}],
    conditionOptions:[{label:'Zo goed als nieuw',priceDelta:0,active:true},{label:'Licht gebruikt',priceDelta:-40,active:true},{label:'Zichtbaar gebruikt',priceDelta:-90,active:true},{label:'Kapot',priceDelta:-200,active:true}],
    batteryOptions:[{label:'85% of hoger',priceDelta:0,active:true},{label:'Onder 85%',priceDelta:-25,active:true}],
    faceIdOptions:[{label:'Face ID werkt',priceDelta:0,active:true},{label:'Face ID werkt niet',priceDelta:-100,active:true}],
    screenOptions:[{label:'Scherm goed',priceDelta:0,active:true},{label:'Kleine beschadigingen',priceDelta:-50,active:true},{label:'Scherm gebroken',priceDelta:-150,active:true}]};
  data.buybackPhones.push(phone);m.buybackId=phone.id;m.name=phone.name;markChanged();renderBuybackPhones();
}

function handleBuybackBrandImage(event){
  const b=getBuybackBrand();
  const file=event.target.files&&event.target.files[0];
  if(!b||!file)return;
  if(!file.type.startsWith('image/')){alert('Kies een afbeelding.');return;}
  if(file.size>2*1024*1024){alert('De afbeelding mag maximaal 2 MB zijn.');event.target.value='';return;}
  const r=new FileReader();
  r.onload=()=>{b.image=r.result;markChanged();renderBuybackPhones();};
  r.readAsDataURL(file);
}

function handleBuybackImageForModel(event){
  const m=getBuybackModel(),p=m&&getBuybackPhoneById(m.buybackId);
  const file=event.target.files&&event.target.files[0];
  if(!p||!file)return;
  if(!file.type.startsWith('image/')){alert('Kies een afbeelding.');return;}
  if(file.size>2*1024*1024){alert('De afbeelding mag maximaal 2 MB zijn.');event.target.value='';return;}
  const r=new FileReader();
  r.onload=()=>{p.image=r.result;markChanged();renderBuybackModelEditor();};
  r.readAsDataURL(file);
}

/* Compatibility helpers kept for existing data/functions. */
function addBuybackPhone(){
  if(!data.buybackCatalog.length){
    addBuybackBrand();
    return;
  }
  if(!getBuybackBrand()||!getBuybackType()){
    selectedBuybackBrandId=data.buybackCatalog[0].id;
    selectedBuybackTypeId=data.buybackCatalog[0].types[0]?.id||"";
    buybackAdminLevel='models';
  }
  if(getBuybackBrand()&&getBuybackType()) addBuybackModel();
}
function deleteBuybackPhone(i){
  const phone=data.buybackPhones[i];if(!phone)return;
  if(!confirm('Deze inkooptelefoon verwijderen?'))return;
  data.buybackPhones.splice(i,1);
  data.buybackCatalog.forEach(b=>b.types.forEach(t=>t.models=t.models.filter(m=>m.buybackId!==phone.id)));
  markChanged();renderBuybackPhones();
}
function handleBuybackImage(event,i){
  const phone=data.buybackPhones[i];if(!phone)return;
  const file=event.target.files&&event.target.files[0];if(!file)return;
  if(!file.type.startsWith('image/')){alert('Kies een afbeelding.');return;}
  if(file.size>2*1024*1024){alert('De afbeelding mag maximaal 2 MB zijn.');event.target.value='';return;}
  const r=new FileReader();r.onload=()=>{phone.image=r.result;markChanged();renderBuybackPhones();};r.readAsDataURL(file);
}

/* ---------------- REPAIR REQUESTS ---------------- */
let adminRepairOrdersCache=[];
let adminWebshopOrdersCache=[];

function orderSearchText(o){
  return [o.id,o.name,o.email,o.phone,o.imei,o.username,o.service_name,o.service_group,o.service_category,o.postcode,o.city,o.street,o.house_number].filter(Boolean).join(' ').toLowerCase();
}
function clearWebshopOrderFilters(){
  const q=document.getElementById('webshopOrderSearch'), f=document.getElementById('webshopOrderStatusFilter'), p=document.getElementById('webshopOrderPaymentFilter');
  if(q)q.value=''; if(f)f.value=''; if(p)p.value=''; renderWebshopOrders();
}
function clearPhoneOrderFilters(){
  const q=document.getElementById('phoneOrderSearch'), f=document.getElementById('phoneOrderStatusFilter'), p=document.getElementById('phoneOrderPaymentFilter');
  if(q)q.value=''; if(f)f.value=''; if(p)p.value=''; renderPhoneOrders();
}
function renderOrderSummary(id,orders,kind){
  const box=document.getElementById(id); if(!box)return;
  const total=orders.length;
  const nieuw=orders.filter(o=>(o.status||'Nieuw')==='Nieuw').length;
  const bezig=orders.filter(o=>o.status==='In behandeling').length;
  const cancelled=orders.filter(o=>o.status==='Geannuleerd').length;
  box.innerHTML=`
    <div class="order-stat stat-total"><div class="stat-icon">☷</div><div><b>${total}</b><span>Totaal orders</span></div></div>
    <div class="order-stat stat-new"><div class="stat-icon">✓</div><div><b>${nieuw}</b><span>Nieuw</span></div></div>
    <div class="order-stat stat-progress"><div class="stat-icon">◷</div><div><b>${bezig}</b><span>In behandeling</span></div></div>
    <div class="order-stat stat-cancel"><div class="stat-icon">✓</div><div><b>${cancelled}</b><span>Geannuleerd</span></div></div>`;
}

function isRepairQuoteOrder(order){let meta={};try{meta=JSON.parse(order.extra_fields||'{}')}catch{}return meta.repairQuote===true||String(order.service_category||'').trim().toLowerCase()==='reparatie';}
function clearRepairRequestFilters(){const q=document.getElementById('repairRequestSearch'),f=document.getElementById('repairRequestStatusFilter');if(q)q.value='';if(f)f.value='';renderRepairRequests();}
let expandedRepairRequestIds = new Set();
function toggleRepairRequest(id){
  const key=String(id);
  if(expandedRepairRequestIds.has(key)) expandedRepairRequestIds.delete(key);
  else expandedRepairRequestIds.add(key);
  renderRepairRequests();
}
function renderRepairRequests(){
 const box=document.getElementById('repairRequestsList');if(!box)return;
 const requests=adminRepairOrdersCache.filter(isRepairQuoteOrder);
 const q=(document.getElementById('repairRequestSearch')?.value||'').trim().toLowerCase();
 const filter=document.getElementById('repairRequestStatusFilter')?.value||'';
 const filtered=requests.filter(o=>{let m={};try{m=JSON.parse(o.extra_fields||'{}')}catch{}const text=orderSearchText(o)+' '+(m.brand||'')+' '+(m.model||'');return (!q||text.toLowerCase().includes(q))&&(!filter||o.status===filter)});
 renderOrderSummary('repairRequestSummary',requests,'repair');
 const status=document.getElementById('repairRequestsStatus');if(status){status.className='order-count';status.textContent=filtered.length+' van '+requests.length+' repair request(s) zichtbaar';}
 if(!filtered.length){box.innerHTML='<div class="order-empty">Nog geen repair requests gevonden.</div>';return;}
 box.innerHTML=filtered.map(order=>{
  let meta={};try{meta=JSON.parse(order.extra_fields||'{}')}catch{}
  const photos=Array.isArray(meta.photos)?meta.photos:[];
  const date=order.created_at?new Date(order.created_at).toLocaleString('nl-NL'):'';
  const offer=meta.offer||{};
  const rawPrice=offer.rawPrice||(offer.price?String(offer.price).replace(/[^0-9.,]/g,'').replace(',','.'):'');
  const open=expandedRepairRequestIds.has(String(order.id));
  const offerHtml='<div class="order-notes repair-request-offer"><strong>💶 Offerte aan klant</strong>'+(offer.sentAt?'<p class="repair-offer-sent">✓ Offerte verstuurd per e-mail op '+esc(new Date(offer.sentAt).toLocaleString('nl-NL'))+' · € '+esc(offer.price||'')+'</p>':(offer.updatedAt?'<p class="repair-offer-pending">⚠ Offerte geregistreerd op '+esc(new Date(offer.updatedAt).toLocaleString('nl-NL'))+' · € '+esc(offer.price||'')+' (e-mail niet verzonden)</p>':''))+'<div class="repair-offer-fields"><label>Prijs (€)<input id="repairOfferPrice-'+Number(order.id)+'" type="number" min="0" max="100000" step="0.01" value="'+esc(rawPrice)+'" placeholder="85.00"></label><label>Geschatte duur<input id="repairOfferDuration-'+Number(order.id)+'" maxlength="120" value="'+esc(offer.duration||'In overleg')+'"></label><label>Geldig<input id="repairOfferValidity-'+Number(order.id)+'" maxlength="80" value="'+esc(offer.validity||'14 dagen')+'"></label></div><label class="repair-offer-message">Bericht aan klant<textarea id="repairOfferMessage-'+Number(order.id)+'" maxlength="3000" rows="4">'+esc(offer.message||'Bedankt voor uw aanvraag. Dit is onze prijsindicatie voor de reparatie. Als u akkoord gaat, kunt u op deze e-mail reageren.')+'</textarea></label><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px"><button class="btn btn-light" type="button" onclick="setRepairQuickReply('+Number(order.id)+',\'received\')">📩 Aanvraag ontvangen</button><button class="btn btn-light" type="button" onclick="setRepairQuickReply('+Number(order.id)+',\'photos\')">📷 Extra foto gevraagd</button><button class="btn btn-light" type="button" onclick="setRepairQuickReply('+Number(order.id)+',\'question\')">❓ Extra informatie</button></div><div id="repairOfferStatus-'+Number(order.id)+'" class="repair-offer-status"></div><button class="btn btn-primary" type="button" onclick="sendRepairOffer('+Number(order.id)+')" style="margin-top:10px">✉️ Offerte opslaan & verzenden</button></div>';
  const photoHtml=photos.length?'<div class="order-notes"><strong>Foto\'s van het toestel ('+photos.length+')</strong><div class="repair-request-photos">'+photos.map((p,i)=>'<a href="'+esc(p.url||p.dataUrl||'')+'" target="_blank" rel="noopener noreferrer" title="Open foto '+(i+1)+'"><img src="'+esc(p.url||p.dataUrl||'')+'" alt="Toestelfoto '+(i+1)+'"></a>').join('')+'</div></div>':'';
  const statuses=['Nieuw','In behandeling','Wacht op klant','Wacht op leverancier','Resultaat ontvangen','Mislukt','Voltooid','Geannuleerd'];
  const options=statuses.map(s=>'<option'+((order.status||'Nieuw')===s?' selected':'')+'>'+s+'</option>').join('');
  const deleteBtn=hasPermission('orders.delete')?'<button class="btn btn-red order-delete-btn" onclick="deleteRepairRequest('+Number(order.id)+')">🗑️ Verwijderen</button>':'';
  return '<article class="order-card repair-request-card '+(open?'is-open':'')+'"><div class="repair-request-row"><button type="button" class="repair-request-toggle" aria-expanded="'+(open?'true':'false')+'" aria-controls="repair-request-details-'+Number(order.id)+'" onclick="toggleRepairRequest('+Number(order.id)+')"><span class="repair-request-chevron" aria-hidden="true">'+(open?'▾':'▸')+'</span><span class="repair-request-heading"><strong>#'+esc(order.id)+' · '+esc((meta.brand?meta.brand+' ':'')+(meta.model||order.service_name||'Reparatie'))+'</strong><span>'+esc(order.name||'Onbekende klant')+'</span><span>'+esc(date)+'</span></span></button><div class="repair-request-row-actions"><span class="repair-request-summary-status">'+esc(order.status||'Nieuw')+'</span><button type="button" class="btn btn-light order-detail-btn" onclick="showRepairRequestDetails('+Number(order.id)+')">◉ Details</button><select aria-label="Status aanvraag '+esc(order.id)+'" class="order-status-select" data-order-id="'+esc(order.id)+'" onchange="updateOrderStatus('+Number(order.id)+',this.value)">'+options+'</select>'+deleteBtn+'</div></div><div id="repair-request-details-'+Number(order.id)+'" class="repair-request-details" '+(open?'':'hidden')+'><div class="order-grid repair-request-grid"><div class="order-info"><strong>Klant</strong><span>'+esc(order.name||'-')+'</span></div><div class="order-info"><strong>E-mail</strong><span>'+esc(order.email||'-')+'</span></div><div class="order-info"><strong>Telefoon</strong><span>'+esc(order.phone||'-')+'</span></div><div class="order-info"><strong>Status</strong><span>'+esc(order.status||'Nieuw')+'</span></div><div class="order-info"><strong>Toestel / service</strong><span>'+esc((meta.brand?meta.brand+' ':'')+(meta.model||order.service_name||'-'))+'</span></div><div class="order-info"><strong>Aangemaakt</strong><span>'+esc(date||'-')+'</span></div></div><div class="order-notes"><strong>Probleem / klacht</strong><div class="repair-request-problem">'+esc(order.notes||'-')+'</div></div>'+photoHtml+offerHtml+'</div></article>';
 }).join('');
}
function setRepairQuickReply(id, kind){
  const field=document.getElementById("repairOfferMessage-"+id);
  if(!field)return;
  const replies={
   received:"Bedankt voor uw bericht. We bekijken uw reparatieaanvraag en nemen zo snel mogelijk contact met u op.",
   photos:"Kunt u ons alstublieft enkele duidelijke foto's van het toestel en de schade sturen? Dan kunnen we uw aanvraag beter beoordelen.",
   question:"Om uw reparatieaanvraag goed te kunnen beoordelen, hebben we nog wat aanvullende informatie nodig. Kunt u ons hierover meer details geven?"
  };
  if(replies[kind]){field.value=replies[kind];field.focus();}
}
async function sendRepairOffer(id){
 if(!hasPermission("orders.update"))return;
 const price=document.getElementById("repairOfferPrice-"+id),message=document.getElementById("repairOfferMessage-"+id),duration=document.getElementById("repairOfferDuration-"+id),validity=document.getElementById("repairOfferValidity-"+id),status=document.getElementById("repairOfferStatus-"+id);
 const button=status?.parentElement?.querySelector("button");
 if(!price||!message||!duration||!validity||!status)return;
 const cleanPrice=String(price.value||'').trim().replace(',','.');
 const numPrice=Number(cleanPrice);
 if(!cleanPrice||!Number.isFinite(numPrice)||numPrice<0||numPrice>100000){status.style.color="#b42318";status.textContent="Vul een geldige prijs in (0 - 100.000).";price.focus();return;}
 if(!message.value.trim()){status.style.color="#b42318";status.textContent="Vul een bericht aan de klant in.";message.focus();return;}
 if(!confirm("De offerte van € "+numPrice.toLocaleString("nl-NL",{minimumFractionDigits:2,maximumFractionDigits:2})+" opslaan en verzenden naar de klant?"))return;
 if(button)button.disabled=true;status.style.color="#52677d";status.textContent="Offerte wordt verwerkt...";
 try{
  const r=await fetch("/api/admin/repair-requests/"+encodeURIComponent(id)+"/offer",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({price:cleanPrice,message:message.value,duration:duration.value,validity:validity.value})});
  const result=await r.json().catch(()=>({}));if(!r.ok)throw new Error(result.error||"Offerte kon niet worden verwerkt.");
  const order=adminRepairOrdersCache.find(o=>Number(o.id)===Number(id));
  if(order){
   order.price=result.order?.price||numPrice.toLocaleString("nl-NL",{minimumFractionDigits:2,maximumFractionDigits:2});
   order.status=result.order?.status||"Wacht op klant";
   if(result.order?.extra_fields) order.extra_fields=result.order.extra_fields;
  }
  if(result.warning){
   status.style.color="#b54708";
   status.textContent="⚠ "+result.warning;
  }else{
   status.style.color="#137547";
   status.textContent="✓ Offerte verzonden en opgeslagen. De status is nu ‘Wacht op klant’.";
  }
  renderRepairRequests();
 }catch(e){status.style.color="#b42318";status.textContent="✕ "+e.message;}
 finally{if(button)button.disabled=false;}
}
async function loadOrders(){
  if(!hasPermission("orders.view"))return;
  const status=document.getElementById('repairRequestsStatus');
  if(!document.getElementById('repairRequestsList'))return;
  if(status){status.className='status info';status.textContent='Reparatieaanvragen laden...';}
  try{
    const r=await fetch('/api/admin/orders',{credentials:'same-origin'});
    const result=await r.json();
    if(!r.ok)throw new Error(result.error||'Reparatieaanvragen konden niet worden geladen');
    adminRepairOrdersCache=(result.orders||[]).filter(isRepairQuoteOrder);
    renderRepairRequests();
  }catch(e){
    if(status){status.className='status error';status.textContent='✕ '+e.message;}
  }
}
async function updateOrderStatus(id,statusValue){
  if(!hasPermission("orders.update"))return;
  const selects=[...document.querySelectorAll(".order-status-select")];
  const select=selects.find(el=>el.dataset.orderId===String(id));
  if(select){select.disabled=true; select.classList.add("is-saving");}
  try{
    setStatus("Opslaan van order #"+id+"...","info");
    const r=await fetch("/api/admin/orders/"+encodeURIComponent(id)+"/status",{
      method:"PUT",
      headers:{"Content-Type":"application/json"},
      credentials:"same-origin",
      body:JSON.stringify({status:statusValue})
    });
    const result=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(result.error||"Status kon niet worden gewijzigd");
    const updated=adminRepairOrdersCache.find(o=>String(o.id)===String(id));if(updated)updated.status=statusValue;renderRepairRequests();
    if(select){
      select.dataset.savedStatus=statusValue;
      select.classList.remove("is-saving");
      select.classList.add("is-saved");
      setTimeout(()=>select.classList.remove("is-saved"),900);
    }
    setStatus("✓ Order #"+id+" automatisch opgeslagen","success");
  }catch(e){
    if(select){select.classList.remove("is-saving");}
    setStatus("✕ "+e.message,"error");
    await loadOrders();
  }finally{
    if(select)select.disabled=false;
  }
}

/* ---------------- WEBSHOP ORDERS ---------------- */
function getWebshopOrderItems(order){
  const raw=order?.items;
  if(Array.isArray(raw))return raw;
  if(typeof raw==="string"){
    try{const parsed=JSON.parse(raw);return Array.isArray(parsed)?parsed:[];}catch{return [];}
  }
  return [];
}
function webshopOrderMatchesType(order,type){
  const items=getWebshopOrderItems(order);
  const isShopItem=item=>String(item?.type||"phone").trim().toLowerCase()==="shop";
  if(type==="shop")return items.length>0&&items.every(isShopItem);
  // Older phone orders can have their device data stored on the order row
  // rather than in the items JSON array. Keep those visible in the phone queue.
  if(!items.length)return !!(order?.phone_model||order?.device_model||order?.product_name||order?.product_title);
  return items.some(item=>!isShopItem(item));
}
function getPhoneOrderCatalogProduct(item){
  const catalog=Array.isArray(data?.phones)?data.phones:[];
  const productId=Number(item?.id);
  if(Number.isInteger(productId)&&productId>=0&&catalog[productId])return catalog[productId];
  const wanted=String(item?.name||item?.title||"").trim().toLocaleLowerCase();
  if(!wanted)return null;
  return catalog.find(product=>String(product?.name||"").trim().toLocaleLowerCase()===wanted)||null;
}

function normalizePhoneOrderImageSource(value){
  const source=String(value||"").trim();
  if(!source)return "";
  if(/^(data:image\/|blob:|https?:\/\/|\/\/|\/)/i.test(source))return source;
  return "/"+source.replace(/^\.\//,"");
}

function getPhoneOrderImageSources(item){
  const product=getPhoneOrderCatalogProduct(item);
  const options=item?.options&&typeof item.options==="object"?item.options:{};
  const selectedColor=String(options.color||options.colour||item?.color||item?.colour||"").trim();
  const sources=[];
  const add=value=>{
    const source=normalizePhoneOrderImageSource(value);
    if(source&&!sources.includes(source))sources.push(source);
  };
  add(item?.image||item?.image_url||item?.imageUrl||item?.product_image||item?.productImage||item?.thumbnail||item?.photo);
  if(product&&selectedColor){
    const galleries=product.colorGalleryImages&&typeof product.colorGalleryImages==="object"?product.colorGalleryImages:{};
    const galleryKey=Object.keys(galleries).find(key=>String(key).trim().toLocaleLowerCase()===selectedColor.toLocaleLowerCase());
    if(galleryKey&&Array.isArray(galleries[galleryKey]))add(galleries[galleryKey].find(Boolean));
    const colorImages=product.colorImages&&typeof product.colorImages==="object"?product.colorImages:{};
    const colorImageKey=Object.keys(colorImages).find(key=>String(key).trim().toLocaleLowerCase()===selectedColor.toLocaleLowerCase());
    if(colorImageKey)add(colorImages[colorImageKey]);
    const colorOption=Array.isArray(product.colorOptions)?product.colorOptions.find(option=>String(option?.label||"").trim().toLocaleLowerCase()===selectedColor.toLocaleLowerCase()):null;
    add(colorOption?.image);
  }
  if(product){
    add(Array.isArray(product.images)?product.images.find(Boolean):"");
    add(product.image||product.imageUrl);
  }
  return sources;
}

function handlePhoneOrderImageError(image){
  if(!image)return;
  let sources=[];
  try{sources=JSON.parse(image.dataset.fallbackSources||"[]");}catch{}
  const next=Number(image.dataset.fallbackIndex||0);
  if(next<sources.length){
    image.dataset.fallbackIndex=String(next+1);
    image.src=sources[next];
    return;
  }
  image.hidden=true;
  const fallback=image.nextElementSibling;
  if(fallback)fallback.hidden=false;
}

function formatPhoneOrderDateTime(value){
  if(!value)return {date:"—",time:""};
  const raw=String(value).trim();
  const hasTimezone=/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const normalized=/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw)&&!hasTimezone
    ?raw.replace(" ","T")+"Z"
    :raw;
  const parsed=new Date(normalized);
  if(Number.isNaN(parsed.getTime()))return {date:"—",time:""};
  const options={timeZone:"Europe/Amsterdam"};
  return {
    date:new Intl.DateTimeFormat("nl-NL",{...options,day:"2-digit",month:"2-digit",year:"numeric"}).format(parsed),
    time:new Intl.DateTimeFormat("nl-NL",{...options,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(parsed)
  };
}

function renderWebshopOrderList(type){
  const phone=type==="phone";
  const prefix=phone?"phoneOrder":"webshopOrder";
  const box=document.getElementById(phone?"phoneOrdersList":"webshopOrdersList");
  if(!box)return;

  const query=(document.getElementById(prefix+"Search")?.value||"").trim().toLowerCase();
  const statusFilter=document.getElementById(prefix+"StatusFilter")?.value||"";
  const periodFilter=phone?(document.getElementById("phoneOrderPeriodFilter")?.value||""):"";
  const paymentFilter=document.getElementById(prefix+"PaymentFilter")?.value||"";
  const orders=adminWebshopOrdersCache.filter(order=>webshopOrderMatchesType(order,type));
  const todayKey=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Amsterdam",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const todayNumber=Date.parse(todayKey+"T00:00:00Z");
  const currentMonth=todayKey.slice(0,7);
  const filtered=orders.filter(order=>{
    const payment=String(order.payment_status||"").toLowerCase();
    const paid=["paid","betaald","completed"].includes(payment);
    const failed=["failed","mislukt","cancelled","canceled","geannuleerd"].includes(payment);
    const processing=["processing","pending","in behandeling","in afwachting"].includes(payment);
    const paymentMatch=!paymentFilter||(paymentFilter==="paid"&&paid)||(paymentFilter==="unpaid"&&!paid&&!failed&&!processing)||(paymentFilter==="failed"&&failed)||(paymentFilter==="processing"&&processing);
    const created=order.created_at?new Date((/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(String(order.created_at))&&!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(order.created_at)))?String(order.created_at).replace(" ","T")+"Z":order.created_at):null;
    const createdKey=created&&!Number.isNaN(created.getTime())?new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Amsterdam",year:"numeric",month:"2-digit",day:"2-digit"}).format(created):"";
    const createdNumber=createdKey?Date.parse(createdKey+"T00:00:00Z"):NaN;
    const daysAgo=Number.isFinite(createdNumber)?Math.round((todayNumber-createdNumber)/86400000):Infinity;
    const periodMatch=!periodFilter||(periodFilter==="today"&&daysAgo===0)||(periodFilter==="7days"&&daysAgo>=0&&daysAgo<7)||(periodFilter==="30days"&&daysAgo>=0&&daysAgo<30)||(periodFilter==="month"&&createdKey.slice(0,7)===currentMonth);
    const itemText=(Array.isArray(order.items)?order.items:[]).map(item=>item.name||item.title||"").join(" ");
    return (!query||(orderSearchText(order)+" "+itemText).toLowerCase().includes(query))&&(!statusFilter||order.status===statusFilter)&&paymentMatch&&periodMatch;
  });

  renderOrderSummary(phone?"phoneOrderSummary":"webshopOrderSummary",orders,type);
  const count=document.getElementById(phone?"phoneOrdersStatus":"webshopOrdersStatus");
  const label=phone?"bestelling(en)":"shopbestelling(en)";
  if(count){count.className=phone?"ht-phone-orders-result-count":"order-count";count.textContent=filtered.length+" / "+orders.length+" "+label;}
  if(!filtered.length){
    box.innerHTML='<div class="order-empty">'+(phone?"Geen telefoonbestellingen gevonden.":"Geen onderdelen- of accessoirebestellingen gevonden.")+'</div>';
    return;
  }

  const money=value=>new Intl.NumberFormat("nl-NL",{style:"currency",currency:"EUR"}).format(Number(value||0));
  const statusPresentation=value=>{
    const map={
      "Nieuw":{icon:"🆕",className:"is-new"},
      "Geaccepteerd":{icon:"✓",className:"is-accepted"},
      "In behandeling":{icon:"⏳",className:"is-processing"},
      "Verzonden":{icon:"🚚",className:"is-shipped"},
      "Voltooid":{icon:"✅",className:"is-complete"},
      "Geannuleerd":{icon:"✕",className:"is-cancelled"}
    };
    return map[value]||{icon:"•",className:"is-unknown"};
  };

  const rows=filtered.map(order=>{
    const items=Array.isArray(order.items)?order.items:[];
    const firstItem=items[0]||{};
    const options=firstItem.options&&typeof firstItem.options==="object"?firstItem.options:{};
    const {date,time}=formatPhoneOrderDateTime(order.created_at);
    const total=money(order.total);
    const itemName=firstItem.name||firstItem.title||firstItem.product_name||"Productgegevens ontbreken";
    const storage=options.storage||firstItem.storage||firstItem.memory||"";
    const color=options.color||options.colour||firstItem.color||firstItem.colour||"";
    const condition=options.condition||firstItem.condition||"";
    const itemMeta=[storage,color,condition].filter(Boolean).join(" · ");
    const extraItems=items.length>1?" + "+(items.length-1)+" product(en)":"";
    const imageSources=phone?getPhoneOrderImageSources(firstItem):[firstItem.image||firstItem.image_url||firstItem.imageUrl||firstItem.product_image||firstItem.productImage||firstItem.thumbnail||firstItem.photo||firstItem.product?.image||""].filter(Boolean);
    const image=imageSources[0]||"";
    const statusLabel=order.status||"Nieuw";
    const status=statusPresentation(statusLabel);
    const phoneNumber=String(order.phone||"").trim();
    const phoneDigits=phoneNumber.replace(/[^+\d]/g,"");
    const customer=order.name||"Klant onbekend";
    const productCount=items.reduce((sum,item)=>sum+Math.max(0,Number(item.qty||item.quantity||1)),0);

    if(phone){
      const fallbackSources=esc(JSON.stringify(imageSources.slice(1)));
      const imageHtml=image
        ?'<span class="ht-phone-product-thumb"><img src="'+esc(image)+'" data-fallback-sources="'+fallbackSources+'" data-fallback-index="0" alt="'+esc(itemName)+'" loading="lazy" onerror="handlePhoneOrderImageError(this)"><span class="ht-phone-product-fallback" hidden>📱</span></span>'
        :'<span class="ht-phone-product-thumb"><span class="ht-phone-product-fallback">📱</span></span>';
      const payment=String(order.payment_status||"Onbekend");
      const paymentLabel=/paid|betaald|completed/i.test(payment)?"Betaald":(/pending|unpaid|open|wacht/i.test(payment)?"Openstaand":payment);
      const paymentClass=paymentLabel==="Betaald"?"is-paid":(/failed|mislukt|cancel/i.test(paymentLabel)?"is-failed":"is-pending");
      const mixed=items.some(item=>String(item?.type||"phone").toLowerCase()==="shop")&&items.some(item=>String(item?.type||"phone").toLowerCase()!=="shop");
      return '<article class="ht-phone-sale-row '+status.className+'" data-order-id="'+Number(order.id)+'">'+
        '<button type="button" class="ht-phone-sale-open" onclick="showWebshopOrderDetails('+Number(order.id)+')" aria-label="Open bestelling '+esc("#"+order.id)+'">'+
          '<span class="ht-phone-sale-number">#'+esc(order.id)+'</span>'+
          '<span class="ht-phone-sale-customer"><strong><span class="ht-phone-customer-icon">👤</span>'+esc(customer)+'</strong><small>'+(phoneNumber?'<span class="ht-whatsapp-mark">◉</span> '+esc(phoneNumber):esc(order.email||"Geen telefoonnummer"))+'</small></span>'+
          '<span class="ht-phone-sale-device">'+imageHtml+'<span class="ht-phone-product-copy"><strong>'+esc(itemName)+'</strong><small>'+esc(itemMeta||"Gegevens niet opgegeven")+esc(extraItems)+'</small></span></span>'+
          '<strong class="ht-phone-sale-price">'+esc(total)+'</strong>'+
          '<span class="ht-phone-sale-badges"><span class="ht-phone-status-chip '+status.className+'"><span aria-hidden="true">'+status.icon+'</span>'+esc(statusLabel)+'</span></span>'+
          '<span class="ht-phone-sale-date"><strong>'+esc(date)+'</strong><small>'+esc(time)+'</small></span>'+
          '<span class="ht-phone-sale-chevron" aria-hidden="true">›</span>'+
        '</button>'+
        (hasPermission("webshop_orders.delete")?'<button type="button" class="btn btn-red ht-phone-sale-delete" title="Bestelling #'+Number(order.id)+' verwijderen" aria-label="Bestelling #'+Number(order.id)+' verwijderen" onclick="deleteWebshopOrder('+Number(order.id)+')">🗑 Verwijderen</button>':"")+
        (mixed?'<div class="unified-order-mixed-note">Combinatiebestelling: telefoon en shopartikelen.</div>':"")+
      '</article>';
    }

    const imageMarkup=image?'<img class="phone-order-product-image" src="'+esc(image)+'" alt="" loading="lazy" onerror="this.style.display=\'none\'">':'<span class="phone-order-product-placeholder">📱</span>';
    const phoneContact=order.phone?'<span>☎ '+esc(order.phone)+'</span>':"";
    return '<article class="order-card webshop-order-card webshop-order-list-card"><div class="phone-order-main"><div class="phone-order-product">'+imageMarkup+'</div><div class="phone-order-info"><div class="phone-order-title-line"><button class="webshop-order-title-link" type="button" onclick="showWebshopOrderDetails('+Number(order.id)+')">'+esc(itemName)+'</button><span class="phone-order-number">#'+esc(order.id)+'</span></div><div class="phone-order-item-meta">'+esc(itemMeta||"Bestelling")+esc(extraItems)+'</div><div class="phone-order-customer"><strong>'+esc(customer)+'</strong>'+phoneContact+'</div></div><div class="phone-order-price"><strong>'+esc(total)+'</strong><small>'+items.length+' product(en)</small></div></div><div class="phone-order-footer"><div class="phone-order-state"><span class="webshop-status-pill">'+esc(statusLabel)+'</span><time>'+esc(date)+'</time></div><div class="webshop-list-actions"><button class="btn btn-light order-detail-btn" type="button" onclick="showWebshopOrderDetails('+Number(order.id)+')">Details bekijken →</button></div></div></article>';
  }).join("");

  if(phone){
    box.innerHTML='<div class="ht-phone-sale-head" role="row"><span>#</span><span>Klant</span><span>Product</span><span>Totaal</span><span>Status</span><span>Datum</span><span aria-hidden="true"></span><span>Acties</span></div>'+rows;
  }else{
    box.innerHTML=rows;
  }
}
function renderWebshopOrders(){renderWebshopOrderList("shop");}
function renderPhoneOrders(){renderWebshopOrderList("phone");}

async function orderSettingsRequest(method="GET",body){
  const options={method,credentials:"same-origin",headers:{"Content-Type":"application/json"}};
  if(body)options.body=JSON.stringify(body);
  const response=await fetch("/api/admin/order-settings",options);
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||"Instellingen konden niet worden geladen.");
  return data;
}
function orderSettingsStatus(message,error=false){
  const el=document.getElementById("orderSettingsStatus");
  if(!el)return;
  el.textContent=message;
  el.className="status "+(error?"error":"success");
}
async function loadOrderSettings(){
  try{
    orderSettingsStatus("Instellingen laden...");
    const data=await orderSettingsRequest();
    document.getElementById("orderPostnlEnabled").checked=!!data.settings?.postnlEnabled;
    document.getElementById("orderDhlEnabled").checked=!!data.settings?.dhlEnabled;
    document.getElementById("orderCashOnDeliveryEnabled").checked=!!data.settings?.cashOnDeliveryEnabled;
    updateCashOnDeliveryStatus(!!data.settings?.cashOnDeliveryEnabled);
    document.getElementById("orderPaypalEnabled").checked=!!data.paypal?.enabled;
    document.getElementById("orderPaypalMode").value=data.paypal?.mode==="live"?"live":"sandbox";
    document.getElementById("orderPaypalClientId").value=data.paypal?.clientId||"";
    document.getElementById("orderPaypalMerchantId").value=data.paypal?.merchantId||"";
    document.getElementById("orderPaypalClientSecret").value="";
    document.getElementById("orderPaypalClientSecret").placeholder=data.paypal?.configured?"Ingesteld — leeg laten om te behouden":"Vul je PayPal Client Secret in";
    document.getElementById("orderMollieApiKey").value="";
    document.getElementById("orderMollieApiKey").placeholder=data.mollie?.configured?"Ingesteld — leeg laten om te behouden":"Nog niet ingesteld";
    const mollieStatus=document.getElementById("orderMollieStatus");
    mollieStatus.className="status "+(data.mollie?.configured?"success":"info");
    mollieStatus.textContent=data.mollie?.configured?"Mollie API-key veilig opgeslagen.":"Mollie is nog niet ingesteld; iDEAL / Wero is nog niet beschikbaar.";
    const paypalStatus=document.getElementById("orderPaypalStatus");
    paypalStatus.className="status "+(data.paypal?.configured?"success":"info");
    paypalStatus.textContent=data.paypal?.configured?"PayPal API-gegevens opgeslagen. Client Secret wordt niet getoond.":"PayPal is nog niet volledig ingesteld.";
    document.getElementById("orderPostnlApiStatus").textContent=data.api?.postnl?"API-sleutel gevonden op de server":"API-sleutel ontbreekt op de server";
    document.getElementById("orderDhlApiStatus").textContent=data.api?.dhl?"API-sleutel gevonden op de server":"API-sleutel ontbreekt op de server";
    orderSettingsStatus("Instellingen geladen.");
  }catch(error){orderSettingsStatus(error.message,true);}
}
function updateCashOnDeliveryStatus(enabled){
  const status=document.getElementById("orderCashOnDeliveryStatus");
  if(!status)return;
  status.textContent=enabled?"● Ingeschakeld — zichtbaar bij afrekenen":"○ Uitgeschakeld — verborgen bij afrekenen";
  status.className="ht-cod-status "+(enabled?"is-enabled":"is-disabled");
}
async function toggleCashOnDeliverySetting(){
  const input=document.getElementById("orderCashOnDeliveryEnabled");
  const nextValue=!!input.checked;
  input.disabled=true;
  try{
    const data=await orderSettingsRequest("PUT",{
      postnlEnabled:document.getElementById("orderPostnlEnabled").checked,
      dhlEnabled:document.getElementById("orderDhlEnabled").checked,
      cashOnDeliveryEnabled:nextValue,
      paypalEnabled:document.getElementById("orderPaypalEnabled").checked,
      paypalMode:document.getElementById("orderPaypalMode").value,
      paypalClientId:document.getElementById("orderPaypalClientId").value.trim(),
      paypalClientSecret:"",
      paypalMerchantId:document.getElementById("orderPaypalMerchantId").value.trim(),
      mollieApiKey:""
    });
    input.checked=!!data.settings?.cashOnDeliveryEnabled;
    updateCashOnDeliveryStatus(input.checked);
    orderSettingsStatus(input.checked?"Betalen bij ontvangst ingeschakeld.":"Betalen bij ontvangst uitgeschakeld.");
  }catch(error){
    input.checked=!nextValue;
    updateCashOnDeliveryStatus(input.checked);
    orderSettingsStatus(error.message,true);
  }finally{input.disabled=false;}
}
async function saveOrderSettings(){
  try{
    const data=await orderSettingsRequest("PUT",{
      postnlEnabled:document.getElementById("orderPostnlEnabled").checked,
      dhlEnabled:document.getElementById("orderDhlEnabled").checked,
      cashOnDeliveryEnabled:document.getElementById("orderCashOnDeliveryEnabled").checked,
      paypalEnabled:document.getElementById("orderPaypalEnabled").checked,
      paypalMode:document.getElementById("orderPaypalMode").value,
      paypalClientId:document.getElementById("orderPaypalClientId").value.trim(),
      paypalClientSecret:document.getElementById("orderPaypalClientSecret").value,
      paypalMerchantId:document.getElementById("orderPaypalMerchantId").value.trim(),
      mollieApiKey:document.getElementById("orderMollieApiKey").value.trim()
    });
    document.getElementById("orderPostnlEnabled").checked=!!data.settings?.postnlEnabled;
    document.getElementById("orderDhlEnabled").checked=!!data.settings?.dhlEnabled;
    document.getElementById("orderCashOnDeliveryEnabled").checked=!!data.settings?.cashOnDeliveryEnabled;
    updateCashOnDeliveryStatus(!!data.settings?.cashOnDeliveryEnabled);
    document.getElementById("orderPaypalEnabled").checked=!!data.paypal?.enabled;
    document.getElementById("orderPaypalClientSecret").value="";
    document.getElementById("orderPaypalClientSecret").placeholder=data.paypal?.configured?"Ingesteld — leeg laten om te behouden":"Vul je PayPal Client Secret in";
    document.getElementById("orderMollieApiKey").value="";
    document.getElementById("orderMollieApiKey").placeholder=data.mollie?.configured?"Ingesteld — leeg laten om te behouden":"Nog niet ingesteld";
    const mollieStatus=document.getElementById("orderMollieStatus");
    mollieStatus.className="status "+(data.mollie?.configured?"success":"info");
    mollieStatus.textContent=data.mollie?.configured?"Mollie-instellingen opgeslagen.":"Mollie is nog niet ingesteld.";
    const paypalStatus=document.getElementById("orderPaypalStatus");
    paypalStatus.className="status "+(data.paypal?.configured?"success":"info");
    paypalStatus.textContent=data.paypal?.configured?"PayPal-instellingen opgeslagen. Client Secret is veilig versleuteld.":"PayPal is nog niet volledig ingesteld.";
    orderSettingsStatus("Instellingen opgeslagen.");
  }catch(error){orderSettingsStatus(error.message,true);}
}

async function loadWebshopOrders(){
  if(!hasPermission("webshop_orders.view"))return;
  const box=document.getElementById('webshopOrdersList'), status=document.getElementById('webshopOrdersStatus');
  const phoneBox=document.getElementById('phoneOrdersList');
  if(!box||!status){
    if(phoneBox)phoneBox.innerHTML='<div class="order-empty">De lijst met bestellingen kon niet worden voorbereid. Vernieuw de pagina en probeer opnieuw.</div>';
    console.error('[HOMS TECH] Webshop order list containers are missing.');
    return;
  }
  status.className='status info'; status.textContent='Webshop bestellingen laden...'; box.innerHTML='';
  if(phoneBox)phoneBox.innerHTML='<div class="order-empty">Telefoonbestellingen laden...</div>';
  try{
    const r=await fetch('/api/admin/webshop-orders',{credentials:'same-origin',cache:'no-store',headers:{'Accept':'application/json'}});
    const raw=await r.text(); let result={};
    try{result=raw?JSON.parse(raw):{};}catch{throw new Error('Server antwoord is geen JSON.');}
    if(!r.ok)throw new Error(result.error||'Webshop bestellingen konden niet worden geladen (HTTP '+r.status+').');
    adminWebshopOrdersCache=Array.isArray(result.orders)?result.orders:[];
    renderWebshopOrders(); renderPhoneOrders();
    status.className='status success'; status.textContent='✓ '+adminWebshopOrdersCache.length+' webshopbestelling(en) geladen.';
  }catch(e){
    status.className='status error'; status.textContent='✕ '+e.message;
    if(phoneBox)phoneBox.innerHTML='<div class="order-empty">Bestellingen konden niet worden geladen: '+esc(e.message)+'</div>';
    console.error('[HOMS TECH] Webshop orders load failed:',e);
  }
}

async function completeWebshopManualRefund(orderId,refundId){
  if(!hasPermission("webshop_orders.update"))return;
  const reference=window.prompt("Voer de bankreferentie of interne bevestiging van de uitgevoerde terugbetaling in:");
  if(reference===null)return;
  if(!reference.trim()){alert("Een referentie is verplicht om de terugbetaling als uitgevoerd te markeren.");return;}
  try{
    const response=await fetch("/api/admin/webshop-orders/"+encodeURIComponent(orderId)+"/refund/"+encodeURIComponent(refundId)+"/complete",{
      method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify({reference:reference.trim()})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Terugbetaling kon niet worden bevestigd.");
    await loadWebshopOrders();
    await showWebshopOrderDetails(orderId);
  }catch(error){alert(error.message);}
}
async function openWebshopRefundDialog(id,sourceSelect){
  const order=(adminWebshopOrdersCache||[]).find(item=>Number(item.id)===Number(id));
  if(!order){alert("Bestelling niet gevonden. Vernieuw de bestellingen en probeer opnieuw.");return;}
  const refunds=Array.isArray(order.refunds)?order.refunds:[];
  const alreadyReserved=refunds.filter(item=>["Processing","Pending manual","Processed"].includes(item.status)).reduce((sum,item)=>sum+Number(item.amount||0),0);
  const remaining=Math.max(0,Number(order.total||0)-alreadyReserved);
  if(remaining<=0.009){alert("Er is geen terug te betalen bedrag meer beschikbaar.");return;}
  const canMollie=String(order.payment_method||"")==="Mollie"&&!!order.mollie_payment_id;
  const overlay=document.createElement("div");
  overlay.className="ht-refund-overlay";
  overlay.style.cssText="position:fixed;inset:0;z-index:10080;background:rgba(8,20,36,.68);display:flex;align-items:center;justify-content:center;padding:18px";
  overlay.innerHTML='<section role="dialog" aria-modal="true" aria-labelledby="htRefundTitle" style="width:min(100%,520px);background:#fff;border-radius:18px;padding:22px;box-shadow:0 24px 70px rgba(0,0,0,.25);color:#172033">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h2 id="htRefundTitle" style="margin:0;font-size:20px">Bestelling #'+Number(order.id)+' annuleren</h2><button type="button" data-refund-close aria-label="Sluiten" style="border:0;background:#f1f5f9;border-radius:9px;padding:8px 11px;cursor:pointer">✕</button></div>'+
    '<p style="color:#64748b;font-size:13px;line-height:1.5">Deze bestelling is betaald. Registreer eerst het bedrag dat aan de klant wordt terugbetaald. Een handmatige terugbetaling moet daarna buiten HOMS TECH worden uitgevoerd.</p>'+
    '<label style="display:block;font-size:13px;font-weight:700;margin:14px 0 6px">Terug te betalen bedrag (€)</label><input id="htRefundAmount" type="number" min="0.01" max="'+remaining.toFixed(2)+'" step="0.01" value="'+remaining.toFixed(2)+'" style="width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font:inherit">'+
    '<label style="display:block;font-size:13px;font-weight:700;margin:14px 0 6px">Terugbetaalmethode</label><select id="htRefundMethod" style="width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font:inherit">'+
    (canMollie?'<option value="Mollie">Automatisch via Mollie</option>':'')+'<option value="Manual" '+(!canMollie?'selected':'')+'>Handmatig (bankoverschrijving / buiten betaalprovider)</option></select>'+
    '<label style="display:block;font-size:13px;font-weight:700;margin:14px 0 6px">Reden van annulering</label><textarea id="htRefundReason" rows="3" maxlength="500" placeholder="Bijvoorbeeld: klant heeft de bestelling geannuleerd..." style="width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font:inherit;resize:vertical"></textarea>'+
    '<div id="htRefundFeedback" style="min-height:20px;margin-top:10px;font-size:13px;color:#b45309"></div>'+
    '<div style="display:flex;justify-content:flex-end;gap:9px;margin-top:12px;flex-wrap:wrap"><button type="button" data-refund-close class="btn btn-light">Terug</button><button type="button" id="htRefundConfirm" class="btn btn-primary">Terugbetaling registreren en annuleren</button></div></section>';
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  overlay.querySelectorAll("[data-refund-close]").forEach(button=>button.addEventListener("click",close));
  overlay.addEventListener("click",event=>{if(event.target===overlay)close();});
  overlay.querySelector("#htRefundConfirm").addEventListener("click",async()=>{
    const button=overlay.querySelector("#htRefundConfirm");
    const feedback=overlay.querySelector("#htRefundFeedback");
    const amount=Number(overlay.querySelector("#htRefundAmount").value);
    const method=overlay.querySelector("#htRefundMethod").value;
    const reason=overlay.querySelector("#htRefundReason").value.trim();
    if(!Number.isFinite(amount)||amount<=0||amount>remaining+0.009){feedback.textContent="Vul een bedrag in tot maximaal € "+remaining.toFixed(2)+".";return;}
    if(!reason){feedback.textContent="Vul de reden van annulering in.";return;}
    button.disabled=true;button.textContent="Bezig met verwerken...";feedback.textContent="";
    try{
      const refundResponse=await fetch("/api/admin/webshop-orders/"+encodeURIComponent(id)+"/refund",{
        method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify({amount,method,reason})
      });
      const refundResult=await refundResponse.json().catch(()=>({}));
      if(!refundResponse.ok)throw new Error(refundResult.error||"Terugbetaling kon niet worden geregistreerd.");
      const statusResponse=await fetch("/api/admin/webshop-orders/"+encodeURIComponent(id)+"/status",{
        method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify({status:"Geannuleerd"})
      });
      const statusResult=await statusResponse.json().catch(()=>({}));
      if(!statusResponse.ok)throw new Error(statusResult.error||"Terugbetaling geregistreerd, maar annuleren is niet gelukt. Controleer de bestelling.");
      close();
      await loadWebshopOrders();
      await showWebshopOrderDetails(id);
      alert(method==="Mollie"?"Mollie heeft de terugbetaling geaccepteerd en de bestelling is geannuleerd.":"De bestelling is geannuleerd. De terugbetaling staat op 'handmatig uit te voeren'; maak het bedrag buiten HOMS TECH over en bevestig dit daarna.");
    }catch(error){feedback.textContent=error.message;button.disabled=false;button.textContent="Opnieuw proberen";}
  });
}
async function updateWebshopOrderStatus(id,statusValue,sourceSelect){
  if(!hasPermission("webshop_orders.update"))return;
  const selectedOrder=(adminWebshopOrdersCache||[]).find(item=>Number(item.id)===Number(id));
  if(statusValue==="Geannuleerd"&&String(selectedOrder?.payment_status||"") === "Paid"){
    if(sourceSelect)sourceSelect.value=sourceSelect.dataset.savedStatus||selectedOrder.status||"In behandeling";
    return openWebshopRefundDialog(id,sourceSelect);
  }
  const selects=[...document.querySelectorAll(".order-status-select")];
  const select=sourceSelect||selects.find(el=>el.dataset.webshopOrderId===String(id));
  if(select){select.disabled=true; select.classList.add("is-saving");}
  try{
    setStatus("Opslaan van webshop order #"+id+"...","info");
    const r=await fetch("/api/admin/webshop-orders/"+encodeURIComponent(id)+"/status",{
      method:"PUT",
      headers:{"Content-Type":"application/json","Accept":"application/json"},
      credentials:"same-origin",
      body:JSON.stringify({status:statusValue})
    });
    const raw=await r.text();
    let result={};
    try{result=raw?JSON.parse(raw):{};}catch{throw new Error("Server antwoord is geen JSON.");}
    if(!r.ok) throw new Error(result.error||"Status kon niet worden gewijzigd");
    if(select){
      select.dataset.savedStatus=statusValue;
      select.classList.remove("is-saving");
      select.classList.add("is-saved");
      setTimeout(()=>select.classList.remove("is-saved"),900);
    }
    const activePhoneDetail=document.getElementById("orderDetailsModal");
    const phoneDetailIsOpen=!!(activePhoneDetail&&(document.querySelector("#page-phone-orders .ht-phone-orders-workspace.has-selection")||activePhoneDetail.classList.contains("ht-phone-mobile-detail")));
    if(phoneDetailIsOpen){
      await loadWebshopOrders();
      await showWebshopOrderDetails(id);
    }
    setStatus("✓ Webshop order #"+id+" automatisch opgeslagen","success");
  }catch(e){
    if(select){select.classList.remove("is-saving");}
    setStatus("✕ "+e.message,"error");
    await loadWebshopOrders();
  }finally{
    if(select)select.disabled=false;
  }
}

/* ---------------- CUSTOMERS ---------------- */
function hideCustomerPanels(){
  ["customerCreatePanel","customerEditPanel","customerPasswordPanel"].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display="none";});
}
function openCustomerModal(panelId){
  hideCustomerPanels();
  const panel=document.getElementById(panelId);
  if(panel)panel.style.display="block";
  document.getElementById("customerModalBackdrop").classList.add("show");
  document.body.style.overflow="hidden";
}
function closeCustomerModal(){
  document.getElementById("customerModalBackdrop").classList.remove("show");
  hideCustomerPanels();
  document.body.style.overflow="";
}
function showCustomerCreateForm(){
  if(!hasPermission("customers.update"))return;
  ["newCustomerFirstName","newCustomerLastName","newCustomerEmail","newCustomerPostcode","newCustomerHouseNumber","newCustomerStreet","newCustomerCity","newCustomerPhone","newCustomerPassword"].forEach(id=>{document.getElementById(id).value="";});
  openCustomerModal("customerCreatePanel");
  document.getElementById("newCustomerName").focus();
}
function hideCustomerCreateForm(){closeCustomerModal();}
function hideCustomerEditForm(){closeCustomerModal();}
function hideCustomerPasswordForm(){closeCustomerModal();}
async function customerApi(url,method,body){
  const r=await fetch(url,{method,credentials:"same-origin",headers:{"Content-Type":"application/json","Accept":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(result.error||"Actie mislukt.");
  return result;
}
function buildCustomerAddress(prefix){
  const street=document.getElementById(prefix+"Street").value.trim();
  const house=document.getElementById(prefix+"HouseNumber").value.trim();
  const postcode=document.getElementById(prefix+"Postcode").value.trim().toUpperCase();
  const city=document.getElementById(prefix+"City").value.trim();
  const line1=[street,house].filter(Boolean).join(" ");
  return [line1,[postcode,city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}
function splitCustomerAddress(address){
  const result={street:"",houseNumber:"",postcode:"",city:""};
  const parts=String(address||"").split(",").map(x=>x.trim()).filter(Boolean);
  if(parts.length){
    const first=parts[0];
    const match=first.match(/^(.*?)[,\s]+(\d+[A-Za-z]?(?:[-\s]\w+)?)$/);
    if(match){result.street=match[1].trim();result.houseNumber=match[2].trim();}
    else result.street=first;
  }
  if(parts.length>1){
    const rest=parts.slice(1).join(" ");
    const m=rest.match(/\b(\d{4}\s?[A-Za-z]{2})\b\s*(.*)$/);
    if(m){result.postcode=m[1].replace(/\s/g,"").toUpperCase();result.city=m[2].trim();}
    else result.city=rest;
  }
  return result;
}
function splitCustomerName(name){
  const parts=String(name||"").trim().split(/\s+/).filter(Boolean);
  return {firstName:parts.shift()||"",lastName:parts.join(" ")};
}
async function createCustomer(){
  if(!hasPermission("customers.update"))return;
  const firstName=document.getElementById("newCustomerFirstName").value.trim();
  const lastName=document.getElementById("newCustomerLastName").value.trim();
  const email=document.getElementById("newCustomerEmail").value.trim();
  const password=document.getElementById("newCustomerPassword").value;
  if(!firstName||!lastName||!email||!password){setStatus("✕ Vul voornaam, achternaam, e-mail en wachtwoord in.","error");return;}
  if(password.length<8){setStatus("✕ Het wachtwoord moet minimaal 8 tekens bevatten.","error");return;}
  const body={name:[firstName,lastName].filter(Boolean).join(" "),email,phone:document.getElementById("newCustomerPhone").value.trim(),address:buildCustomerAddress("newCustomer"),password};
  try{await customerApi("/api/admin/customers","POST",body);document.getElementById("customerCreatePanel").querySelectorAll("input").forEach(x=>x.value="");closeCustomerModal();await loadCustomers();setStatus("✓ Klantaccount aangemaakt","success");}
  catch(e){setStatus("✕ "+e.message,"error");}
}
function editCustomer(id){
  const customer=(window.adminCustomersCache||[]).find(x=>Number(x.id)===Number(id));if(!customer)return;
  openCustomerModal("customerEditPanel");
  document.getElementById("editCustomerId").value=customer.id;
  const name=splitCustomerName(customer.name);
  document.getElementById("editCustomerFirstName").value=name.firstName;
  document.getElementById("editCustomerLastName").value=name.lastName;
  document.getElementById("editCustomerEmail").value=customer.email||"";
  document.getElementById("editCustomerPhone").value=customer.phone||"";
  const address=splitCustomerAddress(customer.address);
  document.getElementById("editCustomerStreet").value=address.street;
  document.getElementById("editCustomerHouseNumber").value=address.houseNumber;
  document.getElementById("editCustomerPostcode").value=address.postcode;
  document.getElementById("editCustomerCity").value=address.city;
  document.getElementById("customerEditTitle").textContent="Gegevens van "+(customer.name||"klant");
}
async function saveCustomerEdit(){
  if(!hasPermission("customers.update"))return;
  const id=document.getElementById("editCustomerId").value;
  const firstName=document.getElementById("editCustomerFirstName").value.trim();
  const lastName=document.getElementById("editCustomerLastName").value.trim();
  const email=document.getElementById("editCustomerEmail").value.trim();
  if(!firstName||!lastName||!email){setStatus("✕ Vul voornaam, achternaam en e-mail in.","error");return;}
  const body={name:[firstName,lastName].filter(Boolean).join(" "),email,phone:document.getElementById("editCustomerPhone").value.trim(),address:buildCustomerAddress("editCustomer")};
  try{await customerApi("/api/admin/customers/"+encodeURIComponent(id),"PUT",body);closeCustomerModal();await loadCustomers();setStatus("✓ Klantgegevens opgeslagen","success");}
  catch(e){setStatus("✕ "+e.message,"error");}
}
function editCustomerPassword(id){
  if(!hasPermission("customers.update"))return;
  document.getElementById("passwordCustomerId").value=id;document.getElementById("adminCustomerPassword").value="";const customer=(window.adminCustomersCache||[]).find(x=>Number(x.id)===Number(id));document.getElementById("customerPasswordTitle").textContent="Wachtwoord wijzigen"+(customer?" voor "+customer.name:"");openCustomerModal("customerPasswordPanel");
}
async function saveCustomerPassword(){
  if(!hasPermission("customers.update"))return;
  const id=document.getElementById("passwordCustomerId").value,password=document.getElementById("adminCustomerPassword").value;
  try{await customerApi("/api/admin/customers/"+encodeURIComponent(id)+"/password","PUT",{password});hideCustomerPasswordForm();await loadCustomers();setStatus("✓ Wachtwoord gewijzigd","success");}
  catch(e){setStatus("✕ "+e.message,"error");}
}
async function deleteCustomer(id){
  if(!hasPermission("customers.delete"))return;
  const customer=(window.adminCustomersCache||[]).find(x=>Number(x.id)===Number(id));
  if(!confirm("Weet je zeker dat je het account van "+(customer?.name||"deze klant")+" wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt."))return;
  try{await customerApi("/api/admin/customers/"+encodeURIComponent(id),"DELETE");await loadCustomers();setStatus("✓ Klantaccount verwijderd","success");}
  catch(e){setStatus("✕ "+e.message,"error");}
}
async function loadCustomers(){
  if(!hasPermission("customers.view"))return;
  const box=document.getElementById("customersList");
  const status=document.getElementById("customersStatus");
  if(!box) return;

  status.className="status info";
  status.textContent="Klanten laden...";
  box.innerHTML="";

  try{
    const r=await fetch("/api/admin/customers");
    const result=await r.json();
    if(!r.ok) throw new Error(result.error || "Kan klanten niet laden");

    const customers=result.customers || [];
    window.adminCustomersCache=customers;
    status.className="status success";
    status.textContent=customers.length+" klant(en) gevonden";

    if(!customers.length){
      box.innerHTML='<div class="small">Nog geen geregistreerde klanten.</div>';
      return;
    }

    box.innerHTML=customers.map(customer=>`
      <div class="card customer-card" role="button" tabindex="0" aria-label="Gegevens bekijken van ${esc(customer.name || "Klant")}" onclick="editCustomer(${Number(customer.id)})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();editCustomer(${Number(customer.id)});}">
        <div class="card-head">
          <div class="card-title">👤 ${esc(customer.name || "Klant")}</div>
          <div class="small">${esc(customer.created_at || "")}</div>
        </div>
        <div class="grid">
          <div><strong>E-mail</strong><br>${esc(customer.email || "-")}</div>
          <div><strong>Telefoon</strong><br>${esc(customer.phone || "-")}</div>
          <div style="grid-column:1/-1"><strong>Adres</strong><br>${esc(customer.address || "-")}</div>
        </div>
        <div class="customer-card-hint">Klik om alle gegevens te bekijken en aan te passen →</div>
      </div>`).join("");
  }catch(e){
    status.className="status error";
    status.textContent="✕ "+e.message;
  }
}

/* ---------------- WHY ---------------- */

function renderWhy(){
  const box=document.getElementById("whyList");
  if(!box) return;
  if(!data.why.length){
    box.innerHTML=`<div class="editor-layout"><div class="editor-list"><div class="editor-list-title">Voordelen</div><div class="small" style="padding:10px">Nog geen voordelen toegevoegd.</div></div><div class="editor-panel editor-empty">Nog geen voordeel toegevoegd.</div></div>`;
    return;
  }
  if(selectedWhyIndex>=data.why.length) selectedWhyIndex=data.why.length-1;
  const item=data.why[selectedWhyIndex];
  const list=data.why.map((x,i)=>`<button type="button" class="editor-list-item ${i===selectedWhyIndex?'active':''}" onclick="selectedWhyIndex=${i};renderWhy()">${esc(x[0]||'⭐')} ${esc(x[1]||'Nieuw voordeel')}<small>${esc(x[2]||'')}</small></button>`).join('');
  box.innerHTML=`
    <div class="editor-layout">
      <div class="editor-list"><div class="editor-list-title">Waarom HOMS TECH</div>${list}</div>
      <div class="editor-panel">
        <div class="card-head"><div><div class="card-title" style="font-size:20px">⭐ ${esc(item[1]||'Nieuw voordeel')}</div><div class="small">Bewerk hier het voordeel.</div></div><button class="btn btn-red" onclick="deleteWhy(${selectedWhyIndex})">Verwijderen</button></div>
        <div class="grid">
          <div class="field"><label>Icoon / emoji</label><input value="${esc(item[0]||'⭐')}" oninput="data.why[${selectedWhyIndex}][0]=this.value;markChanged()"></div>
          <div class="field"><label>Titel</label><input value="${esc(item[1]||'')}" oninput="data.why[${selectedWhyIndex}][1]=this.value;markChanged();renderWhy()"></div>
          <div class="field" style="grid-column:1/-1"><label>Beschrijving</label><textarea oninput="data.why[${selectedWhyIndex}][2]=this.value;markChanged()">${esc(item[2]||'')}</textarea></div>
        </div>
      </div>
    </div>`;
}

function addWhy(){
  data.why.push(["⭐","Nieuw voordeel",""]);
  selectedWhyIndex=data.why.length-1;
  renderWhy();
  markChanged();
}

function deleteWhy(i){
  if(confirm("Dit voordeel verwijderen?")){
    data.why.splice(i,1);
    selectedWhyIndex=Math.max(0,Math.min(selectedWhyIndex,data.why.length-1));
    renderWhy();
    markChanged();
  }
}

/* ---------------- SHOP PRODUCTS ---------------- */
let shopImageUploadsPending=0;
let shopCatalogOriginalSnapshot=[];

const SHOP_CATEGORIES=[
 {value:"Schermen",label:"Schermen"},{value:"Laadpoorten & Flexkabels",label:"Laadpoorten & Flexkabels"},
 {value:"Batterijen",label:"Batterijen"},{value:"Reparatiemachines & Gereedschap",label:"Reparatiemachines & Gereedschap"},
 {value:"Overige Onderdelen",label:"Overige Onderdelen"},{value:"Accessoires",label:"Accessoires"}
];
function nextShopSku(category){
 const codes={"Schermen":"SCH","Laadpoorten & Flexkabels":"FLEX","Batterijen":"BAT","Reparatiemachines & Gereedschap":"MAC","Overige Onderdelen":"PART","Accessoires":"ACC"};
 let max=100000;
 (Array.isArray(data.shopProducts)?data.shopProducts:[]).forEach(p=>(Array.isArray(p.variants)?p.variants:[]).forEach(v=>{const m=String(v.sku||"").match(/-(\d+)$/);if(m)max=Math.max(max,Number(m[1])||0)}));
 return "HT-"+(codes[category]||"PART")+"-"+String(max+1).padStart(6,"0");
}
function validateShopCatalogIdentifiers(products){
 const productIds=new Set(),variantIds=new Set(),skus=new Map();
 for(let i=0;i<products.length;i++){
  const product=products[i]||{},productId=String(product.id??"").trim();
  if(!productId)return {error:"Product "+(i+1)+" heeft geen unieke product-ID."};
  if(productIds.has(productId))return {error:"Dubbele product-ID gevonden bij product "+(i+1)+". Vernieuw de pagina en probeer opnieuw."};
  productIds.add(productId);
  const variants=Array.isArray(product.variants)?product.variants:[];
  const qualities=new Set();
  for(let j=0;j<variants.length;j++){
   const variant=variants[j]||{},variantId=String(variant.id??"").trim();
   if(!variantId)return {error:"Product "+(i+1)+", optie "+(j+1)+" heeft geen optie-ID."};
   if(variantIds.has(variantId))return {error:"Dubbele optie-ID gevonden bij "+(product.name||"product "+(i+1))+"."};
   variantIds.add(variantId);
   const sku=String(variant.sku??"").trim(),skuKey=sku.toUpperCase();
   if(!sku)return {error:"Vul een SKU in bij "+(product.name||"product "+(i+1))+" — "+(variant.quality||"optie "+(j+1))+"."};
   if(skus.has(skuKey))return {error:"Dubbele SKU "+sku+" gevonden bij "+(product.name||"product "+(i+1))+" en "+skus.get(skuKey)+". Elke optie moet een eigen SKU hebben."};
   skus.set(skuKey,product.name||"product "+(i+1));
   const quality=String(variant.quality??"").trim().toLocaleLowerCase();
   if(quality&&qualities.has(quality))return {error:"De kwaliteitsnaam "+variant.quality+" komt dubbel voor bij "+(product.name||"product "+(i+1))+"."};
   if(quality)qualities.add(quality);
  }
 }
 return {valid:true};
}

let shopPageEnabled = true;
let shopPageEnabledDraft = true;
async function loadShopVisibility(){
 const status=document.getElementById("shopVisibilityStatus");
 if(!status)return;
 const toggle=document.getElementById("shopVisibilitySwitch");
 const save=document.getElementById("shopVisibilitySave");
 if(toggle)toggle.disabled=true;
 if(save)save.disabled=true;
 status.textContent="Status laden...";
 try{
  const response=await fetch("/api/admin/shop-visibility",{credentials:"same-origin",cache:"no-store"});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error||"Shopstatus laden is mislukt.");
  shopPageEnabled=result.enabled!==false;
  shopPageEnabledDraft=shopPageEnabled;
  renderShopVisibility();
 }catch(error){
  status.textContent=error.message;
  status.style.color="#b91c1c";
 }
}
function renderShopVisibility(){
 const status=document.getElementById("shopVisibilityStatus");
 const toggle=document.getElementById("shopVisibilitySwitch");
 const knob=document.getElementById("shopVisibilityKnob");
 const label=document.getElementById("shopVisibilityLabel");
 const save=document.getElementById("shopVisibilitySave");
 if(!status||!toggle||!knob||!label||!save)return;
 const enabled=shopPageEnabledDraft;
 toggle.setAttribute("aria-checked",String(enabled));
 toggle.style.background=enabled?"#16a34a":"#94a3b8";
 toggle.style.justifyContent=enabled?"flex-end":"flex-start";
 knob.style.transform="translateX(0)";
 label.textContent=enabled?"AAN":"UIT";
 label.style.color=enabled?"#15803d":"#64748b";
 status.textContent=enabled
  ?"De Shop-pagina staat AAN en is zichtbaar voor bezoekers."
  :"De Shop-pagina staat UIT en wordt verborgen voor bezoekers.";
 status.style.color=enabled?"#15803d":"#b45309";
 save.disabled=enabled===shopPageEnabled;
 save.textContent=enabled===shopPageEnabled?"Geen wijzigingen":"Wijziging opslaan";
 toggle.disabled=false;
}
function toggleShopVisibilityDraft(){
 shopPageEnabledDraft=!shopPageEnabledDraft;
 renderShopVisibility();
}
async function saveShopVisibility(){
 const save=document.getElementById("shopVisibilitySave");
 if(!save||shopPageEnabledDraft===shopPageEnabled)return;
 save.disabled=true;save.textContent="Opslaan...";
 try{
  const response=await fetch("/api/admin/shop-visibility",{
   method:"PUT",credentials:"same-origin",
   headers:{"Content-Type":"application/json"},
   body:JSON.stringify({enabled:shopPageEnabledDraft})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error||"Shopinstelling opslaan is mislukt.");
  shopPageEnabled=result.enabled!==false;
  shopPageEnabledDraft=shopPageEnabled;
  renderShopVisibility();
  if(typeof setStatus==="function")setStatus(shopPageEnabled?"✓ Shop-pagina staat aan en is zichtbaar":"✓ Shop-pagina staat uit en is verborgen","success");
 }catch(error){
  renderShopVisibility();
  save.disabled=false;save.textContent="Opnieuw proberen";
  if(typeof setStatus==="function")setStatus("✕ "+error.message,"error");
  else alert(error.message);
 }
}

function ensureShopProducts(){
 if(!Array.isArray(data.shopProducts))data.shopProducts=[];
 data.shopProducts.forEach((p,i)=>{
  if(!p||typeof p!=="object")data.shopProducts[i]={};p=data.shopProducts[i];
  if(!p.id)p.id="shop-"+Date.now()+"-"+i;
  if(!Array.isArray(p.images))p.images=["","","",""];while(p.images.length<4)p.images.push("");p.images=p.images.slice(0,4);
  if(typeof p.active!=="boolean")p.active=true;if(typeof p.videoEnabled!=="boolean")p.videoEnabled=!!p.videoUrl;
  if(!SHOP_CATEGORIES.some(c=>c.value===p.category))p.category=p.category||"Accessoires";
  if(!Array.isArray(p.variants)||!p.variants.length){
   const legacyStock=(String(p.stock??"").match(/\d+/)||[""])[0];
   p.variants=[{id:"var-"+Date.now()+"-"+i,quality:"Standaard",sku:nextShopSku(p.category),price:String(p.price??""),stock:String(legacyStock),active:true}];
  }
  p.variants.forEach(v=>{if(!v.id)v.id="var-"+Date.now()+"-"+Math.random().toString(36).slice(2,8);if(!v.sku)v.sku=nextShopSku(p.category);if(v.quality==null)v.quality="Standaard";if(v.price==null)v.price="";if(v.stock==null)v.stock="0";if(typeof v.active!=="boolean")v.active=true;});
  p.price=p.variants[0].price;p.stock=String(p.variants[0].stock??"")+" stuks";
 });
}
function addShopProduct(){
 ensureShopProducts();const category="Accessoires";
 data.shopProducts.unshift({id:"shop-"+Date.now()+"-"+Math.random().toString(36).slice(2,8),name:"",description:"",category,brand:"",deviceModel:"",price:"",stock:"0 stuks",images:["","","",""],videoEnabled:false,videoUrl:"",active:true,variants:[{id:"var-"+Date.now()+"-"+Math.random().toString(36).slice(2,8),quality:"Standaard",sku:nextShopSku(category),price:"",stock:"0",active:true}]});
 renderShopProductsAdmin();markChanged();
}
function deleteShopProduct(index){if(!confirm("Dit Shop-product verwijderen?"))return;data.shopProducts.splice(index,1);renderShopProductsAdmin();markChanged();}
function updateShopProduct(index,key,value){ensureShopProducts();if(!data.shopProducts[index])return;data.shopProducts[index][key]=value;if(key==="category")data.shopProducts[index].variants.forEach(v=>{if(!v.sku||v.sku==="")v.sku=nextShopSku(value)});markChanged();}
function addShopVariant(index){ensureShopProducts();const p=data.shopProducts[index];if(!p)return;p.variants.push({id:"var-"+Date.now()+"-"+Math.random().toString(36).slice(2,7),quality:"Nieuwe kwaliteit",sku:nextShopSku(p.category),price:"",stock:"0",active:true});renderShopProductsAdmin();markChanged();}
function updateShopVariant(index,variantIndex,key,value){ensureShopProducts();const p=data.shopProducts[index],v=p&&p.variants[variantIndex];if(!v||!["quality","sku","price","stock","active"].includes(key))return;v[key]=value;if(variantIndex===0){p.price=v.price;p.stock=String(v.stock??"")+" stuks";}markChanged();}
function deleteShopVariant(index,variantIndex){ensureShopProducts();const p=data.shopProducts[index];if(!p||p.variants.length<2){alert("Een product moet minimaal één optie hebben.");return;}p.variants.splice(variantIndex,1);p.price=p.variants[0].price;p.stock=String(p.variants[0].stock??"")+" stuks";renderShopProductsAdmin();markChanged();}
function shopProductImageUpload(event,index,slot){
 const input=event.target,file=input.files&&input.files[0];if(!file)return;
 if(!["image/png","image/jpeg","image/webp","image/gif"].includes(String(file.type||"").toLowerCase())){alert("Gebruik een PNG-, JPG-, WebP- of GIF-afbeelding.");input.value="";return;}
 if(file.size>1.2*1024*1024){alert("Elke foto mag maximaal 1,2 MB zijn. Verklein de foto en probeer opnieuw.");input.value="";return;}
 ensureShopProducts();
 const product=data.shopProducts[index];if(!product){input.value="";return;}
 const productId=String(product.id),reader=new FileReader();
 let completed=false;
 const finish=()=>{if(completed)return;completed=true;shopImageUploadsPending=Math.max(0,shopImageUploadsPending-1);};
 shopImageUploadsPending++;
 reader.onload=()=>{
  finish();
  const currentIndex=data.shopProducts.findIndex(item=>String(item?.id)===productId);
  if(currentIndex<0){setStatus("De foto is niet toegevoegd: het product is intussen verwijderd.","error");return;}
  const current=data.shopProducts[currentIndex];
  if(!Array.isArray(current.images))current.images=["","","",""];
  while(current.images.length<4)current.images.push("");
  if(!Number.isInteger(slot)||slot<0||slot>3)return;
  current.images[slot]=String(reader.result||"");
  renderShopProductsAdmin();markChanged();
 };
 reader.onerror=()=>{finish();alert("De foto kon niet worden gelezen. Probeer een andere afbeelding.");input.value="";};
 try{reader.readAsDataURL(file);}catch(error){finish();alert("De foto kon niet worden gelezen. Probeer opnieuw.");input.value="";}
}
function renderShopProductsAdmin(){
 const box=document.getElementById("shopProductsAdmin");if(!box)return;ensureShopProducts();
 if(!data.shopProducts.length){box.innerHTML='<div class="card"><strong>Nog geen Shop-producten</strong><p class="small">Voeg een onderdeel, accessoire of machine toe.</p></div>';return;}
 box.innerHTML=data.shopProducts.map((p,i)=>{
  const field=(label,key,placeholder,type)=>'<label style="display:block;font-weight:700;font-size:13px;margin-bottom:10px">'+label+'<input type="'+(type||"text")+'" value="'+esc(p[key]??"")+'" placeholder="'+esc(placeholder)+'" oninput="updateShopProduct('+i+',\''+key+'\',this.value)" style="display:block;width:100%;margin-top:5px;padding:11px;border:1px solid #d8e0e9;border-radius:9px"></label>';
  const categoryOptions=SHOP_CATEGORIES.map(c=>'<option value="'+esc(c.value)+'" '+(p.category===c.value?'selected':'')+'>'+esc(c.label)+'</option>').join("");
  const photos=p.images.map((src,j)=>'<div style="border:1px solid #e2e8f0;border-radius:10px;padding:9px;min-width:0"><div style="height:100px;display:grid;place-items:center;background:#f8fafc;border-radius:7px;overflow:hidden;margin-bottom:8px">'+(src?'<img src="'+src+'" alt="Productfoto '+(j+1)+'" style="width:100%;height:100%;object-fit:contain">':'<span class="small">Foto '+(j+1)+'</span>')+'</div><input type="file" accept="image/*" aria-label="Foto '+(j+1)+' uploaden" onchange="shopProductImageUpload(event,'+i+','+j+')" style="width:100%;font-size:12px">'+(src?'<button class="btn btn-light" type="button" style="margin-top:6px" onclick="data.shopProducts['+i+'].images['+j+']=\'\';renderShopProductsAdmin();markChanged()">Foto wissen</button>':'')+'</div>').join("");
  const variants=p.variants.map((v,j)=>'<div style="border:1px solid #dbe3ec;border-radius:10px;padding:12px;margin:10px 0;background:#fbfdff"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><strong>Kwaliteitsoptie '+(j+1)+'</strong><label class="small" style="display:flex;align-items:center;gap:6px">SKU <input value="'+esc(v.sku)+'" maxlength="64" oninput="updateShopVariant('+i+','+j+',\'sku\',this.value)" aria-label="SKU kwaliteitsoptie '+(j+1)+'" style="width:170px;max-width:100%;padding:6px;border:1px solid #d8e0e9;border-radius:7px;font-family:monospace"></label><button class="btn btn-red" type="button" '+(p.variants.length<2?'disabled':'')+' onclick="deleteShopVariant('+i+','+j+')">Verwijderen</button></div><div class="grid" style="margin-top:10px"><label style="display:block;font-weight:700;font-size:13px">Kwaliteit<input value="'+esc(v.quality)+'" oninput="updateShopVariant('+i+','+j+',\'quality\',this.value)" placeholder="LCD, OLED, Original" style="display:block;width:100%;margin-top:5px;padding:11px;border:1px solid #d8e0e9;border-radius:9px"></label><label style="display:block;font-weight:700;font-size:13px">Verkoopprijs (€)<input type="number" min="0" step="0.01" value="'+esc(v.price)+'" oninput="updateShopVariant('+i+','+j+',\'price\',this.value)" style="display:block;width:100%;margin-top:5px;padding:11px;border:1px solid #d8e0e9;border-radius:9px"></label><label style="display:block;font-weight:700;font-size:13px">Voorraad (stuks)<input type="number" min="0" step="1" value="'+esc(v.stock)+'" oninput="updateShopVariant('+i+','+j+',\'stock\',this.value)" style="display:block;width:100%;margin-top:5px;padding:11px;border:1px solid #d8e0e9;border-radius:9px"></label></div></div>').join("");
  return '<details class="card" style="background:white;padding:0;margin-bottom:10px;border:1px solid #dbe3ec;border-radius:10px;overflow:hidden"><summary style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;cursor:pointer;list-style:none;font-weight:800;background:#f8fafc"><span>Product '+(i+1)+(p.name?' — '+esc(p.name):' — Nieuw product')+'</span><span style="color:#64748b;font-size:12px;font-weight:600">Bewerken ▾</span></summary><div style="padding:16px"><div class="card-head"><div class="card-title">Productgegevens</div><button class="btn btn-red" type="button" onclick="deleteShopProduct('+i+')">Verwijderen</button></div><div class="grid">'+field("Productnaam","name","Bijv. iPhone 11 Scherm")+'<label style="display:block;font-weight:700;font-size:13px;margin-bottom:10px">Categorie<select onchange="updateShopProduct('+i+',\'category\',this.value)" style="display:block;width:100%;margin-top:5px;padding:11px;border:1px solid #d8e0e9;border-radius:9px">'+categoryOptions+'</select></label>'+field("Merk","brand","Bijv. Apple")+field("Compatibel model","deviceModel","Bijv. iPhone 11")+'</div><label style="display:block;font-weight:700;font-size:13px;margin-bottom:12px">Productbeschrijving<textarea rows="4" placeholder="Compatibiliteit en belangrijkste eigenschappen..." oninput="updateShopProduct('+i+',\'description\',this.value)" style="display:block;width:100%;margin-top:5px;padding:11px;border:1px solid #d8e0e9;border-radius:9px">'+esc(p.description||"")+'</textarea></label><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:18px"><h3>Prijs en voorraad per kwaliteit</h3><button class="btn btn-green" type="button" onclick="addShopVariant('+i+')">＋ Kwaliteit toevoegen</button></div>'+variants+'<h3 style="margin-top:18px">Productfoto’s</h3><div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0">'+photos+'</div><div class="card" style="margin-top:12px"><label style="display:flex;align-items:center;gap:8px;font-weight:700"><input type="checkbox" '+(p.videoEnabled?"checked":"")+' onchange="updateShopProduct('+i+',\'videoEnabled\',this.checked);renderShopProductsAdmin()"> Video uitleg toevoegen</label>'+(p.videoEnabled?field("YouTube-video URL","videoUrl","https://www.youtube.com/watch?v=..."):'<p class="small" style="margin:8px 0 0">Video is optioneel.</p>')+'</div><label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-weight:700"><input type="checkbox" '+(p.active?"checked":"")+' onchange="updateShopProduct('+i+',\'active\',this.checked)"> Actief — tonen in de Shop</label></div></details>';
 }).join("");
}
ensureShopProducts();

/* Compress embedded phone photos before sending the complete catalog.
   This prevents a few high-resolution photos from exceeding the JSON request limit. */
async function compressPhonePhotoData(value){
  if(typeof value!=="string" || !/^data:image\/(?!svg\+xml)[^;]+;base64,/i.test(value) || value.length<180000) return value;
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      try{
        const maxSide=1440,scale=Math.min(1,maxSide/Math.max(img.naturalWidth||1,img.naturalHeight||1));
        const canvas=document.createElement("canvas");
        canvas.width=Math.max(1,Math.round((img.naturalWidth||1)*scale));
        canvas.height=Math.max(1,Math.round((img.naturalHeight||1)*scale));
        const ctx=canvas.getContext("2d");
        if(!ctx){resolve(value);return;}
        ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(img,0,0,canvas.width,canvas.height);
        let compressed=canvas.toDataURL("image/jpeg",0.78);
        if(compressed.length>=value.length) compressed=canvas.toDataURL("image/jpeg",0.65);
        resolve(compressed.length<value.length?compressed:value);
      }catch(e){console.warn("[HOMS TECH] Photo compression skipped:",e);resolve(value);}
    };
    img.onerror=()=>resolve(value);
    img.src=value;
  });
}
async function compressPhoneCatalogPhotos(phones){
  const walk=async value=>{
    if(typeof value==="string") return await compressPhonePhotoData(value);
    if(Array.isArray(value)){
      for(let i=0;i<value.length;i++) value[i]=await walk(value[i]);
      return value;
    }
    if(value&&typeof value==="object"){
      for(const key of Object.keys(value)) value[key]=await walk(value[key]);
    }
    return value;
  };
  await walk(phones);
  return phones;
}
/* Compress Shop photos in the outgoing payload while preserving transparent backgrounds when WebP is supported. */
async function compressShopPhotoData(value){
  if(typeof value!=="string"||!/^data:image\/(?!svg\+xml)[^;]+;base64,/i.test(value)||value.length<180000)return value;
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      try{
        const maxSide=1600,scale=Math.min(1,maxSide/Math.max(img.naturalWidth||1,img.naturalHeight||1));
        const canvas=document.createElement("canvas");
        canvas.width=Math.max(1,Math.round((img.naturalWidth||1)*scale));
        canvas.height=Math.max(1,Math.round((img.naturalHeight||1)*scale));
        const ctx=canvas.getContext("2d");if(!ctx){resolve(value);return;}
        ctx.drawImage(img,0,0,canvas.width,canvas.height);
        // WebP preserves transparency. Never fall back to JPEG here because
        // flattening a transparent product cutout onto white changes the asset.
        let compressed=canvas.toDataURL("image/webp",0.82);
        if(compressed.length>=value.length)compressed=canvas.toDataURL("image/webp",0.68);
        resolve(compressed.length<value.length?compressed:value);
      }catch(error){console.warn("[HOMS TECH] Shop photo compression skipped:",error);resolve(value);}
    };
    img.onerror=()=>resolve(value);img.src=value;
  });
}
async function compressShopCatalogPhotos(products){
  if(!Array.isArray(products))return [];
  for(const product of products){
    if(!product||!Array.isArray(product.images))continue;
    for(let i=0;i<Math.min(product.images.length,4);i++)product.images[i]=await compressShopPhotoData(product.images[i]);
  }
  return products;
}

/* ---------------- SAVE ---------------- */

async function save(isAuto=false){
  if(!canEditCurrentPage()){setStatus("✕ Je hebt geen toestemming om wijzigingen op te slaan.","error");return false;}
  if(isAuto) autoSaveAgain=false;
  if(loading) return false;
  // Validate the phone currently being edited before persisting the catalog.
  // This is scoped to the phone page so unrelated admin sections keep their existing save flow.
  if(currentPage==="shop"){
    if(shopImageUploadsPending>0){setStatus("Wacht tot alle Shopfoto’s volledig zijn ingelezen voordat je opslaat.","error");return false;}
    ensureShopProducts();
    const identifierCheck=validateShopCatalogIdentifiers(data.shopProducts);
    if(!identifierCheck.valid){setStatus("✕ "+identifierCheck.error,"error");return false;}
    for(let i=0;i<data.shopProducts.length;i++){
      const product=data.shopProducts[i];
      if(!String(product.name||"").trim()){setStatus("✕ Vul de productnaam in bij product "+(i+1)+".","error");return false;}
      const variants=Array.isArray(product.variants)?product.variants:[];
      if(!variants.length){setStatus("✕ Voeg minimaal één kwaliteitsoptie toe bij "+product.name+".","error");return false;}
      for(let j=0;j<variants.length;j++){
        const variant=variants[j];
        const label=String(variant.quality||("optie "+(j+1))).trim();
        const price=Number(String(variant.price??"").replace(",","."));
        const stock=Number(String(variant.stock??"").trim());
        if(!label){setStatus("✕ Vul de kwaliteit in bij "+product.name+" (optie "+(j+1)+").","error");return false;}
        if(!Number.isFinite(price)||price<=0){setStatus("✕ Vul een geldige prijs groter dan € 0 in bij "+product.name+" — "+label+".","error");return false;}
        if(!Number.isInteger(stock)||stock<0){setStatus("✕ Vul een geldig voorraadgetal van 0 of hoger in bij "+product.name+" — "+label+".","error");return false;}
      }
      if(product.videoEnabled&&product.videoUrl&&!/^https?:\/\//i.test(String(product.videoUrl).trim())){setStatus("✕ Vul een geldige https-video-URL in bij "+product.name+".","error");return false;}
    }
  }
  if(currentPage==="phones" && phoneEditOnly){
    const phone=data.phones?.[selectedPhoneIndex];
    if(!phone || !String(phone.name||"").trim()){
      setStatus("✕ Vul eerst de modelnaam in voordat je opslaat.","error");
      document.querySelector('[data-focus-key="phone-name"]')?.focus();
      return false;
    }
    if(!String(phone.brand||"").trim()){
      setStatus("✕ Vul eerst het merk in voordat je opslaat.","error");
      return false;
    }
    if(phone.setupWizard && phone.pricingMode==="variant" && Array.isArray(phone.variantPrices)){
      const invalid=phone.variantPrices.find(row=>row.price!=="" && row.price!==null && row.price!==undefined && (!Number.isFinite(Number(row.price)) || Number(row.price)<0));
      if(invalid){
        setStatus("✕ Controleer de vaste prijzen: elke prijs moet een geldig bedrag van € 0 of hoger zijn.","error");
        return false;
      }
    }
    if(phone.price!=="" && phone.price!==null && phone.price!==undefined && (!Number.isFinite(Number(phone.price)) || Number(phone.price)<0)){
      setStatus("✕ De standaardprijs moet een geldig bedrag van € 0 of hoger zijn.","error");
      return false;
    }
  }
  loading=true;
  setStatus("Opslaan...","info");
  const shopEditor=document.getElementById("shopProductsAdmin");
  const shopEditorControls=currentPage==="shop"&&shopEditor
    ? Array.from(shopEditor.querySelectorAll("input,select,textarea,button")).map(element=>({element,wasDisabled:element.disabled}))
    : [];
  shopEditorControls.forEach(({element})=>{element.disabled=true;});

  try{
    // Do NOT run the global normalizer before saving.
    // The editor already keeps Protocol 1–8 in the live `data` object.
    // Re-normalizing here can rebuild protocol options and overwrite values
    // that were just entered. Save the exact current state instead.

    // Preserve every explicit "Op website tonen" / "Actief" state exactly as set in Admin.
    // Missing values default to true; false must never be converted back to true/undefined.
    if(Array.isArray(data.buybackPhones)){
      data.buybackPhones.forEach(phone=>{
        [3,4,5,6,7,8].forEach(n=>{
          const p=phone[`protocol${n}`];
          if(p && typeof p === "object"){
            Object.keys(p).forEach(k=>{
              if(p[k] && typeof p[k] === "object" && !Array.isArray(p[k]) && "active" in p[k]) p[k].active=!!p[k].active;
              if(p[k] && typeof p[k] === "object" && Array.isArray(p[k].options)) p[k].options.forEach(o=>{ if(o && "active" in o) o.active=!!o.active; });
              if(p[k] && typeof p[k] === "object" && Array.isArray(p[k].items)) p[k].items.forEach(o=>{ if(o && "active" in o) o.active=!!o.active; });
            });
          }
        });
      });
    }

    const payload=currentPage==="buyback"
      ? {
          buybackCatalog: JSON.parse(JSON.stringify(data.buybackCatalog||[])),
          buybackPhones: JSON.parse(JSON.stringify(data.buybackPhones||[]))
        }
      : JSON.parse(JSON.stringify(data));
    if(currentPage==="phones"){
      setStatus("Foto's verkleinen en product opslaan...","info");
      if(phoneEditOnly && payload.phones?.[selectedPhoneIndex]) payload.phones[selectedPhoneIndex]=(await compressPhoneCatalogPhotos([payload.phones[selectedPhoneIndex]]))[0];
      else payload.phones=await compressPhoneCatalogPhotos(payload.phones||[]);
    }else if(currentPage==="shop"){
      setStatus("Shopfoto's verkleinen en producten opslaan...","info");
      payload.shopProducts=await compressShopCatalogPhotos(payload.shopProducts||[]);
    }
    if(currentPage==="phones" && payload.phones?.[selectedPhoneIndex]?.setupWizard){
      payload.phones[selectedPhoneIndex].setupWizard=false;
      delete payload.phones[selectedPhoneIndex].setupStep;
      delete payload.phones[selectedPhoneIndex].setupDone;
      delete payload.phones[selectedPhoneIndex].setupColors;
      delete payload.phones[selectedPhoneIndex].setupStorages;
      delete payload.phones[selectedPhoneIndex].setupConditions;
    }
    // The phone catalog can contain several MB of images. Send only that
    // section when editing phones instead of the full site settings document.
    const requestPayload=currentPage==="phones"
      ? (phoneEditOnly
          ? {phoneItem:payload.phones?.[selectedPhoneIndex],phoneIndex:selectedPhoneIndex,phoneIdentity:phoneOriginalIdentities[selectedPhoneIndex]||{}}
          : {phones:payload.phones||[]})
      : currentPage==="shop" ? {shopProducts:payload.shopProducts||[],expectedShopProducts:shopCatalogOriginalSnapshot} : currentPage==="buyback" ? {buybackCatalog:payload.buybackCatalog||[],buybackPhones:payload.buybackPhones||[]} : payload;
    if(currentPage==="phones" && phoneEditOnly && requestPayload.phoneItem){
      if(requestPayload.phoneItem.setupWizard){
        requestPayload.phoneItem.setupWizard=false;
        delete requestPayload.phoneItem.setupStep;
        delete requestPayload.phoneItem.setupDone;
        delete requestPayload.phoneItem.setupColors;
        delete requestPayload.phoneItem.setupStorages;
        delete requestPayload.phoneItem.setupConditions;
      }
    }
    const r=await fetch("/api/site",{
      method:"PUT",
      headers:{"Content-Type":"application/json","Accept":"application/json","X-Homs-Admin-Section":currentPage},
      credentials:"same-origin",
      body:JSON.stringify(requestPayload)
    });

    const raw=await r.text();
    let result={};
    try{ result=raw ? JSON.parse(raw) : {}; }catch{
      throw new Error("De server stuurde geen JSON terug. Controleer of de juiste server.js draait.");
    }

    if(!r.ok){
      throw new Error(result.error || "Opslaan mislukt");
    }

    // Use the exact data returned by the server (the persisted DB state).
    // Do not normalize again here, so Protocol 1–8 values cannot be reset
    // immediately after a successful save.
    if(currentPage==="phones"){
      if(phoneEditOnly && result.phone && Number.isInteger(Number(result.phoneIndex))){
        const savedIndex=Number(result.phoneIndex);
        if(savedIndex===data.phones.length) data.phones.push(result.phone);
        else if(savedIndex>=0 && savedIndex<data.phones.length) data.phones[savedIndex]=result.phone;
        phoneOriginalIdentities[savedIndex]={id:result.phone.id??null,name:String(result.phone.name||""),brand:String(result.phone.brand||"")};
      }else if(Array.isArray(result.phones)) data.phones=result.phones;
      else if(Array.isArray(payload.phones)){data.phones=payload.phones;phoneOriginalIdentities=data.phones.map(p=>({id:p?.id??null,name:String(p?.name||""),brand:String(p?.brand||"")}));}
    }else if(currentPage==="shop"){
      if(Array.isArray(result.shopProducts)) data.shopProducts=result.shopProducts;
      else if(Array.isArray(payload.shopProducts)) data.shopProducts=payload.shopProducts;
      shopCatalogOriginalSnapshot=JSON.parse(JSON.stringify(Array.isArray(data.shopProducts)?data.shopProducts:[]));
    }else if(currentPage==="buyback"){
      if(Array.isArray(result.buybackCatalog)) data.buybackCatalog=result.buybackCatalog;
      else if(Array.isArray(payload.buybackCatalog)) data.buybackCatalog=payload.buybackCatalog;
      if(Array.isArray(result.buybackPhones)) data.buybackPhones=result.buybackPhones;
      else if(Array.isArray(payload.buybackPhones)) data.buybackPhones=payload.buybackPhones;
    }else{
      data=result.data || data;
    }

    // A successful server save is the source of truth. Clear the local phone draft
    // so an old IndexedDB snapshot cannot restore deleted or outdated products.
    if(currentPage==="phones"){
      phoneDraftCommitted=true;
      await clearPhoneDraft();
    }

    // Alleen de huidige pagina opnieuw tekenen. Geen renderAll-loop na opslaan.
    if(currentPage==="general") renderHomepageSettings();
    else if(currentPage==="services") renderServices();
    else if(currentPage==="phones") renderPhones();
    else if(currentPage==="repair") renderRepairPageAdmin();
    else if(currentPage==="buyback") renderBuybackPhones();
    else if(currentPage==="categories") renderDeviceCategories();
    else if(currentPage==="why") renderWhy();
    setStatus("✓ Alle wijzigingen zijn succesvol opgeslagen","success");
    return true;
  }catch(e){
    setStatus("✕ Opslaan mislukt: "+e.message,"error");
    return false;
  }finally{
    shopEditorControls.forEach(({element,wasDisabled})=>{element.disabled=wasDisabled;});
    loading=false;
    autoSaveAgain=false;
  }
}

/* ---------------- SEARCH + ADMIN USERS ---------------- */
async function adminSearch(){
  if(!hasPermission("search"))return;
  const q=String(document.getElementById("adminSearchInput")?.value||"").trim();
  const status=document.getElementById("searchStatus"),box=document.getElementById("searchResults");
  if(q.length<2){status.className="status info";status.textContent="Vul minimaal 2 tekens in.";box.innerHTML="";return;}
  status.className="status info";status.textContent="Zoeken...";box.innerHTML="";
  try{
    const r=await fetch("/api/admin/search?q="+encodeURIComponent(q),{credentials:"same-origin"});
    const x=await r.json().catch(()=>({}));if(!r.ok)throw new Error(x.error||"Zoeken mislukt.");
    const parts=[];
    if((x.customers||[]).length)parts.push("<h3>👥 Klanten</h3>"+x.customers.map(c=>`<div class="search-result"><strong>${esc(c.name||"Klant")}</strong><br>${esc(c.email||"-")} · ${esc(c.phone||"-")}<br><span class="small">${esc(c.address||"")}</span></div>`).join(""));
    if((x.webshopOrders||[]).length)parts.push("<h3>🛍️ Webshop Bestellingen</h3>"+x.webshopOrders.map(o=>`<div class="search-result"><strong>#${esc(o.id)} — ${esc(o.name||"Klant")}</strong><br>${esc(o.email||"-")} · ${esc(o.phone||"-")} · € ${esc(Number(o.total||0).toFixed(2))}<br><span class="small">${esc(o.postcode||"")} ${esc(o.city||"")} · ${esc(o.status||"-")}</span><div class="actions" style="margin-top:10px"><button class="btn btn-light" onclick="showWebshopOrderDetails(${Number(o.id)})">Details</button>${hasPermission("webshop_orders.delete")?`<button class="btn btn-red" onclick="deleteWebshopOrder(${Number(o.id)})">Verwijderen</button>`:""}</div></div>`).join(""));
    box.innerHTML=parts.join("")||'<div class="small">Geen resultaten gevonden.</div>';
    status.className="status success";status.textContent=parts.length?"Zoeken voltooid.":"Geen resultaten.";
  }catch(e){status.className="status error";status.textContent="✕ "+e.message;}
}
function renderPermissionCheckboxes(id,selected=[]){
  const box=document.getElementById(id);if(!box)return;
  box.innerHTML=Object.entries(ADMIN_PERMISSION_LABELS).map(([k,v])=>`<label class="permission-item"><input type="checkbox" value="${esc(k)}" ${selected.includes(k)?"checked":""}><span>${esc(v)}</span></label>`).join("");
}
function getCheckedPermissions(id){
  const box=document.getElementById(id);return box?[...box.querySelectorAll('input[type="checkbox"]:checked')].map(x=>x.value):[];
}
async function createAdmin(){
  const st=document.getElementById("adminCreateStatus");
  const username=document.getElementById("newAdminUsername").value.trim();
  const password=document.getElementById("newAdminPassword").value;
  const permissions=getCheckedPermissions("newAdminPermissions");
  st.className="status info";st.textContent="Admin aanmaken...";
  try{
    const r=await fetch("/api/admin/users",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({username,password,permissions})});
    const x=await r.json().catch(()=>({}));if(!r.ok)throw new Error(x.error||"Admin kon niet worden aangemaakt.");
    document.getElementById("newAdminUsername").value="";document.getElementById("newAdminPassword").value="";
    renderPermissionCheckboxes("newAdminPermissions",[]);st.className="status success";st.textContent="✓ Admin aangemaakt.";await loadAdmins();
  }catch(e){st.className="status error";st.textContent="✕ "+e.message;}
}
async function loadAdmins(){
  if(!hasPermission("admins.manage"))return;
  const box=document.getElementById("adminsList"),st=document.getElementById("adminsStatus");if(!box)return;
  st.className="status info";st.textContent="Admins laden...";box.innerHTML="";
  try{
    const r=await fetch("/api/admin/users",{credentials:"same-origin"});const x=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(x.error||"Admins konden niet worden geladen.");
    const users=x.users||[];
    box.innerHTML=users.length?users.map(u=>`<div class="admin-user-card">
      <div class="card-head"><div><div class="card-title">👤 ${esc(u.username)}</div><div class="small">${u.active?"Actief":"Uitgeschakeld"}</div></div>
      <button class="btn btn-red" onclick="deleteAdmin(${Number(u.id)})">Verwijderen</button></div>
      <div class="grid">
        <div class="field"><label>Gebruikersnaam</label><input id="an-${Number(u.id)}" value="${esc(u.username)}"></div>
        <div class="field"><label>Nieuw wachtwoord (leeg = behouden)</label><input id="ap-${Number(u.id)}" type="password"></div>
      </div>
      <label class="permission-item" style="max-width:300px"><input id="aa-${Number(u.id)}" type="checkbox" ${u.active?"checked":""}><span>Admin is actief</span></label>
      <div class="field"><label>Rechten</label><div id="ax-${Number(u.id)}" class="permission-grid"></div></div>
      <button class="btn btn-green" onclick="updateAdmin(${Number(u.id)})">💾 Admin opslaan</button>
      <div id="as-${Number(u.id)}" class="status" style="margin-top:10px"></div>
    </div>`).join(""):'<div class="small">Nog geen extra admins aangemaakt.</div>';
    users.forEach(u=>renderPermissionCheckboxes("ax-"+Number(u.id),Array.isArray(u.permissions)?u.permissions:[]));
    st.className="status success";st.textContent=users.length+" admin(s) gevonden";
  }catch(e){st.className="status error";st.textContent="✕ "+e.message;}
}
async function updateAdmin(id){
  const st=document.getElementById("as-"+id);
  const body={username:document.getElementById("an-"+id).value.trim(),password:document.getElementById("ap-"+id).value,active:document.getElementById("aa-"+id).checked,permissions:getCheckedPermissions("ax-"+id)};
  st.className="status info";st.textContent="Opslaan...";
  try{
    const r=await fetch("/api/admin/users/"+encodeURIComponent(id),{method:"PUT",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify(body)});
    const x=await r.json().catch(()=>({}));if(!r.ok)throw new Error(x.error||"Admin kon niet worden bijgewerkt.");
    st.className="status success";st.textContent="✓ Opgeslagen.";await loadAdmins();
  }catch(e){st.className="status error";st.textContent="✕ "+e.message;}
}
async function deleteAdmin(id){
  if(!confirm("Deze admin echt verwijderen?"))return;
  const r=await fetch("/api/admin/users/"+encodeURIComponent(id),{method:"DELETE",credentials:"same-origin"});
  const x=await r.json().catch(()=>({}));if(!r.ok){document.getElementById("adminsStatus").textContent=x.error||"Verwijderen mislukt.";return;}
  await loadAdmins();
}

async function showRepairRequestDetails(id){
  const order=adminRepairOrdersCache.find(item=>Number(item.id)===Number(id));
  if(!order){alert("Reparatieaanvraag niet gevonden. Vernieuw de lijst.");return;}
  let meta={};try{meta=JSON.parse(order.extra_fields||"{}")}catch{}
  const photos=Array.isArray(meta.photos)?meta.photos:[];
  const offer=meta.offer||{};
  const date=order.created_at?new Date(order.created_at).toLocaleString("nl-NL"):"-";
  const photoLinks=photos.map((photo,index)=>"Foto "+(index+1)+": "+(photo.url||photo.dataUrl||"niet beschikbaar")).join("\n");
  showOrderDetails("Reparatieaanvraag #"+order.id,{
    "Ordernummer":"R-"+String(order.id).padStart(4,"0"),"Datum":date,"Status":order.status||"Nieuw",
    "Klant":order.name||"-","E-mail":order.email||"-","Telefoon":order.phone||"-",
    "Toestel":((meta.brand||"")+" "+(meta.model||order.service_name||"")).trim()||"-",
    "Reparatie":order.service_name||order.service_category||"-","Servicegroep":order.service_group||"-",
    "IMEI / serienummer":order.imei||"-","Probleem / opmerkingen":order.notes||"-",
    "Straat":order.street||"-","Huisnummer":order.house_number||"-","Postcode":order.postcode||"-","Plaats":order.city||"-",
    "Prijs":order.price||"-","Offerte":offer.price||"-",
    "Offerte verstuurd":offer.sentAt?new Date(offer.sentAt).toLocaleString("nl-NL"):"Nog niet",
    "Foto's":photoLinks||"Geen foto's toegevoegd"
  });
}

/* ---------------- ORDER DETAILS / DELETE ---------------- */

function showOrderDetails(title, data){
  const existing=document.getElementById("orderDetailsModal");
  if(existing) existing.remove();

  const modal=document.createElement("div");
  modal.id="orderDetailsModal";
  modal.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;";
  const rows=Object.entries(data||{}).map(([k,v])=>`
    <div style="padding:10px 0;border-bottom:1px solid #e5eaf1">
      <strong>${esc(k)}</strong><br>
      <span style="white-space:pre-wrap">${esc(v===null||v===undefined?"":(typeof v==="object"?JSON.stringify(v,null,2):String(v)))}</span>
    </div>`).join("");
  modal.innerHTML=`
    <div style="background:#fff;border-radius:16px;max-width:760px;width:100%;max-height:90vh;overflow:auto;padding:22px">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center">
        <h2 style="margin:0">${esc(title)}</h2>
        <button class="btn btn-light" onclick="document.getElementById('orderDetailsModal').remove()">✕</button>
      </div>
      <div style="margin-top:14px">${rows}</div>
    </div>`;
  document.body.appendChild(modal);
}

async function printWebshopShippingLabel(id){
  const order=(adminWebshopOrdersCache||[]).find(item=>Number(item.id)===Number(id));
  if(!order){alert("Bestelling niet gevonden. Vernieuw de bestellingen en probeer opnieuw.");return;}
  const escLabel=value=>String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  const recipientName=String(order.name||"").trim();
  const addressLine=[order.street,order.house_number].filter(Boolean).join(" ").trim();
  const postcodeCity=[order.postcode,order.city].filter(Boolean).join(" ").trim();
  if(!recipientName||!addressLine||!postcodeCity){alert("Het adres van de klant is niet volledig. Vul naam, straat/huisnummer, postcode en plaats in voordat je het label afdrukt.");return;}
  const tracking=String(order.tracking_number||"").trim();
  const carrier=["PostNL","DHL"].includes(order.shipping_method)?order.shipping_method:"Nog niet gekozen";
  const trackingUrl=String(order.tracking_url||"").trim();
  const w=window.open("","_blank","width=900,height=800");
  if(!w){alert("Sta pop-ups toe om het verzendlabel te kunnen afdrukken.");return;}
  w.document.open();
  w.document.write(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HOMS TECH · Verzendlabel #${Number(order.id)}</title><style>
    @page{size:A6 portrait;margin:0}
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;width:105mm;height:148mm;background:#fff;color:#111827;font-family:Arial,Helvetica,sans-serif}
    .label{width:105mm;height:148mm;padding:7mm;display:flex;flex-direction:column;border:0}
    .brand-row{display:flex;justify-content:space-between;align-items:flex-start;gap:8mm}
    .brand{font-size:22pt;font-weight:900;letter-spacing:.7px;color:#0b2942}
    .brand span{color:#2185d0}
    .brand-sub{font-size:7.5pt;color:#64748b;margin-top:1mm;letter-spacing:1.2px;text-transform:uppercase}
    .order-chip{border:1px solid #cbd5e1;border-radius:5px;padding:2mm 3mm;font-size:9pt;font-weight:800;white-space:nowrap}
    .top-rule{height:2mm;background:#0b2942;margin:5mm 0}
    .carrier-row{display:flex;align-items:center;justify-content:space-between;font-size:9pt;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:#334155}
    .carrier{border:1px solid #94a3b8;border-radius:4px;padding:2mm 3mm;font-size:10pt;color:#0b2942}
    .to-label{font-size:8pt;font-weight:800;color:#64748b;letter-spacing:1.3px;text-transform:uppercase;margin:8mm 0 3mm}
    .recipient{font-size:19pt;font-weight:800;line-height:1.15;overflow-wrap:anywhere;margin-bottom:3mm}
    .address{font-size:15pt;font-weight:600;line-height:1.35;overflow-wrap:anywhere}
    .postcode{font-size:18pt;font-weight:900;letter-spacing:.5px;margin-top:2mm}
    .country{font-size:11pt;font-weight:800;letter-spacing:1px;margin-top:1mm}
    .spacer{flex:1}
    .tracking-box{border:1px solid #cbd5e1;border-radius:6px;padding:4mm}
    .tracking-label{font-size:7.5pt;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:800}
    .tracking{font-size:12pt;font-weight:900;overflow-wrap:anywhere;margin-top:2mm}
    .tracking-link{font-size:7.5pt;color:#475569;margin-top:1mm;overflow-wrap:anywhere}
    .footer{display:flex;justify-content:space-between;align-items:center;border-top:1px solid #cbd5e1;margin-top:4mm;padding-top:3mm;font-size:7pt;color:#64748b}
    .footer strong{color:#0b2942}
    @media screen{body{background:#e2e8f0;padding:12px;width:auto;height:auto}.label{margin:0 auto;background:#fff;box-shadow:0 5px 24px rgba(15,23,42,.18)}}
    @media print{body{padding:0;background:#fff}.label{box-shadow:none}}
  </style></head><body><main class="label">
    <header class="brand-row"><div><div class="brand">HOMS <span>TECH</span></div><div class="brand-sub">Phones · Repair · Service</div></div><div class="order-chip">ORDER #${Number(order.id)}</div></header>
    <div class="top-rule"></div>
    <div class="carrier-row"><span>Verzendmethode</span><span class="carrier">${escLabel(carrier)}</span></div>
    <section><div class="to-label">Verzenden naar</div><div class="recipient">${escLabel(recipientName)}</div><div class="address">${escLabel(addressLine)}</div><div class="postcode">${escLabel(postcodeCity)}</div><div class="country">NEDERLAND</div>${order.phone?'<div style="font-size:8pt;color:#64748b;margin-top:3mm">Tel. '+escLabel(order.phone)+'</div>':''}</section>
    <div class="spacer"></div>
    ${tracking?'<section class="tracking-box"><div class="tracking-label">Track & Trace</div><div class="tracking">'+escLabel(tracking)+'</div>'+(trackingUrl?'<div class="tracking-link">'+escLabel(trackingUrl)+'</div>':'')+'</section>':'<section class="tracking-box"><div class="tracking-label">Track & Trace</div><div class="tracking" style="font-size:9pt">Trackingnummer wordt toegevoegd na verzending</div></section>'}
    <footer class="footer"><strong>HOMS TECH</strong><span>Adreslabel · geen officieel vervoerderslabel</span></footer>
  </main><script>window.addEventListener("load",()=>setTimeout(()=>window.print(),300));<\\/script></body></html>`);
  w.document.close();
}

function closeWebshopOrderDetails(){
  const modal=document.getElementById("orderDetailsModal");
  if(modal)modal.remove();
  const host=document.getElementById("phoneOrderDetailHost");
  if(host){
    host.replaceChildren();
  }
  document.querySelector("#page-phone-orders .ht-phone-orders-workspace")?.classList.remove("has-selection");
  document.querySelectorAll("#phoneOrdersList .ht-phone-sale-row").forEach(row=>row.classList.remove("is-selected"));
}
async function showWebshopOrderDetails(id){
  try{
    // Use the already loaded admin order cache first. Opening a row must not
    // download the complete order list again.
    let order=(Array.isArray(adminWebshopOrdersCache)?adminWebshopOrdersCache:[]).find(x=>Number(x.id)===Number(id));
    if(!order){
      const r=await fetch("/api/admin/webshop-orders",{credentials:"same-origin"});
      const result=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(result.error||"Bestelling kon niet worden geladen.");
      adminWebshopOrdersCache=Array.isArray(result.orders)?result.orders:[];
      order=adminWebshopOrdersCache.find(x=>Number(x.id)===Number(id));
    }
    if(!order) throw new Error("Bestelling niet gevonden.");
    const existing=document.getElementById("orderDetailsModal");
    if(existing)existing.remove();
    const items=Array.isArray(order.items)?order.items:[];
    // Product-photo lookup is deliberately deferred until after the order view
    // is visible, so a slow catalog endpoint never delays opening the details.
    const resolveOrderItemImages=item=>{
      const snapshot=[item?.image,item?.image_url,item?.imageUrl,item?.thumbnail,item?.product_image,item?.photo,item?.product?.image,
        ...(Array.isArray(item?.images)?item.images:[])].filter(value=>typeof value==="string"&&value.trim());
      return [...new Set(snapshot)];
    };
    const hasShopItems=items.some(item=>String(item?.type||"phone").toLowerCase()==="shop");
    const hasPhoneItems=items.some(item=>String(item?.type||"phone").toLowerCase()!=="shop");
    const orderCategory=hasShopItems&&hasPhoneItems?"COMBINATIEBESTELLING":(hasPhoneItems?"TELEFOONBESTELLING":"ONDERDELEN & ACCESSOIRES");
    const address=[order.street,order.house_number].filter(Boolean).join(" ")+
      ([order.postcode,order.city].filter(Boolean).length?", "+[order.postcode,order.city].filter(Boolean).join(" "):"");
    const money=value=>"€ "+Number(value||0).toLocaleString("nl-NL",{minimumFractionDigits:2,maximumFractionDigits:2});
    const {date:orderDate,time:orderTime}=formatPhoneOrderDateTime(order.created_at);
    const date=orderDate+(orderTime?" · "+orderTime:"");
    const status=order.status||"Nieuw";
    const payment=order.payment_status||"Onbekend";
    const paymentKey=String(payment).toLowerCase();
    const paymentLabel=/^(paid|betaald|completed)$/.test(paymentKey)?"Betaald":(/^(pending)$/.test(paymentKey)?"In afwachting":(/^(unpaid|open)$/.test(paymentKey)?"Niet betaald":(/^(failed|mislukt)$/.test(paymentKey)?"Mislukt":(/^(cancelled|canceled|geannuleerd)$/.test(paymentKey)?"Geannuleerd":payment))));
    const paymentClass=paymentLabel==="Betaald"?"is-paid":(["Mislukt","Geannuleerd"].includes(paymentLabel)?"is-failed":"");
    const itemRows=items.length?items.map((item,index)=>{
      const name=item.name||item.title||item.product_name||"Product";
      const image=resolveOrderItemImages(item)[0]||"";
      const quantity=Number(item.qty||item.quantity||1);
      const price=Number(item.unitPrice??item.unit_price??item.price??0);
      const options=item.options&&typeof item.options==="object"?item.options:{};
      const itemCategory=String(item.type||"phone").toLowerCase()==="shop"?"Onderdeel / accessoire":"Telefoon";
      const meta=[itemCategory,options.condition||item.condition||item.product_condition,options.color||options.colour||item.color||item.colour,options.storage||item.storage,options.battery,options.vat,options.tradeIn,item.sku?"SKU: "+item.sku:""].filter(Boolean).join(" · ");
      return `<div class="ht-order-product-row">
        ${image?`<img src="${esc(image)}" alt="" loading="lazy" onerror="this.style.display='none'">`:'<div class="ht-order-product-placeholder">▣</div>'}
        <div class="ht-order-product-copy"><strong>${esc(name)}</strong><small>${esc(meta||"")}</small><small>× ${quantity} · ${money(price)} per stuk</small></div>
        <strong class="ht-order-product-price">${money(price*quantity)}</strong>
      </div>`;
    }).join(""):'<div class="ht-order-empty-items">Geen productregels beschikbaar voor deze bestelling.</div>';
    const total=Number(order.total||0);
    const subtotal=items.reduce((sum,item)=>sum+Number(item.unitPrice??item.unit_price??item.price??0)*Number(item.qty||item.quantity||1),0);
    const phoneStatusStages=[
      {status:"Nieuw",title:"Bestelling geplaatst",description:"De bestelling is succesvol ontvangen."},
      {status:"In behandeling",title:"In behandeling",description:"De bestelling wordt momenteel verwerkt."},
      {status:"Verzonden",title:"Verzonden",description:"De bestelling is verzonden naar de klant."},
      {status:"Voltooid",title:"Voltooid",description:"De bestelling is afgerond."}
    ];
    const statusHistory=Array.isArray(order.status_history)?order.status_history:[];
    const statusIndex=phoneStatusStages.findIndex(stage=>stage.status===status);
    const currentStageIndex=statusIndex>=0?statusIndex:(status==="Geannuleerd"?4:0);
    const timelineRows=phoneStatusStages.map((stage,index)=>{
      const events=statusHistory.filter(event=>event.status===stage.status);
      const event=events.length?events[events.length-1]:null;
      const isDone=index<currentStageIndex;
      const isCurrent=index===currentStageIndex;
      const timestamp=index===0?(event?.created_at||order.created_at):event?.created_at;
      const formatted=timestamp?formatPhoneOrderDateTime(timestamp):null;
      const dateLabel=formatted?(formatted.date+(formatted.time?" "+formatted.time:"")):(isCurrent?"Tijdstip niet geregistreerd":(isDone?"Historisch tijdstip niet beschikbaar":"—"));
      return '<div class="ht-phone-timeline-row '+(isDone?"is-done":(isCurrent?"is-current":""))+'"><span class="ht-phone-timeline-dot">'+(isDone?"✓":(isCurrent?"◷":""))+'</span><span class="ht-phone-timeline-copy"><strong>'+esc(stage.title)+'</strong><small>'+esc(stage.description)+'</small></span><span class="ht-phone-timeline-date">'+esc(dateLabel)+'</span></div>';
    }).join("")+(status==="Geannuleerd"?'<div class="ht-phone-timeline-row is-current"><span class="ht-phone-timeline-dot">!</span><span class="ht-phone-timeline-copy"><strong>Geannuleerd</strong><small>Deze bestelling is geannuleerd.</small></span><span class="ht-phone-timeline-date">'+(statusHistory.some(event=>event.status==="Geannuleerd")?esc((()=>{const event=statusHistory.filter(item=>item.status==="Geannuleerd").slice(-1)[0];const value=formatPhoneOrderDateTime(event.created_at);return value.date+(value.time?" "+value.time:"");})()):"Tijdstip niet geregistreerd")+'</span></div>':"");
    const firstPhoneItem=items[0]||{};
    const firstPhoneOptions=firstPhoneItem.options&&typeof firstPhoneItem.options==="object"?firstPhoneItem.options:{};
    const firstPhoneImages=[...resolveOrderItemImages(firstPhoneItem),...(Array.isArray(firstPhoneOptions.images)?firstPhoneOptions.images:[])].filter((value,index,array)=>typeof value==="string"&&value.trim()&&array.indexOf(value)===index).slice(0,5);
    const firstPhoneName=firstPhoneItem.name||firstPhoneItem.title||firstPhoneItem.product_name||"Telefoon";
    const firstPhoneMeta=[firstPhoneOptions.storage||firstPhoneItem.storage,firstPhoneOptions.color||firstPhoneOptions.colour||firstPhoneItem.color||firstPhoneItem.colour,firstPhoneOptions.condition||firstPhoneItem.condition||firstPhoneItem.product_condition].filter(Boolean);
    const firstPhoneQuantity=Number(firstPhoneItem.qty||firstPhoneItem.quantity||1);
    const firstPhoneUnitPrice=Number(firstPhoneItem.unitPrice??firstPhoneItem.unit_price??firstPhoneItem.price??0);
    const phoneProductVisual=firstPhoneImages.length?
      '<div class="ht-phone-product-visual"><div class="ht-phone-product-thumbs">'+firstPhoneImages.map((src,index)=>'<button type="button" aria-label="Productfoto '+(index+1)+'" onclick="this.parentElement.nextElementSibling.src=this.firstElementChild.src"><img src="'+esc(src)+'" alt="" loading="lazy"></button>').join("")+'</div><img class="ht-phone-product-main-image" src="'+esc(firstPhoneImages[0])+'" alt="'+esc(firstPhoneName)+'" onerror="this.style.display=\'none\'"></div>':
      '<div class="ht-phone-product-visual"><div class="ht-phone-product-placeholder">Geen productfoto beschikbaar</div></div>';
    const phoneExtraProducts=items.length>1?'<div class="ht-phone-product-extra">'+itemRows+'</div>':"";
    const phoneStreetName=String(order.street||"").trim();
    const phoneHouseNumber=String(order.house_number||"").trim();
    const phoneStreetAddress=[phoneStreetName,phoneHouseNumber].filter(Boolean).join(" ");
    const phonePostcode=String(order.postcode||"").trim();
    const phoneCity=String(order.city||"").trim();
    const phonePostcodeCity=[phonePostcode,phoneCity].filter(Boolean).join(" ");
    const phoneCountry=String(order.country||"Nederland").trim();
    const phoneFullAddress=[phoneStreetAddress,phonePostcodeCity,phoneCountry].filter(Boolean).join(", ");
    const phoneDigitsRaw=String(order.phone||"").replace(/[^\d]/g,"");
    const phoneDigits=phoneDigitsRaw.startsWith("0")?"31"+phoneDigitsRaw.slice(1):phoneDigitsRaw;
    const phoneWhatsapp=phoneDigits?'<a class="btn btn-light" target="_blank" rel="noopener noreferrer" href="https://wa.me/'+esc(phoneDigits)+'?text='+encodeURIComponent("Hoi, over bestelling #"+Number(order.id)+" bij HOMS TECH.")+'">WhatsApp-bericht sturen</a>':"";
    const tradeInReadyToShip=!order.trade_in_order_id||order.trade_in_status==="Settled";
    const phoneInspectionMarkup="";
    const phoneStatusOptions=['Nieuw','In behandeling','Verzonden','Voltooid','Geannuleerd'].map(value=>'<option value="'+esc(value)+'" '+(status===value?'selected':'')+' '+(['Verzonden','Voltooid'].includes(value)&&!tradeInReadyToShip?'disabled':'')+'>'+esc(value)+'</option>').join("");
    const phoneShippingLabel=status==="Verzonden"?"Verzonden":(order.tracking_number?"Verzending geregistreerd":"Nog niet verzonden");
    const phonePaymentReference=order.mollie_payment_id||order.paypal_order_id||"Niet beschikbaar";
    const phonePaymentTone=paymentClass==="is-paid"?"is-paid":(paymentClass==="is-failed"?"is-failed":"is-pending");
    const phoneNotes=Array.isArray(order.notes)?order.notes:[];
    const phoneNotesMarkup=phoneNotes.length?phoneNotes.map(note=>{
      const stamp=note.created_at?formatPhoneOrderDateTime(note.created_at):null;
      const noteDate=stamp?stamp.date+(stamp.time?" "+stamp.time:""):"Datum niet beschikbaar";
      return '<div class="ht-phone-note-entry"><div class="ht-phone-note-meta">'+esc(note.created_by||"HOMS TECH Admin")+' · '+esc(noteDate)+'</div><p>'+esc(note.note||"")+'</p></div>';
    }).join(""):'<div class="ht-phone-detail-muted">Nog geen notities bij deze bestelling.</div>';
    const phoneNoteForm=hasPermission("webshop_orders.update")?'<div class="ht-phone-note-form"><label class="ht-phone-detail-field">Nieuwe notitie<textarea id="webshopOrderNote" maxlength="2000" rows="3" placeholder="Schrijf een interne notitie over deze bestelling..."></textarea></label><button class="btn btn-primary" type="button" onclick="saveWebshopOrderNote('+Number(order.id)+')">Notitie opslaan</button></div>':"";
    // Trade-in inspection, approval and payout are managed in Inkoop.
    // Keep only a compact cross-reference in the phone purchase detail.
    const tradeInCard=order.trade_in_order_id
      ? '<section class="ht-phone-inkoop-link" aria-label="Inruil gekoppeld aan Inkoop">'+
          '<div class="ht-phone-inkoop-link-copy"><strong>♻ Oude telefoon · Inkoop</strong>'+
          '<small>Aanvraag #'+Number(order.trade_in_order_id)+' · '+esc(order.trade_in_model||order.trade_in_device||"Oude iPhone")+
          ' · Geschatte waarde '+money(order.trade_in_estimated_value)+'</small></div>'+
          '<button class="btn btn-light" type="button" onclick="openLinkedBuybackOrder('+Number(order.trade_in_order_id)+')">Beheren in Inkoop ↗</button>'+
        '</section>'
      : "";

    const phoneDetailMarkup=`
      <div class="ht-order-detail-panel phone-order-detail-panel" role="dialog" aria-modal="true" aria-label="Bestelling #${Number(order.id)}">
        <div class="ht-order-detail-top">
          <div><div class="ht-order-eyebrow">HOMS TECH · TELEFOONBESTELLING</div><h2>Bestelling #${Number(order.id)}</h2><p>${esc(date)}</p></div>
          <span class="ht-phone-detail-head-status">${esc(status)}</span>
          <button type="button" class="btn btn-light ht-phone-detail-close" aria-label="Sluiten" onclick="closeWebshopOrderDetails()">✕</button>
        </div>
        <div class="ht-phone-detail-columns">
  <div class="ht-phone-detail-column ht-phone-detail-column-main">
    <section class="ht-phone-detail-card">
            <div class="ht-phone-detail-card-head"><span class="icon">▣</span>Besteld product</div>
            <div class="ht-phone-detail-card-body"><div class="ht-phone-product-feature">${phoneProductVisual}
              <div><div class="ht-phone-product-title">${esc(firstPhoneName)}</div><div class="ht-phone-product-tags">${firstPhoneMeta.map(value=>'<span>'+esc(value)+'</span>').join("")||'<span>Specificaties niet opgegeven</span>'}</div><div class="ht-phone-product-qty">Aantal: ${firstPhoneQuantity}</div><strong class="ht-phone-product-price">${money(firstPhoneUnitPrice*firstPhoneQuantity)}</strong></div>
            </div></div>${phoneExtraProducts}
          </section>
    ${tradeInCard}
    <section class="ht-phone-detail-card">
            <div class="ht-phone-detail-card-head"><span class="icon">♙</span>Klantgegevens</div>
            <div class="ht-phone-detail-card-body ht-phone-info-list">
              <div class="ht-phone-info-line"><span>Naam</span><strong>${esc(order.name||"Niet opgegeven")}</strong></div>
              <div class="ht-phone-info-line"><span>Telefoon</span><strong>${order.phone?'<a class="ht-phone-contact-link" href="tel:'+esc(String(order.phone).replace(/[^\d+]/g,''))+'">'+esc(order.phone)+'</a>':'Niet opgegeven'}</strong></div>
              <div class="ht-phone-info-line"><span>E-mail</span><strong>${order.email?'<a class="ht-phone-contact-link" href="mailto:'+esc(order.email)+'">'+esc(order.email)+'</a>':'Niet opgegeven'}</strong></div>
              <div class="ht-phone-detail-actions">${phoneWhatsapp}</div>
            </div>
          </section>
    <section class="ht-phone-detail-card">
            <div class="ht-phone-detail-card-head"><span class="icon">▣</span>Betaalinformatie</div>
            <div class="ht-phone-detail-card-body ht-phone-info-list">
              <div class="ht-phone-info-line"><span>Betaalmethode</span><strong>${esc(order.payment_method||"Niet geregistreerd")}</strong></div>
              <div class="ht-phone-info-line"><span>Betaalstatus</span><strong><span class="ht-phone-detail-pill ${phonePaymentTone}">${esc(paymentLabel)}</span></strong></div>
              <div class="ht-phone-info-line"><span>Transactie-ID</span><strong>${esc(phonePaymentReference)}</strong></div>
              <label class="ht-phone-detail-field">Betaalstatus aanpassen
                <select id="webshopPaymentStatus"><option value="Unpaid" ${/^(unpaid|open)$/i.test(payment)?"selected":""}>Niet betaald</option><option value="Processing" ${/^processing$/i.test(payment)?"selected":""}>In behandeling</option><option value="Paid" ${/^(paid|betaald|completed)$/i.test(payment)?"selected":""}>Betaald</option><option value="Failed" ${/^(failed|mislukt)$/i.test(payment)?"selected":""}>Mislukt</option></select>
              </label>
              <div class="ht-phone-detail-muted">Sla de betaalstatus hier apart op. Bij Betaald wordt de voorraad automatisch gecontroleerd.</div>
              <button class="btn btn-primary ht-phone-payment-save" type="button" onclick="saveWebshopOrderPayment(${Number(order.id)})">💾 Betaalstatus opslaan</button>
            </div>
          </section>
    ${phoneInspectionMarkup}
    <section class="ht-phone-detail-card ht-shipping-workspace">
      <div class="ht-phone-detail-card-head ht-shipping-heading">
        <div class="ht-shipping-heading-icon" aria-hidden="true">🚚</div>
        <div class="ht-shipping-heading-copy">
          <span class="ht-shipping-eyebrow">ORDER FULFILMENT</span>
          <h3>Verzending</h3>
          <p>Beheer de vervoerder en volggegevens van deze bestelling.</p>
        </div>
        <span class="ht-shipping-state ${order.tracking_number ? "is-complete" : "is-pending"}">
          <span class="ht-shipping-state-dot"></span>
          ${order.tracking_number ? "Verzendgegevens compleet" : "Wacht op verzending"}
        </span>
      </div>

      <div class="ht-shipping-content">
        <div class="ht-shipping-status">
          <div class="ht-shipping-status-icon" aria-hidden="true">${order.tracking_number ? "✓" : "📦"}</div>
          <div class="ht-shipping-status-copy">
            <strong>${order.tracking_number ? "Tracking is beschikbaar" : "Verzending nog niet aangemaakt"}</strong>
            <span>${order.tracking_number ? "De verzendgegevens zijn opgeslagen. Je kunt het pakket volgen via de trackinglink." : "Kies de vervoerder en voeg na het aanmelden van het pakket het trackingnummer toe."}</span>
          </div>
        </div>

        <div class="ht-shipping-overview">
          <div class="ht-shipping-data">
            <span class="ht-shipping-data-label">VERVOERDER</span>
            <strong>${esc(order.shipping_method || "Nog niet gekozen")}</strong>
          </div>
          <div class="ht-shipping-data">
            <span class="ht-shipping-data-label">TRACKINGNUMMER</span>
            <strong class="ht-shipping-tracking-value">${esc(order.tracking_number || "Nog niet beschikbaar")}</strong>
          </div>
          ${order.tracking_url ? '<a class="ht-shipping-track-link" href="' + esc(order.tracking_url) + '" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">↗</span> Pakket volgen</a>' : '<div class="ht-shipping-track-placeholder">Trackinglink verschijnt zodra deze is opgeslagen.</div>'}
        </div>

        <div class="ht-shipping-form-heading">
          <div>
            <strong>Verzendgegevens bijwerken</strong>
            <span>Vul de gegevens in zodra het pakket is aangemeld.</span>
          </div>
          <span class="ht-shipping-edit-icon" aria-hidden="true">✎</span>
        </div>

        <div class="ht-shipping-form">
          <label class="ht-phone-detail-field">
            <span>Vervoerder</span>
            <select id="webshopShippingCarrier">
              <option value="">Selecteer vervoerder</option>
              <option value="PostNL" ${order.shipping_method === "PostNL" ? "selected" : ""}>PostNL</option>
              <option value="DHL" ${order.shipping_method === "DHL" ? "selected" : ""}>DHL</option>
            </select>
          </label>
          <label class="ht-phone-detail-field">
            <span>Trackingnummer</span>
            <input id="webshopTrackingNumber" type="text" maxlength="160" value="${esc(order.tracking_number || "")}" placeholder="Bijv. 3SABCD1234567">
          </label>
          <label class="ht-phone-detail-field ht-shipping-url-field">
            <span>Trackinglink <small>(optioneel)</small></span>
            <input id="webshopTrackingUrl" type="url" maxlength="1000" value="${esc(order.tracking_url || "")}" placeholder="https://...">
          </label>
        </div>

        <div class="ht-shipping-footer">
          <span class="ht-shipping-footer-note"><span aria-hidden="true">🔒</span> Gegevens worden veilig bij deze bestelling opgeslagen.</span>
          <button class="btn btn-primary ht-phone-shipping-save ht-shipping-save-button" type="button" onclick="saveWebshopOrderShipping(${Number(order.id)})">
            <span aria-hidden="true">✓</span> Verzendgegevens opslaan
          </button>
        </div>
      </div>
    </section>
  </div>
  <div class="ht-phone-detail-column ht-phone-detail-column-side">
    <section class="ht-phone-detail-card">
            <div class="ht-phone-detail-card-head"><span class="icon">▤</span>Overzicht bestelling</div>
            <div class="ht-phone-detail-card-body ht-phone-info-list">
              <div class="ht-phone-info-line"><span>Bestelnummer</span><strong>#${Number(order.id)}</strong></div>
              <div class="ht-phone-info-line"><span>Datum</span><strong>${esc(date)}</strong></div>
              <div class="ht-phone-info-line"><span>Status</span><strong><span class="ht-phone-detail-pill">${esc(status)}</span></strong></div>
              <div class="ht-phone-info-line"><span>Betaling</span><strong><span class="ht-phone-detail-pill ${phonePaymentTone}">${esc(paymentLabel)}</span></strong></div>
              <div class="ht-phone-info-line"><span>Verzending</span><strong><span class="ht-phone-detail-pill ${order.tracking_number?"is-shipped":""}">${esc(phoneShippingLabel)}</span></strong></div>
              ${order.inventory_error?'<div class="ht-phone-info-line"><span>Voorraadmelding</span><strong class="is-failed">'+esc(order.inventory_error)+'</strong></div>':""}
              <div class="ht-phone-detail-muted">${order.inventory_deducted_at?"Voorraad verwerkt op: "+esc(formatPhoneOrderDateTime(order.inventory_deducted_at).date):"Voorraad nog niet als verwerkt geregistreerd."}</div>
            </div>
          </section>
    <section class="ht-phone-detail-card">
            <div class="ht-phone-detail-card-head"><span class="icon">⌖</span>Verzendadres</div>
            <div class="ht-phone-detail-card-body ht-phone-address-card">
              <div class="ht-phone-address-recipient">
                <span class="ht-phone-address-symbol">♙</span>
                <div class="ht-phone-address-field">
                  <span class="ht-phone-address-field-label">Ontvanger</span>
                  <span class="ht-phone-address-field-value">${esc(order.name||"Naam niet opgegeven")}</span>
                </div>
              </div>
              <div class="ht-phone-address-lines">
                <div class="ht-phone-address-field">
                  <span class="ht-phone-address-field-label">Huisadres</span>
                  <span class="ht-phone-address-field-value">${esc(phoneStreetAddress||"Niet opgegeven")}</span>
                </div>
                <div class="ht-phone-address-field">
                  <span class="ht-phone-address-field-label">Postcode</span>
                  <span class="ht-phone-address-field-value">${esc(phonePostcode||"Niet opgegeven")}</span>
                </div>
                <div class="ht-phone-address-field">
                  <span class="ht-phone-address-field-label">Plaats</span>
                  <span class="ht-phone-address-field-value">${esc(phoneCity||"Niet opgegeven")}</span>
                </div>
                <div class="ht-phone-address-field">
                  <span class="ht-phone-address-field-label">Land</span>
                  <span class="ht-phone-address-field-value">${esc(phoneCountry||"Nederland")}</span>
                </div>
              </div>
              ${phoneStreetAddress||phonePostcodeCity?'<a class="btn btn-light ht-phone-map-link" target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(phoneFullAddress)+'">⌖ Adres op kaart openen</a>':""}
            </div>
          </section>
    <section class="ht-phone-detail-card">
            <div class="ht-phone-detail-card-head"><span class="icon">🛒</span>Besteloverzicht</div>
            <div class="ht-phone-detail-card-body">
              ${items.map(item=>'<div class="ht-phone-summary-line"><span>'+esc(item.name||item.title||item.product_name||"Product")+' × '+Number(item.qty||item.quantity||1)+'</span><strong>'+money(Number(item.unitPrice??item.unit_price??item.price??0)*Number(item.qty||item.quantity||1))+'</strong></div>').join("")}
              <div class="ht-phone-summary-line"><span>Subtotaal producten</span><strong>${money(subtotal)}</strong></div>
              ${Math.abs(subtotal-total)>0.009?'<div class="ht-phone-summary-line"><span>Overige kosten (niet uitgesplitst)</span><strong>'+money(total-subtotal)+'</strong></div>':""}
              <div class="ht-phone-summary-line ht-phone-summary-total"><span>Totaal</span><strong>${money(total)}</strong></div>
            </div>
          </section>
    <section class="ht-phone-detail-card">
            <div class="ht-phone-detail-card-head"><span class="icon">✓</span>Status bijwerken</div>
            <div class="ht-phone-detail-card-body ht-phone-info-list">
              <label class="ht-phone-detail-field">Nieuwe bestelstatus<select class="order-status-select" data-webshop-order-id="${Number(order.id)}" onchange="updateWebshopOrderStatus(${Number(order.id)},this.value,this)">${phoneStatusOptions}</select></label>
              <div class="ht-phone-detail-muted">Bij het wijzigen wordt de status automatisch opgeslagen en aan de tijdlijn toegevoegd.</div>
            </div>
          </section>
  </div>
</div>
<section class="ht-phone-detail-card" id="phoneOrderNoteCard" style="margin-bottom:12px">
          <div class="ht-phone-detail-card-head"><span class="icon">▤</span>Interne notities</div>
          <div class="ht-phone-detail-card-body">${phoneNotesMarkup}${phoneNoteForm}</div>
        </section>
<section class="ht-phone-detail-card" style="margin-bottom:12px">
          <div class="ht-phone-detail-card-head"><span class="icon">◷</span>Bestelstatus (log)</div>
          <div class="ht-phone-timeline">${timelineRows}</div>
        </section>${(Array.isArray(order.refunds)&&order.refunds.length)?'<section class="ht-phone-detail-card" style="margin-bottom:12px"><div class="ht-phone-detail-card-head"><span class="icon">↩</span>Terugbetalingen</div><div class="ht-phone-detail-card-body">'+order.refunds.map(refund=>{const stamp=refund.created_at?formatPhoneOrderDateTime(refund.created_at):null;const state=refund.status==="Processed"?"Terugbetaald":(refund.status==="Pending manual"?"Handmatig uit te voeren":(refund.status==="Processing"?"Wordt verwerkt":"Mislukt"));return '<div class="ht-phone-note-entry"><div class="ht-phone-note-meta">'+esc(state)+' · '+esc(refund.method||"")+' · '+esc(stamp?stamp.date+" "+stamp.time:"")+'</div><strong>'+money(refund.amount)+'</strong><p>'+esc(refund.reason||"")+'</p>'+(refund.status==="Pending manual"&&hasPermission("webshop_orders.update")?'<button type="button" class="btn btn-light" style="margin-top:7px" onclick="completeWebshopManualRefund('+Number(order.id)+','+Number(refund.id)+')">Handmatige terugbetaling bevestigen</button>':'')+'</div>';}).join("")+'</div></section>':""}<div class="ht-phone-detail-actions">${hasPermission("webshop_orders.update")?'<button class="btn btn-light" type="button" onclick="focusPhoneOrderNote()">Notitie</button>':""}${hasPermission("webshop_orders.delete")?'<button class="btn btn-red" type="button" onclick="deleteWebshopOrder('+Number(order.id)+')">🗑 Verwijderen</button>':""}<button class="btn btn-light" type="button" onclick="closeWebshopOrderDetails()">Sluiten</button><button class="btn btn-light" type="button" onclick="window.print()">Bestelling afdrukken</button></div>
      </div>`;

    const modal=document.createElement("div");
    modal.id="orderDetailsModal";
    const isPhoneOnlyOrder=hasPhoneItems&&!hasShopItems;
    modal.className="ht-order-detail-overlay"+(isPhoneOnlyOrder?" phone-order-detail-overlay":"");
    modal.innerHTML=isPhoneOnlyOrder?phoneDetailMarkup:`<div class="ht-order-detail-panel" role="dialog" aria-modal="true" aria-label="Bestelling #${Number(order.id)}">
      <div class="ht-order-detail-top"><div><div class="ht-order-eyebrow">HOMS TECH · ${orderCategory}</div><h2>Bestelling #${Number(order.id)}</h2><p>${esc(date)}</p></div><button type="button" class="btn btn-light" aria-label="Sluiten" onclick="closeWebshopOrderDetails()">✕</button></div>
      <section class="ht-order-detail-section ht-order-status-section"><div class="ht-order-section-heading"><span class="ht-order-section-icon">✓</span><strong>Status van de bestelling</strong></div><div class="ht-order-status-grid"><label>Status bestelling<select class="order-status-select" data-webshop-order-id="${Number(order.id)}" onchange="updateWebshopOrderStatus(${Number(order.id)},this.value)">${['Nieuw','In behandeling','Verzonden','Voltooid','Geannuleerd'].map(x=>`<option value="${esc(x)}" ${status===x?'selected':''}>${esc(x)}</option>`).join('')}</select></label><div><span>Betaalstatus</span><strong><span class="ht-order-payment-state ${paymentClass}">${esc(paymentLabel)}</span></strong></div></div></section>
      ${order.inventory_error?'<section class="ht-order-detail-section" style="border:1px solid #ef4444;background:#fff7f7"><div class="ht-order-section-heading"><span class="ht-order-section-icon">⚠</span><strong>Voorraadcontrole vereist</strong></div><p style="margin:8px 0 0;color:#991b1b;white-space:pre-wrap;overflow-wrap:anywhere">${esc(order.inventory_error)}</p></section>':''}
      <div class="ht-order-note" style="margin:8px 0 12px">${order.inventory_deducted_at?'Voorraad verwerkt op: '+esc(new Date(order.inventory_deducted_at).toLocaleString('nl-NL')):'Voorraad nog niet als verwerkt geregistreerd.'}</div>
      <section class="ht-order-total-banner"><div><span>Totaal van de bestelling</span><small>${items.length} product(en)</small></div><strong>${money(total)}</strong></section>
      <section class="ht-order-detail-section"><div class="ht-order-section-heading"><span class="ht-order-section-icon">▣</span><strong>Bestelde producten</strong><span class="ht-order-section-count">${items.reduce((sum,item)=>sum+Math.max(0,Number(item.qty||item.quantity||1)),0)} stuks</span></div><div class="ht-order-product-list">${itemRows}</div><div class="ht-order-totals"><div><span>Subtotaal producten</span><strong>${money(subtotal)}</strong></div>${Math.abs(subtotal-total)>0.009?`<div><span>Verschil / overige kosten (niet uitgesplitst)</span><strong>${money(total-subtotal)}</strong></div>`:""}<div class="ht-order-grand-total"><span>Totaal</span><strong>${money(total)}</strong></div></div></section>
      <section class="ht-order-detail-section"><div class="ht-order-section-heading"><span class="ht-order-section-icon">♙</span><strong>Klantgegevens</strong></div><div class="ht-order-customer-grid"><div><span>Naam</span><strong>${esc(order.name||"-")}</strong></div><div><span>E-mail</span><strong>${esc(order.email||"-")}</strong></div><div><span>Telefoon</span><strong>${esc(order.phone||"-")}</strong></div><div><span>Adres</span><strong>${esc(address.trim().replace(/^,\s*/,"")||"-")}</strong></div></div><div class="ht-order-contact-actions">${order.phone?`<a class="btn btn-light" href="tel:${esc(String(order.phone).replace(/[^+\d]/g,''))}">☎ Bellen</a>`:''}${order.email?`<a class="btn btn-light" href="mailto:${esc(order.email)}">✉ E-mail</a>`:''}${address.trim()?`<a class="btn btn-light" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}">⌖ Kaart openen</a>`:''}</div></section>
      <section class="ht-order-detail-section"><div class="ht-order-section-heading"><span class="ht-order-section-icon">▤</span><strong>Verzending en betaling</strong></div>
        <div class="ht-order-status-grid">
          <label>Verzendbedrijf<select id="webshopShippingCarrier"><option value="">Nog niet gekozen</option><option value="PostNL" ${order.shipping_method==="PostNL"?"selected":""}>PostNL</option><option value="DHL" ${order.shipping_method==="DHL"?"selected":""}>DHL</option></select></label>
          <label>Betaalstatus<select id="webshopPaymentStatus"><option value="Unpaid" ${/^(unpaid|open)$/i.test(payment)?"selected":""}>Niet betaald</option><option value="Processing" ${/^processing$/i.test(payment)?"selected":""}>In behandeling</option><option value="Paid" ${/^(paid|betaald|completed)$/i.test(payment)?"selected":""}>Betaald</option><option value="Failed" ${/^(failed|mislukt)$/i.test(payment)?"selected":""}>Mislukt</option></select></label>
        </div>
        <div class="ht-order-customer-grid" style="margin-top:12px">
          <label>Trackingnummer<input id="webshopTrackingNumber" type="text" maxlength="160" value="${esc(order.tracking_number||"")}" placeholder="Trackingnummer van de vervoerder"></label>
          <label>Tracking-URL<input id="webshopTrackingUrl" type="url" maxlength="1000" value="${esc(order.tracking_url||"")}" placeholder="https://..."></label>
        </div>
        <div class="ht-order-customer-grid" style="margin-top:12px">
          <div><span>Betaalmethode</span><strong>${esc(order.payment_method||"Niet geregistreerd")}</strong></div>
          <div><span>Betaalreferentie</span><strong>${esc(order.mollie_payment_id||order.paypal_order_id||"Niet beschikbaar")}</strong></div>
          <div><span>Vervoerder</span><strong>${esc(order.shipping_method||"Nog niet gekozen")}</strong></div>
          <div><span>Tracking</span><strong>${order.tracking_number?esc(order.tracking_number):"Nog niet beschikbaar"}${order.tracking_url?` · <a href="${esc(order.tracking_url)}" target="_blank" rel="noopener noreferrer">Volg zending</a>`:""}</strong></div>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn btn-primary" type="button" onclick="saveWebshopOrderShipping(${Number(order.id)})">Verzend- en betaalgegevens opslaan</button></div>
        <p class="ht-order-note">De vervoerder en trackinggegevens worden alleen opgeslagen; een echt verzendlabel wordt pas beschikbaar nadat de API-koppeling met de vervoerder is geïmplementeerd en getest.</p>
      </section>
      <div class="ht-order-detail-footer"><button class="btn btn-light" type="button" onclick="closeWebshopOrderDetails()">Sluiten</button><button class="btn btn-light" type="button" onclick="printWebshopShippingLabel(Number(order.id))">Verzendlabel afdrukken</button><button class="btn btn-dark" type="button" onclick="window.print()">Bestelling afdrukken</button></div>
    </div>`;
    // Phone-order details always use a true full-screen overlay on desktop and mobile.
    const useInlinePhoneDetails=false;
    const useMobilePhoneDetail=isPhoneOnlyOrder;
    // Rebuild phone-only order details into a dashboard layout:
    // product + status + quick actions, followed by focused information tabs.
    if(isPhoneOnlyOrder){
      const panel=modal.querySelector(".phone-order-detail-panel");
      const columns=panel?.querySelector(".ht-phone-detail-columns");
      if(panel&&columns){
        const cards=[...columns.querySelectorAll(".ht-phone-detail-card")];
        const cardByTitle=(pattern)=>cards.find(card=>pattern.test(card.querySelector(".ht-phone-detail-card-head")?.textContent||""))||null;
        const product=cardByTitle(/Besteld product/i);
        const customer=cardByTitle(/Klantgegevens/i);
        const payment=cardByTitle(/Betaalinformatie/i);
        const inspection=cardByTitle(/Controle\s*&\s*Verpakking/i);
        const shipping=cardByTitle(/Verzending/i);
        const orderSummary=cardByTitle(/Overzicht bestelling/i);
        const address=cardByTitle(/Verzendadres/i);
        const cart=cardByTitle(/Besteloverzicht/i);
        const statusEditor=cardByTitle(/Status bijwerken/i);
        const notes=panel.querySelector("#phoneOrderNoteCard");
        const noteCards=panel.querySelectorAll("#phoneOrderNoteCard, .ht-phone-detail-card");
        const log=[...noteCards].reverse().find(card=>card!==notes&&/Bestelstatus\s*\(log\)/i.test(card.querySelector(".ht-phone-detail-card-head")?.textContent||""))||null;
        const tradeIn=panel.querySelector(".ht-phone-inkoop-link");
        const top=document.createElement("div");
        top.className="ht-phone-dashboard-top";
        const statusCard=document.createElement("section");
        statusCard.className="ht-phone-dashboard-card ht-phone-dashboard-status";
        statusCard.innerHTML='<div class="ht-phone-dashboard-card-head"><span>▣</span> Bestelstatus</div><div class="ht-phone-dashboard-status-current"><strong>'+String(status||"Nieuw").replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]))+'</strong></div>';
        if(statusEditor)statusCard.append(statusEditor);
        const actions=document.createElement("section");
        actions.className="ht-phone-dashboard-card ht-phone-dashboard-actions";
        actions.innerHTML='<div class="ht-phone-dashboard-card-head"><span>⇄</span> Snelle acties</div><div class="ht-phone-dashboard-action-list"><button type="button" class="btn btn-light" data-phone-quick-action="label">♧ Verzendlabel (PostNL)</button><button type="button" class="btn btn-light" data-phone-quick-action="print">▤ Bestelling afdrukken</button></div>';
        actions.querySelector('[data-phone-quick-action="label"]').addEventListener("click",()=>printWebshopShippingLabel(Number(order.id)));
        actions.querySelector('[data-phone-quick-action="print"]').addEventListener("click",()=>window.print());
        if(product)top.append(product);
        top.append(statusCard,actions);
        columns.replaceWith(top);
        const nav=document.createElement("div");
        nav.className="ht-phone-dashboard-tabs";
        nav.setAttribute("role","tablist");
        nav.setAttribute("aria-label","Bestellingsonderdelen");
        const content=document.createElement("div");
        content.className="ht-phone-dashboard-tab-content";
        const tabSpecs=[
          {id:"overview",label:"Overzicht",icon:"▦",items:[orderSummary,inspection,cart]},
          {id:"customer",label:"Klantgegevens",icon:"♙",items:[customer,address]},
          {id:"payment",label:"Betaling",icon:"▤",items:[payment]},
          {id:"shipping",label:"Verzending",icon:"♧",items:[shipping]},
          {id:"tradein",label:"Oude telefoon (Inkoop)",icon:"⇄",items:[tradeIn]},
          {id:"notes",label:"Notities & Log",icon:"▤",items:[notes,log]}
        ].filter(tab=>tab.id!=="tradein"||tradeIn);
        tabSpecs.forEach((tab,index)=>{
          const button=document.createElement("button");
          button.type="button";button.className="ht-phone-dashboard-tab"+(index===0?" is-active":"");
          button.id="ht-phone-tab-"+tab.id;
          button.setAttribute("role","tab");button.setAttribute("aria-selected",index===0?"true":"false");
          button.setAttribute("aria-controls","ht-phone-panel-"+tab.id);button.tabIndex=index===0?0:-1;
          button.innerHTML='<span class="ht-phone-dashboard-tab-icon" aria-hidden="true">'+tab.icon+'</span><span>'+tab.label+'</span>';
          const pane=document.createElement("section");
          pane.className="ht-phone-dashboard-tab-panel"+(index===0?" is-active":"");
          pane.id="ht-phone-panel-"+tab.id;pane.setAttribute("role","tabpanel");pane.setAttribute("aria-labelledby",button.id);
          pane.hidden=index!==0;
          const grid=document.createElement("div");grid.className="ht-phone-dashboard-content-grid";
          tab.items.filter(Boolean).forEach(item=>grid.append(item));
          if(tab.id==="shipping"){
            pane.classList.add("ht-phone-dashboard-tab-panel-shipping");
            grid.classList.add("ht-phone-dashboard-content-grid-single");
            grid.style.display="grid";
            grid.style.gridTemplateColumns="minmax(0,1fr)";
            grid.style.width="100%";
            grid.style.maxWidth="none";
            grid.style.alignItems="start";
            grid.style.gap="0";
          }
          pane.append(grid);
          button.addEventListener("click",()=>{
            nav.querySelectorAll('[role="tab"]').forEach(el=>{const active=el===button;el.classList.toggle("is-active",active);el.setAttribute("aria-selected",active?"true":"false");el.tabIndex=active?0:-1;});
            content.querySelectorAll('[role="tabpanel"]').forEach(el=>{const active=el===pane;el.hidden=!active;el.classList.toggle("is-active",active);});
          });
          button.addEventListener("keydown",event=>{
            if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
            event.preventDefault();
            const buttons=[...nav.querySelectorAll('[role="tab"]')],current=buttons.indexOf(button);
            const next=event.key==="Home"?0:event.key==="End"?buttons.length-1:(current+(event.key==="ArrowRight"?1:-1)+buttons.length)%buttons.length;
            buttons[next]?.focus();buttons[next]?.click();
          });
          nav.append(button);content.append(pane);
        });
        panel.insertBefore(nav,panel.querySelector(".ht-phone-detail-actions"));
        panel.insertBefore(content,panel.querySelector(".ht-phone-detail-actions"));
      }
    }
    // Turn the phone-order information cards into compact native accordions.
    // Native <details>/<summary> preserves keyboard access and all existing form actions.
    if(isPhoneOnlyOrder){
      const accordionCards=Array.from(modal.querySelectorAll(".ht-phone-dashboard-tab-panel .ht-phone-detail-card"))
        .filter(card=>card.querySelector(":scope > .ht-phone-detail-card-head"));
      accordionCards.forEach((card,index)=>{
        const heading=card.querySelector(":scope > .ht-phone-detail-card-head");
        if(!heading)return;
        const title=heading.textContent.trim();
        const accordion=document.createElement("details");
        accordion.className=card.className+" ht-phone-detail-accordion";
        if(card.id)accordion.id=card.id;
        accordion.open=true;
        const summary=document.createElement("summary");
        summary.className="ht-phone-detail-card-head";
        while(heading.firstChild)summary.append(heading.firstChild);
        const body=document.createElement("div");
        body.className="ht-phone-detail-card-body";
        while(card.firstChild){
          const child=card.firstChild;
          if(child===heading){child.remove();continue;}
          body.append(child);
        }
        accordion.append(summary,body);
        card.replaceWith(accordion);
      });
    }
    const detailHost=document.getElementById("phoneOrderDetailHost");
    if(useInlinePhoneDetails&&detailHost){
      detailHost.replaceChildren(modal);
      document.querySelector("#page-phone-orders .ht-phone-orders-workspace")?.classList.add("has-selection");
      modal.classList.add("ht-phone-inline-detail","phone-order-detail-overlay");
      modal.querySelector(".ht-order-detail-panel")?.classList.add("phone-order-detail-panel");
      document.querySelectorAll("#phoneOrdersList .ht-phone-sale-row").forEach(row=>{
        row.classList.toggle("is-selected",row.dataset.orderId===String(order.id));
      });
    }else{
      if(useMobilePhoneDetail)modal.classList.add("ht-phone-mobile-detail");
      document.body.appendChild(modal);
    }
    // Fetch the catalog in the background and fill the product image only
    // when the order snapshot did not store one. The detail panel is already open.
    if(isPhoneOnlyOrder&&!firstPhoneImages.length){
      const visual=modal.querySelector(".ht-phone-product-visual");
      if(visual){
        (async()=>{
          try{
            if(!window.__homsPhoneOrderCatalogPromise){
              window.__homsPhoneOrderCatalogPromise=fetch("/api/site",{credentials:"same-origin",cache:"no-store"})
                .then(response=>{if(!response.ok)throw new Error("Catalogus niet beschikbaar");return response.json();})
                .catch(error=>{window.__homsPhoneOrderCatalogPromise=null;throw error;});
            }
            const catalog=await window.__homsPhoneOrderCatalogPromise;
            const item=firstPhoneItem;
            let product=null;
            if(String(item?.type||"").toLowerCase()==="shop"){
              const products=Array.isArray(catalog.shopProducts)?catalog.shopProducts:[];
              product=products.find(value=>String(value?.id??"")===String(item?.id??""));
              if(!product&&Number.isInteger(Number(item?.id)))product=products[Number(item.id)]||null;
            }else{
              const products=Array.isArray(catalog.phones)&&catalog.phones.length?catalog.phones:
                (Array.isArray(catalog.devices)?catalog.devices:[]);
              const productIndex=Number(item?.id);
              if(Number.isInteger(productIndex)&&productIndex>=0)product=products.find(value=>Number(value?._index)===productIndex)||products[productIndex]||null;
              if(!product)product=products.find(value=>String(value?.name||"").trim().toLowerCase()===String(item?.name||item?.title||"").trim().toLowerCase())||null;
            }
            if(!product)return;
            const selectedColor=String(firstPhoneOptions.color||firstPhoneOptions.colour||item?.color||item?.colour||"").trim();
            const colorKey=Object.keys(product.colorGalleryImages||{}).find(key=>key.toLowerCase()===selectedColor.toLowerCase());
            const colorImageKey=Object.keys(product.colorImages||{}).find(key=>key.toLowerCase()===selectedColor.toLowerCase());
            const colorOption=Array.isArray(product.colorOptions)?product.colorOptions.find(option=>String(option?.label||"").toLowerCase()===selectedColor.toLowerCase()):null;
            const candidates=[
              colorKey?product.colorGalleryImages[colorKey]?.[0]:null,
              colorImageKey?product.colorImages[colorImageKey]:null,
              colorOption?.image,
              product.image,
              product.imageUrl,
              product.thumbnail,
              ...(Array.isArray(product.images)?product.images.map(value=>typeof value==="string"?value:value?.url||value?.image):[])
            ];
            const imageUrl=candidates.find(value=>typeof value==="string"&&value.trim());
            if(!imageUrl||!visual.isConnected)return;
            const image=document.createElement("img");
            image.className="ht-phone-product-main-image";
            image.alt=firstPhoneName;
            image.loading="eager";
            image.src=imageUrl;
            image.onerror=()=>{image.remove();};
            visual.replaceChildren(image);
          }catch(error){
            console.warn("[HOMS TECH] Deferred product photo lookup failed:",error);
          }
        })();
      }
    }
    modal.addEventListener("click",event=>{
      if(event.target===modal){
        if(modal.classList.contains("ht-phone-inline-detail"))closeWebshopOrderDetails();
        else modal.remove();
      }
    });
  }catch(e){alert(e.message);}
}

async function deleteRepairRequest(id){
  if(!hasPermission("orders.delete")) return;
  if(!confirm("Reparatieaanvraag #"+id+" echt verwijderen? Dit kan niet ongedaan worden.")) return;
  try{
    const r=await fetch("/api/admin/orders/"+encodeURIComponent(id),{
      method:"DELETE",
      credentials:"same-origin"
    });
    const result=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(result.error||"Order kon niet worden verwijderd.");
    await loadOrders();
    if(currentPage==="search") await adminSearch();
  }catch(e){ alert(e.message); }
}

function focusPhoneOrderNote(){
  const card=document.getElementById("phoneOrderNoteCard");
  const field=document.getElementById("webshopOrderNote");
  card?.scrollIntoView({behavior:"smooth",block:"center"});
  field?.focus();
}

async function saveWebshopOrderNote(id){
  if(!hasPermission("webshop_orders.update"))return;
  const field=document.getElementById("webshopOrderNote");
  const note=String(field?.value||"").trim();
  if(!note){alert("Vul eerst een notitie in.");field?.focus();return;}
  if(note.length>2000){alert("Een notitie mag maximaal 2000 tekens bevatten.");return;}
  try{
    const response=await fetch("/api/admin/webshop-orders/"+encodeURIComponent(id)+"/notes",{
      method:"POST",credentials:"same-origin",
      headers:{"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify({note})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Notitie kon niet worden opgeslagen.");
    await showWebshopOrderDetails(id);
    setStatus("✓ Notitie opgeslagen bij bestelling #"+id,"success");
  }catch(error){alert(error.message);}
}

async function saveWebshopTradeInInspection(id){
  if(!hasPermission("webshop_orders.update"))return;
  const value=Number(document.getElementById("webshopTradeInInspectedValue")?.value);
  const reason=String(document.getElementById("webshopTradeInInspectionReason")?.value||"").trim();
  if(!Number.isFinite(value)||value<0){alert("Vul een geldige definitieve inruilwaarde in.");return;}
  if(reason.length<5){alert("Geef een korte inspectienotitie van minimaal 5 tekens.");return;}
  try{
    const response=await fetch("/api/admin/webshop-orders/"+encodeURIComponent(id)+"/trade-in-inspection",{
      method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify({inspectedValue:value,reason})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Inruilinspectie kon niet worden opgeslagen.");
    await loadWebshopOrders();
    await showWebshopOrderDetails(id);
    if(result.customerOffer?.sent)alert("Het voorstel van "+money(value)+" is per e-mail naar de klant verzonden. Wacht op akkoord voordat je uitbetaalt.");
    else alert("De inspectie is opgeslagen, maar de e-mail naar de klant is niet verzonden. Controleer Resend en gebruik daarna 'Stuur voorstel naar klant'.");
  }catch(error){alert(error.message);}
}

async function sendWebshopTradeInOffer(id){
  if(!hasPermission("webshop_orders.update"))return;
  if(!confirm("Wil je de definitieve inruilwaarde per e-mail naar de klant sturen met opties voor akkoord of niet akkoord?"))return;
  try{
    const response=await fetch("/api/admin/webshop-orders/"+encodeURIComponent(id)+"/trade-in-offer",{
      method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json","Accept":"application/json"},body:"{}"
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Het voorstel kon niet worden verzonden.");
    await loadWebshopOrders();
    await showWebshopOrderDetails(id);
    setStatus("✓ Inruilvoorstel verzonden naar "+(result.customerEmail||"de klant"),"success");
  }catch(error){alert(error.message);}
}

async function sendWebshopTradeInPayoutEmail(id){
  if(!hasPermission("webshop_orders.update"))return;
  if(!confirm("Wil je de bevestiging van de overgemaakte inruilwaarde opnieuw naar de klant sturen?"))return;
  try{
    const response=await fetch("/api/admin/webshop-orders/"+encodeURIComponent(id)+"/trade-in-settlement-email",{
      method:"POST",credentials:"same-origin",headers:{"Accept":"application/json"}
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"De bevestigingsmail kon niet worden verzonden.");
    await loadWebshopOrders();
    await showWebshopOrderDetails(id);
    setStatus("✓ Bevestigingsmail verzonden naar "+(result.payoutEmail?.email||"de klant"),"success");
  }catch(error){alert(error.message);}
}

async function settleWebshopTradeIn(id){
  if(!hasPermission("webshop_orders.update"))return;
  const note=String(document.getElementById("webshopTradeInSettlementNote")?.value||"").trim();
  if(note.length<5){alert("Vermeld eerst wanneer en hoe de definitieve inruilwaarde aan de klant is overgemaakt.");return;}
  if(!confirm("Bevestig je dat de definitieve inruilwaarde daadwerkelijk aan de klant is overgemaakt?"))return;
  try{
    const response=await fetch("/api/admin/webshop-orders/"+encodeURIComponent(id)+"/trade-in-settlement",{
      method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify({settlementNote:note})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Verrekening kon niet worden opgeslagen.");
    await loadWebshopOrders();
    await showWebshopOrderDetails(id);
    if(result.payoutEmail?.sent){
      alert("De uitbetaling is geregistreerd en de bevestigingsmail is verzonden naar de klant.");
    }else{
      alert("De uitbetaling is geregistreerd, maar de e-mail kon niet worden verzonden. Je kunt de bevestigingsmail opnieuw versturen vanuit de inruilkaart.");
    }
    setStatus("✓ Inruiluitbetaling geregistreerd bij bestelling #"+id,"success");
  }catch(error){alert(error.message);}
}

async function saveWebshopOrderPayment(id){
  if(!hasPermission("webshop_orders.update")){alert("Je hebt geen toestemming om deze bestelling te wijzigen.");return;}
  const select=document.getElementById("webshopPaymentStatus");
  const button=document.querySelector("#orderDetailsModal .ht-phone-payment-save");
  const paymentStatus=select?.value||"Unpaid";
  if(button){button.disabled=true;button.textContent="Opslaan...";}
  try{
    const response=await fetch("/api/admin/webshop-orders/"+encodeURIComponent(id)+"/payment",{
      method:"PUT",credentials:"same-origin",
      headers:{"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify({payment_status:paymentStatus})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Betaalstatus kon niet worden opgeslagen.");
    await loadWebshopOrders();
    await showWebshopOrderDetails(id);
    if(result.inventory_warning){
      setStatus("✓ Betaalstatus opgeslagen als Betaald. Voorraadcontrole vereist: "+result.inventory_warning,"error");
      alert("De betaalstatus is opgeslagen als Betaald, maar de voorraad kon niet automatisch worden verwerkt. Controleer de voorraadmelding bij deze bestelling.\n\n"+result.inventory_warning);
    }else{
      setStatus("✓ Betaalstatus opgeslagen voor bestelling #"+id,"success");
    }
  }catch(error){
    setStatus("✕ "+error.message,"error");
    alert(error.message);
    if(button){button.disabled=false;button.textContent="💾 Betaalstatus opslaan";}
  }
}

async function saveWebshopOrderShipping(id){
  if(!hasPermission("webshop_orders.update")){alert("Je hebt geen toestemming om deze bestelling te wijzigen.");return;}
  const carrier=document.getElementById("webshopShippingCarrier")?.value||"";
  const paymentStatus=document.getElementById("webshopPaymentStatus")?.value||"Unpaid";
  const trackingNumber=(document.getElementById("webshopTrackingNumber")?.value||"").trim();
  const trackingUrl=(document.getElementById("webshopTrackingUrl")?.value||"").trim();
  if(carrier&&!["PostNL","DHL"].includes(carrier)){alert("Kies PostNL of DHL.");return;}
  if(trackingUrl&&!trackingUrl.startsWith("https://")){alert("De tracking-URL moet beginnen met https://");return;}
  try{
    const response=await fetch("/api/admin/webshop-orders/"+encodeURIComponent(id)+"/shipping",{
      method:"PUT",credentials:"same-origin",
      headers:{"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify({shipping_method:carrier,payment_status:paymentStatus,tracking_number:trackingNumber,tracking_url:trackingUrl})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Gegevens konden niet worden opgeslagen.");
    await loadWebshopOrders();
    showWebshopOrderDetails(id);
    setStatus("✓ Verzend- en betaalgegevens opgeslagen voor bestelling #"+id,"success");
  }catch(error){alert(error.message);}
}

async function deleteWebshopOrder(id){
  const orderId=Number(id);
  if(!hasPermission("webshop_orders.delete"))return;
  if(!Number.isInteger(orderId)||orderId<1){alert("Ongeldig bestelnummer.");return;}
  if(deletingWebshopOrderIds.has(orderId))return;
  if(!confirm("Webshop bestelling #"+orderId+" echt verwijderen? Dit kan niet ongedaan worden."))return;
  deletingWebshopOrderIds.add(orderId);
  try{
    const response=await fetch("/api/admin/webshop-orders/"+encodeURIComponent(orderId),{method:"DELETE",credentials:"same-origin"});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Bestelling kon niet worden verwijderd.");
    closeWebshopOrderDetails();
    await loadWebshopOrders();
    if(currentPage==="search")await adminSearch();
  }catch(error){alert(error.message);}
  finally{deletingWebshopOrderIds.delete(orderId);}
}
/* ---------------- HELPERS ---------------- */

// =====================================================
// BUYBACK ORDERS ADMIN
// =====================================================
let buybackOrdersCache = [];
let selectedBuybackOrderId = null;

function buybackMoney(value){
  if(value===null||value===undefined||value==="")return "—";
  return "€ "+Number(value).toLocaleString("nl-NL",{minimumFractionDigits:2,maximumFractionDigits:2});
}
function buybackDate(value){
  if(!value)return "—";
  const date=new Date(value);
  return Number.isNaN(date.getTime())?"—":date.toLocaleString("nl-NL");
}
function buybackStatusClass(status){
  if(status==="Klant akkoord"||status==="Voltooid")return "is-ok";
  if(status==="Klant niet akkoord")return "is-no";
  if(["Aanbod klaar","Aanbod verzonden","In behandeling"].includes(status))return "is-wait";
  return "";
}
async function loadBuybackOrders(){
  if(!hasPermission("buyback_orders.view"))return;
  const list=document.getElementById("buybackOrdersList");
  const status=document.getElementById("buybackOrdersStatus");
  const detail=document.getElementById("buybackOrdersDetail");
  if(!list)return;
  list.innerHTML='<div style="padding:25px;text-align:center">Laden...</div>';
  if(detail){detail.hidden=true;detail.innerHTML="";}
  document.body.style.overflow=document.body.dataset.htPreviousOverflow||"";
  delete document.body.dataset.htPreviousOverflow;
  selectedBuybackOrderId=null;
  try{
    const response=await fetch("/api/admin/buyback-orders",{credentials:"same-origin",headers:{"Accept":"application/json"}});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Inkoopaanvragen konden niet worden geladen.");
    buybackOrdersCache=Array.isArray(result.orders)?result.orders:[];
    const filter=document.getElementById("buybackTypeFilter")?.value||"all";
    const visibleOrders=buybackOrdersCache.filter(order=>filter==="all"||(filter==="sale"?!order.trade_in:!!order.trade_in));
    status.textContent=visibleOrders.length+" inkoopaanvragen gevonden.";
    if(!visibleOrders.length){
      list.innerHTML='<div style="background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:32px;text-align:center;color:#64748b">Geen aanvragen gevonden voor dit filter.</div>';
      return;
    }
    list.innerHTML='<div class="ht-inkoop-list">'+visibleOrders.map(function(order){
      const id=Number(order.id);
      const price=buybackMoney(order.sale_inspected_value??order.offered_price);
      const statusText=String(order.status||"Nieuw");
      return '<div class="ht-inkoop-row-wrap">'+
        '<button type="button" class="ht-inkoop-row" onclick="showBuybackDetails('+id+')">'+
        '<span class="ht-inkoop-main"><span class="ht-inkoop-main-top">'+
        '<span class="ht-inkoop-number">#'+esc(order.order_no||id)+'</span>'+
        '<strong>'+esc(order.name||"Klant onbekend")+' · '+esc(order.device||"Telefoon")+'</strong></span>'+
        '<small>'+esc(order.email||"Geen e-mail")+' · '+esc(buybackDate(order.created_at))+'</small>'+
        '<span class="ht-inkoop-type '+(order.trade_in?'is-tradein':'is-sale')+'">'+(order.trade_in?'♻ Inruil':'Verkoop')+'</span>'+
        '<span class="ht-inkoop-chip '+buybackStatusClass(statusText)+'">'+esc(statusText)+'</span></span>'+
        '<strong class="ht-inkoop-price">'+price+'</strong><span aria-hidden="true">›</span></button>'+
        (!order.trade_in&&hasPermission("buyback_orders.delete")?'<button type="button" class="btn btn-red ht-inkoop-row-delete" title="Aanvraag #'+id+' verwijderen" aria-label="Aanvraag #'+id+' verwijderen" onclick="deleteBuybackOrder('+id+')">🗑</button>':'')+
        '</div>';
    }).join("")+'</div>';
  }catch(error){
    status.textContent="";
    list.innerHTML='<div style="background:#fef2f2;color:#991b1b;padding:18px;border-radius:12px">'+esc(error.message)+'</div>';
  }
}

function buybackFact(label,value){
  if(value===undefined||value===null||String(value).trim()==="")return "";
  return '<div class="ht-inkoop-fact"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>';
}
function buybackAnswerMarkup(answers){
  if(!answers||typeof answers!=="object"||Array.isArray(answers))return "";
  const entries=Object.entries(answers).map(function(pair){
    const key=pair[0],raw=pair[1],item=raw&&typeof raw==="object"&&!Array.isArray(raw)?raw:{value:raw};
    const value=item.value??raw;
    if(value===undefined||value===null||String(value).trim()==="")return "";
    let label=String(item.question||key.replace(/[_-]+/g," ")).trim();
    const answer=Array.isArray(value)?value.join(", "):(typeof value==="object"?JSON.stringify(value):String(value));
    // Keep the exact customer-facing battery question in the admin answer list.
    if(/battery|batterij/i.test(key)||/batterijconditie/i.test(label)){
      label="Is de batterijcapaciteit minimaal 85%?";
    }
    if(!label||!String(answer).trim())return "";
    return '<div class="ht-inkoop-answer"><span>'+esc(label)+'</span><strong>'+esc(answer)+'</strong></div>';
  }).filter(Boolean);
  return entries.length
    ?'<section class="ht-inkoop-card ht-inkoop-answers-card"><div class="ht-inkoop-card-head">✓ Antwoorden van de klant</div><div class="ht-inkoop-card-body"><div class="ht-inkoop-answers">'+entries.join("")+'</div></div></section>'
    :"";
}
function showBuybackDetails(id){
  const order=buybackOrdersCache.find(function(item){return Number(item.id)===Number(id);});
  const host=document.getElementById("buybackOrdersDetail");
  if(!order||!host)return;
  selectedBuybackOrderId=Number(id);
  host.hidden=false;
  document.body.dataset.htPreviousOverflow=document.body.style.overflow||"";
  document.body.style.overflow="hidden";
  const status=String(order.status||"Nieuw");
  const isTradeIn=!!order.trade_in;
  const inspected=order.sale_inspected_value!==null&&order.sale_inspected_value!==undefined;
  const answers=buybackAnswerMarkup(order.answers);
  const phoneDigits=String(order.phone||"").replace(/[^\d+]/g,"");
  const phoneLink=phoneDigits?'<a href="tel:'+esc(phoneDigits)+'">'+esc(order.phone)+'</a>':esc(order.phone||"Niet opgegeven");
  const emailLink=order.email?'<a href="mailto:'+esc(order.email)+'">'+esc(order.email)+'</a>':"Niet opgegeven";
  let workflow="";
  if(isTradeIn){
    const linkedId=Number(order.linked_webshop_order_id||0);
    const paid=/^(paid|betaald|completed)$/i.test(String(order.linked_webshop_payment_status||""));
    const tradeStatus=String(order.linked_trade_in_status||"AwaitingPayment");
    const tradeInspected=order.linked_trade_in_inspected_value!==null&&order.linked_trade_in_inspected_value!==undefined;
    const snapshot=order.linked_trade_in_snapshot&&typeof order.linked_trade_in_snapshot==="object"?order.linked_trade_in_snapshot:{};
    if(!paid){
      workflow='<div class="ht-inkoop-notice is-warn"><strong>Wacht op betaling van de nieuwe telefoon.</strong><br>De inspectie van het oude toestel start zodra de betaling van de nieuwe telefoon is bevestigd.</div>';
    }else if(!tradeInspected){
      workflow='<div class="ht-inkoop-notice"><strong>Volgende stap: inspecteer de oude telefoon.</strong><br>Vul de definitieve inruilwaarde pas in nadat het toestel is ontvangen en getest.</div>'+
        '<div class="ht-inkoop-form"><label>Definitieve inruilwaarde (€)<input id="buybackTradeInInspectedValue" type="number" min="0" max="100000" step="0.01" value="'+esc(order.linked_trade_in_estimated_value??order.offered_price??"")+'"></label>'+
        '<label>Inspectienotitie<textarea id="buybackTradeInInspectionReason" rows="3" maxlength="1000" placeholder="Beschrijf de staat, schade en testresultaten..."></textarea></label>'+
        '<button class="btn btn-green" type="button" onclick="saveBuybackTradeInInspection('+Number(order.id)+','+linkedId+')">✓ Inspectie opslaan en voorstel versturen</button></div>';
    }else if(tradeStatus==="AdjustmentRequired"){
      workflow='<div class="ht-inkoop-notice is-warn"><strong>Inspectie opgeslagen.</strong><br>Definitieve waarde: '+buybackMoney(order.linked_trade_in_inspected_value)+'. Stuur het voorstel naar de klant voor akkoord.</div>'+
        '<button class="btn btn-primary" type="button" onclick="sendBuybackTradeInOffer('+Number(order.id)+','+linkedId+')">✉ Stuur definitief voorstel naar klant</button>';
    }else if(tradeStatus==="AwaitingCustomerApproval"){
      workflow='<div class="ht-inkoop-notice is-warn"><strong>Voorstel verzonden – wacht op klantakkoord.</strong><br>Definitieve waarde: '+buybackMoney(order.linked_trade_in_inspected_value)+'. Er mag nog niets worden uitbetaald.</div>';
    }else if(tradeStatus==="CustomerRejected"){
      workflow='<div class="ht-inkoop-notice is-warn"><strong>Klant is niet akkoord gegaan.</strong><br>Maak geen bedrag over. Neem contact op met de klant om de retourzending of vervolgstap af te spreken.</div>';
    }else if(tradeStatus==="CustomerAccepted"){
      workflow='<div class="ht-inkoop-notice is-good"><strong>Klant heeft akkoord gegeven.</strong><br>Maak '+buybackMoney(order.linked_trade_in_inspected_value)+' over naar de IBAN hieronder. Bevestig pas nadat de overschrijving echt is uitgevoerd.</div>'+
        '<div class="ht-inkoop-form"><label>Betalingskenmerk / toelichting<textarea id="buybackTradeInSettlementNote" rows="3" maxlength="1000" placeholder="Bedrag en datum van de bankoverschrijving..."></textarea></label>'+
        '<button class="btn btn-green" type="button" onclick="settleBuybackTradeIn('+Number(order.id)+','+linkedId+')">✓ Uitbetaling bevestigen</button></div>';
    }else if(tradeStatus==="Settled"){
      workflow='<div class="ht-inkoop-notice is-good"><strong>✓ Inruil afgerond.</strong><br>Uitbetaald bedrag: '+buybackMoney(order.linked_trade_in_inspected_value)+'.</div>'+
        (snapshot.payoutConfirmationEmailSentAt?'<small class="ht-postnl-sent">✓ Bevestigingsmail verzonden</small>':'<button class="btn btn-primary" type="button" onclick="sendBuybackTradeInPayoutEmail('+Number(order.id)+','+linkedId+')">✉ Bevestigingsmail verzenden</button>')+
        (snapshot.settlementNote?'<div class="ht-inkoop-notice">Betalingsnotitie: '+esc(snapshot.settlementNote)+'</div>':"");
    }else{
      workflow='<div class="ht-inkoop-notice">Inruilstatus: '+esc(tradeStatus)+'. Controleer de gekoppelde telefoonbestelling voor aanvullende informatie.</div>';
    }
  }else if(status==="Nieuw"||status==="In behandeling"||status==="Aanbod klaar"){
    workflow='<div class="ht-inkoop-notice"><strong>Volgende stap: inspecteer de ontvangen telefoon.</strong><br>Vul de definitieve waarde in na controle van het toestel. Na opslaan verstuurt HOMS TECH automatisch het prijsvoorstel naar de klant.</div>'+
      '<div class="ht-inkoop-form"><label>Definitieve inkoopwaarde (€)<input id="buybackInspectedValue" type="number" min="0" max="100000" step="0.01" value="'+(inspected?esc(order.sale_inspected_value):esc(order.offered_price||""))+'"></label>'+
      '<label>Inspectienotitie<textarea id="buybackInspectionReason" rows="3" maxlength="1000" placeholder="Beschrijf de staat, schade en testresultaten...">'+esc(order.sale_inspection_reason||"")+'</textarea></label>'+
      '<div class="ht-inkoop-actions"><button class="btn btn-green" type="button" onclick="saveBuybackInspection('+Number(order.id)+')">✓ Inspectie opslaan en voorstel versturen</button>'+
      (status==="Aanbod klaar"&&inspected?'<button class="btn btn-light" type="button" onclick="sendBuybackOffer('+Number(order.id)+')">✉ Voorstel opnieuw versturen</button>':"")+'</div></div>';
  }else if(status==="Aanbod verzonden"){
    workflow='<div class="ht-inkoop-notice is-warn"><strong>✉ Prijsvoorstel verzonden.</strong><br>De klant heeft een e-mail ontvangen met de definitieve waarde van '+buybackMoney(order.sale_inspected_value)+' en kan akkoord of niet akkoord kiezen. Wacht op de reactie voordat je betaalt.'+
      (order.sale_approval_expires_at?'<br><small>Link geldig tot: '+esc(buybackDate(order.sale_approval_expires_at))+'</small>':"")+'</div>'+
      '<button class="btn btn-light" type="button" onclick="sendBuybackOffer('+Number(order.id)+')">✉ Stuur voorstel opnieuw</button>';
  }else if(status==="Klant akkoord"){
    workflow='<div class="ht-inkoop-notice is-good"><strong>✓ Klant heeft akkoord gegeven.</strong><br>Maak nu '+buybackMoney(order.sale_inspected_value)+' over naar de IBAN van de klant. Bevestig de uitbetaling pas nadat de overschrijving daadwerkelijk is uitgevoerd.</div>'+
      '<div class="ht-inkoop-total"><span>Uit te betalen aan klant</span><strong>'+buybackMoney(order.sale_inspected_value)+'</strong></div>'+
      '<div class="ht-inkoop-form"><label>Betalingskenmerk / toelichting<textarea id="buybackSettlementNote" rows="3" maxlength="1000" placeholder="Bijvoorbeeld: € '+esc(Number(order.sale_inspected_value).toFixed(2))+' overgemaakt op datum ... via bankoverschrijving."></textarea></label>'+
      '<button class="btn btn-green" type="button" onclick="settleBuybackOrder('+Number(order.id)+')">✓ Afhandeling bevestigen</button></div>';
  }else if(status==="Klant niet akkoord"){
    workflow='<div class="ht-inkoop-notice is-warn"><strong>✕ Klant is niet akkoord gegaan.</strong><br>Er mag geen bedrag worden overgemaakt. Neem contact op met de klant en spreek af hoe het toestel wordt teruggestuurd of wat de vervolgstap is.</div>';
  }else if(status==="Voltooid"){
    workflow=order.sale_payout_email_sent_at?
      '<div class="ht-inkoop-notice is-good"><strong>✓ Verkoop afgerond en bevestigingsmail verzonden.</strong><br>De klant heeft een e-mail ontvangen dat '+buybackMoney(order.sale_inspected_value)+' is overgemaakt.</div>':
      '<div class="ht-inkoop-notice is-warn"><strong>Uitbetaling geregistreerd – e-mail nog niet bevestigd.</strong><br>Verstuur de bevestiging opnieuw naar de klant.</div><button class="btn btn-primary" type="button" onclick="sendBuybackPayoutEmail('+Number(order.id)+')">✉ Bevestigingsmail verzenden</button>';
    workflow+='<div class="ht-inkoop-total"><span>Uitbetaald bedrag</span><strong>'+buybackMoney(order.sale_inspected_value)+'</strong></div>'+
      '<div class="ht-inkoop-notice">Betalingsnotitie: '+esc(order.sale_settlement_note||"—")+'</div>';
  }
  const canDelete=!isTradeIn&&hasPermission("buyback_orders.delete");
  host.innerHTML='<section class="ht-inkoop-detail">'+
    '<div class="ht-inkoop-detail-head"><div><small>HOMS TECH · INKOOP / '+(isTradeIn?'INRUIL':'VERKOOP')+'</small><h3>Aanvraag '+esc(order.order_no||("#"+order.id))+'</h3></div><div class="ht-inkoop-actions"><span class="ht-inkoop-chip '+buybackStatusClass(status)+'">'+esc(status)+'</span><button type="button" class="btn btn-light" onclick="closeBuybackDetails()">✕ Sluiten</button></div></div>'+
    '<div class="ht-inkoop-columns"><div class="ht-inkoop-main-stack">'+
      '<section class="ht-inkoop-card"><div class="ht-inkoop-card-head">📱 Telefoon die de klant wil verkopen</div><div class="ht-inkoop-card-body">'+
        '<div class="ht-inkoop-device"><div class="ht-inkoop-device-icon">📱</div><div><strong>'+esc(order.device||order.model||"Telefoon onbekend")+'</strong><small>'+esc(order.brand||"Merk onbekend")+(order.storage?" · "+esc(order.storage):"")+'</small><small>Aanvraag ontvangen: '+esc(buybackDate(order.created_at))+'</small></div></div>'+
        '<div class="ht-inkoop-facts">'+buybackFact("Opslag",order.storage)+buybackFact("Conditie",order.condition)+buybackFact("Geschatte waarde",buybackMoney(order.offered_price))+
        (inspected?buybackFact("Definitieve waarde",buybackMoney(order.sale_inspected_value)):"")+'</div>'+
      '</div></section>'+
      answers+
      (isTradeIn?'<section class="ht-inkoop-card ht-linked-order-card"><div class="ht-inkoop-card-head">♻ Gekoppelde telefoonbestelling</div><div class="ht-inkoop-card-body"><div class="ht-inkoop-info"><div><span>Telefoonbestelling</span><strong>#'+esc(order.linked_webshop_order_no||order.linked_webshop_order_id||"—")+'</strong></div><div><span>Betaalstatus nieuwe telefoon</span><strong>'+esc(order.linked_webshop_payment_status||"—")+'</strong></div><div><span>Inruilstatus</span><strong>'+esc(order.linked_trade_in_status||"—")+'</strong></div></div><button class="btn btn-light" type="button" onclick="openLinkedTradeInOrder('+Number(order.linked_webshop_order_id||0)+')">Open gekoppelde telefoonbestelling</button></div></section>':"")+
      '<section class="ht-inkoop-card"><div class="ht-inkoop-card-head">♙ Klantgegevens</div><div class="ht-inkoop-card-body"><div class="ht-inkoop-info">'+
        '<div><span>Naam</span><strong>'+esc(order.name||"—")+'</strong></div><div><span>Telefoon</span><strong>'+phoneLink+'</strong></div><div><span>E-mail</span><strong>'+emailLink+'</strong></div>'+
        '<div><span>Adres</span><strong>'+esc(order.address||"—")+'</strong></div><div><span>Naam rekeninghouder</span><strong>'+esc(order.account_holder_name||"—")+'</strong></div><div><span>IBAN</span><strong>'+esc(order.iban||"—")+'</strong></div><div><span>Betaalmethode</span><strong>'+esc(order.payment_method||"Bankoverschrijving")+'</strong></div>'+
      '</div></div></section></div>'+
      '<div class="ht-inkoop-side-stack"><section class="ht-inkoop-card"><div class="ht-inkoop-card-head">✓ Afhandeling en betaling</div><div class="ht-inkoop-card-body"><div class="ht-inkoop-workflow">'+workflow+'</div></div></section>'+
      '<section class="ht-inkoop-card"><div class="ht-inkoop-card-head">Overzicht aanvraag</div><div class="ht-inkoop-card-body"><div class="ht-inkoop-info">'+
        '<div><span>Aanvraagnummer</span><strong>'+esc(order.order_no||("BT-"+order.id))+'</strong></div><div><span>Ontvangen op</span><strong>'+esc(buybackDate(order.created_at))+'</strong></div><div><span>Huidige status</span><strong>'+esc(status)+'</strong></div>'+
        (order.sale_inspection_reason?'<div><span>Inspectienotitie</span><strong>'+esc(order.sale_inspection_reason)+'</strong></div>':"")+
      '</div></div></section>'+
      '<section class="ht-inkoop-card ht-postnl-card"><div class="ht-inkoop-card-head">📦 PostNL-verzending</div><div class="ht-inkoop-card-body">'+
        (order.shipping_label_uploaded_at
          ? '<div class="ht-postnl-state is-ready">✓ Verzendlabel opgeslagen</div><a class="ht-postnl-file" href="/api/admin/buyback-orders/'+Number(order.id)+'/shipping-label" target="_blank" rel="noopener">📄 '+esc(order.shipping_label_filename||"PostNL-verzendlabel.pdf")+'</a>'
          : '<div class="ht-postnl-state">Upload hier het PDF-label dat je zelf bij PostNL hebt gekocht.</div>')+
        '<label class="ht-postnl-label">PostNL Track & Trace-nummer<input id="buybackPostnlTracking" type="text" maxlength="80" value="'+esc(order.postnl_tracking_number||"")+'" placeholder="Bijv. 3SABCD1234567"></label>'+
        '<label class="ht-postnl-label">Verzendlabel (PDF, maximaal 8 MB)<input id="buybackShippingLabelFile" type="file" accept=".pdf,application/pdf"></label>'+
        '<button class="btn btn-green" type="button" onclick="saveBuybackShippingLabel('+Number(order.id)+')">💾 Verzendlabel opslaan</button>'+
        (order.shipping_label_uploaded_at
          ? '<button class="btn btn-light" type="button" onclick="sendBuybackShippingLabelEmail('+Number(order.id)+')">✉ '+(order.shipping_label_email_sent_at?"Verzendlabel opnieuw e-mailen":"Verzendlabel naar klant e-mailen")+'</button>'
          : '')+
        (order.shipping_label_email_sent_at?'<small class="ht-postnl-sent">✓ E-mail verzonden op '+esc(buybackDate(order.shipping_label_email_sent_at))+'</small>':'')+
        '<p class="ht-postnl-help">Je koopt het label zelf in bij PostNL. HOMS TECH slaat het PDF-label veilig op en kan het als bijlage naar de klant versturen.</p>'+
      '</div></section></div></div>'+
    '<div class="ht-inkoop-detail-foot"><span class="ht-inkoop-foot-note">'+(isTradeIn?'Inruilaanvraag gekoppeld aan een telefoonbestelling.':'Zelfstandige verkoopaanvraag zonder nieuwe telefoonbestelling.')+'</span>'+
    (canDelete?'<button class="btn btn-red" type="button" onclick="deleteBuybackOrder('+Number(order.id)+')">Aanvraag verwijderen</button>':"")+'</div></section>';
  host.scrollTop=0;
}
function openLinkedBuybackOrder(buybackId){
  const id=Number(buybackId);
  if(!Number.isInteger(id)||id<1){alert("De gekoppelde inkoopaanvraag kon niet worden gevonden.");return;}
  showUnifiedOrderSection("buyback-orders",false);
  loadBuybackOrders().then(()=>showBuybackDetails(id));
}
function openLinkedTradeInOrder(orderId){
  const id=Number(orderId);
  if(!Number.isInteger(id)||id<1){alert("De gekoppelde telefoonbestelling kon niet worden gevonden.");return;}
  closeBuybackDetails();
  showUnifiedOrderSection("phone-orders",false);
  showWebshopOrderDetails(id);
}
function closeBuybackDetails(){
  const host=document.getElementById("buybackOrdersDetail");
  if(host){host.hidden=true;host.innerHTML="";}
  document.body.style.overflow=document.body.dataset.htPreviousOverflow||"";
  delete document.body.dataset.htPreviousOverflow;
  selectedBuybackOrderId=null;
}
document.addEventListener("keydown",function(event){
  if(event.key==="Escape"&&selectedBuybackOrderId!==null)closeBuybackDetails();
});

async function refreshBuybackOrderDetails(id){
  await loadBuybackOrders();
  showBuybackDetails(id);
}
async function saveBuybackInspection(id){
  if(!hasPermission("buyback_orders.update"))return;
  const inspectedValue=Number(document.getElementById("buybackInspectedValue")?.value);
  const reason=String(document.getElementById("buybackInspectionReason")?.value||"").trim();
  if(!Number.isFinite(inspectedValue)||inspectedValue<0){alert("Vul een geldige definitieve inkoopwaarde in.");return;}
  if(reason.length<5){alert("Geef een korte inspectienotitie van minimaal 5 tekens.");return;}
  if(!confirm("Inspectie opslaan en het definitieve prijsvoorstel per e-mail naar de klant versturen?"))return;
  try{
    const response=await fetch("/api/admin/buyback-orders/"+encodeURIComponent(id)+"/inspection",{method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({inspectedValue,reason})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Inspectie kon niet worden opgeslagen.");
    await refreshBuybackOrderDetails(id);
    if(result.customerOffer?.sent)alert("Het definitieve voorstel is per e-mail naar de klant verzonden. Wacht op akkoord voordat je uitbetaalt.");
    else alert("De inspectie is opgeslagen, maar de e-mail is niet verzonden. Controleer de e-mailinstellingen en gebruik daarna 'Voorstel opnieuw versturen'.");
  }catch(error){alert(error.message);}
}
async function sendBuybackOffer(id){
  if(!hasPermission("buyback_orders.update"))return;
  if(!confirm("Wil je het opgeslagen definitieve prijsvoorstel opnieuw per e-mail naar de klant sturen?"))return;
  try{
    const response=await fetch("/api/admin/buyback-orders/"+encodeURIComponent(id)+"/offer",{method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json","Accept":"application/json"},body:"{}"});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Het voorstel kon niet worden verzonden.");
    await refreshBuybackOrderDetails(id);
    alert("Het prijsvoorstel is per e-mail naar de klant verzonden.");
  }catch(error){alert(error.message);}
}
async function saveBuybackTradeInInspection(buybackId,webshopOrderId){
  if(!hasPermission("buyback_orders.update"))return;
  const inspectedValue=Number(document.getElementById("buybackTradeInInspectedValue")?.value);
  const reason=String(document.getElementById("buybackTradeInInspectionReason")?.value||"").trim();
  if(!Number.isFinite(inspectedValue)||inspectedValue<0){alert("Vul een geldige definitieve inruilwaarde in.");return;}
  if(reason.length<5){alert("Geef een korte inspectienotitie van minimaal 5 tekens.");return;}
  if(!confirm("Inspectie opslaan en het definitieve inruilvoorstel naar de klant versturen?"))return;
  try{
    const response=await fetch("/api/admin/webshop-orders/"+encodeURIComponent(webshopOrderId)+"/trade-in-inspection",{method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({inspectedValue,reason})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Inruilinspectie kon niet worden opgeslagen.");
    await refreshBuybackOrderDetails(buybackId);
    alert(result.customerOffer?.sent?"Het definitieve voorstel is naar de klant verzonden. Wacht op akkoord.":"Inspectie opgeslagen. De e-mail kon niet worden verzonden; probeer het voorstel later opnieuw.");
  }catch(error){alert(error.message);}
}
async function sendBuybackTradeInOffer(buybackId,webshopOrderId){
  if(!hasPermission("buyback_orders.update"))return;
  if(!confirm("Wil je het definitieve inruilvoorstel naar de klant sturen?"))return;
  try{
    const response=await fetch("/api/admin/webshop-orders/"+encodeURIComponent(webshopOrderId)+"/trade-in-offer",{method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json","Accept":"application/json"},body:"{}"});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Het voorstel kon niet worden verzonden.");
    await refreshBuybackOrderDetails(buybackId);
    alert("Het definitieve voorstel is naar de klant verzonden.");
  }catch(error){alert(error.message);}
}
async function settleBuybackTradeIn(buybackId,webshopOrderId){
  if(!hasPermission("buyback_orders.update"))return;
  const settlementNote=String(document.getElementById("buybackTradeInSettlementNote")?.value||"").trim();
  if(settlementNote.length<5){alert("Vermeld wanneer en hoe het bedrag is overgemaakt.");return;}
  if(!confirm("Bevestig je dat het definitieve inruilbedrag daadwerkelijk is overgemaakt?"))return;
  try{
    const response=await fetch("/api/admin/webshop-orders/"+encodeURIComponent(webshopOrderId)+"/trade-in-settlement",{method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({settlementNote})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"De uitbetaling kon niet worden geregistreerd.");
    await refreshBuybackOrderDetails(buybackId);
    alert(result.payoutEmail?.sent?"Uitbetaling geregistreerd en bevestigingsmail verzonden.":"Uitbetaling geregistreerd. De bevestigingsmail kon niet worden verzonden; je kunt deze opnieuw versturen.");
  }catch(error){alert(error.message);}
}
async function sendBuybackTradeInPayoutEmail(buybackId,webshopOrderId){
  if(!hasPermission("buyback_orders.update"))return;
  if(!confirm("Wil je de bevestiging van de overgemaakte inruilwaarde opnieuw naar de klant sturen?"))return;
  try{
    const response=await fetch("/api/admin/webshop-orders/"+encodeURIComponent(webshopOrderId)+"/trade-in-settlement-email",{method:"POST",credentials:"same-origin",headers:{"Accept":"application/json"}});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"De bevestigingsmail kon niet worden verzonden.");
    await refreshBuybackOrderDetails(buybackId);
    alert("De bevestigingsmail is verzonden.");
  }catch(error){alert(error.message);}
}
async function saveBuybackShippingLabel(id){
  if(!hasPermission("buyback_orders.update"))return;
  const fileInput=document.getElementById("buybackShippingLabelFile");
  const file=fileInput?.files?.[0]||null;
  const trackingNumber=String(document.getElementById("buybackPostnlTracking")?.value||"").trim();
  if(!file){alert("Selecteer eerst het PDF-verzendlabel dat je bij PostNL hebt gekocht.");return;}
  if(file.type!=="application/pdf"&&!/\.pdf$/i.test(file.name)){alert("Upload alleen een PDF-verzendlabel.");return;}
  if(file.size>8*1024*1024){alert("Het PDF-bestand mag maximaal 8 MB groot zijn.");return;}
  if(!confirm("Wil je dit PostNL-verzendlabel en het Track & Trace-nummer bij deze aanvraag opslaan?"))return;
  try{
    const fileData=await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onerror=()=>reject(new Error("Het PDF-bestand kon niet worden gelezen."));
      reader.onload=()=>resolve(String(reader.result||"").split(",")[1]||"");
      reader.readAsDataURL(file);
    });
    const response=await fetch("/api/admin/buyback-orders/"+encodeURIComponent(id)+"/shipping-label",{
      method:"PUT",credentials:"same-origin",
      headers:{"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify({fileName:file.name,fileData,trackingNumber})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Het PostNL-verzendlabel kon niet worden opgeslagen.");
    await refreshBuybackOrderDetails(id);
    alert("Het PostNL-verzendlabel is veilig opgeslagen. Je kunt het nu naar de klant e-mailen.");
  }catch(error){alert(error.message||"Upload mislukt.");}
}
async function sendBuybackShippingLabelEmail(id){
  if(!hasPermission("buyback_orders.update"))return;
  if(!confirm("Wil je het PostNL-verzendlabel als PDF-bijlage naar de klant e-mailen?"))return;
  try{
    const response=await fetch("/api/admin/buyback-orders/"+encodeURIComponent(id)+"/shipping-label-email",{
      method:"POST",credentials:"same-origin",headers:{"Accept":"application/json"}
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Het verzendlabel kon niet worden gemaild.");
    await refreshBuybackOrderDetails(id);
    alert("Het PostNL-verzendlabel is per e-mail naar "+(result.email||"de klant")+" verzonden.");
  }catch(error){alert(error.message);}
}

async function settleBuybackOrder(id){
  if(!hasPermission("buyback_orders.update"))return;
  const note=String(document.getElementById("buybackSettlementNote")?.value||"").trim();
  if(note.length<5){alert("Vermeld eerst wanneer en hoe het bedrag aan de klant is overgemaakt.");return;}
  if(!confirm("Bevestig je dat het bedrag daadwerkelijk naar de klant is overgemaakt? Na bevestiging ontvangt de klant automatisch een e-mail."))return;
  try{
    const response=await fetch("/api/admin/buyback-orders/"+encodeURIComponent(id)+"/settlement",{method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({settlementNote:note})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"De uitbetaling kon niet worden geregistreerd.");
    await refreshBuybackOrderDetails(id);
    const stockCode=String(result.inventoryDevice?.identifier_value||"");
    const stockMessage=stockCode?"\\nHet toestel is toegevoegd aan het toestelregister met code: "+stockCode:"";
    if(result.payoutEmail?.sent)alert("De uitbetaling is geregistreerd en de bevestigingsmail is verzonden naar de klant."+stockMessage);
    else alert("De uitbetaling en voorraadregistratie zijn afgerond, maar de e-mail kon niet worden verzonden. Je kunt deze opnieuw versturen vanuit de aanvraag."+stockMessage);
  }catch(error){alert(error.message);}
}
async function sendBuybackPayoutEmail(id){
  if(!hasPermission("buyback_orders.update"))return;
  if(!confirm("Wil je de bevestiging van de overgemaakte betaling opnieuw naar de klant sturen?"))return;
  try{
    const response=await fetch("/api/admin/buyback-orders/"+encodeURIComponent(id)+"/settlement-email",{method:"POST",credentials:"same-origin",headers:{"Accept":"application/json"}});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"De bevestigingsmail kon niet worden verzonden.");
    await refreshBuybackOrderDetails(id);
    alert("De bevestigingsmail is verzonden naar de klant.");
  }catch(error){alert(error.message);}
}
async function updateBuybackStatus(id,newStatus){
  if(!hasPermission("buyback_orders.update"))return;
  if(!["Nieuw","In behandeling"].includes(newStatus))return;
  try{
    const response=await fetch("/api/admin/buyback-orders/"+encodeURIComponent(id)+"/status",{method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:newStatus})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Status kon niet worden gewijzigd.");
    await refreshBuybackOrderDetails(id);
  }catch(error){alert(error.message);}
}
async function deleteBuybackOrder(id){
  const orderId=Number(id);
  if(!hasPermission("buyback_orders.delete"))return;
  if(!Number.isInteger(orderId)||orderId<1){alert("Ongeldig aanvraagnummer.");return;}
  if(deletingBuybackOrderIds.has(orderId))return;
  const order=buybackOrdersCache.find(item=>Number(item.id)===orderId);
  if(order?.trade_in){alert("Deze aanvraag is gekoppeld aan een telefoonbestelling en kan niet afzonderlijk worden verwijderd.");return;}
  if(!confirm("Zelfstandige verkoopaanvraag #"+orderId+" definitief uit het Inkoop-overzicht verwijderen? Deze actie kan niet ongedaan worden gemaakt."))return;
  deletingBuybackOrderIds.add(orderId);
  try{
    const response=await fetch("/api/admin/buyback-orders/"+encodeURIComponent(orderId),{method:"DELETE",credentials:"same-origin"});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Verwijderen mislukt.");
    closeBuybackDetails();
    await loadBuybackOrders();
  }catch(error){alert(error.message);}
  finally{deletingBuybackOrderIds.delete(orderId);}
}
let unifiedOrdersActiveKey="";
const unifiedOrderCategories=[
  {id:"page-phone-orders",key:"phone-orders",permission:"webshop_orders.view",updatePermission:"webshop_orders.update",icon:"📱",title:"Telefoonbestellingen",description:"Telefoonbestellingen van klanten",loader:()=>loadWebshopOrders()},
  {id:"page-webshop-orders",key:"webshop-orders",permission:"webshop_orders.view",updatePermission:"webshop_orders.update",icon:"🛍️",title:"Shop",description:"Bestellingen uit de HOMS TECH webshop",loader:()=>loadWebshopOrders()},
  {id:"page-buyback-orders",key:"buyback-orders",permission:"buyback_orders.view",updatePermission:"buyback_orders.update",icon:"📥",title:"Inkoop",description:"Telefoons die klanten aan HOMS TECH verkopen",loader:()=>loadBuybackOrders()},
  {id:"page-repair-requests",key:"repair-requests",permission:"orders.view",updatePermission:"orders.update",icon:"🔧",title:"Repair",description:"Reparatie- en prijsaanvragen",loader:()=>loadOrders()}
];
function showUnifiedOrderSection(key,shouldLoad=true){
  const category=unifiedOrderCategories.find(item=>item.key===key&&hasPermission(item.permission));
  const parent=document.getElementById("page-all-orders");
  if(!category||!parent)return;
  unifiedOrdersActiveKey=category.key;
  document.body.classList.toggle("phone-orders-page-active",category.key==="phone-orders");
  unifiedOrderCategories.forEach(item=>{
    const section=document.getElementById(item.id);
    const active=item.key===category.key;
    if(section){
      section.hidden=!active;
      section.style.display=active?"block":"none";
      section.setAttribute("aria-hidden",String(!active));
    }
  });
  const heading=document.getElementById("ordersPageHeading");
  if(heading)heading.textContent=category.title;
  document.querySelectorAll("#ordersSubmenu [data-order-subpage]").forEach(button=>{
    button.classList.toggle("active",button.dataset.orderSubpage===category.key);
    button.setAttribute("aria-current",button.dataset.orderSubpage===category.key?"page":"false");
  });
  if(shouldLoad&&parent.classList.contains("active"))category.loader();
}
function refreshUnifiedOrders(){
  const category=unifiedOrderCategories.find(item=>item.key===unifiedOrdersActiveKey);
  if(category&&hasPermission(category.permission))category.loader();
}
function setupUnifiedOrdersAdmin(){
  if(document.getElementById("page-all-orders"))return;
  if(!document.getElementById("page-phone-orders")){
    const phoneSection=document.createElement("section");
    phoneSection.className="section admin-page";
    phoneSection.id="page-phone-orders";
    phoneSection.dataset.permission="webshop_orders.view";
    phoneSection.innerHTML='<div id="phoneOrderSummary" class="order-summary phone-order-summary"></div><div class="ht-phone-orders-searchbar"><label class="phone-orders-search" for="phoneOrderSearch"><svg class="ht-phone-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4.2 4.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><input id="phoneOrderSearch" type="search" placeholder="Zoek in bestellingen..." oninput="renderPhoneOrders()" aria-label="Zoek telefoonbestellingen"></label><label class="ht-phone-orders-filter" for="phoneOrderStatusFilter"><select id="phoneOrderStatusFilter" onchange="renderPhoneOrders()" aria-label="Filter op status"><option value="">Status: Alle</option><option value="Nieuw">Status: Nieuw</option><option value="In behandeling">Status: In behandeling</option><option value="Geaccepteerd">Status: Geaccepteerd</option><option value="Verzonden">Status: Verzonden</option><option value="Voltooid">Status: Voltooid</option><option value="Geannuleerd">Status: Geannuleerd</option></select></label><label class="ht-phone-orders-filter" for="phoneOrderPeriodFilter"><select id="phoneOrderPeriodFilter" onchange="renderPhoneOrders()" aria-label="Filter op periode"><option value="">Periode: Alle</option><option value="today">Periode: Vandaag</option><option value="7days">Periode: Laatste 7 dagen</option><option value="30days">Periode: Laatste 30 dagen</option><option value="month">Periode: Deze maand</option></select></label><span id="phoneOrdersStatus" class="ht-phone-orders-result-count" aria-live="polite"></span></div><div class="ht-phone-orders-workspace"><section class="ht-phone-orders-list-pane"><div id="phoneOrdersList" class="orders-list phone-orders-list"></div></section><aside class="ht-phone-orders-detail-pane"><div id="phoneOrderDetailHost" class="ht-phone-orders-detail-host" aria-live="polite"></div></aside></div>';
    document.querySelector("#dashboard .container")?.appendChild(phoneSection);
  }
  const sections=unifiedOrderCategories.map(item=>({item,section:document.getElementById(item.id)})).filter(entry=>entry.section);
  if(!sections.length)return;
  const parent=document.createElement("section");
  parent.className="section admin-page";
  parent.id="page-all-orders";
  parent.innerHTML='<div class="section-head ht-orders-page-head"><h2 id="ordersPageHeading">Alle bestellingen</h2></div><div id="allOrdersSections" class="unified-orders-panel"></div>';
  const host=parent.querySelector("#allOrdersSections");
  sections.forEach(({item,section})=>{
    if(!hasPermission(item.permission)){section.hidden=true;section.style.display="none";return;}
    section.classList.remove("admin-page","active");
    section.removeAttribute("data-permission");
    section.dataset.orderCategory=item.key;
    section.hidden=true;
    section.style.display="none";
    section.removeAttribute("role");
    section.removeAttribute("aria-labelledby");
    section.style.marginTop="0";
    host.appendChild(section);
  });
  const container=document.querySelector("#dashboard .container");
  if(container)container.insertBefore(parent,container.querySelector(".save-bar"));
  document.querySelectorAll('.nav-btn[data-page="orders"],.nav-btn[data-page="repair-requests"],.nav-btn[data-page="webshop-orders"],.nav-btn[data-page="buyback-orders"],.nav-btn[data-page="phone-orders"]').forEach(button=>button.remove());
  setupOrdersSubmenu();
  const first=unifiedOrderCategories.find(item=>hasPermission(item.permission)&&document.getElementById(item.id));
  if(first)showUnifiedOrderSection(first.key,false);
}
function setupOrdersSubmenu(){
  const menu=document.getElementById("ordersSubmenu");
  const parentButton=document.querySelector('.nav-btn[data-page="all-orders"]');
  if(!menu||!parentButton)return;

  menu.replaceChildren();
  unifiedOrderCategories.forEach(item=>{
    if(!hasPermission(item.permission))return;
    const button=document.createElement("button");
    button.type="button";
    button.className="nav-sub-btn";
    button.dataset.orderSubpage=item.key;
    button.innerHTML='<span class="nav-sub-icon" aria-hidden="true">'+item.icon+'</span><span>'+item.title+'</span>';
    button.addEventListener("click",()=>showOrderSubpage(item.key));
    menu.appendChild(button);
  });

  const shouldOpen=currentPage==="all-orders";
  menu.hidden=!shouldOpen;
  parentButton.setAttribute("aria-expanded",String(shouldOpen));
  parentButton.classList.toggle("expanded",shouldOpen);
}

function toggleOrdersMenu(){
  const menu=document.getElementById("ordersSubmenu");
  const parentButton=document.querySelector('.nav-btn[data-page="all-orders"]');
  if(!menu||!parentButton)return;

  const shouldOpen=menu.hidden;
  menu.hidden=!shouldOpen;
  parentButton.setAttribute("aria-expanded",String(shouldOpen));
  parentButton.classList.toggle("expanded",shouldOpen);

  if(currentPage!=="all-orders")showPage("all-orders");
}

function showOrderSubpage(key){
  const category=unifiedOrderCategories.find(item=>item.key===key&&hasPermission(item.permission));
  if(!category)return;

  unifiedOrdersActiveKey=category.key;
  const menu=document.getElementById("ordersSubmenu");
  const parentButton=document.querySelector('.nav-btn[data-page="all-orders"]');
  if(menu)menu.hidden=false;
  if(parentButton){
    parentButton.setAttribute("aria-expanded","true");
    parentButton.classList.add("expanded");
  }
  showPage("all-orders");
}

let adminSiteDataLoaded=false;
let adminRenderedDataPage="";

function renderAdminPageData(page){
  if(!adminSiteDataLoaded)return;
  if(page==="general"){renderGeneral();renderHomepageSettings();return;}
  if(page==="services"){renderServices();return;}
  if(page==="repair"){renderRepairPageAdmin();return;}
  if(page==="phones"){renderPhones();renderGlobalConditionDetails();return;}
  if(page==="shop"){renderShopProductsAdmin();return;}
  if(page==="buyback"){renderBuybackPhones();return;}
  if(page==="categories"){renderDeviceCategories();renderGlobalConditionDetails();return;}
  if(page==="why"){renderWhy();return;}
}

function renderAll(){
  setupUnifiedOrdersAdmin();
  adminSiteDataLoaded=true;
  adminRenderedDataPage="";
  renderAdminPageData(currentPage);
  adminRenderedDataPage=currentPage;
  showPage(currentPage);
}

function markChanged(){
  schedulePhoneDraftSave();
  setStatus(
    "● Wijziging موجودة — اضغط «Wijzigingen opslaan» للحفظ.",
    "info"
  );
  // Geen autosave meer. De beheerder kan eerst meerdere velden aanpassen
  // en pas daarna één keer op «Wijzigingen opslaan» drukken.
  clearTimeout(autoSaveTimer);
  autoSaveAgain = false;
}

function setStatus(text,type){

  const el=document.getElementById("saveStatus");

  if(!el) return;

  el.textContent=text;
  el.className="status "+type;
}

function esc(value){

  return String(value ?? "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}

let inventoryData={items:[],movements:[],summary:null};
const inventoryMovementLabels={
  purchase:"Inkoop / levering",
  sale:"Verkoop / afboeking",
  return:"Retour ontvangen",
  damage:"Beschadigd / verlies",
  correction:"Voorraadcorrectie",
  webshop_sale:"Webshopverkoop"
};
function inventoryEuroCount(value){
  const number=Number(value);
  return Number.isSafeInteger(number)&&number>=0?number.toLocaleString("nl-NL"):"—";
}
function inventoryDate(value){
  const date=new Date(value);
  return Number.isNaN(date.getTime())?"—":date.toLocaleString("nl-NL",{dateStyle:"short",timeStyle:"short"});
}
function inventorySetStatus(message,type="info"){
  const status=document.getElementById("inventoryFormStatus");
  if(status){status.textContent=message;status.className="status "+type;}
}
function renderInventorySummary(){
  const box=document.getElementById("inventorySummary"),summary=inventoryData.summary;
  if(!box||!summary)return;
  const cards=[
    ["Voorraadartikelen",summary.products,"Catalogusartikelen"],
    ["Totale stuks",summary.totalUnits,"Getelde voorraad"],
    ["Bijna op",summary.lowStockCount,"Op of onder "+summary.threshold+" stuks"],
    ["Uitverkocht",summary.outOfStockCount,"Voorraad nul"]
  ];
  box.innerHTML=cards.map((card,index)=>
    '<div class="ht-inventory-stat ht-inventory-stat-'+index+'"><span>'+esc(card[0])+'</span><strong>'+inventoryEuroCount(card[1])+'</strong><small>'+esc(card[2])+'</small></div>'
  ).join("");
}
function renderInventoryItemSelect(){
  const select=document.getElementById("inventoryItemSelect");
  if(!select)return;
  const previous=select.value;
  select.innerHTML='<option value="">Selecteer een product</option>'+inventoryData.items.map((item,index)=>
    '<option value="'+index+'">'+esc(item.name)+' · '+esc(item.variantLabel)+' · '+esc(item.sku||"Geen SKU")+'</option>'
  ).join("");
  if(previous&&Number(previous)<inventoryData.items.length)select.value=previous;
  inventorySelectionChanged();
}
function renderInventoryItems(){
  const box=document.getElementById("inventoryItems");
  if(!box)return;
  const search=String(document.getElementById("inventorySearch")?.value||"").trim().toLocaleLowerCase();
  const category=document.getElementById("inventoryCategoryFilter")?.value||"all";
  const stockFilter=document.getElementById("inventoryStockFilter")?.value||"all";
  const rows=inventoryData.items.map((item,index)=>({item,index})).filter(({item})=>{
    const haystack=[item.name,item.variantLabel,item.sku,item.category].join(" ").toLocaleLowerCase();
    if(search&&!haystack.includes(search))return false;
    if(category==="phone"&&item.itemType!=="phone")return false;
    if(category==="shop"&&item.itemType!=="shop")return false;
    if(stockFilter==="untracked"&&item.stock!==null)return false;
    if(stockFilter==="zero"&&item.stock!==0)return false;
    if(stockFilter==="low"&&(item.stock===null||item.stock>inventoryData.summary?.threshold))return false;
    return true;
  });
  if(!rows.length){
    box.innerHTML='<div class="ht-inventory-empty"><strong>Geen voorraadartikelen gevonden</strong><p>Pas de zoekopdracht of filters aan.</p></div>';
    return;
  }
  box.innerHTML='<table class="ht-inventory-table"><thead><tr><th>Product / uitvoering</th><th>SKU</th><th>Voorraad</th><th>Status</th><th>Actie</th></tr></thead><tbody>'+
    rows.map(({item,index})=>{
      const untracked=item.stock===null;
      const zero=item.stock===0;
      const low=!untracked&&!zero&&item.stock<=Number(inventoryData.summary?.threshold??2);
      const status=untracked?"Niet ingesteld":zero?"Uitverkocht":low?"Lage voorraad":item.active?"Op voorraad":"Niet actief";
      const badge=untracked?"is-untracked":zero?"is-zero":low?"is-low":item.active?"is-available":"is-inactive";
      return '<tr><td><strong>'+esc(item.name)+'</strong><small>'+esc(item.variantLabel)+' · '+esc(item.category)+'</small></td><td><span class="ht-inventory-sku">'+esc(item.sku||"—")+'</span></td><td><strong class="ht-inventory-quantity">'+(untracked?"Niet ingesteld":inventoryEuroCount(item.stock)+" st.")+'</strong></td><td><span class="ht-inventory-badge '+badge+'">'+status+'</span></td><td><button type="button" class="btn btn-light ht-inventory-row-action" onclick="selectInventoryItem('+index+')">Muteren</button></td></tr>';
    }).join("")+'</tbody></table>';
}
function renderInventoryMovements(){
  const box=document.getElementById("inventoryMovements");
  if(!box)return;
  const rows=Array.isArray(inventoryData.movements)?inventoryData.movements:[];
  if(!rows.length){
    box.innerHTML='<div class="ht-inventory-empty"><strong>Nog geen voorraadmutaties</strong><p>Inkoop, verkoop en correcties verschijnen hier automatisch.</p></div>';
    return;
  }
  box.innerHTML='<div class="ht-inventory-history-scroll"><table class="ht-inventory-history-table"><thead><tr><th>Datum</th><th>Product</th><th>Mutatie</th><th>Voorraad</th><th>Referentie / reden</th><th>Door</th></tr></thead><tbody>'+
    rows.map(row=>{
      const qty=Number(row.quantity)||0;
      const positive=qty>0;
      return '<tr><td>'+inventoryDate(row.created_at)+'</td><td><strong>'+esc(row.product_name||"Product")+'</strong><small>'+esc(row.variant_label||"Standaard")+' · '+esc(row.sku||"")+'</small></td><td><span class="ht-inventory-movement '+(positive?"is-positive":"is-negative")+'">'+(positive?"+":"−")+inventoryEuroCount(Math.abs(qty))+' · '+esc(inventoryMovementLabels[row.movement_type]||row.movement_type)+'</span></td><td><strong>'+inventoryEuroCount(row.stock_before)+' → '+inventoryEuroCount(row.stock_after)+'</strong></td><td>'+esc(row.reference||"—")+'<small>'+esc(row.note||"")+'</small></td><td>'+esc(row.created_by||"Admin")+'</td></tr>';
    }).join("")+'</tbody></table></div>';
}
function inventorySelectionChanged(){
  const select=document.getElementById("inventoryItemSelect");
  const info=document.getElementById("inventorySelectedInfo");
  const item=inventoryData.items[Number(select?.value)];
  if(!info)return;
  if(!select?.value||!item){info.textContent="Selecteer een product om de huidige voorraad te bekijken.";return;}
  info.innerHTML='<span>Geselecteerde voorraad</span><strong>'+(item.stock===null?"Niet ingesteld":inventoryEuroCount(item.stock)+" stuks")+'</strong><small>'+esc(item.name)+' · '+esc(item.variantLabel)+'</small>';
}
function selectInventoryItem(index){
  const select=document.getElementById("inventoryItemSelect");
  if(!select||!inventoryData.items[index])return;
  select.value=String(index);
  inventorySelectionChanged();
  document.getElementById("inventoryMovementType").value="purchase";
  inventoryMovementTypeChanged();
  document.getElementById("inventoryQuantity").focus();
  document.getElementById("inventoryMovementForm")?.scrollIntoView({behavior:"smooth",block:"center"});
}
function inventoryMovementTypeChanged(){
  const type=document.getElementById("inventoryMovementType")?.value;
  const quantity=document.getElementById("inventoryQuantity");
  const note=document.getElementById("inventoryNote");
  if(!quantity)return;
  if(type==="correction"){
    quantity.min="-100000";
    quantity.placeholder="Bijv. -2 of +3";
    if(note)note.required=true;
  }else{
    quantity.min="1";
    quantity.placeholder="Bijv. 5";
  }
}
async function loadInventory(){
  const box=document.getElementById("inventoryItems");
  if(!box)return;
  box.innerHTML='<div class="ht-inventory-loading">Voorraad wordt geladen…</div>';
  try{
    const response=await fetch("/api/admin/inventory",{credentials:"same-origin",cache:"no-store",headers:{"Accept":"application/json"}});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Voorraad laden is mislukt.");
    inventoryData={
      items:Array.isArray(result.items)?result.items:[],
      movements:Array.isArray(result.movements)?result.movements:[],
      summary:result.summary||null
    };
    renderInventorySummary();
    renderInventoryItemSelect();
    renderInventoryItems();
    renderInventoryMovements();
  }catch(error){
    box.innerHTML='<div class="ht-inventory-error" role="alert">'+esc(error.message||"Voorraad laden is mislukt.")+'</div>';
    inventorySetStatus(error.message||"Voorraad laden is mislukt.","error");
  }
}
async function saveInventoryMovement(event){
  event?.preventDefault();
  const button=document.getElementById("inventorySaveButton");
  if(button?.disabled)return;
  const select=document.getElementById("inventoryItemSelect");
  const item=inventoryData.items[Number(select?.value)];
  const type=document.getElementById("inventoryMovementType")?.value||"";
  const quantity=Number(document.getElementById("inventoryQuantity")?.value);
  const note=String(document.getElementById("inventoryNote")?.value||"").trim();
  const reference=String(document.getElementById("inventoryReference")?.value||"").trim();
  if(!item){inventorySetStatus("Selecteer eerst een product of uitvoering.","error");return;}
  if(!Number.isSafeInteger(quantity)||quantity===0||Math.abs(quantity)>100000){
    inventorySetStatus("Vul een geldig geheel aantal in.","error");return;
  }
  if(type!=="correction"&&quantity<1){
    inventorySetStatus("Gebruik voor deze mutatie een positief aantal.","error");return;
  }
  if(!note){inventorySetStatus("Vul de reden van deze voorraadmutatie in.","error");return;}
  const payload={
    itemType:item.itemType,productId:item.productId,variantId:item.variantId||"",
    variantIndex:item.variantIndex,variantKey:item.variantKey||"",
    movementType:type,quantity,note,reference
  };
  if(button){button.disabled=true;button.dataset.originalText=button.textContent;button.textContent="Opslaan…";}
  inventorySetStatus("Voorraadmutatie wordt veilig opgeslagen…","info");
  try{
    const response=await fetch("/api/admin/inventory/movements",{
      method:"POST",credentials:"same-origin",
      headers:{"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify(payload)
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Voorraadmutatie opslaan is mislukt.");
    document.getElementById("inventoryQuantity").value="";
    document.getElementById("inventoryNote").value="";
    inventorySetStatus("Voorraad bijgewerkt. Nieuwe voorraad: "+inventoryEuroCount(result.stock)+" stuks.","success");
    await loadInventory();
  }catch(error){
    inventorySetStatus(error.message||"Voorraadmutatie opslaan is mislukt.","error");
  }finally{
    if(button){button.disabled=false;button.textContent=button.dataset.originalText||"Voorraadmutatie opslaan";delete button.dataset.originalText;}
  }
}

let invoiceTestRecipient="Appelavcd116@gmail.com";
function invoiceEuro(value){
  return new Intl.NumberFormat("nl-NL",{style:"currency",currency:"EUR"}).format(invoiceRoundMoney(value));
}
function invoiceRoundMoney(value){
  const number=Number(value);
  return Number.isFinite(number)?Math.round((number+Number.EPSILON)*100)/100:0;
}
function invoiceReadLines(){
  return [...document.querySelectorAll("#invoiceLines tr")].map(row=>({
    description:String(row.querySelector(".iv-desc")?.value||"").trim(),
    quantity:Number(row.querySelector(".iv-qty")?.value),
    unitPrice:Number(row.querySelector(".iv-price")?.value),
    vatRate:Number(row.querySelector(".iv-vat")?.value)
  }));
}
function invoiceValidateLines(lines){
  if(!Array.isArray(lines)||!lines.length)return "Voeg minimaal één factuurregel toe.";
  for(let index=0;index<lines.length;index++){
    const line=lines[index],label="Factuurregel "+(index+1)+": ";
    if(!line.description)return label+"vul een omschrijving in.";
    if(!Number.isInteger(line.quantity)||line.quantity<1||line.quantity>999)return label+"aantal moet een heel getal tussen 1 en 999 zijn.";
    if(!Number.isFinite(line.unitPrice)||line.unitPrice<0||line.unitPrice>1000000)return label+"vul een geldige prijs tussen € 0 en € 1.000.000 in.";
    if(![0,9,21].includes(line.vatRate))return label+"kies een geldig BTW-tarief.";
  }
  return "";
}
function invoiceCalc(){
  const lines=invoiceReadLines();
  let subtotal=0,vatTotal=0;
  for(const line of lines){
    const lineSubtotal=invoiceRoundMoney(line.quantity*line.unitPrice);
    const lineVat=invoiceRoundMoney(lineSubtotal*line.vatRate/100);
    subtotal=invoiceRoundMoney(subtotal+lineSubtotal);
    vatTotal=invoiceRoundMoney(vatTotal+lineVat);
  }
  return {lines,subtotal,vatTotal,total:invoiceRoundMoney(subtotal+vatTotal)};
}
function invoiceTotalsUi(){
  const totals=invoiceCalc();
  const subtotal=document.getElementById("invSubtotal");
  const vat=document.getElementById("invVatTotal");
  const grand=document.getElementById("invGrandTotal");
  if(subtotal)subtotal.textContent=invoiceEuro(totals.subtotal);
  if(vat)vat.textContent=invoiceEuro(totals.vatTotal);
  if(grand)grand.textContent=invoiceEuro(totals.total);
}
function addInvoiceLine(description="",quantity=1,unitPrice=0,vatRate=21){
  const body=document.getElementById("invoiceLines");
  if(!body)return;
  const row=document.createElement("tr");
  row.innerHTML=
    '<td><input class="iv-desc" maxlength="240" placeholder="Product of reparatie" aria-label="Omschrijving factuurregel" value="'+esc(description)+'"></td>'+
    '<td><input class="iv-qty" type="number" min="1" max="999" step="1" inputmode="numeric" aria-label="Aantal" value="'+esc(quantity)+'"></td>'+
    '<td><input class="iv-price" type="number" min="0" max="1000000" step="0.01" inputmode="decimal" aria-label="Prijs per stuk in euro" value="'+esc(unitPrice)+'"></td>'+
    '<td><select class="iv-vat" aria-label="BTW-tarief"><option value="0">0%</option><option value="9">9%</option><option value="21">21%</option></select></td>'+
    '<td><button type="button" class="btn btn-light iv-remove" aria-label="Factuurregel verwijderen" title="Factuurregel verwijderen">✕</button></td>';
  row.querySelector(".iv-vat").value=String(vatRate);
  row.querySelectorAll("input,select").forEach(control=>{
    control.addEventListener("input",invoiceTotalsUi);
    control.addEventListener("change",invoiceTotalsUi);
  });
  row.querySelector(".iv-remove").addEventListener("click",()=>{
    row.remove();
    invoiceTotalsUi();
  });
  body.appendChild(row);
  invoiceTotalsUi();
}
function invoiceFormMessage(message,type="info"){
  const status=document.getElementById("invoiceFormStatus");
  if(!status)return;
  status.className="status "+type;
  status.textContent=message;
}
function invoiceDraftPayload(){
  const totals=invoiceCalc();
  return {
    customerName:String(document.getElementById("invCustomerName")?.value||"").trim(),
    customerEmail:String(document.getElementById("invCustomerEmail")?.value||"").trim(),
    customerAddress:String(document.getElementById("invCustomerAddress")?.value||"").trim(),
    kvkNumber:String(document.getElementById("invKvk")?.value||"").trim(),
    vatId:String(document.getElementById("invVatId")?.value||"").trim(),
    lines:totals.lines,
    totals
  };
}
function invoiceValidateDraft(payload){
  if(!payload.customerName)return "Vul de klantnaam in.";
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.customerEmail))return "Vul een geldig e-mailadres van de klant in.";
  return invoiceValidateLines(payload.lines);
}
function previewInvoiceDraft(){
  const payload=invoiceDraftPayload();
  const validation=invoiceValidateDraft(payload);
  if(validation){invoiceFormMessage(validation,"error");return;}
  const totals=payload.totals;
  const preview=window.open("","_blank");
  if(!preview){invoiceFormMessage("Sta pop-ups toe om het factuurvoorbeeld te openen.","error");return;}
  const rows=totals.lines.map(line=>
    "<tr><td>"+esc(line.description)+"</td><td>"+line.quantity+"</td><td>"+invoiceEuro(line.unitPrice)+"</td><td>"+line.vatRate+"%</td><td>"+invoiceEuro(invoiceRoundMoney(line.quantity*line.unitPrice))+"</td></tr>"
  ).join("");
  preview.document.write(
    '<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HOMS TECH factuurvoorbeeld</title>'+
    '<style>'+
    '*{box-sizing:border-box}body{font:14px Arial,sans-serif;max-width:900px;margin:32px auto;padding:0 22px;color:#172033}header{background:#071d2d;color:#fff;padding:25px 28px;border-bottom:5px solid #2563eb}header h1{margin:0 0 7px;font-size:26px}header p{margin:0;color:#dbeafe}.meta{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:26px 0}.meta p{line-height:1.7;margin:6px 0}table{width:100%;border-collapse:collapse;margin-top:22px}th{background:#eff4f9;color:#17324d}td,th{padding:11px 9px;border-bottom:1px solid #dce4ed;text-align:left}td:nth-child(n+2),th:nth-child(n+2){text-align:right}.totals{margin:24px 0 24px auto;max-width:330px;line-height:2}.grand{font-size:19px;font-weight:800;border-top:2px solid #071d2d;padding-top:8px}.notice{padding:13px;background:#f1f5f9;border-radius:8px;color:#475569}.toolbar{display:flex;gap:10px;margin:22px 0}.toolbar button{border:0;border-radius:8px;background:#2563eb;color:#fff;padding:11px 17px;font-weight:700;cursor:pointer}.toolbar button:last-child{background:#e2e8f0;color:#172033}@media print{body{margin:0;max-width:none}.toolbar{display:none}}@media(max-width:600px){.meta{grid-template-columns:1fr}body{padding:0 12px}table{font-size:11px}td,th{padding:8px 5px}}'+
    '</style></head><body>'+
    '<header><h1>HOMS TECH</h1><p>Smartphone Repair & Refurbished Devices</p><h2>FACTUUR — VOORBEELD</h2></header>'+
    '<div class="meta"><section><strong>Factuur aan</strong><p>'+esc(payload.customerName)+'<br>'+esc(payload.customerEmail)+'<br>'+esc(payload.customerAddress)+'</p></section><section><strong>Administratieve gegevens</strong><p>KVK: '+esc(payload.kvkNumber||"Nog niet ingevuld")+'<br>BTW-ID: '+esc(payload.vatId||"Nog niet ingevuld")+'<br>Factuurnummer: wordt toegewezen na opslaan</p></section></div>'+
    '<table><thead><tr><th>Omschrijving</th><th>Aantal</th><th>Prijs</th><th>BTW</th><th>Regeltotaal</th></tr></thead><tbody>'+rows+'</tbody></table>'+
    '<div class="totals">Excl. BTW: '+invoiceEuro(totals.subtotal)+'<br>BTW: '+invoiceEuro(totals.vatTotal)+'<div class="grand">Totaal: '+invoiceEuro(totals.total)+'</div></div>'+
    '<p class="notice">Dit is een voorbeeld en nog geen definitieve factuur. Het officiële factuurnummer wordt toegewezen na het opslaan.</p>'+
    '<div class="toolbar"><button onclick="window.print()">Afdrukken / Opslaan als PDF</button><button onclick="window.close()">Sluiten</button></div>'+
    '</body></html>'
  );
  preview.document.close();
}
async function saveInvoice(){
  const button=document.querySelector('#page-invoices button[onclick="saveInvoice()"]');
  if(button?.disabled)return;
  const payload=invoiceDraftPayload();
  const validation=invoiceValidateDraft(payload);
  if(validation){invoiceFormMessage(validation,"error");return;}
  const body={
    customerName:payload.customerName,
    customerEmail:payload.customerEmail,
    customerAddress:payload.customerAddress,
    kvkNumber:payload.kvkNumber,
    vatId:payload.vatId,
    lines:payload.lines
  };
  if(button){button.disabled=true;button.dataset.originalText=button.textContent;button.textContent="Opslaan…";}
  invoiceFormMessage("Factuur wordt veilig opgeslagen…","info");
  try{
    const response=await fetch("/api/admin/invoices",{
      method:"POST",credentials:"same-origin",
      headers:{"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify(body)
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Factuur opslaan is mislukt.");
    invoiceFormMessage("Factuur "+String(result.invoice?.invoice_number||"")+" is opgeslagen.","success");
    await loadInvoices();
  }catch(error){
    invoiceFormMessage(error.message||"Factuur opslaan is mislukt.","error");
  }finally{
    if(button){button.disabled=false;button.textContent=button.dataset.originalText||"Factuur opslaan als concept";delete button.dataset.originalText;}
  }
}
function invoiceDate(value){
  const date=new Date(value);
  return Number.isNaN(date.getTime())?"—":date.toLocaleDateString("nl-NL");
}
async function loadInvoices(){
  const box=document.getElementById("invoiceList");
  if(!box)return;
  box.innerHTML='<div class="ht-invoice-loading" role="status" aria-live="polite">Facturen laden…</div>';
  try{
    const response=await fetch("/api/admin/invoices",{credentials:"same-origin",headers:{"Accept":"application/json"}});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Facturen laden is mislukt.");
    const invoices=Array.isArray(result.invoices)?result.invoices:[];
    if(!invoices.length){
      box.innerHTML='<div class="ht-invoice-empty"><strong>Nog geen facturen</strong><p>Opgeslagen facturen verschijnen hier automatisch.</p></div>';
      return;
    }
    box.innerHTML=
      '<div class="ht-invoice-table-wrap"><table class="ht-invoice-table"><thead><tr><th>Factuurnummer</th><th>Klant</th><th>Datum</th><th>Totaal</th><th>Status</th><th>Acties</th></tr></thead><tbody>'+
      invoices.map(invoice=>{
        const id=Number(invoice.id);
        const status=String(invoice.status||"Concept");
        const isSent=status.toLowerCase().includes("sent")||status.toLowerCase().includes("verstuurd");
        return '<tr>'+
          '<td><strong class="ht-invoice-number">'+esc(invoice.invoice_number||"—")+'</strong></td>'+
          '<td><strong>'+esc(invoice.customer_name||"—")+'</strong><small>'+esc(invoice.customer_email||"")+'</small></td>'+
          '<td>'+invoiceDate(invoice.created_at)+'</td>'+
          '<td class="ht-invoice-total">'+invoiceEuro(invoice.total)+'</td>'+
          '<td><span class="ht-invoice-status '+(isSent?"is-sent":"is-draft")+'">'+esc(status==="Concept / test"?"Opgeslagen":status)+'</span></td>'+
          '<td><div class="ht-invoice-actions"><button type="button" class="btn btn-light" onclick="previewSavedInvoice('+id+')">PDF bekijken</button><button type="button" class="btn btn-green" onclick="sendInvoiceTest('+id+',this)">E-mail versturen</button></div></td>'+
          '</tr>';
      }).join("")+
      '</tbody></table></div>';
  }catch(error){
    box.innerHTML='<div class="ht-invoice-error" role="alert">'+esc(error.message||"Facturen laden is mislukt.")+'</div>';
  }
}
async function previewSavedInvoice(id){
  if(!Number.isSafeInteger(Number(id))||Number(id)<1)return;
  try{
    const response=await fetch("/api/admin/invoices/"+encodeURIComponent(Number(id))+"/pdf",{credentials:"same-origin"});
    if(!response.ok){
      const result=await response.json().catch(()=>({}));
      throw new Error(result.error||"PDF openen is mislukt.");
    }
    const blob=await response.blob();
    if(blob.type&&blob.type!=="application/pdf")throw new Error("De server heeft geen geldig PDF-bestand teruggestuurd.");
    const url=URL.createObjectURL(blob);
    const opened=window.open(url,"_blank");
    if(opened){opened.opener=null;}
    if(!opened){
      const link=document.createElement("a");
      link.href=url;link.download="HOMS-TECH-factuur-"+Number(id)+".pdf";
      document.body.appendChild(link);link.click();link.remove();
    }
    window.setTimeout(()=>URL.revokeObjectURL(url),60000);
  }catch(error){
    invoiceFormMessage(error.message||"PDF openen is mislukt.","error");
  }
}
async function sendInvoiceTest(id,button){
  const invoiceId=Number(id);
  if(!Number.isSafeInteger(invoiceId)||invoiceId<1)return;
  if(!confirm("De factuur definitief per e-mail versturen naar het klantadres dat bij deze factuur is opgeslagen?"))return;
  if(button?.disabled)return;
  if(button){button.disabled=true;button.dataset.originalText=button.textContent;button.textContent="Versturen…";}
  try{
    const response=await fetch("/api/admin/invoices/"+encodeURIComponent(invoiceId)+"/test-send",{
      method:"POST",credentials:"same-origin",headers:{"Accept":"application/json"}
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"E-mail versturen is mislukt.");
    invoiceFormMessage("Factuurmail is verzonden naar "+String(result.to||"het klantadres")+".","success");
    if(typeof setStatus==="function")setStatus("✓ Factuurmail verzonden.","success");
  }catch(error){
    invoiceFormMessage(error.message||"E-mail versturen is mislukt.","error");
  }finally{
    if(button){button.disabled=false;button.textContent=button.dataset.originalText||"E-mail versturen";delete button.dataset.originalText;}
  }
}

let adminEmailCache=[],adminEmailFilter="all",adminEmailSelectedId=null,adminEmailFiles=[],adminEmailReplyToId=null;
function emailEsc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function emailDate(v){try{return new Date(v).toLocaleString("nl-NL",{dateStyle:"short",timeStyle:"short"});}catch{return "";}}
function emailBytes(n){if(n<1024)return n+" B";if(n<1048576)return (n/1024).toFixed(0)+" KB";return (n/1048576).toFixed(1)+" MB";}
function emailInitial(v){return String(v||"?").trim().charAt(0).toUpperCase()||"?";}
function emailPreview(v){return String(v||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,120);}
function setEmailFilter(filter,button){adminEmailFilter=filter;document.querySelectorAll("[data-email-filter]").forEach(x=>x.classList.toggle("active",x===button));renderAdminEmailList();}
function renderAdminEmailList(){
 const list=document.getElementById("emailInboxList"),search=(document.getElementById("emailSearch")?.value||"").toLowerCase();if(!list)return;
 const rows=adminEmailCache.filter(m=>(adminEmailFilter==="all"||m.direction===adminEmailFilter)&&[m.subject,m.from_address,(m.to_addresses||[]).join(" ")].join(" ").toLowerCase().includes(search));
 if(!rows.length){list.innerHTML='<div class="ht-mail-empty" style="min-height:180px"><span>⌕</span><strong>Geen berichten gevonden</strong><p>Pas je zoekopdracht of filter aan.</p></div>';return;}
 list.innerHTML=rows.map(m=>'<button type="button" class="ht-mail-row '+(Number(m.id)===Number(adminEmailSelectedId)?"active":"")+'" onclick="openAdminEmail('+Number(m.id)+')"><div class="ht-mail-row-top"><span class="ht-mail-avatar">'+emailEsc(emailInitial(m.direction==="inbound"?m.from_address:(m.to_addresses||[])[0]))+'</span><div><strong>'+emailEsc(m.direction==="inbound"?m.from_address:"Aan: "+(m.to_addresses||[]).join(", "))+'</strong><small>'+emailDate(m.created_at)+'</small></div></div><div class="ht-mail-row-subject">'+emailEsc(m.subject||"(geen onderwerp)")+'</div><div class="ht-mail-row-preview">'+emailEsc(emailPreview(m.preview||m.text_body||m.subject))+'</div><div class="ht-mail-row-badges"><span class="ht-mail-pill '+(m.direction==="outbound"?"sent":"")+'">'+(m.direction==="inbound"?"Inbox":"Verzonden")+'</span>'+(m.direction==="inbound"&&!m.is_read?'<span class="ht-mail-pill">Nieuw</span>':"")+(Array.isArray(m.attachments)&&m.attachments.length?'<span class="ht-mail-pill">📎 '+m.attachments.length+'</span>':"")+'</div></button>').join("");
}
async function loadAdminEmails(){
 const list=document.getElementById("emailInboxList"),count=document.getElementById("emailInboxCount");if(!list)return;list.innerHTML='<div class="small">E-mails laden…</div>';
 try{
  const r=await fetch("/api/admin/emails",{credentials:"same-origin"}),d=await r.json();if(!r.ok)throw Error(d.error||"E-mails laden mislukt.");
  adminEmailCache=d.emails||[];const unread=adminEmailCache.filter(x=>x.direction==="inbound"&&!x.is_read).length;
  if(count)count.textContent=adminEmailCache.length+" berichten";const inbox=document.getElementById("emailStatInbox"),sent=document.getElementById("emailStatSent");
  if(inbox)inbox.textContent=unread+" ongelezen";if(sent)sent.textContent=adminEmailCache.filter(x=>x.direction==="outbound").length+" berichten";
  renderAdminEmailList();
  if(adminEmailSelectedId&&adminEmailCache.some(x=>Number(x.id)===Number(adminEmailSelectedId)))return;
  if(adminEmailCache.length)await openAdminEmail(adminEmailCache[0].id);
 }catch(e){list.innerHTML='<div class="status error">'+emailEsc(e.message)+'</div>';}
}
async function openAdminEmail(id){
 const box=document.getElementById("adminEmailDetail");if(!box)return;adminEmailSelectedId=Number(id);renderAdminEmailList();box.innerHTML='<div class="ht-mail-empty"><strong>Bericht laden…</strong></div>';
 try{
  const r=await fetch("/api/admin/emails/"+id,{credentials:"same-origin"}),d=await r.json();if(!r.ok)throw Error(d.error||"Bericht laden mislukt.");
  const m=d.email,attachments=Array.isArray(m.attachments)?m.attachments:[];
  box.innerHTML='<div class="ht-mail-reader-head"><h3 class="ht-mail-reader-title">'+emailEsc(m.subject||"(geen onderwerp)")+'</h3><div class="ht-mail-meta"><span class="ht-mail-avatar">'+emailEsc(emailInitial(m.from_address))+'</span><div class="ht-mail-meta-main"><strong>'+emailEsc(m.from_address||"Onbekend")+'</strong><small>Aan: '+emailEsc((m.to_addresses||[]).join(", "))+' · '+emailDate(m.created_at)+'</small></div></div></div><div class="ht-mail-reader-body">'+emailEsc(m.text_body||emailPreview(m.html_body)||"Geen tekstinhoud beschikbaar.")+'</div>'+(attachments.length?'<div style="padding:0 20px 16px"><strong style="font-size:12px">📎 Bijlagen ('+attachments.length+')</strong><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:9px">'+attachments.map(x=>'<div class="ht-mail-attachment"><span class="ht-mail-attachment-icon">▤</span><div class="ht-mail-attachment-info"><strong>'+emailEsc(x.filename||x.name||"Bijlage")+'</strong><small>'+emailEsc(x.content_type||x.type||"Bestand")+'</small></div></div>').join("")+'</div></div>':'')+'<div class="ht-mail-reader-actions">'+(m.direction==="inbound"?'<button type="button" class="primary" onclick="emailReply('+Number(m.id)+')">↩ Beantwoorden</button>':'')+'<button type="button" onclick="emailComposeNew()">＋ Nieuw bericht</button><button type="button" onclick="deleteAdminEmail('+Number(m.id)+')">🗑 Verwijderen</button></div>';
  const cached=adminEmailCache.find(x=>Number(x.id)===Number(id));if(cached)cached.is_read=true;const unread=adminEmailCache.filter(x=>x.direction==="inbound"&&!x.is_read).length;const stat=document.getElementById("emailStatInbox");if(stat)stat.textContent=unread+" ongelezen";renderAdminEmailList();
 }catch(e){box.textContent=e.message;}
}
async function deleteAdminEmail(id){
 const m=adminEmailCache.find(x=>Number(x.id)===Number(id));if(!m||!confirm("Deze e-mail alleen uit de HOMS TECH inbox verwijderen?"))return;
 try{const r=await fetch("/api/admin/emails/"+Number(id),{method:"DELETE",credentials:"same-origin"}),d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||"Bericht verwijderen mislukt.");adminEmailSelectedId=null;document.getElementById("adminEmailDetail").innerHTML='<div class="ht-mail-empty"><span>✉</span><strong>Selecteer een e-mail</strong></div>';await loadAdminEmails();}catch(e){alert(e.message);}
}
function emailComposeNew(){adminEmailReplyToId=null;document.getElementById("adminEmailTo").value="";document.getElementById("adminEmailSubject").value="";document.getElementById("adminEmailBody").value="";document.getElementById("emailComposeTitle").textContent="Nieuw bericht";document.getElementById("adminEmailStatus").textContent="Nieuw e-mailbericht";document.getElementById("adminEmailCc").value="";document.getElementById("adminEmailBcc").value="";clearEmailFiles();document.getElementById("adminEmailTo").focus();}
function emailReply(id){
 const m=adminEmailCache.find(x=>Number(x.id)===Number(id));if(!m)return;adminEmailReplyToId=Number(id);document.getElementById("adminEmailTo").value=m.from_address||"";document.getElementById("adminEmailSubject").value=/^re:/i.test(m.subject||"")?m.subject:"Re: "+(m.subject||"");document.getElementById("adminEmailBody").value="";document.getElementById("emailComposeTitle").textContent="Antwoord op: "+(m.subject||"e-mail");document.getElementById("adminEmailStatus").textContent="Antwoord aan "+m.from_address;document.getElementById("adminEmailBody").focus();}
function toggleEmailCc(which){const el=document.getElementById(which==="cc"?"emailCcRow":"emailBccRow");if(el)el.hidden=!el.hidden;}
function formatEmailText(kind){const el=document.getElementById("adminEmailBody"),a=el.selectionStart,b=el.selectionEnd;if(a===b)return;const selected=el.value.slice(a,b),wrapped=kind==="bold"?"**"+selected+"**":kind==="italic"?"_"+selected+"_":"__"+selected+"__";el.setRangeText(wrapped,a,b,"select");el.focus();}
function insertEmailText(text){const el=document.getElementById("adminEmailBody"),a=el.selectionStart;el.setRangeText(text,a,a,"end");el.focus();}
function clearEmailFiles(){adminEmailFiles=[];const input=document.getElementById("adminEmailFiles");if(input)input.value="";renderEmailFiles();}
function handleEmailFiles(files){
 const allowed=new Set(["image/jpeg","image/png","image/webp","image/gif","image/heic","application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","text/plain"]);
 for(const file of Array.from(files||[])){if(!allowed.has(file.type)&&!(/\.(doc|docx|xls|xlsx|txt)$/i.test(file.name))){alert("Dit bestandstype wordt niet ondersteund: "+file.name);continue;}if(file.size>10*1024*1024){alert(file.name+" is groter dan 10 MB.");continue;}if(adminEmailFiles.reduce((n,x)=>n+x.size,0)+file.size>20*1024*1024){alert("De totale grootte van bijlagen mag maximaal 20 MB zijn.");break;}if(adminEmailFiles.some(x=>x.name===file.name&&x.size===file.size)){continue;}adminEmailFiles.push(file);}
 renderEmailFiles();document.getElementById("adminEmailFiles").value="";
}
function renderEmailFiles(){const box=document.getElementById("emailAttachmentList");if(!box)return;box.innerHTML=adminEmailFiles.map((f,i)=>'<div class="ht-mail-attachment">'+(f.type.startsWith("image/")?'<img src="'+URL.createObjectURL(f)+'" alt="">':'<span class="ht-mail-attachment-icon">▤</span>')+'<div class="ht-mail-attachment-info"><strong>'+emailEsc(f.name)+'</strong><small>'+emailBytes(f.size)+'</small></div><button type="button" aria-label="Bijlage verwijderen" onclick="removeEmailFile('+i+')">×</button></div>').join("");}
function removeEmailFile(i){adminEmailFiles.splice(i,1);renderEmailFiles();}
function emailFileToBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]||"");reader.onerror=()=>reject(new Error("Bestand lezen mislukt: "+file.name));reader.readAsDataURL(file);});}
document.getElementById("adminEmailComposeForm")?.addEventListener("submit",async e=>{
 e.preventDefault();const btn=document.getElementById("adminEmailSendBtn"),status=document.getElementById("adminEmailStatus");btn.disabled=true;status.className="ht-mail-status";status.textContent="E-mail en bijlagen worden voorbereid…";
 try{
  const attachments=[];for(const file of adminEmailFiles)attachments.push({filename:file.name,content:await emailFileToBase64(file),content_type:file.type||"application/octet-stream"});
  const body={to:document.getElementById("adminEmailTo").value.trim(),cc:document.getElementById("adminEmailCc").value.trim(),bcc:document.getElementById("adminEmailBcc").value.trim(),subject:document.getElementById("adminEmailSubject").value.trim(),text:document.getElementById("adminEmailBody").value,attachments,...(adminEmailReplyToId?{replyToId:adminEmailReplyToId}:{})};
  const r=await fetch("/api/admin/emails/send",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),d=await r.json();if(!r.ok)throw Error(d.error||"E-mail verzenden mislukt.");
  status.className="ht-mail-status success";status.textContent="Verzonden naar "+d.to+" · "+attachments.length+" bijlagen";document.getElementById("adminEmailBody").value="";clearEmailFiles();await loadAdminEmails();
 }catch(err){status.className="ht-mail-status error";status.textContent=err.message;}finally{btn.disabled=false;}
});

const DEVICE_STATUS_CUSTOMER=["مفتوح","قيد العمل","مكتمل"];
const DEVICE_STATUS_COMMERCIAL=["تم الشراء","قيد الفحص","قيد التجديد","جاهز للبيع","تم البيع"];
let deviceRegisterCache=[];
let deviceRegisterSummary={};
function deviceEuro(v){return new Intl.NumberFormat("nl-NL",{style:"currency",currency:"EUR"}).format(Number(v)||0)}
function deviceSetStatus(msg,type="info"){const el=document.getElementById("deviceRegisterStatus");if(el){el.textContent=msg;el.className="status "+type}}
function deviceUpdateFields(){
  const typeField=document.getElementById("drType");
  const statusField=document.getElementById("drStatus");
  // The current spreadsheet-style register has no legacy form fields.
  // Do not let optional register UI initialization stop the admin login script.
  if(!typeField||!statusField)return;
  const type=typeField.value,commercial=type==="commercial";
  document.querySelectorAll(".dr-customer-field").forEach(el=>el.style.display=commercial?"none":"block");
  document.querySelectorAll(".dr-commercial-field").forEach(el=>el.style.display=commercial?"block":"none");
  const old=statusField.value,options=commercial?DEVICE_STATUS_COMMERCIAL:DEVICE_STATUS_CUSTOMER;
  statusField.innerHTML=options.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join("");
  if(options.includes(old))statusField.value=old;
}
async function deviceApi(url,options={}){
  const r=await fetch(url,{credentials:"same-origin",...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});
  const d=await r.json().catch(()=>({error:"Ongeldig serverantwoord"}));if(!r.ok)throw Error(d.error||"Actie mislukt");return d;
}

function deviceCell(value,field,id,type="text"){
  return '<td><input class="dr-cell" data-field="'+field+'" data-id="'+id+'" type="'+type+'" value="'+esc(value??"")+'" '+(type==="number"?'min="0" step="0.01"':'')+'></td>';
}
function deviceTypeLabel(type){return type==="commercial"?"Eigen toestel":"Klantreparatie"}
function deviceRenderSummary(){
  const s=deviceRegisterSummary||{};
  const cards=[["Totaal eigen toestellen",Number(s.total||0)],["Klaar voor verkoop",Number(s.ready||0)],["In behandeling",Number(s.processing||0)],["Verkocht",Number(s.sold||0)],["Voorraad investering",deviceEuro(s.invested)],["Verkoop omzet",deviceEuro(s.revenue)],["Gerealiseerde winst",deviceEuro(s.realized_profit)]];
  return '<section aria-label="Voorraad samenvatting" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;margin:0 0 16px">' + cards.map((item,index)=>'<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:13px 14px;min-width:0"><div style="font-size:12px;color:#64748b;font-weight:600">' + item[0] + '</div><div style="font-size:20px;font-weight:800;color:' + (index===6?"#087443":"#102a43") + ';margin-top:5px;overflow-wrap:anywhere">' + item[1] + '</div></div>').join("") + '</section>';
}
function deviceRenderTable(){
  const host=document.getElementById("deviceRegisterTable");if(!host)return;
  const rows=deviceRegisterCache;
  const summaryHtml=deviceRenderSummary();
  if(!rows.length){host.innerHTML=summaryHtml+'<p style="padding:18px;color:#64748b;background:#fff;border:1px solid #e2e8f0;border-radius:12px">Geen toestellen gevonden. Voeg een toestel toe of importeer een Excel-bestand.</p>';return}
  const headers=["Type","IMEI / serienummer / HT-code","Merk","Model / naam","Opslag","Kleur","Conditie","Status","Klantnaam","Telefoon","Ordernummer","Inkoop (€)","Verkoop (€)","Acties"];
  host.innerHTML=summaryHtml+'<div class="dr-sheet-wrap"><table class="dr-sheet"><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+
    rows.map(x=>{const rowId=x.id?String(x.id):"new";return '<tr data-row-id="'+rowId+'">'+
      '<td style="padding:10px 12px;white-space:nowrap;font-weight:700">'+deviceTypeLabel(x.device_type)+'</td>'+
      (x.id?'<td><input class="dr-cell dr-readonly" value="'+esc(x.identifier_value)+'" readonly title="Identificatienummer kan niet inline worden gewijzigd"></td>':deviceCell(x.identifier_value,"identifierValue","new"))+
      deviceCell(x.brand,"brand",rowId)+deviceCell(x.model,"model",rowId)+
      '<td>'+esc(x.storage||"—")+'</td><td>'+esc(x.color||"—")+'</td><td>'+esc(x.device_condition||"—")+'</td>'+
      '<td><select class="dr-cell" data-field="status" data-id="'+Number(x.id)+'">'+(x.device_type==="commercial"?DEVICE_STATUS_COMMERCIAL:DEVICE_STATUS_CUSTOMER).map(v=>'<option '+(v===x.status?"selected":"")+' >'+esc(v)+'</option>').join('')+'</select></td>'+
      deviceCell(x.customer_name,"customerName",rowId)+deviceCell(x.customer_phone,"customerPhone",rowId)+deviceCell(x.repair_order_number,"repairOrderNumber",rowId)+
      deviceCell(x.purchase_cost,"purchaseCost",rowId,"number")+deviceCell(x.sale_price,"salePrice",rowId,"number")+
      '<td class="dr-actions"><button class="btn btn-green" onclick="deviceSaveRow(&quot;'+rowId+'&quot;)">Opslaan</button>'+(x.id?'<button class="btn btn-light" onclick="deviceShowHistory('+Number(x.id)+')">Historie</button><button class="btn btn-light" onclick="deviceAddOperation('+Number(x.id)+')">＋ Kosten / notitie</button>'+(x.device_type==="commercial"&&x.status==="جاهز للبيع"?'<button class="btn btn-green" onclick="deviceRegisterSale('+Number(x.id)+')">Verkoop</button>':'')+'<button class="btn btn-light" onclick="deviceArchive('+Number(x.id)+',true)">Archief</button>':'<span class="small">Nieuwe rij</span>')+'</td></tr>'}).join('')+
    '</tbody></table></div><p class="small" style="margin:10px 0 0">Toestellen uit Inkoop worden automatisch gekoppeld met een HT-code zodra de uitbetaling is afgerond.</p>';
}
async function loadDeviceRegister(){
  const host=document.getElementById("deviceRegisterTable");if(!host)return;host.innerHTML="Laden…";
  try{
    const p=new URLSearchParams(),type=document.getElementById("deviceTypeFilter")?.value||"",q=document.getElementById("deviceSearch")?.value.trim()||"",archived=document.getElementById("deviceArchivedFilter")?.checked||false;
    if(type)p.set("type",type);if(q)p.set("q",q);if(archived)p.set("archived","true");
    const d=await deviceApi("/api/admin/device-register?"+p.toString());deviceRegisterCache=d.devices||[];deviceRegisterSummary=d.summary||{};
    deviceRenderTable();
  }catch(e){host.innerHTML="";deviceSetStatus(e.message,"error")}
}
async function deviceSaveRow(id){
  const row=document.querySelector('tr[data-row-id="'+id+'"]');if(!row)return;
  const value=f=>row.querySelector('[data-field="'+f+'"]')?.value??"";
  const current=deviceRegisterCache.find(x=>String(x.id)===String(id));
  const body={deviceType:current?.device_type||"commercial",identifierType:current?.identifier_type||"imei",identifierValue:value("identifierValue"),brand:value("brand"),model:value("model"),status:value("status"),customerName:value("customerName"),customerPhone:value("customerPhone"),customerEmail:current?.customer_email||"",repairOrderNumber:value("repairOrderNumber"),purchaseCost:value("purchaseCost")||"0",salePrice:value("salePrice")||"0"};
  try{
    if(id==="new"){await deviceApi("/api/admin/device-register",{method:"POST",body:JSON.stringify(body)})}
    else{await deviceApi("/api/admin/device-register/"+id,{method:"PUT",body:JSON.stringify(body)})}
    deviceSetStatus("Rij opgeslagen.","success");await loadDeviceRegister()
  }catch(e){deviceSetStatus(e.message,"error")}
}
function deviceAddBlankRow(){
  deviceRegisterCache.push({id:null,device_type:document.getElementById("deviceTypeFilter")?.value||"commercial",identifier_type:"imei",identifier_value:"",brand:"Apple",model:"",status:(document.getElementById("deviceTypeFilter")?.value==="customer_repair"?"مفتوح":"قيد الفحص"),customer_name:"",customer_phone:"",customer_email:"",repair_order_number:"",purchase_cost:0,sale_price:0});
  deviceRenderTable();const row=document.querySelector('tr[data-row-id="new"]');row?.scrollIntoView({behavior:"smooth",block:"center",inline:"center"});row?.querySelector('[data-field="identifierValue"]')?.focus();deviceSetStatus("Vul de identificatie en modelnaam in en klik op Opslaan.","info");
}
async function deviceLoadXlsx(){
  if(window.XLSX)return;
  await new Promise((resolve,reject)=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";s.onload=resolve;s.onerror=()=>reject(Error("Excel-module kon niet worden geladen. Controleer de internetverbinding."));document.head.appendChild(s)});
}
async function deviceExportExcel(){
  if(!deviceRegisterCache.length){alert("Geen gegevens om te exporteren. Laad eerst het overzicht.");return}
  try{await deviceLoadXlsx();const rows=deviceRegisterCache.map(x=>({"Type":x.device_type==="commercial"?"commercial":"customer_repair","Identificatietype":x.identifier_type,"IMEI / code":x.identifier_value,"Merk":x.brand,"Model / naam":x.model,"Status":x.status,"Klantnaam":x.customer_name,"Telefoon":x.customer_phone,"E-mail":x.customer_email,"Ordernummer":x.repair_order_number,"Inkoopprijs":Number(x.purchase_cost||0),"Verkoopprijs":Number(x.sale_price||0),"Totale kosten":Number(x.purchase_cost||0)+Number(x.recorded_cost||0),"Marge":Number(x.sale_price||0)-Number(x.purchase_cost||0)-Number(x.recorded_cost||0)}));const ws=XLSX.utils.json_to_sheet(rows);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Toestelregister");XLSX.writeFile(wb,"homs-tech-toestelregister.xlsx");deviceSetStatus("Excel-bestand geëxporteerd.","success")}catch(e){deviceSetStatus(e.message,"error")}
}
async function deviceImportExcel(event){
  const file=event.target.files?.[0];if(!file)return;
  try{
    await deviceLoadXlsx();const data=await file.arrayBuffer();const wb=XLSX.read(data,{type:"array"});const ws=wb.Sheets[wb.SheetNames[0]];const raw=XLSX.utils.sheet_to_json(ws,{defval:"",raw:false});
    const norm=s=>String(s??"").trim().toLowerCase().replace(/[ _/()-]/g,"");
    const aliases={deviceType:["type","devicetype","toesteltype"],identifierType:["identificatietype","identifiertype","codetype"],identifierValue:["imei","imeicode","serienummer","barcode","htcode","identificatienummer"],brand:["merk","brand"],model:["model","naam","modelnaam","toestel"],status:["status"],customerName:["klantnaam","klant","customername","naamklant"],customerPhone:["telefoon","telefoonklant","customerphone"],customerEmail:["email","e-mail","klantemail"],repairOrderNumber:["ordernummer","reparatieordernummer","repairordernumber"],purchaseCost:["inkoopprijs","inkoop","purchasecost"],salePrice:["verkoopprijs","verkoop","saleprice"]};
    const get=(r,k)=>{const keys=Object.keys(r);const hit=keys.find(h=>aliases[k].includes(norm(h)));return hit===undefined?"":r[hit]};
    let added=0,skipped=0;
    for(const r of raw){
      const identifierValue=String(get(r,"identifierValue")).trim(),model=String(get(r,"model")).trim();if(!identifierValue||!model){skipped++;continue}
      const deviceType=String(get(r,"deviceType")).toLowerCase().includes("commercial")||String(get(r,"deviceType")).toLowerCase().includes("eigen")?"commercial":"customer_repair";
      const identifierType=String(get(r,"identifierType")).toLowerCase().includes("serial")?"serial":String(get(r,"identifierType")).toLowerCase().includes("barcode")?"barcode":"imei";
      const status=String(get(r,"status")).trim()||(deviceType==="commercial"?"قيد الفحص":"مفتوح");
      const body={deviceType,identifierType,identifierValue,model,brand:String(get(r,"brand")||"Apple"),status,customerName:String(get(r,"customerName")||""),customerPhone:String(get(r,"customerPhone")||""),customerEmail:String(get(r,"customerEmail")||""),repairOrderNumber:String(get(r,"repairOrderNumber")||""),purchaseCost:String(get(r,"purchaseCost")||"0").replace(",","."),salePrice:String(get(r,"salePrice")||"0").replace(",",".")};
      try{await deviceApi("/api/admin/device-register",{method:"POST",body:JSON.stringify(body)});added++}catch(e){skipped++}
    }
    deviceSetStatus("Import klaar: "+added+" toegevoegd, "+skipped+" overgeslagen (lege of dubbele/ongeldige regels).","success");await loadDeviceRegister();
  }catch(e){deviceSetStatus(e.message,"error")}finally{event.target.value=""}
}

async function deviceArchive(id,archived){if(!confirm(archived?"Dit toestel naar het archief verplaatsen? Je kunt het later herstellen.":"Dit toestel herstellen uit het archief?"))return;try{await deviceApi("/api/admin/device-register/"+id+"/archive",{method:"POST",body:JSON.stringify({archived})});deviceSetStatus(archived?"Toestel gearchiveerd.":"Toestel hersteld.","success");loadDeviceRegister()}catch(e){deviceSetStatus(e.message,"error")}}
async function deviceRegisterSale(id){
  const device=deviceRegisterCache.find(x=>Number(x.id)===Number(id));
  if(!device)return;
  if(device.device_type!=="commercial"||device.status!=="جاهز للبيع"){deviceSetStatus("Alleen een eigen toestel met status Klaar voor verkoop kan worden verkocht.","error");return;}
  const price=prompt("Definitieve verkoopprijs in euro",String(device.sale_price||""));
  if(price===null)return;
  const reference=prompt("Verkoopreferentie / ordernummer (optioneel)","");
  if(reference===null)return;
  const description=prompt("Opmerking bij de verkoop (optioneel)","");
  if(description===null)return;
  if(!confirm("Verkoop van "+device.model+" registreren voor € "+price+"? Dit kan niet dubbel worden uitgevoerd."))return;
  try{
    const result=await deviceApi("/api/admin/device-register/"+id+"/sale",{method:"POST",body:JSON.stringify({salePrice:price,reference,description})});
    deviceSetStatus("Verkoop geregistreerd. "+(result.device?.identifier_value||"")+" staat nu op Verkocht.","success");
    await loadDeviceRegister();
    await deviceShowHistory(id);
  }catch(error){deviceSetStatus(error.message,"error");}
}
async function deviceAddOperation(id){
  const device=deviceRegisterCache.find(x=>Number(x.id)===id);if(!device)return;
  const type=prompt("Type handeling: repair, refurbishment, purchase, sale of note","repair");if(type===null)return;
  if(!["repair","refurbishment","purchase","note"].includes(type)){alert("Gebruik repair, refurbishment, purchase of note.");return}
  const description=prompt("Omschrijving van de handeling","");if(description===null)return;
  const status=prompt("Nieuwe status (leeg = status niet wijzigen)",device.status);if(status===null)return;
  const additionalCost=prompt("Extra kosten in euro (0 indien geen)", "0");if(additionalCost===null)return;
  const partsRaw=prompt("Onderdelen als JSON: [{\"name\":\"Scherm\",\"quantity\":1,\"cost\":45}] — leeg indien geen onderdelen","");if(partsRaw===null)return;
  let parts=[];if(partsRaw.trim()){try{parts=JSON.parse(partsRaw);if(!Array.isArray(parts))throw Error()}catch{alert("Onderdelen moeten geldige JSON zijn.");return}}
  const salePrice=prompt("Verkoopprijs bij verkoop (0 indien niet van toepassing)","0");if(salePrice===null)return;
  try{await deviceApi("/api/admin/device-register/"+id+"/operations",{method:"POST",body:JSON.stringify({operationType:type,description,status,additionalCost,parts,salePrice})});deviceSetStatus("Handeling en onderdelen opgeslagen in de historie.","success");loadDeviceRegister();deviceShowHistory(id)}catch(e){deviceSetStatus(e.message,"error")}
}
async function deviceShowHistory(id){
  const panel=document.getElementById("deviceHistoryPanel");if(!panel)return;panel.innerHTML="Historie laden…";
  try{const d=await deviceApi("/api/admin/device-register/"+id+"/operations"),device=deviceRegisterCache.find(x=>Number(x.id)===id);
    panel.innerHTML='<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px"><div class="section-head"><div><h3 style="margin:0">Historie — '+esc(device?.model||"Toestel")+'</h3><p>'+esc(device?.identifier_value||"")+'</p></div><button class="btn btn-light" onclick="document.getElementById(\'deviceHistoryPanel\').innerHTML=\'\'">Sluiten</button></div>'+((d.operations||[]).length?'<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;min-width:620px"><thead><tr><th style="text-align:left;padding:8px">Datum</th><th style="text-align:left;padding:8px">Handeling</th><th style="text-align:left;padding:8px">Omschrijving</th><th style="text-align:left;padding:8px">Onderdelen</th><th style="text-align:left;padding:8px">Extra kosten</th><th style="text-align:left;padding:8px">Status</th></tr></thead><tbody>'+d.operations.map(o=>'<tr style="border-top:1px solid #e2e8f0"><td style="padding:8px">'+esc(new Date(o.created_at).toLocaleString("nl-NL"))+'</td><td style="padding:8px">'+esc(o.operation_type)+'</td><td style="padding:8px">'+esc(o.description)+'</td><td style="padding:8px">'+(Array.isArray(o.parts)?o.parts.map(p=>esc(p.name)+" × "+Number(p.quantity)+" ("+deviceEuro(p.cost)+")").join("<br>"):"")+'</td><td style="padding:8px">'+deviceEuro(o.additional_cost)+'</td><td style="padding:8px">'+esc(o.status||"—")+'</td></tr>').join("")+'</tbody></table></div>':'<p>Nog geen handelingen geregistreerd.</p>')+'</div>';
  }catch(e){panel.innerHTML='<p class="status error">'+esc(e.message)+'</p>'}
}
function deviceExportCsv(){
  const rows=deviceRegisterCache;if(!rows.length){alert("Er zijn geen toestellen om te exporteren. Laad eerst het gewenste overzicht.");return}
  const columns=[["Type","device_type"],["Identificatietype","identifier_type"],["IMEI / code","identifier_value"],["Merk","brand"],["Model","model"],["Status","status"],["Klant","customer_name"],["Telefoon","customer_phone"],["E-mail","customer_email"],["Reparatieorder","repair_order_number"],["Inkoopprijs","purchase_cost"],["Verkoopprijs","sale_price"],["Totale geregistreerde kosten","recorded_cost"],["Verwachte marge","profit"],["Aangemaakt","created_at"],["Bijgewerkt","updated_at"]];
  const csv=[columns.map(x=>x[0]),...rows.map(r=>columns.map(c=>c[1]==="profit"?Number(r.sale_price||0)-Number(r.purchase_cost||0)-Number(r.recorded_cost||0):(r[c[1]]??"")))].map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(";")).join("\r\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="homs-tech-toestelregister.csv";a.click();URL.revokeObjectURL(url);
}

let deviceScannerStream=null,deviceScannerActive=false,deviceScannerDetector=null,deviceScannerFrame=0;
function deviceScannerStop(){
  deviceScannerActive=false;
  if(deviceScannerFrame)cancelAnimationFrame(deviceScannerFrame);
  deviceScannerFrame=0;
  if(deviceScannerStream){deviceScannerStream.getTracks().forEach(track=>track.stop());deviceScannerStream=null}
  const video=document.getElementById("deviceScannerVideo");if(video){video.pause();video.srcObject=null}
  const modal=document.getElementById("deviceScannerModal");if(modal)modal.style.display="none";
}
async function deviceScannerStart(){
  const status=document.getElementById("deviceScannerStatus"),video=document.getElementById("deviceScannerVideo"),modal=document.getElementById("deviceScannerModal");
  if(!navigator.mediaDevices?.getUserMedia){modal.style.display="flex";status.textContent="Camera niet beschikbaar. Open de adminpagina via HTTPS en controleer de camerarechten.";return}
  if(!("BarcodeDetector" in window)){modal.style.display="flex";status.textContent="Deze browser heeft geen ingebouwde barcodescanner. Gebruik een USB/Bluetooth-scanner of voer het nummer handmatig in.";return}
  deviceScannerStop();modal.style.display="flex";status.textContent="Camera starten…";
  try{
    const supported=await BarcodeDetector.getSupportedFormats();
    const formats=["qr_code","code_128","code_39","code_93","ean_13","ean_8","itf","data_matrix","pdf417","aztec"].filter(x=>supported.includes(x));
    if(!formats.length)throw Error("Deze browser ondersteunt geen geschikte barcodeformaten.");
    deviceScannerDetector=new BarcodeDetector({formats});
    deviceScannerStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
    video.srcObject=deviceScannerStream;await video.play();deviceScannerActive=true;status.textContent="Richt de camera op de barcode of QR-code.";
    const scan=async()=>{
      if(!deviceScannerActive)return;
      try{
        if(video.readyState>=2){
          const codes=await deviceScannerDetector.detect(video);
          if(codes?.length){
            const raw=String(codes[0].rawValue||"").trim();
            if(raw){
              const field=document.getElementById("drIdentifierValue");
              const imei=raw.match(/(?:IMEI\s*[:#]?\s*)?(\d{15})(?!\d)/i);
              field.value=imei?imei[1]:raw;field.dispatchEvent(new Event("input",{bubbles:true}));
              field.focus();status.textContent="Barcode gelezen. De camera blijft open; druk op «Lees volledig etiket» om ook model en specificaties te herkennen.";
              deviceScannerActive=false;if(deviceScannerFrame)cancelAnimationFrame(deviceScannerFrame);deviceScannerFrame=0;return;
            }
          }
        }
      }catch(e){status.textContent="Scannen… houd de barcode scherp en goed verlicht."}
      if(deviceScannerActive)deviceScannerFrame=requestAnimationFrame(scan);
    };
    deviceScannerFrame=requestAnimationFrame(scan);
  }catch(e){
    deviceScannerStop();modal.style.display="flex";
    status.textContent=e?.name==="NotAllowedError"?"Cameratoegang geweigerd. Sta camera toe in de browserinstellingen en probeer opnieuw.":("Camera kon niet starten: "+(e.message||"controleer camerarechten."));
  }
}
document.getElementById("drCameraOpen")?.addEventListener("click",deviceScannerStart);
document.getElementById("drCameraClose")?.addEventListener("click",deviceScannerStop);
document.getElementById("drCameraManual")?.addEventListener("click",()=>{deviceScannerStop();document.getElementById("drIdentifierValue")?.focus()});

async function deviceScannerReadLabel(){
  const status=document.getElementById("deviceScannerStatus"),video=document.getElementById("deviceScannerVideo");
  if(!video||video.readyState<2){if(status)status.textContent="Start de camera eerst en houd het etiket scherp in beeld.";return}
  const button=document.getElementById("drCameraOcr");if(button)button.disabled=true;
  try{
    status.textContent="OCR wordt geladen… de afbeelding wordt lokaal in je browser verwerkt.";
    if(!window.Tesseract){
      await new Promise((resolve,reject)=>{
        const script=document.createElement("script");script.src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";script.onload=resolve;script.onerror=()=>reject(Error("OCR-bibliotheek kon niet worden geladen."));document.head.appendChild(script);
      });
    }
    const canvas=document.createElement("canvas"),scale=Math.min(2.5,1800/Math.max(video.videoWidth||1,video.videoHeight||1));
    canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
    const ctx=canvas.getContext("2d");ctx.drawImage(video,0,0,canvas.width,canvas.height);
    status.textContent="Etiket lezen… houd de camera stil.";
    const result=await window.Tesseract.recognize(canvas,"eng",{logger:m=>{if(m.status==="recognizing text")status.textContent="Etiket lezen… "+Math.round((m.progress||0)*100)+"%"}});
    const text=String(result?.data?.text||"").replace(/\r/g,"\n");
    const imeis=[...new Set((text.match(/\b\d[\d\s-]{12,20}\d\b/g)||[]).map(x=>x.replace(/\D/g,"")).filter(x=>x.length===15))];
    const modelCode=(text.match(/\bSM-[A-Z0-9/.-]{4,20}\b/i)||[])[0]||"";
    const storage=(text.match(/\b(128|256|512|1024)\s?GB\b/i)||[])[0]||"";
    const ram=(text.match(/\b(8|12|16)\s?GB\b/i)||[])[0]||"";
    const color=(text.match(/\b(Titanium\s+(?:Black|Gray|Grey|Silver|Blue)|Black|White|Silver|Blue|Green|Pink|Gray|Grey)\b/i)||[])[0]||"";
    let model="";
    if(modelCode){
      const code=modelCode.toUpperCase().replace("/DS","");
      const known={"SM-S938B":"Samsung Galaxy S25 Ultra","SM-S936B":"Samsung Galaxy S25+","SM-S931B":"Samsung Galaxy S25","SM-S928B":"Samsung Galaxy S24 Ultra","SM-S926B":"Samsung Galaxy S24+","SM-S921B":"Samsung Galaxy S24","SM-S918B":"Samsung Galaxy S23 Ultra","SM-S911B":"Samsung Galaxy S23"};
      model=known[code]||("Samsung "+modelCode);
    }
    if(storage)model+=(model?" ":"")+storage.replace(/\s/g,"").toUpperCase();
    if(color)model+=(model?" · ":"")+color.trim();
    const brand=document.getElementById("drBrand"),modelField=document.getElementById("drModel"),identifier=document.getElementById("drIdentifierValue"),identifierType=document.getElementById("drIdentifierType");
    if(model){modelField.value=model;modelField.dispatchEvent(new Event("input",{bubbles:true}));}
    if(modelCode&&brand&&!brand.value.trim())brand.value="Samsung";
    else if(modelCode&&brand)brand.value="Samsung";
    if(imeis.length){
      identifierType.value="imei";identifier.value=imeis[0];identifier.dispatchEvent(new Event("input",{bubbles:true}));
      status.textContent="Etiket gelezen. Model/IMEI ingevuld; controleer de gegevens voor je opslaat."+(imeis.length>1?" Er zijn meerdere IMEI's gevonden; alleen IMEI 1 is ingevuld.":"");
    }else{
      status.textContent="Tekst gelezen, maar geen betrouwbaar 15-cijferig IMEI gevonden. Controleer de belichting en probeer opnieuw.";
    }
    if(!modelCode&&!storage&&!color)status.textContent+=" Model en specificaties konden niet zeker worden herkend; controleer het resultaat.";
  }catch(e){status.textContent="Etiket lezen mislukt: "+(e?.message||"probeer opnieuw of voer handmatig in.");}
  finally{if(button)button.disabled=false;}
}

document.getElementById("drCameraRetry")?.addEventListener("click",deviceScannerStart);
document.getElementById("drCameraOcr")?.addEventListener("click",deviceScannerReadLabel);
document.getElementById("deviceScannerModal")?.addEventListener("click",e=>{if(e.target.id==="deviceScannerModal")deviceScannerStop()});
window.addEventListener("pagehide",deviceScannerStop);
deviceUpdateFields();

/* START */

// Authenticate first. Optional page widgets must never prevent the admin session check.
checkLogin();
try{renderPermissionCheckboxes('newAdminPermissions',[]);}catch(e){console.error("[HOMS TECH] Permission UI initialization failed:",e);}
try{deviceUpdateFields();}catch(e){console.error("[HOMS TECH] Device register UI initialization failed:",e);}

