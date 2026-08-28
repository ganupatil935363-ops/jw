
const nodemailer=require('nodemailer');
async function sendEmail(to,subject,text,html){
  if(!to||!process.env.SMTP_HOST||!process.env.SMTP_USER||!process.env.SMTP_PASS)return false;
  const transporter=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:String(process.env.SMTP_SECURE||'false')==='true',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
  await transporter.sendMail({from:process.env.SMTP_FROM||process.env.SMTP_USER,to,subject,text,html:html||`<p>${text.replace(/\n/g,'<br>')}</p>`}); return true;
}
async function sendWhatsApp(to,message,templateParams=[]){
  if(!process.env.WHATSAPP_ACCESS_TOKEN||!process.env.WHATSAPP_PHONE_NUMBER_ID||!to)return false;
  const phone=String(to).replace(/\D/g,'');
  const body=process.env.WHATSAPP_TEMPLATE_NAME
    ? {messaging_product:'whatsapp',to:phone,type:'template',template:{name:process.env.WHATSAPP_TEMPLATE_NAME,language:{code:process.env.WHATSAPP_TEMPLATE_LANG||'en_US'},components:templateParams.length?[{type:'body',parameters:templateParams.map(text=>({type:'text',text:String(text)}))}]:[]}}
    : {messaging_product:'whatsapp',to:phone,type:'text',text:{body:message}};
  const r=await fetch(`https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok) throw new Error(`WhatsApp API error ${r.status}: ${await r.text()}`); return true;
}
async function notifyOrder({order,event='placed'}){
  const title=event==='confirmed'?'Order Confirmed':event==='cancelled'?'Order Cancelled':'New Order Received';
  const msg=`SmartStore\n${title}\nOrder: ${order.orderNumber}\nAmount: ₹${Number(order.total||0).toLocaleString('en-IN')}\nStatus: ${order.status}`;
  const jobs=[];
  if(order.email)jobs.push(sendEmail(order.email,`${title} - ${order.orderNumber}`,msg));
  if(process.env.ADMIN_EMAIL&&event==='placed')jobs.push(sendEmail(process.env.ADMIN_EMAIL,`New order ${order.orderNumber}`,msg));
  if(order.phone)jobs.push(sendWhatsApp(order.phone,msg,[title,order.orderNumber,`₹${Number(order.total||0).toLocaleString('en-IN')}`,order.status]));
  if(process.env.ADMIN_WHATSAPP_TO&&event==='placed')jobs.push(sendWhatsApp(process.env.ADMIN_WHATSAPP_TO,msg,[title,order.orderNumber,`₹${Number(order.total||0).toLocaleString('en-IN')}`,order.status]));
  const results=await Promise.allSettled(jobs); results.forEach(r=>{if(r.status==='rejected')console.error('Notification error:',r.reason?.message||r.reason)}); return results;
}
module.exports={sendEmail,sendWhatsApp,notifyOrder};
