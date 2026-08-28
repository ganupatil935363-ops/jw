// Shrisilverbay - Fine Jewellery E-Commerce Interface
const API_URL = window.location.origin;

// State Management
let products = [];
let categories = [];
let banners = [];
let deals = [];
let cart = JSON.parse(localStorage.getItem('cart')) || [];
let wishlist = JSON.parse(localStorage.getItem('wishlist')) || [];
let recentlyViewed = JSON.parse(localStorage.getItem('recentlyViewed')) || [];
let currentUser = JSON.parse(localStorage.getItem('user')) || null;
let authToken = localStorage.getItem('authToken') || '';
const WHATSAPP_SUPPORT_NUMBER = '919353630646';

function authHeaders(extra = {}) {
    const headers = { ...extra };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    return headers;
}

async function restoreSession() {
    if (!authToken) { currentUser = null; localStorage.removeItem('user'); return; }
    try {
        const res = await fetch(`${API_URL}/api/users/me`, { headers: authHeaders() });
        if (!res.ok) throw new Error('Session expired');
        const data = await res.json();
        currentUser = data.user;
        localStorage.setItem('user', JSON.stringify(currentUser));
    } catch (e) {
        authToken = ''; currentUser = null;
        localStorage.removeItem('authToken'); localStorage.removeItem('user');
    }
}


function connectRealtime() {
    if (typeof io === 'undefined' || !authToken) return;
    try {
        const socket = io({ auth: { token: authToken } });
        socket.on('order-updated', order => {
            if (currentUser && String(order.userId) === String(currentUser.id)) {
                showNotification(`Order ${order.orderNumber || order.id}: ${order.status}`);
                if (document.getElementById('profileModal')?.classList.contains('show')) loadUserOrders();
            }
        });
        window.shrisilverbaySocket = socket;
    } catch (e) { console.error('Realtime connection failed', e); }
}

function whatsappProductUrl(product) {
    const text = `Hello Shrisilverbay, I have a query about ${product.name} (Product ID: ${product.id}) priced at ₹${product.price}. Please help me.`;
    return `https://wa.me/${WHATSAPP_SUPPORT_NUMBER}?text=${encodeURIComponent(text)}`;
}
let currentSlide = 0;
let filteredProducts = [];
let currentProduct = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await restoreSession();
    loadAllData();
    updateCartUI();
    updateWishlistUI();
    updateAuthUI();
    connectRealtime();
    setupEventListeners();
    loadRecentlyViewed();
    initAnimations();
});

// Initialize Premium Animations
function initAnimations() {
    // Intersection Observer for scroll animations
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, { threshold: 0.1 });
    
    document.querySelectorAll('.product-card, .deal-card, .category-card').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
        observer.observe(el);
    });
}

// Load All Data
async function loadAllData() {
    try {
        const response = await fetch(`${API_URL}/api/products`, { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || `Products API returned ${response.status}`);
        products = data.products || [];
        categories = data.categories || [];
        banners = data.banners || [];
        deals = data.deals || [];
        
        filteredProducts = [...products];
        
        renderCarousel();
        renderDeals();
        renderCategoryNavigation();
        renderCategories();
        renderBestSellerTabs();
        renderTrending();
        renderBestsellers();
        renderProducts();
    } catch (error) {
        console.error('Error loading data:', error);
        showNotification('Error loading products', 'error');
    }
}

// Refresh admin-managed categories on the customer interface without a full page reload.
let categoryRefreshTimer = null;
function startCategoryRefresh() {
    if (categoryRefreshTimer) clearInterval(categoryRefreshTimer);
    categoryRefreshTimer = setInterval(async () => {
        try {
            const response = await fetch(`${API_URL}/api/products`, { cache: 'no-store' });
            if (!response.ok) return;
            const data = await response.json();
            const incoming = data.categories || [];
            if (JSON.stringify(incoming) !== JSON.stringify(categories)) {
                categories = incoming;
                renderCategoryNavigation();
                renderCategories();
                renderBestSellerTabs();
            }
        } catch (error) {
            console.warn('Category refresh skipped:', error.message);
        }
    }, 10000);
}

startCategoryRefresh();

// ===== CAROUSEL =====
function renderCarousel() {
    const slidesContainer = document.getElementById('carouselSlides');
    const dotsContainer = document.getElementById('carouselDots');
    
    if (!slidesContainer || !banners.length) return;
    
    slidesContainer.innerHTML = banners.map((banner, index) => `
        <div class="carousel-slide" style="background: ${banner.color}">
            <div class="carousel-content">
                <h2>${banner.title}</h2>
                <p>${banner.subtitle || ''}</p>
                <a href="#products" class="carousel-btn" onclick="scrollToProducts()">${banner.buttonText || 'Shop Now'} <i class="fas fa-arrow-right"></i></a>
            </div>
            <img src="${banner.image}" alt="${banner.title}">
        </div>
    `).join('');
    
    dotsContainer.innerHTML = banners.map((_, index) => `
        <div class="carousel-dot ${index === 0 ? 'active' : ''}" onclick="goToSlide(${index})"></div>
    `).join('');
    
    // Auto slide
    setInterval(() => moveCarousel(1), 6000);
}

function moveCarousel(direction) {
    const slides = document.querySelectorAll('.carousel-slide');
    if (!slides.length) return;
    
    currentSlide = (currentSlide + direction + slides.length) % slides.length;
    
    const slidesContainer = document.getElementById('carouselSlides');
    slidesContainer.style.transform = `translateX(-${currentSlide * 100}%)`;
    
    document.querySelectorAll('.carousel-dot').forEach((dot, index) => {
        dot.classList.toggle('active', index === currentSlide);
    });
}

function goToSlide(index) {
    currentSlide = index;
    moveCarousel(0);
}

function scrollToProducts() {
    document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' });
}

// ===== DEALS =====
function renderDeals() {
    const container = document.getElementById('dealsGrid');
    if (!container || !deals.length) return;
    
    container.innerHTML = deals.filter(d => d.active !== false).map(deal => `
        <div class="deal-card" onclick="filterByCategory('${deal.category}')">
            <i class="fas ${deal.icon || 'fa-percent'}"></i>
            <div class="deal-info">
                <h3>${deal.title}</h3>
                <p>${deal.discount}</p>
            </div>
        </div>
    `).join('');
}

// ===== CATEGORIES =====
function renderCategoryNavigation() {
    const container = document.getElementById('categoryNav');
    if (!container) return;

    if (!categories.length) {
        container.innerHTML = '';
        return;
    }

    const icons = ['fa-ring', 'fa-gem', 'fa-crown', 'fa-heart', 'fa-star', 'fa-diamond', 'fa-circle', 'fa-gift'];
    container.innerHTML = categories.map((cat, index) => `
        <a href="#products" class="category-item" data-category="${encodeURIComponent(cat.name)}">
            <i class="fas ${icons[index % icons.length]}"></i>
            <span>${cat.name}</span>
        </a>
    `).join('');

    container.querySelectorAll('.category-item').forEach(item => {
        item.addEventListener('click', event => {
            event.preventDefault();
            filterByCategory(decodeURIComponent(item.dataset.category || ''));
        });
    });
}

function renderCategories() {
    const container = document.getElementById('categoriesGrid');
    if (!container) return;

    if (!categories.length) {
        container.innerHTML = '<div class="category-empty">No collections available yet.</div>';
        return;
    }

    container.innerHTML = categories.map(cat => `
        <div class="category-card" data-category="${encodeURIComponent(cat.name)}">
            <img src="${cat.image || '/uploads/products/default.jpg'}" alt="${cat.name}" loading="lazy">
            <span>${cat.name}</span>
        </div>
    `).join('');

    container.querySelectorAll('.category-card').forEach(card => {
        card.addEventListener('click', () => filterByCategory(decodeURIComponent(card.dataset.category || '')));
    });
}

function renderBestSellerTabs() {
    const container = document.getElementById('bestsellerTabs');
    if (!container) return;
    container.innerHTML = [
        '<button class="tab active" onclick="filterProductsByBestCategory(\'all\')">All</button>',
        ...categories.slice(0, 5).map(cat => `<button class="tab" onclick="filterProductsByBestCategory(${JSON.stringify(cat.name)})">${cat.name}</button>`)
    ].join('');
}

function filterProductsByBestCategory(category) {
    const tabs = document.querySelectorAll('#bestsellerTabs .tab');
    tabs.forEach(tab => tab.classList.toggle('active', tab.textContent.trim().toLowerCase() === String(category).trim().toLowerCase() || (category === 'all' && tab.textContent.trim().toLowerCase() === 'all')));

    if (category === 'all') {
        renderBestsellers();
        return;
    }

    const list = [...products]
        .filter(p => String(p.category || '').toLowerCase() === String(category).toLowerCase())
        .sort((a, b) => (b.reviews || 0) - (a.reviews || 0))
        .slice(0, 8);

    const container = document.getElementById('bestsellersGrid');
    if (container) container.innerHTML = list.map(createProductCard).join('') || '<div class="category-empty">No products in this collection yet.</div>';
}

// ===== PRODUCTS =====
function createProductCard(product) {
    const isWishlisted = wishlist.some(item => item.id === product.id);
    const discount = Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100);
    
    return `
        <div class="product-card" onclick="showProductDetail(${product.id})">
            <div class="product-image">
                <img src="${product.images?.[0] || '/uploads/products/default.jpg'}" alt="${product.name}" loading="lazy">
                <button class="wishlist-btn ${isWishlisted ? 'active' : ''}" onclick="event.stopPropagation(); toggleWishlist(${product.id})">
                    <i class="fas fa-heart"></i>
                </button>
                ${discount > 0 ? `<span class="discount-badge">${discount}% OFF</span>` : ''}
            </div>
            <div class="product-info">
                <div class="product-brand">${product.brand || product.category}</div>
                <div class="product-name">${product.name}</div>
                <div class="product-rating">
                    <span class="rating-badge"><i class="fas fa-star"></i> ${product.rating || '4.5'}</span>
                    <span class="rating-count">(${product.reviews?.toLocaleString() || '1,234'})</span>
                </div>
                <div class="product-price">
                    <span class="current-price">₹${product.price.toLocaleString()}</span>
                    ${product.originalPrice > product.price ? `
                        <span class="original-price">₹${product.originalPrice.toLocaleString()}</span>
                        <span class="discount-percent">${discount}% off</span>
                    ` : ''}
                </div>
                <div class="delivery-info ${product.delivery?.free ? 'free' : ''}">
                    ${product.delivery?.free ? '<i class="fas fa-truck"></i> Free Delivery' : `Delivery ₹${product.delivery?.fee || 40}`}
                </div>
                <a href="${whatsappProductUrl(product)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:10px;padding:9px 12px;border-radius:8px;background:#25D366;color:#fff;text-decoration:none;font-weight:600;font-size:13px;">
                    <i class="fab fa-whatsapp"></i> Product Query on WhatsApp
                </a>
            </div>
        </div>
    `;
}

