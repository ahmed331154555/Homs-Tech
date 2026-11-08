"use strict";

function registerCustomerAuthRoutes(app, { pool, crypto, jwt, hashPassword, verifyPassword, sendCustomerVerificationEmail, sendWelcomeEmail, escapeHtml, fetchImpl, getEnv }) {
// Customer self-registration: account remains inactive until email code is confirmed.
app.post("/api/customer/register", async (req, res) => {
  try {
    const { name, email, phone = "", address = "", password } = req.body || {};
    const cleanName = String(name || "").trim();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPhone = String(phone || "").trim();
    const cleanAddress = String(address || "").trim();
    if (!cleanName || !cleanEmail || !password) return res.status(400).json({ error: "Vul naam, e-mail en wachtwoord in." });
    if (cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return res.status(400).json({ error: "Vul een geldig e-mailadres in." });
    if (String(password).length < 8) return res.status(400).json({ error: "Het wachtwoord moet minimaal 8 tekens bevatten." });
    const existing = await pool.query("SELECT id, email_verified FROM customers WHERE email = $1", [cleanEmail]);
    if (existing.rows.length > 0) {
      if (!existing.rows[0].email_verified) return res.status(409).json({ error: "Voor dit e-mailadres is al een account aangemaakt maar nog niet bevestigd. Vraag een nieuwe code aan." });
      return res.status(409).json({ error: "Er bestaat al een account met dit e-mailadres." });
    }

    const passwordHash = await hashPassword(String(password));
    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const client = await pool.connect();
    let customer;
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO customers (name,email,phone,address,password_hash,email_verified,email_verification_code_hash,email_verification_expires_at,email_verification_attempts)
         VALUES ($1,$2,$3,$4,$5,FALSE,$6,NOW() + INTERVAL '15 minutes',0)
         RETURNING id,name,email,phone,address`,
        [cleanName, cleanEmail, cleanPhone, cleanAddress, passwordHash, codeHash]
      );
      customer = result.rows[0];
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    try {
      await sendCustomerVerificationEmail(customer, code);
    } catch (emailError) {
      console.error("Customer verification email failed:", emailError.message);
      await pool.query("DELETE FROM customers WHERE id = $1 AND email_verified = FALSE", [customer.id]);
      return res.status(503).json({ error: "De bevestigingsmail kon niet worden verstuurd. Controleer de e-mailinstellingen en probeer het opnieuw." });
    }

    res.status(201).json({ success: true, verificationRequired: true, email: customer.email, message: "We hebben een bevestigingscode naar je e-mailadres gestuurd." });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Er bestaat al een account met dit e-mailadres." });
    console.error("Customer registration error:", error);
    res.status(500).json({ error: "Account aanmaken mislukt." });
  }
});

// Confirm public signup with the emailed six-digit code.
app.post("/api/customer/verify-email", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const code = String(req.body?.code || "").trim();
    if (!email || !/^\d{6}$/.test(code)) return res.status(400).json({ error: "Vul je e-mailadres en de code van 6 cijfers in." });
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const result = await pool.query(
      `UPDATE customers
       SET email_verified = TRUE, email_verification_code_hash = NULL,
           email_verification_expires_at = NULL, email_verification_attempts = 0
       WHERE email = $1 AND email_verified = FALSE
         AND email_verification_code_hash = $2
         AND email_verification_expires_at > NOW()
         AND email_verification_attempts < 5
       RETURNING id,name,email,phone,address`,
      [email, codeHash]
    );
    if (!result.rows.length) {
      await pool.query(
        "UPDATE customers SET email_verification_attempts = email_verification_attempts + 1 WHERE email = $1 AND email_verified = FALSE AND email_verification_expires_at > NOW()",
        [email]
      ).catch(() => {});
      return res.status(400).json({ error: "De code is onjuist of verlopen. Vraag een nieuwe code aan." });
    }
    const customer = result.rows[0];
    sendWelcomeEmail(customer).catch(error => console.error("Verified customer welcome email failed:", error.message));
    const customerToken = jwt.sign({ customerId: customer.id, email: customer.email }, getEnv().JWT_SECRET, { expiresIn: "30d" });
    res.cookie("customerToken", customerToken, {
      httpOnly: true, secure: getEnv().NODE_ENV === "production",
      sameSite: "lax", maxAge: 30 * 24 * 60 * 60 * 1000
    });
    res.json({ success: true, customer, message: "Je e-mailadres is bevestigd en je account is nu actief." });
  } catch (error) {
    console.error("Customer email verification error:", error);
    res.status(500).json({ error: "E-mailadres bevestigen is mislukt. Probeer het opnieuw." });
  }
});

// Send a fresh code to an existing unverified signup.
app.post("/api/customer/resend-verification", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email || email.length > 254) return res.status(400).json({ error: "Vul een geldig e-mailadres in." });
    const result = await pool.query(
      "SELECT id,name,email,email_verified,email_verification_expires_at FROM customers WHERE email = $1",
      [email]
    );
    if (!result.rows.length || result.rows[0].email_verified) return res.json({ success: true, message: "Als er een onbevestigd account bestaat, wordt een nieuwe code verstuurd." });
    const customer = result.rows[0];
    if (customer.email_verification_expires_at && new Date(customer.email_verification_expires_at).getTime() > Date.now()) {
      return res.status(429).json({ error: "De huidige code is nog geldig. Controleer je e-mail of vraag een nieuwe code aan zodra deze is verlopen." });
    }
    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    await pool.query(
      "UPDATE customers SET email_verification_code_hash=$1,email_verification_expires_at=NOW()+INTERVAL '15 minutes',email_verification_attempts=0 WHERE id=$2 AND email_verified=FALSE",
      [codeHash, customer.id]
    );
    try {
      await sendCustomerVerificationEmail(customer, code);
    } catch (emailError) {
      console.error("Resend verification email failed:", emailError.message);
      return res.status(503).json({ error: "De nieuwe code kon niet worden verstuurd. Probeer het later opnieuw." });
    }
    res.json({ success: true, message: "We hebben een nieuwe code naar je e-mailadres gestuurd." });
  } catch (error) {
    console.error("Resend customer verification error:", error);
    res.status(500).json({ error: "Een nieuwe code aanvragen is mislukt." });
  }
});

// Request a password reset. Always return the same response to avoid exposing registered emails.
app.post("/api/customer/forgot-password", async (req, res) => {
  const genericMessage = "Als dit e-mailadres bij ons bekend is, ontvang je een e-mail met een link om je wachtwoord opnieuw in te stellen.";
  try {
    const email = String((req.body || {}).email || "").trim().toLowerCase();
    if (!email || email.length > 254) return res.status(200).json({ success: true, message: genericMessage });

    const result = await pool.query("SELECT id, name, email FROM customers WHERE email = $1", [email]);
    if (result.rows.length && getEnv().RESEND_API_KEY && getEnv().RESEND_FROM_EMAIL) {
      const customer = result.rows[0];
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      await pool.query("UPDATE customer_password_resets SET used_at = NOW() WHERE customer_id = $1 AND used_at IS NULL", [customer.id]);
      await pool.query(
        "INSERT INTO customer_password_resets (customer_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')",
        [customer.id, tokenHash]
      );
      const from = getEnv().RESEND_FROM_EMAIL;
      const resetUrl = "https://homs-tech.nl/account.html?reset=" + encodeURIComponent(rawToken);
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${getEnv().RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [customer.email],
          subject: "Wachtwoord opnieuw instellen - HOMS TECH",
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;color:#222;line-height:1.6">
              <h1 style="color:#0f2740">Wachtwoord opnieuw instellen</h1>
              <p>Hallo ${escapeHtml(customer.name)},</p>
              <p>Je hebt gevraagd om je HOMS TECH-wachtwoord opnieuw in te stellen.</p>
              <p><a href="${resetUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">Nieuw wachtwoord instellen</a></p>
              <p>Deze link is één uur geldig en kan maar één keer worden gebruikt. Heb je dit niet aangevraagd? Negeer deze e-mail dan.</p>
              <p style="margin-top:28px"><strong>Team HOMS TECH</strong></p>
              <p style="font-size:12px;color:#64748b">Website: <a href="https://homs-tech.nl">https://homs-tech.nl</a></p>
            </div>
          `
        })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        console.error("Password reset email failed:", response.status, JSON.stringify(data));
      }
    }
    return res.json({ success: true, message: genericMessage });
  } catch (error) {
    console.error("Forgot password error:", error.message);
    return res.status(200).json({ success: true, message: genericMessage });
  }
});

