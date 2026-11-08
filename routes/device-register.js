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
      res.set("Cache-Control","no-store");res.json({devices:result.rows});
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
      const existing=await pool.query("SELECT device_type FROM device_register WHERE id=$1 AND archived=FALSE",[id]);
      if(!existing.rows.length)return res.status(404).json({error:"Toestel niet gevonden."});
      const allowed=existing.rows[0].device_type==="commercial"?commercialDeviceStatuses:customerDeviceStatuses;
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
        !["repair", "refurbishment", "purchase", "sale", "note"].includes(operationType) ||
        !Number.isFinite(additionalCost) ||
        !Number.isFinite(salePrice)
      ) {
        return res.status(400).json({ error: "Controleer de handeling en bedragen." });
      }
      const device=await pool.query("SELECT device_type FROM device_register WHERE id=$1 AND archived=FALSE",[id]);if(!device.rows.length)return res.status(404).json({error:"Actief toestel niet gevonden."});
      const parts=Array.isArray(b.parts)?b.parts.slice(0,100).map(p=>({name:deviceText(p?.name,160),quantity:Math.max(1,Math.min(999,Math.floor(Number(p?.quantity)||1))),cost:deviceMoney(p?.cost)})): [];
      if(parts.some(p=>!p.name||!Number.isFinite(p.cost)))return res.status(400).json({error:"Controleer de onderdelen en hun kosten."});
      const allowed=device.rows[0].device_type==="customer_repair"?customerDeviceStatuses:commercialDeviceStatuses;
      if(status&&!allowed.has(status))return res.status(400).json({error:"Ongeldige status."});
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
