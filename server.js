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

function forzaImageUrlVariantMismatch(url, wantedColor, wantedStorage) {
  try {
    const parsed = new URL(String(url || ""));
    // Only inspect the path/filename. Do NOT inspect the full CDN URL or query
    // string: CDNs can contain unrelated colour words in folders/parameters.
    const path = decodeURIComponent(parsed.pathname || "").toLowerCase();
    const normalized = path.replace(/[^a-z0-9]+/g, " ").trim();
    const tokens = normalized.split(/\s+/).filter(Boolean);
    const colors = ["zwart","wit","blauw","groen","paars","rood"];
    const otherColors = colors.filter(c => c !== wantedColor);
    const filename = (path.split("/").pop() || "").replace(/\.[a-z0-9]+$/i, "");
    const fileKey = filename.replace(/[^a-z0-9]+/g, " ").trim();
    const fileTokens = fileKey.split(/\s+/).filter(Boolean);

    // Strong evidence only: a complete colour token in the filename/path.
    if (otherColors.some(c => fileTokens.includes(c))) return true;
    if (otherColors.some(c => tokens.includes(c) && /iphone|galaxy|samsung|apple/.test(normalized))) return true;

    if (wantedStorage) {
      const storages = [...normalized.matchAll(/\b(\d+)\s*(gb|tb)\b/g)]
        .map(m => `${m[1]}${m[2]}`);
      if (storages.some(s => s !== wantedStorage)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function forzaIsLikelyImageUrl(value) {
  try {
    const u = new URL(String(value));
    if (!/^https?:$/i.test(u.protocol)) return false;
    const path = u.pathname.toLowerCase();
    const host = u.hostname.toLowerCase();
    if (/\.(?:jpe?g|png|webp|gif|avif|bmp|svg)$/i.test(path)) return true;
    if (/\/media\/|\/catalog\/product\/|\/product-images?\/|\/images?\//i.test(path)) return true;
    if (/(?:image|img|media|cdn|static)/i.test(host) && !/\/product(?:\/|$)/i.test(path)) return true;
    return false;
  } catch { return false; }
}

function forzaClientImageUrl(req, sourceUrl) {
  const raw = String(sourceUrl || '').trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return '';
  const encoded = encodeURIComponent(raw);
  return `${req.protocol}://${req.get('host')}/api/forza-image?url=${encoded}`;
}

function forzaClientImageUrls(req, images) {
  return [...new Set((Array.isArray(images) ? images : [])
    .filter(v => typeof v === 'string' && /^https?:\/\//i.test(v))
    .map(v => forzaClientImageUrl(req, v))
    .filter(Boolean))].slice(0, 4);
}

function forzaExtractStructuredGalleryImages(html, productName) {
  const wanted = forzaImageMatchKey(productName);
  if (!wanted) return [];
  const wantedTokens = wanted.split(" ").filter(Boolean);
  const wantedColor = wantedTokens[wantedTokens.length - 1] || "";
  const wantedStorage = (wanted.match(/\b\d+\s*(?:gb|tb)\b/) || [""])[0].replace(/\s+/g, "");
  const wantedModelTokens = wantedTokens.filter(t =>
    !/^\d+$/.test(t) && !/^(?:gb|tb)$/.test(t) && t !== wantedColor
  );

  const images = [];
  const seen = new Set();
  const addUrl = value => {
    if (!value) return;
    const values = String(value).match(/https?:\/\/[^\s,"'<>]+/gi) || [];
    for (const raw of values) {
      let url = raw.replace(/&amp;/gi, "&").replace(/[)\]}]+$/g, "");
      try {
        const parsed = new URL(url);
        parsed.searchParams.delete("width");
        parsed.searchParams.delete("w");
        parsed.searchParams.delete("quality");
        parsed.searchParams.delete("q");
        url = parsed.toString();
      } catch {}
      if (!/^https?:\/\//i.test(url)) continue;
      if (!forzaIsLikelyImageUrl(url)) continue;
      if (forzaImageUrlVariantMismatch(url, wantedColor, wantedStorage)) continue;
      if (!seen.has(url)) { seen.add(url); images.push(url); }
    }
  };

  const labelKeys = new Set([
    "alt","caption","title","label","name","description","text","aria-label",
    "data-alt","data-title","productname","product_name"
  ]);
  const urlKeys = new Set([
    "full","img","image","src","url","thumb","thumbnail","large","medium",
    "small","fullimage","imageurl","image_url","data-src","data-lazy-src"
  ]);

  const walk = (value, inheritedLabel = "", seenObjects = new Set()) => {
    if (value === null || value === undefined) return;
    if (typeof value !== "object") return;
    if (seenObjects.has(value)) return;
    seenObjects.add(value);

    let ownLabel = inheritedLabel;
    const urls = [];
    for (const [key, child] of Object.entries(value)) {
      const k = String(key || "").toLowerCase();
      if (labelKeys.has(k) && typeof child === "string") ownLabel += " " + child;
      if (urlKeys.has(k) && typeof child === "string") urls.push(child);
      if (urlKeys.has(k) && Array.isArray(child)) child.forEach(x => { if (typeof x === "string") urls.push(x); });
    }

    const labelKey = forzaImageMatchKey(ownLabel).replace(/\s+/g, "");
    const generic = /kleuren|colors|colour/.test(labelKey);
    const hasModel = wantedModelTokens.every(token => labelKey.includes(token));
    const hasColor = !!wantedColor && labelKey.includes(wantedColor);
    if (!generic && hasModel && hasColor) urls.forEach(addUrl);

    for (const child of Object.values(value)) {
      if (child && typeof child === "object") walk(child, ownLabel, seenObjects);
    }
  };

  // Magento/Forza commonly places the gallery in text/x-magento-init JSON.
  const scripts = String(html || "").match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const typeMatch = script.match(/type=["']([^"']+)["']/i);
    const body = script.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>\s*$/i, "").trim();
    if (!body || !/json|magento-init|gallery|fotorama/i.test((typeMatch?.[1] || "") + " " + body.slice(0, 2000))) continue;
    try {
      walk(JSON.parse(body));
    } catch {
      // Ignore non-JSON script blocks.
    }
    if (images.length >= 4) return [...new Set(images)].slice(0, 4);
  }

  return [...new Set(images)].slice(0, 4);
}

function forzaExtractVariantGalleryImages(html, productName) {
  const wanted = forzaImageMatchKey(productName);
  if (!wanted) return [];
  const wantedTokens = wanted.split(" ").filter(Boolean);
  const wantedColor = wantedTokens[wantedTokens.length - 1] || "";
  const wantedStorage = (wanted.match(/\b\d+\s*(?:gb|tb)\b/) || [""])[0].replace(/\s+/g, "");
  const wantedModelTokens = wantedTokens.filter(t =>
    !/^\d+$/.test(t) && !/^(?:gb|tb)$/.test(t) && t !== wantedColor
  );
  const compact = value => forzaImageMatchKey(value).replace(/\s+/g, "");

  // First read the actual structured gallery data. This avoids JSON-LD's
  // generic product image list, which can contain a photo from another colour.
  const structured = forzaExtractStructuredGalleryImages(html, productName);
  if (structured.length >= 4) return structured.slice(0, 4);

  const images = [...structured];
  const seen = new Set(images);
  const imgTags = String(html || "").match(/<img\b[^>]*>/gi) || [];

  const addUrl = value => {
    if (!value) return;
    const urls = String(value).match(/https?:\/\/[^\s,]+/gi) || [];
    for (const raw of urls) {
      let url = raw.replace(/&amp;/gi, "&").replace(/["')]+$/g, "");
      try {
        const parsed = new URL(url);
        parsed.searchParams.delete("width");
        parsed.searchParams.delete("w");
        parsed.searchParams.delete("quality");
        parsed.searchParams.delete("q");
        url = parsed.toString();
      } catch {}
      if (!/^https?:\/\//i.test(url)) continue;
      if (!forzaIsLikelyImageUrl(url)) continue;
      if (forzaImageUrlVariantMismatch(url, wantedColor, wantedStorage)) continue;
      if (!seen.has(url)) { seen.add(url); images.push(url); }
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
    if (/kleuren|colors|colour/.test(key)) continue;
    const hasModel = wantedModelTokens.every(token => key.includes(token));
    const hasColor = !!wantedColor && key.includes(wantedColor);
    if (!hasModel || !hasColor) continue;

    addUrl(attrs.src);
    addUrl(attrs["data-src"]);
    addUrl(attrs["data-lazy-src"]);
    addUrl(attrs.srcset);
    addUrl(attrs["data-srcset"]);
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
      if (!forzaIsLikelyImageUrl(imageUrl)) continue;
      if (forzaImageUrlVariantMismatch(imageUrl, wantedColor, wantedStorage)) continue;
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
        if (!forzaIsLikelyImageUrl(imageUrl)) continue;
        if (forzaImageUrlVariantMismatch(imageUrl, wantedColor, wantedStorage)) continue;
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
    /Geheugen\s+(?:64GB|128GB|256GB)\s+(?:64GB|128GB|256GB)?/i
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

// Current public Forza iPhone 12 catalogue snapshot:
// 12 combinations are currently in stock; 6 remain listed but are
// temporarily unavailable. 64/128/256 GB are the only capacities.
const FORZA_IPHONE12_CURRENT_VARIANTS = new Set([
  "iPhone 12 64GB Zwart", "iPhone 12 64GB Blauw", "iPhone 12 64GB Groen", "iPhone 12 64GB Paars",
  "iPhone 12 128GB Zwart", "iPhone 12 128GB Wit", "iPhone 12 128GB Blauw", "iPhone 12 128GB Groen", "iPhone 12 128GB Rood",
  "iPhone 12 256GB Zwart", "iPhone 12 256GB Wit", "iPhone 12 256GB Rood"
]);

const FORZA_IPHONE12_UNAVAILABLE_VARIANTS = new Set([
  "iPhone 12 64GB Wit", "iPhone 12 64GB Rood",
  "iPhone 12 128GB Paars",
  "iPhone 12 256GB Blauw", "iPhone 12 256GB Groen", "iPhone 12 256GB Paars"
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
        } catch { page = null; }
        await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
      }
      if (!page) continue;

      if (page.response.ok) {
        const parsed = forzaExtractTest(page.html, url);
        const wanted = forzaImageMatchKey(productName);
        const got = forzaImageMatchKey(parsed?.product?.name || '');
        const wantedModel = wanted.replace(/\b\d+\s*(?:gb|tb)\b/g, '').trim();
        const gotModel = got.replace(/\b\d+\s*(?:gb|tb)\b/g, '').trim();
        if (wantedModel && gotModel && !gotModel.includes(wantedModel) && !wantedModel.includes(gotModel)) continue;

        const images = forzaExtractVariantGalleryImages(page.html, productName);
        if (images.length >= 1) {
          return { url, parsed, images: images.slice(0, 4) };
        }

        // If the exact HTML does not expose the gallery, use Jina on THIS exact
        // product URL only. Never use the model overview gallery here.
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
      if (jinaImages.length >= 1) return { url, parsed: null, images: jinaImages.slice(0, 4) };
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
  "iphone-11": {
    label: "iPhone 11",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-11",
    storages: ["64GB", "128GB", "256GB"],
    fallbacks: {
      "64GB": "https://www.forza-refurbished.nl/iphone-11-64-gb-paars",
      "128GB": "https://www.forza-refurbished.nl/iphone-11-128gb-paars",
      "256GB": "https://www.forza-refurbished.nl/iphone-11-256gb-purple"
    }
  },
  "iphone-12": {
    label: "iPhone 12",
    sourceUrl: "https://www.forza-refurbished.nl/refurbished-iphone/iphone-12",
    storages: ["64GB", "128GB", "256GB"],
    fallbacks: {
      "64GB": "https://www.forza-refurbished.nl/iphone-12",
      "128GB": "https://www.forza-refurbished.nl/iphone-12-128gb-zwart",
      "256GB": "https://www.forza-refurbished.nl/iphone-12-256gb-zwart"
    }
  }
};

function forzaGetTestModel(modelKey) {
  return FORZA_TEST_MODELS[String(modelKey || "").trim().toLowerCase()] || null;
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
    .replace(/\b(64|128|256)\s*GB\b/ig, "$1GB")
    .replace(/\s+/g, " ")
    .trim();
}

function forzaFindIphone12Variant(value) {
  const wanted = forzaNormalizeVariantName(value).toLowerCase();
  return FORZA_IPHONE12_VARIANTS.find(v => forzaNormalizeVariantName(v.productName).toLowerCase() === wanted) || null;
}

function forzaExtractStorageLinks(html, baseUrl, fallbackMap = {}, allowedStorages = ["64GB", "128GB", "256GB"]) {
  const found = new Map();
  const source = String(html || "");
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]{0,500}?((?:64|128|256)\s*GB)[\s\S]{0,500}?<\/a>/gi;
  let match;

  while ((match = anchorPattern.exec(source))) {
    const href = match[1];
    const storage = forzaCleanText(match[2]).replace(/\s+/g, "");
    try {
      const absolute = new URL(href, baseUrl).toString();
      if (!found.has(storage)) found.set(storage, absolute);
    } catch {
      // Ignore malformed links.
    }
  }

  // Only use explicit public-page fallbacks from the whitelisted model config.
  for (const [storage, url] of Object.entries(fallbackMap || {})) {
    // For this fixed read-only test, prefer the known exact Purple variant
    // over a generic link discovered in the landing-page HTML.
    found.set(storage, url);
  }

  return allowedStorages
    .filter(storage => found.has(storage))
    .map(storage => ({ storage, url: found.get(storage) }));
}

function forzaSelectedStorage(result) {
  const title = String(result?.product?.name || "");
  const match = title.match(/\b(64|128|256)\s*GB\b/i);
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

  if (!productName || rows.length !== 18) {
    return res.status(400).json({
      success: false,
      error: "Forza-update vereist precies 18 geldige previewregels."
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

  const expected = [];
  for (const storage of ["64GB","128GB","256GB"]) {
    for (const condition of ["zo goed als nieuw","licht gebruikt","zichtbaar gebruikt"]) {
      for (const battery of ["standaard","nieuw"]) {
        expected.push(`${storage}|${condition}|${battery}`);
      }
    }
  }
  const actual = cleanRows.map(r => `${r.storage}|${r.condition}|${r.battery}`);
  if (new Set(actual).size !== 18 || expected.some(k => !actual.includes(k))) {
    return res.status(400).json({
      success: false,
      error: "De preview mist één of meerdere storage/conditie/batterij-combinaties."
    });
  }

  const getPrice = (storage, condition, battery) => {
    const r = cleanRows.find(x => x.storage === storage && x.condition === condition && x.battery === battery);
    return r ? r.price : null;
  };

  // Store the exact Forza matrix instead of forcing every storage/condition
  // combination into the older single storage-delta pricing model.
  // Example: 128GB / Licht gebruikt can legitimately have a different
  // storage difference than 128GB / Zo goed als nieuw.
  const forzaPriceMatrix = {};
  for (const r of cleanRows) {
    forzaPriceMatrix[`${r.storage}|${r.condition}|${r.battery}`] = r.price;
  }

  const bases = {};
  for (const condition of ["zo goed als nieuw","licht gebruikt","zichtbaar gebruikt"]) {
    bases[condition] = getPrice("64GB", condition, "standaard");
  }

  const batteryDelta = getPrice("64GB", "zo goed als nieuw", "nieuw") - bases["zo goed als nieuw"];
  const storageDeltas = {};
  for (const storage of ["64GB","128GB","256GB"]) {
    storageDeltas[storage] = getPrice(storage, "zo goed als nieuw", "standaard") - bases["zo goed als nieuw"];
  }

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

    const wantedModel = modelKey(productName);
    let bestIndex = -1;
    let bestScore = -1;

    data.phones.forEach((phone, index) => {
      if (!phone || typeof phone !== "object") return;
      const pk = modelKey(phone.name || "");
      if (!pk || !wantedModel) return;
      let score = 0;
      if (pk === wantedModel) score = 100;
      else if (pk.includes(wantedModel) || wantedModel.includes(pk)) score = 60;
      if (norm(phone.brand) === "apple") score += 10;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    if (bestIndex < 0 || bestScore < 60) {
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

    for (const key of ["zo goed als nieuw","licht gebruikt","zichtbaar gebruikt"]) {
      findCondition(key).basePrice = bases[key];
    }
    findStorage("64GB").priceDelta = 0;
    findStorage("128GB").priceDelta = storageDeltas["128GB"];
    findStorage("256GB").priceDelta = storageDeltas["256GB"];
    findBattery("standaard").priceDelta = 0;
    findBattery("nieuw").priceDelta = batteryDelta;

    // Keep the legacy fields updated from the 64GB base for backwards
    // compatibility, while the exact matrix is what the webshop uses.
    phone.forzaPriceMatrix = forzaPriceMatrix;
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

  if (!productName || !targetPhoneName || rows.length !== 18) {
    return res.status(400).json({success:false,error:"Full Sync vereist het geselecteerde HOMS TECH-product en precies 18 prijsregels."});
  }

  const cleanRows = rows.map(r => ({
    storage: storageKey(r.storage),
    condition: conditionKey(r.condition),
    battery: batteryKey(r.battery),
    price: money(r.price)
  }));
  const expected = [];
  for (const storage of ["64GB","128GB","256GB"])
    for (const condition of ["zo goed als nieuw","licht gebruikt","zichtbaar gebruikt"])
      for (const battery of ["standaard","nieuw"])
        expected.push(`${storage}|${condition}|${battery}`);
  const actual = cleanRows.map(r => `${r.storage}|${r.condition}|${r.battery}`);
  if (cleanRows.some(r => !["64GB","128GB","256GB"].includes(r.storage) ||
      !["zo goed als nieuw","licht gebruikt","zichtbaar gebruikt"].includes(r.condition) ||
      !["standaard","nieuw"].includes(r.battery) || r.price === null || r.price < 0) ||
      new Set(actual).size !== 18 || expected.some(k => !actual.includes(k))) {
    return res.status(400).json({success:false,error:"De Forza Full Sync bevat geen complete geldige 18-prijscombinaties."});
  }

  const forzaPriceMatrix = {};
  for (const r of cleanRows) forzaPriceMatrix[`${r.storage}|${r.condition}|${r.battery}`] = r.price;
  const bases = {};
  for (const c of ["zo goed als nieuw","licht gebruikt","zichtbaar gebruikt"])
    bases[c] = cleanRows.find(r => r.storage === "64GB" && r.condition === c && r.battery === "standaard").price;
  const batteryDelta = cleanRows.find(r => r.storage === "64GB" && r.condition === "zo goed als nieuw" && r.battery === "nieuw").price - bases["zo goed als nieuw"];
  const storageDeltas = {};
  for (const st of ["64GB","128GB","256GB"])
    storageDeltas[st] = cleanRows.find(r => r.storage === st && r.condition === "zo goed als nieuw" && r.battery === "standaard").price - bases["zo goed als nieuw"];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT data FROM site_settings WHERE id = 1 FOR UPDATE");
    if (!result.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({success:false,error:"Websitegegevens niet gevonden."}); }
    const data = result.rows[0].data || {};
    if (!Array.isArray(data.phones)) { await client.query("ROLLBACK"); return res.status(400).json({success:false,error:"Telefooncatalogus ontbreekt."}); }

    const wantedExact = norm(targetPhoneName);
    const wantedModel = modelKey(targetPhoneName);
    let bestIndex = data.phones.findIndex(phone => norm(phone?.name) === wantedExact);
    if (bestIndex < 0) {
      let bestScore = -1;
      data.phones.forEach((phone,index) => {
        const pk = modelKey(phone?.name || "");
        if (!pk || !wantedModel) return;
        let score = 0;
        if (pk === wantedModel) score = 100;
        else if (pk.includes(wantedModel) || wantedModel.includes(pk)) score = 60;
        if (norm(phone?.brand) === norm(product?.brand || "apple")) score += 10;
        if (score > bestScore) { bestScore = score; bestIndex = index; }
      });
    }
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

    for (const key of ["zo goed als nieuw","licht gebruikt","zichtbaar gebruikt"]) findCondition(key).basePrice = bases[key];
    findStorage("64GB").priceDelta = 0;
    findStorage("128GB").priceDelta = storageDeltas["128GB"];
    findStorage("256GB").priceDelta = storageDeltas["256GB"];
    findBattery("standaard").priceDelta = 0;
    findBattery("nieuw").priceDelta = batteryDelta;
    phone.forzaPriceMatrix = forzaPriceMatrix;
    phone.forzaPriceMatrixSource = "Forza public website";
    phone.forzaPriceMatrixUpdatedAt = new Date().toISOString();

    const images = Array.isArray(product.images) ? [...new Set(product.images.filter(x => typeof x === "string" && /^https?:\/\//i.test(x)))].slice(0,4) : [];
    const specs = Array.isArray(product.specs) ? product.specs.slice(0,20) : [];
    if (product.brand) phone.brand = String(product.brand);
    if (product.sku) phone.sku = String(product.sku);
    if (product.color) phone.color = String(product.color);
    if (product.description) phone.description = String(product.description);
    if (Number.isFinite(Number(product.stock))) phone.stock = Number(product.stock);
    if (specs.length) phone.specifications = specs;
    if (images.length) { phone.images = images.slice(0,4); phone.forzaImages = images; }
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
      images,
      sourceUrl: product.sourceUrl || product.canonical || "",
      syncedAt: new Date().toISOString()
    };

    await client.query("UPDATE site_settings SET data = $1 WHERE id = 1", [JSON.stringify(data)]);
    await client.query("COMMIT");
    res.json({success:true,readOnly:false,updatedProduct:phone.name,sourceProduct:productName,message:"Forza Full Sync voltooid: prijzen, productgegevens en afbeeldingen zijn bijgewerkt."});
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Forza full sync error:", error);
    res.status(500).json({success:false,error:"Forza Full Sync mislukt. Geen wijziging is bevestigd."});
  } finally { client.release(); }
});

app.get("/api/forza-image", async (req, res) => {
  const raw = String(req.query.url || "").trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return res.status(400).end();
  let target;
  try { target = new URL(raw); } catch { return res.status(400).end(); }
  const host = target.hostname.toLowerCase();
  if (!(host === "forza-refurbished.nl" || host.endsWith(".forza-refurbished.nl"))) {
    return res.status(403).end();
  }
  if (!forzaIsLikelyImageUrl(target.toString())) return res.status(400).end();
  try {
    const upstream = await fetch(target.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; HOMS-TECH Forza image proxy)",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Referer": "https://www.forza-refurbished.nl/"
      }
    });
    if (!upstream.ok) return res.status(upstream.status).end();
    const finalUrl = String(upstream.url || "");
    let finalHost = "";
    try { finalHost = new URL(finalUrl).hostname.toLowerCase(); } catch {}
    if (!(finalHost === "forza-refurbished.nl" || finalHost.endsWith(".forza-refurbished.nl"))) return res.status(403).end();
    const contentType = String(upstream.headers.get("content-type") || "");
    if (!/^image\//i.test(contentType)) return res.status(415).end();
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.set("Content-Type", contentType.split(";")[0]);
    res.set("Cache-Control", "public, max-age=86400, s-maxage=86400");
    res.set("X-Content-Type-Options", "nosniff");
    res.send(buffer);
  } catch (error) {
    console.error("Forza image proxy error:", error?.message || error);
    res.status(502).end();
  }
});

app.get("/api/forza-test", requirePermission("phones.view"), async (req, res) => {
  const requestedModel = String(req.query.model || "iphone-11").trim().toLowerCase();
  const modelConfig = forzaGetTestModel(requestedModel);
  if (!modelConfig) {
    return res.status(400).json({
      success: false,
      readOnly: true,
      error: "Onbekend Forza-testmodel. Kies iPhone 11 of iPhone 12."
    });
  }
  const requestedVariant = String(req.query.variant || "").trim();
  const variantConfig = requestedModel === "iphone-12" && requestedVariant
    ? forzaFindIphone12Variant(requestedVariant)
    : null;
  if (requestedModel === "iphone-12" && requestedVariant && !variantConfig) {
    return res.status(400).json({
      success: false, readOnly: true,
      error: "Onbekende iPhone 12 variant. Kies een variant uit de Forza-lijst."
    });
  }

  const sourceUrl = modelConfig.sourceUrl;

  try {
    const mainPage = await forzaFetchPublicPage(sourceUrl);

    if (variantConfig) {
      const exactVariant = await forzaFetchExactVariant(variantConfig.productName, mainPage.html, sourceUrl);
      if (!exactVariant || !(exactVariant.images || []).length) {
        return res.status(502).json({
          success:false, readOnly:true, testModel:requestedModel, testModelLabel:modelConfig.label,
          variant:variantConfig, sourceUrl, error:"Exacte Forza-variant kon niet worden gelezen. Er is niets opgeslagen."
        });
      }
      const parsed = exactVariant.parsed || { product:{}, testModel:requestedModel, testModelLabel:modelConfig.label };
      const product = {
        ...(parsed.product || {}),
        name: variantConfig.productName,
        storage: [variantConfig.storage],
        color: variantConfig.color,
        images: forzaClientImageUrls(req, exactVariant.images),
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
        images: forzaClientImageUrls(req, exactVariant.images),
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

    const storageLinks = forzaExtractStorageLinks(
      mainPage.html,
      sourceUrl,
      modelConfig.fallbacks,
      modelConfig.storages
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

    result.testModel = requestedModel;
    result.testModelLabel = modelConfig.label;
    result.allowedStorages = modelConfig.storages;
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

