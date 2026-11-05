"use strict";

// In-memory throttling for public customer live chat messages.
const liveChatRateLimits = new Map();

function allowLiveChat(ip) {
  const now = Date.now(), windowMs = 15 * 60 * 1000;
  const recent = (liveChatRateLimits.get(ip) || []).filter(t => now - t < windowMs);
  if (recent.length >= 30) return false;
  recent.push(now); liveChatRateLimits.set(ip, recent);
  return true;
}

function liveChatAutomaticReply(message) {
  const raw = String(message || "").trim();
  const normalized = raw.toLocaleLowerCase("nl-NL")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!normalized) {
    return "Bedankt voor uw bericht. Kunt u iets meer vertellen, zodat we u goed kunnen helpen?";
  }

  const hasAny = (terms) => terms.some(term => normalized.includes(term));
  const greetings = new Set(["hi","hoi","halo","hallo","hello","hey","heya","goedemorgen","goedemiddag","goedenavond","goedenacht"]);
  if (greetings.has(normalized)) {
    return "Hallo! 👋 Welkom bij HOMS TECH. Waarmee kan ik u helpen? U kunt vragen stellen over een reparatie, een telefoon of iets anders.";
  }

  // Repair intent takes priority when a defect or repair is explicitly mentioned.
  const repairIntent = hasAny([
    "repar", "kapot", "defect", "scherm", "display", "glas", "batterij", "accu",
    "laadt niet", "oplaad", "laadpoort", "camera werkt", "waterschade", "waterschad",
    "start niet", "gaat niet aan", "blijft hangen", "softwareprobleem", "reparatieprijs",
    "reparatiekosten", "laten maken", "maken van mijn telefoon", "telefoon maken",
    "iphone maken", "ipad maken", "samsung maken", "herstellen"
  ]);
  const phoneBuyingIntent = hasAny([
    "kopen", "te koop", "verkopen jullie", "verkoop", "telefoon zoeken", "nieuwe telefoon",
    "refurbished", "tweedehands", "tweede hands", "iphone", "ipad", "samsung", "smartphone",
    "welke telefoons", "welke modellen", "op voorraad", "voorraad", "toestel", "telefoon"
  ]) && !repairIntent;

  if (repairIntent) {
    return "Natuurlijk, we helpen u graag met uw reparatie. 😊 Welk toestel heeft u (merk en model) en wat is precies het probleem? Als u dat doorgeeft, kan ons team u verder helpen met de mogelijkheden en een prijsindicatie.";
  }
  if (phoneBuyingIntent) {
    return "Leuk dat u bij HOMS TECH een telefoon zoekt! 📱 Naar welk merk en model bent u op zoek, en wat is ongeveer uw budget? Dan kan ons team met u meekijken naar de beschikbare mogelijkheden. De actuele voorraad wordt door ons team bevestigd.";
  }

  const otherIntent = hasAny([
    "bestelling", "order", "status", "garantie", "retour", "terugsturen", "betaling",
    "betalen", "afspraak", "openingstijden", "adres", "locatie", "contact", "samenwerken",
    "zakelijk", "factuur", "klacht", "anders", "vraag"
  ]);
  if (otherIntent) {
    return "Bedankt voor uw bericht! 😊 Ik geef uw vraag door aan ons team. Een medewerker van HOMS TECH neemt zo snel mogelijk contact met u op via deze chat.";
  }

  return "Bedankt voor uw bericht! 😊 Ik wil u graag goed helpen, maar weet nog niet precies waar uw vraag over gaat. Gaat het om een reparatie, een telefoon kopen of iets anders? Als het iets anders is, neemt ons team het hier verder met u op.";
}

module.exports = { allowLiveChat, liveChatAutomaticReply };
