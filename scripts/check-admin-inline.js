const fs = require("node:fs");

const html = fs.readFileSync("admin/index.html", "utf8");
const scripts = [];
const openingScriptTag = /<script\b[^>]*>/gi;
const closingScriptTag = /<\/script\s*>/gi;

let cursor = 0;
while (cursor < html.length) {
  openingScriptTag.lastIndex = cursor;
  const opening = openingScriptTag.exec(html);
  if (!opening) break;

  closingScriptTag.lastIndex = openingScriptTag.lastIndex;
  const closing = closingScriptTag.exec(html);
  if (!closing) {
    console.error("Admin inline script: missing closing </script> tag.");
    process.exit(1);
  }

  const tag = opening[0];
  if (!/\bsrc\s*=\s*["'][^"']*["']/i.test(tag)) {
    const source = html.slice(openingScriptTag.lastIndex, closing.index);
    if (source.trim()) scripts.push(source);
  }

  // Skip the complete script body so tag-like text inside JavaScript
  // template strings is not mistaken for another HTML script element.
  cursor = closingScriptTag.lastIndex;
}

let failed = false;
scripts.forEach((source, index) => {
  try {
    new Function(source);
  } catch (error) {
    failed = true;
    console.error("Admin inline script " + (index + 1) + ": " + error.message);
  }
});

if (failed) process.exit(1);
console.log("Checked " + scripts.length + " admin inline script blocks.");
