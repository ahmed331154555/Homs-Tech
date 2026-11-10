"use strict";

const { sendPaidWebshopOrderNotifications } = require("../utils/webshop-paid-notifications");

function registerPaymentRoutes(app, { pool, crypto, requirePermission, getMollieApiKey, mollieRequest, getPayPalSettings, getPayPalAccessToken, cancelPaypalOrder, resolveMolliePaymentStatus, molliePaymentMatchesOrder, encryptPayPalSecret, getPayPalBaseUrl, deductPaidOrderInventory, fetchImpl, getEnv, escapeHtml }) {
  async function notifyPaidTradeInOrder(orderId) {
    try {
      await sendPaidWebshopOrderNotifications({ pool, orderId, fetchImpl, getEnv, escapeHtml });
    } catch (error) {
      // Payment is already confirmed. Email failures must not reverse or hide the paid order.
      console.error("Paid trade-in notification processing failed:", orderId, error.message || error);
    }
  }

// ---------------- MOLLIE PAYMENTS ----------------
app.get("/api/mollie/config", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try { res.json({ enabled: !!(await getMollieApiKey()), provider: "Mollie" }); }
  catch (error) { res.json({ enabled: false, provider: "Mollie" }); }
});

app.post("/api/mollie/create-payment", async (req, res) => {
  try {
    const localOrderId = Number(req.body && req.body.orderId);
    const checkoutToken = String(req.body && req.body.checkoutToken || "").trim();
    if (!Number.isInteger(localOrderId) || localOrderId < 1 || !/^[a-f0-9]{64}$/.test(checkoutToken)) {
      return res.status(400).json({ error: "Ongeldige checkoutgegevens." });
    }
    const checkoutTokenHash = crypto.createHash("sha256").update(checkoutToken).digest("hex");
    const local = await pool.query(
      "SELECT id, name, email, total, payment_status, payment_method, mollie_payment_id FROM webshop_orders WHERE id=$1 AND checkout_token=$2",
      [localOrderId, checkoutTokenHash]
    );
    if (!local.rows.length) return res.status(404).json({ error: "Webshop bestelling niet gevonden." });
    const order = local.rows[0];
    if (order.payment_method !== "Mollie") return res.status(409).json({ error: "Deze bestelling is niet aangemaakt met Mollie als betaalmethode." });
    if (order.payment_status === "Paid") {
      const inventoryResult = await deductPaidOrderInventory(localOrderId);
      if (inventoryResult?.error) {
        return res.status(409).json({ error: "Deze bestelling is betaald, maar de voorraad wacht op handmatige controle." });
      }
      return res.status(409).json({ error: "Deze bestelling is al betaald." });
    }
    if (order.mollie_payment_id) {
      try {
        const existing = await mollieRequest("/payments/" + encodeURIComponent(order.mollie_payment_id));
        if (molliePaymentMatchesOrder(existing, order) && String(existing.status || "").toLowerCase() === "paid") {
          await pool.query("UPDATE webshop_orders SET payment_status='Paid', payment_method='Mollie' WHERE id=$1 AND mollie_payment_id=$2", [localOrderId, order.mollie_payment_id]);
          const inventoryResult = await deductPaidOrderInventory(localOrderId);
          if (inventoryResult?.error) {
            return res.status(409).json({ error: "De betaling is bevestigd, maar de voorraad kon niet worden bijgewerkt. HOMS TECH controleert dit handmatig." });
          }
          await notifyPaidTradeInOrder(localOrderId);
          return res.status(409).json({ error: "Deze bestelling is al betaald." });
        }
        if (molliePaymentMatchesOrder(existing, order) &&
            !["paid", "canceled", "expired", "failed"].includes(String(existing.status || "").toLowerCase()) &&
            existing._links && existing._links.checkout && existing._links.checkout.href) {
          return res.json({ success: true, checkoutUrl: existing._links.checkout.href, paymentId: existing.id });
        }
      } catch (error) { if (error.statusCode !== 404) throw error; }
    }
    const total = Number(order.total);
    if (!Number.isFinite(total) || total <= 0) return res.status(400).json({ error: "Het orderbedrag is ongeldig." });
    const baseUrl = String(getEnv().PUBLIC_BASE_URL || "https://homs-tech.nl").trim().replace(/\/+$/, "");
    // Keep concurrent retries for the same checkout attempt idempotent.
    // A new attempt gets a new key after the previous Mollie payment reaches a terminal state.
    const previousPaymentRef = String(order.mollie_payment_id || "initial").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "initial";
    const mollieIdempotencyKey = `homs-tech-order-${localOrderId}-${previousPaymentRef}`;
    const payment = await mollieRequest("/payments", {
      method: "POST",
      headers: { "Idempotency-Key": mollieIdempotencyKey },
      body: JSON.stringify({
        amount: { currency: "EUR", value: total.toFixed(2) },
        description: "HOMS TECH bestelling #" + localOrderId,
        redirectUrl: baseUrl + "/checkout.html?mollie=return&orderId=" + localOrderId,
        cancelUrl: baseUrl + "/checkout.html?mollie=cancel&orderId=" + localOrderId,
        webhookUrl: baseUrl + "/api/mollie/webhook",
        metadata: { orderId: String(localOrderId) }
      })
    });
    if (!payment.id || !payment._links || !payment._links.checkout || !payment._links.checkout.href ||
        !molliePaymentMatchesOrder(payment, order)) {
      console.error("Mollie response did not match order", { orderId: localOrderId, paymentId: payment.id || null });
      return res.status(502).json({ error: "Mollie gaf geen geldige betaalpagina terug." });
    }
    await pool.query("UPDATE webshop_orders SET mollie_payment_id=$1, payment_method='Mollie', payment_status='Pending' WHERE id=$2 AND checkout_token=$3 AND payment_status <> 'Paid'", [String(payment.id), localOrderId, checkoutTokenHash]);
    res.json({ success: true, checkoutUrl: payment._links.checkout.href, paymentId: payment.id });
  } catch (error) {
    console.error("Mollie create payment error:", error.statusCode || error.message);
    const status = error.statusCode === 401 || error.statusCode === 403 ? 503 : 500;
    res.status(status).json({ error: error.message || "Mollie betaling kon niet worden gestart." });
  }
});

