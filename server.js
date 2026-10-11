require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const path = require("path");
const { importSamFwPage } = require("./lib/samfw-import");

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_URL &&
    !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
      ? { rejectUnauthorized: false }
      : false,
});

app.use(express.json({ limit: "50mb" }));
app.use(cookieParser());

// Never expose server code, deployment metadata, backups, or dotfiles through static hosting.
app.use((req, res, next) => {
  let pathname = String(req.path || "/");
  try { pathname = decodeURIComponent(pathname); } catch { return res.sendStatus(400); }
  const segments = pathname.replace(/\\/g, "/").split("/").filter(Boolean).map(x => x.toLowerCase());
  const blocked = new Set(["server.js", "package.json", "package-lock.json", "render.yaml", "admin-index.html"]);
  if (segments.some(segment =>
    segment.startsWith(".") ||
    blocked.has(segment) ||
    /\.(?:zip|sql|bak|backup|log|db|sqlite|env)$/i.test(segment)
  )) return res.sendStatus(404);
  next();
});
app.use(express.static(__dirname, { dotfiles: "deny", index: "index.html" }));

// Password hashing helpers
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");

    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) return reject(error);

      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

function verifyPassword(password, storedHash) {
  return new Promise((resolve, reject) => {
    const parts = String(storedHash || "").split(":");

    if (parts.length !== 2) {
      return resolve(false);
    }

    const salt = parts[0];
    const storedKey = Buffer.from(parts[1], "hex");

    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) return reject(error);

      if (storedKey.length !== derivedKey.length) {
        return resolve(false);
      }

      resolve(crypto.timingSafeEqual(storedKey, derivedKey));
    });
  });
}

// Send a welcome email through Resend
async function sendWelcomeEmail(customer) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.log("RESEND_API_KEY is not configured; welcome email skipped.");
    return;
  }

  const from = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [customer.email],
      subject: "Welkom bij HOMS TECH",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;color:#222">
          <h1 style="margin-bottom:8px">Welkom bij HOMS TECH 👋</h1>
          <p>Hallo ${escapeHtml(customer.name)},</p>
          <p>Je account is succesvol aangemaakt.</p>
          <p>Je kunt nu smartphones bekijken en later je bestellingen vanuit je account volgen.</p>
          <p style="margin-top:28px"><strong>HOMS TECH</strong><br>Telefoonservice & smartphones</p>
        </div>
      `
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Resend error ${response.status}: ${JSON.stringify(data)}`);
  }

  console.log("Welcome email sent:", data.id || "ok");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Create database tables and default settings
async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS firmware_items (
      id BIGSERIAL PRIMARY KEY,
      parent_id BIGINT REFERENCES firmware_items(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('folder','file')),
      name TEXT NOT NULL,
      file_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      file_size BIGINT NOT NULL DEFAULT 0,
      file_data BYTEA,
      download_url TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("ALTER TABLE firmware_items ADD COLUMN IF NOT EXISTS download_url TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE firmware_items ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE firmware_items ADD COLUMN IF NOT EXISTS thumbnail_url TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE firmware_items ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE");
  await pool.query("ALTER TABLE firmware_items ADD COLUMN IF NOT EXISTS is_new BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query("ALTER TABLE firmware_items ADD COLUMN IF NOT EXISTS new_until TIMESTAMPTZ");
  await pool.query("ALTER TABLE firmware_items ADD COLUMN IF NOT EXISTS download_count BIGINT NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE firmware_items ADD COLUMN IF NOT EXISTS visits BIGINT NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE firmware_items ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]");
  await pool.query("ALTER TABLE firmware_items DROP CONSTRAINT IF EXISTS firmware_items_check");
  await pool.query("ALTER TABLE firmware_items DROP CONSTRAINT IF EXISTS firmware_items_storage_check");
  await pool.query("ALTER TABLE firmware_items ADD CONSTRAINT firmware_items_storage_check CHECK ((kind = 'folder' AND file_data IS NULL AND download_url = '') OR (kind = 'file' AND ((file_data IS NOT NULL AND download_url = '') OR (file_data IS NULL AND download_url <> ''))))");
  await pool.query('CREATE INDEX IF NOT EXISTS firmware_items_parent_idx ON firmware_items(parent_id, kind, name)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_settings (
      id INTEGER PRIMARY KEY,
      data JSONB NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS firmware_download_history (
      id BIGSERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      firmware_item_id BIGINT REFERENCES firmware_items(id) ON DELETE SET NULL,
      file_name TEXT NOT NULL,
      downloaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS firmware_download_history_customer_date_idx ON firmware_download_history (customer_id, downloaded_at DESC)");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_orders (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      service_category TEXT NOT NULL DEFAULT '',
      service_name TEXT NOT NULL DEFAULT '',
      service_group TEXT DEFAULT '',
      price TEXT DEFAULT '',
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT DEFAULT '',
      username TEXT DEFAULT '',
      imei TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Nieuw',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS username TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS provider_reference TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS execution_note TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS result_data TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS execution_updated_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS appointment_date DATE`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS appointment_time TEXT`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS service_source_id TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS service_source_url TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS price_currency TEXT DEFAULT 'EUR'`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS service_instructions TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS required_fields TEXT DEFAULT '[]'`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS source_price TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS source_currency TEXT DEFAULT 'USD'`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS extra_fields TEXT DEFAULT '{}'`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS service_orders_repair_appointment_unique
    ON service_orders (appointment_date, appointment_time)
    WHERE service_category = 'Reparatie'
      AND service_group = 'Aan huis'
      AND appointment_date IS NOT NULL
      AND appointment_time IS NOT NULL
      AND status <> 'Geannuleerd'
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS webshop_orders (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT DEFAULT '',
      street TEXT DEFAULT '',
      house_number TEXT DEFAULT '',
      postcode TEXT DEFAULT '',
      city TEXT DEFAULT '',
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Nieuw',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Payment fields for webshop checkout / PayPal.
  await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS checkout_token TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'Unpaid'`);
  await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS paypal_order_id TEXT DEFAULT ''`);

  const result = await pool.query(
    "SELECT id FROM site_settings WHERE id = 1"
  );

  if (result.rows.length === 0) {
    const defaultData = {
      siteName: "HOMS TECH",
      tagline: "Phone repair at your doorstep",
      phone: "",
      whatsapp: "",
      email: "",
      services: [
        "Screen Replacement",
        "Battery Replacement",
        "Charging Port Repair",
        "Camera Repair",
        "Software Repair"
      ],
      features: [
        "We come to your home",
        "Fast service",
        "Professional repair",
        "Warranty on repairs"
      ],
      devices: [
        {
          name: "iPhone 12",
          price: ""
        },
        {
          name: "iPhone 13",
          price: ""
        },
        {
          name: "iPhone 14",
          price: ""
        },
        {
          name: "iPhone 15",
          price: ""
        },
        {
          name: "iPhone 16",
          price: ""
        },
        {
          name: "iPhone 17",
          price: ""
        }
      ]
    };

    await pool.query(
      "INSERT INTO site_settings (id, data) VALUES (1, $1)",
      [JSON.stringify(defaultData)]
    );
  }

  // Firmware is not part of HOMS TECH GSM: remove its saved category from the catalog.
  await pool.query("UPDATE site_settings SET data = data #- '{gsmServices,firmware}' WHERE id = 1");
}

// Public-facing settings omit supplier cost data and importer diagnostics.
function sanitizePublicSiteData(input) {
  const data = input && typeof input === "object" ? { ...input } : {};
  delete data.gsmImport;
  if (data.gsmServices && typeof data.gsmServices === "object") {
    const privateFields = new Set(["sourcePrice", "sourceCurrency", "sourceUrl", "sourceGroup", "sourceName", "lastSynced"]);
    data.gsmServices = Object.fromEntries(Object.entries(data.gsmServices).map(([category, list]) => [
      category,
      Array.isArray(list) ? list.map(service => {
        if (!service || typeof service !== "object") return service;
        const clean = { ...service };
        for (const key of privateFields) delete clean[key];
        return clean;
      }) : list
    ]));
  }
  return data;
}

// Get website settings
app.get("/api/site", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT data FROM site_settings WHERE id = 1"
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Settings not found"
      });
    }

    res.set("Cache-Control", "no-store");
    let canViewPrivate = false;
    try {
      const user = getAdminFromRequest(req);
      canViewPrivate = !!user && (
        user.role === "superadmin" ||
        user.username === String(process.env.ADMIN_USERNAME || "") ||
        user.permissions?.includes("*") ||
        user.permissions?.includes("gsm.view") ||
        user.permissions?.includes("gsm.import") ||
        user.permissions?.includes("site.save")
      );
    } catch {}
    const data = result.rows[0].data;
    res.json(canViewPrivate ? data : sanitizePublicSiteData(data));
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Server error"
    });
  }
});

