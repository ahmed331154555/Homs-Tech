(function () {
  "use strict";
  var state = { q: "", category: "", published: "", page: 1, limit: 50, total: 0, loaded: false };
  var currency = "USD";
  var timer = null;

  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(v) { return (currency === "USD" ? "$ " : currency + " ") + Number(v || 0).toFixed(2); }
  function status(text, isError) {
    var el = $("euStatus");
    if (!el) return;
    el.textContent = text || "";
    el.style.color = isError ? "#b91c1c" : "#15803d";
  }
  function api(url, options) {
    options = options || {};
    options.credentials = "same-origin";
    options.cache = "no-store";
    if (options.body && !options.headers) options.headers = { "Content-Type": "application/json" };
    return fetch(url, options).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || "Er ging iets mis (HTTP " + r.status + ").");
        return d;
      });
    });
  }

  function saleLabel(price, margin) {
    if (margin == null || margin === "") return "";
    return "→ verkoop " + money(price * (1 + Number(margin) / 100));
  }

  function rowHtml(s) {
    return '<div class="eu-row' + (s.published ? " is-on" : "") + '" data-id="' + esc(s.id) + '">' +
      '<div class="eu-thumb">' + (s.imageUrl ? '<img loading="lazy" src="' + esc(s.imageUrl) + '" alt="">' : "🔓") + "</div>" +
      '<div class="eu-main"><strong>' + esc(s.name) + "</strong>" +
      '<div class="eu-meta"><span>' + esc(s.categoryName || "—") + "</span>" +
      (s.type ? "<span>" + esc(s.type) + "</span>" : "") +
      (s.fields.length ? "<span>" + esc(s.fields.map(function (f) { return f.name; }).filter(Boolean).join(", ")) + "</span>" : "") + "</div></div>" +
      '<div class="eu-price"><b>' + money(s.price) + '</b><small>inkoop</small></div>' +
      '<label class="eu-margin"><span>Winst %</span><input type="number" min="0" max="500" step="1" inputmode="decimal" value="' + (s.marginPercent == null ? "" : esc(s.marginPercent)) + '" data-act="margin"><small class="eu-sale">' + esc(saleLabel(s.price, s.marginPercent)) + "</small></label>" +
      '<label class="eu-pick"><input type="checkbox" data-act="pick"' + (s.published ? " checked" : "") + "><span>Kiezen</span></label></div>";
  }

  function render(data) {
    var list = $("euList");
    currency = (data.summary && data.summary.currency) || "USD";
    $("euSummary").textContent = data.summary.total
      ? data.summary.total + " diensten · " + data.summary.published + " gekozen" +
        (data.summary.lastImport ? " · laatst bijgewerkt " + new Date(data.summary.lastImport).toLocaleString("nl-NL") : "") +
        " · Gekozen diensten staan nog niet op de website."
      : "Nog geen catalogus. Upload products.json of klik op Synchroniseren.";
    var select = $("euCategory");
    if (select && !select.dataset.filled) {
      select.innerHTML = '<option value="">Alle categorieën</option>' + data.categories.map(function (c) {
        return '<option value="' + esc(c.id) + '">' + esc(c.name) + " (" + c.count + ")</option>";
      }).join("");
      select.dataset.filled = "1";
    }
    state.total = data.total;
    list.innerHTML = data.services.length ? data.services.map(rowHtml).join("") : '<p class="small">Geen diensten gevonden.</p>';
    var pages = Math.max(1, Math.ceil(data.total / state.limit));
    $("euPage").textContent = "Pagina " + state.page + " van " + pages + " · " + data.total + " resultaten";
    $("euPrev").disabled = state.page <= 1;
    $("euNext").disabled = state.page >= pages;
  }

  function load() {
    var p = new URLSearchParams({ q: state.q, category: state.category, published: state.published, page: state.page, limit: state.limit });
    return api("/api/admin/easy-unlocker/services?" + p.toString()).then(render).catch(function (e) { status(e.message, true); });
  }

  function resetCategories() { var s = $("euCategory"); if (s) delete s.dataset.filled; }

  function bind() {
    $("euQuery").addEventListener("input", function (e) {
      clearTimeout(timer);
      var v = e.target.value;
      timer = setTimeout(function () { state.q = v.trim(); state.page = 1; load(); }, 300);
    });
    $("euCategory").addEventListener("change", function (e) { state.category = e.target.value; state.page = 1; load(); });
    $("euPublished").addEventListener("change", function (e) { state.published = e.target.value; state.page = 1; load(); });
    $("euPrev").addEventListener("click", function () { if (state.page > 1) { state.page--; load(); } });
    $("euNext").addEventListener("click", function () { state.page++; load(); });

    $("euList").addEventListener("change", function (e) {
      var row = e.target.closest(".eu-row");
      if (!row) return;
      var id = row.dataset.id, act = e.target.dataset.act, body = {};
      if (act === "pick") body.published = e.target.checked;
      else if (act === "margin") body.marginPercent = e.target.value === "" ? null : e.target.value;
      else return;
      api("/api/admin/easy-unlocker/services/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify(body) })
        .then(function (d) {
          row.classList.toggle("is-on", d.service.published);
          var sale = row.querySelector(".eu-sale");
          if (sale) sale.textContent = saleLabel(d.service.price, d.service.marginPercent);
          status("Opgeslagen.");
        })
        .catch(function (err) {
          status(err.message, true);
          load();
        });
    });

    $("euFile").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) return status("Bestand is te groot (max 20 MB).", true);
      status("Importeren…");
      var reader = new FileReader();
      reader.onload = function () {
        var json;
        try { json = JSON.parse(reader.result); } catch (err) { return status("Dit is geen geldig JSON-bestand.", true); }
        api("/api/admin/easy-unlocker/import", { method: "POST", body: JSON.stringify(json) })
          .then(function (d) { status(d.count + " diensten geïmporteerd."); resetCategories(); state.page = 1; return load(); })
          .catch(function (err) { status(err.message, true); });
      };
      reader.onerror = function () { status("Bestand lezen mislukt.", true); };
      reader.readAsText(file);
    });

    $("euSync").addEventListener("click", function () {
      status("Synchroniseren…");
      api("/api/admin/easy-unlocker/sync", { method: "POST", body: "{}" })
        .then(function (d) { status(d.count + " diensten gesynchroniseerd."); resetCategories(); state.page = 1; return load(); })
        .catch(function (err) { status(err.message, true); });
    });

    $("euTest").addEventListener("click", function () {
      status("Verbinding testen…");
      api("/api/admin/easy-unlocker/test", { method: "POST", body: "{}" })
        .then(function (d) { status("Verbonden. Saldo: " + (d.balance == null ? "onbekend" : d.balance + " " + d.currency)); })
        .catch(function (err) { status(err.message, true); });
    });
  }

  window.euLoad = function () {
    if (!state.loaded && $("euList")) { bind(); state.loaded = true; }
    return load();
  };
})();
