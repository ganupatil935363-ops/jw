const API_URL = '';
let currentAdmin = null;
let adminToken = localStorage.getItem('adminToken') || '';
let notificationPollingTimer = null;
let knownOrderIds = new Set();
let adminSocket = null;

// Automatically attach the admin JWT to protected admin/order requests.
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const needsAdminAuth = url.includes('/api/admin/') || /\/api\/orders\//.test(url);
    if (adminToken && needsAdminAuth) {
        const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
        headers.set('Authorization', `Bearer ${adminToken}`);
        init = { ...init, headers };
    }
    return originalFetch(input, init);
};
let tempImages = [];
let tempLogo = '';
let tempCategoryImage = '';
let tempBannerImage = '';
let currentProductId = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupNavigation();
    setupEventListeners();
    setupRichTextEditor();
});

// Check Auth
checkAuth = async () => {
    const admin = localStorage.getItem('admin');
    adminToken = localStorage.getItem('adminToken') || '';
    if (!admin || !adminToken) return;
    try {
        currentAdmin = JSON.parse(admin);
        const res = await fetch(`${API_URL}/api/admin/stats`);
        if (!res.ok) throw new Error('Admin session expired');
        showDashboard();
        connectAdminRealtime();
        loadDashboardData();
        startOrderNotificationPolling();
    } catch (e) {
        localStorage.removeItem('admin');
        localStorage.removeItem('adminToken');
        adminToken = '';
        currentAdmin = null;
    }
};

showDashboard = () => {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('adminDashboard').style.display = 'block';
};

// Navigation
setupNavigation = () => {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const section = item.dataset.section;
            switchSection(section);
        });
    });
};

switchSection = (sectionName) => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelector(`[data-section="${sectionName}"]`)?.classList.add('active');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(sectionName)?.classList.add('active');
    document.getElementById('pageTitle').textContent = sectionName.charAt(0).toUpperCase() + sectionName.slice(1);
    
    // Load data for each section
    const loaders = {
        dashboard: loadDashboardData,
        products: loadProducts,
        categories: loadCategories,
        banners: loadBanners,
        deals: loadDeals,
        orders: loadOrders,
        users: loadUsers,
        settings: loadSettings
    };
    
    if (loaders[sectionName]) loaders[sectionName]();
};

// Rich Text Editor Setup
setupRichTextEditor = () => {
    const editor = document.getElementById('richTextEditor');
    if (!editor) return;
    
    // Toolbar buttons
    document.querySelectorAll('.rte-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const command = btn.dataset.command;
            const value = btn.dataset.value || null;
            
            document.execCommand(command, false, value);
            editor.focus();
        });
    });
    
    // Update HTML textarea on content change
    editor.addEventListener('input', () => {
        const htmlContent = document.getElementById('productDescriptionHTML');
        if (htmlContent) htmlContent.value = editor.innerHTML;
    });
};

// Login
setupEventListeners = () => {
    document.getElementById('adminLoginForm')?.addEventListener('submit', handleLogin);
    document.getElementById('productForm')?.addEventListener('submit', saveProduct);
    document.getElementById('categoryForm')?.addEventListener('submit', saveCategory);
    document.getElementById('bannerForm')?.addEventListener('submit', saveBanner);
    document.getElementById('dealForm')?.addEventListener('submit', saveDeal);
    document.getElementById('settingsForm')?.addEventListener('submit', saveSettings);
};

