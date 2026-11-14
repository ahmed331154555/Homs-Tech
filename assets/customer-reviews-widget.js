(() => {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[char]));
  document.querySelectorAll("[data-review-widget]").forEach(async host => {
    const type = String(host.dataset.type || "").trim();
    try {
      const response = await fetch("/api/reviews" + (type ? "?type=" + encodeURIComponent(type) : ""), { headers: { Accept: "application/json" } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Reviews unavailable");
      const summary = data.summary || {};
      const reviews = Array.isArray(data.reviews) ? data.reviews.slice(0, 3) : [];
      host.innerHTML = '<div class="ht-review-widget-head"><div><strong>' +
        (Number(summary.count) ? Number(summary.average).toFixed(1) + '/5 ★' : 'Klantbeoordelingen') +
        '</strong><span>' + Number(summary.count || 0) + ' gepubliceerde beoordelingen</span></div><a href="/reviews.html">Alle beoordelingen →</a></div>' +
        (reviews.length ? '<div class="ht-review-widget-grid">' + reviews.map(review =>
          '<article class="ht-review-widget-card"><div class="ht-review-widget-stars">' +
          '★'.repeat(Number(review.rating)) + '☆'.repeat(5 - Number(review.rating)) +
          '</div><strong>' + esc(review.title || 'Klantbeoordeling') + '</strong><p>' +
          esc(review.body.length > 220 ? review.body.slice(0, 217) + '…' : review.body) +
          '</p><small>' + esc(review.customer_name) + '</small>' +
          (review.admin_reply ? '<div class="ht-review-widget-reply"><b>HOMS TECH:</b> ' + esc(review.admin_reply) + '</div>' : '') +
          '</article>'
        ).join("") + '</div>' : '<p class="ht-review-widget-empty">Er zijn nog geen gepubliceerde beoordelingen.</p>');
    } catch (error) {
      console.warn("[HOMS TECH] Review widget unavailable:", error);
      host.innerHTML = '<p class="ht-review-widget-empty">Klantbeoordelingen zijn tijdelijk niet beschikbaar.</p><a href="/reviews.html">Bekijk de reviewpagina</a>';
    }
  });
})();
