"use strict";

const { findShopProductIndex, deductShopVariantInventory } = require("./shop-catalog");

function createPaidOrderInventoryDeductor({ pool }) {
  if (!pool || typeof pool.connect !== "function" || typeof pool.query !== "function") {
    throw new TypeError("A database pool is required.");
  }

  async function deductPaidOrderInventory(orderId) {
    // Reject invalid identifiers before opening a database connection.
    if (!Number.isSafeInteger(orderId) || orderId < 1) return { error: true };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT id, items, payment_status, inventory_deducted_at FROM webshop_orders WHERE id=$1 FOR UPDATE', [orderId]);
      if (!result.rows.length || result.rows[0].payment_status !== 'Paid') { await client.query('ROLLBACK'); return { skipped: true }; }
      const order = result.rows[0];
      if (order.inventory_deducted_at) { await client.query('COMMIT'); return { alreadyDeducted: true }; }
      const settings = await client.query(
        "SELECT data->'phones' AS phones, data->'devices' AS devices, data->'shopProducts' AS shop_products FROM site_settings WHERE id=1 FOR UPDATE"
      );
      if (!settings.rows.length) throw new Error('Catalog settings row is missing.');
      const catalog = settings.rows[0];
      const data = {
        phones: Array.isArray(catalog.phones) ? catalog.phones : [],
        devices: Array.isArray(catalog.devices) ? catalog.devices : [],
        shopProducts: Array.isArray(catalog.shop_products) ? catalog.shop_products : []
      };
      if (!Array.isArray(order.items) || order.items.length === 0) {
        throw new Error('Paid order has no valid item list; inventory requires manual review.');
      }
      for (const item of order.items) {
        const type = String(item && item.type || '').trim().toLowerCase();
        if (!['phone', 'shop'].includes(type)) {
          throw new Error('Unsupported paid order item type; inventory requires manual review.');
        }
        const list = type === 'shop' ? (Array.isArray(data.shopProducts) ? data.shopProducts : []) : (Array.isArray(data.phones) && data.phones.length ? data.phones : (Array.isArray(data.devices) ? data.devices : []));
        const id = type === 'shop'
          ? findShopProductIndex(list, item && item.id)
          : Number(item && item.id);
        const qty = Number(item && item.qty || 1);
        if (!Number.isInteger(id) || id < 0 || !list[id] || !Number.isInteger(qty) || qty < 1) throw new Error('Paid order item could not be matched to catalog.');
        const product = list[id];
        const options = item.options && typeof item.options === 'object' ? item.options : {};
        let trackedStock = null;
        let stockOwner = product;
        let stockVariantId = String(item.variantId || item.sku || '');
        let variantLabel = String(options.quality || options.condition || '').trim();
        if (type === 'shop') {
          const deducted = deductShopVariantInventory(product, item);
          if (deducted.remaining !== null && deducted.remaining !== undefined) {
            trackedStock = { before: deducted.remaining + qty, after: deducted.remaining };
          }
          if (deducted.variant) {
            stockOwner = deducted.variant;
            variantLabel = String(deducted.variant.quality || variantLabel || 'Standaard');
            stockVariantId = String(deducted.variant.id || deducted.variant.sku || stockVariantId);
          }
        } else if (product.pricingMode === 'variant') {
          const rows = Array.isArray(product.variantPrices) ? product.variantPrices : [];
          const row = rows.find(x => x &&
            String(x.condition ?? '') === String(options.condition ?? '') &&
            String(x.color ?? '') === String(options.color ?? '') &&
            String(x.storage ?? '') === String(options.storage ?? ''));
          if (!row) throw new Error('Paid order variant was not found.');
          stockOwner = row;
          variantLabel = [row.storage, row.color, row.condition].filter(Boolean).join(' · ');
          stockVariantId = String(row.id || stockVariantId || [row.storage, row.color, row.condition].map(value => String(value ?? '').trim()).join('::'));
          if (row.stock !== undefined && row.stock !== null && row.stock !== '') {
            const stock = Number(row.stock);
            if (!Number.isSafeInteger(stock) || stock < qty) throw new Error('Insufficient stock for paid variant.');
            row.stock = stock - qty;
            trackedStock = { before: stock, after: stock - qty };
          }
        } else {
          const key = ['stock', 'quantity', 'stockQuantity'].find(k =>
            product[k] !== undefined && product[k] !== null && product[k] !== ''
          );
          if (key) {
            const stock = Number(product[key]);
            if (!Number.isSafeInteger(stock) || stock < qty) throw new Error('Insufficient stock for paid product.');
            product[key] = stock - qty;
            trackedStock = { before: stock, after: stock - qty };
          }
        }
        if (trackedStock) {
          await client.query(
            "INSERT INTO inventory_movements(item_type,product_id,variant_id,product_name,variant_label,sku,movement_type,quantity,stock_before,stock_after,reference,note,created_by) VALUES($1,$2,$3,$4,$5,$6,'webshop_sale',$7,$8,$9,$10,$11,'Systeem')",
            [
              type === 'shop' ? 'shop' : 'phone',
              String(product.id ?? item.id ?? id),
              stockVariantId,
              String(product.name || item.name || 'Product').slice(0, 200),
              variantLabel.slice(0, 160),
              String(item.sku || stockOwner.sku || product.sku || '').slice(0, 64),
              -qty,
              trackedStock.before,
              trackedStock.after,
              'Webshop bestelling #' + String(order.id),
              'Automatische voorraadboeking na bevestigde betaling.'
            ]
          );
        }
        const custom = options.custom && typeof options.custom === 'object' ? options.custom : {};
        for (const groupType of ['optionGroups', 'addonGroups']) {
          const groups = Array.isArray(product[groupType]) ? product[groupType] : [];
          for (let i = 0; i < groups.length; i++) {
            const label = String(custom[groupType + ':' + i] ?? ''); if (!label) continue;
            const option = (Array.isArray(groups[i]?.options) ? groups[i].options : []).find(x => x && String(x.label) === label);
            if (!option) throw new Error('Paid order option was not found.');
            if (option.stock !== undefined && option.stock !== null && option.stock !== '') {
              const stock = Number(option.stock);
              if (!Number.isSafeInteger(stock) || stock < 0 || stock < qty) {
                throw new Error('Insufficient stock or invalid stock value for paid option.');
              }
              option.stock = stock - qty;
            }
          }
        }
        list[id] = product;
      }
      await client.query(
        `UPDATE site_settings
         SET data = jsonb_set(
           jsonb_set(
             jsonb_set(data, '{phones}', $1::jsonb, TRUE),
             '{devices}', $2::jsonb, TRUE
           ),
           '{shopProducts}', $3::jsonb, TRUE
         )
         WHERE id=1`,
        [JSON.stringify(data.phones), JSON.stringify(data.devices), JSON.stringify(data.shopProducts)]
      );
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
