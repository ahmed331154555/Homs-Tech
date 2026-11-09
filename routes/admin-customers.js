"use strict";

const { validateAdminCustomerInput } = require("../utils/customer-validation");

function registerAdminCustomerRoutes(app, { pool, requirePermission, hashPassword, sendWelcomeEmail }) {
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

// Admin customer management (protected by customer-management permission)
app.post("/api/admin/customers", requirePermission("customers.update"), async (req, res) => {
  try {
    const validation = validateAdminCustomerInput(req.body, { requirePassword: true });
    if (validation.error) return res.status(400).json({ error: validation.error });
    const { name, email, phone, address, password } = validation.customer;
    const passwordHash = await hashPassword(password);
    const result=await pool.query(
      `INSERT INTO customers (
        name, email, phone, address, password_hash, email_verified,
        email_verification_code_hash, email_verification_expires_at, email_verification_attempts
      ) VALUES ($1, $2, $3, $4, $5, TRUE, NULL, NULL, 0)
      RETURNING id, name, email, phone, address, created_at`,
      [name,email,phone,address,passwordHash]
    );
    if (typeof sendWelcomeEmail === "function") {
      Promise.resolve()
        .then(() => sendWelcomeEmail(result.rows[0]))
        .catch(error => console.error("Admin-created customer welcome email failed:", error.message));
    }
    res.status(201).json({success:true,customer:result.rows[0]});
  } catch(e) {
    if(e.code==="23505") return res.status(409).json({error:"Er bestaat al een account met dit e-mailadres."});
    console.error("Admin create customer error:",e);
    res.status(500).json({error:"Klant aanmaken is mislukt."});
  }
});

app.put("/api/admin/customers/:id", requirePermission("customers.update"), async (req,res)=>{
  try {
    const id=Number(req.params.id);
    const validation = validateAdminCustomerInput(req.body);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Ongeldig klantnummer." });
    if (validation.error) return res.status(400).json({ error: validation.error });
    const { name, email, phone, address } = validation.customer;
    const result=await pool.query(
      "UPDATE customers SET name=$1,email=$2,phone=$3,address=$4 WHERE id=$5 RETURNING id,name,email,phone,address,created_at",
      [name,email,phone,address,id]
    );
    if(!result.rows.length)return res.status(404).json({error:"Klant niet gevonden."});
    res.json({success:true,customer:result.rows[0]});
  } catch(e) {
    if(e.code==="23505") return res.status(409).json({error:"Dit e-mailadres is al in gebruik."});
    console.error("Admin update customer error:",e);
    res.status(500).json({error:"Klant wijzigen is mislukt."});
  }
});

app.put("/api/admin/customers/:id/password", requirePermission("customers.update"), async (req,res)=>{
  try {
    const id=Number(req.params.id);
    const password=String(req.body?.password||"");
    if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Ongeldig klantnummer."});
    if(password.length<8)return res.status(400).json({error:"Het wachtwoord moet minimaal 8 tekens bevatten."});
    if(password.length>256)return res.status(400).json({error:"Het wachtwoord is te lang."});
    const hash=await hashPassword(password);
    const result=await pool.query("UPDATE customers SET password_hash=$1 WHERE id=$2 RETURNING id",[hash,id]);
    if(!result.rows.length)return res.status(404).json({error:"Klant niet gevonden."});
    await pool.query("UPDATE customer_password_resets SET used_at=NOW() WHERE customer_id=$1 AND used_at IS NULL",[id]);
    res.json({success:true,message:"Wachtwoord is gewijzigd."});
  } catch(e) {
    console.error("Admin reset customer password error:",e);
    res.status(500).json({error:"Wachtwoord wijzigen is mislukt."});
  }
});

app.delete("/api/admin/customers/:id", requirePermission("customers.delete"), async (req,res)=>{
  try {
    const id=Number(req.params.id);
    if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Ongeldig klantnummer."});
    const result=await pool.query("DELETE FROM customers WHERE id=$1 RETURNING id",[id]);
    if(!result.rows.length)return res.status(404).json({error:"Klant niet gevonden."});
    res.json({success:true});
  } catch(e) {
    console.error("Admin delete customer error:",e);
    res.status(500).json({error:"Klant verwijderen is mislukt."});
  }
});
}

module.exports = { registerAdminCustomerRoutes };
