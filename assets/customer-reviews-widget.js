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
      const reviews = Array.isArray(data.reviews) ? data.reviews.slice(0, 12) : [];
      host.innerHTML = '<div class="ht-review-widget-head"><div><strong>' +
        (Number(summary.count) ? Number(summary.average).toFixed(1) + '/5 ★' : 'Klantbeoordelingen') +
        '</strong><span>' + Number(summary.count || 0) + ' gepubliceerde beoordelingen</span></div><a href="/reviews.html">Alle beoordelingen →</a></div>' +
        (reviews.length ? '<div class="ht-review-widget-stage" aria-live="polite">' + reviews.map((review,index) =>
          '<article class="ht-review-widget-card' + (index===0?' is-active':'') + '" aria-hidden="' + (index===0?'false':'true') + '"><div class="ht-review-widget-stars">' +
          '★'.repeat(Number(review.rating)) + '☆'.repeat(5 - Number(review.rating)) +
          '</div><strong>' + esc(review.title || 'Klantbeoordeling') + '</strong><p>' +
          esc(review.body.length > 170 ? review.body.slice(0, 167) + '…' : review.body) +
          '</p><small>' + esc(review.customer_name) + '</small>' +
          (review.admin_reply ? '<div class="ht-review-widget-reply"><b>HOMS TECH:</b> ' + esc(review.admin_reply) + '</div>' : '') +
          '</article>'
        ).join("") + '</div><div class="ht-review-widget-controls"><button type="button" data-review-prev aria-label="Vorige beoordeling">‹</button><span data-review-position>1 / ' + reviews.length + '</span><button type="button" data-review-next aria-label="Volgende beoordeling">›</button></div>' : '<p class="ht-review-widget-empty">Er zijn nog geen gepubliceerde beoordelingen.</p>');
      if (reviews.length > 1) {
        let active = 0, timer;
        const cards = [...host.querySelectorAll(".ht-review-widget-card")];
        const position = host.querySelector("[data-review-position]");
        const show = next => {
          active = (next + cards.length) % cards.length;
          cards.forEach((card,index) => {
            card.classList.toggle("is-active", index === active);
            card.setAttribute("aria-hidden", index === active ? "false" : "true");
          });
          position.textContent = (active + 1) + " / " + cards.length;
        };
        const start = () => { clearInterval(timer); timer = setInterval(() => show(active + 1), 5000); };
        host.querySelector("[data-review-prev]").addEventListener("click",()=>{show(active-1);start();});
        host.querySelector("[data-review-next]").addEventListener("click",()=>{show(active+1);start();});
        host.addEventListener("mouseenter",()=>clearInterval(timer));
        host.addEventListener("mouseleave",start);
        start();
      }
    } catch (error) {
      console.warn("[HOMS TECH] Review widget unavailable:", error);
      host.innerHTML = '<p class="ht-review-widget-empty">Klantbeoordelingen zijn tijdelijk niet beschikbaar.</p><a href="/reviews.html">Bekijk de reviewpagina</a>';
    }
  });
})();