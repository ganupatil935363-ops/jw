const express = require('express');
const { Product, Store } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();
const clean = d => { const o = d.toObject ? d.toObject() : { ...d }; delete o._id; delete o.__v; return o; };

router.get('/', async (req, res) => {
  try {
    const [products, store] = await Promise.all([
      Product.find().lean(),
      Store.findOne({ key: 'main' }).lean()
    ]);
    return res.json({ products, categories: store?.categories || [], banners: store?.banners || [], deals: store?.deals || [] });
  } catch (e) {
    console.error('GET /api/products:', e);
    return res.status(500).json({ message: 'Unable to load products right now.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const p = await Product.findOne({ id: Number(req.params.id) }).lean();
    if (!p) return res.status(404).json({ message: 'Product not found' });
    return res.json(p);
  } catch (e) {
    console.error('GET /api/products/:id:', e);
    return res.status(500).json({ message: 'Unable to load product.' });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const p = await Product.create({ id: Date.now(), ...req.body, createdAt: new Date().toISOString() });
    return res.status(201).json({ message: 'Product added', product: clean(p) });
  } catch (e) {
    console.error('POST /api/products:', e);
    return res.status(400).json({ message: e.message || 'Unable to add product.' });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const p = await Product.findOneAndUpdate({ id: Number(req.params.id) }, { $set: { ...req.body, updatedAt: new Date().toISOString() } }, { new: true });
    if (!p) return res.status(404).json({ message: 'Product not found' });
    return res.json({ message: 'Product updated', product: clean(p) });
  } catch (e) {
    console.error('PUT /api/products/:id:', e);
    return res.status(400).json({ message: e.message || 'Unable to update product.' });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const p = await Product.findOneAndDelete({ id: Number(req.params.id) });
    if (!p) return res.status(404).json({ message: 'Product not found' });
    return res.json({ message: 'Product deleted', product: clean(p) });
  } catch (e) {
    console.error('DELETE /api/products/:id:', e);
    return res.status(400).json({ message: e.message || 'Unable to delete product.' });
  }
});

module.exports = router;