handleLogin = async (e) => {
    e.preventDefault();
    const email = e.target.querySelector('input[type="email"]').value.trim();
    const password = e.target.querySelector('input[type="password"]').value;
    try {
        const res = await fetch(`${API_URL}/api/admin/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Invalid admin credentials');
        currentAdmin = data.user; adminToken = data.token;
        connectAdminRealtime();
        localStorage.setItem('admin', JSON.stringify(currentAdmin));
        localStorage.setItem('adminToken', adminToken);
        showDashboard(); loadDashboardData(); startOrderNotificationPolling();
    } catch (error) {
        const el = document.getElementById('loginError');
        if (el) { el.textContent = error.message; el.style.display = 'block'; }
    }
};


function connectAdminRealtime() {
    if (typeof io === 'undefined' || !adminToken) return;
    if (adminSocket) adminSocket.disconnect();
    adminSocket = io({ auth: { token: adminToken } });
    adminSocket.on('connect_error', err => console.error('Admin realtime error:', err.message));
    adminSocket.on('new-order', order => {
        showNotification(`New order ${order.orderNumber || '#' + order.id} received`, 'success');
        if ('Notification' in window) {
            if (Notification.permission === 'granted') new Notification('SmartStore - New Order', { body: `${order.orderNumber || '#' + order.id} • ₹${Number(order.total||0).toLocaleString()} • Awaiting confirmation` });
            else if (Notification.permission === 'default') Notification.requestPermission();
        }
        loadDashboardData();
        if (document.getElementById('orders')?.classList.contains('active')) loadOrders();
    });
    adminSocket.on('order-updated', order => {
        loadDashboardData();
        if (document.getElementById('orders')?.classList.contains('active')) loadOrders();
    });
}

adminLogout = () => {
    localStorage.removeItem('admin');
    localStorage.removeItem('adminToken');
    adminToken = '';
    currentAdmin = null;
    if (notificationPollingTimer) clearInterval(notificationPollingTimer);
    if (adminSocket) adminSocket.disconnect();
    location.reload();
};

// New-order notification polling. The first load establishes a baseline; only later orders trigger alerts.
startOrderNotificationPolling = () => {
    if (notificationPollingTimer) clearInterval(notificationPollingTimer);
    if (adminSocket) adminSocket.disconnect();
    notificationPollingTimer = setInterval(checkForNewOrders, 15000);
    checkForNewOrders();
};

checkForNewOrders = async () => {
    if (!adminToken) return;
    try {
        const res = await fetch(`${API_URL}/api/admin/orders`);
        if (!res.ok) return;
        const orders = await res.json();
        const pending = orders.filter(o => o.status === 'Order Placed');
        if (knownOrderIds.size === 0) { pending.forEach(o => knownOrderIds.add(String(o.id))); return; }
        const newOrders = pending.filter(o => !knownOrderIds.has(String(o.id)));
        pending.forEach(o => knownOrderIds.add(String(o.id)));
        if (!newOrders.length) return;
        const latest = newOrders[newOrders.length - 1];
        showNotification(`New order ${latest.orderNumber || '#' + latest.id} received from ${latest.userName || 'customer'}`, 'success');
        if ('Notification' in window) {
            if (Notification.permission === 'granted') new Notification('SmartStore - New Order', { body: `${latest.orderNumber || '#' + latest.id} • ₹${(latest.total || 0).toLocaleString()} • Awaiting confirmation` });
            else if (Notification.permission === 'default') Notification.requestPermission();
        }
        loadDashboardData();
        if (document.getElementById('orders')?.classList.contains('active')) loadOrders();
    } catch (e) { console.error('Order notification check failed', e); }
};

confirmOrder = async (id) => {
    if (!confirm('Confirm this order and move it to Processing?')) return;
    try {
        const res = await fetch(`${API_URL}/api/orders/${id}/confirm`, { method: 'PUT' });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || 'Unable to confirm order');
        showNotification('Order confirmed and moved to Processing');
        loadOrders(); loadDashboardData();
    } catch (e) { showNotification(e.message || 'Unable to confirm order', 'error'); }
};

// Dashboard
loadDashboardData = async () => {
    try {
        const res = await fetch(`${API_URL}/api/admin/stats`);
        const stats = await res.json();
        
        // Update stats with animation
        animateValue('statProducts', stats.totalProducts || 0);
        animateValue('statUsers', stats.totalUsers || 0);
        animateValue('statOrders', stats.totalOrders || 0);
        animateValue('statPending', stats.pendingOrders || 0);
        animateValue('statDelivered', stats.deliveredOrders || 0);
        document.getElementById('statRevenue').textContent = `₹${(stats.totalRevenue || 0).toLocaleString()}`;
        
        // Recent orders
        const tbody = document.getElementById('recentOrdersTable');
        if (tbody && stats.recentOrders?.length) {
            tbody.innerHTML = stats.recentOrders.map(o => `
                <tr>
                    <td><span class="order-id">#${o.id?.toString().slice(-6) || 'N/A'}</span></td>
                    <td>
                        <div class="customer-info">
                            <div class="customer-name">${o.userName || 'Unknown'}</div>
                            <div class="customer-phone">${o.phone || ''}</div>
                        </div>
                    </td>
                    <td><span class="badge badge-info">${o.items?.length || 0} items</span></td>
                    <td class="price">₹${(o.total || 0).toLocaleString()}</td>
                    <td><span class="badge badge-${o.status === 'Delivered' ? 'success' : o.status === 'Order Placed' ? 'warning' : 'info'}">${o.status || 'pending'}</span></td>
                </tr>
            `).join('');
        }
    } catch (err) {
        console.error('Dashboard error:', err);
    }
};

animateValue = (id, end) => {
    const el = document.getElementById(id);
    if (!el) return;
    const start = parseInt(el.textContent) || 0;
    const duration = 1000;
    const startTime = performance.now();
    
    const update = (currentTime) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeProgress = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.floor(start + (end - start) * easeProgress);
        
        if (progress < 1) requestAnimationFrame(update);
    };
    
    requestAnimationFrame(update);
};

// Image Upload
uploadImages = async (files, folder = 'products') => {
    const formData = new FormData();
    files.forEach(f => formData.append('images', f));
    
    const res = await fetch(`${API_URL}/api/upload?folder=${folder}`, {
        method: 'POST',
        body: formData
    });
    const data = await res.json();
    return data.files || [];
};

handleProductImages = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    
    // Show loading
    const preview = document.getElementById('productImagePreview');
    preview.innerHTML = '<div class="upload-loading"><i class="fas fa-spinner fa-spin"></i> Uploading...</div>';
    
    const uploaded = await uploadImages(files, 'products');
    tempImages = [...tempImages, ...uploaded];
    
    renderImagePreview();
};

renderImagePreview = () => {
    const container = document.getElementById('productImagePreview');
    container.innerHTML = tempImages.map((img, i) => `
        <div class="preview-item">
            <img src="${img}" class="preview-img">
            <button type="button" class="remove-img" onclick="removeImage(${i})"><i class="fas fa-times"></i></button>
        </div>
    `).join('');
};

removeImage = (index) => {
    tempImages.splice(index, 1);
    renderImagePreview();
};

handleCategoryImage = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    
    const uploaded = await uploadImages(files, 'products');
    tempCategoryImage = uploaded[0] || '';
    
    const preview = document.getElementById('categoryImagePreview');
    preview.src = tempCategoryImage;
    preview.style.display = 'block';
};

handleBannerImage = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    
    const uploaded = await uploadImages(files, 'banners');
    tempBannerImage = uploaded[0] || '';
    
    const preview = document.getElementById('bannerImagePreview');
    preview.src = tempBannerImage;
    preview.style.display = 'block';
};

handleLogoUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    
    // Show loading
    const preview = document.getElementById('logoPreview');
    const uploadArea = document.querySelector('.file-upload');
    if (uploadArea) {
        uploadArea.innerHTML = '<i class="fas fa-spinner fa-spin"></i><p>Uploading...</p>';
    }
    
    try {
        const uploaded = await uploadImages(files, 'logo');
        if (uploaded && uploaded.length > 0) {
            tempLogo = uploaded[0];
            preview.src = tempLogo;
            preview.style.display = 'block';
            showNotification('Logo uploaded successfully!');
            renderLogoPreview();
        }
    } catch (err) {
        showNotification('Error uploading logo', 'error');
        if (uploadArea) {
            uploadArea.innerHTML = '<i class="fas fa-cloud-upload-alt"></i><p>Click to upload logo</p>';
        }
    }
};

// Render logo preview with remove button
renderLogoPreview = () => {
    const preview = document.getElementById('logoPreview');
    const container = preview?.parentElement;
    
    // Remove existing remove button if any
    const existingBtn = container?.querySelector('.remove-logo-btn');
    if (existingBtn) existingBtn.remove();
    
    if (tempLogo && container) {
        // Create remove button
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-logo-btn';
        removeBtn.innerHTML = '<i class="fas fa-trash"></i> Remove Logo';
        removeBtn.style.cssText = `
            display: block;
            margin-top: 12px;
            padding: 10px 20px;
            background: var(--gradient-accent);
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            font-size: 14px;
        `;
        removeBtn.onclick = removeLogo;
        container.appendChild(removeBtn);
    }
};

// Remove logo function
removeLogo = () => {
    if (!tempLogo) return;
    
    if (confirm('Are you sure you want to remove the logo?')) {
        tempLogo = '';
        const preview = document.getElementById('logoPreview');
        preview.src = '';
        preview.style.display = 'none';
        
        // Remove the remove button
        const removeBtn = document.querySelector('.remove-logo-btn');
        if (removeBtn) removeBtn.remove();
        
        showNotification('Logo removed. Save settings to apply changes.');
    }
};

// Products
loadProducts = async () => {
    try {
        const res = await fetch(`${API_URL}/api/admin/products`);
        const products = await res.json();
        
        const tbody = document.getElementById('productsTable');
        if (!tbody) return;
        
        if (!products?.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><i class="fas fa-box"></i><p>No products found</p></td></tr>';
            return;
        }
        
        tbody.innerHTML = products.map(p => `
            <tr>
                <td><img src="${p.images?.[0] || '/uploads/products/default.jpg'}" class="product-thumb" alt="${p.name}"></td>
                <td>
                    <div class="product-name-cell">${p.name}</div>
                    <div class="product-brand-cell">${p.brand || p.category}</div>
                </td>
                <td><span class="badge badge-info">${p.category}</span></td>
                <td class="price">₹${p.price?.toLocaleString()}</td>
                <td><span class="stock-badge ${p.stock > 10 ? 'in-stock' : p.stock > 0 ? 'low-stock' : 'out-stock'}">${p.stock} units</span></td>
                <td>
                    <div class="action-btns">
                        <button class="btn-action btn-edit" onclick="editProduct(${p.id})" title="Edit"><i class="fas fa-edit"></i></button>
                        <button class="btn-action btn-view" onclick="viewProduct(${p.id})" title="View"><i class="fas fa-eye"></i></button>
                        <button class="btn-action btn-delete" onclick="deleteProduct(${p.id})" title="Delete"><i class="fas fa-trash"></i></button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Products error:', err);
    }
};

showProductModal = () => {
    currentProductId = null;
    tempImages = [];
    document.getElementById('productModalTitle').textContent = 'Add Product';
    document.getElementById('productForm').reset();
    document.getElementById('richTextEditor').innerHTML = '';
    document.getElementById('productImagePreview').innerHTML = '';
    loadCategoryOptions();
    openModal('productModal');
};

editProduct = async (id) => {
    try {
        const res = await fetch(`${API_URL}/api/products/${id}`);
        const p = await res.json();
        if (!p) return;
        
        currentProductId = id;
        document.getElementById('productModalTitle').textContent = 'Edit Product';
        document.getElementById('productName').value = p.name;
        document.getElementById('productBrand').value = p.brand || '';
        document.getElementById('productPrice').value = p.price;
        document.getElementById('productOriginalPrice').value = p.originalPrice || '';
        document.getElementById('productStock').value = p.stock;
        document.getElementById('productRating').value = p.rating || 4.5;
        document.getElementById('productReviews').value = p.reviews || 0;
        document.getElementById('productSeller').value = p.seller || '';
        document.getElementById('productWarranty').value = p.warranty || '';
        document.getElementById('productReturn').value = p.returnPolicy || '';
        document.getElementById('productSpecs').value = p.specs ? JSON.stringify(p.specs, null, 2) : '';
        
        // Rich text editor
        document.getElementById('richTextEditor').innerHTML = p.description || '';
        document.getElementById('productDescriptionHTML').value = p.description || '';
        
        loadCategoryOptions(p.category);
        
        tempImages = p.images || [];
        renderImagePreview();
        
        openModal('productModal');
    } catch (err) {
        showNotification('Error loading product', 'error');
    }
};

viewProduct = async (id) => {
    try {
        const res = await fetch(`${API_URL}/api/products/${id}`);
        const p = await res.json();
        if (!p) return;
        
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'viewProductModal';
        modal.innerHTML = `
            <div class="modal-content large">
                <div class="modal-header">
                    <h3>Product Preview</h3>
                    <button class="close-btn" onclick="closeModal('viewProductModal')">&times;</button>
                </div>
                <div class="product-preview">
                    <div class="preview-gallery">
                        ${p.images?.map(img => `<img src="${img}" class="preview-main-img">`).join('') || '<p>No images</p>'}
                    </div>
                    <div class="preview-details">
                        <h2>${p.name}</h2>
                        <p class="preview-brand">${p.brand || p.category}</p>
                        <div class="preview-price">
                            <span class="current">₹${p.price?.toLocaleString()}</span>
                            ${p.originalPrice ? `<span class="original">₹${p.originalPrice?.toLocaleString()}</span>` : ''}
                        </div>
                        <div class="preview-description">
                            <h4>Description</h4>
                            <div class="description-content">${p.description || 'No description'}</div>
                        </div>
                        ${p.specs ? `
                            <div class="preview-specs">
                                <h4>Specifications</h4>
                                ${Object.entries(p.specs).map(([k, v]) => `<div class="spec-item"><strong>${k}:</strong> ${v}</div>`).join('')}
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.classList.add('show');
    } catch (err) {
        showNotification('Error viewing product', 'error');
    }
};

saveProduct = async (e) => {
    e.preventDefault();
    
    const description = document.getElementById('richTextEditor').innerHTML;
    
    const productData = {
        name: document.getElementById('productName').value,
        brand: document.getElementById('productBrand').value,
        price: parseInt(document.getElementById('productPrice').value),
        originalPrice: parseInt(document.getElementById('productOriginalPrice').value) || null,
        stock: parseInt(document.getElementById('productStock').value),
        rating: parseFloat(document.getElementById('productRating').value),
        reviews: parseInt(document.getElementById('productReviews').value) || 0,
        category: document.getElementById('productCategory').value,
        seller: document.getElementById('productSeller').value,
        warranty: document.getElementById('productWarranty').value,
        returnPolicy: document.getElementById('productReturn').value,
        description: description,
        images: tempImages,
        specs: document.getElementById('productSpecs').value ? JSON.parse(document.getElementById('productSpecs').value) : {},
        delivery: { free: true, estimated: '2-3 days' }
    };
    
    const url = currentProductId ? `${API_URL}/api/admin/products/${currentProductId}` : `${API_URL}/api/admin/products`;
    const method = currentProductId ? 'PUT' : 'POST';
    
    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(productData)
        });
        
        if (res.ok) {
            closeModal('productModal');
            loadProducts();
            loadDashboardData();
            showNotification(currentProductId ? 'Product updated!' : 'Product created!');
        }
    } catch (err) {
        showNotification('Error saving product', 'error');
    }
};

