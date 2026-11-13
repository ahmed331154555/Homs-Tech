"use strict";

const PAGE = Object.freeze({ width: 595, height: 842 });
const COLORS = Object.freeze({
  navy: [0.04, 0.11, 0.19],
  green: [0.14, 0.83, 0.40],
  ink: [0.12, 0.16, 0.23],
  muted: [0.38, 0.43, 0.50],
  pale: [0.95, 0.97, 0.98],
  line: [0.87, 0.90, 0.93],
  white: [1, 1, 1]
});
const ITEMS_PER_PAGE = 10;

function invoicePdfEscape(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function buildInvoicePdf(invoice = {}) {
  const pages = [];
  let commands = [];

  const color = values => values.map(value => Number(value).toFixed(3)).join(" ");
  const fillRect = (x, y, width, height, fill) => {
    commands.push(color(fill) + " rg " + x + " " + y + " " + width + " " + height + " re f");
  };
  const drawLine = (x1, y1, x2, y2, stroke = COLORS.line) => {
    commands.push(color(stroke) + " RG 0.7 w " + x1 + " " + y1 + " m " + x2 + " " + y2 + " l S");
  };
  const text = (x, y, value, size = 10, font = "F1", fill = COLORS.ink) => {
    commands.push(
      "BT /" + font + " " + size + " Tf " + color(fill) +
      " rg 1 0 0 1 " + x + " " + y + " Tm (" + invoicePdfEscape(value) + ") Tj ET"
    );
  };
  const money = value => "EUR " + Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const formatDate = value => {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("nl-NL");
  };

  // Compact vector mark: phone outline, repair tools and green orbit.
  // Drawing it directly keeps the logo sharp in every PDF viewer.
  const drawBrandLogo = () => {
    commands.push(
      "1.000 1.000 1.000 RG 2.2 w " +
      "q 1 0 0 1 43 758 cm " +
      "10 0 m 2 0 0 2 0 10 c 0 25 l " +
      "0 2 2 2 2 2 c 28 27 l " +
      "2 0 2 0 2 2 c 2 25 l " +
      "0 2 -2 2 -2 2 c 10 27 l " +
      "0 0 -2 0 -2 -2 c S Q"
    );
    commands.push("1.000 1.000 1.000 RG 1.5 w 51 780 m 65 780 l S");
    commands.push("1.000 1.000 1.000 RG 1.5 w 51 762 m 65 762 l S");
    commands.push(color(COLORS.green) + " RG 2.8 w 39 765 m 50 758 65 759 76 771 c S");
    commands.push(color(COLORS.green) + " RG 2.0 w 58 766 m 69 780 l S");
    commands.push(color(COLORS.green) + " RG 2.0 w 55 769 m 60 764 l S");

    text(88, 790, "HOMS", 23, "F2", COLORS.white);
    text(158, 790, "TECH", 23, "F2", COLORS.green);
    text(89, 771, "PHONE REPAIR  |  REFURBISHED DEVICES", 7.5, "F1", [0.82, 0.87, 0.92]);
  };

  const items = Array.isArray(invoice.lines) ? invoice.lines : [];
  const seller = invoice.seller_snapshot && typeof invoice.seller_snapshot === "object"
    ? invoice.seller_snapshot
    : {};
  const customerType = invoice.customer_type === "business"
    ? "Zakelijke klant"
    : "Particuliere klant";
  const customerName = invoice.customer_type === "business"
    ? (invoice.customer_company_name || invoice.customer_name || "-")
    : (invoice.customer_name || "-");
  const sellerName = seller.legalName || seller.tradeName || "HOMS TECH";
  const sellerAddress = [seller.address, seller.postalCode, seller.city, seller.country]
    .filter(Boolean).join(", ");
  const customerAddress = [
    invoice.customer_address,
    invoice.customer_postal_code,
    invoice.customer_city,
    invoice.customer_country
  ].filter(Boolean).join(", ");
  const paymentMethods = {
    bank: "Bankoverschrijving",
    cash: "Contant",
    pin: "Pin",
    online: "Online",
    other: "Anders"
  };
  const paymentStatuses = {
    unpaid: "Niet betaald",
    paid: "Betaald",
    partial: "Gedeeltelijk betaald"
  };
  const invoiceDate = formatDate(invoice.created_at);
  const dueDate = formatDate(invoice.due_date);
  const pageCount = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    commands = [];

    // Branded header and document metadata.
    fillRect(0, 720, PAGE.width, 122, COLORS.navy);
    fillRect(0, 716, PAGE.width, 4, COLORS.green);
    drawBrandLogo();

    text(420, 793, "FACTUURNUMMER", 7, "F2", [0.70, 0.78, 0.85]);
    text(420, 775, String(invoice.invoice_number || "-"), 10, "F2", COLORS.white);
    text(420, 752, "DATUM  " + invoiceDate, 8, "F1", [0.90, 0.93, 0.96]);
    if (dueDate) {
      text(420, 737, "VERVALDATUM  " + dueDate, 7, "F1", [0.90, 0.93, 0.96]);
    }
    text(42, 744, "FACTUUR", 16, "F2", COLORS.white);

    // Customer information.
    text(42, 681, "FACTUUR AAN · " + customerType.toUpperCase(), 8, "F2", COLORS.muted);
    text(42, 658, String(customerName).slice(0, 48), 12, "F2", COLORS.ink);
    let customerY = 640;

    const customerDetails = [
      customerAddress,
      invoice.customer_email,
      invoice.customer_phone ? "Tel: " + invoice.customer_phone : "",
      invoice.customer_kvk_number ? "KVK: " + invoice.customer_kvk_number : "",
      invoice.customer_vat_id ? "BTW-ID: " + invoice.customer_vat_id : ""
    ].filter(Boolean);

    if (invoice.customer_type === "business" && invoice.customer_contact_person) {
      customerDetails.unshift("Contact: " + invoice.customer_contact_person);
    }
    for (const detail of customerDetails) {
      text(42, customerY, String(detail).slice(0, 64), 8, "F1", COLORS.muted);
      customerY -= 14;
    }

    // Seller details remain separate from the customer's information.
    text(340, 681, "GEGEVENS LEVERANCIER", 8, "F2", COLORS.muted);
    text(340, 658, String(sellerName).slice(0, 38), 11, "F2", COLORS.ink);
    let sellerY = 640;
    const sellerDetails = [
      sellerAddress,
      seller.kvkNumber ? "KVK: " + seller.kvkNumber : "",
      seller.vatId ? "BTW-ID: " + seller.vatId : "",
      seller.email,
      seller.phone,
      seller.website
    ].filter(Boolean);

    for (const detail of sellerDetails) {
      text(340, sellerY, String(detail).slice(0, 42), 8, "F1", COLORS.muted);
      sellerY -= 14;
    }

    // Invoice line items.
    const tableTop = pageIndex === 0 ? 510 : 590;
    fillRect(42, tableTop - 8, 511, 25, COLORS.pale);
    text(51, tableTop, "OMSCHRIJVING", 8, "F2", COLORS.muted);
    text(333, tableTop, "AANTAL", 8, "F2", COLORS.muted);
    text(392, tableTop, "PRIJS", 8, "F2", COLORS.muted);
    text(465, tableTop, "BTW", 8, "F2", COLORS.muted);
    text(510, tableTop, "TOTAAL", 8, "F2", COLORS.muted);

    let rowY = tableTop - 29;
    const pageItems = items.slice(
      pageIndex * ITEMS_PER_PAGE,
      (pageIndex + 1) * ITEMS_PER_PAGE
    );

    pageItems.forEach((item, itemIndex) => {
      const quantity = Number(item.quantity) || 0;
      const unitPrice = Number(item.unitPrice) || 0;
      const vatRate = Number(item.vatRate) || 0;

      if (itemIndex % 2 === 1) {
        fillRect(42, rowY - 7, 511, 23, [0.985, 0.988, 0.992]);
      }

      text(51, rowY, String(item.description || "").slice(0, 42), 9, "F1", COLORS.ink);
      text(341, rowY, String(quantity), 9, "F1", COLORS.ink);
      text(389, rowY, money(unitPrice), 8, "F1", COLORS.ink);
      text(469, rowY, String(vatRate) + "%", 8, "F1", COLORS.ink);
      text(505, rowY, money(quantity * unitPrice * (1 + vatRate / 100)), 8, "F2", COLORS.ink);
      drawLine(42, rowY - 10, 553, rowY - 10);
      rowY -= 25;
    });

    // Totals and payment information are shown on the final page only.
    if (pageIndex === pageCount - 1) {
      const totalsY = Math.min(rowY - 10, 230);
      drawLine(330, totalsY + 6, 553, totalsY + 6, [0.80, 0.84, 0.88]);
      text(355, totalsY - 14, "Subtotaal excl. BTW", 9, "F1", COLORS.muted);
      text(470, totalsY - 14, money(invoice.subtotal), 9, "F1", COLORS.ink);
      text(355, totalsY - 34, "BTW", 9, "F1", COLORS.muted);
      text(470, totalsY - 34, money(invoice.vat_total), 9, "F1", COLORS.ink);

      fillRect(330, totalsY - 68, 223, 25, COLORS.navy);
      text(343, totalsY - 59, "TOTAAL", 10, "F2", COLORS.white);
      text(450, totalsY - 59, money(invoice.total), 10, "F2", COLORS.white);

      fillRect(42, 76, 511, 66, COLORS.pale);
      fillRect(42, 76, 4, 66, COLORS.green);
      text(55, 125, "BETALING & ADMINISTRATIE", 8, "F2", COLORS.navy);
      text(
        55, 108,
        "Betaalmethode: " + (paymentMethods[invoice.payment_method] || "Bankoverschrijving"),
        8, "F1", COLORS.ink
      );
      text(
        55, 92,
        "Status: " + (paymentStatuses[invoice.payment_status] || "Niet betaald"),
        8, "F1", COLORS.ink
      );

      if (seller.iban) {
        text(300, 108, "IBAN: " + String(seller.iban).slice(0, 34), 8, "F2", COLORS.ink);
      }
      if (dueDate) {
        text(300, 92, "Vervaldatum: " + dueDate, 8, "F1", COLORS.ink);
      }
      text(
        55, 80,
        "Referentie: " + String(invoice.reference || invoice.invoice_number || "").slice(0, 36),
        7, "F1", COLORS.muted
      );
    }

    drawLine(42, 48, 553, 48, [0.84, 0.87, 0.90]);
    text(42, 32, "HOMS TECH  |  Bedankt voor uw vertrouwen.", 8, "F1", COLORS.muted);
    text(470, 32, "Pagina " + (pageIndex + 1) + " / " + pageCount, 8, "F1", COLORS.muted);
    pages.push(commands.join("\n"));
  }

  // Assemble a standards-compliant PDF with shared Helvetica font resources.
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    null
  ];
  const pageReferences = pages.map((_, index) => (3 + index * 2) + " 0 R").join(" ");
  objects[1] = "<< /Type /Pages /Kids [" + pageReferences + "] /Count " + pages.length + " >>";

  pages.forEach((stream, index) => {
    const pageObject = 3 + index * 2;
    const streamObject = pageObject + 1;

    objects.push(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " +
      PAGE.width + " " + PAGE.height + "] " +
      "/Resources << /Font << " +
      "/F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> " +
      "/F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> " +
      ">> >> /Contents " + streamObject + " 0 R >>"
    );
    objects.push(
      "<< /Length " + Buffer.byteLength(stream, "latin1") +
      " >>\nstream\n" + stream + "\nendstream"
    );
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += (index + 1) + " 0 obj\n" + object + "\nendobj\n";
  });

  const crossReferenceOffset = Buffer.byteLength(pdf, "latin1");
  pdf += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += String(offsets[index]).padStart(10, "0") + " 00000 n \n";
  }
  pdf +=
    "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\n" +
    "startxref\n" + crossReferenceOffset + "\n%%EOF";

  return Buffer.from(pdf, "latin1");
}

module.exports = { invoicePdfEscape, buildInvoicePdf };
