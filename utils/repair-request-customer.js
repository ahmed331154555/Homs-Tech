"use strict";

/**
 * Resolve a repair request to a customer only when the customer session is
 * valid and the submitted email belongs to that verified account.
 * Public form data alone must never be enough to attach a request to an account.
 */
async function resolveRepairRequestCustomerId({
  token,
  jwtSecret,
  verifyToken,
  findVerifiedCustomer,
  email
}) {
  const sessionToken = String(token || "").trim();
  const secret = String(jwtSecret || "").trim();
  const cleanEmail = String(email || "").trim().toLowerCase();

  if (!sessionToken || !secret || !cleanEmail ||
      typeof verifyToken !== "function" ||
      typeof findVerifiedCustomer !== "function") {
    return null;
  }

  let decoded;
  try {
    decoded = verifyToken(sessionToken, secret);
  } catch {
    return null;
  }

  if (!decoded?.customerId) return null;

  const customer = await findVerifiedCustomer(decoded.customerId, cleanEmail);
  return customer?.id ?? null;
}

module.exports = { resolveRepairRequestCustomerId };
