"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const adminHtml = fs.readFileSync(
  path.resolve(__dirname, "../admin/index.html"),
  "utf8",
);
const layoutCss = fs.readFileSync(
  path.resolve(__dirname, "../assets/admin-mobile-layout.css"),
  "utf8",
);

test("admin page loads the centralized responsive layout after the design system", () => {
  const tactileIndex = adminHtml.indexOf("assets/tactile-ui.css");
  const layoutIndex = adminHtml.indexOf("assets/admin-mobile-layout.css");

  assert.ok(tactileIndex >= 0);
  assert.ok(layoutIndex > tactileIndex);
  assert.doesNotMatch(adminHtml, /homs-admin-mobile-navigation/);
  assert.match(
    adminHtml,
    /if\(event\.target===event\.currentTarget\)closeAdminMenu\(\)/,
  );
  assert.match(adminHtml, /event\.key===\"Escape\"/);
});

test("mobile navigation is a full-height overlay with an independently scrollable panel", () => {
  assert.match(
    layoutCss,
    /#adminNav\s*\{[^}]*position:\s*fixed\s*!important/s,
  );
  assert.match(layoutCss, /#adminNav\s*\{[^}]*inset:\s*0\s*!important/s);
  assert.match(layoutCss, /height:\s*100dvh\s*!important/);
  assert.match(
    layoutCss,
    /#adminNav \.admin-nav-inner\s*\{[^}]*overflow-y:\s*auto/s,
  );
  assert.match(layoutCss, /#adminNav \.admin-nav-heading strong/);
  assert.match(layoutCss, /#adminNav \.admin-nav-inner\s*\{[^}]*touch-action:\s*pan-y/s);
  assert.doesNotMatch(layoutCss.match(/body\.admin-menu-open\s*\{[^}]*\}/s)?.[0] || "", /touch-action:\s*none/);
});

test("mobile save bar reserves enough scroll space for the final dashboard content", () => {
  assert.match(
    layoutCss,
    /\.save-bar\s*\{[^}]*position:\s*fixed\s*!important/s,
  );
  assert.match(
    layoutCss,
    /#dashboard > \.container\s*\{[^}]*padding-bottom:\s*calc\(156px/s,
  );
  assert.match(layoutCss, /--ht-admin-layer-save:\s*20/);
});

test("phone bulk pricing table keeps mobile headers readable and numeric inputs tappable", () => {
  assert.match(
    layoutCss,
    /#phonesList table\s*\{[^}]*min-width:\s*720px/s,
  );
  assert.match(layoutCss, /#phonesList table th:nth-child\(1\)/);
  assert.match(layoutCss, /#phonesList table th:nth-child\(5\)/);
  assert.match(
    layoutCss,
    /#phonesList table input\[type="number"\]\s*\{[^}]*min-height:\s*42px/s,
  );
  assert.match(layoutCss, /overflow-x:\s*auto\s*!important/);
});

test("mobile dialogs use a bounded viewport and their own scrolling layer", () => {
  assert.match(
    layoutCss,
    /\.modal-backdrop,\s*\.customer-modal-backdrop\s*\{[^}]*--ht-admin-layer-modal/s,
  );
  assert.match(layoutCss, /max-height:\s*calc\(100dvh - 24px\)/);
  assert.match(layoutCss, /\.modal-backdrop \.modal\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(layoutCss, /overflow-y:\s*auto/);
  assert.match(
    layoutCss,
    /#page-buyback-orders \.ht-inkoop-detail-host:not\(\[hidden\]\),/,
  );
  assert.match(
    layoutCss,
    /body\.phone-orders-page-active \.save-bar\s*\{[^}]*--ht-admin-layer-save/s,
  );
});

test("refund dialog uses the shared mobile modal layer and bounded scrolling", () => {
  assert.match(layoutCss, /\.ht-refund-overlay\s*\{[^}]*--ht-admin-layer-dialog/s);
  assert.match(layoutCss, /\.ht-refund-overlay > section\s*\{[^}]*max-height:\s*calc\(100dvh - 24px\)/s);
  assert.match(layoutCss, /\.ht-refund-overlay > section\s*\{[^}]*overflow-y:\s*auto/s);
});

test("availability column keeps a readable minimum width", () => {
  assert.match(layoutCss, /#phonesList table th:last-child/);
});

test("desktop layout is not overridden by the mobile-only layout rules", () => {
  assert.match(layoutCss, /@media \(max-width: 760px\)/);
  assert.match(layoutCss, /@media \(max-width: 420px\)/);
});
