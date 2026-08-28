
const express=require('express'); const {Product,Store}=require('../db'); const {requireAdmin}=require('../middleware/auth');
const router=express.Router();
const clean=d=>{const o=d.toObject?d.toObject():d;delete o._id;delete o.__v;return o;};
router.get('/',async(req,res)=>{const [products,store]=await Promise.all([Product.find().lean(),Store.findOne({key:'main'}).lean()]);res.json({products,categories:store?.categories||[],banners:store?.banners||[],deals:store?.deals||[]});});
router.get('/:id',async(req,res)=>{const p=await Product.findOne({id:Number(req.params.id)}).lean();if(!p)return res.status(404).json({message:'Product not found'});res.json(p);});
router.post('/',requireAdmin,async(req,res)=>{const p=await Product.create({id:Date.now(),...req.body,createdAt:new Date().toISOString()});res.status(201).json({message:'Product added',product:clean(p)});});
router.put('/:id',requireAdmin,async(req,res)=>{const p=await Product.findOneAndUpdate({id:Number(req.params.id)},{$set:{...req.body,updatedAt:new Date().toISOString()}},{new:true});if(!p)return res.status(404).json({message:'Product not found'});res.json({message:'Product updated',product:clean(p)});});
router.delete('/:id',requireAdmin,async(req,res)=>{const p=await Product.findOneAndDelete({id:Number(req.params.id)});if(!p)return res.status(404).json({message:'Product not found'});res.json({message:'Product deleted',product:clean(p)});});
module.exports=router;
