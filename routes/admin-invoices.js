"use strict";

function registerAdminInvoiceRoutes(app, {
  pool,
  requirePermission,
  buildInvoicePdf,
  getEnv = () => process.env,
  fetchImpl = fetch
}) {
  app.get("/api/admin/invoices", requirePermission("site.save"), async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT id,invoice_number,customer_name,customer_email,subtotal,vat_total,total,status,created_at FROM manual_invoices ORDER BY id DESC LIMIT 200"
      );
      res.json({ invoices: result.rows });
    } catch (error) {
      console.error("Invoice list:", error);
      res.status(500).json({ error: "Facturen laden is mislukt." });
    }
  });
  app.post("/api/admin/invoices", requirePermission("site.save"), async (req, res) => {
    try {
      const body = req.body || {};
      const customerName = String(body.customerName || "").trim().slice(0, 160);
      const customerEmail = String(body.customerEmail || "").trim().slice(0, 254);
      const customerAddress = String(body.customerAddress || "").trim().slice(0, 300);
      const kvkNumber = String(body.kvkNumber || "").trim().slice(0, 30);
      const vatId = String(body.vatId || "").trim().slice(0, 40);
  
      if (
        !customerName ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail) ||
        !Array.isArray(body.lines) ||
        !body.lines.length ||
        body.lines.length > 80
      ) {
        return res.status(400).json({
          error: "Vul een klantnaam, geldig e-mailadres en factuurregels in."
        });
      }
  
      const lines = body.lines.map((item) => ({
        description: String(item.description || "").trim().slice(0, 240),
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        vatRate: Number(item.vatRate)
      }));
  
      const hasInvalidLine = lines.some((item) =>
        !item.description ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 999 ||
        !Number.isFinite(item.unitPrice) ||
        item.unitPrice < 0 ||
        item.unitPrice > 1000000 ||
        ![0, 9, 21].includes(item.vatRate)
      );
  
      if (hasInvalidLine) {
        return res.status(400).json({
          error: "Een factuurregel bevat ongeldige gegevens."
        });
      }
  
      const subtotal = lines.reduce(
        (sum, item) => sum + item.quantity * item.unitPrice,
        0
      );
      const vatTotal = lines.reduce(
        (sum, item) => sum + item.quantity * item.unitPrice * item.vatRate / 100,
        0
      );
      const total = subtotal + vatTotal;
      const temporaryInvoiceNumber =
        "HT-PENDING-" + Date.now() + "-" + Math.floor(Math.random() * 100000);
  
      const inserted = await pool.query(
        "INSERT INTO manual_invoices(invoice_number,customer_name,customer_email,customer_address,kvk_number,vat_id,lines,subtotal,vat_total,total) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10) RETURNING *",
        [
          temporaryInvoiceNumber,
          customerName,
          customerEmail,
          customerAddress,
          kvkNumber,
          vatId,
          JSON.stringify(lines),
          subtotal.toFixed(2),
          vatTotal.toFixed(2),
          total.toFixed(2)
        ]
      );
  
      const row = inserted.rows[0];
      const invoiceNumber =
        "HT-" + new Date(row.created_at).getFullYear() + "-" +
        String(row.id).padStart(6, "0");
  
      const updated = await pool.query(
        "UPDATE manual_invoices SET invoice_number=$2 WHERE id=$1 RETURNING *",
        [row.id, invoiceNumber]
      );
  
      res.status(201).json({
        invoice: {
          id: row.id,
          invoice_number: invoiceNumber,
          created_at: row.created_at,
          status: row.status,
          total: updated.rows[0].total
        }
      });
    } catch (error) {
      console.error("Invoice create:", error);
      res.status(500).json({ error: "Factuur opslaan is mislukt." });
    }
  });
  app.get("/api/admin/invoices/:id/pdf", requirePermission("site.save"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) {
        return res.status(400).json({ error: "Ongeldige factuur." });
      }
  
      const result = await pool.query(
        "SELECT * FROM manual_invoices WHERE id=$1",
        [id]
      );
      if (!result.rows.length) {
        return res.status(404).json({ error: "Factuur niet gevonden." });
      }
  
      const invoice = result.rows[0];
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        'inline; filename="' + invoice.invoice_number + '.pdf"'
      );
      res.send(buildInvoicePdf(invoice));
    } catch (error) {
      console.error("Invoice PDF:", error);
      res.status(500).json({ error: "PDF maken is mislukt." });
    }
  });
  app.post("/api/admin/invoices/:id/test-send", requirePermission("site.save"), async (req, res) => {
    try {
      const apiKey = getEnv().RESEND_API_KEY;
      const from = getEnv().RESEND_FROM_EMAIL;
  
      if (!apiKey) {
        return res.status(503).json({
          error: "E-mail is niet ingesteld: RESEND_API_KEY ontbreekt."
        });
      }
      if (!from || from === "onboarding@resend.dev") {
        return res.status(503).json({
          error: "Stel eerst een geverifieerd afzenderadres in via RESEND_FROM_EMAIL."
        });
      }
  
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) {
        return res.status(400).json({ error: "Ongeldige factuur." });
      }
  
      const result = await pool.query(
        "SELECT * FROM manual_invoices WHERE id=$1",
        [id]
      );
      if (!result.rows.length) {
        return res.status(404).json({ error: "Factuur niet gevonden." });
      }
  
      const invoice = result.rows[0];
      const pdf = buildInvoicePdf(invoice);
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from,
          to: [invoice.customer_email],
          subject: "HOMS TECH - factuur " + invoice.invoice_number,
          reply_to: "mail@inbound.homs-tech.nl",
          html:
            "<p>In de bijlage vindt u de factuur van HOMS TECH.</p>" +
            "<p><strong>Betalen per bankoverschrijving</strong><br>" +
            "Naam: Abdullrahman Nawaya<br>" +
            "IBAN: NL96 REVO 0480 6699 45<br>" +
            "Omschrijving: " + invoice.invoice_number + "</p>",
          attachments: [{
            filename: invoice.invoice_number + ".pdf",
            content: pdf.toString("base64")
          }]
        })
      });
  
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error(
          "Invoice test email provider error:",
          response.status,
          JSON.stringify(data)
        );
        return res.status(502).json({
          error: "E-mailprovider kon de testmail niet versturen. Controleer de e-mailinstellingen."
        });
      }
  
      res.json({ success: true, to: invoice.customer_email });
    } catch (error) {
      console.error("Invoice test send:", error);
      res.status(500).json({ error: "Testmail versturen is mislukt." });
    }
  });
}

module.exports = { registerAdminInvoiceRoutes };
