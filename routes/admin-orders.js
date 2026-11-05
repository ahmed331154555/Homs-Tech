"use strict";

function registerAdminOrderRoutes(app, { pool, requirePermission }) {
  app.get("/api/admin/orders", requirePermission("orders.view"), async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, customer_id, service_category, service_name, service_group, price, price_currency, source_price, source_currency, service_instructions, required_fields, extra_fields, service_source_id, service_source_url, name, email, phone, username, imei, notes, status, provider_reference, execution_note, result_data, execution_updated_at, created_at
         FROM service_orders
         WHERE LOWER(service_category) IN ('reparatie','repair')
         ORDER BY created_at DESC`
      );

      const sanitizedOrders = result.rows.map(order => {
        if (!order.extra_fields) return order;
        try {
          const meta = JSON.parse(order.extra_fields);
          if (meta.repairQuote === true && Array.isArray(meta.photos)) {
            const sanitizedPhotos = meta.photos.map((p, index) => ({
              name: p.name || `foto-${index + 1}`,
              type: p.type || "image/jpeg",
              url: `/api/admin/repair-requests/${order.id}/photos/${index}`
            }));
            return {
              ...order,
              extra_fields: JSON.stringify({ ...meta, photos: sanitizedPhotos })
            };
          }
        } catch {}
        return order;
      });

      res.json({ orders: sanitizedOrders });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Bestellingen konden niet worden geladen." });
    }
  });

  app.get("/api/admin/repair-requests/:id/photos/:index", requirePermission("orders.view"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const index = Number(req.params.index);
      if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(index) || index < 0) {
        return res.status(400).send("Ongeldig verzoek.");
      }
      const result = await pool.query("SELECT extra_fields FROM service_orders WHERE id = $1", [id]);
      if (!result.rows.length) return res.status(404).send("Aanvraag niet gevonden.");

      let meta = {};
      try { meta = JSON.parse(result.rows[0].extra_fields || "{}"); } catch {}
      const photos = Array.isArray(meta.photos) ? meta.photos : [];
      const photo = photos[index];
      if (!photo || !photo.dataUrl) return res.status(404).send("Foto niet gevonden.");

      const match = String(photo.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return res.status(400).send("Fotoformaat ongeldig.");
      const contentType = match[1];
      const buffer = Buffer.from(match[2], "base64");
      res.set("Content-Type", contentType);
      res.set("Cache-Control", "private, max-age=86400");
      res.send(buffer);
    } catch (err) {
      console.error("Photo serve error:", err);
      res.status(500).send("Foto kon niet worden geladen.");
    }
  });

  app.put("/api/admin/orders/:id/status", requirePermission("orders.update"), async (req, res) => {
    try {
      const allowed = ["Nieuw", "In behandeling", "Wacht op klant", "Wacht op leverancier", "Resultaat ontvangen", "Mislukt", "Voltooid", "Geannuleerd"];
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
      console.error("Delete repair request error:", error);
      res.status(500).json({ error: "Order kon niet worden verwijderd." });
    }
  });
}

module.exports = { registerAdminOrderRoutes };