app.post("/api/mollie/webhook", async (req, res) => {
  try {
    const paymentId = String(req.body && req.body.id || "").trim();
    if (!/^tr_[A-Za-z0-9]+$/.test(paymentId)) return res.sendStatus(400);
    const payment = await mollieRequest("/payments/" + encodeURIComponent(paymentId));
    const orderId = Number(payment && payment.metadata && payment.metadata.orderId);
    if (!Number.isInteger(orderId) || orderId < 1) return res.sendStatus(200);
    const found = await pool.query("SELECT id, total, mollie_payment_id, payment_status FROM webshop_orders WHERE id=$1", [orderId]);
    if (!found.rows.length) return res.sendStatus(200);
    const order = found.rows[0];
    if (String(order.mollie_payment_id || "") !== paymentId || !molliePaymentMatchesOrder(payment, order)) {
      console.error("Mollie webhook order mismatch", { orderId, paymentId });
      return res.sendStatus(200);
    }
    const localStatus = resolveMolliePaymentStatus(order.payment_status, payment.status);
    await pool.query("UPDATE webshop_orders SET payment_status=CASE WHEN payment_status IN ('Paid','Cancelled','Expired','Failed') AND $1 <> 'Paid' THEN payment_status ELSE $1 END, payment_method='Mollie' WHERE id=$2 AND mollie_payment_id=$3", [localStatus, orderId, paymentId]);
    if (localStatus === 'Paid') {
      const inventoryResult = await deductPaidOrderInventory(orderId);
      if (inventoryResult?.error) {
        console.error("Mollie webhook inventory processing failed; provider retry requested:", { orderId, paymentId });
        return res.sendStatus(500);
      }
      await notifyPaidTradeInOrder(orderId);
    }
    res.sendStatus(200);
  } catch (error) {
    console.error("Mollie webhook error:", error.statusCode || error.message);
    res.sendStatus(500);
  }
});

