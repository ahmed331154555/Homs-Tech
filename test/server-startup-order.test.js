"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("all API routes are registered before the HTTP server starts", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const startupIndex = source.indexOf("initializeDatabaseWithRetry(async () => {");
  assert.notEqual(startupIndex, -1, "database-backed server startup should be present");

  const routeRegistrations = [
    "registerAnnouncementBarRoutes(app",
    "registerContactRoutes(app",
    "registerDeviceRegisterRoutes(app",
    "registerCustomerAuthRoutes(app",
    "registerRepairOrderRoutes(app",
    "registerWebshopCheckoutRoutes(app",
    "registerPaymentRoutes(app",
    "registerAdminWebshopOrderRoutes(app",
    "registerRepairQuoteRoutes(app",
    "registerAdminOrderRoutes(app",
    "registerAdminBuybackOrderRoutes(app",
    "registerAdminInvoiceRoutes(app",
    "registerAdminEmailRoutes(app",
    "registerAdminCustomerRoutes(app",
    "registerBuybackRoutes(app",
    "registerLiveChatRoutes(app",
    "registerAdminUserRoutes(app"
  ];

  for (const registration of routeRegistrations) {
    const index = source.indexOf(registration);
    assert.notEqual(index, -1, `missing route registration: ${registration}`);
    assert.ok(index < startupIndex, `${registration} must run before the server starts`);
  }
});
