"use strict";

function formatEuro(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(Number.isFinite(amount) ? amount : 0);
}

async function sendPaidWebshopOrderNotifications({ pool, orderId, fetchImpl, getEnv, escapeHtml }) {
  const id = Number(orderId);
  if (!Number.isInteger(id) || id < 1) return { sent: false, reason: "invalid-order" };

  const result = await pool.query(
    `SELECT
       orders.id, orders.name, orders.email, orders.phone, orders.street, orders.house_number,
       orders.postcode, orders.city, orders.items, orders.total, orders.payment_method,
       orders.payment_status, orders.trade_in_order_id, orders.trade_in_estimated_value,
       orders.trade_in_status,
       buyback.order_no AS trade_in_order_no, buyback.device AS trade_in_device,
       buyback.model AS trade_in_model, buyback.storage AS trade_in_storage,
       buyback.condition AS trade_in_condition, buyback.battery AS trade_in_battery,
       buyback.screen AS trade_in_screen, buyback.offered_price AS trade_in_offered_price,
       buyback.answers AS trade_in_answers
     FROM webshop_orders orders
     LEFT JOIN buyback_orders buyback ON buyback.id = orders.trade_in_order_id
     WHERE orders.id = $1
     LIMIT 1`,
    [id]
  );
  if (!result.rows.length) return { sent: false, reason: "order-not-found" };

  const order = result.rows[0];
  if (order.payment_status !== "Paid" || !order.trade_in_order_id) {
    return { sent: false, reason: "not-a-paid-trade-in-order" };
  }

  // Promote the temporary trade-in quote to a real admin request only after payment.
  await pool.query(
    `UPDATE buyback_orders
     SET status = CASE
       WHEN status IN ('Wacht op aankoop', 'Wacht op betaling', 'Inruil gekoppeld') THEN 'Nieuw'
       ELSE status
     END
     WHERE id = $1`,
    [order.trade_in_order_id]
  );
  await pool.query(
    `UPDATE webshop_orders
     SET trade_in_status = CASE
       WHEN trade_in_status IN ('AwaitingPayment', '') THEN 'AwaitingDevice'
       ELSE trade_in_status
     END
     WHERE id = $1 AND payment_status = 'Paid'`,
    [id]
  );

  const env = getEnv();
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const from = String(env.RESEND_FROM_EMAIL || "").trim();
  if (!apiKey || !from) {
    console.error("Paid trade-in notifications skipped: RESEND_API_KEY or RESEND_FROM_EMAIL is missing.");
    return { sent: false, reason: "email-not-configured" };
  }

  const esc = value => escapeHtml(String(value == null ? "" : value));
  const items = Array.isArray(order.items) ? order.items : [];
  const itemLines = items.map(item =>
    `<li>${esc(item.name || item.title || "Product")} × ${Math.max(1, Number(item.qty || 1))} — ${formatEuro(Number(item.unitPrice || 0) * Math.max(1, Number(item.qty || 1)))}</li>`
  ).join("");
  const tradeDevice = String(order.trade_in_device || order.trade_in_model || "Oude iPhone");
  const tradeValue = formatEuro(order.trade_in_estimated_value ?? order.trade_in_offered_price);
  const customerName = esc(order.name);
  const orderNo = esc(order.id);
  const tradeOrderNo = esc(order.trade_in_order_no || "");
  const paymentMethod = esc(order.payment_method || "Online");
  const total = formatEuro(order.total);
  const customerAddress = `${esc(order.street)} ${esc(order.house_number)}, ${esc(order.postcode)} ${esc(order.city)}`;
  const answers = order.trade_in_answers && typeof order.trade_in_answers === "object"
    ? Object.entries(order.trade_in_answers).map(([key, value]) => {
        const question = value && typeof value === "object" ? (value.question || key) : key;
        const answer = value && typeof value === "object" ? (value.value ?? value.answer ?? "") : value;
        return question && answer ? `<li><strong>${esc(question)}:</strong> ${esc(answer)}</li>` : "";
      }).filter(Boolean).join("")
    : "";

  const customerOrderEmail = {
    from,
    to: [order.email],
    subject: `HOMS TECH — uw aankoop is bevestigd #${orderNo}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:26px;color:#203449;line-height:1.65">
      <h1 style="color:#0f2740">Bedankt voor uw aankoop!</h1>
      <p>Beste ${customerName},</p>
      <p>Uw betaling is bevestigd en uw bestelling bij HOMS TECH is succesvol afgerond.</p>
      <p><strong>Bestelnummer:</strong> #${orderNo}</p>
      <h3>Uw nieuwe telefoon</h3><ul>${itemLines}</ul>
      <p><strong>Totaal betaald:</strong> ${total}</p>
      <p><strong>Betaalmethode:</strong> ${paymentMethod}</p>
      <p><strong>Bezorgadres:</strong><br>${customerAddress}</p>
      <p>We houden u op de hoogte van de verdere verwerking en verzending.</p>
      <p>Met vriendelijke groet,<br><strong>HOMS TECH</strong></p>
    </div>`
  };

  const customerTradeInEmail = {
    from,
    to: [order.email],
    subject: `HOMS TECH — uw inruilaanvraag is gekoppeld aan bestelling #${orderNo}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:26px;color:#203449;line-height:1.65">
      <h1 style="color:#0f2740">Uw inruilaanvraag is bevestigd</h1>
      <p>Beste ${customerName},</p>
      <p>Uw aankoop is betaald. Daarom is uw inruilaanvraag nu officieel aan uw bestelling gekoppeld.</p>
      <p><strong>Bestelnummer:</strong> #${orderNo}<br><strong>Inruilnummer:</strong> ${tradeOrderNo || "Wordt door ons verwerkt"}</p>
      <div style="padding:16px;border:1px solid #bfdbfe;border-radius:12px;background:#eff6ff">
        <strong>Oude telefoon:</strong> ${esc(tradeDevice)}<br>
        <strong>Geschatte inruilwaarde:</strong> ${tradeValue}
      </div>
      <p>We controleren uw oude telefoon na ontvangst. Na inspectie bevestigen we de definitieve waarde en maken we het afgesproken bedrag aan u over. De geschatte waarde is niet van uw aankoopbedrag afgetrokken.</p>
      <p>U ontvangt van ons verdere instructies voor het opsturen of inleveren van uw oude telefoon.</p>
      <p>Met vriendelijke groet,<br><strong>HOMS TECH</strong></p>
    </div>`
  };

  const notifyEmail = String(env.ORDER_NOTIFICATION_EMAIL || env.BUYBACK_NOTIFICATION_EMAIL || env.REPAIR_REQUEST_EMAIL || "").trim();
  const ownerEmail = notifyEmail ? {
    from,
    to: [notifyEmail],
    subject: `Nieuwe betaalde aankoop met inruil #${orderNo}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;padding:24px;color:#203449;line-height:1.6">
      <h2>Betaalde webshopbestelling met inruil</h2>
      <p><strong>Bestelnummer:</strong> #${orderNo}<br><strong>Inruilnummer:</strong> ${tradeOrderNo || "-"}<br><strong>Klant:</strong> ${customerName}<br><strong>E-mail:</strong> ${esc(order.email)}<br><strong>Telefoon:</strong> ${esc(order.phone)}<br><strong>Adres:</strong> ${customerAddress}</p>
      <h3>Nieuwe telefoon</h3><ul>${itemLines}</ul>
      <p><strong>Betaald:</strong> ${total} · ${paymentMethod}</p>
      <h3>Inruiltoestel</h3>
      <p><strong>Toestel:</strong> ${esc(tradeDevice)}<br><strong>Geschatte waarde:</strong> ${tradeValue}<br><strong>Opslag:</strong> ${esc(order.trade_in_storage || "-")}<br><strong>Staat:</strong> ${esc(order.trade_in_condition || "-")}<br><strong>Batterij:</strong> ${esc(order.trade_in_battery || "-")}<br><strong>Scherm:</strong> ${esc(order.trade_in_screen || "-")}</p>
      ${answers ? `<h4>Antwoorden klant</h4><ul>${answers}</ul>` : ""}
      <p>De inruilaanvraag is nu zichtbaar in Admin → Verkoopaanvragen en is gekoppeld aan webshopbestelling #${orderNo}. Controleer het oude toestel na ontvangst.</p>
    </div>`
  } : null;

  async function sendOnce(claimColumn, sentColumn, mail, label) {
    const claimed = await pool.query(
      `UPDATE webshop_orders
       SET ${claimColumn} = NOW()
       WHERE id = $1 AND payment_status = 'Paid'
         AND ${sentColumn} IS NULL
         AND (${claimColumn} IS NULL OR ${claimColumn} < NOW() - INTERVAL '10 minutes')
       RETURNING id`,
      [id]
    );
    if (!claimed.rows.length) return;
    try {
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(mail)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("Resend " + response.status + ": " + JSON.stringify(data));
      await pool.query(
        `UPDATE webshop_orders SET ${sentColumn} = NOW(), ${claimColumn} = NULL WHERE id = $1`,
        [id]
      );
      console.log(label + " sent for paid webshop order:", id, data.id || "ok");
    } catch (error) {
      await pool.query(`UPDATE webshop_orders SET ${claimColumn} = NULL WHERE id = $1 AND ${sentColumn} IS NULL`, [id]);
      console.error(label + " failed for paid webshop order:", id, error.message || error);
    }
  }

  await sendOnce("customer_order_email_claimed_at", "customer_order_email_sent_at", customerOrderEmail, "Customer purchase confirmation");
  await sendOnce("customer_tradein_email_claimed_at", "customer_tradein_email_sent_at", customerTradeInEmail, "Customer trade-in confirmation");
  if (ownerEmail) {
    await sendOnce("owner_order_email_claimed_at", "owner_order_email_sent_at", ownerEmail, "Owner paid order notification");
  } else {
    console.warn("Paid webshop trade-in owner notification skipped: configure ORDER_NOTIFICATION_EMAIL or BUYBACK_NOTIFICATION_EMAIL.");
  }

  return { sent: true };
}

module.exports = { sendPaidWebshopOrderNotifications };
