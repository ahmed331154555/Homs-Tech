(() => {
  if (window.__homsLiveChatLoaded) return;
  window.__homsLiveChatLoaded = true;

  const tokenKey = "homsTechLiveChatToken";
  const style = document.createElement("style");

  style.textContent = `
    #homs-ai-launch {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 9998;
      width: 64px;
      height: 64px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 2px solid rgba(255,255,255,.9);
      border-radius: 50%;
      background: linear-gradient(145deg, #3b82f6, #1d4ed8);
      color: #fff;
      box-shadow: 0 6px 20px rgba(7,29,45,.24);
      font: 700 15px/1 Arial, sans-serif;
      cursor: pointer;
      transition: transform .18s ease, box-shadow .18s ease, filter .18s ease;
      -webkit-tap-highlight-color: transparent;
    }
    #homs-ai-launch:hover {
      transform: translateY(-2px);
      box-shadow: 0 9px 24px rgba(7,29,45,.3);
      filter: brightness(1.04);
    }
    #homs-ai-launch:active { transform: scale(.96); }
    #homs-ai-launch:focus-visible {
      outline: 3px solid #93c5fd;
      outline-offset: 3px;
    }
    #homs-ai-panel {
      position: fixed;
      right: 20px;
      bottom: 82px;
      z-index: 9999;
      width: min(390px, calc(100vw - 28px));
      height: min(610px, calc(100dvh - 115px));
      background: #fff;
      color: #172330;
      border: 1px solid #dbe3ea;
      border-radius: 18px;
      box-shadow: 0 18px 55px #0003;
      display: none;
      overflow: hidden;
      font: 14px/1.45 Arial, Helvetica, sans-serif;
    }
    #homs-ai-panel.open {
      display: flex;
      flex-direction: column;
    }
    .homs-ai-head {
      background: #071d2d;
      color: #fff;
      padding: 15px 16px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .homs-ai-avatar {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: #25d366;
      color: #071d2d;
      font-size: 21px;
    }
    .homs-ai-head strong {
      display: block;
      font-size: 15px;
    }
    .homs-ai-head small {
      display: block;
      color: #b8d8c9;
      margin-top: 2px;
    }
    .homs-ai-close {
      margin-left: auto;
      border: 0;
      background: transparent;
      color: white;
      font-size: 25px;
      cursor: pointer;
      padding: 3px 8px;
    }
    .homs-ai-messages {
      flex: 1;
      overflow: auto;
      padding: 14px;
      background: #f5f8fa;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .homs-ai-msg {
      max-width: 88%;
      padding: 10px 12px;
      border-radius: 13px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .homs-ai-msg.bot {
      background: white;
      border: 1px solid #e3e9ee;
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }
    .homs-ai-msg.user {
      background: #dcfce7;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
    }
    .homs-ai-form {
      display: flex;
      gap: 8px;
      padding: 10px;
      border-top: 1px solid #e5eaf0;
      background: white;
    }
    .homs-ai-form input {
      min-width: 0;
      flex: 1;
      border: 1px solid #cbd7e2;
      border-radius: 999px;
      padding: 11px 13px;
      font-size: 14px;
    }
    .homs-ai-form button {
      border: 0;
      border-radius: 999px;
      background: #2563eb;
      color: #fff;
      padding: 0 15px;
      font-weight: 700;
      cursor: pointer;
    }
    .homs-ai-form button:disabled {
      opacity: .6;
    }
    .homs-ai-note {
      font-size: 10px;
      color: #64748b;
      text-align: center;
      padding: 7px;
      background: #fff;
    }
    @media (max-width: 480px) {
      #homs-ai-launch {
        right: 14px;
        bottom: 14px;
        width: 60px;
        height: 60px;
        font-size: 14px;
      }
      #homs-ai-panel {
        right: 8px;
        bottom: 68px;
        width: calc(100vw - 16px);
        height: min(650px, calc(100dvh - 85px));
        border-radius: 15px;
      }
    }
  `;

  document.head.appendChild(style);

  const launch = document.createElement("button");
  launch.id = "homs-ai-launch";
  launch.type = "button";
  launch.textContent = "Chat";
  launch.setAttribute("aria-label", "HOMS TECH Chat openen");
  launch.setAttribute("title", "HOMS TECH Chat");
  launch.setAttribute("aria-expanded", "false");

  const panel = document.createElement("section");
  panel.id = "homs-ai-panel";
  panel.setAttribute("aria-label", "HOMS TECH klantenservice");
  panel.innerHTML = `
    <header class="homs-ai-head">
      <div class="homs-ai-avatar">💬</div>
      <div>
        <strong>HOMS TECH Chat</strong>
        <small>Klantenservice · Nederlands</small>
      </div>
      <button class="homs-ai-close" type="button" aria-label="Sluiten">×</button>
    </header>
    <div class="homs-ai-messages" role="log" aria-live="polite"></div>
    <form class="homs-ai-form">
      <input name="message" maxlength="2000" autocomplete="off" required placeholder="Typ je bericht…">
      <button type="submit">Verstuur</button>
    </form>
    <div class="homs-ai-note">We beantwoorden je bericht zo snel mogelijk. Bedankt voor je geduld!</div>
  `;

  document.body.append(launch, panel);

  const messages = panel.querySelector(".homs-ai-messages");
  const form = panel.querySelector(".homs-ai-form");
  const input = form.elements.message;

  let token = "";
  try {
    token = localStorage.getItem(tokenKey) || "";
  } catch {}

  const seen = new Set();
  const MAX_RENDERED_MESSAGES = 300;
  let timer = null;
  let refreshing = false;

  function add(message) {
    const id = message.id == null ? null : String(message.id);
    if (id && seen.has(id)) return;
    if (id) seen.add(id);

    const element = document.createElement("div");
    element.className =
      "homs-ai-msg " + (message.sender === "customer" ? "user" : "bot");
    if (id) element.dataset.messageId = id;
    element.textContent = message.message;
    messages.appendChild(element);
    while (messages.children.length > MAX_RENDERED_MESSAGES) {
      const oldest = messages.firstElementChild;
      if (!oldest) break;
      const oldestId = oldest.dataset.messageId;
      if (oldestId) seen.delete(oldestId);
      oldest.remove();
    }
    messages.scrollTop = messages.scrollHeight;
  }

  async function refresh() {
    if (!token || refreshing) return;
    refreshing = true;

    try {
      const response = await fetch(
        "/api/chat/conversations/" + encodeURIComponent(token) + "/messages",
        { credentials: "same-origin", cache: "no-store" },
      );

      if (!response.ok) {
        if (response.status === 404) {
          token = "";
          try {
            localStorage.removeItem(tokenKey);
          } catch {}
        }
        return;
      }

      const data = await response.json();
      if (Array.isArray(data.messages)) data.messages.forEach(add);

      if (data.status === "closed") {
        input.disabled = true;
        form.querySelector("button").disabled = true;
      }
    } catch {
    } finally {
      refreshing = false;
    }
  }

  function stopPolling() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function startPolling() {
    if (!panel.classList.contains("open") || document.hidden || timer) return;
    refresh();
    timer = setInterval(refresh, 5000);
  }

  launch.addEventListener("click", () => {
    const open = !panel.classList.contains("open");
    panel.classList.toggle("open", open);
    launch.setAttribute("aria-expanded", String(open));

    if (open) {
      startPolling();
      input.focus();
    } else {
      stopPolling();
    }
  });

  panel.querySelector(".homs-ai-close").addEventListener("click", () => {
    panel.classList.remove("open");
    launch.setAttribute("aria-expanded", "false");
    stopPolling();
  });

  // Avoid background polling while the customer has another tab or app open.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPolling();
    else startPolling();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const message = input.value.trim();
    if (!message) return;

    const button = form.querySelector("button");
    button.disabled = true;
    input.disabled = true;
    input.value = "";

    try {
      let response;

      if (!token) {
        response = await fetch("/api/chat/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ message }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw Error(data.error || "Bericht versturen is mislukt.");
        }

        token = data.token;
        try {
          localStorage.setItem(tokenKey, token);
        } catch {}
        if (Array.isArray(data.messages)) data.messages.forEach(add);
      } else {
        // The server response is the source of truth. Do not add an optimistic
        // copy here, otherwise refresh() will append the same message again
        // with its database ID and it will appear twice in the chat.

        response = await fetch(
          "/api/chat/conversations/" + encodeURIComponent(token) + "/messages",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ message }),
          },
        );

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw Error(data.error || "Bericht versturen is mislukt.");
        }
      }

      await refresh();
    } catch (error) {
      add({
        sender: "admin",
        message: error.message || "Bericht versturen is mislukt.",
      });
    } finally {
      button.disabled = false;
      input.disabled = false;
      input.focus();
    }
  });
})();
