"use strict";

function registerAdminWebshopOrderRoutes(app, { pool, requirePermission }) {
  app.put("/api/admin/webshop-orders/:id/shipping", requirePermission("webshop_orders.update"), async (req,res) => {
    try{
      const id=Number(req.params.id);
      if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Ongeldig order-ID."});
      const body=req.body||{};
      const carrier=String(body.shipping_method||"").trim();
      const paymentStatus=String(body.payment_status||"Unpaid").trim();
      const trackingNumber=String(body.tracking_number||"").trim().slice(0,160);
      const trackingUrl=String(body.tracking_url||"").trim().slice(0,1000);
      if(carrier&&!["PostNL","DHL"].includes(carrier))return res.status(400).json({error:"Kies alleen PostNL of DHL."});
      if(!["Unpaid","Processing","Paid","Failed"].includes(paymentStatus))return res.status(400).json({error:"Ongeldige betaalstatus."});
      if(trackingUrl&&!/^https:\/\//i.test(trackingUrl))return res.status(400).json({error:"De tracking-URL moet beginnen met https://"});
      const result=await pool.query(
        `UPDATE webshop_orders
         SET shipping_method=$1, payment_status=$2, tracking_number=$3, tracking_url=$4
         WHERE id=$5
         RETURNING id,shipping_method,payment_status,tracking_number,tracking_url`,
        [carrier,paymentStatus,trackingNumber,trackingUrl,id]
      );
      if(!result.rows.length)return res.status(404).json({error:"Bestelling niet gevonden."});
      res.json({success:true,order:result.rows[0]});
    }catch(error){
      console.error("Save webshop shipping details error:",error);
      res.status(500).json({error:"Verzend- en betaalgegevens konden niet worden opgeslagen."});
    }
  });
  
  app.get("/api/admin/webshop-orders", requirePermission("webshop_orders.view"), async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, customer_id, name, email, phone, street, house_number, postcode, city, items, total, status,
                payment_method, payment_status, paypal_order_id, created_at
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
}

module.exports = { registerAdminWebshopOrderRoutes };
