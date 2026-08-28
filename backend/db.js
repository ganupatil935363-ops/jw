
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const User = mongoose.model('User', new mongoose.Schema({
  id: { type: Number, unique: true, index: true },
  name: String, email: { type: String, unique: true, lowercase: true, index: true },
  password: String, isAdmin: { type: Boolean, default: false },
  phone: String, address: String, createdAt: String, updatedAt: String
}, { timestamps: false }));

const Product = mongoose.model('Product', new mongoose.Schema({
  id: { type: Number, unique: true, index: true }
}, { strict: false, timestamps: false }));

const Store = mongoose.model('Store', new mongoose.Schema({
  key: { type: String, unique: true, index: true },
  categories: { type: Array, default: [] },
  banners: { type: Array, default: [] },
  deals: { type: Array, default: [] },
  settings: { type: Object, default: {} }
}, { strict: false }));

const Order = mongoose.model('Order', new mongoose.Schema({
  id: { type: Number, unique: true, index: true },
  userId: { type: Number, index: true },
  status: { type: String, index: true },
  paymentStatus: String,
  razorpayOrderId: String,
  razorpayPaymentId: String
}, { strict: false, timestamps: false }));

const Payment = mongoose.model('Payment', new mongoose.Schema({
  id: { type: Number, unique: true, index: true },
  razorpayOrderId: { type: String, index: true },
  razorpayPaymentId: { type: String, index: true },
  userId: { type: Number, index: true },
  status: String
}, { strict: false, timestamps: false }));

const WebhookEvent = mongoose.model('WebhookEvent', new mongoose.Schema({
  eventId: { type: String, unique: true, index: true },
  event: String,
  receivedAt: { type: Date, default: Date.now }
}));

async function seedIfEmpty() {
  const dataDir = path.join(__dirname, 'data');
  if (await User.countDocuments() === 0) {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir,'users.json'),'utf8'));
    const users = [];
    for (const u of raw.users || []) {
      const password = String(u.password || '');
      users.push({...u, email: String(u.email).toLowerCase(), password: password.startsWith('$2') ? password : await bcrypt.hash(password, 12)});
    }
    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      const adminEmail = process.env.ADMIN_EMAIL.trim().toLowerCase();
      const existingIndex = users.findIndex(u => u.isAdmin === true);
      const admin = { id: 1, name: process.env.ADMIN_NAME || 'Store Admin', email: adminEmail, password: await bcrypt.hash(process.env.ADMIN_PASSWORD, 12), isAdmin: true, phone: process.env.ADMIN_PHONE || '', address: '', createdAt: new Date().toISOString() };
      if (existingIndex >= 0) users[existingIndex] = admin; else users.unshift(admin);
    }
    if (users.length) await User.insertMany(users, { ordered: false });
  }
  if (await Product.countDocuments() === 0) {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir,'products.json'),'utf8'));
    if (raw.products?.length) await Product.insertMany(raw.products.map(p => ({...p})), { ordered: false });
    await Store.create({
      key:'main',
      categories: raw.categories || [],
      banners: raw.banners || [],
      deals: raw.deals || [],
      settings: JSON.parse(fs.readFileSync(path.join(dataDir,'settings.json'),'utf8'))
    });
  } else if (!(await Store.exists({key:'main'}))) {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir,'products.json'),'utf8'));
    await Store.create({key:'main',categories:raw.categories||[],banners:raw.banners||[],deals:raw.deals||[],settings:JSON.parse(fs.readFileSync(path.join(dataDir,'settings.json'),'utf8'))});
  }
  const oldOrders = await Order.countDocuments();
  if (oldOrders === 0) {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir,'orders.json'),'utf8'));
    if (raw.orders?.length) await Order.insertMany(raw.orders.map(o=>({...o})), { ordered:false });
  }
  const oldPayments = await Payment.countDocuments();
  if (oldPayments === 0) {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir,'payments.json'),'utf8'));
    if (raw.payments?.length) await Payment.insertMany(raw.payments.map(p=>({...p})), { ordered:false });
  }
}

async function connectDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not configured. Add your MongoDB connection string to .env');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  await seedIfEmpty();
  console.log('MongoDB connected');
}
module.exports = { mongoose, User, Product, Store, Order, Payment, WebhookEvent, connectDatabase };