// ---------------- EASY-UNLOCKER PUBLIC GSM CATALOG IMPORT ----------------
function easyDecodeHtml(value){return String(value||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<br\s*\/?>(?=.)/gi," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&#(\d+);/g,(_,n)=>{try{return String.fromCodePoint(Number(n))}catch{return ""}}).replace(/&#x([0-9a-f]+);/gi,(_,n)=>{try{return String.fromCodePoint(parseInt(n,16))}catch{return ""}})}
function easyText(value){return easyDecodeHtml(String(value||"").replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim()}
function easySlug(value){return String(value||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,180)}
function easyStableSourceId(baseCategory,group,name){return `easy-${baseCategory}-${easySlug(group)}-${easySlug(name)}`}
function easyInferCategory(baseCategory,group,name){const hay=`${group||""} ${name||""}`.toLowerCase();if(/\bfrp\b|factory reset protection|google frp|samsung frp/.test(hay))return"frp";if(/firmware|flash|flasher|schematic|software/.test(hay))return null;return baseCategory}
function easyParseMoney(value){const m=String(value||"").replace(/,/g,".").match(/(?:\$|€|£|usd|eur|gbp)?\s*([0-9]+(?:\.[0-9]+)?)/i);return m?Number(m[1]):null}
function easyExtractDelivery(cells){const text=`${cells.slice(1,-1).join(" ")} ${cells[0]||""}`;const m=text.match(/(?:instant|[0-9]+\s*(?:-\s*[0-9]+)?\s*(?:minutes?|miniutes?|hours?|days?|weeks?|months?|years?))/i);return m?m[0].trim():""}
function easyKnownServiceMeta(name){
  if(/alcatel worldwide database #2/i.test(name||'')){
    return {
      deliveryTime:'1–12 hours',
      availability:'Available 24/7',
      refund:'No refund for bad requests',
      warning:'The codes are originally from databases. The supplier does not provide a refund for wrong code / wrong request. Do not send verification or force a refund request.',
      supportedModels:'OT-2051X, OT-3023G, OT-4034, OT-4034A, OT-4034D, OT-4034F, OT-4034G, OT-4034I, OT-4034K, OT-4037, OT-4047, OT-4050, OT-4050I, OT-4050S, OT-4088X and other supported Alcatel models listed by the service source.',
      note:'Service details shown here are based on the reference you provided.'
    };
  }
  return null;
}
function easyGuessOrderFields(group,name){
  const hay=`${group||""} ${name||""}`.toLowerCase();
  const fields=[];
  const add=(key,label,type="text",required=false,autoFromEmail=false,placeholder="")=>fields.push({key,label,type,required,autoFromEmail,placeholder});
  // The public catalog does not expose every service's private order form. These are conservative field hints from the service name.
  if(/\bimei\b/.test(hay)) add("imei","IMEI","text",true,false,"Enter IMEI");
  if(/\bserial\b|\[sn\]|\bs\/n\b/.test(hay)) add("serial","Serial / SN","text",true,false,"Enter serial number");
  if(/\bmodel\b/.test(hay)) add("model","Model","text",true,false,"Enter model");
  if(/alcatel worldwide database #2/i.test(name||"")){
    return [
      {key:"imei",label:"IMEI",type:"text",required:true,autoFromEmail:false,placeholder:"Enter IMEI"},
      {key:"model",label:"Model",type:"text",required:true,autoFromEmail:false,placeholder:"Enter model"},
      {key:"notes",label:"Notes",type:"text",required:false,autoFromEmail:false,placeholder:"Additional information"},
      {key:"comments",label:"Comments",type:"textarea",required:false,autoFromEmail:false,placeholder:"For your reference"},
      {key:"response_email",label:"Response e-mail",type:"email",required:true,autoFromEmail:true,placeholder:"Customer e-mail for the reply"}
    ];
  }
  return fields;
}
function normalizeGsmFormFields(service){
  const name=String(service?.name||'').trim();
  if(/alcatel worldwide database #2/i.test(name)){
    return [
      {key:'imei',label:'IMEI',type:'text',required:true,autoFromEmail:false,placeholder:'Enter IMEI'},
      {key:'model',label:'MODEL',type:'text',required:true,autoFromEmail:false,placeholder:'Enter model'},
      {key:'notes',label:'Notes',type:'text',required:false,autoFromEmail:false,placeholder:'Additional information'},
      {key:'comments',label:'Comments',type:'textarea',required:false,autoFromEmail:false,placeholder:'For your reference'},
      {key:'response_email',label:'Response e-mail',type:'email',required:true,autoFromEmail:true,placeholder:'Customer e-mail for the reply'}
    ];
  }
  return Array.isArray(service?.formFields)?service.formFields:[];
}
function easyParseCatalogPage(html,pageUrl,baseCategory){
  const out=[];const tables=String(html||"").match(/<table\b[^>]*>[\s\S]*?<\/table>/gi)||[];
  for(const table of tables){
    const start=String(html).indexOf(table);const before=String(html).slice(Math.max(0,start-3500),start);
    const headings=[...before.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)];
    const group=headings.length?easyText(headings[headings.length-1][1]):"General";
    const rows=table.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)||[];
    for(const row of rows){
      const cells=[...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m=>easyText(m[1])).filter(Boolean);
      if(cells.length<2||/^(price|service)$/i.test(cells[0]))continue;
      const price=easyParseMoney(cells[cells.length-1]);if(!cells[0]||price===null)continue;
      const name=cells[0],category=easyInferCategory(baseCategory,group,name);if(!category)continue;const formFields=easyGuessOrderFields(group,name);
      const requiredFields=formFields.filter(f=>f.required).map(f=>f.key);
      const hasUser=/\b(username|user name|login)\b/i.test(`${group} ${name}`);
      if(hasUser && !requiredFields.includes("username")) {formFields.push({key:"username",label:"Username",type:"text",required:true,autoFromEmail:true,placeholder:"Username / e-mail"});requiredFields.push("username")}
      out.push({source:"easy-unlocker",sourceId:easyStableSourceId(baseCategory,group,name),sourceUrl:pageUrl,sourceGroup:group,sourceName:name,name,group,shortDescription:"",details:name,icon:category==="imei"?"📱":category==="remote"?"🖥️":category==="server"?"🛠️":category==="frp"?"🔐":"🛠️",price:"",sourcePrice:String(price),sourceCurrency:"USD",priceCurrency:"EUR",deliveryTime:easyExtractDelivery(cells),serviceMeta:easyKnownServiceMeta(name),active:true,hot:false,requiresUsername:hasUser,requiresImei:requiredFields.includes("imei"),requiresSerial:requiredFields.includes("serial"),requiredFields,formFields,instructions:"",usernameFromEmail:hasUser,category});
    }
  }
  const unique=new Map();out.forEach(x=>unique.set(x.sourceId,x));return[...unique.values()]
}
const EASY_PUBLIC_GSM_PAGES=[{key:"imei",url:"https://easy-unlocker.com/resellerpricing/imei"},{key:"remote",url:"https://easy-unlocker.com/resellerpricing/remote"},{key:"server",url:"https://easy-unlocker.com/resellerpricing/server"}];
async function fetchEasyPublicCatalog(){const results=await Promise.all(EASY_PUBLIC_GSM_PAGES.map(async page=>{const response=await fetch(page.url,{headers:{"User-Agent":"HOMS-TECH-GSM-Importer/2.0"}});if(!response.ok)throw new Error(`Easy-Unlocker ${page.key}: HTTP ${response.status}`);const html=await response.text();return{...page,services:easyParseCatalogPage(html,page.url,page.key)}}));const all=results.flatMap(x=>x.services),unique=new Map();all.forEach(x=>unique.set(x.sourceId,x));return{pages:results.map(x=>({key:x.key,url:x.url,count:x.services.length})),services:[...unique.values()]}}
function easyCanonicalServiceKey(category,item){
  return [String(category||""),String(item?.sourceGroup||item?.group||"General"),String(item?.sourceName||item?.name||"")].map(v=>easySlug(v)).join("|");
}
function easyIsImportedService(item){return String(item?.source||"").trim().toLowerCase()==="easy-unlocker" || String(item?.sourceId||"").startsWith("easy-") && Boolean(item?.sourceUrl);}
app.post("/api/admin/gsm/import-easy",requirePermission("gsm.import"),async(req,res)=>{try{
  const catalog=await fetchEasyPublicCatalog();
  const current=await pool.query("SELECT data FROM site_settings WHERE id=1");
  if(!current.rows.length)return res.status(404).json({error:"Websitegegevens ontbreken."});
  const data=current.rows[0].data||{};
  if(!data.gsmServices||typeof data.gsmServices!=="object")data.gsmServices={};
  ["imei","remote","server","frp"].forEach(k=>{if(!Array.isArray(data.gsmServices[k]))data.gsmServices[k]=[]});
  const existing=new Map(); let deduplicated=0;
  for(const [category,list] of Object.entries(data.gsmServices)){
    if(!Array.isArray(list))continue;
    const seen=new Map(),clean=[];
    for(const item of list){
      if(!easyIsImportedService(item)){clean.push(item);continue;}
      const key=easyCanonicalServiceKey(category,item);
      if(seen.has(key)){
        const at=seen.get(key),first=clean[at];
        clean[at]={...item,...first,price:String(first.price||item.price||""),active:first.active!==false,hot:first.hot===true,formFields:Array.isArray(first.formFields)&&first.formFields.length?first.formFields:(item.formFields||[]),requiredFields:Array.isArray(first.requiredFields)&&first.requiredFields.length?first.requiredFields:(item.requiredFields||[]),instructions:String(first.instructions||item.instructions||"")};
        deduplicated++; continue;
      }
      seen.set(key,clean.length); clean.push(item);
    }
    data.gsmServices[category]=clean;
  }
  const existingByKey=new Map();
  for(const [category,list] of Object.entries(data.gsmServices)){
    if(!Array.isArray(list))continue;
    list.forEach((item,index)=>{if(!easyIsImportedService(item))return;const key=easyCanonicalServiceKey(category,item);if(!existingByKey.has(key))existingByKey.set(key,{category,index});if(item.sourceId)existingByKey.set("id:"+String(item.sourceId),{category,index});});
  }
  let added=0,updated=0;
  for(const incoming of catalog.services){
    const target=incoming.category;if(!Array.isArray(data.gsmServices[target]))data.gsmServices[target]=[];
    const hit=existingByKey.get("id:"+String(incoming.sourceId))||existingByKey.get(easyCanonicalServiceKey(target,incoming));
    if(hit&&hit.category===target&&data.gsmServices[target][hit.index]){
      const old=data.gsmServices[target][hit.index];
      const legacySameAsUsd=String(old.price||"").trim()!==""&&String(old.price||"").trim()===String(old.sourcePrice||"").trim()&&String(old.sourceCurrency||"").toUpperCase()==="USD";
      data.gsmServices[target][hit.index]={...incoming,...old,source:"easy-unlocker",sourceId:incoming.sourceId,sourceUrl:incoming.sourceUrl,sourceGroup:incoming.sourceGroup,sourceName:incoming.sourceName,name:incoming.name,group:incoming.group,price:legacySameAsUsd?"":String(old.price||"").trim(),priceCurrency:"EUR",sourcePrice:String(incoming.sourcePrice||old.sourcePrice||"").trim(),sourceCurrency:"USD",active:old.active!==false,hot:old.hot===true,requiresUsername:old.requiresUsername===true||incoming.requiresUsername===true,requiresImei:old.requiresImei===true||incoming.requiresImei===true,requiresSerial:old.requiresSerial===true||incoming.requiresSerial===true,requiredFields:Array.isArray(old.requiredFields)&&old.requiredFields.length?old.requiredFields:(incoming.requiredFields||[]),formFields:normalizeGsmFormFields({...incoming,...old,formFields:Array.isArray(old.formFields)&&old.formFields.length?old.formFields:(incoming.formFields||[])}),instructions:String(old.instructions||""),serviceMeta:easyKnownServiceMeta(incoming.name||old.name)||old.serviceMeta||null,usernameFromEmail:old.usernameFromEmail===true||incoming.usernameFromEmail===true,lastSynced:new Date().toISOString()};updated++;
    }else{
      const index=data.gsmServices[target].push({...incoming,lastSynced:new Date().toISOString()})-1;
      existingByKey.set(easyCanonicalServiceKey(target,incoming),{category:target,index});existingByKey.set("id:"+String(incoming.sourceId),{category:target,index});added++;
    }
  }
  data.gsmImport={source:"easy-unlocker",lastImportedAt:new Date().toISOString(),pages:catalog.pages,count:catalog.services.length,added,updated,deduplicated};
  await pool.query("UPDATE site_settings SET data=$1 WHERE id=1",[JSON.stringify(data)]);
  const totalServices=Object.values(data.gsmServices).reduce((n,list)=>n+(Array.isArray(list)?list.length:0),0);
  res.json({success:true,added,updated,deduplicated,total:catalog.services.length,totalServices,pages:catalog.pages,data});
}catch(e){console.error("Easy GSM import error:",e);res.status(502).json({error:`Easy-Unlocker import mislukt: ${e.message}`})}});

// Admin login + permissions
const ADMIN_PERMISSION_NAMES = {
  "general.view":"Algemeen bekijken","services.view":"Diensten bekijken",
  "phones.view":"Telefoons & prijzen bekijken","phones.update":"Telefoons & prijzen wijzigen","categories.view":"Apparaten & categorieën bekijken",
  "used.view":"Gebruikte telefoons bekijken","why.view":"Waarom HOMS TECH bekijken",
  "customers.view":"Klanten bekijken","orders.view":"GSM Orders bekijken",
  "orders.update":"GSM Order-status wijzigen","orders.delete":"GSM Orders verwijderen",
  "webshop_orders.view":"Webshop bestellingen bekijken",
  "webshop_orders.update":"Webshop order-status wijzigen","webshop_orders.delete":"Webshop bestellingen verwijderen",
  "buyback_orders.view":"Inruil aanvragen bekijken","buyback_orders.update":"Inruil status wijzigen","buyback_orders.delete":"Inruil aanvragen verwijderen",
  "gsm.view":"GSM Services bekijken","gsm.import":"GSM Services importeren",
  "site.save":"Websitegegevens opslaan","search":"Admin zoeken","admins.manage":"Admins beheren"
};

function getSuperAdminUser(username){
  return {id:null,username,role:"superadmin",permissions:["*"]};
}

app.post("/api/login", async (req,res)=>{
  try{
    const username=String(req.body?.username||"").trim();
    const password=String(req.body?.password||"");

    if(username===String(process.env.ADMIN_USERNAME||"") && password===String(process.env.ADMIN_PASSWORD||"")){
      const user=getSuperAdminUser(username);
      const token=jwt.sign(user,process.env.JWT_SECRET,{expiresIn:"7d"});
      res.cookie("token",token,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",maxAge:7*24*60*60*1000});
      return res.json({success:true,user});
    }

    const q=await pool.query(`SELECT id,username,password_hash,role,permissions,active
      FROM admin_users WHERE LOWER(username)=LOWER($1) LIMIT 1`,[username]);
    if(!q.rows.length || !q.rows[0].active) return res.status(401).json({error:"Invalid username or password"});

    const a=q.rows[0];
    if(!await verifyPassword(password,a.password_hash))
      return res.status(401).json({error:"Invalid username or password"});

    const user={id:a.id,username:a.username,role:a.role||"admin",permissions:Array.isArray(a.permissions)?a.permissions:[]};
    const token=jwt.sign(user,process.env.JWT_SECRET,{expiresIn:"7d"});
    res.cookie("token",token,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",maxAge:7*24*60*60*1000});
    res.json({success:true,user});
  }catch(e){
    console.error("Admin login error:",e);
    res.status(500).json({error:"Login mislukt"});
  }
});

app.get("/api/me",async (req,res)=>{
  try{
    const token=req.cookies.token;
    if(!token) return res.status(401).json({authenticated:false});
    const user=jwt.verify(token,process.env.JWT_SECRET);
    if(user.username===String(process.env.ADMIN_USERNAME||"")){
      return res.json({authenticated:true,...getSuperAdminUser(user.username)});
    }
    const q=await pool.query(`SELECT id,username,role,permissions,active FROM admin_users WHERE id=$1 OR LOWER(username)=LOWER($2) LIMIT 1`,[user.id||0,user.username||""]);
    if(!q.rows.length || !q.rows[0].active) return res.status(401).json({authenticated:false});
    const a=q.rows[0];
    const normalized={id:a.id,username:a.username,role:a.role||"admin",permissions:Array.isArray(a.permissions)?a.permissions:[]};
    res.json({authenticated:true,...normalized});
  }catch(e){res.status(401).json({authenticated:false});}
});

app.post("/api/logout",(req,res)=>{
  res.clearCookie("token");
  res.json({success:true});
});

function getAdminFromRequest(req){
  const token=req.cookies.token;
  if(!token) return null;
  const user=jwt.verify(token,process.env.JWT_SECRET);
  if(user.username===String(process.env.ADMIN_USERNAME||"")) return getSuperAdminUser(user.username);
  return {id:user.id||null,username:user.username,role:user.role||"admin",permissions:Array.isArray(user.permissions)?user.permissions:[]};
}

function requireAuth(req,res,next){
  try{
    const user=getAdminFromRequest(req);
    if(!user) return res.status(401).json({error:"Not authenticated"});
    req.admin=user; next();
  }catch(e){res.status(401).json({error:"Not authenticated"});}
}

function requirePermission(permission){
  return (req,res,next)=>{
    try{
      const user=getAdminFromRequest(req);
      if(!user) return res.status(401).json({error:"Not authenticated"});
      if(user.role==="superadmin" || user.username===String(process.env.ADMIN_USERNAME||"") || user.permissions.includes("*") || user.permissions.includes(permission)){
        req.admin=user; return next();
      }
      res.status(403).json({error:"Geen toestemming voor deze actie."});
    }catch(e){res.status(401).json({error:"Not authenticated"});}
  };
}

// Firmware library: folders and durable file blobs stored in PostgreSQL.
// Firmware highlights and tracked downloads.
app.get("/api/firmware/highlights", async (req,res) => {
  try {
    const [recent, popular] = await Promise.all([
      pool.query("SELECT id,name,created_at,download_count,(is_new AND COALESCE(new_until,created_at + INTERVAL '6 days') > NOW()) AS is_new FROM firmware_items WHERE kind='file' ORDER BY created_at DESC,id DESC LIMIT 20"),
      pool.query("SELECT id,name,created_at,download_count,(is_new AND COALESCE(new_until,created_at + INTERVAL '6 days') > NOW()) AS is_new FROM firmware_items WHERE kind='file' ORDER BY download_count DESC,created_at DESC,id DESC LIMIT 20")
    ]);
    res.set("Cache-Control","no-store");
    res.json({recent:recent.rows,popular:popular.rows});
  } catch(e) { console.error("Firmware highlights error:",e); res.status(500).json({error:"Could not load firmware highlights"}); }
});
app.get("/api/firmware/detail/:id", async (req,res) => {
  try {
    const id=Number(req.params.id);
    if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:"Invalid file"});
    const viewed=await pool.query("UPDATE firmware_items SET visits=visits+1 WHERE id=$1 AND kind='file' RETURNING id", [id]);
    if(!viewed.rows.length)return res.status(404).json({error:"Firmware file not found"});
    const result=await pool.query(`
      WITH RECURSIVE parents AS (
        SELECT id,parent_id,name,0 AS depth FROM firmware_items WHERE id=$1
        UNION ALL
        SELECT p.id,p.parent_id,p.name,parents.depth+1 FROM firmware_items p JOIN parents ON parents.parent_id=p.id
      )
      SELECT f.id,f.parent_id,f.name,f.file_name,f.mime_type,f.file_size,f.description,f.download_url,f.created_at,
             f.download_count,f.visits,f.tags,(f.is_new AND COALESCE(f.new_until,f.created_at + INTERVAL '6 days') > NOW()) AS is_new,
             COALESCE((SELECT json_agg(json_build_object('id',id,'name',name) ORDER BY depth DESC) FROM parents WHERE depth>0),'[]'::json) AS folders
      FROM firmware_items f WHERE f.id=$1 AND f.kind='file'
    `,[id]);
    if(!result.rows.length)return res.status(404).json({error:"Firmware file not found"});
    res.set("Cache-Control","no-store");
    res.json({item:result.rows[0]});
  } catch(e) { console.error("Firmware detail error:",e); res.status(500).json({error:"Could not load firmware details"}); }
});
app.get("/api/firmware/download/:id", async (req,res) => {
  let client;
  try {
    const id=Number(req.params.id);
    if(!Number.isSafeInteger(id)||id<=0) return res.status(400).send("Invalid file");
    let customerId;
    try {
      const token=req.cookies.customerToken;
      if(!token) throw new Error("Missing customer session");
      const decoded=jwt.verify(token,process.env.JWT_SECRET);
      const customer=await pool.query("SELECT id FROM customers WHERE id=$1",[decoded.customerId]);
      if(!customer.rows.length) throw new Error("Invalid customer session");
      customerId=customer.rows[0].id;
    } catch {
      const returnTo="/firmware.html#file="+encodeURIComponent(id);
      return res.redirect(302,"/account.html?returnTo="+encodeURIComponent(returnTo));
    }
    client=await pool.connect();
    await client.query("BEGIN");
    const result=await client.query("UPDATE firmware_items SET download_count=download_count+1 WHERE id=$1 AND kind='file' RETURNING id,name,file_name,mime_type,file_data,download_url",[id]);
    if(!result.rows.length){await client.query("ROLLBACK");return res.status(404).send("Firmware file not found");}
    const file=result.rows[0];
    await client.query("INSERT INTO firmware_download_history (customer_id,firmware_item_id,file_name) VALUES ($1,$2,$3)",[customerId,file.id,file.name||file.file_name||"Firmwarebestand"]);
    await client.query("COMMIT");
    res.set("Cache-Control","no-store");
    if(file.file_data){
      res.type(file.mime_type||"application/octet-stream");
      res.set("Content-Disposition",'attachment; filename="'+String(file.file_name||file.name||"firmware.bin").replace(/["\\\\\r\n]/g,"_")+'"');
      return res.send(file.file_data);
    }
    let target;
    try { target=new URL(file.download_url); } catch {}
    if(!target||!["http:","https:"].includes(target.protocol)) return res.status(410).send("Download link is unavailable");
    return res.redirect(302,target.toString());
  } catch(e) {
    if(client){try{await client.query("ROLLBACK")}catch{}}
    console.error("Firmware download error:",e);
    return res.status(500).send("Could not start download");
  } finally {if(client)client.release();}
});
app.get("/api/firmware/items", async (req,res) => {
  try {
    const parentRaw = String(req.query.parentId || "").trim();
    const parentId = parentRaw ? Number(parentRaw) : null;
    if (parentRaw && (!Number.isSafeInteger(parentId) || parentId <= 0)) return res.status(400).json({error:"Invalid folder"});
    if (parentId) {
      const parent = await pool.query("SELECT id,kind FROM firmware_items WHERE id=$1",[parentId]);
      if (!parent.rows.length || parent.rows[0].kind !== "folder") return res.status(404).json({error:"Folder not found"});
    }
    const searchTerm=String(req.query.search||"").trim().slice(0,200);
    if(searchTerm){
      const kindRaw=String(req.query.kind||"all");
      const kind=["file","folder"].includes(kindRaw)?kindRaw:"all";
      const pattern="%"+searchTerm+"%";
      const found=await pool.query("SELECT id,parent_id,kind,name,file_name,mime_type,file_size,download_url,description,tags,thumbnail_url,is_active,(CASE WHEN kind='file' THEN (is_new AND COALESCE(new_until,created_at + INTERVAL '6 days') > NOW()) ELSE is_new END) AS is_new,created_at FROM firmware_items WHERE (name ILIKE $1 OR file_name ILIKE $1 OR description ILIKE $1) AND ($2='all' OR kind=$2) ORDER BY CASE kind WHEN 'folder' THEN 0 ELSE 1 END, lower(name), id LIMIT 500",[pattern,kind]);
      res.set("Cache-Control","no-store");
      return res.json({items:found.rows,search:searchTerm});
    }
    const result = await pool.query("SELECT id,parent_id,kind,name,file_name,mime_type,file_size,download_url,description,tags,thumbnail_url,is_active,(CASE WHEN kind='file' THEN (is_new AND COALESCE(new_until,created_at + INTERVAL '6 days') > NOW()) ELSE is_new END) AS is_new,created_at FROM firmware_items WHERE parent_id IS NOT DISTINCT FROM $1 ORDER BY CASE kind WHEN 'folder' THEN 0 ELSE 1 END, lower(name), id",[parentId]);
    res.set("Cache-Control","no-store");
    res.json({items:result.rows});
  } catch(e) { console.error("Firmware list error:",e); res.status(500).json({error:"Could not load firmware folder"}); }
});
app.post("/api/admin/firmware/folders", requirePermission("site.save"), async (req,res) => {
  try {
    const name=String(req.body?.name||"").trim().slice(0,160);
    const description=String(req.body?.description||"").trim().slice(0,200);
    const raw=req.body?.parentId;
    const parentId=raw==null||raw===""?null:Number(raw);
    if(!name) return res.status(400).json({error:"Folder name is required"});
    if(parentId!==null && (!Number.isSafeInteger(parentId)||parentId<=0)) return res.status(400).json({error:"Invalid parent folder"});
    if(parentId!==null){const p=await pool.query("SELECT kind FROM firmware_items WHERE id=$1",[parentId]);if(!p.rows.length||p.rows[0].kind!=="folder")return res.status(404).json({error:"Parent folder not found"});}
    const r=await pool.query("INSERT INTO firmware_items(parent_id,kind,name,description) VALUES($1,'folder',$2,$3) RETURNING id,parent_id,kind,name,description,file_name,mime_type,file_size,created_at",[parentId,name,description]);
    res.status(201).json({item:r.rows[0]});
  } catch(e) { console.error("Firmware folder create error:",e); res.status(500).json({error:"Could not create folder"}); }
});
app.post("/api/admin/firmware/links/:parentId", requirePermission("site.save"), async (req,res) => {
  try {
    const parentId=Number(req.params.parentId);
    if(!Number.isSafeInteger(parentId)||parentId<=0)return res.status(400).json({error:"Invalid folder"});
    const p=await pool.query("SELECT kind FROM firmware_items WHERE id=$1",[parentId]);
    if(!p.rows.length||p.rows[0].kind!=="folder")return res.status(404).json({error:"Folder not found"});
    const name=String(req.body?.name||"").trim().slice(0,220);
    const url=String(req.body?.url||"").trim().slice(0,2048);
    const description=String(req.body?.description||"").trim().slice(0,2000);
    const sizeMbRaw=String(req.body?.sizeMb??"").trim();
    const sizeMb=sizeMbRaw===""?0:Number(sizeMbRaw);
    const tags=Array.isArray(req.body?.tags)?req.body.tags.map(x=>String(x).trim().slice(0,60)).filter(Boolean).slice(0,20):String(req.body?.tags||"").split(",").map(x=>x.trim().slice(0,60)).filter(Boolean).slice(0,20);
    let parsed; try { parsed=new URL(url); } catch {}
    if(!name)return res.status(400).json({error:"File name is required"});
    if(!parsed||!["http:","https:"].includes(parsed.protocol))return res.status(400).json({error:"Enter a valid http or https download link"});
    if(!Number.isFinite(sizeMb)||sizeMb<0||sizeMb>1048576)return res.status(400).json({error:"File size must be between 0 and 1048576 MB"});
    const fileSize=Math.round(sizeMb*1024*1024);
    const result=await pool.query("INSERT INTO firmware_items(parent_id,kind,name,file_name,download_url,description,file_size,tags,is_new,new_until) VALUES($1,'file',$2,$2,$3,$4,$5,$6,$7,CASE WHEN $7 THEN NOW()+INTERVAL '6 days' ELSE NULL END) RETURNING id,parent_id,kind,name,file_name,download_url,description,file_size,tags,is_new,new_until,created_at",[parentId,name,url,description,fileSize,tags,Boolean(req.body?.isNew)]);
    res.status(201).json({item:result.rows[0]});
  } catch(e) { console.error("Firmware link create error:",e); res.status(500).json({error:"Could not save download link"}); }
});
app.post("/api/admin/firmware/samfw/import", requirePermission("site.save"), async (req,res) => {
  try {
    const parentRaw=req.body?.parentId;
    const parentId=parentRaw==null||parentRaw===""?null:Number(parentRaw);
    if(parentId!==null && (!Number.isSafeInteger(parentId)||parentId<=0)) return res.status(400).json({error:"Invalid destination folder"});
    if(parentId!==null){
      const parent=await pool.query("SELECT kind FROM firmware_items WHERE id=$1",[parentId]);
      if(!parent.rows.length||parent.rows[0].kind!=="folder") return res.status(404).json({error:"Destination folder not found"});
    }
    const imported=await importSamFwPage(req.body?.url);
    const existing=await pool.query("SELECT id,name,parent_id FROM firmware_items WHERE kind='file' AND download_url=$1 LIMIT 1",[imported.sourceUrl]);
    if(existing.rows.length) return res.status(200).json({success:true,duplicate:true,item:existing.rows[0],message:"This SamFW source page is already imported."});
    const result=await pool.query(
      "INSERT INTO firmware_items(parent_id,kind,name,file_name,download_url,description,file_size,tags) VALUES($1,'file',$2,$2,$3,$4,$5,$6) RETURNING id,parent_id,kind,name,file_name,download_url,description,file_size,tags,created_at",
      [parentId,imported.name,imported.sourceUrl,imported.description,imported.fileSize,imported.tags]
    );
    res.status(201).json({success:true,duplicate:false,item:result.rows[0],note:"Saved the public source page, not a permanent direct-download URL."});
  } catch(e) {
    const status=e.statusCode||400;
    if(status>=500) console.error("SamFW import error:",e);
    res.status(status).json({error:e.message||"Could not import SamFW page"});
  }
});
app.put("/api/admin/firmware/folders/:id", requirePermission("site.save"), async (req,res) => {
  try {
    const id=Number(req.params.id);
    const name=String(req.body?.name||"").trim().slice(0,160);
    const description=String(req.body?.description||"").trim().slice(0,2000);
    const thumbnailUrl=String(req.body?.thumbnailUrl||"").trim().slice(0,1000);
    const isActive=req.body?.isActive!==false;
    const isNew=req.body?.isNew===true;
    if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:"Invalid folder"});
    if(!name)return res.status(400).json({error:"Folder name is required"});
    if(thumbnailUrl && !/^https:\/\//i.test(thumbnailUrl))return res.status(400).json({error:"Thumbnail must use HTTPS"});
    const result=await pool.query("UPDATE firmware_items SET name=$2,description=$3,thumbnail_url=$4,is_active=$5,is_new=$6 WHERE id=$1 AND kind='folder' RETURNING id,parent_id,kind,name,description,thumbnail_url,is_active,is_new,created_at",[id,name,description,thumbnailUrl,isActive,isNew]);
    if(!result.rows.length)return res.status(404).json({error:"Folder not found"});
    res.json({item:result.rows[0]});
  } catch(e) { console.error("Firmware folder rename error:",e); res.status(500).json({error:"Could not rename folder"}); }
});
app.get("/api/admin/firmware/folders", requirePermission("site.save"), async (req,res) => {
  try {
    const result = await pool.query("SELECT id,parent_id,name FROM firmware_items WHERE kind='folder' ORDER BY lower(name), id");
    res.set("Cache-Control","no-store");
    res.json({folders:result.rows});
  } catch(e) {
    console.error("Firmware folder picker error:",e);
    res.status(500).json({error:"Could not load firmware folders"});
  }
});

app.put("/api/admin/firmware/items/:id/move", requirePermission("site.save"), async (req,res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({error:"Invalid file"});
    const rawParentId = req.body?.parentId;
    const parentId = rawParentId == null || rawParentId === "" ? null : Number(rawParentId);
    if (parentId !== null && (!Number.isSafeInteger(parentId) || parentId <= 0)) {
      return res.status(400).json({error:"Invalid destination folder"});
    }
    const existing = await pool.query("SELECT id,kind FROM firmware_items WHERE id=$1",[id]);
    if (!existing.rows.length) return res.status(404).json({error:"Firmware item not found"});
    if (existing.rows[0].kind !== "file") return res.status(400).json({error:"Only files can be moved"});
    if (parentId !== null) {
      const destination = await pool.query("SELECT id,kind FROM firmware_items WHERE id=$1",[parentId]);
      if (!destination.rows.length || destination.rows[0].kind !== "folder") {
        return res.status(404).json({error:"Destination folder not found"});
      }
    }
    const result = await pool.query(
      "UPDATE firmware_items SET parent_id=$2 WHERE id=$1 AND kind='file' RETURNING id,parent_id,kind,name,file_name,download_url,description,file_size,tags,created_at",
      [id,parentId]
    );
    if (!result.rows.length) return res.status(404).json({error:"Firmware file not found"});
    res.json({success:true,item:result.rows[0]});
  } catch(e) {
    console.error("Firmware move error:",e);
    res.status(500).json({error:"Could not move firmware file"});
  }
});

app.put("/api/admin/firmware/items/:id", requirePermission("site.save"), async (req,res) => {
  try {
    const id=Number(req.params.id);
    if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:"Invalid item"});
    const name=String(req.body?.name||"").trim().slice(0,220);
    const url=String(req.body?.url||"").trim().slice(0,2048);
    const description=String(req.body?.description||"").trim().slice(0,2000);
    const sizeMbRaw=String(req.body?.sizeMb??"").trim();
    const sizeMb=sizeMbRaw===""?0:Number(sizeMbRaw);
    const tags=Array.isArray(req.body?.tags)?req.body.tags.map(x=>String(x).trim().slice(0,60)).filter(Boolean).slice(0,20):String(req.body?.tags||"").split(",").map(x=>x.trim().slice(0,60)).filter(Boolean).slice(0,20);
    let parsed; try { parsed=new URL(url); } catch {}
    if(!name)return res.status(400).json({error:"File name is required"});
    if(!parsed||!["http:","https:"].includes(parsed.protocol))return res.status(400).json({error:"Enter a valid http or https download link"});
    if(!Number.isFinite(sizeMb)||sizeMb<0||sizeMb>1048576)return res.status(400).json({error:"File size must be between 0 and 1048576 MB"});
    const fileSize=Math.round(sizeMb*1024*1024);
    const result=await pool.query("UPDATE firmware_items SET name=$2,file_name=$2,download_url=$3,description=$4,file_size=$5,tags=$6,is_new=$7,new_until=CASE WHEN $7 THEN CASE WHEN is_new AND COALESCE(new_until,created_at + INTERVAL '6 days') > NOW() THEN COALESCE(new_until,created_at + INTERVAL '6 days') ELSE NOW()+INTERVAL '6 days' END ELSE NULL END WHERE id=$1 AND kind='file' RETURNING id,parent_id,kind,name,file_name,download_url,description,file_size,tags,(is_new AND new_until > NOW()) AS is_new,new_until,created_at",[id,name,url,description,fileSize,tags,Boolean(req.body?.isNew)]);
    if(!result.rows.length)return res.status(404).json({error:"Firmware file not found"});
    res.json({item:result.rows[0]});
  } catch(e) { console.error("Firmware file update error:",e); res.status(500).json({error:"Could not update firmware file"}); }
});
app.delete("/api/admin/firmware/items/:id", requirePermission("site.save"), async (req,res) => {
  try {
    const id=Number(req.params.id);
    if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:"Invalid item"});
    const item=await pool.query("SELECT id,kind FROM firmware_items WHERE id=$1",[id]);
    if(!item.rows.length)return res.status(404).json({error:"Item not found"});
    if(item.rows[0].kind==="folder"){const child=await pool.query("SELECT 1 FROM firmware_items WHERE parent_id=$1 LIMIT 1",[id]);if(child.rows.length)return res.status(409).json({error:"Folder is not empty. Delete its contents first."});}
    await pool.query("DELETE FROM firmware_items WHERE id=$1",[id]);
    res.json({success:true});
  } catch(e) { console.error("Firmware delete error:",e); res.status(500).json({error:"Could not delete item"}); }
});

