"use strict";

function registerLiveChatRoutes(app, { pool, crypto, requirePermission, allowLiveChat, liveChatFirstReply }) {
app.post("/api/chat/conversations", async (req, res) => {
  try {
    if (!allowLiveChat(req.ip || "unknown")) {
      return res.status(429).json({ error: "Probeer het later opnieuw." });
    }

    const message = String(req.body?.message || "").trim().slice(0, 2000);
    if (!message) {
      return res.status(400).json({ error: "Typ eerst een bericht." });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const conversation = await pool.query(
      "INSERT INTO live_chat_conversations(public_token) VALUES($1) RETURNING id,public_token",
      [token]
    );
    const conversationId = conversation.rows[0].id;

    const customerMessage = await pool.query(
      "INSERT INTO live_chat_messages(conversation_id,sender,message) VALUES($1,'customer',$2) RETURNING id,sender,message,created_at",
      [conversationId, message]
    );
    const automaticReply = await pool.query(
      "INSERT INTO live_chat_messages(conversation_id,sender,message) VALUES($1,'admin',$2) RETURNING id,sender,message,created_at",
      [conversationId, liveChatFirstReply()]
    );

    await pool.query(
      "UPDATE live_chat_conversations SET updated_at=NOW() WHERE id=$1",
      [conversationId]
    );

    res.status(201).json({
      token: conversation.rows[0].public_token,
      messages: [...customerMessage.rows, ...automaticReply.rows]
    });
  } catch (error) {
    console.error("Live chat create:", error);
    res.status(500).json({ error: "Chat is tijdelijk niet beschikbaar." });
  }
});
app.post("/api/chat/conversations/:token/messages", async (req, res) => {
  try {
    if (!allowLiveChat(req.ip || "unknown")) {
      return res.status(429).json({ error: "Probeer het later opnieuw." });
    }

    const token = String(req.params.token || "");
    const message = String(req.body?.message || "").trim().slice(0, 2000);

    if (!/^[a-f0-9]{64}$/.test(token)) {
      return res.status(404).json({ error: "Gesprek niet gevonden." });
    }
    if (!message) {
      return res.status(400).json({ error: "Typ eerst een bericht." });
    }

    const conversation = await pool.query(
      "SELECT id,status FROM live_chat_conversations WHERE public_token=$1",
      [token]
    );
    if (!conversation.rows.length) {
      return res.status(404).json({ error: "Gesprek niet gevonden." });
    }
    if (conversation.rows[0].status === "closed") {
      return res.status(409).json({ error: "Dit gesprek is gesloten." });
    }

    const conversationId = conversation.rows[0].id;
    await pool.query(
      "INSERT INTO live_chat_messages(conversation_id,sender,message) VALUES($1,'customer',$2)",
      [conversationId, message]
    );
    await pool.query(
      "UPDATE live_chat_conversations SET updated_at=NOW() WHERE id=$1",
      [conversationId]
    );

    res.status(201).json({ success: true });
  } catch (error) {
    console.error("Live chat message:", error);
    res.status(500).json({ error: "Bericht versturen is mislukt." });
  }
});
app.get("/api/chat/conversations/:token/messages", async (req, res) => {
  try {
    const token = String(req.params.token || "");
    if (!/^[a-f0-9]{64}$/.test(token)) {
      return res.status(404).json({ error: "Gesprek niet gevonden." });
    }

    const conversation = await pool.query(
      "SELECT id,status FROM live_chat_conversations WHERE public_token=$1",
      [token]
    );
    if (!conversation.rows.length) {
      return res.status(404).json({ error: "Gesprek niet gevonden." });
    }

    const messages = await pool.query(
      "SELECT id,sender,message,created_at FROM live_chat_messages WHERE conversation_id=$1 ORDER BY id LIMIT 300",
      [conversation.rows[0].id]
    );

    res.json({
      status: conversation.rows[0].status,
      messages: messages.rows
    });
  } catch (error) {
    console.error("Live chat read:", error);
    res.status(500).json({ error: "Berichten laden is mislukt." });
  }
});
app.get("/api/admin/live-chat", requirePermission("orders.view"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        c.id,
        c.status,
        c.created_at,
        c.updated_at,
        (
          SELECT message
          FROM live_chat_messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.id DESC
          LIMIT 1
        ) AS last_message,
        (
          SELECT COUNT(*)::int
          FROM live_chat_messages m
          WHERE m.conversation_id = c.id
            AND m.sender = 'customer'
            AND m.read_at IS NULL
        ) AS unread
      FROM live_chat_conversations c
      ORDER BY c.updated_at DESC
      LIMIT 200`
    );
    res.json({ conversations: result.rows });
  } catch (error) {
    console.error("Admin live chat list:", error);
    res.status(500).json({ error: "Gesprekken laden is mislukt." });
  }
});
app.get("/api/admin/live-chat/:id/messages", requirePermission("orders.view"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Ongeldig gesprek." });
    }

    const conversation = await pool.query(
      "SELECT id,status FROM live_chat_conversations WHERE id=$1",
      [id]
    );
    if (!conversation.rows.length) {
      return res.status(404).json({ error: "Gesprek niet gevonden." });
    }

    const messages = await pool.query(
      "SELECT id,sender,message,created_at FROM live_chat_messages WHERE conversation_id=$1 ORDER BY id LIMIT 500",
      [id]
    );
    await pool.query(
      "UPDATE live_chat_messages SET read_at=NOW() WHERE conversation_id=$1 AND sender='customer' AND read_at IS NULL",
      [id]
    );

    res.json({
      conversation: conversation.rows[0],
      messages: messages.rows
    });
  } catch (error) {
    console.error("Admin live chat messages:", error);
    res.status(500).json({ error: "Berichten laden is mislukt." });
  }
});
app.post("/api/admin/live-chat/:id/messages", requirePermission("orders.view"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const message = String(req.body?.message || "").trim().slice(0, 2000);

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Ongeldig gesprek." });
    }
    if (!message) {
      return res.status(400).json({ error: "Typ een antwoord." });
    }

    const conversation = await pool.query(
      "SELECT id FROM live_chat_conversations WHERE id=$1",
      [id]
    );
    if (!conversation.rows.length) {
      return res.status(404).json({ error: "Gesprek niet gevonden." });
    }

    await pool.query(
      "INSERT INTO live_chat_messages(conversation_id,sender,message) VALUES($1,'admin',$2)",
      [id, message]
    );
    await pool.query(
      "UPDATE live_chat_conversations SET updated_at=NOW() WHERE id=$1",
      [id]
    );

    res.status(201).json({ success: true });
  } catch (error) {
    console.error("Admin live chat reply:", error);
    res.status(500).json({ error: "Antwoord versturen is mislukt." });
  }
});
app.post("/api/admin/live-chat/:id/status", requirePermission("orders.view"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = req.body?.status === "closed" ? "closed" : "open";

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Ongeldig gesprek." });
    }

    const result = await pool.query(
      "UPDATE live_chat_conversations SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING id",
      [id, status]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: "Gesprek niet gevonden." });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Admin live chat status:", error);
    res.status(500).json({ error: "Status wijzigen is mislukt." });
  }
});
app.post("/api/chat", (_req, res) => {
  res.status(410).json({
    error: "Gebruik HOMS TECH Chat om ons een bericht te sturen."
  });
});
}

module.exports = { registerLiveChatRoutes };
