"use strict";

function roundInvoiceMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? Math.round((amount + Number.EPSILON) * 100) / 100
    : 0;
}

function registerAdminInvoiceRoutes(app, {
  pool,
  requirePermission,
  buildInvoicePdf,
  getEnv = () => process.env,
  fetchImpl = fetch
}) {
  const cleanSetting = (value, max = 220) => String(value || "").trim().slice(0, max);
  const allowedSellerFields = ["legalName","tradeName","address","postalCode","city","country","kvkNumber","vatId","iban","email","phone","website"];
  app.get("/api/admin/invoice-settings", requirePermission("site.save"), async (_req, res) => {
    try {
      const result = await pool.query("SELECT data FROM invoice_settings WHERE id=1");
      res.set("Cache-Control", "no-store");
      res.json({ settings: result.rows[0]?.data || {} });
    } catch (error) {
      console.error("Invoice settings load:", error);
      res.status(500).json({ error: "Factuurinstellingen laden is mislukt." });
    }
  });
  app.put("/api/admin/invoice-settings", requirePermission("site.save"), async (req, res) => {
    try {
      const body = req.body || {};
      const settings = {};
      for (const field of allowedSellerFields) settings[field] = cleanSetting(body[field], field === "address" ? 300 : 180);
      await pool.query(
        "INSERT INTO invoice_settings(id,data,updated_at) VALUES(1,$1::jsonb,NOW()) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()",
        [JSON.stringify(settings)]
      );
      res.json({ success: true, settings });
    } catch (error) {
      console.error("Invoice settings save:", error);
      res.status(500).json({ error: "Factuurinstellingen opslaan is mislukt." });
    }
  });
  app.get("/api/admin/invoices", requirePermission("site.save"), async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT id,invoice_number,customer_type,customer_name,customer_company_name,customer_email,subtotal,vat_total,total,status,payment_status,created_at FROM manual_invoices ORDER BY id DESC LIMIT 200"
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
      const customerType = body.customerType === "business" ? "business" : "individual";
      const customerName = String(body.customerName || body.customerCompanyName || "").trim().slice(0, 160);
      const customerCompanyName = String(body.customerCompanyName || "").trim().slice(0, 180);
      const customerContactPerson = String(body.customerContactPerson || "").trim().slice(0, 160);
      const customerPhone = String(body.customerPhone || "").trim().slice(0, 40);
      const customerEmail = String(body.customerEmail || "").trim().slice(0, 254);
      const customerAddress = String(body.customerAddress || "").trim().slice(0, 300);
      const customerPostalCode = String(body.customerPostalCode || "").trim().slice(0, 20);
      const customerCity = String(body.customerCity || "").trim().slice(0, 100);
      const customerCountry = String(body.customerCountry || "Nederland").trim().slice(0, 80);
      const customerKvkNumber = String(body.customerKvkNumber || "").trim().slice(0, 30);
      const customerVatId = String(body.customerVatId || "").trim().slice(0, 40);
      const paymentMethod = ["bank","cash","pin","online","other"].includes(body.paymentMethod) ? body.paymentMethod : "bank";
      const paymentStatus = ["unpaid","paid","partial"].includes(body.paymentStatus) ? body.paymentStatus : "unpaid";
      const dueDate = /^\\d{4}-\\d{2}-\\d{2}$/.test(String(body.dueDate || "")) ? body.dueDate : null;
      const deliveryDate = /^\\d{4}-\\d{2}-\\d{2}$/.test(String(body.deliveryDate || "")) ? body.deliveryDate : null;
      const reference = String(body.reference || "").trim().slice(0, 120);
      const notes = String(body.notes || "").trim().slice(0, 1200);

      if (!customerName || (customerEmail && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(customerEmail)) ||
        (customerType === "business" && !customerCompanyName) ||
        !Array.isArray(body.lines) || !body.lines.length || body.lines.length > 80) {
        return res.status(400).json({
          error: "Controleer de klantgegevens en voeg minimaal één geldige factuurregel toe."
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
  
      // Round each invoice line to cents before adding it to the document totals.
      // This avoids floating-point artifacts such as 0.1 * 3 becoming 0.30000000000000004.
      const totals = lines.reduce((sum, item) => {
        const lineSubtotal = roundInvoiceMoney(item.quantity * item.unitPrice);
        const lineVat = roundInvoiceMoney(lineSubtotal * item.vatRate / 100);
        sum.subtotal = roundInvoiceMoney(sum.subtotal + lineSubtotal);
        sum.vatTotal = roundInvoiceMoney(sum.vatTotal + lineVat);
        return sum;
      }, { subtotal: 0, vatTotal: 0 });
      const subtotal = totals.subtotal;
      const vatTotal = totals.vatTotal;
      const total = roundInvoiceMoney(subtotal + vatTotal);
      // Reserve the invoice ID from PostgreSQL's BIGSERIAL sequence first,
      // then create the final invoice number in the same INSERT. Updating the
      // same table from a data-modifying CTE can return zero rows in PostgreSQL.
      const sellerResult = await pool.query("SELECT data FROM invoice_settings WHERE id=1");
      const sellerSnapshot = sellerResult.rows[0]?.data || {};
      const saved = await pool.query(
        `WITH next_invoice AS (
          SELECT nextval(pg_get_serial_sequence('manual_invoices','id'))::bigint AS id
        )
        INSERT INTO manual_invoices(
          id,invoice_number,customer_name,customer_email,customer_address,
          kvk_number,vat_id,lines,subtotal,vat_total,total,customer_type,
          customer_company_name,customer_contact_person,customer_phone,customer_postal_code,
          customer_city,customer_country,customer_kvk_number,customer_vat_id,
          payment_method,payment_status,due_date,delivery_date,reference,notes,seller_snapshot
        )
        SELECT id,
          'HT-' || EXTRACT(YEAR FROM CURRENT_TIMESTAMP)::integer || '-' || LPAD(id::text,6,'0'),
          $1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9, $10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25::jsonb
        FROM next_invoice
        RETURNING id,invoice_number,created_at,status,total`,
        [
          customerName,customerEmail,customerAddress,
          sellerSnapshot.kvkNumber || "",sellerSnapshot.vatId || "",
          JSON.stringify(lines),subtotal.toFixed(2),vatTotal.toFixed(2),total.toFixed(2),
          customerType,customerCompanyName,customerContactPerson,customerPhone,customerPostalCode,
          customerCity,customerCountry,customerKvkNumber,customerVatId,
          paymentMethod,paymentStatus,dueDate,deliveryDate,reference,notes,JSON.stringify(sellerSnapshot)
        ]
      );
      const row = saved.rows[0];
      if (!row) throw new Error("Factuur is niet opgeslagen.");
  
      res.status(201).json({
        invoice: {
          id: row.id,
          invoice_number: row.invoice_number,
          created_at: row.created_at,
          status: row.status,
          total: row.total,
          customer_type: customerType
        }
      });
    } catch (error) {
      console.error("Invoice create:", { message: error.message, code: error.code, detail: error.detail, constraint: error.constraint });
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
      if (!invoice.customer_email) return res.status(400).json({ error: "Voor deze klant is geen e-mailadres opgeslagen." });
      const seller = invoice.seller_snapshot || {};
      if (!seller.legalName || !seller.address) {
        return res.status(409).json({ error: "Vul eerst de juridische bedrijfsnaam en het vestigingsadres in bij de factuurinstellingen voordat u de factuur verstuurt." });
      }
      if (invoice.payment_method === "bank" && !seller.iban) {
        return res.status(409).json({ error: "Vul eerst het IBAN in bij de factuurinstellingen of kies een andere betaalmethode." });
      }
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
            (invoice.seller_snapshot?.iban
              ? "<p><strong>Betalen per bankoverschrijving</strong><br>" +
                "Naam: " + cleanSetting(invoice.seller_snapshot.legalName || invoice.seller_snapshot.tradeName || "HOMS TECH", 180) +
                "<br>IBAN: " + cleanSetting(invoice.seller_snapshot.iban, 50) +
                "<br>Omschrijving: " + cleanSetting(invoice.invoice_number, 40) + "</p>"
              : "<p>De betaalgegevens staan vermeld op de factuur.</p>"),
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
  
      // The provider accepted the email. Update the archive status only
      // after successful delivery acceptance; do not report a failed send if
      // this secondary status write has a problem.
      let statusUpdated = true;
      try {
        await pool.query(
          "UPDATE manual_invoices SET status='sent' WHERE id=$1",
          [id]
        );
      } catch (statusError) {
        statusUpdated = false;
        console.error("Invoice sent but status update failed:", statusError);
      }
      res.json({
        success: true,
        to: invoice.customer_email,
        statusUpdated,
        ...(statusUpdated ? {} : { warning: "De e-mail is verzonden, maar de factuurstatus kon niet worden bijgewerkt." })
      });
    } catch (error) {
      console.error("Invoice test send:", error);
      res.status(500).json({ error: "Testmail versturen is mislukt." });
    }
  });
}

module.exports = { registerAdminInvoiceRoutes };
