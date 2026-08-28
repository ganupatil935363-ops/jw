
const express=require('express'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken');
const {User}=require('../db'); const {authenticate}=require('../middleware/auth');
const router=express.Router();
const safe=u=>{const o=u.toObject?u.toObject():{...u}; delete o.password; delete o._id; delete o.__v; return o;};
const token=u=>jwt.sign({id:u.id,email:u.email,name:u.name,isAdmin:!!u.isAdmin},process.env.JWT_SECRET,{expiresIn:'7d'});
router.post('/register',async(req,res)=>{
 try{
  const {name,email,password,phone,address}=req.body; const e=String(email||'').trim().toLowerCase(); const p=String(phone||'').replace(/\D/g,'');
  if(!name||!e||!password||!phone)return res.status(400).json({message:'Name, email, password and phone are required.'});
  if(password.length<8)return res.status(400).json({message:'Password must be at least 8 characters.'});
  if(!/^\d{10}$/.test(p))return res.status(400).json({message:'Please enter a valid 10-digit phone number.'});
  if(await User.exists({email:e}))return res.status(400).json({message:'Email already registered.'});
  const u=await User.create({id:Date.now(),name:String(name).trim(),email:e,password:await bcrypt.hash(password,12),phone:p,address:address||'',isAdmin:false,createdAt:new Date().toISOString()});
  res.status(201).json({message:'User registered successfully. Please login.',user:safe(u)});
 }catch(e){console.error(e);res.status(500).json({message:'Unable to register user.'});}
});
router.post('/login',async(req,res)=>{
 try{
  const e=String(req.body.email||'').trim().toLowerCase(), p=String(req.body.password||''); const u=await User.findOne({email:e});
  if(!u||!await bcrypt.compare(p,u.password))return res.status(401).json({message:'Invalid email or password.'});
  res.json({message:'Login successful',user:safe(u),token:token(u)});
 }catch(e){console.error(e);res.status(500).json({message:'Unable to login.'});}
});
router.get('/me',authenticate,async(req,res)=>{const u=await User.findOne({id:req.user.id}); if(!u)return res.status(401).json({message:'User account no longer exists.'});res.json({user:safe(u)});});
router.get('/',authenticate,async(req,res)=>{if(!req.user.isAdmin)return res.status(403).json({message:'Admin authorization required.'});res.json((await User.find()).map(safe));});
router.get('/:id',authenticate,async(req,res)=>{if(!req.user.isAdmin&&String(req.user.id)!==String(req.params.id))return res.status(403).json({message:'You can only access your own profile.'});const u=await User.findOne({id:Number(req.params.id)});if(!u)return res.status(404).json({message:'User not found'});res.json(safe(u));});
router.put('/:id',authenticate,async(req,res)=>{if(!req.user.isAdmin&&String(req.user.id)!==String(req.params.id))return res.status(403).json({message:'You can only update your own profile.'});const u=await User.findOne({id:Number(req.params.id)});if(!u)return res.status(404).json({message:'User not found'});for(const k of ['name','phone','address'])if(req.body[k]!==undefined)u[k]=req.body[k];if(req.body.password){if(String(req.body.password).length<8)return res.status(400).json({message:'Password must be at least 8 characters.'});u.password=await bcrypt.hash(req.body.password,12);}u.updatedAt=new Date().toISOString();await u.save();res.json({message:'Profile updated',user:safe(u)});});
router.delete('/:id',authenticate,async(req,res)=>{if(!req.user.isAdmin)return res.status(403).json({message:'Admin authorization required.'});const u=await User.findOneAndDelete({id:Number(req.params.id)});if(!u)return res.status(404).json({message:'User not found'});res.json({message:'User deleted',user:safe(u)});});
module.exports=router;