app.get("/api/admin/users",requirePermission("admins.manage"),async(req,res)=>{
  try{
    const q=await pool.query(`SELECT id,username,role,permissions,active,created_at FROM admin_users ORDER BY created_at ASC`);
    res.json({users:q.rows});
  }catch(e){console.error(e);res.status(500).json({error:"Admins konden niet worden geladen."});}
});

app.post("/api/admin/users",requirePermission("admins.manage"),async(req,res)=>{
  try{
    const username=String(req.body?.username||"").trim();
    const password=String(req.body?.password||"");
    const permissions=Array.isArray(req.body?.permissions)?[...new Set(req.body.permissions.map(String))]:[];
    if(!username||!password) return res.status(400).json({error:"Gebruikersnaam en wachtwoord zijn verplicht."});
    if(username.toLowerCase()===String(process.env.ADMIN_USERNAME||"").trim().toLowerCase())
      return res.status(400).json({error:"Deze gebruikersnaam is gereserveerd voor de hoofdadmin."});
    if(password.length<8) return res.status(400).json({error:"Het wachtwoord moet minimaal 8 tekens bevatten."});
    const exists=await pool.query("SELECT id FROM admin_users WHERE LOWER(username)=LOWER($1)",[username]);
    if(exists.rows.length) return res.status(409).json({error:"Deze admin-gebruikersnaam bestaat al."});
    const hash=await hashPassword(password);
    const q=await pool.query(`INSERT INTO admin_users(username,password_hash,role,permissions,active)
      VALUES($1,$2,'admin',$3::jsonb,TRUE)
      RETURNING id,username,role,permissions,active,created_at`,[username,hash,JSON.stringify(permissions)]);
    res.status(201).json({success:true,user:q.rows[0]});
  }catch(e){console.error(e);res.status(500).json({error:"Admin kon niet worden aangemaakt."});}
});