deleteProduct = async (id) => {
    if (!confirm('Are you sure you want to delete this product?')) return;
    
    try {
        const res = await fetch(`${API_URL}/api/admin/products/${id}`, { method: 'DELETE' });
        if (res.ok) {
            loadProducts();
            loadDashboardData();
            showNotification('Product deleted');
        }
    } catch (err) {
        showNotification('Error deleting product', 'error');
    }
};

// Categories
loadCategories = async () => {
    try {
        const res = await fetch(`${API_URL}/api/admin/categories`);
        const categories = await res.json();
        
        const tbody = document.getElementById('categoriesTable');
        if (!tbody) return;
        
        if (!categories?.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty-state"><i class="fas fa-tags"></i><p>No categories</p></td></tr>';
            return;
        }
        
        tbody.innerHTML = categories.map(c => `
            <tr>
                <td><img src="${c.image || '/uploads/products/default.jpg'}" class="category-thumb"></td>
                <td><strong>${c.name}</strong></td>
                <td>${c.subcategories?.map(s => `<span class="badge badge-info">${s}</span>`).join(' ') || '-'}</td>
                <td>
                    <div class="action-btns">
                        <button class="btn-action btn-edit" onclick="editCategory(${c.id})"><i class="fas fa-edit"></i></button>
                        <button class="btn-action btn-delete" onclick="deleteCategory(${c.id})"><i class="fas fa-trash"></i></button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Categories error:', err);
    }
};

loadCategoryOptions = (selected = '') => {
    fetch(`${API_URL}/api/admin/categories`)
        .then(r => r.json())
        .then(cats => {
            const options = cats.map(c => `<option value="${c.name}" ${selected === c.name ? 'selected' : ''}>${c.name}</option>`).join('');
            const selects = ['productCategory', 'dealCategory'];
            selects.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.innerHTML = id === 'productCategory' ? '<option value="">Select Category</option>' + options : options;
            });
        });
};

showCategoryModal = () => {
    document.getElementById('categoryModalTitle').textContent = 'Add Category';
    document.getElementById('categoryForm').reset();
    document.getElementById('categoryId').value = '';
    tempCategoryImage = '';
    document.getElementById('categoryImagePreview').style.display = 'none';
    openModal('categoryModal');
};

editCategory = async (id) => {
    try {
        const res = await fetch(`${API_URL}/api/admin/categories`);
        const cats = await res.json();
        const c = cats.find(cat => cat.id === id);
        if (!c) return;
        
        document.getElementById('categoryModalTitle').textContent = 'Edit Category';
        document.getElementById('categoryId').value = c.id;
        document.getElementById('categoryName').value = c.name;
        document.getElementById('categorySubcategories').value = c.subcategories?.join(', ') || '';
        
        tempCategoryImage = c.image || '';
        if (tempCategoryImage) {
            document.getElementById('categoryImagePreview').src = tempCategoryImage;
            document.getElementById('categoryImagePreview').style.display = 'block';
        }
        
        openModal('categoryModal');
    } catch (err) {
        showNotification('Error loading category', 'error');
    }
};

saveCategory = async (e) => {
    e.preventDefault();
    
    const categoryData = {
        name: document.getElementById('categoryName').value,
        image: tempCategoryImage,
        subcategories: document.getElementById('categorySubcategories').value.split(',').map(s => s.trim()).filter(Boolean)
    };
    
    const id = document.getElementById('categoryId').value;
    const url = id ? `${API_URL}/api/admin/categories/${id}` : `${API_URL}/api/admin/categories`;
    const method = id ? 'PUT' : 'POST';
    
    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(categoryData)
        });
        
        if (res.ok) {
            closeModal('categoryModal');
            loadCategories();
            showNotification(id ? 'Category updated!' : 'Category created!');
        }
    } catch (err) {
        showNotification('Error saving category', 'error');
    }
};

deleteCategory = async (id) => {
    if (!confirm('Delete this category?')) return;
    
    try {
        const res = await fetch(`${API_URL}/api/admin/categories/${id}`, { method: 'DELETE' });
        if (res.ok) loadCategories();
    } catch (err) {
        showNotification('Error deleting category', 'error');
    }
};

// Banners
loadBanners = async () => {
    try {
        const res = await fetch(`${API_URL}/api/admin/banners`);
        const banners = await res.json();
        
        const grid = document.getElementById('bannersGrid');
        if (!grid) return;
        
        if (!banners?.length) {
            grid.innerHTML = '<div class="empty-state full-width"><i class="fas fa-image"></i><p>No banners</p></div>';
            return;
        }
        
        grid.innerHTML = banners.map(b => `
            <div class="banner-card">
                <div class="banner-image-wrapper">
                    <img src="${b.image}" class="banner-image">
                    <div class="banner-overlay">
                        <h4>${b.title}</h4>
                        <p>${b.subtitle || ''}</p>
                    </div>
                </div>
                <div class="banner-actions">
                    <button class="btn-small btn-edit" onclick="editBanner(${b.id})"><i class="fas fa-edit"></i> Edit</button>
                    <button class="btn-small btn-delete" onclick="deleteBanner(${b.id})"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Banners error:', err);
    }
};

showBannerModal = () => {
    document.getElementById('bannerModalTitle').textContent = 'Add Banner';
    document.getElementById('bannerForm').reset();
    document.getElementById('bannerId').value = '';
    tempBannerImage = '';
    document.getElementById('bannerImagePreview').style.display = 'none';
    openModal('bannerModal');
};

editBanner = async (id) => {
    try {
        const res = await fetch(`${API_URL}/api/admin/banners`);
        const banners = await res.json();
        const b = banners.find(ban => ban.id === id);
        if (!b) return;
        
        document.getElementById('bannerModalTitle').textContent = 'Edit Banner';
        document.getElementById('bannerId').value = b.id;
        document.getElementById('bannerTitle').value = b.title;
        document.getElementById('bannerSubtitle').value = b.subtitle || '';
        document.getElementById('bannerButton').value = b.buttonText || 'Shop Now';
        document.getElementById('bannerColor').value = b.color || '#1a1a1a';
        
        tempBannerImage = b.image || '';
        if (tempBannerImage) {
            document.getElementById('bannerImagePreview').src = tempBannerImage;
            document.getElementById('bannerImagePreview').style.display = 'block';
        }
        
        openModal('bannerModal');
    } catch (err) {
        showNotification('Error loading banner', 'error');
    }
};

saveBanner = async (e) => {
    e.preventDefault();
    
    const bannerData = {
        title: document.getElementById('bannerTitle').value,
        subtitle: document.getElementById('bannerSubtitle').value,
        image: tempBannerImage,
        color: document.getElementById('bannerColor').value,
        buttonText: document.getElementById('bannerButton').value
    };
    
    const id = document.getElementById('bannerId').value;
    const url = id ? `${API_URL}/api/admin/banners/${id}` : `${API_URL}/api/admin/banners`;
    const method = id ? 'PUT' : 'POST';
    
    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bannerData)
        });
        
        if (res.ok) {
            closeModal('bannerModal');
            loadBanners();
            showNotification(id ? 'Banner updated!' : 'Banner created!');
        }
    } catch (err) {
        showNotification('Error saving banner', 'error');
    }
};

