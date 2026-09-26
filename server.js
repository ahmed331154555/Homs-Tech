require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const path = require("path");

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

app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

// Website files
app.use(express.static(__dirname));

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

    res.json(result.rows[0].data);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Server error"
    });
  }
});

// Admin login + permissions
const ADMIN_PERMISSION_NAMES = {
  "general.view":"Algemeen bekijken","services.view":"Diensten bekijken",
  "phones.view":"Telefoons & prijzen bekijken","categories.view":"Apparaten & categorieën bekijken",
  "used.view":"Gebruikte telefoons bekijken","why.view":"Waarom HOMS TECH bekijken",
  "customers.view":"Klanten bekijken","orders.view":"GSM Orders bekijken",
  "orders.update":"GSM Order-status wijzigen","webshop_orders.view":"Webshop bestellingen bekijken",
  "webshop_orders.update":"Webshop order-status wijzigen","gsm.view":"GSM Services bekijken",
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

app.get("/api/me",(req,res)=>{
  try{
    const token=req.cookies.token;
    if(!token) return res.status(401).json({authenticated:false});
    const user=jwt.verify(token,process.env.JWT_SECRET);
    const normalized=user.username===String(process.env.ADMIN_USERNAME||"")
      ? getSuperAdminUser(user.username)
      : {id:user.id||null,username:user.username,role:user.role||"admin",permissions:Array.isArray(user.permissions)?user.permissions:[]};
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

// Customer logout
app.post("/api/customer/logout", (req, res) => {
  res.clearCookie("customerToken");

  res.json({
    success: true
  });
});

// ---------------- GSM SERVICE ORDERS ----------------

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
      notes = ""
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
      notes: String(notes || "").trim()
    };

    if (!clean.serviceName || !clean.name || !clean.email || !clean.phone) {
      return res.status(400).json({
        error: "Vul naam, e-mail en telefoonnummer in."
      });
    }

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email);
    if (!emailOk) {
      return res.status(400).json({
        error: "Vul een geldig e-mailadres in."
      });
    }

    let customerId = null;
    try {
      if (req.cookies.customerToken) {
        const decoded = jwt.verify(req.cookies.customerToken, process.env.JWT_SECRET);
        customerId = decoded.customerId || null;
      }
    } catch {}

    const result = await pool.query(
      `INSERT INTO service_orders
       (customer_id, service_category, service_name, service_group, price, name, email, phone, username, imei, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, status, created_at`,
      [
        customerId,
        clean.serviceCategory,
        clean.serviceName,
        clean.serviceGroup,
        clean.price,
        clean.name,
        clean.email,
        clean.phone,
        clean.username,
        clean.imei,
        clean.notes
      ]
    );

    res.status(201).json({
      success: true,
      order: result.rows[0]
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Bestelling kon niet worden aangemaakt."
    });
  }
});

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

    const safeItems = items.map(item => ({
      name: String(item?.name || ""),
      brand: String(item?.brand || ""),
      options: item?.options && typeof item.options === "object" ? item.options : {},
      qty: Math.max(1, Number(item?.qty || 1)),
      unitPrice: Number(item?.unitPrice || 0)
    }));

    const total = safeItems.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);

    const result = await pool.query(
      `INSERT INTO webshop_orders
       (customer_id, name, email, phone, street, house_number, postcode, city, items, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, status, created_at`,
      [customerId, name, email, phone, street, houseNumber, postcode, city, JSON.stringify(safeItems), total.toFixed(2)]
    );

    res.status(201).json({ success: true, order: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Webshop bestelling kon niet worden opgeslagen." });
  }
});

