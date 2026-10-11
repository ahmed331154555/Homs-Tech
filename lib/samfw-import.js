"use strict";

const ALLOWED_HOST = "samfw.com";
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10000;

function validateSamFwUrl(value) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch { throw Object.assign(new Error("Enter a valid SamFW firmware page URL."), {statusCode:400}); }
  if (url.protocol !== "https:" || !(url.hostname === ALLOWED_HOST || url.hostname.endsWith("." + ALLOWED_HOST)) || url.username || url.password) {
    throw Object.assign(new Error("Only HTTPS pages hosted on samfw.com are allowed."), {statusCode:400});
  }
  if (!url.pathname.startsWith("/firmware/")) {
    throw Object.assign(new Error("The URL must be a public SamFW firmware detail page (/firmware/...)."), {statusCode:400});
  }
  url.hash = "";
  url.search = "";
  return url;
}

function decodeEntities(value) {
  return String(value || "").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)));
}
function stripTags(value) {
  return decodeEntities(String(value || "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ")).trim();
}
function readMeta(html, key) {
  const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const patterns=[
    new RegExp('<meta[^>]+(?:name|property)=["\\']'+escaped+'["\\'][^>]+content=["\\']([^"\\']*)["\\'][^>]*>',"i"),
    new RegExp('<meta[^>]+content=["\\']([^"\\']*)["\\'][^>]+(?:name|property)=["\\']'+escaped+'["\\'][^>]*>',"i")
  ];
  for(const re of patterns){const m=html.match(re);if(m)return stripTags(m[1]);}
  return "";
}
function parseSamFwFirmwarePage(html, sourceUrl) {
  if(typeof html!=="string" || !html.trim()) throw Object.assign(new Error("SamFW returned an empty page."),{statusCode:502});
  const title=stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||"");
  const description=readMeta(html,"description") || stripTags((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)||[])[1]||"");
  const model=(sourceUrl.match(/\/firmware\/(SM-[A-Z0-9]+)/i)||[])[1] || (html.match(/\bSM-[A-Z0-9]+\b/i)||[])[0] || "";
  const pathParts=new URL(sourceUrl).pathname.split("/").filter(Boolean);
  const region=pathParts[2] || "";
  const version=pathParts[3] || "";
  const sizeMatch=html.match(/(?:firmware\s+size|full files|\bSIZE\b)[^\d]{0,80}([\d,.]+)\s*(GB|MB)\b/i);
  let fileSize=0;
  if(sizeMatch){const amount=Number(sizeMatch[1].replace(/,/g,""));fileSize=Math.round(amount*(sizeMatch[2].toUpperCase()==="GB"?1024**3:1024**2));}
  const name=title.replace(/\s*[|–-]\s*Samfw.*$/i,"").trim() || (model ? [model,region,version].filter(Boolean).join(" ") : "");
  if(!name || !model) throw Object.assign(new Error("Could not identify a Samsung model from this page. Please use a specific SamFW firmware detail page."),{statusCode:422});
  const tags=["Samsung","Firmware",model,region,version].filter(Boolean);
  const parts=[model,region,version,sizeMatch?("Approx. size: "+sizeMatch[1]+" "+sizeMatch[2].toUpperCase()):""].filter(Boolean);
  return {name:name.slice(0,220),sourceUrl,description:("Imported metadata from SamFW public page. "+parts.join(" · ")+(description?" · "+description:"")).slice(0,2000),fileSize,tags:[...new Set(tags)].slice(0,20)};
}
async function importSamFwPage(value) {
  let url=validateSamFwUrl(value);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
  try {
    for(let hop=0;hop<4;hop++){
      const response=await fetch(url,{method:"GET",redirect:"manual",signal:controller.signal,headers:{"user-agent":"HomsTech-Firmware-Importer/1.0","accept":"text/html"}});
      if([301,302,303,307,308].includes(response.status)){
        const location=response.headers.get("location");
        if(!location)throw Object.assign(new Error("SamFW redirected without a destination."),{statusCode:502});
        url=validateSamFwUrl(new URL(location,url).toString());
        continue;
      }
      if(!response.ok)throw Object.assign(new Error("SamFW page returned HTTP "+response.status+"."),{statusCode:502});
      const type=response.headers.get("content-type")||"";
      if(!type.toLowerCase().includes("text/html"))throw Object.assign(new Error("SamFW did not return an HTML page."),{statusCode:502});
      const declared=Number(response.headers.get("content-length")||0);
      if(declared>MAX_PAGE_BYTES)throw Object.assign(new Error("SamFW page is larger than the allowed import limit."),{statusCode:413});
      const html=await response.text();
      if(Buffer.byteLength(html,"utf8")>MAX_PAGE_BYTES)throw Object.assign(new Error("SamFW page is larger than the allowed import limit."),{statusCode:413});
      return parseSamFwFirmwarePage(html,url.toString());
    }
    throw Object.assign(new Error("Too many redirects while opening SamFW page."),{statusCode:502});
  } catch(error) {
    if(error.name==="AbortError")throw Object.assign(new Error("Timed out while opening SamFW page."),{statusCode:504});
    throw error;
  } finally { clearTimeout(timer); }
}
module.exports={validateSamFwUrl,parseSamFwFirmwarePage,importSamFwPage};
