"use strict";

const { moneyNumber } = require("./money");
const { serverOptionDelta, serverOptionDefaults } = require("./product-options");
const { findShopProductIndex, priceShopVariant } = require("./shop-catalog");

function priceProductFromCatalog(data, item) {
  const type = String(item?.type || "").toLowerCase();
  const list = type === "shop"
    ? (Array.isArray(data.shopProducts) ? data.shopProducts : [])
    : type === "used"
      ? (Array.isArray(data.usedPhones) ? data.usedPhones : [])
      : (Array.isArray(data.phones) && data.phones.length ? data.phones : (Array.isArray(data.devices) ? data.devices : []));
  const id = type === "shop"
    ? findShopProductIndex(list, item?.id)
    : Number(item?.id);
  if (!Number.isInteger(id) || id < 0 || id >= list.length) return { error: "Een product in uw winkelwagen is verouderd. Verwijder het en voeg het opnieuw toe." };
  const product = list[id];
  if (!product || product.active === false || product.available === false || String(product.stockStatus || "").toLowerCase() === "sold") {
    return { error: "Een product in uw winkelwagen is niet meer beschikbaar." };
  }
  if (type === "shop") return priceShopVariant(product, item, product.id ?? id, moneyNumber);
  const options = item.options && typeof item.options === "object" && !Array.isArray(item.options) ? item.options : {};
  const getList = key => {
    const map = { condition: "conditionOptions", storage: "storageOptions", color: "colorOptions", battery: "batteryOptions", vat: "vatOptions", tradeIn: "tradeInOptions" };
    const raw = product[map[key]];
    if (Array.isArray(raw) && raw.length) return raw.filter(x => x && x.label && x.active !== false && x.enabled !== false);
    if (key === "storage" || key === "color") {
      const own = key === "storage" ? (Array.isArray(product.storage) ? product.storage[0] : product.storage || product.geheugen || "") : (product.color || product.kleur || "");
      return own ? [{ label: String(own), active: true, enabled: true, available: true, priceDelta: 0 }] : serverOptionDefaults(key);
    }
    return serverOptionDefaults(key);
  };
  const chosen = {};
  for (const key of ["condition", "storage", "color", "battery", "vat", "tradeIn"]) {
    const requested = String(options[key] ?? "");
    if (!requested) continue;
    const option = getList(key).find(x => String(x.label) === requested);
    if (!option || (key !== "storage" && key !== "color" && option.available === false)) {
      return { error: "Een gekozen productoptie is niet geldig of niet beschikbaar. Controleer uw winkelwagen." };
    }
    chosen[key] = option;
  }
  const requestedCustom=options.custom&&typeof options.custom==="object"&&!Array.isArray(options.custom)?options.custom:{};
  const verifiedCustom={};
  let customTotal=0;
  let customValidationError="";
  for(const type of ["optionGroups","addonGroups"]){
    const groups=Array.isArray(product[type])?product[type]:[];
    groups.forEach((group,index)=>{
      const key=type+":"+index;
      const requested=String(requestedCustom[key]??"");
      if(!requested)return;
      const option=(Array.isArray(group?.options)?group.options:[]).find(x=>x&&String(x.label)===requested&&x.active!==false&&x.available!==false);
      if(!option){customValidationError="Een extra of variant is niet meer beschikbaar. Controleer uw winkelwagen.";return;}
      const stock=option.stock;
      if(stock!==undefined&&stock!==null&&stock!==""&&(!Number.isFinite(Number(stock))||Number(stock)<1)){
        customValidationError="Deze optie is momenteel niet op voorraad.";return;
      }
      verifiedCustom[key]=requested;
      customTotal+=serverOptionDelta(option);
    });
  }
  if(customValidationError)return {error:customValidationError};
  if(product.pricingMode==="variant"){
    const row=(Array.isArray(product.variantPrices)?product.variantPrices:[]).find(x=>
      x && String(x.condition)===String(chosen.condition?.label||"") &&
      String(x.color)===String(chosen.color?.label||"") &&
      String(x.storage)===String(chosen.storage?.label||"") &&
      x.active!==false && x.available!==false
    );
    if(!row || !Number.isFinite(moneyNumber(row.price)) || moneyNumber(row.price)<=0){
      return {error:"Deze combinatie van conditie, kleur en opslag is niet beschikbaar of heeft geen geldige prijs."};
    }
    let exact=moneyNumber(row.price);
    for(const key of ["battery","vat","tradeIn"]) exact+=serverOptionDelta(chosen[key],key);
    exact+=customTotal;
    const qty=Number(item?.qty ?? 1);
    if(!Number.isInteger(qty)||qty<1||qty>99) return {error:"Kies een geldige hoeveelheid (1–99)."};
    if(row.stock!==undefined&&row.stock!==null&&row.stock!==""&&Number.isFinite(Number(row.stock))&&qty>Number(row.stock)) return {error:"Er is onvoldoende voorraad voor deze uitvoering."};
    if(row.available===false||row.active===false) return {error:"Deze uitvoering is niet beschikbaar."};
    return {item:{name:String(product.name||"Smartphone"),brand:String(product.brand||""),type,id,options:Object.fromEntries(Object.entries(options).filter(([key,value])=>["storage","color","condition","battery","vat","tradeIn","custom"].includes(key)&&String(value??"").trim()!=="").map(([key,value])=>[key,key==="custom"?verifiedCustom:value])),qty,unitPrice:Math.round(Math.max(0,exact)*100)/100}};
  }
  const condition = chosen.condition;
  const base = condition && (condition.basePrice !== undefined || condition.conditionBasePrice !== undefined)
    ? moneyNumber(condition.basePrice ?? condition.conditionBasePrice)
    : moneyNumber(product.price ?? product.salePrice ?? product.sellPrice ?? 0);
  if (!Number.isFinite(base) || base < 0) return { error: "De prijs van een product is ongeldig. Neem contact met ons op." };
  let total = base;
  for (const key of ["storage", "color", "battery", "vat", "tradeIn"]) total += serverOptionDelta(chosen[key], key);
  total += customTotal;
  total = Math.max(0, total);
  if (!Number.isFinite(total) || total <= 0) return { error: "Dit product heeft momenteel geen geldige verkoopprijs." };
  const qty = Number(item?.qty ?? 1);
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) return { error: "Kies een geldige hoeveelheid (1–99)." };
  return {
    item: {
      name: String(product.name || "Smartphone"),
      brand: String(product.brand || ""),
      type,
      id,
      options: Object.fromEntries(Object.entries(options).filter(([key, value]) => ["storage", "color", "condition", "battery", "vat", "tradeIn", "custom"].includes(key) && String(value ?? "").trim() !== "").map(([key,value])=>[key,key==="custom"?verifiedCustom:value])),
      qty,
      unitPrice: Math.round(total * 100) / 100
    }
  };
}

module.exports = { priceProductFromCatalog };