function renderTrending() {
    const container = document.getElementById('trendingGrid');
    if (!container || !products.length) return;
    
    const trending = products.slice(0, 6);
    container.innerHTML = trending.map(p => createProductCard(p)).join('');
}

function renderBestsellers() {
    const container = document.getElementById('bestsellersGrid');
    if (!container || !products.length) return;
    
    const bestsellers = [...products].sort((a, b) => (b.reviews || 0) - (a.reviews || 0)).slice(0, 8);
    container.innerHTML = bestsellers.map(p => createProductCard(p)).join('');
}

function renderProducts() {
    const container = document.getElementById('productsGrid');
    const resultsCount = document.getElementById('resultsCount');
    
    if (!container) return;
    
    if (filteredProducts.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1; padding: 80px;">
                <i class="fas fa-search"></i>
                <p>No products found</p>
            </div>
        `;
        if (resultsCount) resultsCount.textContent = '0 products found';
        return;
    }
    
    container.innerHTML = filteredProducts.map(p => createProductCard(p)).join('');
    if (resultsCount) resultsCount.textContent = `${filteredProducts.length} products found`;
}

// ===== PRODUCT DETAIL MODAL =====
async function showProductDetail(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    
    currentProduct = product;
    addToRecentlyViewed(product);
    
    // Create modal if not exists
    let modal = document.getElementById('productModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'productModal';
        modal.className = 'modal-overlay';
        document.body.appendChild(modal);
    }
    
    const discount = Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100);
    const specs = product.specs || {};
    
    modal.innerHTML = `
        <div class="product-modal">
            <button class="modal-close" onclick="closeProductModal()"><i class="fas fa-times"></i></button>
            <div class="modal-gallery">
                <div class="main-image">
                    <img src="${product.images?.[0] || '/uploads/products/default.jpg'}" id="mainProductImage" alt="${product.name}">
                </div>
                <div class="thumbnail-list">
                    ${product.images?.map((img, i) => `
                        <div class="thumbnail ${i === 0 ? 'active' : ''}" onclick="changeMainImage('${img}', this)">
                            <img src="${img}" alt="View ${i + 1}">
                        </div>
                    `).join('') || ''}
                </div>
            </div>
            <div class="modal-info">
                <div class="modal-brand">${product.brand || product.category}</div>
                <h2 class="modal-title">${product.name}</h2>
                <div class="modal-rating">
                    <span class="rating-badge"><i class="fas fa-star"></i> ${product.rating || '4.5'}</span>
                    <span>${product.reviews?.toLocaleString() || '1,234'} Ratings</span>
                    <span style="color: var(--gray);">&</span>
                    <span>${Math.floor((product.reviews || 1234) * 0.3)} Reviews</span>
                </div>
                <div class="modal-price">
                    <span class="price-main">₹${product.price.toLocaleString()}</span>
                    ${product.originalPrice > product.price ? `
                        <span class="price-original">₹${product.originalPrice.toLocaleString()}</span>
                        <span class="price-discount">${discount}% OFF</span>
                    ` : ''}
                </div>
                <div class="modal-offers">
                    <div class="offer-item"><i class="fas fa-check-circle"></i> <strong>Bank Offer:</strong> 10% instant discount on HDFC Cards</div>
                    <div class="offer-item"><i class="fas fa-check-circle"></i> <strong>Free Delivery:</strong> Order within 2 hours</div>
                    <div class="offer-item"><i class="fas fa-check-circle"></i> <strong>EMI:</strong> Available starting ₹${Math.round(product.price / 12).toLocaleString()}/month</div>
                </div>
                <div class="modal-actions">
                    <button class="btn-cart" onclick="addToCart(${product.id}); closeProductModal(); showNotification('Added to cart!');">
                        <i class="fas fa-shopping-cart"></i> Add to Cart
                    </button>
                    <button class="btn-buy" onclick="buyNow(${product.id})">
                        <i class="fas fa-bolt"></i> Buy Now
                    </button>
                </div>
                <a href="${whatsappProductUrl(product)}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:12px;padding:13px;border-radius:10px;background:#25D366;color:#fff;text-decoration:none;font-weight:700;">
                    <i class="fab fa-whatsapp"></i> Have a query? Chat on WhatsApp: 9353630646
                </a>
                ${Object.keys(specs).length > 0 ? `
                    <div class="modal-specs">
                        <div class="specs-title"><i class="fas fa-list-ul"></i> Specifications</div>
                        ${Object.entries(specs).slice(0, 6).map(([key, value]) => `
                            <div class="spec-row">
                                <span class="spec-label">${key}</span>
                                <span class="spec-value">${value}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
                <div class="modal-details">
                    <div class="detail-row">
                        <span class="detail-label">Seller</span>
                        <span class="detail-value">${product.seller || 'Official Store'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Warranty</span>
                        <span class="detail-value">${product.warranty || '1 Year Brand Warranty'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Return Policy</span>
                        <span class="detail-value">${product.returnPolicy || '7 Days Replacement'}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
}

function changeMainImage(src, thumb) {
    const mainImg = document.getElementById('mainProductImage');
    if (mainImg) {
        mainImg.style.opacity = '0';
        setTimeout(() => {
            mainImg.src = src;
            mainImg.style.opacity = '1';
        }, 200);
    }
    
    document.querySelectorAll('.thumbnail').forEach(t => t.classList.remove('active'));
    thumb?.classList.add('active');
}

function closeProductModal() {
    const modal = document.getElementById('productModal');
    if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = '';
    }
}

// ===== RECENTLY VIEWED =====
function addToRecentlyViewed(product) {
    recentlyViewed = recentlyViewed.filter(p => p.id !== product.id);
    recentlyViewed.unshift(product);
    if (recentlyViewed.length > 6) recentlyViewed.pop();
    
    localStorage.setItem('recentlyViewed', JSON.stringify(recentlyViewed));
    loadRecentlyViewed();
}

function loadRecentlyViewed() {
    const section = document.getElementById('recentlyViewed');
    const container = document.getElementById('recentlyViewedGrid');
    
    if (!section || !container || recentlyViewed.length === 0) {
        if (section) section.style.display = 'none';
        return;
    }
    
    section.style.display = 'block';
    container.innerHTML = recentlyViewed.map(p => createProductCard(p)).join('');
}

// ===== FILTER & SEARCH =====
function filterByCategory(category) {
    filteredProducts = products.filter(p => p.category === category);
    renderProducts();
    document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' });
}

function performSearch() {
    const query = document.getElementById('searchInput')?.value.toLowerCase();
    if (!query) return;
    
    filteredProducts = products.filter(p => 
        p.name.toLowerCase().includes(query) ||
        p.brand?.toLowerCase().includes(query) ||
        p.category?.toLowerCase().includes(query)
    );
    
    renderProducts();
    document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' });
}

// ===== CART =====
function addToCart(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    
    const existing = cart.find(item => item.id === productId);
    if (existing) {
        existing.quantity++;
    } else {
        cart.push({ ...product, quantity: 1 });
    }
    
    saveCart();
    updateCartUI();
}

function removeFromCart(productId) {
    cart = cart.filter(item => item.id !== productId);
    saveCart();
    updateCartUI();
}

function updateQuantity(productId, change) {
    const item = cart.find(item => item.id === productId);
    if (!item) return;
    
    item.quantity += change;
    if (item.quantity <= 0) {
        removeFromCart(productId);
    } else {
        saveCart();
        updateCartUI();
    }
}

function saveCart() {
    localStorage.setItem('cart', JSON.stringify(cart));
}

function updateCartUI() {
    const cartCount = document.querySelector('.cart-count');
    const cartItems = document.getElementById('cartItems');
    const cartTotal = document.getElementById('cartTotal');
    
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    const totalPrice = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    if (cartCount) cartCount.textContent = totalItems;
    
    if (cartItems) {
        if (cart.length === 0) {
            cartItems.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-shopping-cart"></i>
                    <p>Your cart is empty</p>
                    <button class="btn btn-primary" onclick="toggleCart(); document.getElementById('products').scrollIntoView({behavior:'smooth'})" style="margin-top: 20px;">Start Shopping</button>
                </div>
            `;
        } else {
            cartItems.innerHTML = cart.map(item => `
                <div class="cart-item">
                    <img src="${item.images?.[0] || '/uploads/products/default.jpg'}" alt="${item.name}">
                    <div class="cart-item-info">
                        <div class="cart-item-name">${item.name}</div>
                        <div class="cart-item-price">₹${item.price.toLocaleString()}</div>
                        <div class="cart-item-qty">
                            <button class="qty-btn" onclick="updateQuantity(${item.id}, -1)">-</button>
                            <span>${item.quantity}</span>
                            <button class="qty-btn" onclick="updateQuantity(${item.id}, 1)">+</button>
                        </div>
                    </div>
                    <button class="remove-item" onclick="removeFromCart(${item.id})"><i class="fas fa-trash"></i></button>
                </div>
            `).join('');
        }
    }
    
    if (cartTotal) {
        const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const delivery = subtotal > 500 ? 0 : 40;
        cartTotal.innerHTML = `
            <div class="summary-row"><span>Subtotal</span><span>₹${subtotal.toLocaleString()}</span></div>
            <div class="summary-row"><span>Delivery</span><span>${delivery === 0 ? 'FREE' : '₹' + delivery}</span></div>
            <div class="summary-row total"><span>Total</span><span>₹${(subtotal + delivery).toLocaleString()}</span></div>
        `;
    }
}

function toggleCart() {
    const sidebar = document.getElementById('cartSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    
    sidebar?.classList.toggle('open');
    overlay?.classList.toggle('show');
    document.body.style.overflow = sidebar?.classList.contains('open') ? 'hidden' : '';
}

function buyNow(productId) {
    addToCart(productId);
    closeProductModal();
    showCheckout();
}

// ===== WISHLIST =====
function toggleWishlist(productId) {
    const index = wishlist.findIndex(item => item.id === productId);
    const product = products.find(p => p.id === productId);
    
    if (index > -1) {
        wishlist.splice(index, 1);
        showNotification('Removed from wishlist');
    } else {
        wishlist.push(product);
        showNotification('Added to wishlist!');
    }
    
    localStorage.setItem('wishlist', JSON.stringify(wishlist));
    updateWishlistUI();
    renderProducts();
    renderTrending();
    renderBestsellers();
}

function toggleWishlistSidebar() {
    const sidebar = document.getElementById('wishlistSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    
    sidebar?.classList.toggle('open');
    overlay?.classList.toggle('show');
    document.body.style.overflow = sidebar?.classList.contains('open') ? 'hidden' : '';
}

function updateWishlistUI() {
    const wishlistCount = document.querySelector('.wishlist-count');
    const wishlistItems = document.getElementById('wishlistItems');
    
    if (wishlistCount) wishlistCount.textContent = wishlist.length;
    
    if (wishlistItems) {
        if (wishlist.length === 0) {
            wishlistItems.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-heart"></i>
                    <p>Your wishlist is empty</p>
                </div>
            `;
        } else {
            wishlistItems.innerHTML = wishlist.map(item => `
                <div class="cart-item">
                    <img src="${item.images?.[0] || '/uploads/products/default.jpg'}" alt="${item.name}">
                    <div class="cart-item-info">
                        <div class="cart-item-name">${item.name}</div>
                        <div class="cart-item-price">₹${item.price.toLocaleString()}</div>
                        <button class="btn btn-primary" style="margin-top: 10px; width: 100%; padding: 10px;" onclick="addToCart(${item.id}); showNotification('Added to cart!');">
                            Add to Cart
                        </button>
                    </div>
                    <button class="remove-item" onclick="toggleWishlist(${item.id})"><i class="fas fa-trash"></i></button>
                </div>
            `).join('');
        }
    }
}

// ===== AUTH =====
function showLogin() {
    if (currentUser) {
        if (confirm('Do you want to logout?')) {
            logout();
        }
        return;
    }
    
    let modal = document.getElementById('authModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'authModal';
        modal.className = 'modal-overlay';
        document.body.appendChild(modal);
    }
    
    modal.innerHTML = `
        <div class="auth-modal">
            <div class="auth-header">
                <h2><i class="fas fa-shopping-bag"></i> Shrisilverbay</h2>
                <p>Welcome! Login to continue shopping</p>
            </div>
            <div class="auth-tabs">
                <button class="auth-tab active" onclick="switchAuthTab('login')">Login</button>
                <button class="auth-tab" onclick="switchAuthTab('register')">Register</button>
            </div>
            <div class="auth-body">
                <form id="loginForm" onsubmit="handleLogin(event)">
                    <div class="form-group">
                        <label>Email Address</label>
                        <input type="email" id="loginEmail" required placeholder="your@email.com">
                    </div>
                    <div class="form-group">
                        <label>Password</label>
                        <input type="password" id="loginPassword" required placeholder="••••••••">
                    </div>
                    <button type="submit" class="btn btn-primary" style="width: 100%; padding: 16px; font-size: 16px;">Login</button>
                </form>
                <form id="registerForm" style="display: none;" onsubmit="handleRegister(event)">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Full Name</label>
                            <input type="text" id="regName" required placeholder="John Doe">
                        </div>
                        <div class="form-group">
                            <label>Phone</label>
                            <input type="tel" id="regPhone" required placeholder="+91 9876543210">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Email Address</label>
                        <input type="email" id="regEmail" required placeholder="your@email.com">
                    </div>
                    <div class="form-group">
                        <label>Password</label>
                        <input type="password" id="regPassword" required placeholder="••••••••">
                    </div>
                    <button type="submit" class="btn btn-primary" style="width: 100%; padding: 16px; font-size: 16px;">Create Account</button>
                </form>
            </div>
        </div>
    `;
    
    modal.classList.add('show');
}

function switchAuthTab(tab) {
    const tabs = document.querySelectorAll('.auth-tab');
    tabs.forEach(t => t.classList.remove('active'));
    const activeIndex = tab === 'login' ? 0 : 1;
    if (tabs[activeIndex]) tabs[activeIndex].classList.add('active');
    document.getElementById('loginForm').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('registerForm').style.display = tab === 'register' ? 'block' : 'none';
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
        const res = await fetch(`${API_URL}/api/users/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        const data = await res.json();
        if (res.ok) {
            currentUser = data.user;
            authToken = data.token;
            localStorage.setItem('user', JSON.stringify(currentUser));
            localStorage.setItem('authToken', authToken);
            updateAuthUI();
            closeModal('authModal');
            showNotification('Welcome back!');
        } else {
            showNotification(data.message || 'Login failed', 'error');
        }
    } catch (err) {
        showNotification('Error logging in', 'error');
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const userData = {
        name: document.getElementById('regName').value,
        email: document.getElementById('regEmail').value,
        phone: document.getElementById('regPhone').value,
        password: document.getElementById('regPassword').value
    };
    
    try {
        const res = await fetch(`${API_URL}/api/users/register`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(userData)
        });
        
        if (res.ok) {
            showNotification('Account created! Please login.');
            switchAuthTab('login');
        } else {
            const data = await res.json();
            showNotification(data.message || 'Registration failed', 'error');
        }
    } catch (err) {
        showNotification('Error registering', 'error');
    }
}

function updateAuthUI() {
    const userDisplay = document.getElementById('userNameDisplay');
    const userMenuBtn = document.getElementById('userMenuBtn');
    const profileMenuBtn = document.getElementById('profileMenuBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    
    if (currentUser) {
        if (userDisplay) userDisplay.textContent = currentUser.name;
        if (userMenuBtn) userMenuBtn.style.display = 'none';
        if (profileMenuBtn) profileMenuBtn.style.display = 'flex';
        if (logoutBtn) logoutBtn.style.display = 'flex';
    } else {
        if (userDisplay) userDisplay.textContent = 'Login';
        if (userMenuBtn) userMenuBtn.style.display = 'flex';
        if (profileMenuBtn) profileMenuBtn.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'none';
    }
}

function logout() {
    currentUser = null;
    localStorage.removeItem('user');
    localStorage.removeItem('authToken');
    authToken = '';
    updateAuthUI();
    showNotification('Logged out successfully');
}

// ===== CHECKOUT =====
function showCheckout() {
    if (cart.length === 0) {
        showNotification('Your cart is empty!', 'error');
        return;
    }
    
    if (!currentUser) {
        toggleCart();
        showLogin();
        showNotification('Please login to checkout', 'error');
        return;
    }
    
    toggleCart();
    
    let modal = document.getElementById('checkoutModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'checkoutModal';
        modal.className = 'modal-overlay';
        document.body.appendChild(modal);
    }
    
    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    modal.innerHTML = `
        <div class="checkout-modal" style="max-height: 90vh; overflow-y: auto;">
            <button class="modal-close" onclick="closeModal('checkoutModal')"><i class="fas fa-times"></i></button>
            <div class="checkout-content">
                <h2 class="checkout-title"><i class="fas fa-credit-card"></i> Checkout</h2>
                
                <!-- Delivery Details Section -->
                <div style="background: var(--light-gray); padding: 20px; border-radius: 16px; margin-bottom: 24px;">
                    <h4 style="margin-bottom: 16px; color: var(--primary);"><i class="fas fa-truck"></i> Delivery Details</h4>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Full Name *</label>
                            <input type="text" id="checkoutName" value="${currentUser?.name || ''}" required placeholder="Enter your full name">
                        </div>
                        <div class="form-group">
                            <label>Phone Number *</label>
                            <input type="tel" id="checkoutPhone" value="${currentUser?.phone || ''}" required placeholder="10-digit mobile number" maxlength="10">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Email Address *</label>
                            <input type="email" id="checkoutEmail" value="${currentUser?.email || ''}" required placeholder="your@email.com">
                        </div>
                        <div class="form-group">
                            <label>Alternate Phone (Optional)</label>
                            <input type="tel" id="checkoutAltPhone" placeholder="Alternate contact number" maxlength="10">
                        </div>
                    </div>
                </div>

                <!-- Address Section -->
                <div style="background: var(--light-gray); padding: 20px; border-radius: 16px; margin-bottom: 24px;">
                    <h4 style="margin-bottom: 16px; color: var(--primary);"><i class="fas fa-home"></i> Delivery Address</h4>
                    <div class="form-group">
                        <label>Complete Address *</label>
                        <textarea id="checkoutAddress" rows="2" required placeholder="House/Flat No., Building Name, Street, Area..."></textarea>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>City *</label>
                            <input type="text" id="checkoutCity" required placeholder="City name">
                        </div>
                        <div class="form-group">
                            <label>State *</label>
                            <select id="checkoutState" required style="width: 100%; padding: 14px; border: 1px solid var(--border); border-radius: 12px; font-size: 15px;">
                                <option value="">Select State</option>
                                <option value="Delhi">Delhi</option>
                                <option value="Maharashtra">Maharashtra</option>
                                <option value="Karnataka">Karnataka</option>
                                <option value="Tamil Nadu">Tamil Nadu</option>
                                <option value="Telangana">Telangana</option>
                                <option value="Gujarat">Gujarat</option>
                                <option value="Rajasthan">Rajasthan</option>
                                <option value="Punjab">Punjab</option>
                                <option value="Haryana">Haryana</option>
                                <option value="Uttar Pradesh">Uttar Pradesh</option>
                                <option value="West Bengal">West Bengal</option>
                                <option value="Kerala">Kerala</option>
                                <option value="Other">Other</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>PIN Code *</label>
                            <input type="text" id="checkoutPincode" required placeholder="6-digit PIN code" maxlength="6">
                        </div>
                        <div class="form-group">
                            <label>Landmark (Optional)</label>
                            <input type="text" id="checkoutLandmark" placeholder="Nearby landmark for easy delivery">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Address Type</label>
                        <div style="display: flex; gap: 16px;">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="radio" name="addressType" value="home" checked style="width: auto;">
                                <i class="fas fa-home"></i> Home
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="radio" name="addressType" value="work" style="width: auto;">
                                <i class="fas fa-briefcase"></i> Work
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="radio" name="addressType" value="other" style="width: auto;">
                                <i class="fas fa-map-marker-alt"></i> Other
                            </label>
                        </div>
                    </div>
                </div>

                <!-- Payment Section -->
                <div style="background: var(--light-gray); padding: 20px; border-radius: 16px; margin-bottom: 24px;">
                    <h4 style="margin-bottom: 16px; color: var(--primary);"><i class="fas fa-wallet"></i> Payment Method</h4>
                    <div class="payment-methods">
                        <label class="payment-option selected">
                            <input type="radio" name="payment" value="cod" checked>
                            <div class="payment-icon"><i class="fas fa-money-bill-wave"></i></div>
                            <div class="payment-info">
                                <div class="payment-title">Cash on Delivery</div>
                                <div class="payment-desc">Pay when you receive</div>
                            </div>
                        </label>
                        <label class="payment-option">
                            <input type="radio" name="payment" value="razorpay">
                            <div class="payment-icon"><i class="fas fa-shield-alt"></i></div>
                            <div class="payment-info">
                                <div class="payment-title">Razorpay</div>
                                <div class="payment-desc">UPI, Cards, Net Banking & Wallets</div>
                            </div>
                        </label>
                    </div>
                </div>

                <!-- Order Summary -->
                <div style="background: var(--gradient-primary); color: white; padding: 24px; border-radius: 16px; margin-bottom: 24px;">
                    <h4 style="margin-bottom: 16px;"><i class="fas fa-shopping-bag"></i> Order Summary</h4>
                    ${cart.map(item => `
                        <div style="display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px;">
                            <span>${item.name} x ${item.quantity}</span>
                            <span>₹${(item.price * item.quantity).toLocaleString()}</span>
                        </div>
                    `).join('')}
                    <div style="border-top: 1px solid rgba(255,255,255,0.3); margin-top: 16px; padding-top: 16px; display: flex; justify-content: space-between; font-size: 20px; font-weight: 700;">
                        <span>Total Amount</span>
                        <span>₹${total.toLocaleString()}</span>
                    </div>
                </div>

                <button class="btn btn-primary btn-ripple" style="width: 100%; padding: 18px; font-size: 18px;" onclick="placeOrder()">
                    <i class="fas fa-check-circle"></i> Place Order
                </button>
                <p style="text-align: center; margin-top: 12px; font-size: 12px; color: var(--gray);">
                    <i class="fas fa-lock"></i> Secure checkout. Your information is protected.
                </p>
            </div>
        </div>
    `;
    
    // Payment option selection
    modal.querySelectorAll('.payment-option').forEach(opt => {
        opt.addEventListener('click', () => {
            modal.querySelectorAll('.payment-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            opt.querySelector('input').checked = true;
        });
    });
    
    modal.classList.add('show');
}

async function placeOrder() {
    const name = document.getElementById('checkoutName').value.trim();
    const phone = document.getElementById('checkoutPhone').value.trim();
    const email = document.getElementById('checkoutEmail').value.trim();
    const altPhone = document.getElementById('checkoutAltPhone')?.value?.trim() || '';
    const address = document.getElementById('checkoutAddress').value.trim();
    const city = document.getElementById('checkoutCity').value.trim();
    const state = document.getElementById('checkoutState').value;
    const pincode = document.getElementById('checkoutPincode').value.trim();
    const landmark = document.getElementById('checkoutLandmark')?.value?.trim() || '';
    const addressType = document.querySelector('input[name="addressType"]:checked')?.value || 'home';
    const payment = document.querySelector('input[name="payment"]:checked')?.value || 'cod';

    if (!name || !phone || !email || !address || !city || !state || !pincode) {
        showNotification('Please fill all required fields (*)', 'error');
        return;
    }

    if (phone.length !== 10 || !/^\d{10}$/.test(phone)) {
        showNotification('Please enter valid 10-digit phone number', 'error');
        return;
    }

    if (pincode.length !== 6 || !/^\d{6}$/.test(pincode)) {
        showNotification('Please enter valid 6-digit PIN code', 'error');
        return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showNotification('Please enter valid email address', 'error');
        return;
    }

    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const orderNumber = 'ORD' + Date.now();

    const orderData = {
        userId: currentUser?.id,
        userName: name,
        email,
        phone,
        altPhone,
        address: {
            street: address,
            city,
            state,
            pincode,
            landmark,
            type: addressType
        },
        fullAddress: `${address}, ${landmark ? landmark + ', ' : ''}${city}, ${state} - ${pincode}`,
        items: cart,
        total,
        paymentMethod: payment,
        paymentStatus: payment === 'cod' ? 'pending' : 'created',
        status: 'pending',
        createdAt: new Date().toISOString(),
        orderNumber
    };

    // COD keeps the existing checkout flow.
    if (payment === 'cod') {
        await saveOrderAfterPayment(orderData);
        return;
    }

    // Online payment: create a Razorpay Order on the server first.
    try {
        const createRes = await fetch(`${API_URL}/api/payments/create-order`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
                amount: total,
                items: cart.map(item => ({
                    id: item.id,
                    quantity: item.quantity
                })),
                userId: currentUser?.id,
                orderNumber
            })
        });

        const paymentOrder = await createRes.json();

        if (!createRes.ok || !paymentOrder.success) {
            showNotification(paymentOrder.message || 'Unable to start Razorpay payment', 'error');
            return;
        }

        if (typeof Razorpay === 'undefined') {
            showNotification('Razorpay Checkout could not be loaded. Check your internet connection.', 'error');
            return;
        }

        const options = {
            key: paymentOrder.keyId,
            amount: paymentOrder.order.amount,
            currency: paymentOrder.order.currency,
            name: 'Shrisilverbay',
            description: `Order ${orderNumber}`,
            order_id: paymentOrder.order.id,
            prefill: {
                name,
                email,
                contact: `+91${phone}`
            },
            notes: {
                order_number: orderNumber
            },
            theme: {
                color: '#d4af37'
            },
            handler: async function (response) {
                try {
                    const verifyRes = await fetch(`${API_URL}/api/payments/verify`, {
                        method: 'POST',
                        headers: authHeaders({ 'Content-Type': 'application/json' }),
                        body: JSON.stringify(response)
                    });

                    const verification = await verifyRes.json();

                    if (!verifyRes.ok || !verification.success) {
                        showNotification(verification.message || 'Payment verification failed', 'error');
                        return;
                    }

                    orderData.paymentStatus = 'paid';
                    orderData.razorpayOrderId = response.razorpay_order_id;
                    orderData.razorpayPaymentId = response.razorpay_payment_id;

                    await saveOrderAfterPayment(orderData);
                } catch (error) {
                    console.error('Razorpay verification error:', error);
                    showNotification('Payment completed, but verification failed. Please contact support.', 'error');
                }
            },
            modal: {
                ondismiss: function () {
                    showNotification('Payment window closed. Your order was not placed.', 'error');
                }
            }
        };

        const razorpay = new Razorpay(options);
        razorpay.on('payment.failed', async function (response) {
            console.error('Razorpay payment failed:', response.error);
            try {
                const failedRes = await fetch(`${API_URL}/api/orders/payment-failed`, {
                    method: 'POST',
                    headers: authHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({
                        ...orderData,
                        razorpayOrderId: response?.error?.metadata?.order_id || paymentOrder.order.id,
                        failure: {
                            code: response?.error?.code,
                            description: response?.error?.description,
                            reason: response?.error?.reason,
                            source: response?.error?.source,
                            step: response?.error?.step
                        }
                    })
                });
                const failedResult = await failedRes.json();
                if (!failedRes.ok || !failedResult.success) throw new Error(failedResult.message || 'Unable to record payment failure');
                showNotification('Payment failed. Order confirmation failed automatically. You can retry payment.', 'error');
            } catch (error) {
                console.error('Unable to record failed payment:', error);
                showNotification(response.error?.description || 'Payment failed. Please try again.', 'error');
            }
        });
        razorpay.open();

    } catch (error) {
        console.error('Razorpay checkout error:', error);
        showNotification('Unable to start payment. Please try again.', 'error');
    }
}

async function saveOrderAfterPayment(orderData) {
    try {
        const res = await fetch(`${API_URL}/api/orders`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(orderData)
        });

        const result = await res.json();

        if (res.ok && result.success) {
            cart = [];
            saveCart();
            updateCartUI();
            closeModal('checkoutModal');

            showSuccessModal(
                result.order?.orderNumber || orderData.orderNumber,
                result.order?.trackingId
            );
        } else {
            showNotification(result.message || 'Order failed. Please contact support.', 'error');
        }
    } catch (err) {
        console.error('Error saving order:', err);
        showNotification('Payment was verified, but the order could not be saved. Please contact support.', 'error');
    }
}

function showSuccessModal(orderNumber, trackingId) {
    let modal = document.getElementById('successModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'successModal';
        modal.className = 'modal-overlay';
        document.body.appendChild(modal);
    }
    
    modal.innerHTML = `
        <div class="auth-modal" style="text-align: center; padding: 40px; max-width: 500px;">
            <div style="width: 80px; height: 80px; background: var(--success); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; animation: scaleIn 0.5s;">
                <i class="fas fa-check" style="font-size: 40px; color: white;"></i>
            </div>
            <h2 style="margin-bottom: 12px; font-size: 24px;">Order Placed Successfully!</h2>
            
            <!-- Order Details -->
            <div style="background: var(--light-gray); padding: 20px; border-radius: 12px; margin: 20px 0; text-align: left;">
                <div style="margin-bottom: 15px;">
                    <p style="margin: 0; font-size: 12px; color: var(--gray);">Order Number</p>
                    <p style="margin: 5px 0 0 0; font-size: 18px; font-weight: 700; color: var(--primary);">${orderNumber}</p>
                </div>
                ${trackingId ? `
                <div style="padding-top: 15px; border-top: 1px solid var(--border);">
                    <p style="margin: 0; font-size: 12px; color: var(--gray);">Tracking ID</p>
                    <p style="margin: 5px 0 0 0; font-size: 16px; font-weight: 600; color: var(--primary);">${trackingId}</p>
                    <p style="margin: 8px 0 0 0; font-size: 12px; color: var(--gray);">
                        <i class="fas fa-info-circle"></i> Use this to track your order
                    </p>
                </div>
                ` : ''}
            </div>
            
            <p style="color: var(--gray); margin-bottom: 20px; font-size: 14px;">
                Thank you for your purchase! We've sent a confirmation to your email. You can track your order status in My Profile.
            </p>
            
            <!-- Simulated Email Notification -->
            <div style="background: #e8f4fd; border: 1px solid #bee5eb; padding: 15px; border-radius: 8px; margin-bottom: 20px; text-align: left;">
                <p style="margin: 0 0 10px 0; font-size: 13px; color: #0c5460; font-weight: 600;">
                    <i class="fas fa-envelope"></i> Order Confirmation Email Sent
                </p>
                <p style="margin: 0; font-size: 12px; color: #0c5460;">
                    To: ${currentUser?.email || 'your@email.com'}<br>
                    Subject: Order Confirmation - ${orderNumber}
                </p>
            </div>
            
            <div style="display: flex; gap: 12px; justify-content: center;">
                <button class="btn btn-primary" style="padding: 14px 28px; flex: 1;" onclick="closeModal('successModal'); showProfile()">
                    <i class="fas fa-user"></i> View Profile
                </button>
                <button class="btn btn-secondary" style="padding: 14px 28px; flex: 1;" onclick="closeModal('successModal')">
                    <i class="fas fa-shopping-bag"></i> Continue Shopping
                </button>
            </div>
        </div>
    `;
    
    modal.classList.add('show');
    
    // Simulate sending order confirmation email
    simulateOrderConfirmationEmail(orderNumber, trackingId);
}

// Simulate order confirmation email
function simulateOrderConfirmationEmail(orderNumber, trackingId) {
    console.log('📧 Order Confirmation Email');
    console.log('================================');
    console.log('To:', currentUser?.email || 'customer@example.com');
    console.log('Subject: 🎉 Order Confirmed - ' + orderNumber);
    console.log('');
    console.log('Dear ' + (currentUser?.name || 'Customer') + ',');
    console.log('');
    console.log('Thank you for your order! Your order has been placed successfully.');
    console.log('');
    console.log('Order Details:');
    console.log('- Order Number: ' + orderNumber);
    if (trackingId) {
        console.log('- Tracking ID: ' + trackingId);
    }
    console.log('- Status: Order Placed');
    console.log('');
    console.log('You can track your order at: http://localhost:3000/track/' + (trackingId || orderNumber));
    console.log('');
    console.log('Best regards,');
    console.log('Shrisilverbay Team');
    console.log('================================');
}

// Order tracking page function (for standalone tracking page)
function showOrderTrackingPage() {
    // This can be called if user visits /track page
    const trackingId = new URLSearchParams(window.location.search).get('id');
    if (trackingId) {
        trackOrder(trackingId);
    }
}

// ===== MY PROFILE =====
function showProfile() {
    if (!currentUser) {
        showLogin();
        return;
    }
    
    let modal = document.getElementById('profileModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'profileModal';
        modal.className = 'modal-overlay';
        document.body.appendChild(modal);
    }
    
    modal.innerHTML = `
        <div class="profile-modal" style="max-width: 900px; max-height: 90vh; overflow-y: auto;">
            <div class="profile-header" style="background: var(--gradient-primary); color: white; padding: 30px; border-radius: 24px 24px 0 0;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 20px;">
                        <div style="width: 80px; height: 80px; background: rgba(255,255,255,0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 36px;">
                            <i class="fas fa-user"></i>
                        </div>
                        <div>
                            <h2 style="margin: 0; font-size: 24px;">${currentUser.name}</h2>
                            <p style="margin: 5px 0 0 0; opacity: 0.9;">${currentUser.email}</p>
                            <p style="margin: 3px 0 0 0; opacity: 0.8; font-size: 14px;">${currentUser.phone || 'No phone added'}</p>
                        </div>
                    </div>
                    <button class="modal-close" onclick="closeModal('profileModal')" style="color: white;"><i class="fas fa-times"></i></button>
                </div>
            </div>
            
            <div class="profile-tabs" style="display: flex; border-bottom: 1px solid var(--border); background: var(--light-gray);">
                <button class="profile-tab active" onclick="switchProfileTab('orders')" id="tab-orders" style="flex: 1; padding: 16px; border: none; background: white; cursor: pointer; font-weight: 600; color: var(--primary);">
                    <i class="fas fa-shopping-bag"></i> My Orders
                </button>
                <button class="profile-tab" onclick="switchProfileTab('wishlist')" id="tab-wishlist" style="flex: 1; padding: 16px; border: none; background: transparent; cursor: pointer; font-weight: 500; color: var(--gray);">
                    <i class="fas fa-heart"></i> Wishlist (${wishlist.length})
                </button>
                <button class="profile-tab" onclick="switchProfileTab('details')" id="tab-details" style="flex: 1; padding: 16px; border: none; background: transparent; cursor: pointer; font-weight: 500; color: var(--gray);">
                    <i class="fas fa-user-cog"></i> Profile Details
                </button>
            </div>
            
            <div class="profile-content" style="padding: 30px; background: white; border-radius: 0 0 24px 24px;">
                <!-- Orders Tab -->
                <div id="profile-orders" class="profile-section" style="display: block;">
                    <div id="userOrdersList">
                        <p style="text-align: center; color: var(--gray); padding: 40px;"><i class="fas fa-spinner fa-spin"></i> Loading orders...</p>
                    </div>
                </div>
                
                <!-- Wishlist Tab -->
                <div id="profile-wishlist" class="profile-section" style="display: none;">
                    ${wishlist.length === 0 ? `
                        <div class="empty-state" style="padding: 60px;">
                            <i class="fas fa-heart" style="font-size: 60px; color: var(--light-gray);"></i>
                            <p style="margin-top: 20px; color: var(--gray);">Your wishlist is empty</p>
                            <button class="btn btn-primary" onclick="closeModal('profileModal'); document.getElementById('products').scrollIntoView({behavior:'smooth'})" style="margin-top: 20px;">
                                Start Shopping
                            </button>
                        </div>
                    ` : `
                        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 20px;">
                            ${wishlist.map(item => `
                                <div class="product-card" style="position: relative;">
                                    <div class="product-image" style="height: 180px;">
                                        <img src="${item.images?.[0] || '/uploads/products/default.jpg'}" alt="${item.name}" style="width: 100%; height: 100%; object-fit: cover;">
                                        <button onclick="event.stopPropagation(); toggleWishlist(${item.id}); showProfile();" style="position: absolute; top: 10px; right: 10px; background: white; border: none; border-radius: 50%; width: 36px; height: 36px; cursor: pointer; color: var(--accent);">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    </div>
                                    <div class="product-info" style="padding: 15px;">
                                        <div class="product-name" style="font-size: 14px; margin-bottom: 8px;">${item.name}</div>
                                        <div class="product-price" style="font-size: 16px; font-weight: 700; color: var(--primary);">₹${item.price.toLocaleString()}</div>
                                        <button class="btn btn-primary" style="width: 100%; margin-top: 10px; padding: 10px; font-size: 14px;" onclick="addToCart(${item.id}); showNotification('Added to cart!');">
                                            <i class="fas fa-shopping-cart"></i> Add to Cart
                                        </button>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    `}
                </div>
                
                <!-- Profile Details Tab -->
                <div id="profile-details" class="profile-section" style="display: none;">
                    <form onsubmit="updateProfile(event)">
                        <div class="form-row">
                            <div class="form-group">
                                <label>Full Name</label>
                                <input type="text" id="profileName" value="${currentUser.name}" required>
                            </div>
                            <div class="form-group">
                                <label>Phone Number</label>
                                <input type="tel" id="profilePhone" value="${currentUser.phone || ''}" required>
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Email Address</label>
                            <input type="email" id="profileEmail" value="${currentUser.email}" disabled style="background: var(--light-gray);">
                            <small style="color: var(--gray);">Email cannot be changed</small>
                        </div>
                        <div class="form-group">
                            <label>Default Address</label>
                            <textarea id="profileAddress" rows="3" placeholder="Enter your default delivery address...">${currentUser.address || ''}</textarea>
                        </div>
                        <button type="submit" class="btn btn-primary" style="width: 100%; padding: 16px;">
                            <i class="fas fa-save"></i> Save Changes
                        </button>
                    </form>
                </div>
            </div>
        </div>
    `;
    
    modal.classList.add('show');
    loadUserOrders();
}

function switchProfileTab(tab) {
    document.querySelectorAll('.profile-tab').forEach(t => {
        t.classList.remove('active');
        t.style.background = 'transparent';
        t.style.color = 'var(--gray)';
    });
    document.querySelectorAll('.profile-section').forEach(s => s.style.display = 'none');
    
    document.getElementById(`tab-${tab}`).classList.add('active');
    document.getElementById(`tab-${tab}`).style.background = 'white';
    document.getElementById(`tab-${tab}`).style.color = 'var(--primary)';
    document.getElementById(`profile-${tab}`).style.display = 'block';
}

async function loadUserOrders() {
    if (!currentUser) return;
    
    try {
        const res = await fetch(`${API_URL}/api/orders/user/${currentUser.id}`, { headers: authHeaders() });
        const orders = await res.json();
        
        const container = document.getElementById('userOrdersList');
        if (!container) return;
        
        if (!orders || orders.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="padding: 60px;">
                    <i class="fas fa-shopping-bag" style="font-size: 60px; color: var(--light-gray);"></i>
                    <p style="margin-top: 20px; color: var(--gray);">No orders yet</p>
                    <button class="btn btn-primary" onclick="closeModal('profileModal'); document.getElementById('products').scrollIntoView({behavior:'smooth'})" style="margin-top: 20px;">
                        Start Shopping
                    </button>
                </div>
            `;
            return;
        }
        
        container.innerHTML = orders.map(order => {
            const statusColors = {
                'Order Placed': '#856404',
                'Confirmed': '#004085',
                'Processing': '#004085',
                'Packed': '#004085',
                'Shipped': '#0c5460',
                'Out for Delivery': '#0c5460',
                'Delivered': '#155724',
                'Cancelled': '#721c24',
                'Returned': '#721c24'
            };
            const statusBg = {
                'Order Placed': '#fff3cd',
                'Confirmed': '#cce5ff',
                'Processing': '#cce5ff',
                'Packed': '#cce5ff',
                'Shipped': '#d1ecf1',
                'Out for Delivery': '#d1ecf1',
                'Delivered': '#d4edda',
                'Cancelled': '#f8d7da',
                'Returned': '#f8d7da'
            };
            
            return `
            <div style="border: 1px solid var(--border); border-radius: 16px; margin-bottom: 20px; overflow: hidden; background: white;">
                <!-- Order Header -->
                <div style="background: var(--light-gray); padding: 16px 20px; display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 10px;">
                    <div>
                        <p style="margin: 0; font-weight: 600; color: var(--primary); font-size: 16px;">
                            ${order.orderNumber || 'Order #' + order.id}
                        </p>
                        <p style="margin: 4px 0 0 0; font-size: 13px; color: var(--gray);">
                            Placed on ${new Date(order.createdAt).toLocaleDateString('en-IN')}
                        </p>
                    </div>
                    <div style="text-align: right;">
                        <span style="padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: 600; text-transform: uppercase;
                            background: ${statusBg[order.status] || '#fff3cd'}; color: ${statusColors[order.status] || '#856404'};">
                            ${order.status?.toUpperCase() || 'PENDING'}
                        </span>
                    </div>
                </div>
                
                <!-- Tracking Info -->
                ${order.trackingId ? `
                <div style="padding: 15px 20px; background: #f8f9fa; border-bottom: 1px solid var(--border);">
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                        <div>
                            <p style="margin: 0; font-size: 12px; color: var(--gray);">Tracking ID</p>
                            <p style="margin: 4px 0 0 0; font-weight: 600; font-size: 16px; color: var(--primary);">
                                ${order.trackingId}
                            </p>
                        </div>
                        ${order.estimatedDelivery ? `
                        <div style="text-align: right;">
                            <p style="margin: 0; font-size: 12px; color: var(--gray);">Estimated Delivery</p>
                            <p style="margin: 4px 0 0 0; font-weight: 500; font-size: 14px;">
                                <i class="fas fa-calendar-alt"></i> ${new Date(order.estimatedDelivery).toLocaleDateString('en-IN')}
                            </p>
                        </div>
                        ` : ''}
                    </div>
                </div>
                ` : ''}
                
                <!-- Tracking Timeline (if available) -->
                ${order.trackingHistory && order.trackingHistory.length > 0 ? `
                <div style="padding: 20px; border-bottom: 1px solid var(--border);">
                    <p style="margin: 0 0 15px 0; font-weight: 600; color: var(--primary);"><i class="fas fa-route"></i> Order Tracking</p>
                    <div style="position: relative; padding-left: 25px;">
                        ${order.trackingHistory.slice().reverse().slice(0, 3).map((track, index) => `
                            <div style="position: relative; padding-bottom: 15px; ${index === order.trackingHistory.length - 1 || index === 2 ? '' : 'border-left: 2px solid var(--border);'} margin-left: 5px;">
                                <div style="position: absolute; left: -31px; top: 0; width: 14px; height: 14px; background: ${index === 0 ? 'var(--success)' : 'var(--gray)'}; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.1);"></div>
                                <div style="background: ${index === 0 ? '#f0fff4' : 'var(--light-gray)'}; padding: 12px; border-radius: 8px; margin-left: 8px;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                        <span style="font-weight: 600; font-size: 13px; color: var(--primary);">${track.status}</span>
                                        <span style="font-size: 11px; color: var(--gray);">${new Date(track.timestamp).toLocaleDateString('en-IN')}</span>
                                    </div>
                                    <p style="margin: 0; color: var(--dark-gray); font-size: 12px;">${track.description}</p>
                                    ${track.location ? `<p style="margin: 4px 0 0 0; font-size: 11px; color: var(--gray);"><i class="fas fa-map-marker-alt"></i> ${track.location}</p>` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    ${order.trackingHistory.length > 3 ? `
                        <p style="text-align: center; margin: 10px 0 0 0; font-size: 12px; color: var(--gray);">
                            +${order.trackingHistory.length - 3} more updates
                        </p>
                    ` : ''}
                </div>
                ` : ''}
                
                <!-- Order Items -->
                <div style="padding: 20px;">
                    ${order.items?.slice(0, 2).map(item => `
                        <div style="display: flex; gap: 15px; margin-bottom: 15px; padding-bottom: 15px; ${order.items.length > 1 ? 'border-bottom: 1px solid var(--border);' : ''}">
                            <img src="${item.images?.[0] || '/uploads/products/default.jpg'}" alt="${item.name}" style="width: 70px; height: 70px; object-fit: cover; border-radius: 8px;">
                            <div style="flex: 1;">
                                <p style="margin: 0; font-weight: 500; font-size: 14px;">${item.name}</p>
                                <p style="margin: 4px 0; color: var(--gray); font-size: 12px;">Qty: ${item.quantity}</p>
                            </div>
                            <p style="margin: 0; font-weight: 600; font-size: 14px;">₹${(item.price * item.quantity).toLocaleString()}</p>
                        </div>
                    `).join('') || '<p>No items</p>'}
                    ${order.items && order.items.length > 2 ? `<p style="text-align: center; margin: 10px 0; font-size: 12px; color: var(--gray);">+${order.items.length - 2} more items</p>` : ''}
                    
                    <!-- Order Total & Actions -->
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 15px; padding-top: 15px; border-top: 2px solid var(--border);">
                        <div>
                            <p style="margin: 0; font-size: 13px; color: var(--gray);">Total Amount</p>
                            <p style="margin: 4px 0 0 0; font-size: 20px; font-weight: 700; color: var(--primary);">₹${(order.total || 0).toLocaleString()}</p>
                        </div>
                        <div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end;">
                            <button class="btn btn-primary" onclick="downloadUserInvoice('${order.id}')" style="padding: 10px 20px; font-size: 13px;">
                                <i class="fas fa-file-download"></i> Invoice
                            </button>
                            ${order.trackingId ? `
                            <button class="btn btn-secondary" onclick="trackOrder('${order.trackingId}')" style="padding: 10px 20px; font-size: 13px;">
                                <i class="fas fa-map-marker-alt"></i> Track
                            </button>
                            ` : ''}
                            ${!['Delivered', 'Cancelled', 'Payment Failed'].includes(order.status) ? `
                            <button class="btn btn-danger" onclick="cancelOrder('${order.id}')" style="padding: 10px 20px; font-size: 13px; background: var(--danger); color: white; border: none; border-radius: 8px; cursor: pointer;">
                                <i class="fas fa-times-circle"></i> Cancel
                            </button>
                            ` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;}).join('');
    } catch (err) {
        console.error('Error loading orders:', err);
        document.getElementById('userOrdersList').innerHTML = `
            <div class="empty-state" style="padding: 40px;">
                <i class="fas fa-exclamation-circle" style="font-size: 40px; color: var(--accent);"></i>
                <p style="margin-top: 15px; color: var(--gray);">Error loading orders. Please try again.</p>
            </div>
        `;
    }
}

async function downloadUserInvoice(orderId) {
    try {
        const res = await fetch(`${API_URL}/api/orders/user/${currentUser.id}`, { headers: authHeaders() });
        const orders = await res.json();
        const order = orders.find(o => o.id === orderId || o.id === parseInt(orderId));
        
        if (!order) {
            showNotification('Order not found', 'error');
            return;
        }
        
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
        .customer-details p { margin: 8px 0; font-size: 14px; color: #444; }
        .customer-details strong { color: #1a1a2e; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th { background: #1a1a2e; color: white; padding: 12px; text-align: left; font-size: 14px; }
        td { padding: 12px; border-bottom: 1px solid #eee; font-size: 14px; }
        .product-cell { display: flex; align-items: center; gap: 12px; }
        .product-cell img { width: 50px; height: 50px; object-fit: cover; border-radius: 4px; }
        .totals { margin-top: 20px; border-top: 2px solid #1a1a2e; padding-top: 20px; }
        .total-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; }
        .total-row.grand { font-size: 20px; font-weight: bold; color: #1a1a2e; border-top: 2px solid #ddd; margin-top: 10px; padding-top: 15px; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #666; font-size: 12px; }
        .print-btn { position: fixed; top: 20px; right: 20px; padding: 12px 24px; background: #1a1a2e; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
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
                <h1>${settings.siteName || 'Shrisilverbay'}</h1>
                <p>India's #1 Shopping Destination</p>
                <p>Email: support@shrisilverbay.com | Phone: 1800-123-4567</p>
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
        </div>
        
        <div class="section">
            <h3><i class="fas fa-shopping-cart"></i> Order Items</h3>
            <table>
                <thead>
                    <tr><th>Product</th><th>Unit Price</th><th>Qty</th><th>Amount</th></tr>
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
            <div class="total-row"><span>Subtotal:</span><span>₹${(order.total || 0).toLocaleString()}</span></div>
            <div class="total-row"><span>Shipping:</span><span>FREE</span></div>
            <div class="total-row grand"><span>Total Amount:</span><span>₹${(order.total || 0).toLocaleString()}</span></div>
        </div>
        
        <div class="footer">
            <p><strong>Thank you for shopping with ${settings.siteName || 'Shrisilverbay'}!</strong></p>
            <p>This is a computer generated invoice and does not require signature.</p>
        </div>
    </div>
</body>
</html>`;
        
        invoiceWindow.document.write(invoiceHTML);
        invoiceWindow.document.close();
        showNotification('Invoice opened! Click Print to save as PDF.');
    } catch (err) {
        showNotification('Error generating invoice', 'error');
    }
}

async function updateProfile(e) {
    e.preventDefault();
    const userData = {
        name: document.getElementById('profileName').value,
        phone: document.getElementById('profilePhone').value,
        address: document.getElementById('profileAddress').value
    };
    
    try {
        const res = await fetch(`${API_URL}/api/users/${currentUser.id}`, {
            method: 'PUT',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(userData)
        });
        
        if (res.ok) {
            currentUser = { ...currentUser, ...userData };
            localStorage.setItem('user', JSON.stringify(currentUser));
            updateAuthUI();
            showNotification('Profile updated successfully!');
        } else {
            showNotification('Failed to update profile', 'error');
        }
    } catch (err) {
        showNotification('Error updating profile', 'error');
    }
}

// Track order by tracking ID
async function trackOrder(trackingId) {
    try {
        const res = await fetch(`${API_URL}/api/orders/track/${trackingId}`);
        const data = await res.json();
        
        if (!data.success) {
            showNotification('Tracking ID not found', 'error');
            return;
        }
        
        const order = data.order;
        
        // Create tracking modal
        let modal = document.getElementById('trackingModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'trackingModal';
            modal.className = 'modal-overlay';
            document.body.appendChild(modal);
        }
        
        const statusSteps = ['Order Placed', 'Confirmed', 'Processing', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered'];
        if (order.status === 'Payment Failed') statusSteps.push('Payment Failed');
        const currentStepIndex = statusSteps.indexOf(order.status);
        
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 600px; max-height: 90vh; overflow-y: auto;">
                <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h3><i class="fas fa-truck"></i> Track Order</h3>
                        <p style="margin: 5px 0 0 0; font-size: 13px; color: var(--gray);">
                            ${order.orderNumber || 'Order #' + order.id}
                        </p>
                    </div>
                    <button class="close-btn" onclick="closeModal('trackingModal')">&times;</button>
                </div>
                
                <!-- Tracking ID Banner -->
                <div style="background: var(--gradient-primary); color: white; padding: 20px; margin: 20px; border-radius: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <p style="margin: 0; opacity: 0.9; font-size: 12px;">Tracking ID</p>
                            <p style="margin: 5px 0 0 0; font-size: 20px; font-weight: 600;">${order.trackingId}</p>
                        </div>
                        <div style="text-align: right;">
                            <p style="margin: 0; opacity: 0.9; font-size: 12px;">Status</p>
                            <p style="margin: 5px 0 0 0; font-size: 16px; font-weight: 600;">${order.status}</p>
                        </div>
                    </div>
                    ${order.estimatedDelivery ? `
                    <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.3);">
                        <p style="margin: 0; font-size: 14px;">
                            <i class="fas fa-calendar-check"></i> Estimated Delivery: <strong>${new Date(order.estimatedDelivery).toLocaleDateString('en-IN')}</strong>
                        </p>
                    </div>
                    ` : ''}
                </div>
                
                <!-- Progress Steps -->
                <div style="padding: 0 20px 20px;">
                    <p style="margin: 0 0 20px 0; font-weight: 600; color: var(--primary);">Order Progress</p>
                    <div style="display: flex; justify-content: space-between; position: relative; margin-bottom: 30px;">
                        ${statusSteps.map((step, index) => {
                            const isCompleted = index <= currentStepIndex;
                            const isCurrent = index === currentStepIndex;
                            return `
                                <div style="flex: 1; text-align: center; position: relative;">
                                    <div style="width: 30px; height: 30px; border-radius: 50%; margin: 0 auto 8px; display: flex; align-items: center; justify-content: center; font-size: 12px;
                                        background: ${isCompleted ? 'var(--success)' : 'var(--light-gray)'}; 
                                        color: ${isCompleted ? 'white' : 'var(--gray)'};
                                        border: 3px solid ${isCompleted ? 'var(--success)' : isCurrent ? 'var(--primary)' : 'var(--border)'};
                                        ${isCurrent ? 'box-shadow: 0 0 0 4px rgba(212, 175, 55, 0.2);' : ''}">
                                        ${isCompleted ? '<i class="fas fa-check"></i>' : index + 1}
                                    </div>
                                    <p style="margin: 0; font-size: 10px; color: ${isCompleted || isCurrent ? 'var(--primary)' : 'var(--gray)'}; font-weight: ${isCurrent ? '600' : '400'};">${step}</p>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
                
                <!-- Detailed Tracking History -->
                <div style="padding: 0 20px 20px;">
                    <p style="margin: 0 0 15px 0; font-weight: 600; color: var(--primary);"><i class="fas fa-history"></i> Tracking History</p>
                    ${order.trackingHistory && order.trackingHistory.length > 0 ? `
                        <div style="position: relative; padding-left: 25px;">
                            ${order.trackingHistory.slice().reverse().map((track, index) => `
                                <div style="position: relative; padding-bottom: 20px; ${index === order.trackingHistory.length - 1 ? '' : 'border-left: 2px solid var(--border);'} margin-left: 5px;">
                                    <div style="position: absolute; left: -31px; top: 0; width: 16px; height: 16px; background: ${index === 0 ? 'var(--success)' : 'var(--gray)'}; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.2);"></div>
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
                    ` : '<p style="color: var(--gray); text-align: center;">No tracking updates yet</p>'}
                </div>
                
                <!-- Shipping Address -->
                <div style="padding: 0 20px 20px;">
                    <p style="margin: 0 0 10px 0; font-weight: 600; color: var(--primary);"><i class="fas fa-map-marker-alt"></i> Shipping Address</p>
                    <div style="background: var(--light-gray); padding: 15px; border-radius: 8px;">
                        <p style="margin: 0; color: var(--dark-gray); line-height: 1.6;">${order.shippingAddress}</p>
                    </div>
                </div>
            </div>
        `;
        
        modal.classList.add('show');
    } catch (err) {
        console.error('Error tracking order:', err);
        showNotification('Error tracking order', 'error');
    }
}

// Cancel order function
async function cancelOrder(orderId) {
    if (!confirm('Are you sure you want to cancel this order?\n\nOnce cancelled, this action cannot be undone.')) {
        return;
    }
    
    const reason = prompt('Please provide a reason for cancellation (optional):');
    
    try {
        const res = await fetch(`${API_URL}/api/orders/${orderId}/cancel`, {
            method: 'PUT',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ reason: reason || 'Cancelled by customer' })
        });
        
        const data = await res.json();
        
        if (res.ok && data.success) {
            showNotification('Order cancelled successfully');
            // Refresh orders list
            loadUserOrders();
            
            // Send cancellation email simulation
            console.log('📧 Order Cancellation Email');
            console.log('================================');
            console.log('To:', currentUser?.email || 'customer@example.com');
            console.log('Subject: Order Cancelled - ' + orderId);
            console.log('');
            console.log('Your order has been cancelled successfully.');
            console.log('Reason:', reason || 'Cancelled by customer');
            console.log('================================');
        } else {
            showNotification(data.message || 'Failed to cancel order', 'error');
        }
    } catch (err) {
        console.error('Error cancelling order:', err);
        showNotification('Error cancelling order. Please try again.', 'error');
    }
}

// ===== UTILITIES =====
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = '';
    }
}

function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i>
        <span>${message}</span>
    `;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideInRight 0.4s ease reverse';
        setTimeout(() => notification.remove(), 400);
    }, 3000);
}

function setupEventListeners() {
    // Search
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') performSearch();
        });
    }
    
    // Close modals on overlay click
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            e.target.classList.remove('show');
            document.body.style.overflow = '';
        }
    });
    
    // Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal-overlay').forEach(m => {
                m.classList.remove('show');
            });
            document.querySelectorAll('.sidebar').forEach(s => s.classList.remove('open'));
            document.getElementById('sidebarOverlay')?.classList.remove('show');
            document.body.style.overflow = '';
        }
    });
}

// Add animation keyframes
const style = document.createElement('style');
style.textContent = `
    @keyframes scaleIn {
        from { transform: scale(0); }
        to { transform: scale(1); }
    }
`;
document.head.appendChild(style);
