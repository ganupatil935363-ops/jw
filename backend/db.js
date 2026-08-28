
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
  const catalog = JSON.parse(fs.readFileSync(path.join(dataDir, 'products.json'), 'utf8'));
  const settings = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));

  // USERS: seed only when the database is empty, and always create/update
  // the admin from environment variables without storing plaintext secrets.
  if (await User.countDocuments() === 0) {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8'));
    const users = [];
    for (const u of raw.users || []) {
      const password = String(u.password || '');
      if (!password || password === '__REMOVE__') continue;
      users.push({
        ...u,
        email: String(u.email).toLowerCase(),
        password: password.startsWith('$2') ? password : await bcrypt.hash(password, 12)
      });
    }
    if (users.length) await User.insertMany(users, { ordered: false });
  }

  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const adminEmail = process.env.ADMIN_EMAIL.trim().toLowerCase();
    const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
    let admin = await User.findOne({ isAdmin: true });
    if (!admin) admin = await User.findOne({ email: adminEmail });
    if (admin) {
      admin.name = process.env.ADMIN_NAME || 'Store Admin';
      admin.email = adminEmail;
      admin.password = hashedPassword;
      admin.isAdmin = true;
      admin.phone = process.env.ADMIN_PHONE || '';
      await admin.save();
      console.log(`Admin account ready: ${adminEmail}`);
    } else {
      await User.create({
        id: Date.now(), name: process.env.ADMIN_NAME || 'Store Admin', email: adminEmail,
        password: hashedPassword, isAdmin: true, phone: process.env.ADMIN_PHONE || '',
        address: '', createdAt: new Date().toISOString()
      });
      console.log(`Admin account created: ${adminEmail}`);
    }
  }

  // VERSIONED CATALOG: changing catalogVersion intentionally replaces the old
  // demo catalog once, while preserving any later admin edits on redeploy.
  let store = await Store.findOne({ key: 'main' });
  const targetVersion = Number(settings.catalogVersion || 1);
  if (!store) {
    store = await Store.create({
      key: 'main',
      categories: catalog.categories || [],
      banners: catalog.banners || [],
      deals: catalog.deals || [],
      settings
    });
    await Product.deleteMany({});
    if (catalog.products?.length) await Product.insertMany(catalog.products.map(p => ({...p})), { ordered: false });
  } else if (Number(store.settings?.catalogVersion || 0) !== targetVersion) {
    await Product.deleteMany({});
    if (catalog.products?.length) await Product.insertMany(catalog.products.map(p => ({...p})), { ordered: false });
    store.categories = catalog.categories || [];
    store.banners = catalog.banners || [];
    store.deals = catalog.deals || [];
    store.settings = {...(store.settings || {}), ...settings, catalogVersion: targetVersion};
    await store.save();
    console.log(`Catalog migrated to version ${targetVersion}`);
  } else if (await Product.countDocuments() === 0 && catalog.products?.length) {
    await Product.insertMany(catalog.products.map(p => ({...p})), { ordered: false });
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