app.get("/api/admin/webshop-orders", requirePermission("webshop_orders.view"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, customer_id, name, email, phone, street, house_number, postcode, city, items, total, status, created_at
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
      `SELECT id, service_category, service_name, service_group, price, name, email, phone, username, imei, notes, status, created_at
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
      `SELECT id, customer_id, service_category, service_name, service_group, price, name, email, phone, username, imei, notes, status, created_at
       FROM service_orders
       ORDER BY created_at DESC`
    );

    res.json({ orders: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Bestellingen konden niet worden geladen." });
  }
});

app.put("/api/admin/orders/:id/status", requirePermission("orders.update"), async (req, res) => {
  try {
    const allowed = ["Nieuw", "In behandeling", "Voltooid", "Geannuleerd"];
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


app.put("/api/site", requirePermission("site.save"), async (req, res) => {
  try {
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


// =====================================================
// FORZA TEST IMPORT — READ ONLY
// Public Forza product page test.
// This endpoint only reads publicly visible data.
// It does NOT create, update or delete HOMS TECH products.
// =====================================================

function forzaCleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function forzaStripHtml(value) {
  return forzaCleanText(
    String(value || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function forzaParseEuro(value) {
  const raw = String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[^\d,.\-+€]/g, " ")
    .trim();

  const match = raw.match(/([+-]?\d+(?:[.,]\d{1,2})?)/);
  if (!match) return null;

  const numberText = match[1].replace(/\./g, "").replace(",", ".");
  const number = Number(numberText);
  return Number.isFinite(number) ? number : null;
}

function forzaFirstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match && match[1]) return forzaCleanText(match[1]);
  }
  return "";
}

function forzaExtractMeta(html, name) {
  const safeName = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${safeName}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  const reversePattern = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${safeName}["']`,
    "i"
  );

  const match = html.match(pattern) || html.match(reversePattern);
  return match ? forzaCleanText(match[1]) : "";
}

function forzaExtractJsonLd(html) {
  const results = [];
  const scripts = String(html || "").match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi
  ) || [];

  for (const script of scripts) {
    const jsonText = script
      .replace(/^<script[^>]*>/i, "")
      .replace(/<\/script>$/i, "")
      .trim();

    try {
      results.push(JSON.parse(jsonText));
    } catch {
      // Some pages contain JSON-LD that is not valid JSON. Ignore that block.
    }
  }

  return results;
}

function forzaWalkJson(value, visitor, seen = new Set()) {
  if (value === null || value === undefined) return;
  if (typeof value !== "object") {
    visitor(value);
    return;
  }
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) forzaWalkJson(item, visitor, seen);
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    visitor(child, key);
    forzaWalkJson(child, visitor, seen);
  }
}