app.post("/api/mollie/verify-payment", async (req, res) => {
  try {
    const localOrderId = Number(req.body && req.body.orderId);
    const checkoutToken = String(req.body && req.body.checkoutToken || "").trim();
    if (!Number.isInteger(localOrderId) || localOrderId < 1 || !/^[a-f0-9]{64}$/.test(checkoutToken)) return res.status(400).json({ error: "Ongeldige checkoutgegevens." });
    const checkoutTokenHash = crypto.createHash("sha256").update(checkoutToken).digest("hex");
    const local = await pool.query("SELECT id, total, payment_status, payment_method, mollie_payment_id FROM webshop_orders WHERE id=$1 AND checkout_token=$2", [localOrderId, checkoutTokenHash]);
    if (!local.rows.length) return res.status(404).json({ error: "Webshop bestelling niet gevonden." });
    const order = local.rows[0];
    if (order.payment_status === "Paid") {
      const inventoryResult = await deductPaidOrderInventory(localOrderId);
      if (inventoryResult?.error) {
        return res.status(409).json({ error: "De betaling is bevestigd, maar de voorraad wacht op handmatige controle.", paid: true, orderId: localOrderId });
      }
      await notifyPaidTradeInOrder(localOrderId);
      return res.json({ success: true, paid: true, status: "Paid", orderId: localOrderId });
    }
    if (!order.mollie_payment_id || order.payment_method !== "Mollie") return res.status(409).json({ error: "Er is geen Mollie-betaling gekoppeld aan deze bestelling." });
    const payment = await mollieRequest("/payments/" + encodeURIComponent(order.mollie_payment_id));
    if (!molliePaymentMatchesOrder(payment, order) || payment.id !== order.mollie_payment_id) return res.status(409).json({ error: "De betaling komt niet overeen met deze bestelling." });
    const status = resolveMolliePaymentStatus(order.payment_status, payment.status);
    await pool.query("UPDATE webshop_orders SET payment_status=CASE WHEN payment_status IN ('Paid','Cancelled','Expired','Failed') AND $1 <> 'Paid' THEN payment_status ELSE $1 END WHERE id=$2 AND mollie_payment_id=$3", [status, localOrderId, order.mollie_payment_id]);
    if (status === 'Paid') {
      const inventoryResult = await deductPaidOrderInventory(localOrderId);
      if (inventoryResult?.error) {
        return res.status(409).json({ error: "De betaling is bevestigd, maar de voorraad kon niet worden bijgewerkt. HOMS TECH controleert dit handmatig.", paid: true, orderId: localOrderId });
      }
      await notifyPaidTradeInOrder(localOrderId);
    }
    const paid = String(payment.status || "").toLowerCase() === "paid";
    res.json({ success: true, paid, status, orderId: localOrderId });
  } catch (error) {
    console.error("Mollie verify payment error:", error.statusCode || error.message);
    res.status(500).json({ error: "De betaalstatus kon niet worden gecontroleerd. Probeer het opnieuw." });
  }
});

