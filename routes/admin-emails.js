"use strict";

function registerAdminEmailRoutes(app, {
  pool,
  requirePermission,
  escapeHtml,
  crypto,
  getEnv = () => process.env,
  fetchImpl = fetch
}) {
  app.get("/api/admin/emails",requirePermission("site.save"),async(req,res)=>{
    try {
      const result = await pool.query(
        `SELECT
          id, direction, from_address, to_addresses, subject,
          LEFT(text_body, 180) AS preview, attachments, is_read,
          created_at, message_id, references_header
        FROM admin_emails
        ORDER BY created_at DESC, id DESC
        LIMIT 200`
      );
      res.json({ emails: result.rows });
    } catch (error) {
      console.error("Admin email list:", error);
      res.status(500).json({ error: "E-mails laden is mislukt." });
    }
  });
  app.get("/api/admin/emails/:id", requirePermission("site.save"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) {
        return res.status(400).json({ error: "Ongeldig bericht." });
      }
  
      const result = await pool.query(
        "UPDATE admin_emails SET is_read=TRUE WHERE id=$1 AND direction='inbound' RETURNING *",
        [id]
      );
      if (result.rows.length) {
        return res.json({ email: result.rows[0] });
      }
  
      const other = await pool.query("SELECT * FROM admin_emails WHERE id=$1", [id]);
      if (!other.rows.length) {
        return res.status(404).json({ error: "Bericht niet gevonden." });
      }
      return res.json({ email: other.rows[0] });
    } catch (error) {
      console.error("Admin email detail:", error);
      return res.status(500).json({ error: "Bericht laden is mislukt." });
    }
  });
  app.delete("/api/admin/emails/:id",requirePermission("site.save"),async(req,res)=>{
    try{
      const id=Number(req.params.id);
      if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:"Ongeldig bericht."});
      const result=await pool.query("DELETE FROM admin_emails WHERE id=$1 RETURNING id",[id]);
      if(!result.rowCount)return res.status(404).json({error:"Bericht niet gevonden."});
      return res.json({success:true,id});
    }catch(e){console.error("Admin email delete:",e);return res.status(500).json({error:"E-mail verwijderen is mislukt."});}
  });
  app.post("/api/admin/emails/send",requirePermission("site.save"),async(req,res)=>{
    try{
      const apiKey=getEnv().RESEND_API_KEY,from=getEnv().RESEND_FROM_EMAIL;
      if(!apiKey||!from||from==="onboarding@resend.dev")return res.status(503).json({error:"Stel RESEND_API_KEY en een geverifieerd RESEND_FROM_EMAIL in."});
      const to=String(req.body?.to||"").trim().slice(0,254),subject=String(req.body?.subject||"").trim().slice(0,240),textBody=String(req.body?.text||"").trim().slice(0,50000);
      const parseRecipients=value=>String(value||"").split(/[;,]+/).map(x=>x.trim()).filter(Boolean);
      const cc=parseRecipients(req.body?.cc),bcc=parseRecipients(req.body?.bcc),rawAttachments=Array.isArray(req.body?.attachments)?req.body.attachments:[];
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)||!subject||!textBody)return res.status(400).json({error:"Vul een geldig e-mailadres, onderwerp en bericht in."});
      const recipients=[...cc,...bcc];if(recipients.length>20||recipients.some(x=>!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))return res.status(400).json({error:"Controleer de Cc- en Bcc-e-mailadressen."});
      if(rawAttachments.length>10)return res.status(400).json({error:"Je kunt maximaal 10 bijlagen toevoegen."});
      const allowedTypes = new Set([
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "image/heic",
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "text/plain"
      ]);
      let attachmentTotal=0;
      const attachments=rawAttachments.map(file=>{
        const filename=String(file?.filename||"").replace(/[\/\\\r\n]/g,"_").slice(0,180);
        const ext=filename.split(".").pop().toLowerCase();
        const fallbackTypes = {
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          png: "image/png",
          webp: "image/webp",
          gif: "image/gif",
          heic: "image/heic",
          pdf: "application/pdf",
          doc: "application/msword",
          docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          xls: "application/vnd.ms-excel",
          xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          txt: "text/plain"
        };
        const mime=String(file?.content_type||fallbackTypes[ext]||"application/octet-stream").toLowerCase();
        const content=String(file?.content||"");
        if(!filename||!content||!allowedTypes.has(mime)||!/^[A-Za-z0-9+/]+={0,2}$/.test(content))throw new Error("Een bijlage heeft een ongeldig formaat.");
        const size=Buffer.from(content,"base64").length;attachmentTotal+=size;
        if(size>10*1024*1024||attachmentTotal>20*1024*1024)throw new Error("Bijlagen mogen maximaal 10 MB per bestand en 20 MB totaal zijn.");
        return {filename,content,content_type:mime};
      });
      const messageHtml=textBody.split(/\r?\n/).map(line=>escapeHtml(line).replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/__(.+?)__/g,"<u>$1</u>").replace(/_(.+?)_/g,"<em>$1</em>")).join("<br>");
      const signatureText="\n\n—\nHOMS TECH | Customer Support\nwww.homs-tech.nl";
      const textWithSignature=textBody+signatureText;
      const signatureHtml=`
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:26px;width:100%;max-width:520px;font-family:Arial,Helvetica,sans-serif">
          <tr><td style="border-top:2px solid #2563eb;padding-top:15px"></td></tr>
          <tr>
            <td style="padding:0;color:#10283f">
              <a href="https://homs-tech.nl" target="_blank" style="text-decoration:none;display:inline-block">
                <img src="https://homs-tech.nl/assets/homs-tech-logo.png" width="132" alt="HOMS TECH" style="display:block;width:132px;max-width:132px;height:auto;border:0">
              </a>
              <div style="font-size:16px;line-height:22px;font-weight:700;letter-spacing:1.1px;color:#10283f;margin-top:10px">HOMS TECH</div>
              <div style="font-size:11px;line-height:17px;letter-spacing:1.2px;text-transform:uppercase;color:#64748b;margin-top:2px">Customer Support</div>
              <div style="font-size:13px;line-height:20px;margin-top:9px">
                <a href="https://homs-tech.nl" target="_blank" style="color:#2563eb;text-decoration:none;font-weight:600">www.homs-tech.nl</a>
              </div>
            </td>
          </tr>
        </table>`;
      const html=`<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#263445">${messageHtml}${signatureHtml}</div>`;
      const replyToId=Number(req.body?.replyToId)||0;
      let replyHeaders;
      if(replyToId){
        const originalResult=await pool.query("SELECT direction,message_id,references_header FROM admin_emails WHERE id=$1",[replyToId]);
        const original=originalResult.rows[0];
        if(!original||original.direction!=="inbound")return res.status(400).json({error:"Het oorspronkelijke inkomende bericht is niet gevonden. Verstuur dit bericht als nieuw e-mailbericht."});
        // Website contact-form entries are stored locally and have no RFC Message-ID.
        // Allow replying to them as a normal new email; only add threading headers when available.
        const messageId = String(original.message_id || "").match(/<[^<>\\s\\r\\n]+>/)?.[0] || "";
        if (messageId) {
          const referenceIds = String(original.references_header || "").match(/<[^<>\\s\\r\\n]+>/g) || [];
          const refs = [...new Set([...referenceIds, messageId])].slice(-20);
          replyHeaders = {
            "In-Reply-To": messageId,
            References: refs.join(" ")
          };
        }
      }
      const sendPayload={from,to:[to],cc,bcc,subject,text:textWithSignature,html,reply_to:"mail@inbound.homs-tech.nl",attachments:attachments.map(x=>({filename:x.filename,content:x.content}))};
      if(replyHeaders)sendPayload.headers=replyHeaders;
      const response=await fetchImpl("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json"},body:JSON.stringify(sendPayload)});
      const data=await response.json().catch(()=>({}));
      if(!response.ok){console.error("Admin email send provider error:",response.status,JSON.stringify(data));return res.status(502).json({error:"E-mailprovider kon het bericht niet versturen."});}
      await pool.query(
        `INSERT INTO admin_emails(
          resend_email_id, direction, from_address, to_addresses, subject,
          text_body, html_body, attachments, is_read
        ) VALUES($1, 'outbound', $2, $3::jsonb, $4, $5, $6, $7::jsonb, TRUE)`,
        [
          String(data.id || "sent-" + Date.now() + "-" + crypto.randomBytes(5).toString("hex")),
          from,
          JSON.stringify([to, ...cc, ...bcc]),
          subject,
          textBody,
          html,
          JSON.stringify(attachments.map(file => ({
            filename: file.filename,
            content_type: file.content_type,
            size: Buffer.from(file.content, "base64").length
          })))
        ]
      );
      res.json({success:true,to,attachmentCount:attachments.length});
    }catch(e){console.error("Admin email send:",e);res.status(500).json({error:"E-mail versturen is mislukt."});}
  });
}

module.exports = { registerAdminEmailRoutes };
