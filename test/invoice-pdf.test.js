"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { invoicePdfEscape, buildInvoicePdf } = require("../utils/invoice-pdf");

test("invoicePdfEscape escapes PDF string delimiters and backslashes", () => {
  assert.equal(invoicePdfEscape("A (test) \\ file"), "A \\(test\\) \\\\ file");
});

test("invoicePdfEscape replaces unsupported characters after NFKD normalization", () => {
  assert.equal(invoicePdfEscape("café"), "cafe?");
  assert.equal(invoicePdfEscape("Phone 📱"), "Phone ??");
});

test("invoicePdfEscape safely converts nullish and numeric values", () => {
  assert.equal(invoicePdfEscape(null), "");
  assert.equal(invoicePdfEscape(undefined), "");
  assert.equal(invoicePdfEscape(123), "123");
});


test("buildInvoicePdf creates a valid PDF document with invoice details", () => {
  const pdf = buildInvoicePdf({
    invoice_number: "HT-2026-001",
    created_at: "2026-11-05T12:00:00Z",
    customer_name: "Customer Example",
    customer_address: "Main Street 1",
    customer_email: "customer@example.test",
    subtotal: 100,
    vat_total: 21,
    total: 121,
    lines: [{ description: "Screen repair", quantity: 1, unitPrice: 100, vatRate: 21 }]
  });
  const source = pdf.toString("latin1");
  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(source.startsWith("%PDF-1.4"));
  assert.ok(source.endsWith("%%EOF"));
  assert.match(source, /HT-2026-001/);
  assert.match(source, /Customer Example/);
  assert.match(source, /Screen repair/);
  assert.match(source, /TOTAAL/);
});

test("buildInvoicePdf paginates invoice lines in groups of eleven", () => {
  const lines = Array.from({ length: 12 }, (_, index) => ({
    description: "Item " + (index + 1),
    quantity: 1,
    unitPrice: 10,
    vatRate: 21
  }));
  const pdf = buildInvoicePdf({
    invoice_number: "HT-MULTI",
    created_at: "2026-11-05T12:00:00Z",
    customer_name: "Customer",
    subtotal: 120,
    vat_total: 25.2,
    total: 145.2,
    lines
  }).toString("latin1");
  assert.equal((pdf.match(/\/Type \/Page /g) || []).length, 2);
  assert.match(pdf, /Pagina 1 \/ 2/);
  assert.match(pdf, /Pagina 2 \/ 2/);
  assert.match(pdf, /Item 12/);
});

test("buildInvoicePdf escapes customer-controlled PDF text", () => {
  const pdf = buildInvoicePdf({
    invoice_number: "HT-(A)\\B",
    created_at: "2026-11-05T12:00:00Z",
    customer_name: "Test (Customer)\\Name",
    subtotal: 1,
    vat_total: 0,
    total: 1,
    lines: []
  }).toString("latin1");
  assert.ok(pdf.includes("HT-\\(A\\)\\\\B"));
  assert.ok(pdf.includes("Test \\(Customer\\)\\\\Name"));
});

test("buildInvoicePdf prints separate company customer and seller profile details", () => {
  const pdf = buildInvoicePdf({
    invoice_number: "HT-2026-009999",
    created_at: "2026-11-05T12:00:00Z",
    customer_type: "business",
    customer_name: "Example BV",
    customer_company_name: "Example BV",
    customer_contact_person: "Jane Example",
    customer_address: "Main Street 1",
    customer_postal_code: "3011AA",
    customer_city: "Rotterdam",
    customer_country: "Nederland",
    customer_email: "finance@example.test",
    customer_phone: "+31101234567",
    customer_kvk_number: "12345678",
    customer_vat_id: "NL123456789B01",
    seller_snapshot: {
      legalName: "Example HOMS TECH BV",
      tradeName: "HOMS TECH",
      address: "Repair Street 2",
      postalCode: "3012BB",
      city: "Rotterdam",
      country: "Nederland",
      kvkNumber: "87654321",
      vatId: "NL987654321B01",
      iban: "NL00TEST",
      website: "https://homs-tech.nl"
    },
    payment_method: "bank",
    payment_status: "unpaid",
    due_date: "2026-11-30",
    subtotal: 100,
    vat_total: 21,
    total: 121,
    lines: [{ description: "Screen repair", quantity: 1, unitPrice: 100, vatRate: 21 }]
  }).toString("latin1");
  for (const value of ["Example BV","Jane Example","NL123456789B01","Example HOMS TECH BV","87654321","NL00TEST","Vervaldatum"]) {
    assert.ok(pdf.includes(value), "PDF should contain " + value);
  }
});