function forzaExtractTest(html, sourceUrl) {
  const clean = forzaStripHtml(html);
  const jsonLd = forzaExtractJsonLd(html);

  let product = null;
  const images = new Set();

  for (const data of jsonLd) {
    forzaWalkJson(data, (value, key) => {
      if (key === "image") {
        if (Array.isArray(value)) {
          value.forEach(item => {
            if (typeof item === "string" && /^https?:\/\//i.test(item)) images.add(item);
          });
        } else if (typeof value === "string" && /^https?:\/\//i.test(value)) {
          images.add(value);
        }
      }

      if (!product && value && typeof value === "object" && !Array.isArray(value)) {
        const type = String(value["@type"] || "").toLowerCase();
        if (type === "product" || type.includes("product")) {
          product = value;
        }
      }
    });
  }

  const metaImage = forzaExtractMeta(html, "og:image");
  if (metaImage) images.add(metaImage);

  const title =
    String(product?.name || "").trim() ||
    forzaExtractMeta(html, "og:title") ||
    forzaFirstMatch(clean, [
      /\b(iPhone\s+\d+(?:\s+(?:Pro|Pro Max|Plus|Mini|SE))?)\b/i,
      /\b(Galaxy\s+[A-Za-z0-9 +\-]+)\b/i
    ]);

  const color = forzaFirstMatch(clean, [
    /Kleur:\s*([^|]{1,80}?)(?=\s+\+?\s*€|\s+Geheugen|\s+Productconditie)/i
  ]);

  const memoryValues = [];
  const memoryMatch = clean.match(
    /Geheugen\s+(.{0,180}?)(?=\s+Productconditie|\s+Batterij|\s+Condities)/i
  );
  if (memoryMatch) {
    const found = memoryMatch[1].match(/\b\d+\s*(?:GB|TB)\b/gi) || [];
    found.forEach(item => {
      const value = forzaCleanText(item).replace(/\s+/g, "");
      if (!memoryValues.includes(value)) memoryValues.push(value);
    });
  }

  const conditions = [];
  const conditionNames = [
    "Zo goed als nieuw",
    "Licht gebruikt",
    "Zichtbaar gebruikt"
  ];

  for (const name of conditionNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      escaped + "\\s+(?:Meest gekozen\\s+)?€\\s*([0-9]+(?:[.,][0-9]{1,2})?)",
      "i"
    );
    const match = clean.match(pattern);
    conditions.push({
      name,
      price: match ? forzaParseEuro(match[1]) : null
    });
  }

  const battery = [];
  const batterySection = clean.match(
    /Batterij\s+(.{0,260}?)(?=\s+Wil je de inruilwaarde|\s+Condities|\s+Belangrijkste specificaties|\s+Productcondities)/i
  );

  if (batterySection) {
    const section = batterySection[1];
    const standardMatch = section.match(/Standaard.*?\+\s*€\s*([0-9]+)/i);
    const newMatch = section.match(/Nieuw.*?\+\s*€\s*([0-9]+)/i);

    battery.push({
      name: "Standaard",
      delta: standardMatch ? forzaParseEuro(standardMatch[1]) : 0
    });

    battery.push({
      name: "Nieuw",
      delta: newMatch ? forzaParseEuro(newMatch[1]) : null
    });
  }

  const stockMatches = clean.match(
    /(?:Nog\s+(\d+)\s+op\s+voorraad|Tijdelijk niet op voorraad|Deze uitvoering is tijdelijk uitverkocht)/gi
  ) || [];

  const stock = stockMatches
    .map(item => {
      const match = item.match(/Nog\s+(\d+)\s+op\s+voorraad/i);
      return match ? Number(match[1]) : 0;
    });

  const specs = [];
  const specSection = clean.match(
    /Belangrijkste specificaties\s+(.{0,1200}?)(?=\s+Lees volledige productomschrijving|\s+Productomschrijving|\s+€)/i
  );
  if (specSection) {
    const parts = specSection[1].split(/\s+(?=\d+(?:[.,]\d+)?\s*(?:inch|Hz|MP|GB|mm)|[A-Z][^:]{1,40}:)/i);
    parts.forEach(item => {
      const value = forzaCleanText(item);
      if (value && value.length <= 120) specs.push(value);
    });
  }

  const description =
    forzaCleanText(product?.description || "") ||
    forzaFirstMatch(clean, [
      /Productomschrijving\s+(.{100,1200}?)(?=\s+Alternatieven|\s+Condities|\s+Belangrijkste specificaties)/i,
      /Apple iPhone[^.]{0,80}\.\s+(.{100,900}?)(?=\s+Alternatieven|\s+Condities)/i
    ]);

  const sku = String(product?.sku || "").trim();
  const brand = String(
    product?.brand?.name ||
    product?.brand ||
    (/iphone/i.test(title) ? "Apple" : /galaxy/i.test(title) ? "Samsung" : "")
  ).trim();

  const canonical =
    forzaExtractMeta(html, "og:url") ||
    sourceUrl;

  return {
    sourceUrl,
    canonical,
    readOnly: true,
    fetchedAt: new Date().toISOString(),
    product: {
      name: title,
      brand,
      sku,
      color,
      storage: memoryValues,
      conditions,
      battery,
      stock: stock.length ? Math.max(...stock) : null,
      images: [...images].slice(0, 12),
      specs,
      description
    }
  };
}

