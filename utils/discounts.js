"use strict";

const MAX_DISCOUNTS = 500;

function normalizeDiscount(raw, now = new Date()) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Ongeldige korting.");
  }
  const id = String(raw.id || "").trim();
  const type =
    raw.type === "fixed" ? "fixed" : raw.type === "percent" ? "percent" : "";
  const scope =
    raw.scope === "all" ? "all" : raw.scope === "product" ? "product" : "";
  const value = Number(raw.value);
  const startsAt = new Date(raw.startsAt);
  const endsAt = new Date(raw.endsAt);
  if (!id || id.length > 80) throw new Error("Korting heeft een ongeldige ID.");
  if (!type || !scope)
    throw new Error("Kies een geldig kortingstype en toepassingsgebied.");
  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    (type === "percent" && value > 100)
  ) {
    throw new Error("De kortingswaarde is ongeldig.");
  }
  if (
    !Number.isFinite(startsAt.getTime()) ||
    !Number.isFinite(endsAt.getTime()) ||
    endsAt <= startsAt
  ) {
    throw new Error("Controleer de begin- en einddatum.");
  }
  const productId =
    scope === "product" ? String(raw.productId || "").trim() : "";
  if (scope === "product" && !productId)
    throw new Error("Kies een product voor deze korting.");
  const usageLimit =
    raw.usageLimit === "" || raw.usageLimit == null
      ? null
      : Number(raw.usageLimit);
  if (
    usageLimit !== null &&
    (!Number.isInteger(usageLimit) || usageLimit < 1)
  ) {
    throw new Error("De gebruikslimiet moet een positief geheel getal zijn.");
  }
  return {
    id,
    name: String(raw.name || "")
      .trim()
      .slice(0, 120),
    type,
    scope,
    productId,
    value: Math.round(value * 100) / 100,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    usageLimit,
    usageCount: Math.max(
      0,
      Number.isInteger(Number(raw.usageCount)) ? Number(raw.usageCount) : 0,
    ),
    active: raw.active !== false,
    createdAt: raw.createdAt || now.toISOString(),
  };
}

function isDiscountActive(discount, now = new Date()) {
  if (!discount || discount.active === false) return false;
  const time = now.getTime();
  return (
    time >= new Date(discount.startsAt).getTime() &&
    time < new Date(discount.endsAt).getTime() &&
    (discount.usageLimit == null || discount.usageCount < discount.usageLimit)
  );
}

function applyDiscount(price, discount) {
  const amount = Number(price);
  if (!Number.isFinite(amount) || amount < 0 || !discount) return amount;
  const reduction =
    discount.type === "percent"
      ? (amount * discount.value) / 100
      : discount.value;
  return Math.round(Math.max(0, amount - reduction) * 100) / 100;
}

function findProductDiscount(discounts, productId, now = new Date()) {
  return (
    (Array.isArray(discounts) ? discounts : [])
      .filter(
        (d) =>
          isDiscountActive(d, now) &&
          (d.scope === "all" || String(d.productId) === String(productId)),
      )
      .sort((a, b) => {
        const aPrice = applyDiscount(100, a);
        const bPrice = applyDiscount(100, b);
        return aPrice - bPrice;
      })[0] || null
  );
}

module.exports = {
  normalizeDiscount,
  isDiscountActive,
  applyDiscount,
  findProductDiscount,
};
