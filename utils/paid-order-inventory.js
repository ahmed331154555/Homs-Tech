"use strict";

const { findShopProductIndex, deductShopVariantInventory } = require("./shop-catalog");

function createPaidOrderInventoryDeductor({ pool }) {
  if (!pool || typeof pool.connect !== "function" || typeof pool.query !== "function") {
    throw new TypeError("A database pool is required.");
  }

  async function deductPaidOrderInventory(orderId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT id, items, payment_status, inventory_deducted_at FROM webshop_orders WHERE id=$1 FOR UPDATE', [orderId]);
      if (!result.rows.length || result.rows[0].payment_status !== 'Paid') { await client.query('ROLLBACK'); return { skipped: true }; }
      const order = result.rows[0];
      if (order.inventory_deducted_at) { await client.query('COMMIT'); return { alreadyDeducted: true }; }
      const settings = await client.query('SELECT data FROM site_settings WHERE id=1 FOR UPDATE');
      if (!settings.rows.length) throw new Error('Catalog settings row is missing.');
      const data = settings.rows[0].data || {};
      for (const item of (Array.isArray(order.items) ? order.items : [])) {
        const type = String(item && item.type || '').toLowerCase();
        const list = type === 'shop' ? (Array.isArray(data.shopProducts) ? data.shopProducts : []) : type === 'used' ? (Array.isArray(data.usedPhones) ? data.usedPhones : []) : (Array.isArray(data.phones) && data.phones.length ? data.phones : (Array.isArray(data.devices) ? data.devices : []));
        const id = type === 'shop'
          ? findShopProductIndex(list, item && item.id)
          : Number(item && item.id);
        const qty = Number(item && item.qty || 1);
        if (!Number.isInteger(id) || id < 0 || !list[id] || !Number.isInteger(qty) || qty < 1) throw new Error('Paid order item could not be matched to catalog.');
        const product = list[id]; const options = item.options && typeof item.options === 'object' ? item.options : {};
        if (type === 'shop') {
          deductShopVariantInventory(product, item);
        } else if (product.pricingMode === 'variant') {
          const rows = Array.isArray(product.variantPrices) ? product.variantPrices : [];
          const row = rows.find(x => x && String(x.condition ?? '') === String(options.condition ?? '') && String(x.color ?? '') === String(options.color ?? '') && String(x.storage ?? '') === String(options.storage ?? ''));
          if (!row) throw new Error('Paid order variant was not found.');
          if (row.stock !== undefined && row.stock !== null && row.stock !== '') { const stock = Number(row.stock); if (!Number.isFinite(stock) || stock < qty) throw new Error('Insufficient stock for paid variant.'); row.stock = stock - qty; }
        } else {
          const key = ['stock', 'quantity', 'stockQuantity'].find(k => product[k] !== undefined && product[k] !== null && product[k] !== '');
          if (key) {
            const stock = Number(product[key]);
            if (type === 'shop' && !Number.isFinite(stock)) { /* Text stock labels such as "Op voorraad" are informational only. */ }
            else { if (!Number.isFinite(stock) || stock < qty) throw new Error('Insufficient stock for paid product.'); product[key] = stock - qty; }
          }
        }
        const custom = options.custom && typeof options.custom === 'object' ? options.custom : {};
        for (const groupType of ['optionGroups', 'addonGroups']) {
          const groups = Array.isArray(product[groupType]) ? product[groupType] : [];
          for (let i = 0; i < groups.length; i++) {
            const label = String(custom[groupType + ':' + i] ?? ''); if (!label) continue;
            const option = (Array.isArray(groups[i]?.options) ? groups[i].options : []).find(x => x && String(x.label) === label);
            if (!option) throw new Error('Paid order option was not found.');
            if (option.stock !== undefined && option.stock !== null && option.stock !== '') { const stock = Number(option.stock); if (!Number.isFinite(stock) || stock < qty) throw new Error('Insufficient stock for paid option.'); option.stock = stock - qty; }
          }
        }
        list[id] = product;
      }
      await client.query('UPDATE site_settings SET data=$1::jsonb WHERE id=1', [JSON.stringify(data)]);
      await client.query('UPDATE webshop_orders SET inventory_deducted_at=NOW(), inventory_error=$1 WHERE id=$2 AND inventory_deducted_at IS NULL', ['', orderId]);
      await client.query('COMMIT'); return { deducted: true };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      try { await pool.query('UPDATE webshop_orders SET inventory_error=$1 WHERE id=$2 AND inventory_deducted_at IS NULL', [String(error.message || 'Inventory deduction failed').slice(0, 500), orderId]); } catch (recordError) { console.error('Could not record inventory error:', recordError.message); }
      console.error('Paid order inventory deduction needs review:', { orderId, message: error.message }); return { error: true };
    } finally { client.release(); }
  }

  return deductPaidOrderInventory;
}

module.exports = { createPaidOrderInventoryDeductor };
