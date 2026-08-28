
const path=require('path'),fs=require('fs'),http=require('http'),express=require('express'),cors=require('cors'),multer=require('multer'),helmet=require('helmet'),rateLimit=require('express-rate-limit'),{Server}=require('socket.io'),{v2:cloudinary}=require('cloudinary');
require('dotenv').config({
    path: path.join(__dirname, '../.env')
});
const {connectDatabase,User}=require('./db');
const {requireAdmin}=require('./middleware/auth');
const app=express(), server=http.createServer(app);
const allowed=(process.env.FRONTEND_URL||'').split(',').map(x=>x.trim().replace(/\/$/, '')).filter(Boolean);
if(process.env.RENDER_EXTERNAL_URL) allowed.push(process.env.RENDER_EXTERNAL_URL.trim().replace(/\/$/, ''));
app.use(helmet({contentSecurityPolicy:false,crossOriginResourcePolicy:{policy:'cross-origin'}}));
const corsForCrossOrigin=cors({origin:(origin,cb)=>{
  if(!origin || allowed.length===0 || allowed.includes(origin.replace(/\/$/, ''))) return cb(null,true);
  return cb(new Error('CORS blocked'));
},credentials:true});
app.use((req,res,next)=>{
  const origin=req.headers.origin;
  const sameOrigin=origin && `${req.protocol}://${req.get('host')}`.replace(/\/$/,'')===origin.replace(/\/$/,'');
  if(!origin || sameOrigin) return next();
  return corsForCrossOrigin(req,res,next);
});
app.set('trust proxy',1);
const apiLimiter=rateLimit({windowMs:15*60*1000,max:300,standardHeaders:true,legacyHeaders:false});
const authLimiter=rateLimit({windowMs:15*60*1000,max:20,message:{message:'Too many authentication attempts. Please try again later.'}});
app.use('/api',apiLimiter);
app.get('/api/health',(req,res)=>res.json({ok:true,service:'shrisilverbay',timestamp:new Date().toISOString()}));
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
const localStorage=multer.diskStorage({destination:(req,file,cb)=>{const f=['products','banners','logo'].includes(req.query.folder)?req.query.folder:'products';cb(null,path.join(uploadsDir,f))},filename:(req,file,cb)=>cb(null,Date.now()+'-'+Math.round(Math.random()*1e9)+path.extname(file.originalname).toLowerCase())});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024},fileFilter:(req,file,cb)=>cb(null,['image/jpeg','image/png','image/webp','image/gif'].includes(file.mimetype)?true:new Error('Only JPG, PNG, WEBP and GIF images are allowed'))});
const cloudinaryConfigured=Boolean(process.env.CLOUDINARY_CLOUD_NAME&&process.env.CLOUDINARY_API_KEY&&process.env.CLOUDINARY_API_SECRET);
if(cloudinaryConfigured){cloudinary.config({cloud_name:process.env.CLOUDINARY_CLOUD_NAME,api_key:process.env.CLOUDINARY_API_KEY,api_secret:process.env.CLOUDINARY_API_SECRET,secure:true});}
function uploadToCloudinary(buffer,folder){return new Promise((resolve,reject)=>{const stream=cloudinary.uploader.upload_stream({folder:`shrisilverbay/${folder}`,resource_type:'image'},(err,result)=>err?reject(err):resolve(result.secure_url));stream.end(buffer);});}
app.post('/api/upload',requireAdmin,upload.array('images',10),async(req,res)=>{
  try{
    if(!req.files?.length)return res.status(400).json({message:'No images selected'});
    const folder=['products','banners','logo'].includes(req.query.folder)?req.query.folder:'products';
    if(cloudinaryConfigured){
      const files=await Promise.all(req.files.map(f=>uploadToCloudinary(f.buffer,folder)));
      return res.json({message:'Upload successful',files});
    }
    if(process.env.NODE_ENV==='production' || process.env.RENDER){
      return res.status(503).json({message:'Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.'});
    }
    const diskUpload=multer({storage:localStorage}).array('images',10);
    return res.status(500).json({message:'Image storage is not configured for this deployment.'});
  }catch(e){console.error('Image upload error:',e);res.status(500).json({message:e.message||'Image upload failed'});}
});
const productRoutes=require('./routes/product'),userRoutes=require('./routes/user'),orderRoutes=require('./routes/order'),adminRoutes=require('./routes/admin');
app.use('/api/users/login',authLimiter);
app.use('/api/admin/login',authLimiter);
app.use('/api/products',productRoutes);
app.use('/api/users',userRoutes);
app.use('/api/orders',orderRoutes);
app.use('/api/admin',adminRoutes);
app.use('/api/payments',paymentRoutes);
app.use((err,req,res,next)=>{console.error(err);res.status(err.status||500).json({message:err.message||'Internal server error'})});
async function start(){await connectDatabase();const PORT=process.env.PORT||3000;server.listen(PORT,()=>console.log(`SmartStore running on port ${PORT}`));}
start().catch(e=>{console.error('Startup failed:',e.message);process.exit(1)});