app.put("/api/admin/users/:id",requirePermission("admins.manage"),async(req,res)=>{
  try{
    const id=Number(req.params.id), username=String(req.body?.username||"").trim();
    const password=String(req.body?.password||"");
    const permissions=Array.isArray(req.body?.permissions)?[...new Set(req.body.permissions.map(String))]:[];
    const active=req.body?.active!==false;
    if(!Number.isInteger(id)||id<1) return res.status(400).json({error:"Ongeldig admin-ID."});
    if(!username) return res.status(400).json({error:"Gebruikersnaam is verplicht."});
    if(username.toLowerCase()===String(process.env.ADMIN_USERNAME||"").trim().toLowerCase())
      return res.status(400).json({error:"De hoofdadmin wordt beheerd via Render Environment Variables."});
    const dup=await pool.query("SELECT id FROM admin_users WHERE LOWER(username)=LOWER($1) AND id<>$2",[username,id]);
    if(dup.rows.length) return res.status(409).json({error:"Deze gebruikersnaam bestaat al."});
    let q;
    if(password){
      if(password.length<8) return res.status(400).json({error:"Het wachtwoord moet minimaal 8 tekens bevatten."});
      const hash=await hashPassword(password);
      q=await pool.query(`UPDATE admin_users SET username=$1,password_hash=$2,permissions=$3::jsonb,active=$4
        WHERE id=$5 RETURNING id,username,role,permissions,active,created_at`,[username,hash,JSON.stringify(permissions),active,id]);
    }else{
      q=await pool.query(`UPDATE admin_users SET username=$1,permissions=$2::jsonb,active=$3
        WHERE id=$4 RETURNING id,username,role,permissions,active,created_at`,[username,JSON.stringify(permissions),active,id]);
    }
    if(!q.rows.length) return res.status(404).json({error:"Admin niet gevonden."});
    res.json({success:true,user:q.rows[0]});
  }catch(e){console.error(e);res.status(500).json({error:"Admin kon niet worden bijgewerkt."});}
});

app.delete("/api/admin/users/:id",requirePermission("admins.manage"),async(req,res)=>{
  try{
    const id=Number(req.params.id);
    const q=await pool.query("DELETE FROM admin_users WHERE id=$1 RETURNING id",[id]);
    if(!q.rows.length) return res.status(404).json({error:"Admin niet gevonden."});
    res.json({success:true});
  }catch(e){console.error(e);res.status(500).json({error:"Admin kon niet worden verwijderd."});}
});

app.get("/api/admin/search",requirePermission("search"),async(req,res)=>{
  try{
    const q=String(req.query?.q||"").trim();
    if(q.length<2) return res.json({customers:[],orders:[],webshopOrders:[]});
    const like=`%${q}%`;
    const [customers,orders,webshopOrders]=await Promise.all([
      pool.query(`SELECT id,name,email,phone,address,created_at FROM customers
        WHERE name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 OR address ILIKE $1
        ORDER BY created_at DESC LIMIT 20`,[like]),
      pool.query(`SELECT id,service_name,service_category,name,email,phone,username,imei,status,created_at FROM service_orders
        WHERE CAST(id AS TEXT) ILIKE $1 OR service_name ILIKE $1 OR service_category ILIKE $1 OR name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 OR username ILIKE $1 OR imei ILIKE $1
        ORDER BY created_at DESC LIMIT 20`,[like]),
      pool.query(`SELECT id,name,email,phone,city,postcode,status,total,created_at FROM webshop_orders
        WHERE CAST(id AS TEXT) ILIKE $1 OR name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 OR city ILIKE $1 OR postcode ILIKE $1
        ORDER BY created_at DESC LIMIT 20`,[like])
    ]);
    res.json({customers:customers.rows,orders:orders.rows,webshopOrders:webshopOrders.rows});
  }catch(e){console.error(e);res.status(500).json({error:"Zoeken mislukt."});}
});