// Public checkout receives only the public client ID and never receives the secret.
app.get("/api/paypal/config", async (req, res) => {
  try {
    const settings = await getPayPalSettings();
    if (!settings.enabled || !settings.clientId || !settings.clientSecret) {
      return res.status(503).json({ enabled: false, error: "PayPal is nog niet geconfigureerd of uitgeschakeld." });
    }
    res.json({ enabled: true, clientId: settings.clientId, mode: settings.mode });
  } catch (error) {
    console.error("PayPal config error:", error.message);
    res.status(503).json({ enabled: false, error: "PayPal is momenteel niet beschikbaar." });
  }
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
      `SELECT id, name, email, total, payment_status, payment_method
       FROM webshop_orders
       WHERE id = $1 AND checkout_token = $2`,
      [localOrderId, checkoutTokenHash]
    );

    if (!local.rows.length) {
      return res.status(404).json({ error: "Webshop bestelling niet gevonden." });
    }

    const order = local.rows[0];
    if (order.payment_method !== "PayPal") return res.status(409).json({ error: "Deze bestelling is niet aangemaakt met PayPal als betaalmethode." });
    if (order.payment_status === "Paid") {
      return res.status(409).json({ error: "Deze bestelling is al betaald." });
    }

    const total = Number(order.total);
    if (!Number.isFinite(total) || total <= 0) {
      return res.status(400).json({ error: "Het orderbedrag is ongeldig." });
    }

    const paypalSettings = await getPayPalSettings();
    if (!paypalSettings.enabled) return res.status(503).json({ error: "PayPal is momenteel uitgeschakeld." });
    const accessToken = await getPayPalAccessToken(paypalSettings);

    const response = await fetchImpl(`${getPayPalBaseUrl(paypalSettings.mode)}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": `homs-tech-create-${localOrderId}`
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
      [String(data.id), localOrderId, checkoutTokenHash]
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
      `SELECT id, total, paypal_order_id, payment_status, payment_method
       FROM webshop_orders
       WHERE id = $1 AND checkout_token = $2`,
      [localOrderId, checkoutTokenHash]
    );

    if (!local.rows.length) {
      return res.status(404).json({ error: "Webshop bestelling niet gevonden." });
    }

    const order = local.rows[0];

    if (order.payment_method !== "PayPal") return res.status(409).json({ error: "Deze bestelling is niet aangemaakt met PayPal als betaalmethode." });
    if (String(order.paypal_order_id || "") !== paypalOrderId) {
      return res.status(400).json({ error: "PayPal order komt niet overeen met de webshop bestelling." });
    }

    if (order.payment_status === "Paid") {
      const inventoryResult = await deductPaidOrderInventory(localOrderId);
      if (inventoryResult?.error) {
        return res.status(409).json({ error: "PayPal heeft de betaling bevestigd, maar de voorraad wacht op handmatige controle.", paid: true, orderId: localOrderId });
      }
      await notifyPaidTradeInOrder(localOrderId);
      return res.json({ success: true, paid: true, orderId: localOrderId });
    }

    const paypalSettings = await getPayPalSettings();
    if (!paypalSettings.enabled) return res.status(503).json({ error: "PayPal is momenteel uitgeschakeld." });
    const accessToken = await getPayPalAccessToken(paypalSettings);

    const response = await fetchImpl(
      `${getPayPalBaseUrl(paypalSettings.mode)}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": `homs-tech-capture-${localOrderId}`
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
      data.purchase_units?.[0]?.custom_id !== String(localOrderId) ||
      data.purchase_units?.[0]?.reference_id !== `HOMS-${localOrderId}` ||
      captureStatus !== "COMPLETED" ||
      captureState !== "COMPLETED" ||
      captureCurrency !== "EUR" ||
      !Number.isFinite(captureAmount) ||
      !Number.isFinite(expectedAmount) ||
      Math.abs(captureAmount - expectedAmount) > 0.005
    ) {
      await pool.query(
        `UPDATE webshop_orders SET payment_status = $1 WHERE id = $2 AND paypal_order_id = $3 AND payment_method = 'PayPal' AND payment_status <> 'Paid'`,
        ["Failed", localOrderId, paypalOrderId]
      );
      return res.status(402).json({ error: "PayPal betaling is niet voltooid.", paypalStatus: captureStatus });
    }

    const paidUpdate = await pool.query(
      `UPDATE webshop_orders
       SET payment_status = 'Paid', payment_method = 'PayPal'
       WHERE id = $1 AND paypal_order_id = $2 AND payment_method = 'PayPal' AND payment_status <> 'Paid'
       RETURNING id`,
      [localOrderId, paypalOrderId]
    );
    if (!paidUpdate.rowCount) {
      const latest = await pool.query("SELECT payment_status FROM webshop_orders WHERE id = $1", [localOrderId]);
      if (latest.rows[0]?.payment_status === "Paid") {
        return res.json({ success: true, paid: true, orderId: localOrderId, paypalOrderId, captureId: capture?.id || null });
      }
      return res.status(409).json({ error: "De bestelling is ondertussen gewijzigd. Neem contact op met HOMS TECH." });
    }
    const inventoryResult = await deductPaidOrderInventory(localOrderId);
    if (inventoryResult?.error) {
      return res.status(409).json({ error: "PayPal heeft de betaling bevestigd, maar de voorraad kon niet worden bijgewerkt. HOMS TECH controleert dit handmatig.", paid: true, orderId: localOrderId });
    }
    await notifyPaidTradeInOrder(localOrderId);

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
    const result = await cancelPaypalOrder({ pool, orderId: localOrderId, checkoutTokenHash });
    res.status(result.statusCode).json(result.body);
  } catch (error) {
    console.error("PayPal cancel error:", error);
    res.status(500).json({ error: "Betaling kon niet worden bijgewerkt." });
  }
});

app.get("/api/payment-methods/config", async (req,res) => {
  try {
    const result = await pool.query("SELECT data FROM order_settings WHERE id=1");
    res.json({cashOnDeliveryEnabled: result.rows[0]?.data?.cashOnDeliveryEnabled === true});
  } catch (error) {
    console.error("Payment methods config error:", error);
    res.status(500).json({cashOnDeliveryEnabled:false});
  }
});

