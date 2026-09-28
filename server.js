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

  // Forza's public page can render the condition price either directly
  // after the condition name or with extra labels/elements in between.
  // Keep the direct match first, then use a bounded fallback that stops
  // before the next condition. This is especially important for the
  // 64GB page, which can have a slightly different rendered structure.
  for (let i = 0; i < conditionNames.length; i++) {
    const name = conditionNames[i];
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const directPattern = new RegExp(
      escaped + "\\s+(?:Meest gekozen\\s+)?€\\s*([0-9]+(?:[.,][0-9]{1,2})?)",
      "i"
    );

    let price = null;
    const directMatch = clean.match(directPattern);
    if (directMatch) {
      price = forzaParseEuro(directMatch[1]);
    } else {
      const nextNames = conditionNames.slice(i + 1);
      const stopPattern = nextNames.length
        ? new RegExp(nextNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") , "i")
        : null;
      const nameMatch = clean.match(new RegExp(escaped, "i"));
      if (nameMatch) {
        const start = nameMatch.index + nameMatch[0].length;
        let segment = clean.slice(start, start + 220);
        if (stopPattern) {
          const stop = segment.search(stopPattern);
          if (stop >= 0) segment = segment.slice(0, stop);
        }
        const euroMatch = segment.match(/€\\s*([0-9]+(?:[.,][0-9]{1,2})?)/i);
        if (euroMatch) price = forzaParseEuro(euroMatch[1]);
      }
    }

    conditions.push({ name, price });
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


function forzaImageMatchKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\bblack\b/g, "zwart")
    .replace(/\bwhite\b/g, "wit")
    .replace(/\bpurple\b/g, "paars")
    .replace(/\bred\b/g, "rood")
    .replace(/\bblue\b/g, "blauw")
    .replace(/\bgreen\b/g, "groen")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// V29: V16 exact-variant fetching + V10 gallery extraction.
function forzaExtractVariantGalleryImages(html, productName) {
  const wanted = forzaImageMatchKey(productName);
  if (!wanted) return [];
  const wantedTokens = wanted.split(" ").filter(Boolean);
  const wantedColor = wantedTokens[wantedTokens.length - 1] || "";
  const wantedStorage = (wanted.match(/\b\d+\s*(?:gb|tb)\b/) || [""])[0].replace(/\s+/g, "");
  // Tokenize the model separately from storage. Product names can be
  // written as "64 GB" (two tokens), while gallery alts often omit storage.
  // Do NOT require the separate "64" / "gb" tokens as model identity.
  const wantedModelTokens = wantedTokens.filter(t =>
    !/^\d+$/.test(t) && !/^(?:gb|tb)$/.test(t) && t !== wantedColor
  );
  const compact = value => forzaImageMatchKey(value).replace(/\s+/g, "");

  const images = [];
  const seen = new Set();
  const imgTags = String(html || "").match(/<img\b[^>]*>/gi) || [];

  const addUrl = value => {
    if (!value) return;
    const cleaned = String(value).trim().replace(/&amp;/gi, "&");
    const urls = cleaned.match(/https?:\/\/[^\s,]+/gi) || [];
    for (const raw of urls) {
      const url = raw.replace(/["')]+$/g, "");
      if (!/^https?:\/\//i.test(url)) continue;
      if (!seen.has(url)) {
        seen.add(url);
        images.push(url);
      }
    }
  };

  for (const tag of imgTags) {
    const attrs = {};
    const attrRe = /([:\w-]+)\s*=\s*["']([^"']*)["']/gi;
    let m;
    while ((m = attrRe.exec(tag))) attrs[m[1].toLowerCase()] = m[2];

    const descriptive = [
      attrs.alt, attrs.title, attrs["data-alt"], attrs["data-title"], attrs["aria-label"]
    ].filter(Boolean);
    if (!descriptive.length) continue;

    const text = descriptive.map(forzaImageMatchKey).join(" ");
    const key = compact(text);

    // Exclude Forza's generic cross-colour gallery image.
    if (/kleuren|colors|colour/.test(key)) continue;

    // Exact variant identity: model + colour must be present. Storage is
    // preferred when available, but Forza sometimes omits storage from the
    // gallery alt text on the exact variant page.
    const hasModel = wantedModelTokens.every(token => key.includes(token));
    const hasColor = !!wantedColor && key.includes(wantedColor);
    const hasStorage = !!wantedStorage && key.includes(wantedStorage);
    if (!hasModel || !hasColor) continue;
    if (hasStorage || !wantedStorage) {
      addUrl(attrs.src);
      addUrl(attrs["data-src"]);
      addUrl(attrs["data-lazy-src"]);
      addUrl(attrs.srcset);
      addUrl(attrs["data-srcset"]);
    }
    if (images.length >= 4) break;
  }

  return [...new Set(images)].slice(0, 4);
}

function forzaVariantSlugCandidates(productName) {
  const raw = String(productName || "").trim();
  if (!raw) return [];
  const normalized = raw
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\//g, " ")
    .replace(/\bblack\b/ig, "zwart")
    .replace(/\bwhite\b/ig, "wit")
    .replace(/\bpurple\b/ig, "paars")
    .replace(/\bred\b/ig, "rood")
    .replace(/\bblue\b/ig, "blauw")
    .replace(/\bgreen\b/ig, "groen")
    .replace(/\s+/g, " ")
    .trim();
  const compactGb = normalized.replace(/\b(\d+)\s+GB\b/ig, "$1GB");
  const hyphenGb = normalized.replace(/\b(\d+)\s+GB\b/ig, "$1-gb");
  const variants = [normalized, hyphenGb, compactGb]
    .map(v => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));
  return [...new Set(variants)].map(slug => `https://www.forza-refurbished.nl/${slug}`);
}

function forzaFindVariantLink(html, productName, baseUrl) {
  const wanted = forzaImageMatchKey(productName);
  if (!wanted) return "";
  const wantedTokens = wanted.split(" ").filter(Boolean);
  const anchors = String(html || "").match(/<a\b[^>]*href=["'][^"']+["'][^>]*>[\s\S]{0,1200}?<\/a>/gi) || [];
  let bestUrl = "";
  let bestScore = 0;
  for (const anchor of anchors) {
    const hrefMatch = anchor.match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    let absolute;
    try { absolute = new URL(hrefMatch[1], baseUrl).toString(); } catch { continue; }
    if (!/forza-refurbished\.nl/i.test(absolute)) continue;
    const text = forzaImageMatchKey(forzaStripHtml(anchor));
    const hrefKey = forzaImageMatchKey(absolute);
    if (!text && !hrefKey) continue;
    let score = 0;
    if (text === wanted) score = 1000;
    else {
      const textTokens = text.split(" ");
      const hrefTokens = hrefKey.split(" ");
      const matchedText = wantedTokens.filter(t => textTokens.includes(t)).length;
      const matchedHref = wantedTokens.filter(t => hrefTokens.includes(t)).length;
      score = matchedText * 20 + matchedHref * 35;
      if (text.includes(wanted)) score += 200;
      if (hrefKey.includes(wanted.replace(/ /g, "-"))) score += 250;
      if (/\b\d+\s*(?:gb|tb)\b/i.test(wanted) && /\b\d+\s*(?:gb|tb)\b/i.test(text)) score += 10;
    }
    if (score > bestScore) { bestScore = score; bestUrl = absolute; }
  }
  return bestScore >= Math.max(60, wantedTokens.length * 20) ? bestUrl : "";
}


async function forzaFetchJinaGallery(url, productName) {
  try {
    const proxyUrl = `https://r.jina.ai/${url}`;
    const response = await fetch(proxyUrl, {
      method: "GET",
      headers: {
        "User-Agent": "HOMS-TECH Forza image reader",
        "Accept": "text/plain,text/markdown;q=0.9,*/*;q=0.8"
      }
    });
    if (!response.ok) return [];
    const markdown = await response.text();

    const wanted = forzaImageMatchKey(productName);
    const wantedTokens = wanted.split(" ").filter(Boolean);
    const wantedColor = wantedTokens[wantedTokens.length - 1] || "";
    const wantedStorage = (wanted.match(/\b\d+\s*(?:gb|tb)\b/) || [""])[0].replace(/\s+/g, "");
    const wantedModelTokens = wantedTokens.filter(
      t => !/^\d+$/.test(t) && !/^(?:gb|tb)$/.test(t) && t !== wantedColor
    );

    const images = [];
    const seen = new Set();
    const re = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/gi;
    let m;

    while ((m = re.exec(markdown))) {
      const alt = forzaImageMatchKey(m[1] || "");
      const key = alt.replace(/\s+/g, "");
      if (!alt || /kleuren|colors|colour/.test(key)) continue;

      const hasModel = wantedModelTokens.every(token => key.includes(token));
      const hasColor = !!wantedColor && key.includes(wantedColor);
      const hasStorage = !!wantedStorage && key.includes(wantedStorage);
      if (!hasModel || !hasColor) continue;
      // Forza's exact iPhone 12 64GB Wit gallery uses alt text such as
      // "iPhone 12 Wit refurbished" without repeating "64GB". The exact
      // page URL already establishes the storage variant, so storage must NOT
      // be required in the image alt text.

      const imageUrl = m[2].replace(/&amp;/gi, "&");
      if (!seen.has(imageUrl)) {
        seen.add(imageUrl);
        images.push(imageUrl);
      }
      if (images.length >= 4) break;
    }

    // Some Forza pages returned by Jina can expose the gallery as HTML img tags
    // instead of markdown. Still stay strictly on this exact variant page and
    // require model + color in the image description or URL.
    if (images.length === 0) {
      const htmlImg = /<img\b[^>]*>/gi;
      let tag;
      while ((tag = htmlImg.exec(markdown))) {
        const attrs = tag[0];
        const desc = forzaImageMatchKey((attrs.match(/(?:alt|title|data-alt|data-title)=['\"]([^'\"]*)/i) || [,''])[1]);
        const src = (attrs.match(/(?:src|data-src|data-lazy-src)=['\"]([^'\"]+)['\"]/i) || [,''])[1];
        const key = forzaImageMatchKey(`${desc} ${src}`);
        if (!src || /kleuren|colors|colour/.test(key)) continue;
        const hasModel = wantedModelTokens.every(token => key.includes(token));
        const hasColor = !!wantedColor && key.includes(wantedColor);
        if (!hasModel || !hasColor) continue;
        const imageUrl = src.replace(/&amp;/gi, '&');
        if (!seen.has(imageUrl)) { seen.add(imageUrl); images.push(imageUrl); }
        if (images.length >= 4) break;
      }
    }

    return images.slice(0, 4);
  } catch {
    return [];
  }
}

function forzaBuildExactVariantNames(productName, overviewHtml) {
  const names = new Set();
  const raw = String(productName || '').trim();
  if (raw) names.add(raw);

  // iPhone 12 can expose a generic JSON-LD product name on the model page.
  // Reconstruct the concrete variant from the page's visible Kleur + Geheugen
  // values, using the same information that the iPhone 11 test successfully
  // uses to reach a concrete Forza product page.
  const clean = forzaStripHtml(overviewHtml || '');
  const color = forzaFirstMatch(clean, [
    /Kleur:\s*([^|]{1,80}?)(?=\s+\+?\s*€|\s+Geheugen|\s+Productconditie)/i
  ]);
  const memory = forzaFirstMatch(clean, [
    /Geheugen\s+\d+\s*(?:GB|TB)(?:\s+\d+\s*(?:GB|TB))?/i
  ]);

  let storage = '';
  const rawStorage = String(raw).match(/\b\d+\s*(?:GB|TB)\b/i);
  if (rawStorage) storage = rawStorage[0].replace(/\s+/g, '');
  if (!storage) {
    const memMatch = clean.match(/Geheugen\s+([0-9]+)\s*(GB|TB)/i);
    if (memMatch) storage = `${memMatch[1]}${memMatch[2].toUpperCase()}`;
  }

  let model = raw.match(/\biPhone\s+\d+(?:\s+(?:Pro|Pro Max|Plus|Mini|SE))?/i)?.[0] || '';
  if (!model) model = clean.match(/\biPhone\s+\d+(?:\s+(?:Pro|Pro Max|Plus|Mini|SE))?/i)?.[0] || '';

  if (model && storage && color) names.add(`${model} ${storage} ${color}`);
  return [...names];
}

// V14: explicit Forza product URLs for the iPhone 12 variants currently listed
// in Forza's public iPhone catalogue. These are only exact-product URLs; they
// are never used as a source for overview/gallery fallback.
const FORZA_IPHONE12_EXACT_URLS = {
  "iPhone 12 64GB Zwart": "https://www.forza-refurbished.nl/iphone-12-64gb-zwart",
  "iPhone 12 64GB Blauw": "https://www.forza-refurbished.nl/iphone-12-64gb-blauw",
  "iPhone 12 64GB Groen": "https://www.forza-refurbished.nl/iphone-12-64gb-groen",
  "iPhone 12 64GB Paars": "https://www.forza-refurbished.nl/iphone-12-64gb-paars",
  "iPhone 12 64GB Rood": "https://www.forza-refurbished.nl/iphone-12-64gb-rood",
  "iPhone 12 128GB Zwart": "https://www.forza-refurbished.nl/iphone-12-128gb-zwart",
  "iPhone 12 128GB Wit": "https://www.forza-refurbished.nl/iphone-12-128gb-wit",
  "iPhone 12 128GB Blauw": "https://www.forza-refurbished.nl/iphone-12-128gb-blauw",
  "iPhone 12 128GB Rood": "https://www.forza-refurbished.nl/iphone-12-128gb-rood",
  "iPhone 12 256GB Zwart": "https://www.forza-refurbished.nl/iphone-12-256gb-zwart",
  "iPhone 12 256GB Wit": "https://www.forza-refurbished.nl/iphone-12-256gb-wit",
  "iPhone 12 256GB Blauw": "https://www.forza-refurbished.nl/iphone-12-256gb-blauw",
  "iPhone 12 256GB Groen": "https://www.forza-refurbished.nl/iphone-12-256gb-groen",
  "iPhone 12 256GB Paars": "https://www.forza-refurbished.nl/iphone-12-256gb-paars",
  "iPhone 12 256GB Rood": "https://www.forza-refurbished.nl/iphone-12-256gb-rood"
};

const FORZA_IPHONE12_CURRENT_VARIANTS = new Set([
  "iPhone 12 64GB Zwart", "iPhone 12 64GB Blauw", "iPhone 12 64GB Groen", "iPhone 12 64GB Paars",
  "iPhone 12 128GB Zwart", "iPhone 12 128GB Wit", "iPhone 12 128GB Blauw", "iPhone 12 128GB Rood",
  "iPhone 12 256GB Zwart", "iPhone 12 256GB Wit", "iPhone 12 256GB Blauw", "iPhone 12 256GB Groen",
  "iPhone 12 256GB Paars", "iPhone 12 256GB Rood"
]);

function forzaExactUrlCandidates(productName, overviewHtml, overviewUrl) {
  const names = forzaBuildExactVariantNames(productName, overviewHtml);
  const urls = [];
  const add = u => { if (u && !urls.includes(u)) urls.push(u); };

  // First use an exact URL reconstructed from the concrete model/storage/color,
  // then the exact link discovered on the Forza model page, then the legacy
  // slug candidates. This mirrors the successful concrete-page approach used
  // by the iPhone 11 test instead of relying on the mixed overview gallery.
  for (const name of names) {
    const canonicalName = forzaNormalizeVariantName(name);
    // Prefer an exact known Forza product URL when the current catalogue has
    // this concrete variant. Then keep the generic V10 slug discovery as a
    // fallback for future/changed Forza URLs.
    const exact = FORZA_IPHONE12_EXACT_URLS[canonicalName];
    if (exact) add(exact);
    for (const u of forzaVariantSlugCandidates(name)) add(u);
  }
  const discovered = forzaFindVariantLink(overviewHtml, names[0] || productName, overviewUrl);
  add(discovered);
  return urls;
}

async function forzaFetchExactVariant(productName, overviewHtml, overviewUrl) {
  const candidates = forzaExactUrlCandidates(productName, overviewHtml, overviewUrl);
  const seen = new Set();

  for (const url of candidates) {
    if (seen.has(url)) continue;
    seen.add(url);

    try {
      let page = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          page = await forzaFetchPublicPage(url);
          if (page.response.ok || page.response.status !== 429) break;
        } catch {
          page = null;
        }
        await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
      }
      if (!page) continue;

      // Whether Forza answers directly or via a server-side 429, keep the
      // fallback tied to THIS exact variant URL. Never use the overview gallery.
      if (page.response.ok) {
        const parsed = forzaExtractTest(page.html, url);
        const wanted = forzaImageMatchKey(productName);
        const got = forzaImageMatchKey(parsed?.product?.name || '');

        const wantedModel = wanted.replace(/\b\d+\s*(?:gb|tb)\b/g, '').trim();
        const gotModel = got.replace(/\b\d+\s*(?:gb|tb)\b/g, '').trim();
        if (wantedModel && gotModel &&
            !gotModel.includes(wantedModel) && !wantedModel.includes(gotModel)) continue;

        const images = forzaExtractVariantGalleryImages(page.html, productName);
        if (images.length >= 4) {
          return { url, parsed, images: [...new Set(images)].slice(0, 4) };
        }

        // Exact product pages can expose the real gallery in JSON-LD even when
        // the rendered <img> tags are lazy-loaded or missing from the HTML
        // returned to the server. Because this is already the exact variant
        // URL, the JSON-LD image list is safe to use as the variant gallery.
        const jsonLdImages = Array.isArray(parsed?.product?.images)
          ? [...new Set(parsed.product.images.filter(v => /^https?:\/\//i.test(String(v))))]
          : [];
        if (jsonLdImages.length >= 4) {
          return { url, parsed, images: jsonLdImages.slice(0, 4) };
        }

        const jinaImages = await forzaFetchJinaGallery(url, productName);
        if (jinaImages.length >= 1) {
          return { url, parsed, images: jinaImages.slice(0, 4) };
        }
      }

      const jinaImages = await forzaFetchJinaGallery(url, productName);
      if (jinaImages.length >= 1) {
        return { url, parsed: page.response.ok ? forzaExtractTest(page.html, url) : null, images: jinaImages.slice(0, 4) };
      }
    } catch {
      const jinaImages = await forzaFetchJinaGallery(url, productName);
      if (jinaImages.length >= 1) {
        return { url, parsed: null, images: jinaImages.slice(0, 4) };
      }
    }
  }

  return null;
}

async function forzaFetchPublicPage(sourceUrl) {
  const response = await fetch(sourceUrl, {
    method: "GET",
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; HOMS-TECH public product test)",
      "Accept": "text/html,application/xhtml+xml"
    }
  });

  const html = await response.text();
  return { response, html };
}

const FORZA_TEST_MODELS = {
  "iphone-se-2022": {
    label: "iPhone SE (2022)",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/se-2022-overzicht",
    storages: [],
    colors: []
  },
  "iphone-11": {
    label: "iPhone 11",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-11-overzicht",
    storages: [],
    colors: []
  },
  "iphone-11-pro": {
    label: "iPhone 11 Pro",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-11-pro-overzicht",
    storages: [],
    colors: []
  },
  "iphone-11-pro-max": {
    label: "iPhone 11 Pro Max",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-11-pro-max-overzicht",
    storages: [],
    colors: []
  },
  "iphone-12-mini": {
    label: "iPhone 12 Mini",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-12-mini-overzicht",
    storages: [],
    colors: []
  },
  "iphone-12": {
    label: "iPhone 12",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-12-overzicht",
    storages: [],
    colors: []
  },
  "iphone-12-pro": {
    label: "iPhone 12 Pro",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-12-pro-overzicht",
    storages: [],
    colors: []
  },
  "iphone-12-pro-max": {
    label: "iPhone 12 Pro Max",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-12-pro-max-overzicht",
    storages: [],
    colors: []
  },
  "iphone-13-mini": {
    label: "iPhone 13 Mini",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-13-mini-overzicht",
    storages: [],
    colors: []
  },
  "iphone-13": {
    label: "iPhone 13",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-13-overzicht",
    storages: [],
    colors: []
  },
  "iphone-13-pro": {
    label: "iPhone 13 Pro",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-13-pro-overzicht",
    storages: [],
    colors: []
  },
  "iphone-13-pro-max": {
    label: "iPhone 13 Pro Max",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-13-pro-max-overzicht",
    storages: [],
    colors: []
  },
  "iphone-14": {
    label: "iPhone 14",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-14-overzicht",
    storages: [],
    colors: []
  },
  "iphone-14-plus": {
    label: "iPhone 14 Plus",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-14-plus-overzicht",
    storages: [],
    colors: []
  },
  "iphone-14-pro": {
    label: "iPhone 14 Pro",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-14-pro-overzicht",
    storages: [],
    colors: []
  },
  "iphone-14-pro-max": {
    label: "iPhone 14 Pro Max",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-14-pro-max-overzicht",
    storages: [],
    colors: []
  },
  "iphone-15": {
    label: "iPhone 15",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-15-overzicht",
    storages: [],
    colors: []
  },
  "iphone-15-plus": {
    label: "iPhone 15 Plus",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-15-plus-overzicht",
    storages: [],
    colors: []
  },
  "iphone-15-pro": {
    label: "iPhone 15 Pro",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-15-pro-overzicht",
    storages: [],
    colors: []
  },
  "iphone-15-pro-max": {
    label: "iPhone 15 Pro Max",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-15-pro-max-overzicht",
    storages: [],
    colors: []
  },
  "iphone-16e": {
    label: "iPhone 16e",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-16e-overzicht",
    storages: [],
    colors: []
  },
  "iphone-16": {
    label: "iPhone 16",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-16-overzicht",
    storages: [],
    colors: []
  },
  "iphone-16-plus": {
    label: "iPhone 16 Plus",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-16-plus-overzicht",
    storages: [],
    colors: []
  },
  "iphone-16-pro": {
    label: "iPhone 16 Pro",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-16-pro-overzicht",
    storages: [],
    colors: []
  },
  "iphone-16-pro-max": {
    label: "iPhone 16 Pro Max",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-16-pro-max-overzicht",
    storages: [],
    colors: []
  },
  "iphone-17e": {
    label: "iPhone 17e",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-17e-overzicht",
    storages: [],
    colors: []
  },
  "iphone-17": {
    label: "iPhone 17",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-17-overzicht",
    storages: [],
    colors: []
  },
  "iphone-air": {
    label: "iPhone Air",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-air-overzicht",
    storages: [],
    colors: []
  },
  "iphone-17-pro": {
    label: "iPhone 17 Pro",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-17-pro-overzicht",
    storages: [],
    colors: []
  },
  "iphone-17-pro-max": {
    label: "iPhone 17 Pro Max",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-17-pro-max-overzicht",
    storages: [],
    colors: []
  }
};

function forzaGetTestModel(modelKey) {
  return FORZA_TEST_MODELS[String(modelKey || "").trim().toLowerCase()] || null;
}

function forzaExtractColorVariants(html, baseUrl, modelConfig) {
  const source = String(html || "");
  const wantedModel = String(modelConfig?.label || "").trim();
  if (!wantedModel || !source) return [];

  const configuredColors = Array.isArray(modelConfig?.colors) ? modelConfig.colors : [];
  const configuredStorages = Array.isArray(modelConfig?.storages) ? modelConfig.storages : [];
  const norm = v => String(v || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Build the exact model slug from the configured overview URL. This avoids
  // the old iPhone 11 vs 11 Pro/Pro Max prefix collision.
  let overviewSlug = "";
  try {
    overviewSlug = decodeURIComponent(new URL(baseUrl).pathname.split("/").filter(Boolean).pop() || "")
      .replace(/-overzicht$/i, "").toLowerCase();
  } catch {}
  const labelSlug = wantedModel
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/\s+/g, "-");
  const modelSlugs = [...new Set([
    overviewSlug,
    labelSlug,
    wantedModel === "iPhone SE (2022)" ? "iphone-se-2022" : "",
    wantedModel === "iPhone Air" ? "iphone-air" : ""
  ].filter(Boolean))];

  const storageRe = /\b(\d+)\s*(GB|TB)\b/i;
  const colorMap = {
    zwart:"Zwart", black:"Zwart", wit:"Wit", white:"Wit", rood:"Rood", red:"Rood",
    blauw:"Blauw", blue:"Blauw", groen:"Groen", green:"Groen", roze:"Roze", pink:"Roze",
    paars:"Paars", purple:"Paars", geel:"Geel", yellow:"Geel", zilver:"Zilver", silver:"Zilver",
    goud:"Goud", gold:"Goud", oranje:"Oranje", orange:"Oranje", space:"Space", grey:"Grey",
    gray:"Grey", natural:"Natural", desert:"Desert", titanium:"Titanium", blacktitanium:"Black Titanium",
    whitetitanium:"White Titanium", naturaltitanium:"Natural Titanium", deserttitanium:"Desert Titanium",
    bluetitanium:"Blue Titanium", rosegold:"Rose Gold", midnightgreen:"Midnight Green"
  };
  const prettify = value => String(value || "")
    .replace(/\.(?:html?)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(token => colorMap[token.toLowerCase()] || token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");

  const decodeHtml = value => String(value || "")
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/gi, "/");

  const candidates = new Map();
  const addCandidate = (rawHref, rawText = "") => {
    const href = decodeHtml(String(rawHref || "").trim());
    if (!href || /^javascript:/i.test(href) || href === "#") return;
    let absolute;
    try { absolute = new URL(href, baseUrl).toString(); } catch { return; }
    if (!/^https?:\/\/www\.forza-refurbished\.nl\//i.test(absolute)) return;

    let pathSlug = "";
    try { pathSlug = decodeURIComponent(new URL(absolute).pathname.split("/").filter(Boolean).pop() || "").toLowerCase(); }
    catch { return; }

    // Only accept concrete product URLs: model slug immediately followed by
    // storage. This is the key rule that prevents 11/11 Pro/11 Pro Max mixing.
    let matchedModelSlug = modelSlugs.find(slug =>
      new RegExp(`^${slug.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}-\\d+(?:-?gb|-?tb)(?:-|$)`, "i").test(pathSlug)
    );
    if (!matchedModelSlug) return;

    const storageMatch = pathSlug.match(new RegExp(`^${matchedModelSlug.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}-([0-9]+)-(?:gb|tb)(?:-|$)`, "i"))
      || pathSlug.match(new RegExp(`^${matchedModelSlug.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}-([0-9]+)(?:gb|tb)(?:-|$)`, "i"));
    if (!storageMatch) return;
    const storageUnit = /tb/i.test(pathSlug.slice(storageMatch.index || 0)) ? "TB" : "GB";
    const storage = `${storageMatch[1]}${storageUnit}`;
    if (configuredStorages.length && !configuredStorages.includes(storage)) return;

    let colorSlug = pathSlug.slice((pathSlug.indexOf(storageMatch[0]) + storageMatch[0].length));
    colorSlug = colorSlug.replace(/^-+/, "").replace(/-(?:esim|no-face-id|margeartikel).*$/i, "");
    let color = prettify(colorSlug);

    // Prefer the concrete card text when available. It preserves Forza's
    // current human-readable colour names such as "Natural Titanium".
    const text = norm(rawText);
    const textStorage = text.match(storageRe);
    if (textStorage) {
      const after = text.slice(textStorage.index + textStorage[0].length).replace(/^[\s|:-]+/, "").trim();
      if (after) {
        const stop = after.split(/\s+(?:Vanaf|Op voorraad|Tijdelijk|€)/i)[0].trim();
        if (stop && stop.length <= 60) color = stop;
      }
    }
    if (!color) return;
    if (configuredColors.length && !configuredColors.some(c => String(c).toLowerCase() === color.toLowerCase())) return;

    const productName = `${wantedModel} ${storage} ${color}`;
    const colorKey = String(color).toLowerCase()
      .replace(/silver/g, "zilver")
      .replace(/gold/g, "goud")
      .replace(/black/g, "zwart")
      .replace(/white/g, "wit")
      .replace(/red/g, "rood")
      .replace(/blue/g, "blauw")
      .replace(/green/g, "groen")
      .replace(/purple/g, "paars")
      .replace(/pink/g, "roze")
      .replace(/yellow/g, "geel")
      .replace(/gray/g, "grey")
      .replace(/\s+/g, " ")
      .trim();
    candidates.set(`${storage}|${colorKey}`, { model: wantedModel, storage, color, productName, sourceUrl: absolute });
  };

  // Product cards may put their URL in href, data-href, data-url, data-product-url
  // or JSON-escaped attributes. Read all of them instead of depending on one
  // particular Forza HTML layout. For normal <a> cards we pass the real link
  // text, which preserves Forza's current Dutch colour names exactly.
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let anchor;
  while ((anchor = anchorRe.exec(source))) {
    const attrs = anchor[1] || "";
    const text = norm(anchor[2] || "");
    const urlRe = /(?:href|data-href|data-url|data-product-url|data-product-link|data-link|data-redirect)\s*=\s*["']([^"']+)["']/gi;
    let u;
    while ((u = urlRe.exec(attrs))) addCandidate(u[1], text);
  }

  // Do NOT use a large neighbouring DOM context for product-card links.
  // On Forza's current markup, that context can contain the previous card's
  // colour (often "Zwart"), which makes every discovered variant inherit
  // the same colour. The URL itself already contains the exact colour slug,
  // so attribute-only fallback is safer.
  const tagRe = /<(?:article|div|li|button)[^>]*>/gi;
  let tag;
  while ((tag = tagRe.exec(source))) {
    const attrs = tag[0];
    const urlRe = /(?:href|data-href|data-url|data-product-url|data-product-link|data-link|data-redirect)\s*=\s*["']([^"']+)["']/gi;
    let u;
    while ((u = urlRe.exec(attrs))) addCandidate(u[1], "");
  }

  // Also scan the raw HTML for absolute/escaped Forza product URLs. This
  // catches JSON blobs used by some versions of the webshop where no anchor
  // tag is present in the server-rendered markup.
  const rawUrlRe = /https?:\\?\/\\?\/www\.forza-refurbished\.nl\\?\/[^"'\s<>\\]+/gi;
  let rawUrl;
  while ((rawUrl = rawUrlRe.exec(source))) addCandidate(rawUrl[0], "");

  // Finally, scan normal hrefs with a small context window. This handles
  // relative links and keeps the parser resilient to future card markup.
  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
  let h;
  while ((h = hrefRe.exec(source))) {
    // Anchor parsing above already supplied the exact visible card text. For
    // this generic fallback, use only the URL so a neighbouring product card
    // cannot leak its text into the colour of this variant.
    addCandidate(h[1], "");
  }

  return [...candidates.values()].sort((a, b) =>
    `${a.storage}|${a.color}`.localeCompare(`${b.storage}|${b.color}`, "nl", { numeric: true })
  );
}

// V12: exact iPhone 12 variant matrix from the current Forza catalog.
// 64/128/256 GB exist; 512 GB and 1 TB are intentionally unavailable.
const FORZA_IPHONE12_VARIANTS = [
  ["64GB",  ["Zwart","Wit","Blauw","Groen","Paars","Rood"]],
  ["128GB", ["Zwart","Wit","Blauw","Groen","Paars","Rood"]],
  ["256GB", ["Zwart","Wit","Blauw","Groen","Paars","Rood"]]
].flatMap(([storage, colors]) => colors.map(color => ({
  model: "iPhone 12", storage, color,
  productName: `iPhone 12 ${storage} ${color}`
})));

function forzaNormalizeVariantName(value) {
  return String(value || "")
    .replace(/\b(\d+)\s*(GB|TB)\b/ig, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

function forzaFindIphone12Variant(value) {
  const wanted = forzaNormalizeVariantName(value).toLowerCase();
  return FORZA_IPHONE12_VARIANTS.find(v => forzaNormalizeVariantName(v.productName).toLowerCase() === wanted) || null;
}

function forzaExtractStorageLinks(html, baseUrl, fallbackMap = {}, allowedStorages = ["64GB", "128GB", "256GB"], preferredColor = "") {
  const found = new Map();
  const source = String(html || "");
  const basePath = new URL(baseUrl).pathname.replace(/\/$/, "");
  const rawBaseSlug = decodeURIComponent(basePath.split("/").pop() || "").toLowerCase();
  const baseSlug = rawBaseSlug.replace(/-overzicht$/i, "");
  const modelSlugs = new Set([baseSlug, baseSlug.startsWith("iphone-") ? baseSlug : `iphone-${baseSlug}`]);
  const colorSlug = String(preferredColor || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const hrefPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match;
  const candidates = [];
  while ((match = hrefPattern.exec(source))) {
    try {
      const absolute = new URL(match[1], baseUrl).toString();
      const pathSlug = decodeURIComponent(new URL(absolute).pathname.split("/").pop() || "").toLowerCase();
      const matchesModel = [...modelSlugs].some(slug => slug && pathSlug.startsWith(slug + "-"));
      if (!matchesModel) continue;
      const sm = pathSlug.match(/-(64|128|256)(?:-?gb)(?:-|$)/i);
      if (!sm) continue;
      const storage = `${sm[1]}GB`;
      if (!allowedStorages.includes(storage)) continue;
      candidates.push({storage, absolute, colorMatch: !!colorSlug && pathSlug.endsWith("-" + colorSlug)});
    } catch {}
  }
  for (const storage of allowedStorages) {
    const sameColor = candidates.find(c => c.storage === storage && c.colorMatch);
    const any = candidates.find(c => c.storage === storage);
    const chosen = sameColor || any;
    if (chosen) found.set(storage, chosen.absolute);
  }
  for (const [storage, url] of Object.entries(fallbackMap || {})) if (url) found.set(storage, url);
  return allowedStorages.filter(storage => found.has(storage)).map(storage => ({storage, url:found.get(storage)}));
}

function forzaSelectedStorage(result) {
  const title = String(result?.product?.name || "");
  const match = title.match(/\b(\d+)\s*(GB|TB)\b/i);
  return match ? `${match[1]}GB` : "";
}


// Forza -> HOMS TECH price update.
// This endpoint is intentionally separate from the read-only test endpoint.
// It changes ONLY the matched phone's condition/storage/battery price options
// after the admin explicitly confirms the comparison.
app.put("/api/admin/forza/update-prices", requirePermission("site.save"), async (req, res) => {
  const body = req.body || {};
  const productName = String(body.productName || "").trim();
  const rows = Array.isArray(body.rows) ? body.rows : [];

  const norm = (v) => String(v ?? "")
    .toLowerCase()
    .replace(/&nbsp;/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const modelKey = (v) => norm(v)
    .replace(/\b\d+\s*(?:gb|tb)\b/ig, " ")
    .replace(/\s+/g, " ")
    .replace(/\b(paars|purple|zwart|black|wit|white|rood|red|blauw|blue|groen|green)\b/ig, " ")
    .replace(/\s+/g, " ")
    .trim();

  const storageKey = (v) => {
    const m = String(v ?? "").match(/(\d+)\s*gb/i);
    return m ? `${m[1]}GB` : "";
  };

  const conditionKey = (v) => {
    const x = norm(v);
    if (x.includes("zo goed als nieuw")) return "zo goed als nieuw";
    if (x.includes("licht gebruikt")) return "licht gebruikt";
    if (x.includes("zichtbaar gebruikt")) return "zichtbaar gebruikt";
    return x;
  };

  const batteryKey = (v) => norm(v).includes("nieuw") ? "nieuw" : "standaard";

  const money = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  };

  if (!productName || ![6,18].includes(rows.length)) {
    return res.status(400).json({
      success: false,
      error: "Forza-update vereist 6 regels voor één gekozen opslag of 18 regels voor alle opslagvarianten."
    });
  }

  const cleanRows = rows.map(r => ({
    storage: storageKey(r.storage),
    condition: conditionKey(r.condition),
    battery: batteryKey(r.battery),
    price: money(r.price)
  }));

  if (cleanRows.some(r => !["64GB","128GB","256GB"].includes(r.storage) ||
      !["zo goed als nieuw","licht gebruikt","zichtbaar gebruikt"].includes(r.condition) ||
      !["standaard","nieuw"].includes(r.battery) ||
      r.price === null || r.price < 0)) {
    return res.status(400).json({
      success: false,
      error: "De Forza-preview bevat ontbrekende of ongeldige prijzen."
    });
  }

  const actual = cleanRows.map(r => `${r.storage}|${r.condition}|${r.battery}`);
  const uniqueActual = new Set(actual);
  const allExpected = [];
  for (const storage of ["64GB","128GB","256GB"]) {
    for (const condition of ["zo goed als nieuw","licht gebruikt","zichtbaar gebruikt"]) {
      for (const battery of ["standaard","nieuw"]) allExpected.push(`${storage}|${condition}|${battery}`);
    }
  }
  const selectedStorage = cleanRows.length===6 ? cleanRows[0].storage : "";
  const selectedExpected = selectedStorage ? ["zo goed als nieuw","licht gebruikt","zichtbaar gebruikt"].flatMap(c=>["standaard","nieuw"].map(b=>`${selectedStorage}|${c}|${b}`)) : [];
  const validSix = cleanRows.length===6 && !!selectedStorage && uniqueActual.size===6 && selectedExpected.every(k=>uniqueActual.has(k));
  const validEighteen = cleanRows.length===18 && uniqueActual.size===18 && allExpected.every(k=>uniqueActual.has(k));
  if (!validSix && !validEighteen) {
    return res.status(400).json({
      success: false,
      error: "De preview moet compleet zijn: 6 regels voor één opslag of alle 18 storage/conditie/batterij-combinaties."
    });
  }

  const getPrice = (storage, condition, battery) => {
    const r = cleanRows.find(x => x.storage === storage && x.condition === condition && x.battery === battery);
    return r ? r.price : null;
  };

  const incomingMatrix = {};
  for (const r of cleanRows) incomingMatrix[`${r.storage}|${r.condition}|${r.battery}`] = r.price;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT data FROM site_settings WHERE id = 1 FOR UPDATE");
    if (!result.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Websitegegevens niet gevonden." });
    }

    const data = result.rows[0].data || {};
    if (!Array.isArray(data.phones)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, error: "Telefooncatalogus ontbreekt." });
    }

    const wantedExact = norm(productName);
    const bestIndex = data.phones.findIndex(phone => norm(phone?.name || "") === wantedExact);

    if (bestIndex < 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        error: `HOMS TECH-product niet gevonden voor "${productName}". Geen wijziging uitgevoerd.`
      });
    }

    const phone = data.phones[bestIndex];
    if (!Array.isArray(phone.conditionOptions) ||
        !Array.isArray(phone.storageOptions) ||
        !Array.isArray(phone.batteryOptions)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        error: "Dit product heeft geen complete prijsopties. Geen wijziging uitgevoerd."
      });
    }

    const findCondition = key => phone.conditionOptions.find(o => conditionKey(o?.label) === key);
    const findStorage = key => phone.storageOptions.find(o => storageKey(o?.label) === key);
    const findBattery = key => phone.batteryOptions.find(o => batteryKey(o?.label) === key);

    for (const key of ["zo goed als nieuw","licht gebruikt","zichtbaar gebruikt"]) {
      if (!findCondition(key)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ success:false, error:`Conditie "${key}" ontbreekt. Geen wijziging uitgevoerd.` });
      }
    }
    for (const key of ["64GB","128GB","256GB"]) {
      if (!findStorage(key)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ success:false, error:`Opslag "${key}" ontbreekt. Geen wijziging uitgevoerd.` });
      }
    }
    if (!findBattery("standaard") || !findBattery("nieuw")) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success:false, error:"Batterijopties ontbreken. Geen wijziging uitgevoerd." });
    }

    const before = {
      conditions: phone.conditionOptions.map(o => ({label:o.label, basePrice:o.basePrice})),
      storage: phone.storageOptions.map(o => ({label:o.label, priceDelta:o.priceDelta})),
      battery: phone.batteryOptions.map(o => ({label:o.label, priceDelta:o.priceDelta})),
      forzaPriceMatrix: phone.forzaPriceMatrix || null
    };

    const previousMatrix = (phone.forzaPriceMatrix && typeof phone.forzaPriceMatrix === "object") ? {...phone.forzaPriceMatrix} : {};
    const mergedMatrix = {...previousMatrix, ...incomingMatrix};
    if (validEighteen) {
      const getIncoming=(s,c,b)=>incomingMatrix[`${s}|${c}|${b}`];
      const bases={};
      for (const c of ["zo goed als nieuw","licht gebruikt","zichtbaar gebruikt"]) bases[c]=getIncoming("64GB",c,"standaard");
      const batteryDelta=getIncoming("64GB","zo goed als nieuw","nieuw")-bases["zo goed als nieuw"];
      const storageDeltas={};
      for (const st of ["64GB","128GB","256GB"]) storageDeltas[st]=getIncoming(st,"zo goed als nieuw","standaard")-bases["zo goed als nieuw"];
      for (const key of ["zo goed als nieuw","licht gebruikt","zichtbaar gebruikt"]) findCondition(key).basePrice=bases[key];
      findStorage("64GB").priceDelta=0;
      findStorage("128GB").priceDelta=storageDeltas["128GB"];
      findStorage("256GB").priceDelta=storageDeltas["256GB"];
      findBattery("standaard").priceDelta=0;
      findBattery("nieuw").priceDelta=batteryDelta;
    } else {
      // A single selected storage can be updated safely without requiring the other 12 prices.
      const st=selectedStorage;
      const base64Std=(previousMatrix[`${st}|zo goed als nieuw|standaard`] ?? findCondition("zo goed als nieuw").basePrice);
      const incomingBase=getPrice(st,"zo goed als nieuw","standaard");
      if (st==="64GB") {
        for (const c of ["zo goed als nieuw","licht gebruikt","zichtbaar gebruikt"]) {
          const v=getPrice(st,c,"standaard"); if (v!==null) findCondition(c).basePrice=v;
        }
      } else if (incomingBase!==null && Number.isFinite(Number(base64Std))) {
        findStorage(st).priceDelta=Number(incomingBase)-Number(base64Std);
      }
      const ns=getPrice(st,"zo goed als nieuw","nieuw"), ss=getPrice(st,"zo goed als nieuw","standaard");
      if (ns!==null && ss!==null) findBattery("nieuw").priceDelta=Number(ns)-Number(ss);
    }

    phone.forzaPriceMatrix = mergedMatrix;
    phone.forzaPriceMatrixSource = "Forza public website";
    phone.forzaPriceMatrixUpdatedAt = new Date().toISOString();

    const after = {
      conditions: phone.conditionOptions.map(o => ({label:o.label, basePrice:o.basePrice})),
      storage: phone.storageOptions.map(o => ({label:o.label, priceDelta:o.priceDelta})),
      battery: phone.batteryOptions.map(o => ({label:o.label, priceDelta:o.priceDelta})),
      forzaPriceMatrix: phone.forzaPriceMatrix
    };

    await client.query(
      "UPDATE site_settings SET data = $1 WHERE id = 1",
      [JSON.stringify(data)]
    );
    await client.query("COMMIT");

    res.json({
      success: true,
      readOnly: false,
      updatedProduct: phone.name,
      sourceProduct: productName,
      before,
      after,
      message: "Forza-prijzen zijn bijgewerkt. Alleen de prijsopties van dit product zijn gewijzigd."
    });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Forza price update error:", error);
    res.status(500).json({
      success: false,
      error: "Forza-prijzen konden niet worden bijgewerkt."
    });
  } finally {
    client.release();
  }
});


// Forza -> HOMS TECH FULL SYNC.
// Explicit admin action only. Updates one exact HOMS TECH product with the
// already-read Forza prices plus non-empty product metadata/images.
app.put("/api/admin/forza/full-sync", requirePermission("site.save"), async (req, res) => {
  const body = req.body || {};
  const productName = String(body.productName || "").trim();
  const targetPhoneName = String(body.targetPhoneName || "").trim();
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const product = body.product && typeof body.product === "object" ? body.product : {};
  const allowImages = product.allowImages !== false;

  const norm = (v) => String(v ?? "")
    .toLowerCase()
    .replace(/&nbsp;/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const modelKey = (v) => norm(v)
    .replace(/\b\d+\s*(?:gb|tb)\b/ig, " ")
    .replace(/\s+/g, " ")
    .replace(/\b(paars|purple|zwart|black|wit|white|rood|red|blauw|blue|groen|green)\b/ig, " ")
    .replace(/\s+/g, " ")
    .trim();
  const storageKey = (v) => {
    const m = String(v ?? "").match(/(\d+)\s*gb/i);
    return m ? `${m[1]}GB` : "";
  };
  const conditionKey = (v) => {
    const x = norm(v);
    if (x.includes("zo goed als nieuw")) return "zo goed als nieuw";
    if (x.includes("licht gebruikt")) return "licht gebruikt";
    if (x.includes("zichtbaar gebruikt")) return "zichtbaar gebruikt";
    return x;
  };
  const batteryKey = (v) => norm(v).includes("nieuw") ? "nieuw" : "standaard";
  const money = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  };

  if (!productName || !targetPhoneName || ![6,18].includes(rows.length)) {
    return res.status(400).json({success:false,error:"Full Sync vereist het geselecteerde HOMS TECH-product en 6 regels voor één opslag of 18 regels voor alle opslagvarianten."});
  }

  const cleanRows = rows.map(r => ({
    storage: storageKey(r.storage),
    condition: conditionKey(r.condition),
    battery: batteryKey(r.battery),
    price: money(r.price)
  }));
  const actual = cleanRows.map(r => `${r.storage}|${r.condition}|${r.battery}`);
  const uniqueActual = new Set(actual);
  const allExpected = [];
  for (const storage of ["64GB","128GB","256GB"])
    for (const condition of ["zo goed als nieuw","licht gebruikt","zichtbaar gebruikt"])
      for (const battery of ["standaard","nieuw"]) allExpected.push(`${storage}|${condition}|${battery}`);
  const selectedStorage = cleanRows.length===6 ? cleanRows[0].storage : "";
  const selectedExpected = selectedStorage ? ["zo goed als nieuw","licht gebruikt","zichtbaar gebruikt"].flatMap(c=>["standaard","nieuw"].map(b=>`${selectedStorage}|${c}|${b}`)) : [];
  const validSix = cleanRows.length===6 && !!selectedStorage && uniqueActual.size===6 && selectedExpected.every(k=>uniqueActual.has(k));
  const validEighteen = cleanRows.length===18 && uniqueActual.size===18 && allExpected.every(k=>uniqueActual.has(k));
  if (cleanRows.some(r => !["64GB","128GB","256GB"].includes(r.storage) || !["zo goed als nieuw","licht gebruikt","zichtbaar gebruikt"].includes(r.condition) || !["standaard","nieuw"].includes(r.battery) || r.price === null || r.price < 0) || (!validSix && !validEighteen)) {
    return res.status(400).json({success:false,error:"Full Sync bevat geen geldige prijsregels: gebruik 6 regels voor één opslag of alle 18."});
  }

  const incomingMatrix = {};
  for (const r of cleanRows) incomingMatrix[`${r.storage}|${r.condition}|${r.battery}`] = r.price;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT data FROM site_settings WHERE id = 1 FOR UPDATE");
    if (!result.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({success:false,error:"Websitegegevens niet gevonden."}); }
    const data = result.rows[0].data || {};
    if (!Array.isArray(data.phones)) { await client.query("ROLLBACK"); return res.status(400).json({success:false,error:"Telefooncatalogus ontbreekt."}); }

    const wantedExact = norm(targetPhoneName);
    const bestIndex = data.phones.findIndex(phone => norm(phone?.name || "") === wantedExact);
    if (bestIndex < 0) { await client.query("ROLLBACK"); return res.status(404).json({success:false,error:`Exact HOMS TECH-product "${targetPhoneName}" niet gevonden. Geen wijziging uitgevoerd.`}); }

    const phone = data.phones[bestIndex];
    if (!Array.isArray(phone.conditionOptions) || !Array.isArray(phone.storageOptions) || !Array.isArray(phone.batteryOptions)) {
      await client.query("ROLLBACK"); return res.status(400).json({success:false,error:"Dit product heeft geen complete prijsopties. Geen wijziging uitgevoerd."});
    }
    const findCondition = key => phone.conditionOptions.find(o => conditionKey(o?.label) === key);
    const findStorage = key => phone.storageOptions.find(o => storageKey(o?.label) === key);
    const findBattery = key => phone.batteryOptions.find(o => batteryKey(o?.label) === key);
    for (const key of ["zo goed als nieuw","licht gebruikt","zichtbaar gebruikt"]) if (!findCondition(key)) { await client.query("ROLLBACK"); return res.status(400).json({success:false,error:`Conditie "${key}" ontbreekt. Geen wijziging uitgevoerd.`}); }
    for (const key of ["64GB","128GB","256GB"]) if (!findStorage(key)) { await client.query("ROLLBACK"); return res.status(400).json({success:false,error:`Opslag "${key}" ontbreekt. Geen wijziging uitgevoerd.`}); }
    if (!findBattery("standaard") || !findBattery("nieuw")) { await client.query("ROLLBACK"); return res.status(400).json({success:false,error:"Batterijopties ontbreken. Geen wijziging uitgevoerd."}); }

    const previousMatrix = (phone.forzaPriceMatrix && typeof phone.forzaPriceMatrix === "object") ? {...phone.forzaPriceMatrix} : {};
    const mergedMatrix = {...previousMatrix, ...incomingMatrix};
    if (validEighteen) {
      const getIncoming=(s,c,b)=>incomingMatrix[`${s}|${c}|${b}`];
      const bases={};
      for (const c of ["zo goed als nieuw","licht gebruikt","zichtbaar gebruikt"]) bases[c]=getIncoming("64GB",c,"standaard");
      const batteryDelta=getIncoming("64GB","zo goed als nieuw","nieuw")-bases["zo goed als nieuw"];
      const storageDeltas={};
      for (const st of ["64GB","128GB","256GB"]) storageDeltas[st]=getIncoming(st,"zo goed als nieuw","standaard")-bases["zo goed als nieuw"];
      for (const key of ["zo goed als nieuw","licht gebruikt","zichtbaar gebruikt"]) findCondition(key).basePrice=bases[key];
      findStorage("64GB").priceDelta=0; findStorage("128GB").priceDelta=storageDeltas["128GB"]; findStorage("256GB").priceDelta=storageDeltas["256GB"];
      findBattery("standaard").priceDelta=0; findBattery("nieuw").priceDelta=batteryDelta;
    } else {
      const st=selectedStorage;
      const base64Std=previousMatrix[`${st}|zo goed als nieuw|standaard`] ?? findCondition("zo goed als nieuw").basePrice;
      const incomingBase=incomingMatrix[`${st}|zo goed als nieuw|standaard`];
      if(st==="64GB") {
        for(const c of ["zo goed als nieuw","licht gebruikt","zichtbaar gebruikt"]) { const v=incomingMatrix[`${st}|${c}|standaard`]; if(Number.isFinite(Number(v))) findCondition(c).basePrice=Number(v); }
      } else if(Number.isFinite(Number(incomingBase)) && Number.isFinite(Number(base64Std))) {
        findStorage(st).priceDelta=Number(incomingBase)-Number(base64Std);
      }
      const np=incomingMatrix[`${st}|zo goed als nieuw|nieuw`], sp=incomingMatrix[`${st}|zo goed als nieuw|standaard`];
      if(Number.isFinite(Number(np)) && Number.isFinite(Number(sp))) findBattery("nieuw").priceDelta=Number(np)-Number(sp);
    }
    phone.forzaPriceMatrix = mergedMatrix;
    phone.forzaPriceMatrixSource = "Forza public website";
    phone.forzaPriceMatrixUpdatedAt = new Date().toISOString();

    const images = allowImages && Array.isArray(product.images) ? [...new Set(product.images.filter(x => typeof x === "string" && /^https?:\/\//i.test(x)))].slice(0,4) : [];
    const specs = Array.isArray(product.specs) ? product.specs.slice(0,20) : [];
    if (product.brand) phone.brand = String(product.brand);
    if (product.sku) phone.sku = String(product.sku);
    if (product.color) phone.color = String(product.color);
    if (product.description) phone.description = String(product.description);
    if (Number.isFinite(Number(product.stock))) phone.stock = Number(product.stock);
    if (specs.length) phone.specifications = specs;
    if (allowImages && images.length) { phone.images = images.slice(0,4); phone.forzaImages = images; }
    phone.forzaImagesEnabled = allowImages;
    phone.forzaSourceUrl = String(product.sourceUrl || product.canonical || "");
    phone.forzaProductData = {
      name: product.name || productName,
      brand: product.brand || "",
      sku: product.sku || "",
      color: product.color || "",
      storage: product.storage || [],
      stock: product.stock ?? null,
      specs,
      description: product.description || "",
      images: allowImages ? images : (Array.isArray(phone.images) ? phone.images.slice(0,4) : []),
      sourceUrl: product.sourceUrl || product.canonical || "",
      syncedAt: new Date().toISOString()
    };

    await client.query("UPDATE site_settings SET data = $1 WHERE id = 1", [JSON.stringify(data)]);
    await client.query("COMMIT");
    res.json({success:true,readOnly:false,updatedProduct:phone.name,sourceProduct:productName,message:allowImages ? "Forza Full Sync voltooid: prijzen, productgegevens en afbeeldingen zijn bijgewerkt." : "Forza Full Sync voltooid: prijzen en productgegevens zijn bijgewerkt; bestaande HOMS TECH-foto's zijn behouden."});
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Forza full sync error:", error);
    res.status(500).json({success:false,error:"Forza Full Sync mislukt. Geen wijziging is bevestigd."});
  } finally { client.release(); }
});

app.get("/api/forza-version", requirePermission("phones.view"), (req, res) => res.json({success:true,version:"V30",bulkImport:true}));

async function forzaFetchOverviewBundle(sourceUrl, maxPages = 3) {
  const first = await forzaFetchPublicPage(sourceUrl);
  if (!first.response.ok) return first;

  let html = first.html;
  let previous = first.html;
  const pages = Math.max(1, Math.min(Number(maxPages) || 3, 5));

  // Forza's catalogue pagination currently uses ?p=2, ?p=3, ... . Some older
  // layouts used ?page=2, so if the first p=2 page is identical we retry with
  // the legacy parameter once. We keep this generic for every iPhone model.
  for (let page = 2; page <= pages; page++) {
    let next = null;
    try {
      const u = new URL(sourceUrl);
      u.searchParams.set("p", String(page));
      next = await forzaFetchPublicPage(u.toString());
    } catch {}

    if (!next?.response?.ok || !next.html) {
      if (page === 2) {
        try {
          const u = new URL(sourceUrl);
          u.searchParams.set("page", String(page));
          next = await forzaFetchPublicPage(u.toString());
        } catch {}
      }
    }
    if (!next?.response?.ok || !next.html) break;

    // Do not append the same page repeatedly if Forza ignores the pagination
    // parameter or redirects to the first page.
    if (next.html === previous) break;
    html += "\n" + next.html;
    previous = next.html;
  }
  return { response: first.response, html };
}

async function forzaFetchExactVariantFromUrl(productName, exactUrl) {
  const url = String(exactUrl || "").trim();
  if (!/^https?:\/\/www\.forza-refurbished\.nl\//i.test(url)) return null;
  try {
    const page = await forzaFetchPublicPage(url);
    if (!page.response.ok) return null;
    const parsed = forzaExtractTest(page.html, url);
    const images = forzaExtractVariantGalleryImages(page.html, productName);
    const fallbackImages = images.length ? images : (Array.isArray(parsed?.product?.images) ? parsed.product.images : []);
    return { url, parsed, images: [...new Set(fallbackImages)].slice(0,4) };
  } catch { return null; }
}


// =====================================================
// MOBICO READ-ONLY TEST (kept completely separate from Forza)
// =====================================================
const MOBICO_TEST_MODELS = {
  "iphone-11":"iPhone 11","iphone-11-pro":"iPhone 11 Pro","iphone-11-pro-max":"iPhone 11 Pro Max",
  "iphone-12-mini":"iPhone 12 Mini","iphone-12":"iPhone 12","iphone-12-pro":"iPhone 12 Pro","iphone-12-pro-max":"iPhone 12 Pro Max",
  "iphone-13-mini":"iPhone 13 Mini","iphone-13":"iPhone 13","iphone-13-pro":"iPhone 13 Pro","iphone-13-pro-max":"iPhone 13 Pro Max",
  "iphone-14":"iPhone 14","iphone-14-plus":"iPhone 14 Plus","iphone-14-pro":"iPhone 14 Pro","iphone-14-pro-max":"iPhone 14 Pro Max",
  "iphone-15":"iPhone 15","iphone-15-plus":"iPhone 15 Plus","iphone-15-pro":"iPhone 15 Pro","iphone-15-pro-max":"iPhone 15 Pro Max",
  "iphone-16e":"iPhone 16e","iphone-16":"iPhone 16","iphone-16-plus":"iPhone 16 Plus","iphone-16-pro":"iPhone 16 Pro","iphone-16-pro-max":"iPhone 16 Pro Max",
  "iphone-17e":"iPhone 17e","iphone-17":"iPhone 17","iphone-air":"iPhone Air","iphone-17-pro":"iPhone 17 Pro","iphone-17-pro-max":"iPhone 17 Pro Max"
};

function mobicoDecode(value){
  return String(value || "")
    .replace(/&#39;|&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/&amp;/gi,"&")
    .replace(/&nbsp;/gi," ").replace(/&#x2F;/gi,"/").replace(/&#47;/gi,"/");
}
function mobicoClean(value){
  return mobicoDecode(String(value || "").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," "))
    .replace(/\s+/g," ").trim();
}
function mobicoEuro(value){
  const m=String(value || "").replace(/\u00a0/g," ").match(/(?:€\s*)?([0-9]{1,4}(?:[.,][0-9]{1,2})?)/);
  if(!m)return null;
  const n=Number(m[1].replace(/\./g,"").replace(",","."));
  return Number.isFinite(n)?n:null;
}
function mobicoMoneyFromText(value){
  const s=String(value || "").replace(/\u00a0/g," ");
  const m=s.match(/€\s*([0-9]{1,4}(?:[.,][0-9]{1,2})?)/);
  return m ? mobicoEuro(m[0]) : null;
}
function mobicoExtractBasePrice(html,text,name){
  const source=String(html||"");
  // 1) Structured product price (most reliable when present).
  const structured=[
    /<meta\b[^>]*(?:property|name)=["'](?:product:price:amount|price)["'][^>]*content=["']([^"']+)["']/i,
    /<[^>]+itemprop=["']price["'][^>]*content=["']([^"']+)["']/i,
    /<[^>]+content=["']([^"']+)["'][^>]*itemprop=["']price["'][^>]*>/i,
    /["']price["']\s*:\s*["']([0-9]+(?:[.,][0-9]{1,2})?)["']/i
  ];
  for(const re of structured){
    const m=source.match(re);
    if(m){ const n=mobicoEuro(m[1]); if(Number.isFinite(n)) return n; }
  }
  // 2) Visible price immediately around the product title.
  const idx=String(text||"").toLowerCase().indexOf(String(name||"").toLowerCase());
  if(idx>=0){
    const near=String(text||"").slice(idx,idx+1800);
    const n=mobicoMoneyFromText(near);
    if(Number.isFinite(n)) return n;
  }
  // 3) First realistic euro amount in the page text (avoid tiny accessory amounts).
  const matches=String(text||"").match(/€\s*[0-9]{2,4}(?:[.,][0-9]{1,2})?/g)||[];
  for(const raw of matches){ const n=mobicoEuro(raw); if(Number.isFinite(n) && n>=50) return n; }
  return null;
}
function mobicoSlug(value){
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
}
function mobicoHtmlAttr(html, attr, value){
  const re=new RegExp(`<meta\\b[^>]*${attr}=["']${value}["'][^>]*>`,`i`);
  const m=String(html||"").match(re); return m?m[0]:"";
}
function mobicoMeta(html,name){
  const source=String(html||"");
  const a=source.match(new RegExp(`<meta\\b[^>]*name=["']${name.replace(/[.*+?^${}()|[\\]\\]/g,"\\$&")}["'][^>]*content=["']([^"']+)["']`,`i`));
  const b=source.match(new RegExp(`<meta\\b[^>]*property=["']${name.replace(/[.*+?^${}()|[\\]\\]/g,"\\$&")}["'][^>]*content=["']([^"']+)["']`,`i`));
  const c=source.match(new RegExp(`<meta\\b[^>]*content=["']([^"']+)["'][^>]*property=["']${name.replace(/[.*+?^${}()|[\\]\\]/g,"\\$&")}["']`,`i`));
  return mobicoDecode((a&&a[1])||(b&&b[1])||(c&&c[1])||"");
}
function mobicoFindSection(text,startLabel,endLabel){
  const s=String(text||"");
  const a=s.toLowerCase().indexOf(String(startLabel||"").toLowerCase());
  if(a<0)return "";
  const from=s.slice(a);
  const b=endLabel ? from.toLowerCase().indexOf(String(endLabel).toLowerCase(),String(startLabel).length) : -1;
  return b>=0 ? from.slice(0,b) : from.slice(0,2500);
}
function mobicoParseOptionLines(section,names){
  const out=[];
  const src=String(section||"");
  for(const name of names){
    const re=new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\]/g,"\\$&")}\\b(?:\\s*([+-])\\s*€\\s*([0-9]+(?:[.,][0-9]+)?))?`,"ig");
    let m;
    while((m=re.exec(src))){
      const delta=m[2] ? Number(m[2].replace(",","."))*(m[1]==="-"?-1:1) : 0;
      if(!out.some(x=>x.label.toLowerCase()===name.toLowerCase()))out.push({label:name,delta});
    }
  }
  return out;
}
function mobicoExtractVariants(html,baseUrl,modelLabel){
  const source=String(html||"");
  const modelSlug=mobicoSlug(modelLabel);
  const wantedPrefix=`${modelSlug}-`;
  const map=new Map();
  const re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while((m=re.exec(source))){
    let absolute="";
    try{absolute=new URL(m[1],baseUrl).toString();}catch{continue;}
    if(!/^https?:\/\/mobico\.nl\/product\//i.test(absolute))continue;
    let slug="";
    try{slug=decodeURIComponent(new URL(absolute).pathname.split("/").filter(Boolean).pop()||"").toLowerCase();}catch{continue;}
    if(!slug.startsWith(wantedPrefix))continue;
    const sm=slug.match(new RegExp(`^${wantedPrefix.replace(/[.*+?^${}()|[\\]\\]/g,"\\$&")}(\\d+)(gb|tb)(?:-(.+))?$`));
    if(!sm)continue;
    const storage=`${sm[1]}${sm[2].toUpperCase()}`;
    const color=sm[3] ? sm[3].replace(/-/g," ").replace(/\b\w/g,c=>c.toUpperCase()) : "";
    const text=mobicoClean(m[2]);
    const name=text && /iphone/i.test(text) ? text : `${modelLabel} ${storage}${color?` ${color}`:""}`;
    map.set(absolute,{name,storage,color,url:absolute});
  }
  return [...map.values()];
}
function mobicoParseProduct(html,sourceUrl,modelLabel){
  const text=mobicoClean(html);
  const title=mobicoMeta(html,"og:title") || ((String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)||[])[1] ? mobicoClean((String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)||[])[1]) : "");
  const name=title.replace(/\s*\|.*$/g,"").replace(/\s+kopen\s*$/i,"").trim() || modelLabel;
  const productStorage=(name.match(/\b(\d+)\s*(GB|TB)\b/i)||[]);
  const storage=productStorage[1] ? `${productStorage[1]}${productStorage[2].toUpperCase()}` : "";
  const colorMatch=text.match(/Kleur\s*:\s*([^|]{2,50}?)(?=\s+(?:Staat|Goed|Heel goed|Als nieuw|Nieuwstaat|Batterij)\b)/i);
  const color=colorMatch ? colorMatch[1].trim() : (name.match(/\\b(?:Middernacht|Midnight|Zwart|Wit|Blauw|Rood|Groen|Roze|Paars|Geel|Goud|Zilver|Titanium|Natural Titanium|Desert Titanium|Black Titanium|White Titanium|Blue Titanium)\\b/i)||[])[0] || "";
  const price=mobicoExtractBasePrice(html,text,name);
  const storageSection=mobicoFindSection(text,"Opslag","Kleur");
  const storageOptionMatches=storageSection.match(/\b(\d+)\s*(GB|TB)\b(?:\s*([+-])\s*€\s*([0-9]+(?:[.,][0-9]+)?))?/gi)||[];
  const storageOptions=[];
  for(const raw of storageOptionMatches){
    const sm=raw.match(/\b(\d+)\s*(GB|TB)\b/i); if(!sm) continue;
    const deltaMatch=raw.match(/([+-])\s*€\s*([0-9]+(?:[.,][0-9]+)?)/i);
    const delta=deltaMatch ? Number(deltaMatch[2].replace(",","."))*(deltaMatch[1]==="-"?-1:1) : 0;
    const label=`${sm[1]}${sm[2].toUpperCase()}`;
    if(!storageOptions.some(x=>x.label===label)) storageOptions.push({label,delta,price:Number.isFinite(price)?price+delta:null});
  }
  const storageNames=storageOptions.map(x=>x.label);
  const stateSection=mobicoFindSection(text,"Staat","Batterij");
  const conditionNames=["Goed","Heel goed","Als nieuw","Nieuwstaat"];
  const conditions=mobicoParseOptionLines(stateSection,conditionNames).map(x=>({label:x.label,delta:x.delta,price:Number.isFinite(price)?price+x.delta:null}));
  const batterySection=mobicoFindSection(text,"Batterij","Wil je een apparaat");
  const battery=mobicoParseOptionLines(batterySection,["Standaard","Nieuw"]).map(x=>{
    if(x.label.toLowerCase()==="nieuw"){
      const tail=batterySection.match(/\bNieuw\b[\s\S]{0,90}?([+-])\s*€\s*([0-9]+(?:[.,][0-9]+)?)/i);
      if(tail) x.delta=Number(tail[2].replace(",","."))*(tail[1]==="-"?-1:1);
    }
    return {...x,price:Number.isFinite(price)?price+x.delta:null};
  });
  const stockIndex=text.indexOf("In winkelwagen");
  const afterCart=stockIndex>=0 ? text.slice(stockIndex,stockIndex+500) : text.slice(0,1000);
  const stockText=/Bijna uitverkocht/i.test(afterCart)?"Bijna uitverkocht":/Op voorraad/i.test(afterCart)?"Op voorraad":/In nabestelling/i.test(afterCart)?"In nabestelling":/Direct leverbaar/i.test(afterCart)?"Direct leverbaar":"Niet gevonden";
  const images=[];
  const og=mobicoMeta(html,"og:image"); if(og)images.push(og);
  const imgRe=/<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi; let im;
  while((im=imgRe.exec(String(html))) && images.length<8){try{const u=new URL(mobicoDecode(im[1]),sourceUrl).toString();if(/^https?:\/\//i.test(u))images.push(u);}catch{}}
  const variants=mobicoExtractVariants(html,sourceUrl,modelLabel);
  const colors=[...new Set(variants.map(v=>v.color).filter(Boolean))];
  const storages=[...new Set([...storageNames,...variants.map(v=>v.storage).filter(Boolean)])];
  const description=mobicoMeta(html,"description");
  return {name,color,storage,price,stockText,storages,storageOptions,colors,conditions,battery,images:[...new Set(images)].slice(0,6),variants,description,sourceUrl};
}

app.get("/api/mobico-test", requirePermission("phones.view"), async (req,res)=>{
  const modelKey=String(req.query.model||"iphone-13").trim().toLowerCase();
  const modelLabel=MOBICO_TEST_MODELS[modelKey];
  const sourceUrl=String(req.query.url||"").trim();
  if(!modelLabel)return res.status(400).json({success:false,readOnly:true,error:"Onbekend Mobico-testmodel."});
  if(!/^https?:\/\/mobico\.nl\/product\//i.test(sourceUrl))return res.status(400).json({success:false,readOnly:true,error:"Gebruik een geldige Mobico-productlink (https://mobico.nl/product/...)."});
  try{
    const page=await fetch(sourceUrl,{method:"GET",redirect:"follow",headers:{"User-Agent":"Mozilla/5.0 (compatible; HOMS-TECH Mobico read-only test)","Accept":"text/html,application/xhtml+xml"}});
    const html=await page.text();
    if(!page.ok)return res.status(502).json({success:false,readOnly:true,sourceUrl,error:`Mobico returned HTTP ${page.status}`});
    const result=mobicoParseProduct(html,sourceUrl,modelLabel);
    const detectedModel=(result.name.match(/^(iPhone(?: SE)?(?: Air)?(?: \d+)?(?: (?:Mini|Plus|Pro Max|Pro|e))?)/i)||[])[1]||"";
    if(detectedModel && mobicoSlug(detectedModel)!==mobicoSlug(modelLabel))return res.status(502).json({success:false,readOnly:true,error:`Mobico gaf ${result.name} terug terwijl ${modelLabel} was geselecteerd.`,result});
    res.json({success:true,readOnly:true,testModel:modelKey,testModelLabel:modelLabel,sourceUrl,result});
  }catch(error){
    console.error("MOBICO TEST IMPORT ERROR:",error);
    res.status(502).json({success:false,readOnly:true,sourceUrl,error:"Mobico test request failed.",details:String(error?.message||error)});
  }
});

app.get("/api/forza-test", requirePermission("phones.view"), async (req, res) => {
  const requestedModel = String(req.query.model || "iphone-11").trim().toLowerCase();
  const modelConfig = forzaGetTestModel(requestedModel);
  if (!modelConfig) {
    return res.status(400).json({
      success: false,
      readOnly: true,
      error: "Onbekend Forza-testmodel. Kies een model uit de Forza-lijst."
    });
  }
  const requestedVariant = String(req.query.variant || "").trim();
  const sourceUrl = modelConfig.sourceUrl;

  try {
    // Exact variant mode is used by the bulk importer. It does NOT re-read the
    // whole model page for every color/storage combination. The variant name is
    // still verified by the exact Forza product page before anything is staged.
    if (requestedVariant) {
      const storageMatch = requestedVariant.match(/\b(\d+)\s*(GB|TB)\b/i);
      const storage = storageMatch ? `${storageMatch[1]}${storageMatch[2].toUpperCase()}` : "";
      const color = requestedVariant
        .replace(/^.*?\b\d+\s*(?:GB|TB)\b/i, "")
        .trim();
      const variantSourceUrl = String(req.query.variantUrl || "").trim();
      const variantConfig = { model:modelConfig.label, productName:requestedVariant, storage, color, sourceUrl:variantSourceUrl };
      if (!storage || (modelConfig.storages.length && !modelConfig.storages.includes(storage))) {
        return res.status(400).json({success:false,readOnly:true,error:`Onbekende opslag in Forza-variant: ${requestedVariant}`});
      }
      const exactVariant = variantSourceUrl
        ? await forzaFetchExactVariantFromUrl(variantConfig.productName, variantSourceUrl)
        : await forzaFetchExactVariant(variantConfig.productName, "", sourceUrl);
      if (!exactVariant || !(exactVariant.images || []).length) {
        return res.status(502).json({
          success:false, readOnly:true, testModel:requestedModel, testModelLabel:modelConfig.label,
          variant:variantConfig, sourceUrl, error:"Exacte Forza-variant kon niet worden gelezen. Er is niets opgeslagen."
        });
      }
      const parsed = exactVariant.parsed || { product:{}, testModel:requestedModel, testModelLabel:modelConfig.label };
      const detectedName = String(parsed.product?.name || variantConfig.productName).trim();
      const detectedKey = forzaImageMatchKey(detectedName);
      const wantedModelKey = forzaImageMatchKey(modelConfig.label);
      if (!detectedKey.startsWith(wantedModelKey + " ") && detectedKey !== wantedModelKey) {
        return res.status(502).json({success:false,readOnly:true,error:`Forza gaf ${detectedName} terug in plaats van ${modelConfig.label}. Er is niets opgeslagen.`});
      }
      const product = {
        ...(parsed.product || {}),
        name: variantConfig.productName,
        storage: [variantConfig.storage],
        color: variantConfig.color || parsed.product?.color || "",
        images: exactVariant.images.slice(0,4),
        sourceUrl: exactVariant.url,
        canonical: parsed.product?.canonical || exactVariant.url
      };
      return res.json({
        success:true, readOnly:true, testModel:requestedModel, testModelLabel:modelConfig.label,
        sourceUrl, exactVariantSourceUrl:exactVariant.url,
        variant:variantConfig,
        result:{...parsed, product, testModel:requestedModel, testModelLabel:modelConfig.label, allowedStorages:modelConfig.storages}
      });
    }

    const mainPage = await forzaFetchOverviewBundle(sourceUrl, 5);

    if (!mainPage.response.ok) {
      return res.status(502).json({
        success: false,
        readOnly: true,
        sourceUrl,
        error: `Forza returned HTTP ${mainPage.response.status}`
      });
    }

    let result = forzaExtractTest(mainPage.html, sourceUrl);

    // IMPORTANT: after reading the model landing page, resolve the exact
    // color/storage product page so its images belong to ONE HOMS TECH
    // product. The webshop allows exactly four images per phone.
    const exactProductName = String(result?.product?.name || "").trim();
    const exactVariant = exactProductName
      ? await forzaFetchExactVariant(exactProductName, mainPage.html, sourceUrl)
      : null;
    if (exactVariant?.images?.length) {
      const overviewProduct = result.product || {};
      const exactProduct = exactVariant.parsed?.product || {};
      result.product = {
        ...overviewProduct,
        ...exactProduct,
        images: exactVariant.images.slice(0, 4),
        sourceUrl: exactVariant.url,
        canonical: exactProduct.canonical || exactVariant.url,
        overviewSourceUrl: sourceUrl
      };
      result.exactVariantSourceUrl = exactVariant.url;
    }

    // IMPORTANT: the model selector is authoritative. Some Forza landing pages
    // can return/redirect to a different product page. Never expose that wrong
    // product as the selected model. Prefer a whitelisted storage variant whose
    // detected product name matches the requested model.
    const requestedModelNumber = String(modelConfig.label || "")
      .match(/\biPhone\s+(\d+)\b/i)?.[1] || "";
    const resultModelNumber = String(result?.product?.name || "")
      .match(/\biPhone\s+(\d+)\b/i)?.[1] || "";

    const dynamicStorages = Array.isArray(result?.product?.storage)
      ? result.product.storage.map(v => String(v || "").replace(/\s+/g, "").toUpperCase()).filter(Boolean)
      : [];
    const discoveredVariantStorages = [...new Set(forzaExtractColorVariants(mainPage.html, sourceUrl, modelConfig).map(v => v.storage).filter(Boolean))];
    const allowedStorages = modelConfig.storages.length
      ? modelConfig.storages
      : (discoveredVariantStorages.length ? discoveredVariantStorages : (dynamicStorages.length ? dynamicStorages : ["64GB", "128GB", "256GB"]));
    const storageLinks = forzaExtractStorageLinks(
      mainPage.html,
      sourceUrl,
      modelConfig.fallbacks,
      allowedStorages,
      result?.product?.color || ""
    );
    const storageVariants = [];

    for (const variant of storageLinks) {
      try {
        const page = variant.url === sourceUrl
          ? mainPage
          : await forzaFetchPublicPage(variant.url);

        if (!page.response.ok) {
          storageVariants.push({
            storage: variant.storage,
            sourceUrl: variant.url,
            success: false,
            error: `Forza returned HTTP ${page.response.status}`
          });
          continue;
        }

        const variantResult = forzaExtractTest(page.html, variant.url);
        const detectedStorage = forzaSelectedStorage(variantResult) || variant.storage;

        // If the landing page returned the wrong iPhone generation, use the
        // first correctly matched variant as the authoritative product payload.
        if (requestedModelNumber &&
            (!resultModelNumber || resultModelNumber !== requestedModelNumber)) {
          const variantModelNumber = String(variantResult?.product?.name || "")
            .match(/\biPhone\s+(\d+)\b/i)?.[1] || "";
          if (variantModelNumber === requestedModelNumber) {
            result = variantResult;
          }
        }

        storageVariants.push({
          storage: detectedStorage,
          sourceUrl: variant.url,
          success: true,
          conditions: variantResult.product.conditions || [],
          battery: variantResult.product.battery || [],
          stock: variantResult.product.stock,
          productName: variantResult.product.name || result.product.name
        });
      } catch (variantError) {
        storageVariants.push({
          storage: variant.storage,
          sourceUrl: variant.url,
          success: false,
          error: String(variantError?.message || variantError)
        });
      }
    }

    const finalModelNumber = String(result?.product?.name || "")
      .match(/\biPhone\s+(\d+)\b/i)?.[1] || "";
    if (requestedModelNumber && finalModelNumber && finalModelNumber !== requestedModelNumber) {
      return res.status(502).json({
        success: false,
        readOnly: true,
        testModel: requestedModel,
        testModelLabel: modelConfig.label,
        sourceUrl,
        error: `Forza returned ${result?.product?.name || "een ander product"} terwijl ${modelConfig.label} was geselecteerd. Er is niets opgeslagen.`
      });
    }

    result.storageVariants = storageVariants;
    result.product.storageVariants = storageVariants;

    const colorVariants = forzaExtractColorVariants(mainPage.html, sourceUrl, modelConfig);
    result.colorVariants = colorVariants;
    result.product.colorVariants = colorVariants;

    result.testModel = requestedModel;
    result.testModelLabel = modelConfig.label;
    result.allowedStorages = allowedStorages.length
      ? allowedStorages
      : storageVariants.map(v => v.storage).filter(Boolean);
    return res.json({
      success: true,
      readOnly: true,
      testModel: requestedModel,
      testModelLabel: modelConfig.label,
      sourceUrl,
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
// PUBLIC FORZA STOCK CHECK (READ-ONLY)
// Used by the customer product page to show live availability.
// This endpoint NEVER writes to HOMS TECH and NEVER changes prices.
// =====================================================
function forzaNormalizePublicColor(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\bblack\b/g, "zwart")
    .replace(/\bwhite\b/g, "wit")
    .replace(/\bpurple\b/g, "paars")
    .replace(/\bred\b/g, "rood")
    .replace(/\bblue\b/g, "blauw")
    .replace(/\bgreen\b/g, "groen")
    .replace(/\s+/g, " ")
    .trim();
}

function forzaPublicVariantProductName(model, storage, color) {
  const cleanModel = String(model || "")
    .replace(/^apple\s+/i, "")
    .replace(/^samsung\s+/i, "")
    .trim();
  const cleanStorage = String(storage || "").replace(/\s+/g, "").trim();
  const cleanColor = String(color || "").trim();
  return `${cleanModel} ${cleanStorage} ${cleanColor}`.replace(/\s+/g, " ").trim();
}

async function forzaFetchExactStock(productName, overviewHtml = "", overviewUrl = "https://www.forza-refurbished.nl/") {
  const candidates = forzaExactUrlCandidates(productName, overviewHtml, overviewUrl);
  const wanted = forzaImageMatchKey(productName);

  for (const url of candidates) {
    try {
      const page = await forzaFetchPublicPage(url);
      if (!page.response.ok) continue;

      const parsed = forzaExtractTest(page.html, url);
      const got = forzaImageMatchKey(parsed?.product?.name || "");

      // Do not accept a different model/storage/color page as a match.
      if (wanted && got) {
        const wantedTokens = wanted.split(" ").filter(Boolean);
        const gotTokens = got.split(" ").filter(Boolean);
        const matches = wantedTokens.every(token => gotTokens.includes(token));
        if (!matches) continue;
      }

      const stockText = forzaStripHtml(page.html);
      const soldOut = /Tijdelijk niet op voorraad|Deze uitvoering is tijdelijk uitverkocht|Uitverkocht/i.test(stockText);
      const stockMatches = stockText.match(/Nog\s+(\d+)\s+op\s+voorraad/gi) || [];
      const stockNumbers = stockMatches
        .map(item => Number(item.match(/Nog\s+(\d+)\s+op\s+voorraad/i)?.[1]))
        .filter(Number.isFinite);

      const stock = stockNumbers.length ? Math.max(...stockNumbers) : (soldOut ? 0 : null);
      return {
        success: true,
        available: stock === null ? null : stock > 0,
        stock,
        productName: parsed?.product?.name || productName,
        sourceUrl: url,
        fetchedAt: new Date().toISOString()
      };
    } catch (error) {
      // Try the next exact URL candidate without exposing internal errors.
    }
  }

  return {
    success: false,
    available: null,
    stock: null,
    productName,
    fetchedAt: new Date().toISOString()
  };
}

app.get("/api/public/forza-stock", async (req, res) => {
  try {
    const model = String(req.query.model || "").trim();
    const storage = String(req.query.storage || "").trim();
    const color = String(req.query.color || "").trim();

    if (!model || !storage || !color) {
      return res.status(400).json({
        success: false,
        available: null,
        stock: null,
        error: "model, storage and color are required."
      });
    }

    const productName = forzaPublicVariantProductName(
      model,
      storage,
      forzaNormalizePublicColor(color)
    );

    const result = await forzaFetchExactStock(productName);
    return res.json({
      success: result.success,
      readOnly: true,
      available: result.available,
      stock: result.stock,
      model,
      storage,
      color,
      fetchedAt: result.fetchedAt
    });
  } catch (error) {
    console.error("PUBLIC FORZA STOCK ERROR:", error);
    return res.status(502).json({
      success: false,
      readOnly: true,
      available: null,
      stock: null
    });
  }
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