// Customer registration
app.post("/api/customer/register", async (req, res) => {
  try {
    const {
      name,
      email,
      phone = "",
      address = "",
      password
    } = req.body || {};

    const cleanName = String(name || "").trim();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPhone = String(phone || "").trim();
    const cleanAddress = String(address || "").trim();

    if (!cleanName || !cleanEmail || !password) {
      return res.status(400).json({
        error: "Vul naam, e-mail en wachtwoord in."
      });
    }

    if (String(password).length < 8) {
      return res.status(400).json({
        error: "Het wachtwoord moet minimaal 8 tekens bevatten."
      });
    }

    const existing = await pool.query(
      "SELECT id FROM customers WHERE email = $1",
      [cleanEmail]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: "Er bestaat al een account met dit e-mailadres."
      });
    }

    const passwordHash = await hashPassword(String(password));

    const result = await pool.query(
      `INSERT INTO customers
        (name, email, phone, address, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, phone, address`,
      [
        cleanName,
        cleanEmail,
        cleanPhone,
        cleanAddress,
        passwordHash
      ]
    );

    const customer = result.rows[0];

    // Do not block account creation if the email provider has a temporary error.
    sendWelcomeEmail(customer).catch((error) => {
      console.error("Welcome email failed:", error.message);
    });

    const customerToken = jwt.sign(
      {
        customerId: customer.id,
        email: customer.email
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "30d"
      }
    );

    res.cookie("customerToken", customerToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000
    });

    res.status(201).json({
      success: true,
      customer
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Account aanmaken mislukt."
    });
  }
});

// Customer login
app.post("/api/customer/login", async (req, res) => {
  try {
    const {
      email,
      password
    } = req.body || {};

    const cleanEmail = String(email || "").trim().toLowerCase();

    if (!cleanEmail || !password) {
      return res.status(400).json({
        error: "Vul e-mail en wachtwoord in."
      });
    }

    const result = await pool.query(
      `SELECT id, name, email, phone, address, password_hash
       FROM customers
       WHERE email = $1`,
      [cleanEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: "Ongeldig e-mailadres of wachtwoord."
      });
    }

    const customer = result.rows[0];

    const valid = await verifyPassword(
      String(password),
      customer.password_hash
    );

    if (!valid) {
      return res.status(401).json({
        error: "Ongeldig e-mailadres of wachtwoord."
      });
    }

    delete customer.password_hash;

    const customerToken = jwt.sign(
      {
        customerId: customer.id,
        email: customer.email
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "30d"
      }
    );

    res.cookie("customerToken", customerToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000
    });

    res.json({
      success: true,
      customer
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Inloggen mislukt."
    });
  }
});

// Check customer login
app.get("/api/customer/me", async (req, res) => {
  try {
    const token = req.cookies.customerToken;

    if (!token) {
      return res.status(401).json({
        authenticated: false
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    const result = await pool.query(
      `SELECT id, name, email, phone, address
       FROM customers
       WHERE id = $1`,
      [decoded.customerId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        authenticated: false
      });
    }

    res.json({
      authenticated: true,
      customer: result.rows[0]
    });
  } catch (error) {
    res.status(401).json({
      authenticated: false
    });
  }
});

// Per-customer firmware download history. Identity is derived only from the signed HttpOnly session.
app.get("/api/customer/downloads", async (req,res) => {
  try {
    const token=req.cookies.customerToken;
    if(!token)return res.status(401).json({error:"Log in om uw downloads te bekijken."});
    const decoded=jwt.verify(token,process.env.JWT_SECRET);
    const customer=await pool.query("SELECT id FROM customers WHERE id=$1",[decoded.customerId]);
    if(!customer.rows.length)return res.status(401).json({error:"Log in om uw downloads te bekijken."});
    const result=await pool.query(
      "SELECT id,firmware_item_id,file_name,downloaded_at FROM firmware_download_history WHERE customer_id=$1 ORDER BY downloaded_at DESC,id DESC LIMIT 200",
      [customer.rows[0].id]
    );
    res.set("Cache-Control","no-store");
    res.json({downloads:result.rows});
  } catch(e) {
    res.status(401).json({error:"Log in om uw downloads te bekijken."});
  }
});

// Customer logout
app.post("/api/customer/logout", (req, res) => {
  res.clearCookie("customerToken");

  res.json({
    success: true
  });
});

// ---------------- GSM PROVIDER BOUNDARY ----------------
const { getEasyUnlockerApiReadiness, GSM_CATEGORIES, validateDynamicFieldValues } = require("./lib/gsm-provider");
const { createEasyUnlockerClient } = require("./lib/easy-unlocker-api");

// Admin-only status endpoint. It never returns credentials or makes upstream calls.
app.get("/api/admin/gsm/provider-status", requirePermission("gsm.view"), async (req, res) => {
  try {
    const site = await pool.query("SELECT data FROM site_settings WHERE id = 1");
    const savedData = site.rows[0]?.data || {};
    const catalog = savedData.gsmServices || {};
    const importMeta = savedData.gsmImport && typeof savedData.gsmImport === "object"
      ? { source: String(savedData.gsmImport.source || ""), lastImportedAt: savedData.gsmImport.lastImportedAt || null, count: Number(savedData.gsmImport.count || 0), pages: Array.isArray(savedData.gsmImport.pages) ? savedData.gsmImport.pages.map(page => ({ key: String(page.key || ""), count: Number(page.count || 0) })) : [] }
      : null;
    const categories = GSM_CATEGORIES.map(key => ({
      key,
      count: Array.isArray(catalog[key]) ? catalog[key].length : 0,
      active: Array.isArray(catalog[key]) ? catalog[key].filter(item => item && item.active !== false).length : 0
    }));
    res.set("Cache-Control", "no-store");
    res.json({
      success: true,
      provider: getEasyUnlockerApiReadiness(),
      categories,
      importMeta,
      totalServices: categories.reduce((sum, category) => sum + category.count, 0)
    });
  } catch (error) {
    console.error("GSM provider status error:", error);
    res.status(500).json({ error: "GSM provider status kon niet worden geladen." });
  }
});

// Admin-only catalog endpoint for the future provider adapter and integration tests.
app.get("/api/admin/gsm/catalog", requirePermission("gsm.view"), async (req, res) => {
  try {
    const site = await pool.query("SELECT data FROM site_settings WHERE id = 1");
    if (!site.rows.length) return res.status(404).json({ error: "Websitegegevens ontbreken." });
    const catalog = site.rows[0]?.data?.gsmServices || {};
    const result = {};
    for (const category of GSM_CATEGORIES) {
      result[category] = Array.isArray(catalog[category]) ? catalog[category] : [];
    }
    res.set("Cache-Control", "no-store");
    res.json({ success: true, categories: result });
  } catch (error) {
    console.error("GSM admin catalog error:", error);
    res.status(500).json({ error: "GSM catalogus kon niet worden geladen." });
  }
});

// Admin-only, read-only upstream probe. Returns response shape only, never the API key or full payload.
app.get("/api/admin/gsm/easy-unlocker/test-services", requirePermission("gsm.import"), async (req, res) => {
  const client = createEasyUnlockerClient();
  if (!client.config.configured) {
    return res.status(503).json({
      success: false,
      error: "Easy-Unlocker API settings are incomplete. No upstream request was sent.",
      missingConfig: client.config.missing
    });
  }

  try {
    const response = await client.listServices();
    const data = response.data;
    const shape = { rootType: Array.isArray(data) ? "array" : data === null ? "null" : typeof data };
    if (typeof data === "string") {
      shape.contentLength = data.length;
      shape.xmlTags = [...new Set([...data.matchAll(/<([A-Za-z_][A-Za-z0-9_:.-]*)/g)].map(match => match[1]))].slice(0, 30);
    } else if (Array.isArray(data)) {
      shape.count = data.length;
      shape.firstItemKeys = data[0] && typeof data[0] === "object" ? Object.keys(data[0]).slice(0, 40) : [];
    } else if (data && typeof data === "object") {
      shape.topLevelKeys = Object.keys(data).slice(0, 50);
      const arrays = [];
      const inspect = (value, path, depth) => {
        if (arrays.length >= 12 || depth > 3 || value == null) return;
        if (Array.isArray(value)) {
          arrays.push({
            path,
            count: value.length,
            firstItemKeys: value[0] && typeof value[0] === "object" ? Object.keys(value[0]).slice(0, 40) : []
          });
          return;
        }
        if (typeof value === "object") {
          for (const [key, child] of Object.entries(value).slice(0, 50)) inspect(child, path ? path + "." + key : key, depth + 1);
        }
      };
      inspect(data, "", 0);
      shape.arrays = arrays;
    }
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, httpStatus: response.status, contentType: response.contentType, shape });
  } catch (error) {
    const status = error?.code === "EASY_UNLOCKER_HTTP_ERROR" ? 502 : error?.name === "AbortError" ? 504 : 502;
    console.error("Easy-Unlocker read-only probe failed:", error?.code || error?.name || "unknown");
    return res.status(status).json({
      success: false,
      error: error?.name === "AbortError" ? "Easy-Unlocker API request timed out." : "Easy-Unlocker API request failed.",
      upstreamStatus: Number.isInteger(error?.status) ? error.status : undefined
    });
  }
});

// ---------------- GSM SERVICE ORDERS ----------------

// ---------------- REPAIR / SERVICE ORDERS ----------------

