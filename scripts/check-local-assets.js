const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const htmlFiles = [];

function collectHtml(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectHtml(fullPath);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
      htmlFiles.push(fullPath);
    }
  }
}

collectHtml(root);

const missing = [];
let checked = 0;

for (const htmlFile of htmlFiles) {
  const source = fs.readFileSync(htmlFile, "utf8");
  const references = [
    ...source.matchAll(/<script\b[^>]*?\bsrc\s*=\s*["']([^"'<>]+)["'][^>]*>/gi),
    ...source.matchAll(/<link\b[^>]*?\bhref\s*=\s*["']([^"'<>]+)["'][^>]*>/gi)
  ];

  for (const match of references) {
    const reference = match[1].trim();
    if (!reference || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) continue;
    const pathname = reference.split(/[?#]/, 1)[0];
    if (!pathname || pathname.includes("{{") || pathname.includes("$" + "{")) continue;

    let decodedPath;
    try {
      decodedPath = decodeURIComponent(pathname);
    } catch {
      missing.push(path.relative(root, htmlFile) + ": invalid URL encoding in " + reference);
      continue;
    }

    const target = decodedPath.startsWith("/")
      ? path.resolve(root, decodedPath.replace(/^\/+/, ""))
      : path.resolve(path.dirname(htmlFile), decodedPath);
    if (!target.startsWith(root + path.sep) && target !== root) {
      missing.push(path.relative(root, htmlFile) + ": path escapes project root: " + reference);
      continue;
    }

    checked += 1;
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      missing.push(path.relative(root, htmlFile) + ": missing " + reference);
    }
  }
}

if (missing.length) {
  console.error("Missing local HTML assets:");
  for (const issue of missing) console.error(" - " + issue);
  process.exit(1);
}

console.log("Checked " + checked + " local script and stylesheet references across " + htmlFiles.length + " HTML files.");
