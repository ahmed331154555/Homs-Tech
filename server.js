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

function forzaExtractStorageLinks(html, baseUrl) {
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

  // These are only safe public-page fallbacks for the three variants of this
  // fixed iPhone 11 test. No arbitrary user URL is accepted.
  const fallbacks = {
    // Use the exact public Purple variant for all three storage sizes so the
    // test never mixes the generic/Black landing page with the Purple variants.
    "64GB": "https://www.forza-refurbished.nl/iphone-11-64-gb-paars",
    "128GB": "https://www.forza-refurbished.nl/iphone-11-128gb-paars",
    "256GB": "https://www.forza-refurbished.nl/iphone-11-256gb-purple"
  };

  for (const [storage, url] of Object.entries(fallbacks)) {
    // For this fixed read-only test, prefer the known exact Purple variant
    // over a generic link discovered in the landing-page HTML.
    found.set(storage, url);
  }

  return ["64GB", "128GB", "256GB"]
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

  // The HOMS TECH pricing model is base condition + storage delta + battery delta.
  // Validate that the current Forza data fits that model before writing anything.
  const bases = {};
  for (const condition of ["zo goed als nieuw","licht gebruikt","zichtbaar gebruikt"]) {
    bases[condition] = getPrice("64GB", condition, "standaard");
  }

  const batteryDelta = getPrice("64GB", "zo goed als nieuw", "nieuw") - bases["zo goed als nieuw"];
  if (Math.abs(batteryDelta - 30) > 0.01) {
    return res.status(400).json({
      success: false,
      error: `Forza batterijverschil is €${batteryDelta.toFixed(2)}; verwachte standaard +€30. Geen wijziging uitgevoerd.`
    });
  }

  const storageDeltas = {};
  for (const storage of ["64GB","128GB","256GB"]) {
    storageDeltas[storage] = getPrice(storage, "zo goed als nieuw", "standaard") - bases["zo goed als nieuw"];
  }

  for (const storage of ["64GB","128GB","256GB"]) {
    for (const condition of ["zo goed als nieuw","licht gebruikt","zichtbaar gebruikt"]) {
      const expectedStandard = bases[condition] + storageDeltas[storage];
      const actualStandard = getPrice(storage, condition, "standaard");
      const actualNew = getPrice(storage, condition, "nieuw");
      if (Math.abs(actualStandard - expectedStandard) > 0.01 ||
          Math.abs(actualNew - (expectedStandard + batteryDelta)) > 0.01) {
        return res.status(400).json({
          success: false,
          error: "De Forza-prijzen passen niet in het HOMS TECH prijsmodel. Geen wijziging uitgevoerd."
        });
      }
    }
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
      battery: phone.batteryOptions.map(o => ({label:o.label, priceDelta:o.priceDelta}))
    };

    for (const key of ["zo goed als nieuw","licht gebruikt","zichtbaar gebruikt"]) {
      findCondition(key).basePrice = bases[key];
    }
    findStorage("64GB").priceDelta = 0;
    findStorage("128GB").priceDelta = storageDeltas["128GB"];
    findStorage("256GB").priceDelta = storageDeltas["256GB"];
    findBattery("standaard").priceDelta = 0;
    findBattery("nieuw").priceDelta = batteryDelta;

    const after = {
      conditions: phone.conditionOptions.map(o => ({label:o.label, basePrice:o.basePrice})),
      storage: phone.storageOptions.map(o => ({label:o.label, priceDelta:o.priceDelta})),
      battery: phone.batteryOptions.map(o => ({label:o.label, priceDelta:o.priceDelta}))
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

app.get("/api/forza-test", requirePermission("phones.view"), async (req, res) => {
  const sourceUrl = "https://www.forza-refurbished.nl/refurbished-iphone/iphone-11";

  try {
    const mainPage = await forzaFetchPublicPage(sourceUrl);

    if (!mainPage.response.ok) {
      return res.status(502).json({
        success: false,
        readOnly: true,
        sourceUrl,
        error: `Forza returned HTTP ${mainPage.response.status}`
      });
    }

    const result = forzaExtractTest(mainPage.html, sourceUrl);
    const storageLinks = forzaExtractStorageLinks(mainPage.html, sourceUrl);
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

    result.storageVariants = storageVariants;
    result.product.storageVariants = storageVariants;

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