app.get("/api/repair/availability", async (req, res) => {
  try {
    const date = String(req.query.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Ongeldige datum." });
    }

    const result = await pool.query(`
      SELECT appointment_time
      FROM service_orders
      WHERE service_category = 'Reparatie'
        AND service_group = 'Aan huis'
        AND appointment_date = $1::date
        AND appointment_time IS NOT NULL
        AND status <> 'Geannuleerd'
      ORDER BY appointment_time
    `, [date]);

    res.json({
      success: true,
      date,
      booked: result.rows.map(r => r.appointment_time)
    });
  } catch (error) {
    console.error("Repair availability error:", error);
    res.status(500).json({ error: "Beschikbaarheid kon niet worden geladen." });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const {
      serviceCategory = "",
      serviceName = "",
      serviceGroup = "",
      price = "",
      name = "",
      email = "",
      phone = "",
      username = "",
      imei = "",
      serial = "",
      notes = "",
      serviceSourceId = "",
      priceCurrency = "EUR",
      appointmentDate = "",
      appointmentTime = "",
      extraFields = {}
    } = req.body || {};

    const clean = {
      serviceCategory: String(serviceCategory || "").trim(),
      serviceName: String(serviceName || "").trim(),
      serviceGroup: String(serviceGroup || "").trim(),
      price: String(price || "").trim(),
      name: String(name || "").trim(),
      email: String(email || "").trim().toLowerCase(),
      phone: String(phone || "").trim(),
      username: String(username || "").trim(),
      imei: String(imei || "").trim(),
      serial: String(serial || "").trim(),
      notes: String(notes || "").trim(),
      serviceSourceId: String(serviceSourceId || "").trim(),
      priceCurrency: String(priceCurrency || "EUR").trim().toUpperCase(),
      appointmentDate: String(appointmentDate || "").trim(),
      appointmentTime: String(appointmentTime || "").trim(),
      extraFields: (extraFields && typeof extraFields === "object") ? extraFields : {}
    };

    const isHomeRepair =
      clean.serviceCategory.toLowerCase() === "reparatie" &&
      clean.serviceGroup.toLowerCase() === "aan huis";

    if (isHomeRepair) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(clean.appointmentDate)) {
        return res.status(400).json({ error: "Kies een datum voor uw afspraak." });
      }
      if (!/^\d{2}:\d{2} - \d{2}:\d{2}$/.test(clean.appointmentTime)) {
        return res.status(400).json({ error: "Kies een beschikbaar tijdstip." });
      }

      // Prevent direct API submissions for times outside the public schedule.
      const allowedTimes = new Set([
        "09:00 - 10:00",
        "10:00 - 11:00",
        "11:00 - 12:00",
        "12:00 - 13:00",
        "13:00 - 14:00",
        "14:00 - 15:00",
        "15:00 - 16:00",
        "16:00 - 17:00",
        "17:00 - 18:00",
        "18:00 - 19:00"
      ]);

      if (!allowedTimes.has(clean.appointmentTime)) {
        return res.status(400).json({ error: "Ongeldig tijdstip." });
      }
    }

    // Repair orders share this endpoint. Only supplier-linked orders must always
    // declare a supported GSM category; ordinary repair categories remain valid.
    if (clean.serviceSourceId && !GSM_CATEGORIES.includes(clean.serviceCategory.toLowerCase())) {
      return res.status(400).json({ error: "Ongeldige GSM-servicecategorie." });
    }

    if (!clean.serviceName || !clean.name || !clean.email || !clean.phone) {
      return res.status(400).json({
        error: "Vul naam, e-mail en telefoonnummer in."
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) {
      return res.status(400).json({
        error: "Vul een geldig e-mailadres in."
      });
    }

    let matchedService = null;
    try {
      const site = await pool.query("SELECT data FROM site_settings WHERE id = 1");
      const gsm = site.rows[0]?.data?.gsmServices || {};
      if (clean.serviceSourceId) {
        for (const [categoryKey, list] of Object.entries(gsm)) {
          if (!Array.isArray(list)) continue;
          const found = list.find(x => String(x?.sourceId || "") === clean.serviceSourceId);
          if (found) {
            if (found.active === false) {
              return res.status(400).json({ error: "Deze service is momenteel niet beschikbaar." });
            }
            if (GSM_CATEGORIES.includes(String(clean.serviceCategory || "").toLowerCase()) && categoryKey !== String(clean.serviceCategory).toLowerCase()) {
              return res.status(400).json({ error: "Servicecategorie komt niet overeen." });
            }
            matchedService = found;
            break;
          }
        }
        if (!matchedService) return res.status(400).json({ error: "Deze service bestaat niet meer. Vernieuw de pagina." });
      } else {
          // Locally created services may not have a supplier sourceId. Match
          // them against the saved catalog so client-supplied prices/fields
          // cannot bypass the authoritative service configuration.
          const category = String(clean.serviceCategory || "").trim().toLowerCase();
          if (GSM_CATEGORIES.includes(category)) {
            const list = Array.isArray(gsm[category]) ? gsm[category] : [];
            const wantedName = clean.serviceName.toLowerCase();
            const wantedGroup = clean.serviceGroup.toLowerCase();
            const candidates = list.filter(item =>
              item && item.active !== false &&
              String(item.name || "").trim().toLowerCase() === wantedName &&
              (!wantedGroup || String(item.group || "").trim().toLowerCase() === wantedGroup)
            );
            if (candidates.length > 1) {
              return res.status(400).json({ error: "Deze service is niet uniek. Kies de service opnieuw." });
            }
            if (candidates.length === 1) matchedService = candidates[0];
          }
        }
        if (matchedService) {
          // HOMS TECH customer price is always EUR. Never fall back to the USD source price.
          clean.price = String(matchedService.price || "").trim();
          clean.priceCurrency = "EUR";
          const extra = { ...clean.extraFields };
          // Dynamic order fields are the single source of truth for service-specific inputs.
          if (!clean.imei && extra.imei) clean.imei = String(extra.imei).trim();
          if (!clean.username && extra.username) clean.username = String(extra.username).trim();
          if (!clean.serial && extra.serial) clean.serial = String(extra.serial).trim();
          const required = new Set(Array.isArray(matchedService.requiredFields) ? matchedService.requiredFields : []);
          if (matchedService.requiresUsername === true) required.add("username");
          if (matchedService.requiresImei === true) required.add("imei");
          if (matchedService.requiresSerial === true) required.add("serial");
          if (required.has("username") && !clean.username) return res.status(400).json({error:"Deze service vereist een gebruikersnaam."});
          if (required.has("imei") && !clean.imei) return res.status(400).json({error:"Deze service vereist een IMEI."});
          if (required.has("serial") && !clean.serial) return res.status(400).json({error:"Deze service vereist een serienummer."});
          clean.extraFields = extra;
      }
    } catch(e) {
      console.error("GSM catalog lookup error:",e);
      return res.status(500).json({ error: "Servicecatalogus kon niet worden gecontroleerd. Probeer het later opnieuw." });
    }
    if (matchedService) {
      const formFields = Array.isArray(matchedService.formFields) ? matchedService.formFields : [];
      const extra = { ...clean.extraFields };
      for (const field of formFields) {
        if (!field || !field.key) continue;
        if (field.autoFromEmail === true && String(extra[field.key] || "").trim() === "") extra[field.key] = clean.email;
      }
      const validation = validateDynamicFieldValues(formFields, extra);
      if (!validation.valid && validation.reason === "required") {
        return res.status(400).json({error:`Vul het verplichte veld in: ${validation.label}.`});
      }
      if (!validation.valid && validation.reason === "invalid_option") {
        return res.status(400).json({error:`Ongeldige keuze voor veld: ${validation.label}.`});
      }
      clean.extraFields = extra;
      if (matchedService.usernameFromEmail === true && !clean.username) clean.username = clean.email;
    }
    const serviceInstructions = String(matchedService?.instructions || "").trim();
    const requiredFieldList = Array.isArray(matchedService?.requiredFields) ? [...matchedService.requiredFields] : [];
    for (const f of (Array.isArray(matchedService?.formFields) ? matchedService.formFields : [])) if (f?.required && f?.key && !requiredFieldList.includes(f.key)) requiredFieldList.push(f.key);
    const requiredFieldsSnapshot = JSON.stringify(requiredFieldList);
    const sourcePriceSnapshot = String(matchedService?.sourcePrice || "").trim();
    const sourceCurrencySnapshot = String(matchedService?.sourceCurrency || "USD").trim().toUpperCase();

    let customerId = null;
    try {
      if (req.cookies.customerToken) {
        const decoded = jwt.verify(req.cookies.customerToken, process.env.JWT_SECRET);
        customerId = decoded.customerId || null;
      }
    } catch {}

    const result = await pool.query(
      `INSERT INTO service_orders
       (customer_id, service_category, service_name, service_group, price, name, email, phone, username, imei, notes, service_source_id, service_source_url, price_currency, appointment_date, appointment_time, service_instructions, required_fields, source_price, source_currency, extra_fields)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING id, status, created_at, appointment_date, appointment_time`,
      [
        customerId, clean.serviceCategory, clean.serviceName, clean.serviceGroup, clean.price,
        clean.name, clean.email, clean.phone, clean.username, clean.imei, clean.notes,
        clean.serviceSourceId, matchedService?.sourceUrl || "", clean.priceCurrency,
        isHomeRepair ? clean.appointmentDate : null, isHomeRepair ? clean.appointmentTime : null,
        serviceInstructions, requiredFieldsSnapshot, sourcePriceSnapshot, sourceCurrencySnapshot, JSON.stringify(clean.extraFields || {})
      ]
    );

    res.status(201).json({
      success: true,
      order: result.rows[0]
    });
  } catch (error) {
    console.error("Create service order error:", error);

    if (
      error &&
      error.code === "23505" &&
      error.constraint === "service_orders_repair_appointment_unique"
    ) {
      return res.status(409).json({
        error: "Dit tijdstip is helaas al bezet. Kies een ander tijdstip."
      });
    }

    res.status(500).json({
      error: "Bestelling kon niet worden aangemaakt."
    });
  }
});

// Recalculate webshop prices from the trusted catalog; never trust browser-supplied totals.
function moneyNumber(value) {
  let cleaned = String(value ?? "").replace(/[€\s]/g, "").trim();
  if (!cleaned) return NaN;
  const comma = cleaned.lastIndexOf(",");
  const dot = cleaned.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    cleaned = comma > dot ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "");
  } else if (comma >= 0) {
    cleaned = /,\d{3}$/.test(cleaned) ? cleaned.replace(/,/g, "") : cleaned.replace(",", ".");
  } else if (/\.\d{3}(?:\.\d{3})*$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, "");
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}
function serverOptionDelta(option, key) {
  if (!option) return 0;
  const label = String(option.label || "").toLowerCase();
  if (key === "battery") return label.includes("nieuw") ? 30 : 0;
  if (key === "vat") return label.includes("met btw") ? 10 : 0;
  const raw = option.priceDelta ?? option.delta ?? option.priceAdjustment ?? option.extra ?? option.amount ?? option.value;
  if (raw !== undefined && raw !== null && raw !== "") {
    const n = moneyNumber(raw);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  const match = String(option.label || "").match(/([+-])\s*€?\s*(\d+(?:[.,]\d+)?)\s*$/);
  if (match) {
    const amount = Number(match[2].replace(",", "."));
    return match[1] === "-" ? -amount : amount;
  }
  if (option.price !== undefined && option.price !== null && option.price !== "") {
    const n = moneyNumber(option.price);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}
function serverOptionDefaults(key) {
  const defaults = {
    condition: ["Zichtbaar gebruikt", "Licht gebruikt", "Zo goed als nieuw"],
    storage: ["64 GB", "128 GB", "256 GB", "512 GB", "1 TB"],
    color: ["Zwart", "Wit", "Blauw", "Rood"],
    battery: ["Standaard", "Nieuw (100%)"],
    vat: ["Zonder BTW", "Met BTW"],
    tradeIn: ["Nee", "Ja"]
  };
  return (defaults[key] || []).map(label => ({ label, active: true, enabled: true, available: true, priceDelta: 0 }));
}
function priceProductFromCatalog(data, item) {
  const type = String(item?.type || "").toLowerCase();
  const list = type === "used"
    ? (Array.isArray(data.usedPhones) ? data.usedPhones : [])
    : (Array.isArray(data.phones) && data.phones.length ? data.phones : (Array.isArray(data.devices) ? data.devices : []));
  const id = Number(item?.id);
  if (!Number.isInteger(id) || id < 0 || id >= list.length) return { error: "Een product in uw winkelwagen is verouderd. Verwijder het en voeg het opnieuw toe." };
  const product = list[id];
  if (!product || product.active === false || product.available === false || String(product.stockStatus || "").toLowerCase() === "sold") {
    return { error: "Een product in uw winkelwagen is niet meer beschikbaar." };
  }
  const options = item.options && typeof item.options === "object" && !Array.isArray(item.options) ? item.options : {};
  const getList = key => {
    const map = { condition: "conditionOptions", storage: "storageOptions", color: "colorOptions", battery: "batteryOptions", vat: "vatOptions", tradeIn: "tradeInOptions" };
    const raw = product[map[key]];
    if (Array.isArray(raw) && raw.length) return raw.filter(x => x && x.label && x.active !== false && x.enabled !== false);
    if (key === "storage" || key === "color") {
      const own = key === "storage" ? (Array.isArray(product.storage) ? product.storage[0] : product.storage || product.geheugen || "") : (product.color || product.kleur || "");
      return own ? [{ label: String(own), active: true, enabled: true, available: true, priceDelta: 0 }] : serverOptionDefaults(key);
    }
    return serverOptionDefaults(key);
  };
  const chosen = {};
  for (const key of ["condition", "storage", "color", "battery", "vat", "tradeIn"]) {
    const requested = String(options[key] ?? "");
    if (!requested) continue;
    const option = getList(key).find(x => String(x.label) === requested);
    if (!option || (key !== "storage" && key !== "color" && option.available === false)) {
      return { error: "Een gekozen productoptie is niet geldig of niet beschikbaar. Controleer uw winkelwagen." };
    }
    chosen[key] = option;
  }
  const condition = chosen.condition;
  const base = condition && (condition.basePrice !== undefined || condition.conditionBasePrice !== undefined)
    ? moneyNumber(condition.basePrice ?? condition.conditionBasePrice)
    : moneyNumber(product.price ?? product.salePrice ?? product.sellPrice ?? 0);
  if (!Number.isFinite(base) || base < 0) return { error: "De prijs van een product is ongeldig. Neem contact met ons op." };
  let total = base;
  for (const key of ["storage", "color", "battery", "vat", "tradeIn"]) total += serverOptionDelta(chosen[key], key);
  total = Math.max(0, total);
  if (!Number.isFinite(total) || total <= 0) return { error: "Dit product heeft momenteel geen geldige verkoopprijs." };
  const qty = Number(item?.qty ?? 1);
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) return { error: "Kies een geldige hoeveelheid (1–99)." };
  return {
    item: {
      name: String(product.name || "Smartphone"),
      brand: String(product.brand || ""),
      type,
      id,
      options: Object.fromEntries(Object.entries(options).filter(([key, value]) => ["storage", "color", "condition", "battery", "vat", "tradeIn"].includes(key) && String(value ?? "").trim() !== "")),
      qty,
      unitPrice: Math.round(total * 100) / 100
    }
  };
}

// ---------------- WEBSHOP ORDERS ----------------

app.post("/api/webshop/orders", async (req, res) => {
  try {
    const body = req.body || {};
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const phone = String(body.phone || "").trim();
    const street = String(body.street || "").trim();
    const houseNumber = String(body.houseNumber || "").trim();
    const postcode = String(body.postcode || "").trim();
    const city = String(body.city || "").trim();
    const items = Array.isArray(body.items) ? body.items : [];

    if (!name || !email || !phone || !street || !houseNumber || !postcode || !city || !items.length) {
      return res.status(400).json({ error: "Vul alle verplichte gegevens in en controleer uw winkelwagen." });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Vul een geldig e-mailadres in." });
    }

    let customerId = null;
    try {
      if (req.cookies.customerToken) {
        const decoded = jwt.verify(req.cookies.customerToken, process.env.JWT_SECRET);
        customerId = decoded.customerId || null;
      }
    } catch {}

    if (items.length > 50) return res.status(400).json({ error: "Te veel producten in één bestelling." });
    const catalogResult = await pool.query("SELECT data FROM site_settings WHERE id = 1");
    const catalogData = catalogResult.rows[0]?.data || {};
    const safeItems = [];
    for (const item of items) {
      const priced = priceProductFromCatalog(catalogData, item);
      if (priced.error) return res.status(400).json({ error: priced.error });
      safeItems.push(priced.item);
    }
    const total = safeItems.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
    if (!Number.isFinite(total) || total <= 0 || total > 100000) {
      return res.status(400).json({ error: "Het totaalbedrag van uw bestelling is ongeldig." });
    }
    const checkoutToken = crypto.randomBytes(32).toString("hex");
    const checkoutTokenHash = crypto.createHash("sha256").update(checkoutToken).digest("hex");

    const result = await pool.query(
      `INSERT INTO webshop_orders
       (customer_id, name, email, phone, street, house_number, postcode, city, items, total, checkout_token, payment_method, payment_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, status, payment_method, payment_status, paypal_order_id, created_at`,
      [
        customerId, name, email, phone, street, houseNumber, postcode, city,
        JSON.stringify(safeItems), total.toFixed(2), checkoutTokenHash, "PayPal", "Unpaid"
      ]
    );

    res.status(201).json({ success: true, order: { ...result.rows[0], checkout_token: checkoutToken } });
  } catch (error) {
    console.error("Create webshop order error:", error);
    res.status(500).json({ error: "Webshop bestelling kon niet worden opgeslagen." });
  }
});

function getPayPalBaseUrl() {
  return String(process.env.PAYPAL_MODE || "sandbox").toLowerCase() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function getPayPalAccessToken() {
  const clientId = String(process.env.PAYPAL_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.PAYPAL_CLIENT_SECRET || "").trim();

  if (!clientId || !clientSecret) {
    throw new Error("PayPal is nog niet geconfigureerd op de server.");
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(`PayPal authenticatie mislukt (${response.status}).`);
  }
  return data.access_token;
}

// Frontend only receives the public client ID; the secret never leaves the server.
app.get("/api/paypal/config", (req, res) => {
  const clientId = String(process.env.PAYPAL_CLIENT_ID || "").trim();
  if (!clientId) {
    return res.status(503).json({ enabled: false, error: "PayPal is nog niet geconfigureerd." });
  }

  res.json({
    enabled: true,
    clientId,
    mode: String(process.env.PAYPAL_MODE || "sandbox").toLowerCase() === "live" ? "live" : "sandbox"
  });
});

app.post("/api/paypal/create-order", async (req, res) => {
  try {
    const localOrderId = Number(req.body?.orderId);
    const checkoutToken = String(req.body?.checkoutToken || "").trim();
    if (!Number.isInteger(localOrderId) || localOrderId < 1 || !/^[a-f0-9]{64}$/.test(checkoutToken)) {
      return res.status(400).json({ error: "Ongeldige checkoutgegevens." });
    }

    const checkoutTokenHash = crypto.createHash("sha256").update(checkoutToken).digest("hex");
    const local = await pool.query(
      `SELECT id, name, email, total, payment_status
       FROM webshop_orders
       WHERE id = $1 AND checkout_token = $2`,
      [localOrderId, checkoutTokenHash]
    );

    if (!local.rows.length) {
      return res.status(404).json({ error: "Webshop bestelling niet gevonden." });
    }

    const order = local.rows[0];
    if (order.payment_status === "Paid") {
      return res.status(409).json({ error: "Deze bestelling is al betaald." });
    }

    const total = Number(order.total);
    if (!Number.isFinite(total) || total <= 0) {
      return res.status(400).json({ error: "Het orderbedrag is ongeldig." });
    }

    const accessToken = await getPayPalAccessToken();

    const response = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": `homs-tech-${localOrderId}-${Date.now()}`
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: `HOMS-${localOrderId}`,
          description: `HOMS TECH bestelling #${localOrderId}`,
          custom_id: String(localOrderId),
          amount: {
            currency_code: "EUR",
            value: total.toFixed(2)
          }
        }],
        application_context: {
          brand_name: "HOMS TECH",
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING"
        }
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.id) {
      console.error("PayPal create order response:", response.status, data);
      return res.status(502).json({ error: "PayPal kon de betaling niet starten." });
    }

    await pool.query(
      `UPDATE webshop_orders
       SET paypal_order_id = $1, payment_method = 'PayPal', payment_status = 'Pending'
       WHERE id = $2 AND checkout_token = $3`,
      [String(data.id), localOrderId, checkoutToken]
    );

    res.json({ success: true, id: data.id, orderId: localOrderId });
  } catch (error) {
    console.error("PayPal create order error:", error);
    res.status(500).json({ error: error.message || "PayPal betaling kon niet worden gestart." });
  }
});

