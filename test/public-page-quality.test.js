"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const readPage = name => fs.readFileSync(path.join(root, name), "utf8");

function cssBraceBalance(css) {
  // Remove comments and quoted strings so braces in text values do not count.
  const source = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
  let depth = 0;
  for (const char of source) {
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth < 0) return depth;
  }
  return depth;
}

test("all public page inline stylesheets have balanced CSS blocks", () => {
  const pages = fs.readdirSync(root).filter(name => name.endsWith(".html"));
  assert.ok(pages.length >= 10, "expected the public HTML pages to be present");
  let checkedBlocks = 0;
  for (const page of pages) {
    const html = readPage(page);
    const blocks = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)];
    for (let index = 0; index < blocks.length; index += 1) {
      checkedBlocks += 1;
      assert.equal(cssBraceBalance(blocks[index][1]), 0, page + " style block " + (index + 1) + " has unbalanced braces");
    }
  }
  assert.ok(checkedBlocks > 0, "expected inline CSS blocks to be checked");
});
test("shop uses the shared HOMS TECH theme and a canonical URL", () => {
  const html = readPage("shop.html");
  assert.match(html, /assets\/homs-tech-modern-true-theme\.css/);
  assert.match(html, /<link\b[^>]*rel=["']canonical["'][^>]*href=["']https:\/\/homs-tech\.nl\/shop\.html["']/i);
});

test("cart and checkout are excluded from search indexing", () => {
  for (const page of ["cart.html", "checkout.html"]) {
    assert.match(readPage(page), /<meta\b[^>]*name=["']robots["'][^>]*content=["']noindex,nofollow["']/i, page + " should not be indexed");
  }
});

test("product page has a useful search description", () => {
  assert.match(readPage("product.html"), /<meta\b[^>]*name=["']description["'][^>]*content=["'][^"']{40,}["']/i);
});

test("account and payment pages are excluded from search indexing", () => {
  for (const page of ["account.html", "payment.html"]) {
    assert.match(readPage(page), /<meta\b[^>]*name=["']robots["'][^>]*content=["']noindex,nofollow["']/i, page + " should not be indexed");
  }
});

test("contact page has a canonical URL", () => {
  assert.match(readPage("contact.html"), /<link\b[^>]*rel=["']canonical["'][^>]*href=["']https:\/\/homs-tech\.nl\/contact\.html["']/i);
});


test("global navigation is grouped into clear customer journeys", () => {
  const nav = fs.readFileSync(path.join(root, "assets/homs-global-nav.js"), "utf8");
  for (const label of ["Start", "Winkel", "Service", "Account"]) assert.ok(nav.includes("label:'" + label + "'"), "missing navigation group " + label);
  for (const page of ["contact.html", "devices.html", "shop.html", "repair.html", "prices.html", "uw-toestel-verkopen.html", "cart.html", "account.html"]) {
    assert.ok(nav.includes("'" + page + "'"), "missing navigation destination " + page);
  }
});

test("sitemap contains only existing, public canonical pages", () => {
  const xml = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  const urls = [...xml.matchAll(/<loc>https:\/\/homs-tech\.nl\/([^<]*)<\/loc>/g)].map(match => match[1]);
  assert.ok(urls.includes("shop.html"));
  assert.ok(urls.includes("contact.html"));
  assert.ok(!urls.includes("used.html"), "removed page must not stay in sitemap");
  assert.ok(!urls.includes("product.html"), "dynamic product template is not a standalone canonical page");
  for (const url of urls) {
    const page = url || "index.html";
    assert.ok(fs.existsSync(path.join(root, page)), "sitemap points to missing page " + page);
  }
});

test("robots.txt excludes admin, API and transactional response pages", () => {
  const robots = fs.readFileSync(path.join(root, "robots.txt"), "utf8");
  for (const route of ["/admin/", "/api/", "/checkout.html", "/cart.html", "/payment.html", "/buyback-response.html", "/trade-in-response.html"]) {
    assert.ok(robots.includes("Disallow: " + route), "robots.txt should exclude " + route);
  }
  assert.match(robots, /Sitemap:\s+https:\/\/homs-tech\.nl\/sitemap\.xml/);
});

test("product metadata updates dynamically for the selected product", () => {
  const html = readPage("product.html");
  assert.match(html, /function updateProductMetadata\(product\)/);
  assert.match(html, /productCanonical/);
  assert.match(html, /canonical\.searchParams\.set\("id",String\(currentProductId\)\)/);
  assert.match(html, /updateProductMetadata\(product\)/);
  assert.match(html, /currentProductId=record\.i;\s*updateProductMetadata\(record\.p\)/);
});

test("shop and product SEO head markup contains no escaped newline text", () => {
  for (const page of ["shop.html", "product.html"]) {
    const head = readPage(page).split("</head>")[0];
    assert.ok(!head.includes("\\n<meta"), page + " contains a literal escaped newline in its head");
  }
});


test("customer-facing pages share the standard footer and privacy link", () => {
  for (const page of ["about.html", "devices.html", "prices.html", "repair.html", "product.html", "shop.html", "contact.html", "privacybeleid.html", "account.html", "cart.html", "checkout.html"]) {
    const html = readPage(page);
    assert.match(html, /<footer\b[^>]*class=["']ht-site-footer["']/i, page + " should use the shared footer");
    assert.match(html, /href=["']privacybeleid\.html["']/i, page + " should link to the privacy policy");
  }
});

test("contact page includes shared layout, brand theme and customer chat", () => {
  const html = readPage("contact.html");
  assert.match(html, /homs-tech-modern-true-theme\.css/);
  assert.match(html, /homs-layout-system\.css/);
  assert.match(html, /homs-ai-chat\.js/);
});

test("admin order categories preserve their distinct business purposes", () => {
  const admin = fs.readFileSync(path.join(root, "assets/homs-admin.js"), "utf8");
  for (const key of ["phone-orders", "webshop-orders", "buyback-orders", "repair-requests"]) {
    assert.ok(admin.includes('key:"' + key + '"'), "missing order category " + key);
  }
});


test("every HTML page has a language, viewport and document title", () => {
  const pages = fs.readdirSync(root).filter(name => name.endsWith(".html"));
  for (const page of pages) {
    const html = readPage(page);
    assert.match(html, /<html\b[^>]*\blang=["'][a-z]{2}(?:-[A-Z]{2})?["']/i, page + " needs a document language");
    assert.match(html, /<meta\b[^>]*name=["']viewport["']/i, page + " needs a responsive viewport");
    assert.match(html, /<title\b[^>]*>[\s\S]*?\S[\s\S]*?<\/title>/i, page + " needs a meaningful title");
  }
});

test("all static image elements provide alternative text", () => {
  const pages = fs.readdirSync(root).filter(name => name.endsWith(".html"));
  for (const page of pages) {
    const html = readPage(page);
    const images = [...html.matchAll(/<img\b[^>]*>/gi)];
    for (const image of images) {
      assert.match(image[0], /\balt=["'][^"']*["']/i, page + " contains an image without alt text");
    }
  }
});

test("shared layout provides accessible focus, reduced-motion and responsive form safeguards", () => {
  const css = fs.readFileSync(path.join(root, "assets/homs-layout-system.css"), "utf8");
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /max-width:\s*100%/);
  assert.match(css, /cursor:\s*not-allowed/);
});

test("global navigation keeps a visible keyboard focus indicator", () => {
  const css = fs.readFileSync(path.join(root, "assets/homs-global-nav.css"), "utf8");
  assert.match(css, /\.homs-global-nav-inner a:focus-visible\s*\{[^}]*outline:\s*3px solid/i);
  assert.doesNotMatch(css, /\.homs-global-nav-inner a:focus-visible[\s\S]{0,180}outline:\s*none/i);
});

test("customer purchase, repair and phone-selling pages share the HOMS TECH theme", () => {
  for (const page of ["product.html", "repair.html", "uw-toestel-verkopen.html", "shop.html", "contact.html"]) {
    const html = readPage(page);
    assert.match(html, /assets\/homs-tech-modern-true-theme\.css/i, page + " should load the shared brand theme");
  }
});

test("phone-selling page loads shared theme before interactive page scripts", () => {
  const html = readPage("uw-toestel-verkopen.html");
  const themeIndex = html.indexOf("assets/homs-tech-modern-true-theme.css");
  const headEnd = html.indexOf("</head>");
  assert.ok(themeIndex >= 0 && themeIndex < headEnd, "shared theme must load inside the document head");
  assert.match(html.slice(0, headEnd), /assets\/homs-layout-system\.css/i);
});

test("phone-selling page exposes complete social sharing metadata", () => {
  const html = readPage("uw-toestel-verkopen.html");
  for (const property of ["og:type", "og:site_name", "og:title", "og:description", "og:url", "og:image"]) {
    assert.ok(
      html.includes('property="' + property + '"') || html.includes("property='" + property + "'"),
      "missing " + property
    );
  }
  assert.match(html, /name=["']twitter:card["'][^>]*content=["']summary_large_image["']/i);
});

test("public pages do not retain stale shared stylesheet cache versions", () => {
  const pages = fs.readdirSync(root).filter(name => name.endsWith(".html") && !name.startsWith("admin"));
  for (const page of pages) {
    const html = readPage(page);
    if (/<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html)) continue;
    assert.doesNotMatch(html, /homs-tech-modern-true-theme\.css\?v=20260922-final-header/, page + " has a stale theme cache key");
    assert.doesNotMatch(html, /homs-layout-system\.css\?v=20261030/, page + " has a stale layout cache key");
  }
});