app.get("/api/admin/order-settings", requirePermission("site.save"), async (req,res) => {
  try{
    await pool.query("INSERT INTO order_settings (id,data) VALUES (1,$1::jsonb) ON CONFLICT (id) DO NOTHING", [JSON.stringify({postnlEnabled:false,dhlEnabled:false})]);
    const result=await pool.query("SELECT data FROM order_settings WHERE id=1");
    const settings=result.rows[0]?.data || {postnlEnabled:false,dhlEnabled:false};
    const paypal = settings.paypal || {};
    const envConfigured = !!(getEnv().PAYPAL_CLIENT_ID && getEnv().PAYPAL_CLIENT_SECRET);
    res.json({
      settings:{postnlEnabled:!!settings.postnlEnabled,dhlEnabled:!!settings.dhlEnabled,cashOnDeliveryEnabled:!!settings.cashOnDeliveryEnabled},
      paypal: {
        enabled: typeof paypal.enabled === "boolean" ? paypal.enabled : envConfigured,
        mode: String(paypal.mode || getEnv().PAYPAL_MODE || "sandbox").toLowerCase() === "live" ? "live" : "sandbox",
        clientId: String(paypal.clientId || getEnv().PAYPAL_CLIENT_ID || ""),
        merchantId: String(paypal.merchantId || ""),
        configured: !!(paypal.clientSecretEncrypted || getEnv().PAYPAL_CLIENT_SECRET)
      },
      mollie:{configured:!!(result.rows[0]?.data?.mollie?.apiKeyEncrypted||getEnv().MOLLIE_API_KEY)},
      api:{postnl:!!getEnv().POSTNL_API_KEY,dhl:!!getEnv().DHL_API_KEY}
    });
  }catch(error){
    console.error("Order settings load error:",error.message);
    res.status(500).json({error:"Orderinstellingen konden niet worden geladen."});
  }
});

app.put("/api/admin/order-settings", requirePermission("site.save"), async (req,res) => {
  try{
    const postnlEnabled=req.body?.postnlEnabled===true;
    const dhlEnabled=req.body?.dhlEnabled===true;
    const cashOnDeliveryEnabled=req.body?.cashOnDeliveryEnabled===true;
    if(postnlEnabled && !getEnv().POSTNL_API_KEY){
      return res.status(400).json({error:"Voeg eerst POSTNL_API_KEY toe bij Render Environment Variables."});
    }
    if(dhlEnabled && !getEnv().DHL_API_KEY){
      return res.status(400).json({error:"Voeg eerst DHL_API_KEY toe bij Render Environment Variables."});
    }
    const currentResult=await pool.query("SELECT data FROM order_settings WHERE id=1");
    const current=currentResult.rows[0]?.data || {};
    const oldPaypal=current.paypal || {};
    const clientId=String(req.body?.paypalClientId ?? oldPaypal.clientId ?? getEnv().PAYPAL_CLIENT_ID ?? "").trim();
    const mode=String(req.body?.paypalMode || oldPaypal.mode || getEnv().PAYPAL_MODE || "sandbox").toLowerCase()==="live"?"live":"sandbox";
    const merchantId=String(req.body?.paypalMerchantId ?? oldPaypal.merchantId ?? "").trim().slice(0,160);
    const paypalEnabled=req.body?.paypalEnabled===true;
    const newSecret=String(req.body?.paypalClientSecret || "").trim();
    let clientSecretEncrypted=oldPaypal.clientSecretEncrypted || null;
    if(newSecret){
      clientSecretEncrypted=encryptPayPalSecret(newSecret);
    }
    const hasServerSecret=!!clientSecretEncrypted || !!getEnv().PAYPAL_CLIENT_SECRET;
    if(paypalEnabled && (!clientId || !hasServerSecret)){
      return res.status(400).json({error:"Vul zowel de PayPal Client ID als Client Secret in voordat je PayPal inschakelt."});
    }
    const paypal={enabled:paypalEnabled,mode,clientId,merchantId,clientSecretEncrypted};
    const oldMollie=current.mollie || {};
    const newMollieKey=String(req.body?.mollieApiKey || "").trim();
    const mollieApiKeyEncrypted=newMollieKey ? encryptPayPalSecret(newMollieKey) : (oldMollie.apiKeyEncrypted || null);
    const settings={...current,postnlEnabled,dhlEnabled,cashOnDeliveryEnabled,paypal,mollie:{apiKeyEncrypted:mollieApiKeyEncrypted}};
    await pool.query(
      "INSERT INTO order_settings (id,data,updated_at) VALUES (1,$1::jsonb,NOW()) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()",
      [JSON.stringify(settings)]
    );
    res.json({
      success: true,
      settings: { postnlEnabled, dhlEnabled, cashOnDeliveryEnabled },
      paypal: { enabled: paypalEnabled, mode, clientId, merchantId, configured: hasServerSecret },
      mollie: { configured: !!(mollieApiKeyEncrypted || getEnv().MOLLIE_API_KEY) },
      api: { postnl: !!getEnv().POSTNL_API_KEY, dhl: !!getEnv().DHL_API_KEY }
    });
  }catch(error){
    console.error("Order settings save error:",error.message);
    res.status(500).json({error:error.message.includes("JWT_SECRET")?error.message:"Orderinstellingen konden niet worden opgeslagen."});
  }
});
}

module.exports = { registerPaymentRoutes };