app.post("/api/paypal/capture-order", async (req, res) => {
  try {
    const localOrderId = Number(req.body?.orderId);
    const paypalOrderId = String(req.body?.paypalOrderId || "").trim();
    const checkoutToken = String(req.body?.checkoutToken || "").trim();

    if (!Number.isInteger(localOrderId) || localOrderId < 1 || !paypalOrderId || !/^[a-f0-9]{64}$/.test(checkoutToken)) {
      return res.status(400).json({ error: "Ongeldige PayPal betaalgegevens." });
    }

    const checkoutTokenHash = crypto.createHash("sha256").update(checkoutToken).digest("hex");
    const local = await pool.query(
      `SELECT id, total, paypal_order_id, payment_status
       FROM webshop_orders
       WHERE id = $1 AND checkout_token = $2`,
      [localOrderId, checkoutTokenHash]
    );

    if (!local.rows.length) {
      return res.status(404).json({ error: "Webshop bestelling niet gevonden." });
    }

    const order = local.rows[0];

    if (String(order.paypal_order_id || "") !== paypalOrderId) {
      return res.status(400).json({ error: "PayPal order komt niet overeen met de webshop bestelling." });
    }

    if (order.payment_status === "Paid") {
      return res.json({ success: true, paid: true, orderId: localOrderId });
    }

    const accessToken = await getPayPalAccessToken();

    const response = await fetch(
      `${getPayPalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: "{}"
      }
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("PayPal capture response:", response.status, data);
      return res.status(502).json({ error: "PayPal kon de betaling niet bevestigen." });
    }

    const captureStatus = String(data.status || "").toUpperCase();
    const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
    const captureState = String(capture?.status || "").toUpperCase();

    const captureAmount = moneyNumber(capture?.amount?.value);
    const captureCurrency = String(capture?.amount?.currency_code || "").toUpperCase();
    const expectedAmount = moneyNumber(order.total);
    if (
      data.id !== paypalOrderId ||
      captureStatus !== "COMPLETED" ||
      captureState !== "COMPLETED" ||
      captureCurrency !== "EUR" ||
      !Number.isFinite(captureAmount) ||
      !Number.isFinite(expectedAmount) ||
      Math.abs(captureAmount - expectedAmount) > 0.005
    ) {
      await pool.query(
        `UPDATE webshop_orders SET payment_status = $1 WHERE id = $2`,
        ["Failed", localOrderId]
      );
      return res.status(402).json({ error: "PayPal betaling is niet voltooid.", paypalStatus: captureStatus });
    }

    await pool.query(
      `UPDATE webshop_orders
       SET payment_status = 'Paid', payment_method = 'PayPal'
       WHERE id = $1`,
      [localOrderId]
    );

    res.json({
      success: true,
      paid: true,
      orderId: localOrderId,
      paypalOrderId,
      captureId: capture?.id || null
    });
  } catch (error) {
    console.error("PayPal capture error:", error);
    res.status(500).json({ error: error.message || "PayPal betaling kon niet worden bevestigd." });
  }
});

app.post("/api/paypal/cancel-order", async (req, res) => {
  try {
    const localOrderId = Number(req.body?.orderId);
    const checkoutToken = String(req.body?.checkoutToken || "").trim();
    if (!Number.isInteger(localOrderId) || localOrderId < 1 || !/^[a-f0-9]{64}$/.test(checkoutToken)) {
      return res.status(400).json({ error: "Ongeldige checkoutgegevens." });
    }

    const checkoutTokenHash = crypto.createHash("sha256").update(checkoutToken).digest("hex");
    await pool.query(
      `UPDATE webshop_orders
       SET payment_status = CASE WHEN payment_status <> 'Paid' THEN 'Cancelled' ELSE payment_status END
       WHERE id = $1 AND checkout_token = $2`,
      [localOrderId, checkoutTokenHash]
    );

    res.json({ success: true });
  } catch (error) {
    console.error("PayPal cancel error:", error);
    res.status(500).json({ error: "Betaling kon niet worden bijgewerkt." });
  }
});

app.get("/api/admin/webshop-orders", requirePermission("webshop_orders.view"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, customer_id, name, email, phone, street, house_number, postcode, city, items, total, status,
              payment_method, payment_status, paypal_order_id, created_at
       FROM webshop_orders
       ORDER BY created_at DESC`
    );
    res.json({ orders: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Webshop bestellingen konden niet worden geladen." });
  }
});

app.put("/api/admin/webshop-orders/:id/status", requirePermission("webshop_orders.update"), async (req, res) => {
  try {
    const allowed = ["Nieuw", "In behandeling", "Verzonden", "Voltooid", "Geannuleerd"];
    const status = String(req.body?.status || "").trim();
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "Ongeldige status." });
    }
    const result = await pool.query(
      `UPDATE webshop_orders SET status = $1 WHERE id = $2 RETURNING id, status`,
      [status, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Webshop bestelling niet gevonden." });
    res.json({ success: true, order: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Status kon niet worden gewijzigd." });
  }
});


app.delete("/api/admin/webshop-orders/:id", requirePermission("webshop_orders.delete"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Ongeldig order-ID." });
    }

    const result = await pool.query(
      "DELETE FROM webshop_orders WHERE id = $1 RETURNING id",
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Bestelling niet gevonden." });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Delete webshop order error:", error);
    res.status(500).json({ error: "Bestelling kon niet worden verwijderd." });
  }
});


app.get("/api/customer/orders", requireCustomerAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, service_category, service_name, service_group, price, price_currency, source_price, source_currency, service_instructions, required_fields, extra_fields, service_source_id, service_source_url, name, email, phone, username, imei, notes, status, created_at
       FROM service_orders
       WHERE customer_id = $1
       ORDER BY created_at DESC`,
      [req.customerId]
    );

    res.json({ orders: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Bestellingen konden niet worden geladen." });
  }
});

app.get("/api/admin/orders", requirePermission("orders.view"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, customer_id, service_category, service_name, service_group, price, price_currency, source_price, source_currency, service_instructions, required_fields, extra_fields, service_source_id, service_source_url, name, email, phone, username, imei, notes, status, provider_reference, execution_note, result_data, execution_updated_at, created_at
       FROM service_orders
       ORDER BY created_at DESC`
    );

    res.json({ orders: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Bestellingen konden niet worden geladen." });
  }
});

