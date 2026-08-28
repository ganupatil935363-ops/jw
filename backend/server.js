
const path=require('path'),fs=require('fs'),http=require('http'),express=require('express'),cors=require('cors'),multer=require('multer'),helmet=require('helmet'),rateLimit=require('express-rate-limit'),{Server}=require('socket.io');
require('dotenv').config({
    path: path.join(__dirname, '../.env')
});
const {connectDatabase,User}=require('./db');
const {requireAdmin}=require('./middleware/auth');
const app=express(), server=http.createServer(app);
app.get('/api/health',(req,res)=>res.json({ok:true,service:'shrisilverbay'}));
const allowed=(process.env.FRONTEND_URL||'').split(',').map(x=>x.trim().replace(/\/$/, '')).filter(Boolean);
app.use(helmet({contentSecurityPolicy:false,crossOriginResourcePolicy:{policy:'cross-origin'}}));
app.use(cors({
  origin:(origin,cb)=>{
    // Same-origin/server-to-server requests have no Origin header.
    if(!origin) return cb(null,true);
    const normalized=origin.replace(/\/$/, '');
    // When FRONTEND_URL is not configured, allow same-origin/public API use.
    if(allowed.length===0 || allowed.includes(normalized)) return cb(null,true);
    return cb(null,false);
  },
  credentials:true
}));
app.set('trust proxy',1);
const apiLimiter=rateLimit({windowMs:15*60*1000,max:300,standardHeaders:true,legacyHeaders:false});
const authLimiter=rateLimit({windowMs:15*60*1000,max:20,message:{message:'Too many authentication attempts. Please try again later.'}});
app.use('/api',apiLimiter);
// Razorpay webhook MUST receive the raw body before express.json.
const paymentRoutes=require('./routes/payment');
app.use('/api/payments',(req,res,next)=>{if(req.path==='/webhook')return express.raw({type:'application/json'})(req,res,next);next()});
app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:true,limit:'1mb'}));
const io=new Server(server,{cors:{origin:allowed.length?allowed:true,credentials:true}});
global.io=io;
io.use((socket,next)=>{try{const jwt=require('jsonwebtoken');const token=socket.handshake.auth?.token;if(!token)return next(new Error('Authentication required'));const user=jwt.verify(token,process.env.JWT_SECRET);socket.user=user;next()}catch(e){next(new Error('Invalid token'))}});
io.on('connection',socket=>{if(socket.user?.isAdmin)socket.join('admins');if(socket.user?.id)socket.join(`user:${socket.user.id}`);});
const uploadsDir=path.join(__dirname,'../uploads');
for(const d of [uploadsDir,path.join(uploadsDir,'products'),path.join(uploadsDir,'banners'),path.join(uploadsDir,'logo')])if(!fs.existsSync(d))fs.mkdirSync(d,{recursive:true});
app.use('/uploads',express.static(uploadsDir));
app.use('/',express.static(path.join(__dirname,'../public')));
app.use('/admin',express.static(path.join(__dirname,'../admin')));
const storage=multer.diskStorage({destination:(req,file,cb)=>{const f=['products','banners','logo'].includes(req.query.folder)?req.query.folder:'products';cb(null,path.join(uploadsDir,f))},filename:(req,file,cb)=>cb(null,Date.now()+'-'+Math.round(Math.random()*1e9)+path.extname(file.originalname).toLowerCase())});
const upload=multer({storage,limits:{fileSize:5*1024*1024},fileFilter:(req,file,cb)=>cb(null,['image/jpeg','image/png','image/webp','image/gif'].includes(file.mimetype))});
app.post('/api/upload',requireAdmin,upload.array('images',10),(req,res)=>res.json({message:'Upload successful',files:req.files.map(f=>`/uploads/${req.query.folder||'products'}/${f.filename}`)}));
const productRoutes=require('./routes/product'),userRoutes=require('./routes/user'),orderRoutes=require('./routes/order'),adminRoutes=require('./routes/admin');
app.use('/api/products',productRoutes);
app.use('/api/users',userRoutes);
app.use('/api/orders',orderRoutes);
app.use('/api/admin',adminRoutes);
app.use('/api/users/login',authLimiter); app.use('/api/admin/login',authLimiter);
app.use('/api/payments',paymentRoutes);
app.use((err,req,res,next)=>{console.error(err);res.status(err.status||500).json({message:err.message||'Internal server error'})});
async function start(){
  await connectDatabase();
  const PORT=process.env.PORT||3000;
  server.listen(PORT,()=>console.log(`SmartStore running on port ${PORT}`));
}

// Local development only. Vercel imports this file as an Express app.
if (require.main === module) {
  start().catch(e=>{
    console.error('Startup failed:',e.message);
    process.exit(1);
  });
}

module.exports = app;
