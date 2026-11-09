const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const htmlPath = path.join(root, "admin", "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
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
    console.error("Admin script: missing closing </script> tag.");
    process.exit(1);
  }

  const tag = opening[0];
  const sourceAttribute = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
  if (sourceAttribute) {
    const relativeSource = sourceAttribute[1].split(/[?#]/, 1)[0];
    const sourcePath = path.resolve(path.dirname(htmlPath), relativeSource);
    if (!sourcePath.startsWith(root + path.sep)) {
      console.error("Admin script path escapes project root: " + sourceAttribute[1]);
      process.exit(1);
    }
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      console.error("Admin script asset is missing: " + sourceAttribute[1]);
      process.exit(1);
    }
    scripts.push(fs.readFileSync(sourcePath, "utf8"));
  } else {
    const source = html.slice(openingScriptTag.lastIndex, closing.index);
    if (source.trim()) scripts.push(source);
  }

  cursor = closingScriptTag.lastIndex;
}

let failed = false;
scripts.forEach((source, index) => {
  try {
    new Function(source);
  } catch (error) {
    failed = true;
    console.error("Admin script " + (index + 1) + ": " + error.message);
  }
});

const declaredFunctions = new Set();
for (const source of scripts) {
  for (const match of source.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
    declaredFunctions.add(match[1]);
  }
}

const allowedGlobals = new Set([
  "if", "alert", "confirm", "prompt", "setTimeout", "setInterval",
  "clearTimeout", "clearInterval", "parseInt", "parseFloat", "Number",
  "String", "Boolean", "Array", "Object", "Math", "Date", "JSON",
  "Event", "FileReader", "URL", "encodeURIComponent", "decodeURIComponent"
]);
const missingHandlers = new Map();
const handlerAttributes = /on(?:click|change|input|submit|keydown|keyup|focus|blur)\s*=\s*["']([^"']+)["']/gi;
let handlerCount = 0;

for (const attribute of html.matchAll(handlerAttributes)) {
  handlerCount += 1;
  for (const call of attribute[1].matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = call[1];
    if (declaredFunctions.has(name) || allowedGlobals.has(name)) continue;
    missingHandlers.set(name, (missingHandlers.get(name) || 0) + 1);
  }
}

if (missingHandlers.size) {
  failed = true;
  console.error("Admin inline handlers reference undeclared functions:");
  for (const [name, count] of missingHandlers) {
    console.error(" - " + name + " (" + count + " reference(s))");
  }
}

if (failed) process.exit(1);
console.log("Checked " + scripts.length + " admin script assets and " +
  handlerCount + " inline handler references.");
