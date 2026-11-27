/* Admin: repair request timeline, notes and "send status update" email.
 * Injected into every expanded repair request card; data comes from
 * /api/admin/orders/:id/events|notes|notify. */
(function () {
  "use strict";
  var STATUS_LABELS = {
    Nieuw: "Aanvraag ontvangen", "In behandeling": "In behandeling", "Wacht op klant": "Wacht op klant",
    "Wacht op leverancier": "Wacht op leverancier", "Resultaat ontvangen": "Resultaat ontvangen",
    Mislukt: "Mislukt", Voltooid: "Voltooid", Geannuleerd: "Geannuleerd"
  };
  var timer = null;

  function can(permission) {
    try { return typeof hasPermission === "function" ? hasPermission(permission) : true; } catch (e) { return true; }
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function api(url, options) {
    options = options || {};
    options.credentials = "same-origin";
    options.cache = "no-store";
    if (options.body) options.headers = { "Content-Type": "application/json", Accept: "application/json" };
    return fetch(url, options).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || "Er ging iets mis (HTTP " + r.status + ").");
        return d;
      });
    });
  }
  function when(v) {
    var d = new Date(v);
    return isNaN(d) ? "" : d.toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" });
  }
  function addStyle() {
    if (document.getElementById("rtStyle")) return;
    var s = document.createElement("style");
    s.id = "rtStyle";
    s.textContent =
      ".rt-box{margin-top:14px;padding-top:14px;border-top:1px solid #e3eaf2}" +
      ".rt-toggle{min-height:44px}" +
      ".rt-panel{margin-top:12px;display:grid;gap:12px}" +
      ".rt-form{display:grid;gap:8px}.rt-form textarea{width:100%;min-height:76px;border:1px solid #cdd8e4;border-radius:10px;padding:10px 12px;font:inherit;box-sizing:border-box;resize:vertical}" +
      ".rt-form label{display:flex;align-items:center;gap:8px;font-size:13px;color:#334155}" +
      ".rt-actions{display:flex;gap:8px;flex-wrap:wrap}" +
      ".rt-msg{font-size:13px;min-height:1em}.rt-msg.ok{color:#087443}.rt-msg.err{color:#b42318}" +
      ".rt-list{list-style:none;margin:0;padding:0 0 0 8px;border-left:2px solid #dbe5f0;display:grid;gap:12px}" +
      ".rt-list li{position:relative;padding-left:16px;font-size:14px;line-height:1.45;min-width:0;overflow-wrap:anywhere}" +
      ".rt-list li::before{content:'';position:absolute;left:-14px;top:5px;width:10px;height:10px;border-radius:50%;background:#fff;border:2px solid #9db3cc}" +
      ".rt-list li.status::before{background:#0b63ce;border-color:#0b63ce}.rt-list li.message::before{border-color:#087443}" +
      ".rt-list li.note{background:#fff8e1;border-radius:8px;padding:6px 10px 6px 16px}" +
      ".rt-list small{display:block;color:#64748b;font-size:12px}";
    document.head.appendChild(s);
  }
  function renderEvents(list, events) {
    list.textContent = "";
    if (!events.length) { list.appendChild(el("li", "", "Nog geen gebeurtenissen.")); return; }
    events.forEach(function (e) {
      var li = el("li", e.kind === "status" ? "status" : e.kind);
      var title;
      if (e.kind === "status") title = "Status: " + (STATUS_LABELS[e.status] || e.status);
      else if (e.kind === "message") title = "Bericht aan klant (zichtbaar)";
      else if (e.kind === "email") title = "E-mail";
      else title = "Interne notitie";
      li.appendChild(el("b", "", title));
      if (e.note) li.appendChild(el("div", "", e.note));
      li.appendChild(el("small", "", when(e.at)));
      list.appendChild(li);
    });
  }
  function load(id, list, msg) {
    return api("/api/admin/orders/" + encodeURIComponent(id) + "/events")
      .then(function (d) { renderEvents(list, d.events || []); })
      .catch(function (e) { msg.className = "rt-msg err"; msg.textContent = e.message; });
  }
  function build(id, box) {
    var toggle = el("button", "btn btn-light rt-toggle", "🕘 Tijdlijn & notities");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    var panel = el("div", "rt-panel");
    panel.hidden = true;
    var msg = el("div", "rt-msg");
    var list = el("ul", "rt-list");
    msg.setAttribute("role", "status");

    if (can("orders.update")) {
      var form = el("div", "rt-form");
      var ta = el("textarea");
      ta.placeholder = "Notitie of bericht aan de klant…";
      ta.setAttribute("aria-label", "Notitie voor aanvraag " + id);
      ta.maxLength = 1000;
      var lab = el("label");
      var cb = el("input");
      cb.type = "checkbox";
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode("Zichtbaar voor de klant (op de volgpagina)"));
      var actions = el("div", "rt-actions");
      var save = el("button", "btn btn-blue", "Opslaan");
      save.type = "button";
      var notify = el("button", "btn btn-light", "📧 Stuur statusupdate naar klant");
      notify.type = "button";
      actions.appendChild(save);
      actions.appendChild(notify);
      form.appendChild(ta);
      form.appendChild(lab);
      form.appendChild(actions);
      panel.appendChild(form);
      save.addEventListener("click", function () {
        var text = ta.value.trim();
        if (!text) { msg.className = "rt-msg err"; msg.textContent = "Schrijf eerst een notitie."; ta.focus(); return; }
        save.disabled = true;
        api("/api/admin/orders/" + encodeURIComponent(id) + "/notes", {
          method: "POST", body: JSON.stringify({ note: text, visible: cb.checked })
        }).then(function () {
          ta.value = ""; cb.checked = false;
          msg.className = "rt-msg ok"; msg.textContent = "Opgeslagen.";
          return load(id, list, msg);
        }).catch(function (e) { msg.className = "rt-msg err"; msg.textContent = e.message; })
          .then(function () { save.disabled = false; });
      });
      notify.addEventListener("click", function () {
        if (!confirm("De klant per e-mail de huidige status van aanvraag #" + id + " sturen?")) return;
        notify.disabled = true;
        msg.className = "rt-msg"; msg.textContent = "Bezig met verzenden…";
        api("/api/admin/orders/" + encodeURIComponent(id) + "/notify", { method: "POST", body: "{}" })
          .then(function () { msg.className = "rt-msg ok"; msg.textContent = "E-mail verzonden."; return load(id, list, msg); })
          .catch(function (e) { msg.className = "rt-msg err"; msg.textContent = e.message; })
          .then(function () { notify.disabled = false; });
      });
    }
    panel.appendChild(msg);
    panel.appendChild(list);
    box.appendChild(toggle);
    box.appendChild(panel);
    toggle.addEventListener("click", function () {
      var open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) load(id, list, msg);
    });
  }
  function enhance() {
    addStyle();
    var cards = document.querySelectorAll("#repairRequestsList .repair-request-details");
    Array.prototype.forEach.call(cards, function (details) {
      if (details.querySelector(".rt-box")) return;
      var m = /repair-request-details-(\d+)/.exec(details.id || "");
      if (!m) return;
      var box = el("div", "rt-box");
      details.appendChild(box);
      build(m[1], box);
    });
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(enhance, 60); }
  function start() {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    schedule();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
