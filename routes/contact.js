"use strict";

function registerContactRoutes(app, {
  pool,
  escapeHtml,
  cryptoImpl,
  getEnv = () => process.env,
  fetchImpl = fetch,
  getNow = () => Date.now()
}) {
  const contactFormAttempts = new Map();
  /* Public HOMS TECH contact form. Messages are stored in the existing admin email inbox. */
  app.post("/api/contact", async (req,res) => {
    try {
      const env = getEnv();
      const ip=String(req.ip||req.headers["x-forwarded-for"]||"unknown").split(",")[0].trim();
      const now=getNow();
      const recent=(contactFormAttempts.get(ip)||[]).filter(t=>now-t<60*60*1000);
      if(recent.length>=5)return res.status(429).json({error:"U heeft te veel berichten verstuurd. Probeer het later opnieuw."});
      // Honeypot: silently accept automated submissions without storing them.
      if(String(req.body?.website||"").trim())return res.json({success:true});
      const name=String(req.body?.name||"").trim().slice(0,120);
      const email=String(req.body?.email||"").trim().toLowerCase().slice(0,254);
      const phone=String(req.body?.phone||"").trim().slice(0,60);
      const topic=String(req.body?.topic||"Algemene vraag").trim().slice(0,120);
      const message=String(req.body?.message||"").trim().slice(0,8000);
      if(name.length<2||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||message.length<8){
        return res.status(400).json({error:"Vul uw naam, een geldig e-mailadres en een bericht in."});
      }
      recent.push(now);
      contactFormAttempts.set(ip, recent);
      // Remove expired IP entries if the public form receives traffic from many clients.
      if (contactFormAttempts.size > 5000) {
        for (const [key, timestamps] of contactFormAttempts.entries()) {
          if (timestamps.every(timestamp => now - timestamp >= 60 * 60 * 1000)) {
            contactFormAttempts.delete(key);
          }
        }
      }
      const subject = ("Website contact: " + topic).slice(0, 240);
      const body=["Nieuw contactbericht via HOMS TECH","Naam: "+name,"E-mail: "+email,"Telefoon: "+(phone||"-"),"Onderwerp: "+topic,"","Bericht:",message].join("\n");
      const id="contact-"+cryptoImpl.randomUUID();
      const notifyEmail=String(env.REPAIR_REQUEST_EMAIL||env.ORDER_NOTIFICATION_EMAIL||"").trim();
      await pool.query(
        "INSERT INTO admin_emails(resend_email_id,direction,from_address,to_addresses,subject,text_body,html_body,attachments,is_read) VALUES($1,'inbound',$2,$3::jsonb,$4,$5,$6,'[]'::jsonb,FALSE)",
        [id,email,JSON.stringify(notifyEmail?[notifyEmail]:[]),subject,body,"<pre style=\"white-space:pre-wrap;font-family:Arial,sans-serif\">"+escapeHtml(body)+"</pre>"]
      );
      if(env.RESEND_API_KEY&&env.RESEND_FROM_EMAIL&&notifyEmail){
        fetchImpl("https://api.resend.com/emails",{
          method:"POST",
          headers:{Authorization:"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},
          body:JSON.stringify({from:env.RESEND_FROM_EMAIL,to:[notifyEmail],reply_to:email,subject:"Nieuwe HOMS TECH contactaanvraag",text:body})
        }).then(async response=>{if(!response.ok)console.error("Contact notification failed:",response.status,await response.text().catch(()=>""));})
          .catch(error=>console.error("Contact notification error:",error.message));
      }
      return res.status(201).json({success:true,message:"Uw bericht is ontvangen. We nemen zo snel mogelijk contact met u op."});
    }catch(error){
      console.error("Public contact form error:",error);
      return res.status(500).json({error:"Uw bericht kon niet worden verstuurd. Probeer het later opnieuw."});
    }
  });
}

module.exports = { registerContactRoutes };
