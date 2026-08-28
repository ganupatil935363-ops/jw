
const express=require('express');
const {Order,Product,Payment}=require('../db');
const {authenticate,requireAdmin}=require('../middleware/auth');
const {razorpayRequest}=require('../razorpay');
const {notifyOrder}=require('../notifications');
const router=express.Router();
const tracking=()=>`TRK${Date.now().toString().slice(-8)}${Math.random().toString(36).slice(2,6).toUpperCase()}`;
const transitions={
 'Order Placed':['Processing','Cancelled'],
 'Processing':['Packed','Cancelled'],
 'Packed':['Shipped'],
 'Shipped':['Out for Delivery'],
 'Out for Delivery':['Delivered'],
 'Delivered':[],
 'Cancelled':[],
 'Payment Failed':[],
 'Returned':[]
};
function emit(event,o){if(global.io){global.io.emit(event,o);if(o.userId)global.io.to(`user:${o.userId}`).emit(event,o);}}
router.get('/',requireAdmin,async(req,res)=>res.json(await Order.find().sort({createdAt:-1}).lean()));
router.get('/user/:userId',authenticate,async(req,res)=>{if(!req.user.isAdmin&&String(req.user.id)!==String(req.params.userId))return res.status(403).json({message:'You can only access your own orders.'});res.json(await Order.find({userId:Number(req.params.userId)}).sort({createdAt:-1}).lean());});
router.get('/track/:trackingId',async(req,res)=>{const o=await Order.findOne({trackingId:req.params.trackingId}).lean();if(!o)return res.status(404).json({success:false,message:'Tracking ID not found'});res.json({success:true,order:{id:o.id,orderNumber:o.orderNumber,trackingId:o.trackingId,status:o.status,trackingHistory:o.trackingHistory||[],estimatedDelivery:o.estimatedDelivery,items:o.items,total:o.total,shippingAddress:o.fullAddress||o.address,createdAt:o.createdAt}})});
router.get('/:id',authenticate,async(req,res)=>{const o=await Order.findOne({id:Number(req.params.id)}).lean();if(!o)return res.status(404).json({message:'Order not found'});if(!req.user.isAdmin&&String(o.userId)!==String(req.user.id))return res.status(403).json({message:'You are not authorized to view this order.'});res.json(o);});
router.post('/',authenticate,async(req,res)=>{
 try{
  const {name,email,phone,altPhone,address,fullAddress,items,paymentMethod,orderNumber,razorpayOrderId,razorpayPaymentId}=req.body;
  if(!Array.isArray(items)||!items.length)return res.status(400).json({success:false,message:'Your cart is empty.'});
  if(!name||!email||!phone||!address)return res.status(400).json({success:false,message:'Customer and delivery details are required.'});
  const serverItems=[];let total=0;
  for(const item of items){const q=Number(item.quantity),p=await Product.findOne({id:Number(item.id)}).lean();if(!p||!Number.isInteger(q)||q<1)return res.status(400).json({success:false,message:'Invalid product or quantity.'});if(Number(p.stock||0)<q)return res.status(400).json({success:false,message:`${p.name} is out of stock or has insufficient stock.`});total+=Number(p.price)*q;serverItems.push({...p,quantity:q,price:Number(p.price)});}
  const now=new Date(),estimated=new Date(now);estimated.setDate(estimated.getDate()+5);
  const order={id:Date.now(),userId:req.user.id,userName:String(name).trim(),email:String(email).trim().toLowerCase(),phone:String(phone).trim(),altPhone:String(altPhone||'').trim(),address,fullAddress,items:serverItems,total,paymentMethod:paymentMethod||'cod',paymentStatus:paymentMethod==='cod'?'pending':(razorpayPaymentId?'paid':'pending'),status:'Order Placed',adminConfirmed:false,trackingId:tracking(),trackingHistory:[{status:'Order Placed',timestamp:now.toISOString(),location:'Order Processing Center',description:'Your order has been placed and is awaiting admin confirmation.'}],estimatedDelivery:estimated.toISOString(),createdAt:now.toISOString(),updatedAt:now.toISOString(),orderNumber:orderNumber||`ORD${Date.now()}`,razorpayOrderId:razorpayOrderId||null,razorpayPaymentId:razorpayPaymentId||null};
  if(razorpayOrderId){const pay=await Payment.findOne({razorpayOrderId});if(!pay||String(pay.userId)!==String(req.user.id)||!['verified','captured'].includes(pay.status))return res.status(400).json({success:false,message:'Payment is not verified. Order was not created.'});}
  // Reserve stock atomically.
  for(const i of serverItems){const updated=await Product.findOneAndUpdate({id:i.id,stock:{$gte:i.quantity}},{$inc:{stock:-i.quantity}},{new:true});if(!updated){for(const done of serverItems.slice(0,serverItems.indexOf(i)))await Product.updateOne({id:done.id},{$inc:{stock:done.quantity}});return res.status(409).json({success:false,message:`Stock changed for ${i.name}. Please try again.`});}}
  const created=await Order.create(order); const plain=created.toObject();
  if(razorpayOrderId)await Payment.findOneAndUpdate({razorpayOrderId},{$set:{orderId:plain.id,status:'order_created'}});
  emit('new-order',plain); notifyOrder({order:plain,event:'placed'}).catch(()=>{});
  res.status(201).json({success:true,message:'Order placed. Waiting for admin confirmation.',order:plain});
 }catch(e){console.error(e);res.status(500).json({success:false,message:'Unable to place order.'});}
});
router.post('/payment-failed',authenticate,async(req,res)=>{
 try{
  const {name,email,phone,altPhone,address,fullAddress,items,paymentMethod,orderNumber,razorpayOrderId,failure}=req.body;
  if(paymentMethod==='cod')return res.status(400).json({success:false,message:'Payment-failed orders are only for online payments.'});
  if(!Array.isArray(items)||!items.length)return res.status(400).json({success:false,message:'Your cart is empty.'});
  if(!name||!email||!phone||!address)return res.status(400).json({success:false,message:'Customer and delivery details are required.'});
  const serverItems=[];let total=0;
  for(const item of items){
   const q=Number(item.quantity),p=await Product.findOne({id:Number(item.id)}).lean();
   if(!p||!Number.isInteger(q)||q<1)return res.status(400).json({success:false,message:'Invalid product or quantity.'});
   total+=Number(p.price)*q;
   serverItems.push({...p,quantity:q,price:Number(p.price)});
  }
  if(razorpayOrderId){
   const existing=await Order.findOne({razorpayOrderId,userId:req.user.id});
   if(existing)return res.json({success:true,message:'Payment failure already recorded.',order:existing});
  }
  const now=new Date().toISOString();
  const order={
   id:Date.now(),userId:req.user.id,userName:String(name).trim(),email:String(email).trim().toLowerCase(),phone:String(phone).trim(),altPhone:String(altPhone||'').trim(),address,fullAddress,
   items:serverItems,total,paymentMethod:paymentMethod||'razorpay',paymentStatus:'failed',status:'Payment Failed',adminConfirmed:false,
   trackingId:null,trackingHistory:[{status:'Payment Failed',timestamp:now,location:'Online Payment',description:failure?.description||'Razorpay payment failed. Order was not confirmed.'}],
   estimatedDelivery:null,createdAt:now,updatedAt:now,orderNumber:orderNumber||`ORD${Date.now()}`,razorpayOrderId:razorpayOrderId||null,razorpayPaymentId:null,
   paymentFailure:failure||null
  };
  const created=await Order.create(order);
  if(razorpayOrderId)await Payment.findOneAndUpdate({razorpayOrderId},{$set:{orderId:created.id,status:'failed',failure:failure||null,failedAt:now}});
  const plain=created.toObject();
  if(global.io)global.io.to(`user:${plain.userId}`).emit('order-updated',plain);
  res.status(201).json({success:true,message:'Payment failed. Order was not confirmed.',order:plain});
 }catch(e){console.error('Payment failure order:',e);res.status(500).json({success:false,message:'Unable to record payment failure.'});}
});
router.put('/:id/confirm',requireAdmin,async(req,res)=>{const o=await Order.findOne({id:Number(req.params.id)});if(!o)return res.status(404).json({success:false,message:'Order not found'});if(o.status!=='Order Placed')return res.status(400).json({success:false,message:`Order cannot be confirmed from ${o.status}.`});const now=new Date().toISOString();o.status='Processing';o.adminConfirmed=true;o.confirmedAt=now;o.updatedAt=now;o.trackingHistory.push({status:'Processing',timestamp:now,location:'Order Processing Center',description:'Order confirmed by admin and moved to processing.'});await o.save();const plain=o.toObject();emit('order-updated',plain);notifyOrder({order:plain,event:'confirmed'}).catch(()=>{});res.json({success:true,message:'Order confirmed and moved to Processing.',order:plain});});
router.put('/:id/status',requireAdmin,async(req,res)=>{const o=await Order.findOne({id:Number(req.params.id)});if(!o)return res.status(404).json({success:false,message:'Order not found'});const {status,location,description}=req.body;if(!transitions[o.status]?.includes(status))return res.status(400).json({success:false,message:`Invalid status transition ${o.status} → ${status}`});const now=new Date().toISOString();o.status=status;o.updatedAt=now;if(status==='Processing')o.adminConfirmed=true;o.trackingHistory.push({status,timestamp:now,location:location||'Processing Center',description:description||`Order status updated to ${status}`});if(req.body.trackingId)o.trackingId=req.body.trackingId;await o.save();const plain=o.toObject();emit('order-updated',plain);res.json({success:true,message:'Order status updated',order:plain});});
async function cancelOrder(o,reason,actor){
 if(['Delivered','Cancelled','Payment Failed','Shipped','Out for Delivery','Packed'].includes(o.status)&&actor!=='admin')throw new Error('This order can no longer be cancelled by the customer.');
 if(o.status==='Cancelled')throw new Error('Order is already cancelled');
 // Restore stock.
 for(const i of o.items||[])await Product.updateOne({id:i.id},{$inc:{stock:Number(i.quantity||0)}});
 let refund=null;
 if(o.paymentStatus==='paid'&&o.razorpayPaymentId){
   refund=await razorpayRequest('POST',`/v1/payments/${encodeURIComponent(o.razorpayPaymentId)}/refund`,{notes:{order_number:o.orderNumber,reason:reason||'Order cancelled'}});
   o.paymentStatus='refund_requested';o.refundId=refund.id;o.refundStatus=refund.status;
 }
 const now=new Date().toISOString();o.status='Cancelled';o.cancelledAt=now;o.cancellationReason=reason||'Cancelled';o.updatedAt=now;o.trackingHistory.push({status:'Cancelled',timestamp:now,location:'Order Processing Center',description:o.cancellationReason});await o.save();return {o,refund};
}
router.put('/:id/cancel',authenticate,async(req,res)=>{try{const o=await Order.findOne({id:Number(req.params.id)});if(!o)return res.status(404).json({success:false,message:'Order not found'});if(!req.user.isAdmin&&String(o.userId)!==String(req.user.id))return res.status(403).json({message:'You are not authorized to cancel this order.'});const result=await cancelOrder(o,req.body.reason||'Cancelled by customer',req.user.isAdmin?'admin':'customer');const plain=result.o.toObject();emit('order-updated',plain);notifyOrder({order:plain,event:'cancelled'}).catch(()=>{});res.json({success:true,message:result.refund?'Order cancelled and refund initiated.':'Order cancelled successfully.',order:plain,refund:result.refund});}catch(e){res.status(400).json({success:false,message:e.message||'Unable to cancel order.'})}});
router.post('/:id/refund',requireAdmin,async(req,res)=>{try{const o=await Order.findOne({id:Number(req.params.id)});if(!o||!o.razorpayPaymentId)return res.status(400).json({success:false,message:'Captured Razorpay payment not found for this order.'});const refund=await razorpayRequest('POST',`/v1/payments/${encodeURIComponent(o.razorpayPaymentId)}/refund`,req.body.amount?{amount:Math.round(Number(req.body.amount)*100),notes:{order_number:o.orderNumber}}:{notes:{order_number:o.orderNumber}});o.paymentStatus='refund_requested';o.refundId=refund.id;o.refundStatus=refund.status;o.updatedAt=new Date().toISOString();await o.save();emit('order-updated',o.toObject());res.json({success:true,refund,order:o.toObject()});}catch(e){res.status(400).json({success:false,message:e.message||'Refund failed'})}});
module.exports=router;
