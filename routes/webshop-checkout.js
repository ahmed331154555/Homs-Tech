"use strict";

const { sendPaidWebshopOrderNotifications } = require("../utils/webshop-paid-notifications");

function registerWebshopCheckoutRoutes(app, { pool, jwt, crypto, escapeHtml, fetchImpl, getEnv, priceProductFromCatalog, validateCartInventoryQuantities }) {
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
    const paymentMethod = String(body.paymentMethod || "Mollie").trim();
    if (!["Mollie", "PayPal", "CashOnDelivery"].includes(paymentMethod)) return res.status(400).json({ error: "Kies een geldige betaalmethode." });
    if (paymentMethod === "CashOnDelivery") {
      const codSettings = await pool.query("SELECT data FROM order_settings WHERE id=1");
      if (codSettings.rows[0]?.data?.cashOnDeliveryEnabled !== true) return res.status(400).json({ error: "Betalen bij ontvangst is momenteel niet beschikbaar." });
    }

    if (!name || !email || !phone || !street || !houseNumber || !postcode || !city || !items.length) {
      return res.status(400).json({ error: "Vul alle verplichte gegevens in en controleer uw winkelwagen." });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Vul een geldig e-mailadres in." });
    }

    let customerId = null;
    try {
      if (req.cookies.customerToken) {
        const decoded = jwt.verify(req.cookies.customerToken, getEnv().JWT_SECRET);
        customerId = decoded.customerId || null;
      }
    } catch {}

    if (items.length > 50) return res.status(400).json({ error: "Te veel producten in één bestelling." });
    const catalogResult = await pool.query(
      "SELECT data->'phones' AS phones, data->'devices' AS devices, data->'shopProducts' AS shop_products FROM site_settings WHERE id = 1"
    );
    const catalogRow = catalogResult.rows[0] || {};
    const catalogData = {
      phones: Array.isArray(catalogRow.phones) ? catalogRow.phones : [],
      devices: Array.isArray(catalogRow.devices) ? catalogRow.devices : [],
      shopProducts: Array.isArray(catalogRow.shop_products) ? catalogRow.shop_products : []
    };
    const safeItems = [];
    for (const item of items) {
      const priced = priceProductFromCatalog(catalogData, item);
      if (priced.error) return res.status(400).json({ error: priced.error });
      safeItems.push(priced.item);
    }
    const inventoryValidationError = validateCartInventoryQuantities(catalogData, safeItems);
    if (inventoryValidationError) return res.status(400).json({ error: inventoryValidationError });
    const productTotalCents = safeItems.reduce((sum,item)=>sum+Math.round(item.unitPrice*100)*item.qty,0);
    const productTotal = productTotalCents / 100;
    const tradeInToken = String(body.tradeInToken || "").trim();
    if (tradeInToken && !/^[a-f0-9]{64}$/.test(tradeInToken)) {
      return res.status(400).json({ error: "Ongeldige inruilcode." });
    }
    const checkoutToken = crypto.randomBytes(32).toString("hex");
    const checkoutTokenHash = crypto.createHash("sha256").update(checkoutToken).digest("hex");
    const client = await pool.connect();
    let result;
    let tradeInOrder = null;
    let tradeInCredit = 0;
    let total = productTotal;
    try {
      await client.query("BEGIN");
      if (tradeInToken) {
        const tokenHash = crypto.createHash("sha256").update(tradeInToken).digest("hex");
        const quote = await client.query(
          `SELECT id,offered_price,device,model,name,email,trade_in,trade_in_linked_order_id
           FROM buyback_orders
           WHERE trade_in_quote_token_hash=$1 AND trade_in_quote_expires_at>NOW()
           FOR UPDATE`,
          [tokenHash]
        );
        if (!quote.rows.length || quote.rows[0].trade_in !== true || quote.rows[0].trade_in_linked_order_id) {
          await client.query("ROLLBACK");
          return res.status(409).json({ error: "De inruilaanvraag is verlopen of al gebruikt. Start de inruil opnieuw." });
        }
        tradeInOrder = quote.rows[0];
        if (String(tradeInOrder.email).toLowerCase() !== email) {
          await client.query("ROLLBACK");
          return res.status(403).json({ error: "Gebruik hetzelfde e-mailadres als bij uw inruilaanvraag." });
        }
        // Mobico-style trade-in: the estimated buyback value is shown separately.
        // The customer still pays the full new-device order total; inspection and payout happen later.
        tradeInCredit = 0;
        total = productTotal;
      }
      if (!Number.isFinite(total) || productTotal <= 0 || total <= 0 || total > 100000) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Het totaalbedrag van uw bestelling is ongeldig." });
      }
      result = await client.query(
        `INSERT INTO webshop_orders
         (customer_id, name, email, phone, street, house_number, postcode, city, items, total, checkout_token, payment_method, payment_status,
          trade_in_order_id,trade_in_estimated_value,trade_in_applied_credit,trade_in_status,trade_in_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)
         RETURNING id, status, payment_method, payment_status, paypal_order_id, mollie_payment_id, created_at`,
        [
          customerId, name, email, phone, street, houseNumber, postcode, city,
          JSON.stringify(safeItems), total.toFixed(2), checkoutTokenHash, paymentMethod, "Unpaid",
          tradeInOrder ? tradeInOrder.id : null,
          tradeInOrder ? Number(tradeInOrder.offered_price) : null,
          tradeInCredit,
          tradeInOrder ? "AwaitingPayment" : "",
          JSON.stringify(tradeInOrder ? { productTotal, estimatedValue:Number(tradeInOrder.offered_price), appliedCredit:0, settlement:"after-inspection", device:tradeInOrder.device || tradeInOrder.model } : {})
        ]
      );
      if (tradeInOrder) {
        const linked = await client.query(
          "UPDATE buyback_orders SET trade_in_linked_order_id=$1,trade_in_quote_token_hash='',status='Wacht op betaling' WHERE id=$2 AND trade_in_linked_order_id IS NULL AND status='Wacht op aankoop' RETURNING id",
          [result.rows[0].id,tradeInOrder.id]
        );
        if (!linked.rows.length) throw new Error("Inruilcode is ondertussen al gebruikt.");
      }
      await client.query("COMMIT");
    } catch (transactionError) {
      try { await client.query("ROLLBACK"); } catch {}
      throw transactionError;
    } finally {
      client.release();
    }

    // Cash-on-delivery trade-in orders are confirmed now, but remain unpaid.
    // Send the customer and owner order/trade-in emails without marking the payment as paid.
    if (tradeInOrder && paymentMethod === "CashOnDelivery") {
      try {
        const notificationResult = await sendPaidWebshopOrderNotifications({
          pool, orderId: result.rows[0].id, fetchImpl, getEnv, escapeHtml,
          allowCashOnDelivery: true
        });
        if (!notificationResult?.sent) {
          console.error("Cash-on-delivery trade-in notifications were not sent:", notificationResult?.reason || "unknown");
        }
      } catch (mailError) {
        console.error("Cash-on-delivery trade-in notification error:", mailError.message || mailError);
      }
    }

    // Send the customer an order confirmation to the email address used at checkout.
    if (!tradeInOrder && getEnv().RESEND_API_KEY && getEnv().RESEND_FROM_EMAIL) {
      try {
        const order = result.rows[0];
        const orderFromEmail = getEnv().RESEND_FROM_EMAIL;
        const itemLines = safeItems.map(item => `<li>${escapeHtml(String(item.name || item.title || "Product"))} × ${Number(item.qty || 1)} — €${(Number(item.unitPrice || 0) * Number(item.qty || 1)).toFixed(2)}</li>`).join("");
        const customerResponse = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${getEnv().RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: orderFromEmail,
            to: [email],
            subject: `HOMS TECH — bevestiging van bestelling #${order.id}`,
            html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:24px;color:#203449;line-height:1.6">
              <h1 style="color:#0f2740">Bedankt voor je bestelling!</h1>
              <p>Hallo ${escapeHtml(name)},</p>
              <p>We hebben je bestelling bij HOMS TECH ontvangen. Hieronder vind je het overzicht.</p>
              <p>
              <strong>Bestelnummer:</strong> #${escapeHtml(String(order.id))}</p>
              <h3>Bestelde producten</h3>
              <ul>${itemLines}</ul>
              <p style="font-size:18px">
              <strong>Totaal: €${total.toFixed(2)}</strong>
              </p>
              <p>
              <strong>Betaalmethode:</strong> ${escapeHtml(paymentMethod)}</p>
              <p>
              <strong>Betaalstatus:</strong> ${escapeHtml(String(order.payment_status || "Unpaid"))}</p>
              <p>
              <strong>Verzendadres:</strong>
              <br>${escapeHtml(street)} ${escapeHtml(houseNumber)}<br>${escapeHtml(postcode)} ${escapeHtml(city)}</p>
              <p>Bewaar deze e-mail als bevestiging van je bestelling. We sturen een update als de status verandert.</p>
              <p>Met vriendelijke groet,<br>
              <strong>Team HOMS TECH</strong>
              </p>
              <p style="font-size:12px;color:#64748b">https://homs-tech.nl</p>
              </div>`
          })
        });
        if (!customerResponse.ok) console.error("Webshop customer confirmation failed:", customerResponse.status, await customerResponse.text().catch(() => ""));
        else console.log("Webshop customer confirmation sent:", (await customerResponse.json().catch(() => ({}))).id || "ok");
      } catch (mailError) { console.error("Webshop customer confirmation error:", mailError.message); }
    }

    // Notify the site owner when a webshop order is created.
    const notifyEmail = getEnv().ORDER_NOTIFICATION_EMAIL || getEnv().REPAIR_REQUEST_EMAIL;
    if (!tradeInOrder && getEnv().RESEND_API_KEY && getEnv().RESEND_FROM_EMAIL && notifyEmail) {
      try {
        const order = result.rows[0];
        const orderFromEmail = getEnv().RESEND_FROM_EMAIL;
        const itemLines = safeItems.map(item => `<li>${escapeHtml(String(item.name || item.title || "Product"))} × ${Number(item.qty || 1)} — €${(Number(item.unitPrice || 0) * Number(item.qty || 1)).toFixed(2)}</li>`).join("");
        const response = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${getEnv().RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: orderFromEmail,
            to: [notifyEmail],
            subject: `Nieuwe HOMS TECH webshopbestelling #${order.id}`,
            html: `<div style="font-family:Arial,sans-serif;color:#203449">
              <h2>Nieuwe webshopbestelling #${order.id}</h2>
              <p>
              <b>Klant:</b> ${escapeHtml(name)}</p>
              <p>
              <b>E-mail:</b> ${escapeHtml(email)}</p>
              <p>
              <b>Telefoon:</b> ${escapeHtml(phone)}</p>
              <p>
              <b>Adres:</b> ${escapeHtml(street)} ${escapeHtml(houseNumber)}, ${escapeHtml(postcode)} ${escapeHtml(city)}</p>
              <p>
              <b>Producten:</b>
              </p>
              <ul>${itemLines}</ul>
              <p>
              <b>Totaal:</b> €${total.toFixed(2)}</p>
              <p>
              <b>Betaalmethode:</b> ${escapeHtml(paymentMethod)}</p>
              <p>
              <b>Betaalstatus:</b> ${escapeHtml(String(order.payment_status || "Unpaid"))}</p>
              </div>`
          })
        });
        if (!response.ok) console.error("Webshop order notification failed:", response.status, await response.text().catch(() => ""));
        else console.log("Webshop order notification sent:", (await response.json().catch(() => ({}))).id || "ok");
      } catch (mailError) { console.error("Webshop order notification error:", mailError.message); }
    } else if (!tradeInOrder) {
      console.error("Webshop order emails skipped: RESEND_API_KEY or order notification email is missing.");
    } else {
      console.log("Webshop order with trade-in created as unpaid; purchase and trade-in emails will be sent only after payment confirmation.");
    }

    res.status(201).json({ success: true, order: { ...result.rows[0], checkout_token: checkoutToken } });
  } catch (error) {
    console.error("Create webshop order error:", error);
    res.status(500).json({ error: "Webshop bestelling kon niet worden opgeslagen." });
  }
});
}

module.exports = { registerWebshopCheckoutRoutes };
