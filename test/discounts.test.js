"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeDiscount,
  isDiscountActive,
  applyDiscount,
  findProductDiscount,
} = require("../utils/discounts");

const base = {
  id: "sale-1",
  name: "Voorjaarsactie",
  type: "percent",
  scope: "product",
  productId: "case-1",
  value: 10,
  startsAt: "2026-11-01T00:00:00.000Z",
  endsAt: "2026-12-01T00:00:00.000Z",
  active: true,
};

test("normalizes valid product discount", () => {
  const value = normalizeDiscount(base);
  assert.equal(value.value, 10);
  assert.equal(value.scope, "product");
  assert.equal(value.productId, "case-1");
});

test("rejects percentages above 100 and invalid dates", () => {
  assert.throws(() => normalizeDiscount({ ...base, value: 101 }));
  assert.throws(() => normalizeDiscount({ ...base, endsAt: "invalid" }));
});

test("respects start, end and usage limit", () => {
  const discount = normalizeDiscount({ ...base, usageLimit: 1, usageCount: 1 });
  assert.equal(
    isDiscountActive(discount, new Date("2026-11-21T12:00:00Z")),
    false,
  );
  assert.equal(
    isDiscountActive(discount, new Date("2026-10-31T23:59:00Z")),
    false,
  );
  assert.equal(
    isDiscountActive(discount, new Date("2026-12-01T00:00:00Z")),
    false,
  );
});

test("applies fixed and percentage discounts without negative totals", () => {
  assert.equal(applyDiscount(100, { type: "percent", value: 10 }), 90);
  assert.equal(applyDiscount(50, { type: "fixed", value: 75 }), 0);
});

test("chooses the strongest eligible product or store-wide discount", () => {
  const discounts = [
    normalizeDiscount(base),
    normalizeDiscount({
      ...base,
      id: "sale-2",
      scope: "all",
      productId: "",
      value: 15,
    }),
    normalizeDiscount({ ...base, id: "sale-3", productId: "other", value: 50 }),
  ];
  assert.equal(
    findProductDiscount(discounts, "case-1", new Date("2026-11-21T12:00:00Z"))
      .id,
    "sale-2",
  );
});
