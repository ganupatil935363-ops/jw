
const https=require('https');
function razorpayRequest(method,requestPath,body=null){
 return new Promise((resolve,reject)=>{
  const id=process.env.RAZORPAY_KEY_ID, secret=process.env.RAZORPAY_KEY_SECRET;
  if(!id||!secret)return reject(new Error('Razorpay credentials are not configured.'));
  const payload=body?JSON.stringify(body):null;
  const req=https.request({hostname:'api.razorpay.com',path:requestPath,method,headers:{Authorization:`Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,'Content-Type':'application/json',...(payload?{'Content-Length':Buffer.byteLength(payload)}:{})}},r=>{
   let d='';r.on('data',c=>d+=c);r.on('end',()=>{let p;try{p=JSON.parse(d)}catch{p={message:d}};if(r.statusCode>=200&&r.statusCode<300)resolve(p);else reject(new Error(p?.error?.description||p?.message||'Razorpay API request failed'));});
  });req.on('error',reject);if(payload)req.write(payload);req.end();
 });
}
module.exports={razorpayRequest};