app.get("/api/forza-test", requirePermission("phones.view"), async (req, res) => {
  const sourceUrl = "https://www.forza-refurbished.nl/refurbished-iphone/iphone-11";

  try {
    const response = await fetch(sourceUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; HOMS-TECH public product test)",
        "Accept": "text/html,application/xhtml+xml"
      }
    });

    const html = await response.text();

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        readOnly: true,
        sourceUrl,
        error: `Forza returned HTTP ${response.status}`
      });
    }

    const result = forzaExtractTest(html, sourceUrl);

    return res.json({
      success: true,
      readOnly: true,
      result
    });
  } catch (error) {
    console.error("FORZA TEST IMPORT ERROR:", error);
    return res.status(502).json({
      success: false,
      readOnly: true,
      sourceUrl,
      error: "Forza test request failed.",
      details: String(error?.message || error)
    });
  }
});


// =====================================================
// FORZA TEST ADMIN PAGE — READ ONLY
// Protected by the same phones.view permission.
// This page only displays data returned by /api/forza-test.
// It never writes to the HOMS TECH product database.
// =====================================================
app.get("/admin/forza-test", requirePermission("phones.view"), (req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HOMS TECH · Forza Test</title>
<style>
  *{box-sizing:border-box}body{margin:0;background:#f5f7fb;color:#111827;font-family:Inter,Arial,sans-serif}
  .wrap{max-width:1200px;margin:0 auto;padding:28px 18px 60px}
  .top{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:20px}
  h1{margin:0;font-size:28px}.sub{color:#64748b;margin-top:7px}
  .badge{background:#dcfce7;color:#166534;border:1px solid #bbf7d0;padding:8px 12px;border-radius:999px;font-weight:700;font-size:13px}
  .card{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:20px;margin-top:16px;box-shadow:0 5px 18px rgba(15,23,42,.05)}
  .actions{display:flex;gap:10px;flex-wrap:wrap}.btn{border:0;border-radius:10px;padding:11px 16px;font-weight:700;cursor:pointer}.primary{background:#111827;color:#fff}.light{background:#eef2f7;color:#111827}
  .status{margin-top:12px;color:#64748b}.error{color:#b91c1c}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.item{background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:13px}.label{font-size:12px;color:#64748b;margin-bottom:5px}.value{font-weight:700;word-break:break-word}
  .section-title{font-size:18px;margin:0 0 12px}.table{width:100%;border-collapse:collapse}.table th,.table td{text-align:left;padding:11px;border-bottom:1px solid #e5e7eb;vertical-align:top}.table th{font-size:13px;color:#475569}
  .images{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}.images img{width:100%;height:150px;object-fit:contain;background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:8px}
  .muted{color:#64748b}.source{font-size:13px;word-break:break-all}.back{display:inline-block;margin-top:18px;text-decoration:none;color:#2563eb;font-weight:700}
  pre{white-space:pre-wrap;word-break:break-word;background:#0f172a;color:#e2e8f0;padding:14px;border-radius:12px;max-height:420px;overflow:auto;font-size:12px}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div><h1>Forza Test Import</h1><div class="sub">Publieke Forza-pagina uitlezen · alleen-lezen test</div></div>
    <div class="badge">READ ONLY · GEEN PRODUCT-WRITES</div>
  </div>

  <div class="card">
    <div class="actions"><button id="load" class="btn primary">Forza opnieuw lezen</button><button id="rawBtn" class="btn light">Toon ruwe JSON</button></div>
    <div id="status" class="status">Nog niet geladen.</div>
  </div>

  <div id="content" style="display:none">
    <div class="card"><h2 class="section-title">Product</h2><div id="productGrid" class="grid"></div></div>
    <div class="card"><h2 class="section-title">Opslag</h2><div id="storage"></div></div>
    <div class="card"><h2 class="section-title">Conditie & prijzen</h2><div id="conditions"></div></div>
    <div class="card"><h2 class="section-title">Batterij</h2><div id="battery"></div></div>
    <div class="card"><h2 class="section-title">Voorraad</h2><div id="stock"></div></div>
    <div class="card"><h2 class="section-title">Afbeeldingen</h2><div id="images" class="images"></div></div>
    <div class="card"><h2 class="section-title">Specificaties</h2><div id="specs"></div></div>
    <div class="card"><h2 class="section-title">Beschrijving</h2><div id="description" class="muted"></div></div>
    <div class="card"><h2 class="section-title">Bron</h2><div id="source" class="source"></div></div>
  </div>

  <div id="raw" class="card" style="display:none"><h2 class="section-title">Ruwe JSON</h2><pre id="rawText"></pre></div>
  <a class="back" href="/admin">← Terug naar Admin</a>
</div>
<script>
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=n=>n===null||n===undefined||n===''?'—':new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR'}).format(Number(n));
function rows(obj){return Object.entries(obj||{}).map(([k,v])=>'<div class="item"><div class="label">'+esc(k)+'</div><div class="value">'+esc(typeof v==='object'?JSON.stringify(v):v)+'</div></div>').join('')||'<div class="muted">Geen gegevens gevonden.</div>'}
function list(arr){return (arr||[]).length?(arr||[]).map(x=>'<span style="display:inline-block;background:#eef2f7;border-radius:999px;padding:7px 10px;margin:0 6px 6px 0">'+esc(typeof x==='object'?JSON.stringify(x):x)+'</span>').join(''):'<span class="muted">Geen gegevens gevonden.</span>'}
async function load(){
  $('status').className='status';$('status').textContent='Forza wordt gelezen...';$('load').disabled=true;
  try{
    const r=await fetch('/api/forza-test',{credentials:'same-origin'});
    const x=await r.json().catch(()=>({}));
    if(!r.ok||!x.success) throw new Error(x.error||'Forza test mislukt.');
    const p=x.result?.product||{};
    $('productGrid').innerHTML=rows({Naam:p.name, Merk:p.brand, SKU:p.sku, Kleur:p.color});
    $('storage').innerHTML=list(p.storage);
    $('conditions').innerHTML=(p.conditions||[]).length?'<table class="table"><thead><tr><th>Conditie</th><th>Prijs</th></tr></thead><tbody>'+(p.conditions||[]).map(c=>'<tr><td>'+esc(c.name||c.label||c.condition||'-')+'</td><td>'+money(c.price??c.value)+'</td></tr>').join('')+'</tbody></table>':'<span class="muted">Geen conditieprijzen gevonden.</span>';
    $('battery').innerHTML=(p.battery||[]).length?'<table class="table"><thead><tr><th>Optie</th><th>Prijs / verschil</th></tr></thead><tbody>'+(p.battery||[]).map(b=>'<tr><td>'+esc(b.name||b.label||b.battery||'-')+'</td><td>'+money(b.price??b.delta??b.value)+'</td></tr>').join('')+'</tbody></table>':'<span class="muted">Geen batterijopties gevonden.</span>';
    $('stock').innerHTML=rows({'Max. zichtbare voorraad':p.stock});
    $('images').innerHTML=(p.images||[]).length?(p.images||[]).map(src=>'<img loading="lazy" src="'+esc(src)+'" alt="Forza product">').join(''):'<span class="muted">Geen afbeeldingen gevonden.</span>';
    $('specs').innerHTML=rows(p.specs);
    $('description').textContent=p.description||'Geen beschrijving gevonden.';
    $('source').innerHTML='<div><b>URL:</b> '+esc(x.result?.sourceUrl||'')+'</div><div><b>Canonical:</b> '+esc(x.result?.canonical||'')+'</div><div><b>Opgehaald:</b> '+esc(x.result?.fetchedAt||'')+'</div><div><b>Read-only:</b> '+esc(x.result?.readOnly)+'</div>';
    $('rawText').textContent=JSON.stringify(x,null,2);
    $('content').style.display='block';$('status').className='status';$('status').textContent='✓ Forza-data succesvol gelezen.';
  }catch(e){$('status').className='status error';$('status').textContent='✕ '+e.message;$('content').style.display='none';}
  finally{$('load').disabled=false}
}
$('load').onclick=load;
$('rawBtn').onclick=()=>{$('raw').style.display=$('raw').style.display==='none'?'block':'none'};
load();
</script>
</body>
</html>`);
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

