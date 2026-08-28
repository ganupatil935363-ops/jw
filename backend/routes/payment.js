
const express=require('express'),crypto=require('crypto');
const {authenticate,requireAdmin}=require('../middleware/auth');
const {Product,Payment,Order}=require('../db'); const {razorpayRequest}=require('../razorpay');
const router=express.Router();
function safeEqual(a,b){try{const x=Buffer.from(a,'hex'),y=Buffer.from(b,'hex');return x.length===y.length&&crypto.timingSafeEqual(x,y)}catch{return false}}
router.post('/create-order',authenticate,async(req,res)=>{
 try{
  const items=Array.isArray(req.body.items)?req.body.items:[];if(!items.length)return res.status(400).json({success:false,message:'No items supplied for payment'});
  let amount=0;
  for(const i of items){const q=Number(i.quantity),p=await Product.findOne({id:Number(i.id)}).lean();if(!p||!Number.isInteger(q)||q<1)return res.status(400).json({success:false,message:'Invalid product or quantity'});if(Number(p.stock||0)<q)return res.status(400).json({success:false,message:`Insufficient stock for ${p.name}`});amount+=Number(p.price)*q}
  const rp=await razorpayRequest('POST','/v1/orders',{amount:Math.round(amount*100),currency:'INR',receipt:`rcpt_${Date.now()}`,notes:{user_id:String(req.user.id),order_number:String(req.body.orderNumber||'')}});
  await Payment.create({id:Date.now(),razorpayOrderId:rp.id,amount:rp.amount,currency:'INR',userId:req.user.id,orderNumber:req.body.orderNumber||null,status:'created',createdAt:new Date().toISOString()});
  res.json({success:true,keyId:process.env.RAZORPAY_KEY_ID,order:rp});
 }catch(e){console.error(e);res.status(500).json({success:false,message:e.message||'Unable to create Razorpay order'})}
});
router.post('/verify',authenticate,async(req,res)=>{
 try{
  const {razorpay_payment_id,payement_id,razorpay_order_id,razorpay_signature}=req.body;
  if(!razorpay_payment_id||!razorpay_order_id||!razorpay_signature)return res.status(400).json({success:false,message:'Missing Razorpay payment details'});
  const p=await Payment.findOne({razorpayOrderId:razorpay_order_id});if(!p)return res.status(400).json({success:false,message:'Payment order was not created by this server'});
  if(String(p.userId)!==String(req.user.id))return res.status(403).json({success:false,message:'You are not authorized to verify this payment.'});
  const expected=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(`${p.razorpayOrderId}|${razorpay_payment_id}`).digest('hex');
  if(!safeEqual(expected,razorpay_signature))return res.status(400).json({success:false,message:'Payment signature verification failed'});
  p.status='verified';p.razorpayPaymentId=razorpay_payment_id;p.razorpaySignature=razorpay_signature;p.verifiedAt=new Date().toISOString();await p.save();
  res.json({success:true,message:'Payment verified successfully',payment:{razorpayOrderId:p.razorpayOrderId,razorpayPaymentId:p.razorpayPaymentId}});
 }catch(e){console.error(e);res.status(500).json({success:false,message:'Unable to verify payment'})}
});
router.post('/refund',requireAdmin,async(req,res)=>{
 try{
  const {paymentId,amount,notes}=req.body; if(!paymentId)return res.status(400).json({success:false,message:'paymentId is required'});
  const body={};if(amount)body.amount=Math.round(Number(amount)*100);if(notes)body.notes=notes;
  const refund=await razorpayRequest('POST',`/v1/payments/${encodeURIComponent(paymentId)}/refund`,body);
  await Payment.findOneAndUpdate({razorpayPaymentId:paymentId},{$set:{status:'refund_requested',refundId:refund.id,refundAmount:refund.amount,refundStatus:refund.status,refundedAt:new Date().toISOString()}});
  res.json({success:true,refund});
 }catch(e){res.status(400).json({success:false,message:e.message||'Refund failed'})}
});
// Razorpay webhook: mount this route before express.json() in server.js.
router.post('/webhook',(req,res)=>{
 try{
  const raw=Buffer.isBuffer(req.body)?req.body:Buffer.from(req.body||'');
  const sig=req.headers['x-razorpay-signature']; const secret=process.env.RAZORPAY_WEBHOOK_SECRET;
  if(!secret||!sig)return res.status(400).send('Invalid webhook configuration');
  const expected=crypto.createHmac('sha256',secret).update(raw).digest('hex');
  if(!safeEqual(expected,sig))return res.status(400).send('Invalid signature');
  const payload=JSON.parse(raw.toString('utf8')); const eventId=req.headers['x-razorpay-event-id']||payload.id||crypto.createHash('sha256').update(raw).digest('hex');
  const processEvent=async()=>{
   const {WebhookEvent}=require('../db'); try{await WebhookEvent.create({eventId,event:payload.event});}catch{return;}
   const ent=payload?.payload?.payment?.entity||payload?.payload?.refund?.entity;
   if(payload.event==='payment.captured'||payload.event==='order.paid'){
    const payId=payload?.payload?.payment?.entity?.id, orderId=payload?.payload?.payment?.entity?.order_id;
    if(payId)await Payment.findOneAndUpdate({razorpayPaymentId:payId},{$set:{status:'captured',razorpayPaymentId:payId,razorpayOrderId:orderId||undefined,capturedAt:new Date().toISOString()}});
    if(orderId){const o=await Order.findOneAndUpdate({razorpayOrderId:orderId},{$set:{paymentStatus:'paid',updatedAt:new Date().toISOString()}},{new:true});if(o&&global.io)global.io.to(`user:${o.userId}`).emit('order-updated',o);}
   }
   if(payload.event==='payment.failed'){const payId=payload?.payload?.payment?.entity?.id;const orderId=payload?.payload?.payment?.entity?.order_id;const failedAt=new Date().toISOString();await Payment.findOneAndUpdate({razorpayOrderId:orderId},{$set:{status:'failed',razorpayPaymentId:payId,failedAt}});if(orderId){const o=await Order.findOneAndUpdate({razorpayOrderId:orderId},{$set:{paymentStatus:'failed',status:'Payment Failed',adminConfirmed:false,updatedAt:failedAt},$push:{trackingHistory:{status:'Payment Failed',timestamp:failedAt,location:'Online Payment',description:payload?.payload?.payment?.entity?.error_description||'Razorpay payment failed. Order was not confirmed.'}}},{new:true});if(o&&global.io)global.io.to(`user:${o.userId}`).emit('order-updated',o);}}
   if(payload.event==='refund.created'||payload.event==='refund.processed'||payload.event==='refund.failed'){
    const r=payload?.payload?.refund?.entity;
    if(r?.payment_id){
      const ps=payload.event==='refund.failed'?'refund_failed':'refunded';
      const pay=await Payment.findOneAndUpdate({razorpayPaymentId:r.payment_id},{$set:{status:ps,refundId:r.id,refundStatus:r.status,refundAmount:r.amount,refundedAt:new Date().toISOString()}},{new:true});
      if(pay?.orderId){
        const o=await Order.findOneAndUpdate({id:Number(pay.orderId)},{$set:{paymentStatus:ps,updatedAt:new Date().toISOString()}},{new:true});
        if(o&&global.io)global.io.to(`user:${o.userId}`).emit('order-updated',o);
      }
    }
  }
  };
  processEvent().catch(e=>console.error('Webhook processing:',e)); res.status(200).json({received:true});
 }catch(e){console.error('Webhook:',e);res.status(400).send('Invalid webhook')}
});
module.exports=router;