deleteBanner = async (id) => {
    if (!confirm('Delete this banner?')) return;
    
    try {
        const res = await fetch(`${API_URL}/api/admin/banners/${id}`, { method: 'DELETE' });
        if (res.ok) loadBanners();
    } catch (err) {
        showNotification('Error deleting banner', 'error');
    }
};

// Deals
loadDeals = async () => {
    try {
        const res = await fetch(`${API_URL}/api/admin/deals`);
        const deals = await res.json();
        
        const tbody = document.getElementById('dealsTable');
        if (!tbody) return;
        
        if (!deals?.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><i class="fas fa-percent"></i><p>No deals</p></td></tr>';
            return;
        }
        
        tbody.innerHTML = deals.map(d => `
            <tr>
                <td><i class="fas ${d.icon || 'fa-percent'}"></i></td>
                <td><strong>${d.title}</strong></td>
                <td><span class="discount-text">${d.discount}</span></td>
                <td><span class="badge badge-info">${d.category}</span></td>
                <td><span class="badge badge-${d.active ? 'success' : 'danger'}">${d.active ? 'Active' : 'Inactive'}</span></td>
                <td>
                    <div class="action-btns">
                        <button class="btn-action btn-edit" onclick="editDeal(${d.id})"><i class="fas fa-edit"></i></button>
                        <button class="btn-action btn-delete" onclick="deleteDeal(${d.id})"><i class="fas fa-trash"></i></button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Deals error:', err);
    }
};

showDealModal = () => {
    document.getElementById('dealModalTitle').textContent = 'Add Deal';
    document.getElementById('dealForm').reset();
    document.getElementById('dealId').value = '';
    loadCategoryOptions();
    openModal('dealModal');
};

editDeal = async (id) => {
    try {
        const res = await fetch(`${API_URL}/api/admin/deals`);
        const deals = await res.json();
        const d = deals.find(deal => deal.id === id);
        if (!d) return;
        
        document.getElementById('dealModalTitle').textContent = 'Edit Deal';
        document.getElementById('dealId').value = d.id;
        document.getElementById('dealIcon').value = d.icon;
        document.getElementById('dealTitle').value = d.title;
        document.getElementById('dealDiscount').value = d.discount;
        document.getElementById('dealActive').checked = d.active;
        loadCategoryOptions(d.category);
        
        openModal('dealModal');
    } catch (err) {
        showNotification('Error loading deal', 'error');
    }
};

saveDeal = async (e) => {
    e.preventDefault();
    
    const dealData = {
        icon: document.getElementById('dealIcon').value,
        title: document.getElementById('dealTitle').value,
        discount: document.getElementById('dealDiscount').value,
        category: document.getElementById('dealCategory').value,
        active: document.getElementById('dealActive').checked
    };
    
    const id = document.getElementById('dealId').value;
    const url = id ? `${API_URL}/api/admin/deals/${id}` : `${API_URL}/api/admin/deals`;
    const method = id ? 'PUT' : 'POST';
    
    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dealData)
        });
        
        if (res.ok) {
            closeModal('dealModal');
            loadDeals();
            showNotification(id ? 'Deal updated!' : 'Deal created!');
        }
    } catch (err) {
        showNotification('Error saving deal', 'error');
    }
};

deleteDeal = async (id) => {
    if (!confirm('Delete this deal?')) return;
    
    try {
        const res = await fetch(`${API_URL}/api/admin/deals/${id}`, { method: 'DELETE' });
        if (res.ok) loadDeals();
    } catch (err) {
        showNotification('Error deleting deal', 'error');
    }
};

// Orders
loadOrders = async () => {
    try {
        const res = await fetch(`${API_URL}/api/admin/orders`);
        const orders = await res.json();
        
        const tbody = document.getElementById('ordersTable');
        if (!tbody) return;
        
        if (!orders?.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><i class="fas fa-shopping-cart"></i><p>No orders</p></td></tr>';
            return;
        }
        
        tbody.innerHTML = orders.map(o => `
            <tr>
                <td><span class="order-id">${o.orderNumber || '#' + o.id?.toString().slice(-6)}</span></td>
                <td>
                    <div class="customer-info">
                        <div class="customer-name">${o.userName || 'Unknown'}</div>
                        <div class="customer-phone">${o.phone || ''}</div>
                    </div>
                </td>
                <td><span class="badge badge-${getStatusColor(o.status)}">${o.status?.toUpperCase() || 'PENDING'}</span></td>
                <td>
                    <div style="font-size: 12px; color: var(--gray);">
                        ${o.trackingId ? `<div><i class="fas fa-truck"></i> ${o.trackingId}</div>` : ''}
                        ${o.estimatedDelivery ? `<div>Est: ${new Date(o.estimatedDelivery).toLocaleDateString('en-IN')}</div>` : ''}
                    </div>
                </td>
                <td class="price">₹${(o.total || 0).toLocaleString()}</td>
                <td>${o.paymentMethod === 'cod' ? 'COD' : o.paymentMethod?.toUpperCase() || 'COD'}</td>
                <td>${new Date(o.createdAt).toLocaleDateString('en-IN')}</td>
                <td>
                    <div class="action-btns">
                        <button class="btn-action btn-view" onclick="viewOrder('${o.id}')" title="View Order"><i class="fas fa-eye"></i></button>
                        ${o.status === 'Order Placed' && o.paymentStatus !== 'failed' ? `<button class="btn-action btn-edit" onclick="confirmOrder('${o.id}')" title="Confirm & Start Processing"><i class="fas fa-check"></i></button>` : ''}
                        ${o.status !== 'Payment Failed' ? `<button class="btn-action btn-edit" onclick="updateOrderStatusModal('${o.id}')" title="Update Status"><i class="fas fa-sync-alt"></i></button>` : ''}
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Orders error:', err);
    }
};

// Get status color for badge
getStatusColor = (status) => {
    const statusMap = {
        'Order Placed': 'warning',
        'Confirmed': 'info',
        'Processing': 'info',
        'Packed': 'info',
        'Shipped': 'primary',
        'Out for Delivery': 'primary',
        'Delivered': 'success',
        'Cancelled': 'danger',
        'Payment Failed': 'danger',
        'Returned': 'danger',
        'Refund Processing': 'warning'
    };
    return statusMap[status] || 'warning';
};

// Update order status with tracking modal
updateOrderStatusModal = async (id) => {
    try {
        const res = await fetch(`${API_URL}/api/admin/orders`);
        const orders = await res.json();
        const o = orders.find(order => order.id === id || order.id === parseInt(id));
        if (!o) return;
        
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'updateStatusModal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h3><i class="fas fa-sync-alt"></i> Update Order Status</h3>
                    <button class="close-btn" onclick="closeModal('updateStatusModal')">&times;</button>
                </div>
                <div style="padding: 20px;">
                    <div style="margin-bottom: 20px;">
                        <p style="margin: 0 0 8px 0; color: var(--gray);">Order</p>
                        <p style="margin: 0; font-weight: 600; font-size: 18px;">${o.orderNumber || '#' + o.id?.toString().slice(-6)}</p>
                    </div>
                    <div style="margin-bottom: 20px;">
                        <p style="margin: 0 0 8px 0; color: var(--gray);">Current Status</p>
                        <span class="badge badge-${getStatusColor(o.status)}" style="font-size: 14px; padding: 8px 16px;">${o.status?.toUpperCase() || 'PENDING'}</span>
                    </div>
                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 500;">New Status *</label>
                        <select id="newOrderStatus" style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 15px;">
                            <option value="">Select Status</option>
                            <option value="Order Placed" ${o.status === 'Order Placed' ? 'selected' : ''}>Order Placed</option>
                            <option value="Confirmed">Confirmed</option>
                            <option value="Processing">Processing</option>
                            <option value="Packed">Packed</option>
                            <option value="Shipped">Shipped</option>
                            <option value="Out for Delivery">Out for Delivery</option>
                            <option value="Delivered">Delivered</option>
                            <option value="Cancelled">Cancelled</option>
                        </select>
                    </div>
                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 500;">Location/City *</label>
                        <input type="text" id="statusLocation" placeholder="e.g., Delhi Hub, Mumbai Warehouse" style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 15px;">
                    </div>
                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 500;">Description/Note</label>
                        <textarea id="statusDescription" rows="2" placeholder="e.g., Your order has been shipped via Delhivery" style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 15px; resize: vertical;"></textarea>
                    </div>
                    <div id="trackingIdSection" style="margin-bottom: 20px; ${o.trackingId ? 'display:none;' : ''}">
                        <label style="display: block; margin-bottom: 8px; font-weight: 500;">Tracking ID</label>
                        <input type="text" id="trackingIdInput" value="${o.trackingId || ''}" placeholder="Auto-generated if empty" style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 15px;">
                        <small style="color: var(--gray);">Leave empty to auto-generate tracking ID</small>
                    </div>
                    <button class="btn btn-primary" style="width: 100%; padding: 16px;" onclick="saveOrderStatus('${o.id}')">
                        <i class="fas fa-save"></i> Update Status
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.classList.add('show');
    } catch (err) {
        showNotification('Error loading order', 'error');
    }
};

// Save order status with tracking
saveOrderStatus = async (id) => {
    const status = document.getElementById('newOrderStatus').value;
    const location = document.getElementById('statusLocation').value;
    const description = document.getElementById('statusDescription').value;
    const trackingId = document.getElementById('trackingIdInput')?.value;
    
    if (!status) {
        showNotification('Please select a status', 'error');
        return;
    }
    if (!location) {
        showNotification('Please enter location', 'error');
        return;
    }
    
    const updateData = { 
        status, 
        location, 
        description: description || `Order status updated to ${status}` 
    };
    
    if (trackingId) {
        updateData.trackingId = trackingId;
    }
    
    try {
        const res = await fetch(`${API_URL}/api/orders/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData)
        });
        
        if (res.ok) {
            closeModal('updateStatusModal');
            loadOrders();
            loadDashboardData();
            showNotification(`Order status updated to ${status}`);
        } else {
            showNotification('Error updating status', 'error');
        }
    } catch (err) {
        showNotification('Error updating order status', 'error');
    }
};

// Legacy update order status (for dropdown)
updateOrderStatus = async (id, status) => {
    try {
        const res = await fetch(`${API_URL}/api/orders/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                status, 
                location: 'Processing Center',
                description: `Order status updated to ${status}` 
            })
        });
        
        if (res.ok) {
            loadDashboardData();
            showNotification(`Order status updated to ${status}`);
        }
    } catch (err) {
        showNotification('Error updating order', 'error');
    }
};