// Reset password using a single-use token that expires after one hour.
app.post("/api/customer/reset-password", async (req, res) => {
  try {
    const token = String((req.body || {}).token || "").trim();
    const password = String((req.body || {}).password || "");
    if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json({ error: "Deze resetlink is ongeldig of verlopen." });
    if (password.length < 8) return res.status(400).json({ error: "Het wachtwoord moet minimaal 8 tekens bevatten." });

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const result = await pool.query(
      "SELECT id, customer_id FROM customer_password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()",
      [tokenHash]
    );
    if (!result.rows.length) return res.status(400).json({ error: "Deze resetlink is ongeldig of verlopen." });

    const reset = result.rows[0];
    const passwordHash = await hashPassword(password);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        "SELECT id FROM customer_password_resets WHERE id = $1 AND used_at IS NULL AND expires_at > NOW() FOR UPDATE",
        [reset.id]
      );
      if (!locked.rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Deze resetlink is ongeldig of verlopen." });
      }
      await client.query("UPDATE customers SET password_hash = $1 WHERE id = $2", [passwordHash, reset.customer_id]);
      await client.query("UPDATE customer_password_resets SET used_at = NOW() WHERE customer_id = $1 AND used_at IS NULL", [reset.customer_id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    res.json({ success: true, message: "Je wachtwoord is gewijzigd. Je kunt nu inloggen." });
  } catch (error) {
    console.error("Reset password error:", error.message);
    res.status(500).json({ error: "Wachtwoord wijzigen is niet gelukt. Probeer het opnieuw." });
  }
});

// Customer login
app.post("/api/customer/login", async (req, res) => {
  try {
    const loginIp = String(req.ip || req.socket.remoteAddress || "").trim();
    if (!checkAuthLoginRateLimit("customer", loginIp)) {
      return res.status(429).json({ error: "Te veel inlogpogingen. Wacht 15 minuten en probeer het opnieuw." });
    }
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
      `SELECT id, name, email, phone, address, password_hash, email_verified
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

    if (!customer.email_verified) {
      return res.status(403).json({ error: "Bevestig eerst je e-mailadres met de code die we hebben gestuurd." });
    }

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
      getEnv().JWT_SECRET,
      {
        expiresIn: "30d"
      }
    );

    res.cookie("customerToken", customerToken, {
      httpOnly: true,
      secure: getEnv().NODE_ENV === "production",
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
      getEnv().JWT_SECRET
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
}

module.exports = { registerCustomerAuthRoutes };
