"use strict";

const { createBoundedRateLimiter } = require("./bounded-rate-limit");

// Public chat: 30 messages per IP in 15 minutes, with a hard memory ceiling.
const allowLiveChat = createBoundedRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 30,
  maxEntries: 5000
});

function liveChatFirstReply() {
  return "Bedankt voor uw bericht! 👋 Een medewerker van ons HOMS TECH-team neemt zo snel mogelijk contact met u op via deze chat.";
}

module.exports = { allowLiveChat, liveChatFirstReply };