viewOrder = async (id) => {
    try {
        const res = await fetch(`${API_URL}/api/admin/orders`);
        const orders = await res.json();
        const o = orders.find(order => order.id === id || order.id === parseInt(id));
        if (!o) return;
        
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'viewOrderModal';
        modal.innerHTML = `
            <div class="modal-content large" style="max-width: 800px; max-height: 90vh; overflow-y: auto;">
                <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h3>Order ${o.orderNumber || '#' + o.id?.toString().slice(-6)}</h3>
                        <p style="margin: 5px 0 0 0; font-size: 13px; color: var(--gray);">
                            Placed on ${new Date(o.createdAt).toLocaleString('en-IN')}
                        </p>
                    </div>
                    <div style="display: flex; gap: 12px;">
                        <button class="btn btn-primary" onclick="generateInvoice('${o.id}')" style="padding: 10px 20px;">
                            <i class="fas fa-file-invoice"></i> Invoice
                        </button>
                        <button class="close-btn" onclick="closeModal('viewOrderModal')">&times;</button>
                    </div>
                </div>
                
                <!-- Order Status Banner -->
                <div style="background: var(--gradient-primary); color: white; padding: 20px; margin: 0 20px; border-radius: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
                        <div>
                            <p style="margin: 0; opacity: 0.9; font-size: 13px;">Current Status</p>
                            <h2 style="margin: 5px 0 0 0; font-size: 24px;">${o.status?.toUpperCase() || 'PENDING'}</h2>
                        </div>
                        <div style="text-align: right;">
                            ${o.trackingId ? `
                                <p style="margin: 0; opacity: 0.9; font-size: 13px;">Tracking ID</p>
                                <p style="margin: 5px 0 0 0; font-size: 18px; font-weight: 600;">${o.trackingId}</p>
                            ` : '<p style="margin: 0; opacity: 0.7;">No Tracking ID</p>'}
                        </div>
                    </div>
                    ${o.estimatedDelivery ? `
                        <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.3);">
                            <p style="margin: 0; font-size: 14px;">
                                <i class="fas fa-calendar-alt"></i> Estimated Delivery: <strong>${new Date(o.estimatedDelivery).toLocaleDateString('en-IN')}</strong>
                            </p>
                        </div>
                    ` : ''}
                </div>

                <div class="order-detail" style="padding: 20px;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                        <!-- Customer Details -->
                        <div class="detail-section" style="background: var(--light-gray); padding: 20px; border-radius: 12px;">
                            <h4 style="margin-bottom: 15px; color: var(--primary);"><i class="fas fa-user"></i> Customer Details</h4>
                            <p style="margin: 8px 0;"><strong>Name:</strong> ${o.userName}</p>
                            <p style="margin: 8px 0;"><strong>Phone:</strong> ${o.phone}</p>
                            ${o.altPhone ? `<p style="margin: 8px 0;"><strong>Alt Phone:</strong> ${o.altPhone}</p>` : ''}
                            ${o.email ? `<p style="margin: 8px 0;"><strong>Email:</strong> ${o.email}</p>` : ''}
                        </div>
                        
                        <!-- Shipping Address -->
                        <div class="detail-section" style="background: var(--light-gray); padding: 20px; border-radius: 12px;">
                            <h4 style="margin-bottom: 15px; color: var(--primary);"><i class="fas fa-map-marker-alt"></i> Shipping Address</h4>
                            <p style="margin: 8px 0; line-height: 1.6;">${o.fullAddress || o.address}</p>
                            ${o.address?.type ? `<p style="margin: 8px 0;"><span class="badge badge-info">${o.address.type.toUpperCase()}</span></p>` : ''}
                        </div>
                    </div>

                    <!-- Tracking Timeline -->
                    ${o.trackingHistory && o.trackingHistory.length > 0 ? `
                        <div style="margin-top: 25px;">
                            <h4 style="margin-bottom: 20px; color: var(--primary);"><i class="fas fa-route"></i> Tracking History</h4>
                            <div style="position: relative; padding-left: 30px;">
                                ${o.trackingHistory.slice().reverse().map((track, index) => `
                                    <div style="position: relative; padding-bottom: 25px; ${index === o.trackingHistory.length - 1 ? '' : 'border-left: 2px solid var(--border);'} margin-left: 5px;">
                                        <div style="position: absolute; left: -36px; top: 0; width: 20px; height: 20px; background: ${index === 0 ? 'var(--success)' : 'var(--gray)'}; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.2);"></div>
                                        <div style="background: ${index === 0 ? '#f0fff4' : 'var(--light-gray)'}; padding: 15px; border-radius: 10px; margin-left: 10px;">
                                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                                <span style="font-weight: 600; color: var(--primary);">${track.status}</span>
                                                <span style="font-size: 12px; color: var(--gray);">${new Date(track.timestamp).toLocaleString('en-IN')}</span>
                                            </div>
                                            <p style="margin: 0; color: var(--dark-gray); font-size: 14px;">${track.description}</p>
                                            ${track.location ? `<p style="margin: 5px 0 0 0; font-size: 12px; color: var(--gray);"><i class="fas fa-map-marker-alt"></i> ${track.location}</p>` : ''}
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                    
                    <!-- Order Items -->
                    <div style="margin-top: 25px;">
                        <h4 style="margin-bottom: 15px; color: var(--primary);"><i class="fas fa-shopping-cart"></i> Order Items</h4>
                        ${o.items?.map(i => `
                            <div style="display: flex; gap: 15px; padding: 15px; background: var(--light-gray); border-radius: 12px; margin-bottom: 10px;">
                                <img src="${i.images?.[0] || '/uploads/products/default.jpg'}" style="width: 80px; height: 80px; object-fit: cover; border-radius: 8px;">
                                <div style="flex: 1;">
                                    <p style="margin: 0; font-weight: 500;">${i.name}</p>
                                    <p style="margin: 5px 0; color: var(--gray); font-size: 14px;">${i.brand || i.category}</p>
                                    <p style="margin: 5px 0; color: var(--gray); font-size: 14px;">Qty: ${i.quantity} × ₹${i.price.toLocaleString()}</p>
                                </div>
                                <p style="margin: 0; font-weight: 600; font-size: 16px;">₹${(i.price * i.quantity).toLocaleString()}</p>
                            </div>
                        `).join('') || '<p>No items</p>'}
                    </div>
                    
                    <!-- Payment Details -->
                    <div style="margin-top: 25px; background: var(--light-gray); padding: 20px; border-radius: 12px;">
                        <h4 style="margin-bottom: 15px; color: var(--primary);"><i class="fas fa-credit-card"></i> Payment Details</h4>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
                            <div>
                                <p style="margin: 0; color: var(--gray); font-size: 13px;">Payment Method</p>
                                <p style="margin: 5px 0 0 0; font-weight: 500;">${o.paymentMethod === 'cod' ? 'Cash on Delivery' : o.paymentMethod === 'card' ? 'Credit/Debit Card' : o.paymentMethod === 'upi' ? 'UPI Payment' : o.paymentMethod || 'COD'}</p>
                            </div>
                            <div>
                                <p style="margin: 0; color: var(--gray); font-size: 13px;">Payment Status</p>
                                <p style="margin: 5px 0 0 0; font-weight: 500;">${o.paymentMethod === 'cod' ? '<span style="color: var(--warning);">Pay on Delivery</span>' : '<span style="color: var(--success);">Paid</span>'}</p>
                            </div>
                            <div>
                                <p style="margin: 0; color: var(--gray); font-size: 13px;">Order Total</p>
                                <p style="margin: 5px 0 0 0; font-size: 20px; font-weight: 700; color: var(--primary);">₹${(o.total || 0).toLocaleString()}</p>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div style="padding: 20px; border-top: 1px solid var(--border); display: flex; justify-content: center; gap: 16px; flex-wrap: wrap;">
                    <button class="btn btn-primary" onclick="updateOrderStatusModal('${o.id}')" style="padding: 12px 30px;">
                        <i class="fas fa-sync-alt"></i> Update Status
                    </button>
                    <button class="btn btn-secondary" onclick="generateInvoice('${o.id}')" style="padding: 12px 30px;">
                        <i class="fas fa-print"></i> Print Invoice
                    </button>
                    ${!['Delivered', 'Cancelled'].includes(o.status) ? `
                    <button class="btn btn-danger" onclick="cancelAdminOrder('${o.id}')" style="padding: 12px 30px; background: var(--accent); color: white; border: none; border-radius: 8px; cursor: pointer;">
                        <i class="fas fa-times-circle"></i> Cancel Order
                    </button>
                    ` : ''}
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.classList.add('show');
    } catch (err) {
        showNotification('Error loading order', 'error');
    }
};

// Cancel order from admin panel
cancelAdminOrder = async (orderId) => {
    if (!confirm('Are you sure you want to cancel this order?\n\nThis action cannot be undone.')) {
        return;
    }
    
    const reason = prompt('Please provide a reason for cancellation:');
    if (!reason) {
        showNotification('Cancellation reason is required', 'error');
        return;
    }
    
    try {
        const res = await fetch(`${API_URL}/api/orders/${orderId}/cancel`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: reason })
        });
        
        const data = await res.json();
        
        if (res.ok && data.success) {
            closeModal('viewOrderModal');
            loadOrders();
            loadDashboardData();
            showNotification('Order cancelled successfully');
        } else {
            showNotification(data.message || 'Failed to cancel order', 'error');
        }
    } catch (err) {
        console.error('Error cancelling order:', err);
        showNotification('Error cancelling order. Please try again.', 'error');
    }
};

// Generate Invoice/Bill
generateInvoice = async (orderId) => {
    try {
        const res = await fetch(`${API_URL}/api/admin/orders`);
        const orders = await res.json();
        const order = orders.find(o => o.id === orderId || o.id === parseInt(orderId));
        if (!order) return;
        
        const settingsRes = await fetch(`${API_URL}/api/admin/settings`);
        const settings = await settingsRes.json();
        
        const invoiceWindow = window.open('', '_blank');
        
        const invoiceHTML = `
<!DOCTYPE html>
<html>
<head>
    <title>Invoice - ${order.orderNumber || order.id}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f5; padding: 20px; }
        .invoice-container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { display: flex; justify-content: space-between; margin-bottom: 30px; border-bottom: 3px solid #1a1a2e; padding-bottom: 20px; }
        .company-info h1 { color: #1a1a2e; font-size: 28px; margin-bottom: 5px; }
        .company-info p { color: #666; font-size: 14px; }
        .invoice-info { text-align: right; }
        .invoice-info h2 { color: #1a1a2e; font-size: 24px; margin-bottom: 10px; }
        .invoice-info p { color: #666; font-size: 14px; margin: 3px 0; }
        .status { display: inline-block; padding: 5px 15px; border-radius: 20px; font-size: 12px; font-weight: bold; text-transform: uppercase; }
        .status-pending { background: #fff3cd; color: #856404; }
        .status-delivered { background: #d4edda; color: #155724; }
        .status-cancelled { background: #f8d7da; color: #721c24; }
        .section { margin: 25px 0; }
        .section h3 { color: #1a1a2e; font-size: 16px; margin-bottom: 15px; padding-bottom: 8px; border-bottom: 1px solid #eee; }
        .customer-details p, .order-details p { margin: 8px 0; font-size: 14px; color: #444; }
        .customer-details strong, .order-details strong { color: #1a1a2e; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th { background: #1a1a2e; color: white; padding: 12px; text-align: left; font-size: 14px; }
        td { padding: 12px; border-bottom: 1px solid #eee; font-size: 14px; }
        .product-cell { display: flex; align-items: center; gap: 12px; }
        .product-cell img { width: 50px; height: 50px; object-fit: cover; border-radius: 4px; }
        .totals { margin-top: 20px; border-top: 2px solid #1a1a2e; padding-top: 20px; }
        .total-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; }
        .total-row.grand { font-size: 20px; font-weight: bold; color: #1a1a2e; border-top: 2px solid #ddd; margin-top: 10px; padding-top: 15px; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #666; font-size: 12px; }
        .footer p { margin: 5px 0; }
        .print-btn { position: fixed; top: 20px; right: 20px; padding: 12px 24px; background: #1a1a2e; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
        .print-btn:hover { background: #333; }
        @media print { 
            body { background: white; padding: 0; }
            .invoice-container { box-shadow: none; padding: 20px; }
            .print-btn { display: none; }
        }
    </style>
</head>
<body>
    <button class="print-btn" onclick="window.print()">
        <i class="fas fa-print"></i> Print / Save as PDF
    </button>
    
    <div class="invoice-container">
        <div class="header">
            <div class="company-info">
                <h1>${settings.siteName || 'SmartStore'}</h1>
                <p>India's #1 Shopping Destination</p>
                <p>Email: support@smartstore.com | Phone: 1800-123-4567</p>
            </div>
            <div class="invoice-info">
                <h2>INVOICE</h2>
                <p><strong>Order #:</strong> ${order.orderNumber || order.id}</p>
                <p><strong>Date:</strong> ${new Date(order.createdAt).toLocaleDateString('en-IN')}</p>
                <span class="status status-${order.status}">${order.status?.toUpperCase()}</span>
            </div>
        </div>
        
        <div class="section customer-details">
            <h3><i class="fas fa-user"></i> Bill To</h3>
            <p><strong>Name:</strong> ${order.userName}</p>
            <p><strong>Phone:</strong> ${order.phone}</p>
            ${order.altPhone ? `<p><strong>Alt Phone:</strong> ${order.altPhone}</p>` : ''}
            ${order.email ? `<p><strong>Email:</strong> ${order.email}</p>` : ''}
            <p><strong>Address:</strong> ${order.fullAddress || order.address}</p>
            ${order.address?.type ? `<p><strong>Address Type:</strong> ${order.address.type.toUpperCase()}</p>` : ''}
        </div>
        
        <div class="section">
            <h3><i class="fas fa-shopping-cart"></i> Order Items</h3>
            <table>
                <thead>
                    <tr>
                        <th>Product</th>
                        <th>Unit Price</th>
                        <th>Qty</th>
                        <th>Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${order.items?.map(item => `
                        <tr>
                            <td>
                                <div class="product-cell">
                                    <img src="${item.images?.[0] || '/uploads/products/default.jpg'}" alt="${item.name}">
                                    <span>${item.name}</span>
                                </div>
                            </td>
                            <td>₹${item.price?.toLocaleString()}</td>
                            <td>${item.quantity}</td>
                            <td>₹${(item.price * item.quantity).toLocaleString()}</td>
                        </tr>
                    `).join('') || '<tr><td colspan="4">No items</td></tr>'}
                </tbody>
            </table>
        </div>
        
        <div class="totals">
            <div class="total-row">
                <span>Subtotal:</span>
                <span>₹${(order.total || 0).toLocaleString()}</span>
            </div>
            <div class="total-row">
                <span>Shipping:</span>
                <span>FREE</span>
            </div>
            <div class="total-row">
                <span>Tax (GST):</span>
                <span>Included</span>
            </div>
            <div class="total-row grand">
                <span>Total Amount:</span>
                <span>₹${(order.total || 0).toLocaleString()}</span>
            </div>
        </div>
        
        <div class="section order-details">
            <h3><i class="fas fa-credit-card"></i> Payment Information</h3>
            <p><strong>Payment Method:</strong> ${order.paymentMethod === 'cod' ? 'Cash on Delivery' : order.paymentMethod === 'card' ? 'Credit/Debit Card' : order.paymentMethod === 'upi' ? 'UPI Payment' : order.paymentMethod || 'COD'}</p>
            <p><strong>Payment Status:</strong> ${order.paymentMethod === 'cod' ? 'Pay on Delivery' : 'Paid'}</p>
        </div>
        
        <div class="footer">
            <p><strong>Thank you for shopping with ${settings.siteName || 'SmartStore'}!</strong></p>
            <p>For any queries, please contact our customer support at support@smartstore.com or call 1800-123-4567</p>
            <p style="margin-top: 10px; font-size: 11px; color: #999;">This is a computer generated invoice and does not require signature.</p>
        </div>
    </div>
</body>
</html>`;
        
        invoiceWindow.document.write(invoiceHTML);
        invoiceWindow.document.close();
        
        showNotification('Invoice generated! Click Print to save as PDF.');
    } catch (err) {
        showNotification('Error generating invoice', 'error');
        console.error(err);
    }
};

// Users
loadUsers = async () => {
    try {
        const res = await fetch(`${API_URL}/api/admin/users`);
        const users = await res.json();
        
        const tbody = document.getElementById('usersTable');
        if (!tbody) return;
        
        if (!users?.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><i class="fas fa-users"></i><p>No users</p></td></tr>';
            return;
        }
        
        tbody.innerHTML = users.map(u => `
            <tr>
                <td>
                    <div class="user-cell">
                        <div class="user-avatar">${u.name?.charAt(0).toUpperCase()}</div>
                        <div class="user-name">${u.name}</div>
                    </div>
                </td>
                <td>${u.email}</td>
                <td>${u.phone || '-'}</td>
                <td><span class="badge badge-${u.isAdmin ? 'warning' : 'info'}">${u.isAdmin ? 'Admin' : 'User'}</span></td>
                <td>
                    <button class="btn-action btn-delete" onclick="deleteUser(${u.id})"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Users error:', err);
    }
};

deleteUser = async (id) => {
    if (!confirm('Delete this user?')) return;
    
    try {
        const res = await fetch(`${API_URL}/api/admin/users/${id}`, { method: 'DELETE' });
        if (res.ok) {
            loadUsers();
            loadDashboardData();
            showNotification('User deleted');
        }
    } catch (err) {
        showNotification('Error deleting user', 'error');
    }
};

// Settings
loadSettings = async () => {
    try {
        const res = await fetch(`${API_URL}/api/admin/settings`);
        const settings = await res.json();
        
        document.getElementById('siteName').value = settings.siteName || '';
        document.getElementById('siteCurrency').value = settings.currency || '₹';
        tempLogo = settings.logo || '';
        
        if (tempLogo) {
            document.getElementById('logoPreview').src = tempLogo;
            document.getElementById('logoPreview').style.display = 'block';
            renderLogoPreview();
        }
    } catch (err) {
        console.error('Settings error:', err);
    }
};

saveSettings = async (e) => {
    e.preventDefault();
    
    const settings = {
        siteName: document.getElementById('siteName').value,
        currency: document.getElementById('siteCurrency').value,
        logo: tempLogo
    };
    
    try {
        const res = await fetch(`${API_URL}/api/admin/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        
        if (res.ok) showNotification('Settings saved!');
    } catch (err) {
        showNotification('Error saving settings', 'error');
    }
};

// Modal Helpers
openModal = (modalId) => {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
};

closeModal = (modalId) => {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = '';
    }
    
    // Remove dynamically created modals
    if (modalId === 'viewProductModal' || modalId === 'viewOrderModal' || modalId === 'updateStatusModal') {
        modal?.remove();
    }
};

showNotification = (message, type = 'success') => {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i>
        <span>${message}</span>
    `;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideInRight 0.3s reverse';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
};

// Close modal on overlay click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('show');
        document.body.style.overflow = '';
    }
});

// Mobile sidebar toggle
toggleSidebar = () => {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('show');
};

// Close sidebar when clicking nav items on mobile
document.addEventListener('click', (e) => {
    if (e.target.closest('.nav-item')) {
        if (window.innerWidth <= 1024) {
            toggleSidebar();
        }
    }
});
