"use strict";

function registerBuybackRoutes(app, { pool, crypto, escapeHtml, fetchImpl, ensureBuybackOrdersTable, validateBuybackOfferedPrice }) {
// =====================================================
// BUYBACK / UW TOESTEL VERKOPEN ORDERS
// =====================================================
// Buyback quote calculator. The admin supplies only the four condition base prices.
// The server applies the shared evaluation rules to the selected answers.
const BUYBACK_PROTOCOLS = Object.freeze({
  // Protocol 1 keeps the existing HOMS TECH calculation.
  '1': Object.freeze({functionsNotWorkingMultiplier:0.70,batteryUnder85Multiplier:0.90}),
  // Protocol 2 matches the new flow shown by the user:
  // functions = no -> 33.3333333333% discount, battery <85% -> 10%.
  '2': Object.freeze({functionsNotWorkingMultiplier:1-(33.3333333333/100),batteryUnder85Multiplier:0.90})
});

app.post("/api/buyback/calculate", async (req, res) => {
  try {
    const b = req.body || {};
    const protocol = String(b.protocol || "2") === "1" ? "1" : "2";
    const rules = BUYBACK_PROTOCOLS[protocol];

    let price = Number(b.conditionBasePrice);
    const storageDelta = Number(b.storageDelta || 0);
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: "Ongeldige basis-inkoopprijs." });
    }
    if (!Number.isFinite(storageDelta)) {
      return res.status(400).json({ error: "Ongeldige opslagprijsaanpassing." });
    }

    // The server starts from the condition price entered by Admin.
    // Storage adjustment is applied before the condition/function rules.
    price = Math.max(0, price + storageDelta);

    const condition = String(b.condition || "").trim();
    const battery = String(b.battery || "").trim();
    const functions = String(b.functions || "").trim();
    const functionsNoLabel = String(b.functionsNoLabel || "Nee").trim();
    const batteryNoLabel = String(b.batteryNoLabel || "Nee").trim();

    // Admin can change the discount values per phone/protocol.
    const functionsDiscount = Math.max(0, Math.min(100,
      Number.isFinite(Number(b.functionsDiscount)) ? Number(b.functionsDiscount) :
      (1-rules.functionsNotWorkingMultiplier)*100
    ));
    const batteryDiscount = Math.max(0, Math.min(100,
      Number.isFinite(Number(b.batteryDiscount)) ? Number(b.batteryDiscount) :
      (1-rules.batteryUnder85Multiplier)*100
    ));

    const fnMultiplier = Math.max(0, 1 - functionsDiscount/100);
    const batMultiplier = Math.max(0, 1 - batteryDiscount/100);

    // Kapot is a direct purchase price: no further questions affect it.
    if (/kapot/i.test(condition)) {
      return res.json({
        success:true,
        price:Number(price.toFixed(2)),
        basePrice:Number(price.toFixed(2)),
        storageDelta:Number(storageDelta.toFixed(2)),
        adjustments:[],
        protocol,
        broken:true,
        rules:{functionsNotWorkingMultiplier:fnMultiplier,batteryUnder85Multiplier:batMultiplier}
      });
    }

    const adjustments = [];

    const functionsNo =
      protocol === "2"
        ? functions === functionsNoLabel
        : /nee|no|niet/i.test(functions);

    if (functionsNo) {
      const before = price;
      price *= fnMultiplier;
      adjustments.push({
        rule:"functions_not_working",
        discountPercent:functionsDiscount,
        multiplier:fnMultiplier,
        before:Number(before.toFixed(2)),
        after:Number(price.toFixed(2))
      });
    }

    const batteryNo =
      protocol === "2"
        ? battery === batteryNoLabel
        : /onder\s*85|<\s*85|nee|no|niet/i.test(battery);

    if (batteryNo) {
      const before = price;
      price *= batMultiplier;
      adjustments.push({
        rule:"battery_under_85",
        discountPercent:batteryDiscount,
        multiplier:batMultiplier,
        before:Number(before.toFixed(2)),
        after:Number(price.toFixed(2))
      });
    }

    price = Math.max(0, Number(price.toFixed(2)));

    res.json({
      success:true,
      price,
      basePrice:Number(Number(b.conditionBasePrice).toFixed(2)),
      storageDelta:Number(storageDelta.toFixed(2)),
      adjustments,
      protocol,
      rules:{
        functionsNotWorkingMultiplier:fnMultiplier,
        batteryUnder85Multiplier:batMultiplier,
        functionsDiscount,
        batteryDiscount
      },
      broken:false
    });
  } catch (error) {
    console.error("Buyback calculate error:", error);
    res.status(500).json({ error:"Prijs kon niet worden berekend." });
  }
});

