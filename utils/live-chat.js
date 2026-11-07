"use strict";

// In-memory throttling for public customer live chat messages.
const liveChatRateLimits = new Map();

function allowLiveChat(ip) {
  const now = Date.now(), windowMs = 15 * 60 * 1000;
  const recent = (liveChatRateLimits.get(ip) || []).filter(t => now - t < windowMs);
  if (recent.length >= 30) return false;
  recent.push(now);
  liveChatRateLimits.set(ip, recent);
  if (liveChatRateLimits.size > 5000) {
    for (const [key, timestamps] of liveChatRateLimits.entries()) {
      if (timestamps.every(timestamp => now - timestamp >= windowMs)) liveChatRateLimits.delete(key);
    }
  }
  return true;
}

function liveChatFirstReply() {
  return "Bedankt voor uw bericht! 👋 Een medewerker van ons HOMS TECH-team neemt zo snel mogelijk contact met u op via deze chat.";
}

module.exports = { allowLiveChat, liveChatFirstReply };
