"use strict";

function registerDeviceRegisterRoutes(app, {
  pool,
  requirePermission,
  deviceText,
  deviceMoney
}) {
  const customerDeviceStatuses = new Set(["مفتوح","قيد العمل","مكتمل"]);
  const commercialDeviceStatuses = new Set(["تم الشراء","قيد الفحص","قيد التجديد","جاهز للبيع","تم البيع"]);
  
  app.get("/api/admin/device-register",requirePermission("device_register.view"),async(req,res)=>{
    try{
      const type=["customer_repair","commercial"].includes(req.query.type)?req.query.type:null;
      const archived=req.query.archived==="true";
      const q=deviceText(req.query.q,100);
      const result=await pool.query(`
        SELECT d.*,
          COALESCE((SELECT COUNT(*) FROM device_register_operations o WHERE o.device_id=d.id),0)::int AS operation_count,
          COALESCE((SELECT SUM((part.value->>'quantity')::numeric*(part.value->>'cost')::numeric)
            FROM device_register_operations o CROSS JOIN LATERAL jsonb_array_elements(o.parts) AS part(value) WHERE o.device_id=d.id),0)
            + COALESCE((SELECT SUM(additional_cost) FROM device_register_operations o WHERE o.device_id=d.id),0) AS recorded_cost
        FROM device_register d
        WHERE d.archived=$1 AND ($2::text IS NULL OR d.device_type=$2)
          AND ($3='' OR d.identifier_value ILIKE '%'||$3||'%' OR d.model ILIKE '%'||$3||'%' OR d.customer_name ILIKE '%'||$3||'%' OR d.repair_order_number ILIKE '%'||$3||'%')
        ORDER BY d.updated_at DESC,d.id DESC LIMIT 500
      `,[archived,type,q]);
      const summaryResult = await pool.query(`
        WITH operation_costs AS (
          SELECT o.device_id,
            COALESCE(SUM(o.additional_cost),0)
              + COALESCE(SUM(parts.parts_cost),0) AS recorded_cost
          FROM device_register_operations o
          LEFT JOIN LATERAL (
            SELECT SUM((part.value->>'quantity')::numeric * (part.value->>'cost')::numeric) AS parts_cost
            FROM jsonb_array_elements(COALESCE(o.parts,'[]'::jsonb)) AS part(value)
          ) parts ON TRUE
          GROUP BY o.device_id
        ), commercial AS (
          SELECT d.id,d.status,d.purchase_cost,d.sale_price,
            COALESCE(c.recorded_cost,0) AS recorded_cost
          FROM device_register d
          LEFT JOIN operation_costs c ON c.device_id=d.id
          WHERE d.device_type='commercial' AND d.archived=FALSE
        )
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status='جاهز للبيع')::int AS ready,
          COUNT(*) FILTER (WHERE status IN ('تم الشراء','قيد الفحص','قيد التجديد'))::int AS processing,
          COUNT(*) FILTER (WHERE status='تم البيع')::int AS sold,
          COALESCE(SUM(purchase_cost + recorded_cost) FILTER (WHERE status<>'تم البيع'),0) AS invested,
          COALESCE(SUM(sale_price) FILTER (WHERE status='تم البيع'),0) AS revenue,
          COALESCE(SUM(sale_price - purchase_cost - recorded_cost) FILTER (WHERE status='تم البيع'),0) AS realized_profit
        FROM commercial
      `);
      res.set("Cache-Control","no-store");res.json({devices:result.rows,summary:summaryResult.rows[0]||{}});
    }catch(e){console.error("Device register list error:",e);res.status(500).json({error:"Kon toestellen niet laden."});}
  });
  app.post("/api/admin/device-register",requirePermission("device_register.update"),async(req,res)=>{
    try{
      const b=req.body||{},type=deviceText(b.deviceType,30),identifierType=deviceText(b.identifierType,20);
      const identifierValue=deviceText(b.identifierValue,100),model=deviceText(b.model,120),brand=deviceText(b.brand,60)||"Apple";
      const status=deviceText(b.status,40),customerName=deviceText(b.customerName,160),customerPhone=deviceText(b.customerPhone,60),customerEmail=deviceText(b.customerEmail,180),repairOrderNumber=deviceText(b.repairOrderNumber,100);
      const purchaseCost=deviceMoney(b.purchaseCost),salePrice=deviceMoney(b.salePrice);
      if(!["customer_repair","commercial"].includes(type)||!["imei","serial","barcode"].includes(identifierType)||!identifierValue||!model||!Number.isFinite(purchaseCost)||!Number.isFinite(salePrice))
        return res.status(400).json({error:"Controleer het toesteltype, identificatienummer, model en bedragen."});
      const allowed=type==="customer_repair"?customerDeviceStatuses:commercialDeviceStatuses;
      if(!allowed.has(status))return res.status(400).json({error:"Ongeldige status voor dit toesteltype."});
      const result=await pool.query(`INSERT INTO device_register(device_type,identifier_type,identifier_value,model,brand,status,customer_name,customer_phone,customer_email,repair_order_number,purchase_cost,sale_price)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [type,identifierType,identifierValue,model,brand,status,customerName,customerPhone,customerEmail,repairOrderNumber,purchaseCost,salePrice]);
      res.status(201).json({device:result.rows[0]});
    }catch(e){if(e.code==="23505")return res.status(409).json({error:"Dit identificatienummer bestaat al in het register."});console.error("Device register create error:",e);res.status(500).json({error:"Toestel kon niet worden opgeslagen."});}
  });
  app.put("/api/admin/device-register/:id",requirePermission("device_register.update"),async(req,res)=>{
    try{
      const id=Number(req.params.id),b=req.body||{};
      if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:"Ongeldig toestel."});
      const status=deviceText(b.status,40),purchaseCost=deviceMoney(b.purchaseCost),salePrice=deviceMoney(b.salePrice);
      const model=deviceText(b.model,120),brand=deviceText(b.brand,60)||"Apple";
      const existing=await pool.query("SELECT device_type,status FROM device_register WHERE id=$1 AND archived=FALSE",[id]);
      if(!existing.rows.length)return res.status(404).json({error:"Toestel niet gevonden."});
      const allowed=existing.rows[0].device_type==="commercial"?commercialDeviceStatuses:customerDeviceStatuses;
      if(existing.rows[0].status==="تم البيع")return res.status(409).json({error:"Een verkocht toestel kan niet via de algemene bewerkfunctie worden aangepast."});
      if(status==="تم البيع")return res.status(409).json({error:"Gebruik de aparte verkoopregistratie om een toestel als verkocht te markeren."});
      if(!allowed.has(status)||!Number.isFinite(purchaseCost)||!Number.isFinite(salePrice))return res.status(400).json({error:"Controleer status en bedragen."});
      const result = await pool.query(
        `UPDATE device_register
         SET status = $2,
             customer_name = $3,
             customer_phone = $4,
             customer_email = $5,
             repair_order_number = $6,
             purchase_cost = $7,
             sale_price = $8,
             model = CASE WHEN $9 = '' THEN model ELSE $9 END,
             brand = CASE WHEN $10 = '' THEN brand ELSE $10 END,
             updated_at = NOW()
         WHERE id = $1 AND archived = FALSE
         RETURNING *`,
        [
          id,
          status,
          deviceText(b.customerName, 160),
          deviceText(b.customerPhone, 60),
          deviceText(b.customerEmail, 180),
          deviceText(b.repairOrderNumber, 100),
          purchaseCost,
          salePrice,
          model,
          brand
        ]
      );
      if(!result.rows.length)return res.status(404).json({error:"Toestel niet gevonden."});
      res.json({device:result.rows[0]});
    }catch(e){console.error("Device register update error:",e);res.status(500).json({error:"Toestel kon niet worden bijgewerkt."});}
  });
  app.post("/api/admin/device-register/:id/sale",requirePermission("device_register.update"),async(req,res)=>{
    const id=Number(req.params.id);
    const salePrice=deviceMoney(req.body?.salePrice);
    const reference=deviceText(req.body?.reference,120);
    const description=deviceText(req.body?.description,1000);
    if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:"Ongeldig toestel."});
    if(!Number.isFinite(salePrice)||salePrice<=0)return res.status(400).json({error:"Vul een geldige verkoopprijs in."});
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      const found=await client.query(
        "SELECT id,device_type,status,model,identifier_value,purchase_cost FROM device_register WHERE id=$1 AND archived=FALSE FOR UPDATE",
        [id]
      );
      if(!found.rows.length){await client.query("ROLLBACK");return res.status(404).json({error:"Actief toestel niet gevonden."});}
      const device=found.rows[0];
      if(device.device_type!=="commercial"){await client.query("ROLLBACK");return res.status(409).json({error:"Alleen eigen HOMS TECH-toestellen kunnen hier als verkocht worden geregistreerd."});}
      if(device.status==="تم البيع"){await client.query("ROLLBACK");return res.status(409).json({error:"Dit toestel is al als verkocht geregistreerd."});}
      if(device.status!=="جاهز للبيع"){await client.query("ROLLBACK");return res.status(409).json({error:"Zet het toestel eerst op 'جاهز للبيع' nadat de inspectie en voorbereiding zijn afgerond."});}
      const existingSale=await client.query("SELECT id FROM device_register_operations WHERE device_id=$1 AND operation_type='sale' LIMIT 1",[id]);
      if(existingSale.rows.length){await client.query("ROLLBACK");return res.status(409).json({error:"Voor dit toestel bestaat al een verkoopregistratie."});}
      const saleDescription=[description,reference?"Referentie: "+reference:""].filter(Boolean).join(" · ")||"Verkoop geregistreerd in HOMS TECH";
      const inserted=await client.query(
        "INSERT INTO device_register_operations(device_id,operation_type,status,description,parts,additional_cost,sale_price) VALUES($1,'sale','تم البيع',$2,'[]'::jsonb,0,$3) RETURNING *",
        [id,saleDescription,salePrice]
      );
      const updated=await client.query(
        "UPDATE device_register SET status='تم البيع',sale_price=$2,updated_at=NOW() WHERE id=$1 RETURNING id,identifier_value,model,status,purchase_cost,sale_price",
        [id,salePrice]
      );
      await client.query("COMMIT");
      return res.status(201).json({success:true,device:updated.rows[0],sale:inserted.rows[0]});
    }catch(error){
      try{await client.query("ROLLBACK");}catch{}
      if(error.code==="23505")return res.status(409).json({error:"De verkoop van dit toestel is al geregistreerd."});
      console.error("Device sale registration error:",error);
      return res.status(500).json({error:"Verkoop kon niet veilig worden geregistreerd."});
    }finally{client.release();}
  });
  app.get("/api/admin/device-register/:id/operations",requirePermission("device_register.view"),async(req,res)=>{
    try{const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:"Ongeldig toestel."});
      const d=await pool.query("SELECT id FROM device_register WHERE id=$1",[id]);if(!d.rows.length)return res.status(404).json({error:"Toestel niet gevonden."});
      const q=await pool.query("SELECT * FROM device_register_operations WHERE device_id=$1 ORDER BY created_at DESC,id DESC",[id]);res.json({operations:q.rows});
    }catch(e){console.error("Device history error:",e);res.status(500).json({error:"Historie kon niet worden geladen."});}
  });
  app.post("/api/admin/device-register/:id/operations",requirePermission("device_register.update"),async(req,res)=>{
    try{
      const id=Number(req.params.id),b=req.body||{},operationType=deviceText(b.operationType,30),description=deviceText(b.description,2000),status=deviceText(b.status,40);
      const additionalCost=deviceMoney(b.additionalCost),salePrice=deviceMoney(b.salePrice);
      if (
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        !["repair", "refurbishment", "purchase", "note"].includes(operationType) ||
        !Number.isFinite(additionalCost) ||
        !Number.isFinite(salePrice)
      ) {
        return res.status(400).json({ error: "Controleer de handeling en bedragen." });
      }
      const device=await pool.query("SELECT device_type FROM device_register WHERE id=$1 AND archived=FALSE",[id]);if(!device.rows.length)return res.status(404).json({error:"Actief toestel niet gevonden."});
      const parts=Array.isArray(b.parts)?b.parts.slice(0,100).map(p=>({name:deviceText(p?.name,160),quantity:Math.max(1,Math.min(999,Math.floor(Number(p?.quantity)||1))),cost:deviceMoney(p?.cost)})): [];
      if(parts.some(p=>!p.name||!Number.isFinite(p.cost)))return res.status(400).json({error:"Controleer de onderdelen en hun kosten."});
      const allowed=device.rows[0].device_type==="customer_repair"?customerDeviceStatuses:commercialDeviceStatuses;
      if(status&&(!allowed.has(status)||status==="تم البيع"))return res.status(400).json({error:"Gebruik de aparte verkoopregistratie om een toestel als verkocht te markeren."});
      const client=await pool.connect();try{await client.query("BEGIN");
        const inserted = await client.query(
          `INSERT INTO device_register_operations(
            device_id, operation_type, status, description, parts, additional_cost, sale_price
          ) VALUES($1, $2, $3, $4, $5::jsonb, $6, $7)
          RETURNING *`,
          [id, operationType, status, description, JSON.stringify(parts), additionalCost, salePrice]
        );
        if(status)await client.query("UPDATE device_register SET status=$2,updated_at=NOW(),sale_price=CASE WHEN $2='تم البيع' AND $3>0 THEN $3 ELSE sale_price END WHERE id=$1",[id,status,salePrice]);
        else await client.query("UPDATE device_register SET updated_at=NOW() WHERE id=$1",[id]);
        await client.query("COMMIT");res.status(201).json({operation:inserted.rows[0]});
      }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
    }catch(e){console.error("Device operation create error:",e);res.status(500).json({error:"Handeling kon niet worden opgeslagen."});}
  });
  app.post("/api/admin/device-register/:id/archive",requirePermission("device_register.update"),async(req,res)=>{
    try{const id=Number(req.params.id),archived=Boolean(req.body?.archived);if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:"Ongeldig toestel."});
      const result = await pool.query(
        "UPDATE device_register SET archived=$2, updated_at=NOW() WHERE id=$1 RETURNING id, archived",
        [id, archived]
      );
      if (!result.rows.length) {
        return res.status(404).json({ error: "Toestel niet gevonden." });
      }
      res.json({ success: true, device: result.rows[0] });
    }catch(e){console.error("Device archive error:",e);res.status(500).json({error:"Archiveren/herstellen is mislukt."});}
  });
}

module.exports = { registerDeviceRegisterRoutes };