app.put("/api/admin/orders/:id/execution", requirePermission("orders.update"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Ongeldig ordernummer." });
    const providerReference = String(req.body?.provider_reference || "").trim();
    const executionNote = String(req.body?.execution_note || "").trim();
    const resultData = String(req.body?.result_data || "").trim();
    if (providerReference.length > 180 || executionNote.length > 4000 || resultData.length > 12000) {
      return res.status(400).json({ error: "Een veld is te lang. Maximaal: referentie 180, interne notitie 4000, resultaat 12000 tekens." });
    }
    const existing = await pool.query("SELECT id, service_category FROM service_orders WHERE id = $1", [id]);
    if (!existing.rows.length) return res.status(404).json({ error: "Bestelling niet gevonden." });
    const category = String(existing.rows[0].service_category || "").toLowerCase();
    if (["reparatie", "repair", "webshop", "product"].includes(category)) {
      return res.status(400).json({ error: "Dit uitvoeringslogboek is alleen bedoeld voor GSM-orders." });
    }
    const result = await pool.query(
      "UPDATE service_orders SET provider_reference = $1, execution_note = $2, result_data = $3, execution_updated_at = NOW() WHERE id = $4 RETURNING id, service_category, provider_reference, execution_note, result_data, execution_updated_at",
      [providerReference, executionNote, resultData, id]
    );
    res.json({ success: true, order: result.rows[0], manualOnly: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Uitvoeringsgegevens konden niet worden opgeslagen." });
  }
});
app.put("/api/admin/orders/:id/status", requirePermission("orders.update"), async (req, res) => {
  try {
    const allowed = ["Nieuw", "In behandeling", "Wacht op klant", "Wacht op leverancier", "Resultaat ontvangen", "Mislukt", "Voltooid", "Geannuleerd"];
    const status = String(req.body?.status || "").trim();

    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "Ongeldige status." });
    }

    const result = await pool.query(
      `UPDATE service_orders SET status = $1 WHERE id = $2 RETURNING id, status`,
      [status, req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Bestelling niet gevonden." });
    }

    res.json({ success: true, order: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Status kon niet worden gewijzigd." });
  }
});

// Authentication middleware
function requireCustomerAuth(req, res, next) {
  try {
    const token = req.cookies.customerToken;

    if (!token) {
      return res.status(401).json({
        error: "Niet ingelogd"
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.customerId = decoded.customerId;
    next();
  } catch (error) {
    res.status(401).json({
      error: "Niet ingelogd"
    });
  }
}

// Update website settings

app.delete("/api/admin/orders/:id", requirePermission("orders.delete"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Ongeldig order-ID." });
    }

    const result = await pool.query(
      "DELETE FROM service_orders WHERE id = $1 RETURNING id",
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Order niet gevonden." });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Delete GSM order error:", error);
    res.status(500).json({ error: "Order kon niet worden verwijderd." });
  }
});


async function refreshAdminUserFromDb(user){
  if(!user) return null;
  if(user.role==="superadmin" || user.username===String(process.env.ADMIN_USERNAME||"") || user.permissions?.includes("*")) return user;
  try{
    const q=await pool.query(`SELECT id,username,role,permissions,active FROM admin_users WHERE id=$1 OR LOWER(username)=LOWER($2) LIMIT 1`,[user.id||0,user.username||""]);
    if(!q.rows.length || !q.rows[0].active) return null;
    const a=q.rows[0];
    return {id:a.id,username:a.username,role:a.role||"admin",permissions:Array.isArray(a.permissions)?a.permissions:[]};
  }catch(e){
    console.error("Refresh admin permissions error:",e);
    return user;
  }
}

async function requireSiteOrPhoneUpdate(req,res,next){
  try{
    let user=getAdminFromRequest(req);
    if(!user) return res.status(401).json({error:"Not authenticated"});
    user=await refreshAdminUserFromDb(user);
    if(!user) return res.status(401).json({error:"Admin account is inactive or no longer exists."});
    if(user.role==="superadmin" || user.username===String(process.env.ADMIN_USERNAME||"") || user.permissions.includes("*") || user.permissions.includes("site.save")){
      req.admin=user; return next();
    }
    const section=String(req.headers["x-homs-admin-section"]||"").trim().toLowerCase();
    if(section==="phones" && user.permissions.includes("phones.update")){
      req.admin=user; return next();
    }
    return res.status(403).json({error:"Geen toestemming voor deze wijziging."});
  }catch(e){ return res.status(401).json({error:"Not authenticated"}); }
}

app.put("/api/site", requireSiteOrPhoneUpdate, async (req, res) => {
  try {
    const section=String(req.headers["x-homs-admin-section"]||"").trim().toLowerCase();
    if(section==="phones" && req.admin.permissions && req.admin.permissions.includes("phones.update") && !req.admin.permissions.includes("site.save") && req.admin.role!=="superadmin" && !req.admin.permissions.includes("*")){
      const current=await pool.query("SELECT data FROM site_settings WHERE id=1");
      const existing=current.rows[0]?.data || {};
      const incoming=req.body || {};
      const keys=new Set([...Object.keys(existing),...Object.keys(incoming)]);
      for(const key of keys){
        if(key==="phones") continue;
        if(JSON.stringify(existing[key])!==JSON.stringify(incoming[key])){
          return res.status(403).json({error:"Deze admin mag alleen Telefoons & prijzen wijzigen."});
        }
      }
    }
    await pool.query(
      "UPDATE site_settings SET data = $1 WHERE id = 1",
      [JSON.stringify(req.body)]
    );

    res.json({
      success: true,
      data: req.body
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Could not save settings"
    });
  }
});

// Admin - get registered customers
app.get("/api/admin/customers", requirePermission("customers.view"), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        name,
        email,
        phone,
        address,
        created_at
      FROM customers
      ORDER BY created_at DESC
    `);

    res.json({
      customers: result.rows
    });
  } catch (error) {
    console.error("Admin customers error:", error);

    res.status(500).json({
      error: "Kan klanten niet laden."
    });
  }
});

// Admin page
app.get("/admin", (req, res) => {
  res.sendFile(
    path.join(__dirname, "admin", "index.html")
  );
});

app.get("/admin/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "admin", "index.html")
  );
});

// Start server
initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        `HOMS TECH running on port ${PORT}`
      );
    });
  })
  .catch((error) => {
    console.error(
      "Database initialization failed:",
      error
    );

    process.exit(1);
  });

// =====================================================
// BUYBACK / UW TOESTEL VERKOPEN ORDERS
// =====================================================
async function ensureBuybackOrdersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS buyback_orders (
      id SERIAL PRIMARY KEY,
      order_no TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      device TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      model TEXT DEFAULT '',
      storage TEXT DEFAULT '',
      condition TEXT DEFAULT '',
      face_id TEXT DEFAULT '',
      battery TEXT DEFAULT '',
      screen TEXT DEFAULT '',
      offered_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      iban TEXT DEFAULT '',
      payment_method TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Nieuw',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Keep this compatible with an already-existing buyback_orders table.
  await pool.query(`ALTER TABLE buyback_orders ADD COLUMN IF NOT EXISTS order_no TEXT`);
  await pool.query(`ALTER TABLE buyback_orders ADD COLUMN IF NOT EXISTS model TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE buyback_orders ADD COLUMN IF NOT EXISTS iban TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE buyback_orders ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT ''`);
  await pool.query(`UPDATE buyback_orders SET order_no = 'BT-LEGACY-' || id WHERE order_no IS NULL`);
  await pool.query(`ALTER TABLE buyback_orders ALTER COLUMN order_no SET NOT NULL`);
}

// Buyback quote calculator. The admin supplies only the four condition base prices.
// The server applies the shared evaluation rules to the selected answers.
const BUYBACK_PROTOCOLS = Object.freeze({
  // Protocol 1 keeps the existing HOMS TECH calculation.
  '1': Object.freeze({functionsNotWorkingMultiplier:0.70,batteryUnder85Multiplier:0.90}),
  // Protocol 2 matches the new flow shown by the user:
  // functions = no -> 33.3333333333% discount, battery <85% -> 10%.
  '2': Object.freeze({functionsNotWorkingMultiplier:1-(33.3333333333/100),batteryUnder85Multiplier:0.90})
});

app.post("/api/buyback/calculate", async (req, res) => {
  try {
    const b = req.body || {};
    const protocol = String(b.protocol || "2") === "1" ? "1" : "2";
    const rules = BUYBACK_PROTOCOLS[protocol];

    let price = Number(b.conditionBasePrice);
    const storageDelta = Number(b.storageDelta || 0);
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: "Ongeldige basis-inkoopprijs." });
    }
    if (!Number.isFinite(storageDelta)) {
      return res.status(400).json({ error: "Ongeldige opslagprijsaanpassing." });
    }

    // The server starts from the condition price entered by Admin.
    // Storage adjustment is applied before the condition/function rules.
    price = Math.max(0, price + storageDelta);

    const condition = String(b.condition || "").trim();
    const battery = String(b.battery || "").trim();
    const functions = String(b.functions || "").trim();
    const functionsNoLabel = String(b.functionsNoLabel || "Nee").trim();
    const batteryNoLabel = String(b.batteryNoLabel || "Nee").trim();

    // Admin can change the discount values per phone/protocol.
    const functionsDiscount = Math.max(0, Math.min(100,
      Number.isFinite(Number(b.functionsDiscount)) ? Number(b.functionsDiscount) :
      (1-rules.functionsNotWorkingMultiplier)*100
    ));
    const batteryDiscount = Math.max(0, Math.min(100,
      Number.isFinite(Number(b.batteryDiscount)) ? Number(b.batteryDiscount) :
      (1-rules.batteryUnder85Multiplier)*100
    ));

    const fnMultiplier = Math.max(0, 1 - functionsDiscount/100);
    const batMultiplier = Math.max(0, 1 - batteryDiscount/100);

    // Kapot is a direct purchase price: no further questions affect it.
    if (/kapot/i.test(condition)) {
      return res.json({
        success:true,
        price:Number(price.toFixed(2)),
        basePrice:Number(price.toFixed(2)),
        storageDelta:Number(storageDelta.toFixed(2)),
        adjustments:[],
        protocol,
        broken:true,
        rules:{functionsNotWorkingMultiplier:fnMultiplier,batteryUnder85Multiplier:batMultiplier}
      });
    }

    const adjustments = [];

    const functionsNo =
      protocol === "2"
        ? functions === functionsNoLabel
        : /nee|no|niet/i.test(functions);

    if (functionsNo) {
      const before = price;
      price *= fnMultiplier;
      adjustments.push({
        rule:"functions_not_working",
        discountPercent:functionsDiscount,
        multiplier:fnMultiplier,
        before:Number(before.toFixed(2)),
        after:Number(price.toFixed(2))
      });
    }

    const batteryNo =
      protocol === "2"
        ? battery === batteryNoLabel
        : /onder\s*85|<\s*85|nee|no|niet/i.test(battery);

    if (batteryNo) {
      const before = price;
      price *= batMultiplier;
      adjustments.push({
        rule:"battery_under_85",
        discountPercent:batteryDiscount,
        multiplier:batMultiplier,
        before:Number(before.toFixed(2)),
        after:Number(price.toFixed(2))
      });
    }

    price = Math.max(0, Number(price.toFixed(2)));

    res.json({
      success:true,
      price,
      basePrice:Number(Number(b.conditionBasePrice).toFixed(2)),
      storageDelta:Number(storageDelta.toFixed(2)),
      adjustments,
      protocol,
      rules:{
        functionsNotWorkingMultiplier:fnMultiplier,
        batteryUnder85Multiplier:batMultiplier,
        functionsDiscount,
        batteryDiscount
      },
      broken:false
    });
  } catch (error) {
    console.error("Buyback calculate error:", error);
    res.status(500).json({ error:"Prijs kon niet worden berekend." });
  }
});

app.post("/api/buyback/orders", async (req, res) => {
  try {
    await ensureBuybackOrdersTable();
    const b = req.body || {};
    const name = String(b.name || "").trim();
    const email = String(b.email || "").trim().toLowerCase();

    if (!name || !email || !String(b.device || "").trim()) {
      return res.status(400).json({ error: "Naam, e-mailadres en toestel zijn verplicht." });
    }

    const offeredPrice = Number(b.offeredPrice || 0);
    if (!Number.isFinite(offeredPrice) || offeredPrice < 0) {
      return res.status(400).json({ error: "Ongeldige prijs." });
    }

    const orderNo = `BT-${Date.now()}`;

    const result = await pool.query(`
      INSERT INTO buyback_orders
      (order_no,name,email,phone,address,device,brand,model,storage,condition,face_id,battery,screen,offered_price,iban,payment_method,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'Nieuw')
      RETURNING id,order_no,status,created_at
    `, [
      orderNo,
      name, email,
      String(b.phone || "").trim(),
      String(b.address || "").trim(),
      String(b.device || "").trim(),
      String(b.brand || "").trim(),
      String(b.model || b.device || "").trim(),
      String(b.storage || "").trim(),
      String(b.condition || "").trim(),
      String(b.faceId || "").trim(),
      String(b.battery || "").trim(),
      String(b.screen || "").trim(),
      offeredPrice,
      String(b.iban || "").trim(),
      String(b.paymentMethod || "").trim()
    ]);

    res.status(201).json({ success: true, order: result.rows[0] });
  } catch (error) {
    console.error("BUYBACK ORDER ERROR:", error);
    res.status(500).json({ error: "Verkoopaanvraag kon niet worden opgeslagen." });
  }
});

app.get("/api/admin/buyback-orders", requirePermission("buyback_orders.view"), async (req, res) => {
  try {
    await ensureBuybackOrdersTable();
    const result = await pool.query(`
      SELECT id,order_no,name,email,phone,address,device,brand,model,storage,condition,
             face_id,battery,screen,offered_price,iban,payment_method,status,created_at
      FROM buyback_orders
      ORDER BY created_at DESC
    `);
    res.json({ orders: result.rows });
  } catch (error) {
    console.error("BUYBACK LOAD ERROR:", error);
    res.status(500).json({ error: "Verkoopaanvragen konden niet worden geladen." });
  }
});

app.put("/api/admin/buyback-orders/:id/status", requirePermission("buyback_orders.update"), async (req, res) => {
  try {
    const allowed = ["Nieuw","In behandeling","Goedgekeurd","Afgewezen","Voltooid"];
    const status = String(req.body?.status || "").trim();
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "Ongeldige status." });
    }

    const result = await pool.query(`
      UPDATE buyback_orders
      SET status=$1
      WHERE id=$2
      RETURNING id,status
    `, [status, req.params.id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: "Verkoopaanvraag niet gevonden." });
    }
    res.json({ success: true, order: result.rows[0] });
  } catch (error) {
    console.error("BUYBACK STATUS ERROR:", error);
    res.status(500).json({ error: "Status kon niet worden gewijzigd." });
  }
});

app.delete("/api/admin/buyback-orders/:id", requirePermission("buyback_orders.delete"), async (req, res) => {
  try {
    const result = await pool.query(`
      DELETE FROM buyback_orders WHERE id=$1 RETURNING id
    `, [req.params.id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: "Verkoopaanvraag niet gevonden." });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("BUYBACK DELETE ERROR:", error);
    res.status(500).json({ error: "Verkoopaanvraag kon niet worden verwijderd." });
  }
});

