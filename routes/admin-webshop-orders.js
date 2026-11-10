"use strict";

const crypto = require("node:crypto");

const { calculateTradeInAdjustment } = require("../utils/trade-in");
const { sendPaidWebshopOrderNotifications } = require("../utils/webshop-paid-notifications");

const REQUIRED_PHONE_INSPECTION_CHECKS = Object.freeze([
  "model_storage_color",
  "screen_touch",
  "battery",
  "face_id_touch_id",
  "cameras",
  "speakers_microphone",
  "charging",
  "network_wifi_sim",
  "icloud_activation_lock",
  "cosmetic_condition",
  "cleaning",
  "accessories",
  "secure_packaging",
  "shipping_address"
]);

function parseOrderItems(items) {
  if (Array.isArray(items)) return items;
  if (typeof items === "string") {
    try {
      const parsed = JSON.parse(items);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function orderContainsPhone(items) {
  return parseOrderItems(items).some(item => {
    const type = String(item?.type || item?.product_type || item?.category || item?.kind || "").trim().toLowerCase();
    return ["phone", "telefoon", "smartphone", "iphone", "mobile", "device"].includes(type);
  });
}

function phoneInspectionIsComplete(checks) {
  let values = checks;
  if (typeof values === "string") {
    try { values = JSON.parse(values); } catch { values = {}; }
  }
  if (!values || typeof values !== "object" || Array.isArray(values)) values = {};
  return REQUIRED_PHONE_INSPECTION_CHECKS.every(key => values[key] === true);
}


function registerAdminWebshopOrderRoutes(app, { pool, requirePermission, mollieRequest, deductPaidOrderInventory, ensureBuybackOrdersTable, fetchImpl = fetch, getEnv = () => process.env, escapeHtml }) {
  async function notifyPaidTradeInOrder(orderId) {
    try {
      await sendPaidWebshopOrderNotifications({ pool, orderId, fetchImpl, getEnv, escapeHtml });
    } catch (error) {
      console.error("Admin paid trade-in notification processing failed:", orderId, error.message || error);
    }
  }

  async function sendTradeInPayoutConfirmation(orderId) {
    const found=await pool.query(
      `SELECT orders.id,orders.name,orders.email,orders.trade_in_inspected_value,
              orders.trade_in_status,orders.trade_in_snapshot,
              buyback.model AS trade_in_model,buyback.device AS trade_in_device
       FROM webshop_orders orders
       JOIN buyback_orders buyback ON buyback.id=orders.trade_in_order_id
       WHERE orders.id=$1 LIMIT 1`,
      [orderId]
    );
    if(!found.rows.length)return {sent:false,reason:"order-or-trade-in-not-found"};
    const order=found.rows[0];
    if(order.trade_in_status!=="Settled")return {sent:false,reason:"payout-not-confirmed"};
    const snapshot=order.trade_in_snapshot||{};
    if(snapshot.payoutConfirmationEmailSentAt)return {sent:true,alreadySent:true,email:order.email};
    const env=getEnv();
    const apiKey=String(env.RESEND_API_KEY||"").trim();
    const from=String(env.RESEND_FROM_EMAIL||"").trim();
    if(!apiKey||!from)return {sent:false,reason:"email-not-configured"};
    if(!order.email)return {sent:false,reason:"customer-email-missing"};
    const safe=value=>escapeHtml(String(value??""));
    const value=new Intl.NumberFormat("nl-NL",{style:"currency",currency:"EUR"}).format(Number(order.trade_in_inspected_value||0));
    const model=safe(order.trade_in_model||order.trade_in_device||"uw oude iPhone");
    const mail={
      from,to:[order.email],
      subject:"Uw inruilbedrag is overgemaakt – HOMS TECH",
      html:`<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#172b43;line-height:1.6">
        <div style="background:#071d2d;padding:22px;border-radius:14px 14px 0 0;color:#fff;font-size:22px;font-weight:800">HOMS <span style="color:#60a5fa">TECH</span></div>
        <div style="padding:24px;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 14px 14px">
          <h2>Uw inruil is afgerond</h2>
          <p>Beste ${safe(order.name)},</p>
          <p>We bevestigen dat het afgesproken inruilbedrag voor uw ${model} is overgemaakt.</p>
          <div style="padding:18px;background:#ecfdf3;border:1px solid #bbf7d0;border-radius:12px;text-align:center">
            <div style="font-size:13px;color:#64748b">Overgemaakt inruilbedrag</div>
            <div style="font-size:32px;font-weight:800;color:#15803d">${value}</div>
            <div style="font-size:13px;color:#64748b">HOMS TECH · Inruil afgerond</div>
          </div>
          <p>Afhankelijk van uw bank kan het even duren voordat het bedrag zichtbaar is op uw rekening.</p>
          <p>Bedankt voor uw vertrouwen in HOMS TECH!</p>
          <p>Met vriendelijke groet,<br>HOMS TECH</p>
        </div></div>`
    };
    const response=await fetchImpl("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json"},body:JSON.stringify(mail)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error("Resend "+response.status+": "+JSON.stringify(data));
    const sentAt=new Date().toISOString();
    await pool.query(
      "UPDATE webshop_orders SET trade_in_snapshot=COALESCE(trade_in_snapshot,'{}'::jsonb) || $1::jsonb WHERE id=$2 AND trade_in_status='Settled'",
      [JSON.stringify({payoutConfirmationEmailSentAt:sentAt}),orderId]
    );
    return {sent:true,email:order.email,sentAt};
  }

  async function sendTradeInCustomerOffer(orderId) {
    const found = await pool.query(
      `SELECT orders.id,orders.name,orders.email,orders.payment_status,
              orders.trade_in_estimated_value,orders.trade_in_inspected_value,
              orders.trade_in_status,orders.trade_in_snapshot,
              buyback.model AS trade_in_model,buyback.device AS trade_in_device,
              buyback.storage AS trade_in_storage
       FROM webshop_orders orders
       JOIN buyback_orders buyback ON buyback.id=orders.trade_in_order_id
       WHERE orders.id=$1 LIMIT 1`,
      [orderId]
    );
    if (!found.rows.length) return { sent:false, reason:"order-or-trade-in-not-found" };
    const order=found.rows[0];
    if (order.payment_status !== "Paid") {
      return { sent:false, reason:"order-not-paid" };
    }
    if (order.trade_in_status === "Settled") {
      return { sent:false, reason:"trade-in-already-settled" };
    }
    if (order.trade_in_inspected_value===null || order.trade_in_inspected_value===undefined) {
      return { sent:false, reason:"inspection-not-saved" };
    }
    if (!String(order.email || "").trim()) {
      return { sent:false, reason:"customer-email-missing" };
    }
    const env=getEnv();
    const apiKey=String(env.RESEND_API_KEY||"").trim();
    const from=String(env.RESEND_FROM_EMAIL||"").trim();
    if(!apiKey||!from)return {sent:false,reason:"email-not-configured"};
    const token=crypto.randomBytes(32).toString("hex");
    const tokenHash=crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt=new Date(Date.now()+14*24*60*60*1000).toISOString();
    const snapshot={...(order.trade_in_snapshot||{}),customerApprovalTokenHash:tokenHash,customerApprovalExpiresAt:expiresAt,customerApprovalSentAt:new Date().toISOString(),customerApprovalDecision:null,customerApprovalDecisionAt:null};
    await pool.query(
      "UPDATE webshop_orders SET trade_in_status='AwaitingCustomerApproval',trade_in_snapshot=$1::jsonb WHERE id=$2",
      [JSON.stringify(snapshot),orderId]
    );
    const baseUrl=String(env.PUBLIC_SITE_URL||env.APP_URL||"https://homs-tech.nl").trim().replace(/[/]+$/,"");
    const acceptUrl=baseUrl+"/trade-in-response.html?token="+encodeURIComponent(token)+"&decision=accept";
    const rejectUrl=baseUrl+"/trade-in-response.html?token="+encodeURIComponent(token)+"&decision=reject";
    const safe=value=>escapeHtml(String(value??""));
    const model=safe(order.trade_in_model||order.trade_in_device||"Oude iPhone");
    const value=new Intl.NumberFormat("nl-NL",{style:"currency",currency:"EUR"}).format(Number(order.trade_in_inspected_value));
    const estimate=new Intl.NumberFormat("nl-NL",{style:"currency",currency:"EUR"}).format(Number(order.trade_in_estimated_value||0));
    const mail={
      from,to:[order.email],
      subject:"Bevestig de definitieve inruilwaarde van uw iPhone – HOMS TECH",
      html:`<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#172b43;line-height:1.6">
        <div style="background:#071d2d;padding:22px;border-radius:14px 14px 0 0;color:#fff;font-size:22px;font-weight:800">HOMS <span style="color:#60a5fa">TECH</span></div>
        <div style="padding:24px;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 14px 14px">
          <h2>De inspectie van uw oude iPhone is afgerond</h2>
          <p>Beste ${safe(order.name)},</p>
          <p>We hebben uw ${model} gecontroleerd. De definitieve inruilwaarde is vastgesteld op:</p>
          <div style="padding:18px;background:#ecfdf3;border:1px solid #bbf7d0;border-radius:12px;text-align:center">
            <div style="font-size:13px;color:#64748b">Definitieve inruilwaarde</div>
            <div style="font-size:32px;font-weight:800;color:#15803d">${value}</div>
            <div style="font-size:13px;color:#64748b">Eerdere schatting: ${estimate}</div>
          </div>
          <p>Wilt u akkoord gaan met deze definitieve waarde? Kies hieronder akkoord of niet akkoord. We maken de inruil pas definitief nadat u uw keuze heeft bevestigd.</p>
          <p style="margin:26px 0"><a href="${acceptUrl}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:14px 22px;border-radius:9px;font-weight:700">✓ Akkoord met ${value}</a></p>
          <p><a href="${rejectUrl}" style="display:inline-block;background:#fff;color:#b91c1c;text-decoration:none;padding:12px 18px;border:1px solid #fecaca;border-radius:9px;font-weight:700">Niet akkoord</a></p>
          <p style="font-size:12px;color:#64748b">Deze keuze is 14 dagen geldig. Als u niet akkoord gaat, nemen we contact met u op over het terugsturen van uw toestel. Er wordt niets uitbetaald voordat u akkoord bent gegaan.</p>
          <p>Met vriendelijke groet,<br>HOMS TECH</p>
        </div></div>`
    };
    const response=await fetchImpl("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json"},body:JSON.stringify(mail)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error("Resend "+response.status+": "+JSON.stringify(data));
    return {sent:true,email:order.email};
  }
  app.put("/api/admin/webshop-orders/:id/payment", requirePermission("webshop_orders.update"), async (req,res) => {
    try {
      const id=Number(req.params.id);
      if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Ongeldig order-ID."});
      const paymentStatus=String(req.body?.payment_status||"").trim();
      if(!["Unpaid","Processing","Paid","Failed"].includes(paymentStatus))return res.status(400).json({error:"Ongeldige betaalstatus."});
      const updated=await pool.query(
        `UPDATE webshop_orders
         SET payment_status=$1
         WHERE id=$2
           AND (COALESCE(payment_status,'Unpaid') <> 'Paid' OR $1 = 'Paid')
           AND (inventory_deducted_at IS NULL OR $1 = 'Paid')
         RETURNING id,payment_status,inventory_deducted_at`,
        [paymentStatus,id]
      );
      if(!updated.rows.length){
        const existing=await pool.query("SELECT id,payment_status,inventory_deducted_at FROM webshop_orders WHERE id=$1",[id]);
        if(!existing.rows.length)return res.status(404).json({error:"Bestelling niet gevonden."});
        if(existing.rows[0].payment_status==="Paid"&&paymentStatus!=="Paid")
          return res.status(409).json({error:"Een betaalde bestelling kan niet rechtstreeks worden teruggezet. Verwerk eerst een terugbetaling."});
        if(existing.rows[0].inventory_deducted_at&&paymentStatus!=="Paid")
          return res.status(409).json({error:"De voorraad is al verwerkt; de betaalstatus kan niet worden teruggezet."});
        return res.status(409).json({error:"De betaalstatus kon niet worden opgeslagen."});
      }
      let inventoryWarning="";
      if(paymentStatus==="Paid"){
        const inventoryResult=await deductPaidOrderInventory(id);
        if(inventoryResult?.error){
          const latest=await pool.query("SELECT inventory_error FROM webshop_orders WHERE id=$1",[id]);
          inventoryWarning=String(latest.rows[0]?.inventory_error||"Controleer de voorraad van deze bestelling.");
        }
        await notifyPaidTradeInOrder(id);
      }
      const latest=await pool.query(
        "SELECT id,payment_status,inventory_deducted_at,inventory_error FROM webshop_orders WHERE id=$1",[id]
      );
      return res.json({success:true,order:latest.rows[0],inventory_warning:inventoryWarning||null});
    }catch(error){
      console.error("Save webshop payment status error:",error);
      return res.status(500).json({error:"Betaalstatus kon niet worden opgeslagen."});
    }
  });

  app.put("/api/admin/webshop-orders/:id/inspection", requirePermission("webshop_orders.update"), async (req,res) => {
    try {
      const id=Number(req.params.id);
      if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Ongeldig order-ID."});
      const submitted=req.body?.checks;
      if(!submitted||typeof submitted!=="object"||Array.isArray(submitted)) {
        return res.status(400).json({error:"De controlelijst ontbreekt of is ongeldig."});
      }
      const checks={};
      for(const key of REQUIRED_PHONE_INSPECTION_CHECKS) checks[key]=submitted[key]===true;
      const complete=REQUIRED_PHONE_INSPECTION_CHECKS.every(key=>checks[key]===true);
      const saved=await pool.query(
        `INSERT INTO webshop_order_inspections (order_id,checks,inspected_by,completed_at,updated_at)
         SELECT id,$2::jsonb,'HOMS TECH Admin',CASE WHEN $3 THEN NOW() ELSE NULL END,NOW()
         FROM webshop_orders WHERE id=$1
         ON CONFLICT (order_id) DO UPDATE SET
           checks=EXCLUDED.checks,
           inspected_by=EXCLUDED.inspected_by,
           completed_at=CASE WHEN $3 THEN COALESCE(webshop_order_inspections.completed_at,NOW()) ELSE NULL END,
           updated_at=NOW()
         RETURNING order_id,checks,inspected_by,completed_at,updated_at`,
        [id,JSON.stringify(checks),complete]
      );
      if(!saved.rows.length)return res.status(404).json({error:"Bestelling niet gevonden."});
      return res.json({success:true,inspection:saved.rows[0],complete,required:REQUIRED_PHONE_INSPECTION_CHECKS.length});
    } catch(error) {
      console.error("Save webshop phone inspection error:",error);
      return res.status(500).json({error:"De telefooncontrole kon niet worden opgeslagen."});
    }
  });

  app.put("/api/admin/webshop-orders/:id/shipping", requirePermission("webshop_orders.update"), async (req,res) => {
    try{
      const id=Number(req.params.id);
      if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Ongeldig order-ID."});
      const body=req.body||{};
      const carrier=String(body.shipping_method||"").trim();
      const paymentStatus=String(body.payment_status||"Unpaid").trim();
      const trackingNumber=String(body.tracking_number||"").trim().slice(0,160);
      const trackingUrl=String(body.tracking_url||"").trim().slice(0,1000);
      // Reject malformed client input before touching the database.
      if(carrier&& !["PostNL","DHL"].includes(carrier))return res.status(400).json({error:"Kies alleen PostNL of DHL."});
      if(!["Unpaid","Processing","Paid","Failed"].includes(paymentStatus))return res.status(400).json({error:"Ongeldige betaalstatus."});
      if(trackingUrl&&!/^https:\/\//i.test(trackingUrl))return res.status(400).json({error:"De tracking-URL moet beginnen met https://"});
      const tradeInCheck=await pool.query(
        `SELECT webshop_orders.items,
                COALESCE(phone_inspection.checks,'{}'::jsonb) AS checks,
                EXISTS(
                  SELECT 1
                  FROM buyback_orders buyback
                  WHERE buyback.id=webshop_orders.trade_in_order_id
                    AND buyback.trade_in_linked_order_id=webshop_orders.id
                    AND COALESCE(webshop_orders.trade_in_applied_credit,0)>0
                ) AS has_valid_trade_in,
                webshop_orders.trade_in_status
         FROM webshop_orders
         LEFT JOIN webshop_order_inspections phone_inspection
           ON phone_inspection.order_id=webshop_orders.id
         WHERE webshop_orders.id=$1`,
        [id]
      );
      if(!tradeInCheck.rows.length)return res.status(404).json({error:"Bestelling niet gevonden."});
      const order=tradeInCheck.rows[0];
      if((carrier||trackingNumber||trackingUrl) && orderContainsPhone(order.items) && !phoneInspectionIsComplete(order.checks)){
        return res.status(409).json({error:"Verzendgegevens kunnen pas worden opgeslagen nadat alle verplichte telefooncontrolepunten zijn afgerond."});
      }
      if(order.has_valid_trade_in && order.trade_in_status!=="Settled" && (carrier||trackingNumber||trackingUrl)){
        return res.status(409).json({error:"Verzending is geblokkeerd totdat het inruiltoestel is gecontroleerd en het prijsverschil is afgehandeld."});
      }
      const result=await pool.query(
        `UPDATE webshop_orders
         SET shipping_method=$1, payment_status=$2, tracking_number=$3, tracking_url=$4
         WHERE id=$5
           AND (COALESCE(payment_status,'Unpaid') <> 'Paid' OR $2 = 'Paid')
           AND (inventory_deducted_at IS NULL OR $2 = 'Paid')
         RETURNING id,shipping_method,payment_status,tracking_number,tracking_url`,
        [carrier,paymentStatus,trackingNumber,trackingUrl,id]
      );
      if(!result.rows.length){
        const existing=await pool.query("SELECT id,payment_status,inventory_deducted_at FROM webshop_orders WHERE id=$1",[id]);
        if(!existing.rows.length)return res.status(404).json({error:"Bestelling niet gevonden."});
        return res.status(409).json({error:"Deze bestelling is al betaald of de voorraad is al verwerkt. De betaalstatus kan niet worden teruggezet."});
      }
      if(paymentStatus==="Paid"){
        const inventoryResult=await deductPaidOrderInventory(id);
        if(inventoryResult?.error){
          return res.status(409).json({error:"De betaling staat op betaald, maar de voorraad kon niet worden bijgewerkt. Controleer de voorraadfout bij deze bestelling."});
        }
        await notifyPaidTradeInOrder(id);
      }
      res.json({success:true,order:result.rows[0]});
    }catch(error){
      console.error("Save webshop shipping details error:",error);
      res.status(500).json({error:"Verzend- en betaalgegevens konden niet worden opgeslagen."});
    }
  });

  app.get("/api/admin/webshop-orders", requirePermission("webshop_orders.view"), async (req, res) => {
    try {
      if (typeof ensureBuybackOrdersTable === "function") await ensureBuybackOrdersTable(pool);
      const result = await pool.query(
        `SELECT webshop_orders.id, webshop_orders.customer_id, webshop_orders.name, webshop_orders.email,
                webshop_orders.phone, webshop_orders.street, webshop_orders.house_number,
                webshop_orders.postcode, webshop_orders.city, webshop_orders.items, webshop_orders.total,
                webshop_orders.status, webshop_orders.payment_method, webshop_orders.payment_status,
                webshop_orders.paypal_order_id, webshop_orders.mollie_payment_id,
                webshop_orders.inventory_deducted_at, webshop_orders.inventory_error,
                COALESCE(phone_inspection.checks,'{}'::jsonb) AS inspection_checks,
                phone_inspection.inspected_by AS inspection_inspected_by,
                phone_inspection.completed_at AS inspection_completed_at,
                phone_inspection.updated_at AS inspection_updated_at,
                CASE WHEN buyback_orders.trade_in_linked_order_id=webshop_orders.id
                       AND COALESCE(webshop_orders.trade_in_applied_credit,0)>0
                     THEN webshop_orders.trade_in_order_id ELSE NULL END AS trade_in_order_id,
                webshop_orders.trade_in_estimated_value,
                webshop_orders.trade_in_applied_credit, webshop_orders.trade_in_inspected_value,
                webshop_orders.trade_in_adjustment,
                CASE WHEN buyback_orders.trade_in_linked_order_id=webshop_orders.id
                     THEN webshop_orders.trade_in_status ELSE NULL END AS trade_in_status,
                webshop_orders.trade_in_snapshot,
                buyback_orders.device AS trade_in_device, buyback_orders.model AS trade_in_model,
                buyback_orders.storage AS trade_in_storage, buyback_orders.condition AS trade_in_condition,
                buyback_orders.battery AS trade_in_battery, buyback_orders.face_id AS trade_in_face_id,
                buyback_orders.screen AS trade_in_screen, buyback_orders.answers AS trade_in_answers,
                buyback_orders.status AS trade_in_buyback_status,
                webshop_orders.created_at,
                COALESCE((
                  SELECT json_agg(
                    json_build_object('status', history.status, 'created_at', history.created_at)
                    ORDER BY history.created_at ASC, history.id ASC
                  )
                  FROM webshop_order_status_history history
                  WHERE history.order_id = webshop_orders.id
                ), '[]'::json) AS status_history,
                COALESCE((
                  SELECT json_agg(
                    json_build_object('note', notes.note, 'created_by', notes.created_by, 'created_at', notes.created_at)
                    ORDER BY notes.created_at DESC, notes.id DESC
                  )
                  FROM webshop_order_notes notes
                  WHERE notes.order_id = webshop_orders.id
                ), '[]'::json) AS notes,
                COALESCE((
                  SELECT json_agg(json_build_object(
                    'id',refund.id,'amount',refund.amount,'currency',refund.currency,
                    'method',refund.method,'status',refund.status,'reason',refund.reason,
                    'provider_refund_id',refund.provider_refund_id,
                    'created_at',refund.created_at,'processed_at',refund.processed_at
                  ) ORDER BY refund.created_at DESC,refund.id DESC)
                  FROM webshop_order_refunds refund
                  WHERE refund.order_id=webshop_orders.id
                ), '[]'::json) AS refunds
         FROM webshop_orders
         LEFT JOIN webshop_order_inspections phone_inspection ON phone_inspection.order_id=webshop_orders.id
         LEFT JOIN buyback_orders ON buyback_orders.id = webshop_orders.trade_in_order_id
                                      AND buyback_orders.trade_in_linked_order_id = webshop_orders.id
                                      AND COALESCE(webshop_orders.trade_in_applied_credit,0)>0
         ORDER BY webshop_orders.created_at DESC`
      );
      res.json({ orders: result.rows });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Webshop bestellingen konden niet worden geladen." });
    }
  });

  app.post("/api/admin/webshop-orders/:id/notes", requirePermission("webshop_orders.update"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const note = String(req.body?.note || "").trim();
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Ongeldig order-ID." });
      if (!note || note.length > 2000) return res.status(400).json({ error: "Een notitie moet tussen 1 en 2000 tekens bevatten." });
      const result = await pool.query(
        `INSERT INTO webshop_order_notes (order_id, note, created_by)
         SELECT id, $2, 'HOMS TECH Admin'
         FROM webshop_orders
         WHERE id = $1
         RETURNING id, note, created_by, created_at`,
        [id, note]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Bestelling niet gevonden." });
      res.status(201).json({ success: true, note: result.rows[0] });
    } catch (error) {
      console.error("Save webshop order note error:", error);
      res.status(500).json({ error: "Notitie kon niet worden opgeslagen." });
    }
  });

  app.post("/api/admin/webshop-orders/:id/refund", requirePermission("webshop_orders.update"), async (req,res) => {
    const id=Number(req.params.id);
    const amount=Number(req.body?.amount);
    const reason=String(req.body?.reason||"").trim().slice(0,500);
    const method=String(req.body?.method||"Manual").trim();
    if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Ongeldig order-ID."});
    const amountCents=Math.round(amount*100);
    if(!Number.isFinite(amount)||amount<=0||amount>100000||!Number.isSafeInteger(amountCents)||Math.abs(amount*100-amountCents)>1e-7)
      return res.status(400).json({error:"Vul een geldig terug te betalen bedrag in hele eurocenten in."});
    if(!["Mollie","Manual"].includes(method))return res.status(400).json({error:"Ongeldige terugbetaalmethode."});
    const client=await pool.connect();
    let refund;
    let order;
    try{
      await client.query("BEGIN");
      const found=await client.query(
        "SELECT id,total,payment_status,payment_method,mollie_payment_id FROM webshop_orders WHERE id=$1 FOR UPDATE",
        [id]
      );
      if(!found.rows.length){await client.query("ROLLBACK");return res.status(404).json({error:"Bestelling niet gevonden."});}
      order=found.rows[0];
      if(order.payment_status!=="Paid"){await client.query("ROLLBACK");return res.status(409).json({error:"Alleen een betaalde bestelling kan worden terugbetaald."});}
      if(method==="Mollie"&&(order.payment_method!=="Mollie"||!order.mollie_payment_id)){
        await client.query("ROLLBACK");return res.status(409).json({error:"Deze bestelling heeft geen Mollie-betaling om automatisch terug te betalen."});
      }
      const previous=await client.query(
        "SELECT COALESCE(SUM(amount),0) AS total FROM webshop_order_refunds WHERE order_id=$1 AND status IN ('Processing','Pending manual','Processed')",
        [id]
      );
      const remaining=Math.max(0,Number(order.total)-Number(previous.rows[0]?.total||0));
      if(amount>remaining+0.009){await client.query("ROLLBACK");return res.status(409).json({error:"Het terug te betalen bedrag is hoger dan het resterende betaalde bedrag (€ "+remaining.toFixed(2)+")."});}
      const inserted=await client.query(
        `INSERT INTO webshop_order_refunds(order_id,amount,method,status,reason)
         VALUES($1,$2,$3,$4,$5) RETURNING id,amount,currency,method,status,reason,created_at`,
        [id,(amountCents/100).toFixed(2),method,method==="Mollie"?"Processing":"Pending manual",reason]
      );
      refund=inserted.rows[0];
      await client.query("COMMIT");
    }catch(error){
      try{await client.query("ROLLBACK");}catch{}
      console.error("Create webshop refund request error:",error);
      return res.status(500).json({error:"Terugbetaling kon niet worden aangemaakt."});
    }finally{client.release();}

    if(method==="Manual")return res.status(201).json({success:true,refund,message:"Terugbetaling geregistreerd als handmatig uit te voeren."});
    try{
      if(typeof mollieRequest!=="function")throw new Error("Mollie refund service is not configured.");
      const value=Number(refund.amount).toFixed(2);
      const result=await mollieRequest("/payments/"+encodeURIComponent(order.mollie_payment_id)+"/refunds",{
        method:"POST",
        headers:{"Idempotency-Key":"homs-tech-order-refund-"+id+"-"+refund.id},
        body:JSON.stringify({amount:{currency:"EUR",value},description:"HOMS TECH bestelling #"+id+" terugbetaling"})
      });
      const providerStatus=String(result.status||"queued").toLowerCase();
      const refundStatus=providerStatus==="refunded"?"Processed":"Processing";
      const saved=await pool.query(
        "UPDATE webshop_order_refunds SET status=$1,provider_refund_id=$2,processed_at=CASE WHEN $1='Processed' THEN NOW() ELSE NULL END WHERE id=$3 RETURNING id,amount,currency,method,status,reason,provider_refund_id,created_at,processed_at",
        [refundStatus,String(result.id||""),refund.id]
      );
      return res.status(201).json({success:true,refund:saved.rows[0],message:refundStatus==="Processed"?"Mollie bevestigde de terugbetaling.":"Mollie heeft de terugbetaling ontvangen en verwerkt deze verder."});
    }catch(error){
      // A provider/network error can happen after Mollie accepted the refund.
      // Keep the amount reserved as Processing until the provider status is checked;
      // marking it Failed here could allow a duplicate refund on the next attempt.
      await pool.query(
        "UPDATE webshop_order_refunds SET status='Processing' WHERE id=$1 AND status='Processing'",
        [refund.id]
      ).catch(() => {});
      console.error("Mollie refund result requires reconciliation:",error.statusCode||error.message);
      return res.status(502).json({error:"Mollie kon de terugbetaling niet bevestigen. De aanvraag blijft in controle; controleer eerst de status in Mollie voordat je een nieuwe terugbetaling uitvoert."});
    }
  });

  app.put("/api/admin/webshop-orders/:id/refund/:refundId/complete", requirePermission("webshop_orders.update"), async (req,res) => {
    const orderId=Number(req.params.id), refundId=Number(req.params.refundId);
    const reference=String(req.body?.reference||"").trim().slice(0,160);
    if(!Number.isInteger(orderId)||orderId<1||!Number.isInteger(refundId)||refundId<1)return res.status(400).json({error:"Ongeldig order- of terugbetalingsnummer."});
    if(!reference)return res.status(400).json({error:"Vul een bankreferentie of interne bevestiging in."});
    try{
      const result=await pool.query(
        "UPDATE webshop_order_refunds SET status='Processed',provider_refund_id=$1,processed_at=NOW() WHERE id=$2 AND order_id=$3 AND method='Manual' AND status='Pending manual' RETURNING id,amount,currency,method,status,reason,provider_refund_id,created_at,processed_at",
        [reference,refundId,orderId]
      );
      if(!result.rows.length)return res.status(409).json({error:"Deze handmatige terugbetaling bestaat niet meer of is al verwerkt."});
      return res.json({success:true,refund:result.rows[0]});
    }catch(error){
      console.error("Complete manual webshop refund error:",error);
      return res.status(500).json({error:"Handmatige terugbetaling kon niet worden bevestigd."});
    }
  });

  app.put("/api/admin/webshop-orders/:id/status", requirePermission("webshop_orders.update"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Ongeldig order-ID." });
      const allowed = ["Nieuw", "In behandeling", "Verzonden", "Voltooid", "Geannuleerd"];
      const status = String(req.body?.status || "").trim();
      if (!allowed.includes(status)) return res.status(400).json({ error: "Ongeldige status." });
      if(["Verzonden","Voltooid"].includes(status)){
        const orderResult=await pool.query(
          `SELECT webshop_orders.items,
                  COALESCE(phone_inspection.checks,'{}'::jsonb) AS checks,
                  EXISTS(
                    SELECT 1
                    FROM buyback_orders buyback
                    WHERE buyback.id=webshop_orders.trade_in_order_id
                      AND buyback.trade_in_linked_order_id=webshop_orders.id
                      AND COALESCE(webshop_orders.trade_in_applied_credit,0)>0
                  ) AS has_valid_trade_in,
                  webshop_orders.trade_in_status
           FROM webshop_orders
           LEFT JOIN webshop_order_inspections phone_inspection
             ON phone_inspection.order_id=webshop_orders.id
           WHERE webshop_orders.id=$1`,
          [id]
        );
        if(!orderResult.rows.length)return res.status(404).json({error:"Webshop bestelling niet gevonden."});
        const order=orderResult.rows[0];
        if(orderContainsPhone(order.items) && !phoneInspectionIsComplete(order.checks)){
          return res.status(409).json({error:"Alle verplichte controlepunten moeten zijn afgerond voordat deze telefoonbestelling kan worden verzonden of voltooid."});
        }
        if(order.has_valid_trade_in && order.trade_in_status!=="Settled"){
          return res.status(409).json({error:"Deze bestelling kan pas worden verzonden of voltooid nadat de inruilcontrole en eventuele verrekening zijn afgerond."});
        }
      }
      const result = await pool.query(
        `WITH previous AS (
           SELECT status FROM webshop_orders WHERE id = $2 FOR UPDATE
         ),
         updated AS (
           UPDATE webshop_orders
           SET status = $1
           WHERE id = $2
             AND (
               NOT (payment_status = 'Paid' AND $1 = 'Geannuleerd')
               OR EXISTS (
                 SELECT 1 FROM webshop_order_refunds refund
                 WHERE refund.order_id=webshop_orders.id
                   AND refund.status IN ('Processing','Pending manual','Processed')
               )
             )
           RETURNING id, status
         ),
         logged AS (
           INSERT INTO webshop_order_status_history (order_id, status, created_at)
           SELECT updated.id, updated.status, NOW()
           FROM updated
           CROSS JOIN previous
           WHERE previous.status IS DISTINCT FROM updated.status
           RETURNING id
         )
         SELECT updated.id, updated.status FROM updated`,
        [status, id]
      );
      if (!result.rows.length) {
        const existing = await pool.query("SELECT id, payment_status FROM webshop_orders WHERE id = $1", [id]);
        if (!existing.rows.length) return res.status(404).json({ error: "Webshop bestelling niet gevonden." });
        if (existing.rows[0].payment_status === "Paid" && status === "Geannuleerd") {
          return res.status(409).json({ error: "Een betaalde bestelling kan niet rechtstreeks worden geannuleerd. Registreer eerst de volledige of gedeeltelijke terugbetaling." });
        }
        return res.status(409).json({ error: "De bestelstatus kon niet worden gewijzigd." });
      }
      res.json({ success: true, order: result.rows[0] });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Status kon niet worden gewijzigd." });
    }
  });

  app.put("/api/admin/webshop-orders/:id/trade-in-inspection", requirePermission("buyback_orders.update"), async (req,res) => {
    const id=Number(req.params.id);
    const inspectedValue=Number(req.body?.inspectedValue);
    const reason=String(req.body?.reason||"").trim().slice(0,1000);
    if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Ongeldig order-ID."});
    if(!Number.isFinite(inspectedValue)||inspectedValue<0||inspectedValue>100000)return res.status(400).json({error:"Vul een geldige definitieve inruilwaarde in."});
    if(reason.length<5)return res.status(400).json({error:"Geef een korte reden voor de inspectie."});
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      const found=await client.query(
        "SELECT id,trade_in_order_id,trade_in_estimated_value,trade_in_status,payment_status FROM webshop_orders WHERE id=$1 FOR UPDATE",
        [id]
      );
      if(!found.rows.length){await client.query("ROLLBACK");return res.status(404).json({error:"Webshop bestelling niet gevonden."});}
      const order=found.rows[0];
      if(order.payment_status!=="Paid"){await client.query("ROLLBACK");return res.status(409).json({error:"De inruilcontrole kan pas starten nadat de betaling van de nieuwe telefoon is bevestigd."});}
      if(!order.trade_in_order_id){await client.query("ROLLBACK");return res.status(409).json({error:"Deze bestelling heeft geen gekoppelde inruil."});}
      if(order.trade_in_status==="Settled"){await client.query("ROLLBACK");return res.status(409).json({error:"De inruil is al definitief afgehandeld."});}
      const buyback=await client.query("SELECT id,offered_price FROM buyback_orders WHERE id=$1 FOR UPDATE",[order.trade_in_order_id]);
      if(!buyback.rows.length){await client.query("ROLLBACK");return res.status(409).json({error:"De gekoppelde inruilaanvraag ontbreekt."});}
      const adjustment=calculateTradeInAdjustment(order.trade_in_estimated_value,inspectedValue);
      // Always require an explicit payout record after inspection, even when the inspected value matches the estimate.
      const nextStatus="AdjustmentRequired";
      const updated=await client.query(
        `UPDATE webshop_orders
         SET trade_in_inspected_value=$1,trade_in_adjustment=$2,trade_in_status=$3,
             trade_in_snapshot=COALESCE(trade_in_snapshot,'{}'::jsonb) || $4::jsonb
         WHERE id=$5
         RETURNING id,trade_in_order_id,trade_in_estimated_value,trade_in_applied_credit,
                   trade_in_inspected_value,trade_in_adjustment,trade_in_status,trade_in_snapshot`,
        [inspectedValue,adjustment.customerCredit-adjustment.customerDue,nextStatus,
         JSON.stringify({inspectionReason:reason,inspectionAt:new Date().toISOString(),adjustmentDirection:adjustment.direction,
           customerDue:adjustment.customerDue,customerCredit:adjustment.customerCredit}),id]
      );
      await client.query(
        `UPDATE buyback_orders
         SET trade_in_inspected_value=$1,trade_in_adjustment_reason=$2,trade_in_adjustment_status=$3,
             status=CASE WHEN $3='Settled' THEN 'Voltooid' ELSE 'In behandeling' END
         WHERE id=$4`,
        [inspectedValue,reason,nextStatus==="Settled"?"Settled":"AdjustmentRequired",order.trade_in_order_id]
      );
      await client.query("COMMIT");
      let customerOffer={sent:false,reason:"not-sent"};
      try{customerOffer=await sendTradeInCustomerOffer(id);}catch(emailError){console.error("Trade-in offer email failed after inspection:",id,emailError.message||emailError);customerOffer={sent:false,reason:"send-failed"};}
      return res.json({success:true,order:updated.rows[0],adjustment,customerOffer});
    }catch(error){
      try{await client.query("ROLLBACK");}catch{}
      console.error("Webshop trade-in inspection error:",error);
      return res.status(500).json({error:"De inruilcontrole kon niet worden opgeslagen."});
    }finally{client.release();}
  });

  app.put("/api/admin/webshop-orders/:id/trade-in-offer", requirePermission("buyback_orders.update"), async (req,res) => {
    const id=Number(req.params.id);
    if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Ongeldig order-ID."});
    try{
      const result=await sendTradeInCustomerOffer(id);
      if(!result.sent){
        const messages={
          "email-not-configured":"E-mail is niet ingesteld. Controleer RESEND_API_KEY en RESEND_FROM_EMAIL.",
          "inspection-not-saved":"Sla eerst de definitieve inspectiewaarde op.",
          "order-not-paid":"De nieuwe bestelling moet eerst betaald zijn voordat het inruilvoorstel kan worden verzonden.",
          "trade-in-already-settled":"Deze inruil is al definitief afgehandeld. Een nieuw voorstel kan niet worden geopend.",
          "customer-email-missing":"Voeg eerst een geldig e-mailadres van de klant toe."
        };
        return res.status(409).json({error:messages[result.reason]||"Het inruilvoorstel kan momenteel niet worden verzonden."});
      }
      return res.json({success:true,customerEmail:result.email});
    }catch(error){
      console.error("Trade-in customer offer email failed:",id,error.message||error);
      return res.status(502).json({error:"Het voorstel kon niet naar de klant worden verzonden. Controleer de e-mailinstellingen en probeer opnieuw."});
    }
  });

  app.post("/api/trade-in/decision", async (req,res) => {
    const token=String(req.body?.token||"").trim();
    const decision=String(req.body?.decision||"").trim();
    if(!/^[a-f0-9]{64}$/i.test(token)||!["accept","reject"].includes(decision))return res.status(400).json({error:"Ongeldige bevestigingslink."});
    const tokenHash=crypto.createHash("sha256").update(token).digest("hex");
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      const found=await client.query(
        "SELECT id,trade_in_order_id,trade_in_status,trade_in_snapshot,payment_status FROM webshop_orders WHERE trade_in_snapshot->>'customerApprovalTokenHash'=$1 FOR UPDATE",
        [tokenHash]
      );
      if(!found.rows.length){await client.query("ROLLBACK");return res.status(404).json({error:"Deze bevestigingslink is ongeldig of al gebruikt."});}
      const order=found.rows[0],snapshot=order.trade_in_snapshot||{};
      if(order.trade_in_status!=="AwaitingCustomerApproval"){await client.query("ROLLBACK");return res.status(409).json({error:"Uw keuze is al verwerkt of dit voorstel is niet meer actief."});}
      if(order.payment_status!=="Paid"){await client.query("ROLLBACK");return res.status(409).json({error:"De bestelling is niet meer betaald. Neem contact met HOMS TECH op."});}
      if(!Number.isSafeInteger(Number(order.trade_in_order_id))||Number(order.trade_in_order_id)<1){await client.query("ROLLBACK");return res.status(409).json({error:"De gekoppelde inruilaanvraag ontbreekt."});}
      const linkedBuyback=await client.query("SELECT id FROM buyback_orders WHERE id=$1 FOR UPDATE",[order.trade_in_order_id]);
      if(!linkedBuyback.rows.length){await client.query("ROLLBACK");return res.status(409).json({error:"De gekoppelde inruilaanvraag ontbreekt."});}
      if(!snapshot.customerApprovalExpiresAt||new Date(snapshot.customerApprovalExpiresAt).getTime()<Date.now()){await client.query("ROLLBACK");return res.status(410).json({error:"Deze bevestigingslink is verlopen. Neem contact met HOMS TECH op."});}
      const nextStatus=decision==="accept"?"CustomerAccepted":"CustomerRejected";
      const updatedSnapshot={...snapshot,customerApprovalDecision:decision,customerApprovalDecisionAt:new Date().toISOString(),customerApprovalTokenHash:null};
      await client.query("UPDATE webshop_orders SET trade_in_status=$1,trade_in_snapshot=$2::jsonb WHERE id=$3",[nextStatus,JSON.stringify(updatedSnapshot),order.id]);
      await client.query("UPDATE buyback_orders SET trade_in_adjustment_status=$1,status=$2 WHERE id=$3",[nextStatus,decision==="accept"?"In behandeling":"Afgekeurd",order.trade_in_order_id]);
      await client.query("COMMIT");
      return res.json({success:true,decision,status:nextStatus});
    }catch(error){
      try{await client.query("ROLLBACK");}catch{}
      console.error("Trade-in customer decision failed:",error);
      return res.status(500).json({error:"Uw keuze kon niet worden opgeslagen. Probeer het later opnieuw."});
    }finally{client.release();}
  });

  app.put("/api/admin/webshop-orders/:id/trade-in-settlement", requirePermission("buyback_orders.update"), async (req,res) => {
    const id=Number(req.params.id);
    const note=String(req.body?.settlementNote||"").trim().slice(0,1000);
    if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Ongeldig order-ID."});
    if(note.length<5)return res.status(400).json({error:"Vermeld wanneer en hoe de definitieve inruilwaarde is overgemaakt."});
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      const found=await client.query("SELECT id,trade_in_order_id,trade_in_status,trade_in_snapshot,payment_status FROM webshop_orders WHERE id=$1 FOR UPDATE",[id]);
      if(!found.rows.length){await client.query("ROLLBACK");return res.status(404).json({error:"Webshop bestelling niet gevonden."});}
      const order=found.rows[0];
      if(order.payment_status!=="Paid"){
        await client.query("ROLLBACK");return res.status(409).json({error:"De webshop bestelling moet betaald zijn voordat de inruil kan worden afgerond."});
      }
      if(!order.trade_in_order_id||order.trade_in_status!=="CustomerAccepted"){
        await client.query("ROLLBACK");return res.status(409).json({error:"De klant heeft nog niet akkoord gegeven op de definitieve inruilwaarde."});
      }
      const linkedBuyback=await client.query("SELECT id FROM buyback_orders WHERE id=$1 FOR UPDATE",[order.trade_in_order_id]);
      if(!linkedBuyback.rows.length){
        await client.query("ROLLBACK");return res.status(409).json({error:"De gekoppelde inruilaanvraag ontbreekt."});
      }
      const snapshot={...(order.trade_in_snapshot||{}),settlementNote:note,settledAt:new Date().toISOString()};
      const updated=await client.query(
        "UPDATE webshop_orders SET trade_in_status='Settled',trade_in_snapshot=$1::jsonb WHERE id=$2 RETURNING id,trade_in_status,trade_in_snapshot",
        [JSON.stringify(snapshot),id]
      );
      await client.query(
        "UPDATE buyback_orders SET trade_in_adjustment_status='Settled',status='Voltooid' WHERE id=$1",
        [order.trade_in_order_id]
      );
      await client.query("COMMIT");
      let payoutEmail={sent:false,reason:"not-sent"};
      try{payoutEmail=await sendTradeInPayoutConfirmation(id);}catch(emailError){console.error("Trade-in payout confirmation email failed:",id,emailError.message||emailError);payoutEmail={sent:false,reason:"send-failed"};}
      return res.json({success:true,order:updated.rows[0],payoutEmail});
    }catch(error){
      try{await client.query("ROLLBACK");}catch{}
      console.error("Webshop trade-in settlement error:",error);
      return res.status(500).json({error:"De verrekening kon niet worden opgeslagen."});
    }finally{client.release();}
  });

  app.post("/api/admin/webshop-orders/:id/trade-in-settlement-email", requirePermission("buyback_orders.update"), async (req,res) => {
    const id=Number(req.params.id);
    if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Ongeldig order-ID."});
    try{
      const payoutEmail=await sendTradeInPayoutConfirmation(id);
      if(!payoutEmail.sent)return res.status(409).json({error:payoutEmail.reason==="email-not-configured"?"E-mail is niet ingesteld. Controleer RESEND_API_KEY en RESEND_FROM_EMAIL.":"De bevestiging kon niet worden verzonden."});
      return res.json({success:true,payoutEmail});
    }catch(error){
      console.error("Retry trade-in payout confirmation email failed:",id,error.message||error);
      return res.status(502).json({error:"De bevestigingsmail kon niet worden verzonden. Controleer de e-mailinstellingen en probeer opnieuw."});
    }
  });

  app.delete("/api/admin/webshop-orders/:id", requirePermission("webshop_orders.delete", { allowSiteSave: true }), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: "Ongeldig order-ID." });
      }

      const result = await pool.query(
        `DELETE FROM webshop_orders
         WHERE id = $1
           AND payment_status <> 'Paid'
           AND payment_status <> 'Pending'
           AND inventory_deducted_at IS NULL
           AND COALESCE(paypal_order_id, '') = ''
           AND COALESCE(mollie_payment_id, '') = ''
         RETURNING id`,
        [id]
      );

      if (!result.rows.length) {
        const existing = await pool.query(
          "SELECT id, payment_status, inventory_deducted_at, paypal_order_id, mollie_payment_id FROM webshop_orders WHERE id = $1",
          [id]
        );
        if (!existing.rows.length) {
          return res.status(404).json({ error: "Bestelling niet gevonden." });
        }
        return res.status(409).json({
          error: "Deze bestelling kan niet worden verwijderd omdat de betaling is bevestigd, nog loopt of aan een betaalprovider is gekoppeld. Bewaar het besteloverzicht voor uw administratie."
        });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Delete webshop order error:", error);
      res.status(500).json({ error: "Bestelling kon niet worden verwijderd." });
    }
  });
}

module.exports = { registerAdminWebshopOrderRoutes };
