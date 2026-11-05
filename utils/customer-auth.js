"use strict";

function createCustomerAuth({ jwt, getJwtSecret }) {
  if (!jwt || typeof jwt.verify !== "function" || typeof getJwtSecret !== "function") {
    throw new TypeError("JWT verifier and secret provider are required.");
  }

  function requireCustomerAuth(req, res, next) {
    try {
      const token = req.cookies.customerToken;
      if (!token) {
        return res.status(401).json({ error: "Niet ingelogd" });
      }
      const decoded = jwt.verify(token, getJwtSecret());
      req.customerId = decoded.customerId;
      return next();
    } catch (error) {
      return res.status(401).json({ error: "Niet ingelogd" });
    }
  }

  return { requireCustomerAuth };
}

module.exports = { createCustomerAuth };
