const fs = require("node:fs");

const html = fs.readFileSync("gsm-services.html", "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(source => source.trim());

let failed = false;
scripts.forEach((source, index) => {
  try {
    new Function(source);
  } catch (error) {
    failed = true;
    console.error("GSM storefront inline script " + (index + 1) + ": " + error.message);
  }
});

if (failed) process.exit(1);
console.log("Checked " + scripts.length + " GSM storefront inline script blocks.");
