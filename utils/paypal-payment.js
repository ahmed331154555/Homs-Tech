"use strict";

async function cancelPaypalOrder({ pool, orderId, checkoutTokenHash }) {
  const updated = await pool.query(
    `UPDATE webshop_orders
     SET payment_status = CASE WHEN payment_status <> 'Paid' THEN 'Cancelled' ELSE payment_status END
     WHERE id = $1
       AND checkout_token = $2
       AND payment_method = 'PayPal'
       AND COALESCE(paypal_order_id, '') <> ''
     RETURNING id, payment_status`,
    [orderId, checkoutTokenHash]
  );

  if (updated.rows.length) {
    const order = updated.rows[0];
    return { statusCode: 200, body: { success: true, paid: order.payment_status === "Paid" } };
  }

  const existing = await pool.query(
    "SELECT id, payment_method, payment_status, paypal_order_id FROM webshop_orders WHERE id = $1 AND checkout_token = $2",
    [orderId, checkoutTokenHash]
  );
  if (!existing.rows.length) {
    return { statusCode: 404, body: { error: "Webshop bestelling niet gevonden." } };
  }

  const order = existing.rows[0];
  if (order.payment_status === "Paid") {
    return { statusCode: 200, body: { success: true, paid: true } };
  }
  if (order.payment_method !== "PayPal" || !order.paypal_order_id) {
    return { statusCode: 409, body: { error: "Deze bestelling heeft geen actieve PayPal-betaling." } };
  }
  return { statusCode: 409, body: { error: "De PayPal-betaling kon niet worden geannuleerd." } };
}

module.exports = { cancelPaypalOrder };
