"use strict";

function createCustomerEmails({
  getEnv = () => process.env,
  fetchImpl = global.fetch,
  escapeHtml,
  logInfo = console.log
}) {
  if (typeof getEnv !== "function" || typeof fetchImpl !== "function" || typeof escapeHtml !== "function") {
    throw new TypeError("Customer email dependencies are required.");
  }

  async function sendCustomerVerificationEmail(customer, code) {
    const env = getEnv();
    const apiKey = env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY is not configured");

    const from = env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [customer.email],
        subject: "Bevestig je HOMS TECH-account",
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;color:#222;line-height:1.6">
            <h1 style="color:#0f2740">Bevestig je e-mailadres</h1>
            <p>Hallo ${escapeHtml(customer.name || "klant")},</p>
            <p>Bedankt dat je een account bij HOMS TECH aanmaakt. Vul deze code in op de accountpagina om je account te activeren:</p>
            <p style="font-size:32px;font-weight:800;letter-spacing:8px;background:#f1f5f9;padding:18px;text-align:center;border-radius:12px">${escapeHtml(code)}</p>
            <p>De code is 15 minuten geldig. Heb je dit account niet aangevraagd? Negeer deze e-mail dan.</p>
            <p><strong>Team HOMS TECH</strong></p>
            <p style="font-size:12px;color:#64748b">https://homs-tech.nl</p>
          </div>
        `
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Resend verification email error ${response.status}: ${JSON.stringify(data)}`);
    }
    logInfo("Customer verification email sent:", data.id || "ok");
  }

  async function sendWelcomeEmail(customer) {
    const env = getEnv();
    const apiKey = env.RESEND_API_KEY;
    if (!apiKey) {
      logInfo("RESEND_API_KEY is not configured; welcome email skipped.");
      return;
    }

    const from = env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [customer.email],
        subject: "Welkom bij HOMS TECH",
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;color:#222;line-height:1.6">
            <h1 style="margin-bottom:8px;color:#0f2740">Welkom bij HOMS TECH 👋</h1>
            <p>Hallo ${escapeHtml(customer.name)},</p>
            <p>Bedankt voor je registratie bij HOMS TECH!</p>
            <p>Je account is succesvol aangemaakt. Je kunt nu smartphones bekijken en je bestellingen volgen vanuit je account.</p>
            <p style="margin:24px 0"><a href="https://homs-tech.nl" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">Bezoek HOMS TECH</a></p>
            <p>Wil je je wachtwoord wijzigen of ben je het vergeten? Ga naar de accountpagina en kies <strong>Wachtwoord vergeten</strong> om veilig een resetlink te ontvangen.</p>
            <p style="margin-top:28px"><strong>Team HOMS TECH</strong><br>Telefoonservice & smartphones</p>
            <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0">
            <p style="font-size:12px;color:#64748b">Website: <a href="https://homs-tech.nl" style="color:#2563eb">https://homs-tech.nl</a></p>
          </div>
        `
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Resend error ${response.status}: ${JSON.stringify(data)}`);
    }
    logInfo("Welcome email sent:", data.id || "ok");
  }

  return { sendCustomerVerificationEmail, sendWelcomeEmail };
}

module.exports = { createCustomerEmails };
