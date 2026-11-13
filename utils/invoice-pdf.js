"use strict";

function invoicePdfEscape(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function buildInvoicePdf(invoice){
 const W=595,H=842,navy=[0.04,0.11,0.19],green=[0.14,0.83,0.40],ink=[0.12,0.16,0.23],muted=[0.38,0.43,0.50],pale=[0.95,0.97,0.98],line=[0.87,0.90,0.93];
 const pages=[];let c=[];
 const rgb=a=>a.map(v=>Number(v).toFixed(3)).join(" ");
 const rect=(x,y,w,h,color)=>c.push(rgb(color)+" rg "+x+" "+y+" "+w+" "+h+" re f");
 const rule=(x1,y1,x2,y2,color=line)=>c.push(rgb(color)+" RG 0.7 w "+x1+" "+y1+" m "+x2+" "+y2+" l S");
 const txt=(x,y,text,size=10,font="F1",color=ink)=>c.push("BT /"+font+" "+size+" Tf "+rgb(color)+" rg 1 0 0 1 "+x+" "+y+" Tm ("+invoicePdfEscape(text)+") Tj ET");
 const euro=n=>"EUR "+Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
 const date=new Date(invoice.created_at).toLocaleDateString("nl-NL"),items=Array.isArray(invoice.lines)?invoice.lines:[];
 const seller=invoice.seller_snapshot&&typeof invoice.seller_snapshot==="object"?invoice.seller_snapshot:{};
 const customerType=invoice.customer_type==="business"?"Zakelijke klant":"Particuliere klant";
 const customerLabel=invoice.customer_type==="business"?(invoice.customer_company_name||invoice.customer_name):(invoice.customer_name||"-");
 const sellerName=seller.legalName||seller.tradeName||"HOMS TECH";
 const sellerAddress=[seller.address,seller.postalCode,seller.city,seller.country].filter(Boolean).join(", ");
 const customerAddress=[invoice.customer_address,invoice.customer_postal_code,invoice.customer_city,invoice.customer_country].filter(Boolean).join(", ");
 const paymentLabels={bank:"Bankoverschrijving",cash:"Contant",pin:"Pin",online:"Online",other:"Anders"};
 const paymentStatusLabels={unpaid:"Niet betaald",paid:"Betaald",partial:"Gedeeltelijk betaald"};
 const perPage=11,pageCount=Math.max(1,Math.ceil(items.length/perPage));
 for(let p=0;p<pageCount;p++){
  c=[];rect(0,720,W,122,navy);rect(0,716,W,4,green);
  txt(42,791,"HOMS TECH",24,"F2",[1,1,1]);txt(43,770,"PHONE REPAIR  |  REFURBISHED DEVICES",8,"F1",[0.82,0.87,0.92]);
  txt(42,744,"FACTUUR",17,"F2",[1,1,1]);txt(420,793,"FACTUURNUMMER",7,"F2",[0.70,0.78,0.85]);txt(420,775,String(invoice.invoice_number||"-"),11,"F2",[1,1,1]);txt(420,752,"DATUM  "+date,9,"F1",[0.90,0.93,0.96]);
  txt(42,681,"FACTUUR AAN · "+customerType.toUpperCase(),8,"F2",muted);
  txt(42,658,String(customerLabel).slice(0,48),12,"F2",ink);
  let cy=640;
  if(invoice.customer_type==="business"&&invoice.customer_contact_person){txt(42,cy,"Contact: "+String(invoice.customer_contact_person).slice(0,48),8,"F1",muted);cy-=14;}
  if(customerAddress){txt(42,cy,String(customerAddress).slice(0,64),8,"F1",muted);cy-=14;}
  if(invoice.customer_email){txt(42,cy,String(invoice.customer_email).slice(0,55),8,"F1",muted);cy-=14;}
  if(invoice.customer_phone){txt(42,cy,"Tel: "+String(invoice.customer_phone).slice(0,48),8,"F1",muted);cy-=14;}
  if(invoice.customer_kvk_number){txt(42,cy,"KVK: "+String(invoice.customer_kvk_number).slice(0,38),8,"F1",muted);cy-=14;}
  if(invoice.customer_vat_id){txt(42,cy,"BTW-ID: "+String(invoice.customer_vat_id).slice(0,38),8,"F1",muted);}
  txt(340,681,"GEGEVENS LEVERANCIER",8,"F2",muted);txt(340,658,String(sellerName).slice(0,38),11,"F2",ink);
  let sy=640;
  if(sellerAddress){txt(340,sy,String(sellerAddress).slice(0,42),8,"F1",muted);sy-=14;}
  if(seller.kvkNumber){txt(340,sy,"KVK: "+String(seller.kvkNumber).slice(0,34),8,"F1",muted);sy-=14;}
  if(seller.vatId){txt(340,sy,"BTW-ID: "+String(seller.vatId).slice(0,34),8,"F1",muted);sy-=14;}
  if(seller.email){txt(340,sy,String(seller.email).slice(0,40),8,"F1",muted);sy-=14;}
  if(seller.phone){txt(340,sy,String(seller.phone).slice(0,40),8,"F1",muted);}
  const top=p===0?510:590;rect(42,top-8,511,25,pale);
  txt(51,top,"OMSCHRIJVING",8,"F2",muted);txt(333,top,"AANTAL",8,"F2",muted);txt(392,top,"PRIJS",8,"F2",muted);txt(465,top,"BTW",8,"F2",muted);txt(510,top,"TOTAAL",8,"F2",muted);
  let y=top-29;const pageItems=items.slice(p*perPage,(p+1)*perPage);
  for(let j=0;j<pageItems.length;j++){
   const it=pageItems[j],qty=Number(it.quantity)||0,price=Number(it.unitPrice)||0,rate=Number(it.vatRate)||0;
   if(j%2===1)rect(42,y-7,511,23,[0.985,0.988,0.992]);
   txt(51,y,String(it.description||"").slice(0,42),9,"F1",ink);txt(341,y,String(qty),9,"F1",ink);txt(389,y,euro(price),8,"F1",ink);txt(469,y,rate+"%",8,"F1",ink);txt(505,y,euro(qty*price*(1+rate/100)),8,"F2",ink);rule(42,y-10,553,y-10);y-=25;
  }
  if(p===pageCount-1){
   y=Math.min(y-10,230);rule(330,y+6,553,y+6,[0.80,0.84,0.88]);
   txt(355,y-14,"Subtotaal excl. BTW",9,"F1",muted);txt(470,y-14,euro(invoice.subtotal),9,"F1",ink);
   txt(355,y-34,"BTW",9,"F1",muted);txt(470,y-34,euro(invoice.vat_total),9,"F1",ink);
   rect(330,y-68,223,25,navy);txt(343,y-59,"TOTAAL",10,"F2",[1,1,1]);txt(450,y-59,euro(invoice.total),10,"F2",[1,1,1]);
   rect(42,76,511,66,[0.95,0.97,0.98]);rect(42,76,4,66,green);
   txt(55,125,"BETALING & ADMINISTRATIE",8,"F2",navy);
   txt(55,108,"Betaalmethode: "+(paymentLabels[invoice.payment_method]||"Bankoverschrijving"),8,"F1",ink);
   txt(55,92,"Status: "+(paymentStatusLabels[invoice.payment_status]||"Niet betaald"),8,"F1",ink);
   if(seller.iban)txt(300,108,"IBAN: "+String(seller.iban).slice(0,34),8,"F2",ink);
   if(invoice.due_date)txt(300,92,"Vervaldatum: "+new Date(invoice.due_date).toLocaleDateString("nl-NL"),8,"F1",ink);
   txt(55,80,"Referentie: "+String(invoice.reference||invoice.invoice_number||"").slice(0,36),7,"F1",muted);
  }
  rule(42,48,553,48,[0.84,0.87,0.90]);txt(42,32,"HOMS TECH  |  Bedankt voor uw vertrouwen.",8,"F1",muted);txt(470,32,"Pagina "+(p+1)+" / "+pageCount,8,"F1",muted);
  pages.push(c.join("\n"));
 }
 const objects=[];objects.push("<< /Type /Catalog /Pages 2 0 R >>");
 const pageRefs=pages.map((_,i)=>(3+i*2)+" 0 R").join(" ");objects.push("<< /Type /Pages /Kids ["+pageRefs+"] /Count "+pages.length+" >>");
 for(let i=0;i<pages.length;i++){
  const pageObj=3+i*2,streamObj=pageObj+1,stream=pages[i];
  objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 "+W+" "+H+"] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> >> >> /Contents "+streamObj+" 0 R >>");
  objects.push("<< /Length "+Buffer.byteLength(stream,"latin1")+" >>\nstream\n"+stream+"\nendstream");
 }
 let pdf="%PDF-1.4\n",offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf,"latin1"));pdf+=(i+1)+" 0 obj\n"+objects[i]+"\nendobj\n";}
 const xref=Buffer.byteLength(pdf,"latin1");pdf+="xref\n0 "+(objects.length+1)+"\n0000000000 65535 f \n";for(let i=1;i<offsets.length;i++)pdf+=String(offsets[i]).padStart(10,"0")+" 00000 n \n";pdf+="trailer\n<< /Size "+(objects.length+1)+" /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF";return Buffer.from(pdf,"latin1");
}

module.exports = { invoicePdfEscape, buildInvoicePdf };