app.post("/api/buyback/orders", async (req, res) => {
  try {
    await ensureBuybackOrdersTable(pool);
    const b = req.body || {};
    const name = String(b.name || "").trim();
    const email = String(b.email || "").trim().toLowerCase();
    const accountHolderName = String(b.accountHolderName || "").trim().slice(0,160);
    const iban = String(b.iban || "").replace(/\s+/g, "").toUpperCase().slice(0,34);
    const paymentMethod = String(b.paymentMethod || "").trim().slice(0,80);
    const requiresBankDetails = b.tradeIn === true || !paymentMethod.toLowerCase().includes("tegoed");
    if (requiresBankDetails && (!accountHolderName || !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban))) {
      return res.status(400).json({ error: "Vul een geldige IBAN en de naam van de rekeninghouder in." });
    }

    if (!name || !email || !String(b.device || "").trim()) {
      return res.status(400).json({ error: "Naam, e-mailadres en toestel zijn verplicht." });
    }

    let offeredPrice;
    try {
      offeredPrice = validateBuybackOfferedPrice(b.offeredPrice);
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    const isTradeIn = b.tradeIn === true;
    const tradeInToken = isTradeIn ? crypto.randomBytes(32).toString("hex") : "";
    const tradeInTokenHash = tradeInToken ? crypto.createHash("sha256").update(tradeInToken).digest("hex") : "";
    const orderNo = `BT-${Date.now()}`;

    const answers = b.answers && typeof b.answers === "object" && !Array.isArray(b.answers) ? b.answers : {};
    const result = await pool.query(`
      INSERT INTO buyback_orders
      (order_no,name,email,phone,address,device,brand,model,storage,condition,face_id,battery,screen,offered_price,iban,account_holder_name,payment_method,answers,status,trade_in,trade_in_quote_token_hash,trade_in_quote_expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,CASE WHEN $19 THEN 'Wacht op aankoop' ELSE 'Nieuw' END,$19,$20,CASE WHEN $19 THEN NOW()+INTERVAL '24 hours' ELSE NULL END)
      RETURNING id,order_no,status,created_at
    `, [
      orderNo,
      name, email,
      String(b.phone || "").trim(),
      String(b.address || "").trim(),
      String(b.device || "").trim(),
      String(b.brand || "").trim(),
      String(b.model || b.device || "").trim(),
      String(b.storage || "").trim(),
      String(b.condition || "").trim(),
      String(b.faceId || "").trim(),
      String(b.battery || "").trim(),
      String(b.screen || "").trim(),
      offeredPrice,
      iban,
      accountHolderName,
      paymentMethod,
      JSON.stringify(answers),
      isTradeIn,
      tradeInTokenHash
    ]);

    const order = result.rows[0];
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    const ownerEmail = String(
      process.env.BUYBACK_NOTIFICATION_EMAIL ||
      process.env.ORDER_NOTIFICATION_EMAIL ||
      process.env.REPAIR_REQUEST_EMAIL ||
      ""
    ).trim();
    // A trade-in is only a temporary quote until the customer completes and pays for the new-phone order.
    // Do not send a buyback confirmation or owner notification at this stage.
    if (!isTradeIn && apiKey && from) {
      const safeDevice = escapeHtml(b.device || "iPhone");
      const safeName = escapeHtml(name);
      const safeOrder = escapeHtml(order.order_no);
      const customerEmail = {
        from, to:[email], subject:"We hebben uw verkoopaanvraag ontvangen – HOMS TECH",
        html:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;color:#1f2937;line-height:1.6">
          <h2 style="color:#0f2740">Bedankt voor uw aanvraag!</h2>
          <p>Beste ${safeName},</p>
          <p>We hebben uw aanvraag om uw <strong>${safeDevice}</strong> te verkopen goed ontvangen.</p>
          <p>Uw aanvraagnummer is <strong>${safeOrder}</strong>.</p>
          <p>We bekijken de door u ingevulde gegevens en controleren het toestel. Daarna ontvangt u van ons een persoonlijk definitief prijsvoorstel. De getoonde geschatte prijs is nog geen definitief aanbod.</p>
          <p>Na akkoord spreken we de verzending met u af. Als verzending nodig is, ontvangt u de verzendinstructies en het verzendlabel als PDF-bijlage per e-mail.</p>
          <p>Met vriendelijke groet,<br>
          <strong>HOMS TECH</strong>
          </p>
          </div>`
      };
      const ownerNotice = {
        from, to:[ownerEmail], subject:"Nieuwe iPhone-verkoopaanvraag "+order.order_no,
        html:`<div style="font-family:Arial,sans-serif;max-width:650px;margin:auto;padding:24px;color:#1f2937;line-height:1.6">
          <h2>Nieuwe verkoopaanvraag ontvangen</h2>
          <p>
          <strong>Nummer:</strong> ${safeOrder}<br>
          <strong>Toestel:</strong> ${safeDevice}<br>
          <strong>Klant:</strong> ${safeName}<br>
          <strong>E-mail:</strong> ${escapeHtml(email)}<br>
          <strong>Telefoon:</strong> ${escapeHtml(b.phone||"-")}<br>
          <strong>Opslag:</strong> ${escapeHtml(b.storage||"-")}<br>
          <strong>Staat:</strong> ${escapeHtml(b.condition||"-")}<br>
          <strong>Geschatte prijs:</strong> € ${offeredPrice.toFixed(2)}</p>
          <p>Open de HOMS TECH-adminpagina → Verkoopaanvragen om alle antwoorden te bekijken en een definitief aanbod te sturen.</p>
          </div>`
      };
      const sendMail = async mail => {
        const response = await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json"},body:JSON.stringify(mail)});
        const data = await response.json().catch(()=>({}));
        if(!response.ok) throw new Error("Resend "+response.status+": "+JSON.stringify(data));
      };
      const mailTasks = [sendMail(customerEmail)];
      if (ownerEmail) mailTasks.push(sendMail(ownerNotice));
      const mailResults = await Promise.allSettled(mailTasks);
      mailResults.forEach((result, index) => {
        if (result.status !== "rejected") return;
        const label = index === 0
          ? "Buyback customer confirmation email failed:"
          : "Buyback owner notification email failed:";
        console.error(label, result.reason?.message || result.reason);
      });
      if (!ownerEmail) {
        console.warn("Buyback owner notification skipped: configure BUYBACK_NOTIFICATION_EMAIL or ORDER_NOTIFICATION_EMAIL.");
      }
    } else if (isTradeIn) {
      console.log("Trade-in quote saved; confirmation emails are deferred until the linked webshop order is paid.");
    } else {
      console.error("Buyback emails skipped: RESEND_API_KEY or RESEND_FROM_EMAIL is missing.");
    }

    res.status(201).json({ success: true, order, ...(isTradeIn ? { tradeInToken, tradeInCredit: offeredPrice } : {}) });
  } catch (error) {
    console.error("BUYBACK ORDER ERROR:", error);
    res.status(500).json({ error: "Verkoopaanvraag kon niet worden opgeslagen." });
  }
});
}

module.exports = { registerBuybackRoutes };
