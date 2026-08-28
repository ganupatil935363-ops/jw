# SmartStore — Production-ready E-Commerce Starter

This version adds MongoDB persistence, JWT authentication/authorization, Razorpay payment verification + webhooks/refunds, Socket.IO real-time admin/customer order updates, customer order history/cancellation, email/WhatsApp notifications, and production security middleware.

## 1. Install

```bash
npm install
```

## 2. Environment

Copy `.env.example` to `.env` and fill in:

- `MONGODB_URI` — MongoDB Atlas connection string.
- `JWT_SECRET` — long random application secret (32+ chars).
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — Test keys during development.
- `RAZORPAY_WEBHOOK_SECRET` — separate webhook secret configured in Razorpay Dashboard.
- SMTP variables for email.
- WhatsApp Cloud API variables for WhatsApp notifications.

Never commit `.env`.

## 3. MongoDB

Create a MongoDB Atlas cluster and database. Put the connection string in `MONGODB_URI`.

On the first server start, SmartStore automatically imports the existing JSON data into MongoDB if the collections are empty. MongoDB becomes the source of truth for users, products, orders, payments and store content.

For production, back up MongoDB before changing data.

## 4. Run

```bash
npm start
```

Customer site:

`http://localhost:3000/`

Admin:

`http://localhost:3000/admin/dashboard.html`

## 5. Authentication

Customer passwords are stored using bcrypt. Login returns a JWT. Protected APIs require:

`Authorization: Bearer <token>`

Admin APIs additionally require `isAdmin=true`.

Change the seeded demo admin password immediately after first login.

## 6. Razorpay

Use Test Mode first.

The browser creates a Razorpay Checkout order through `/api/payments/create-order`. The server calculates the amount from MongoDB product prices. The server verifies the checkout signature before an order is created.

Configure automatic capture in Razorpay Dashboard for normal production checkout.

### Webhook

Configure a public HTTPS webhook:

`https://YOUR-DOMAIN/api/payments/webhook`

Use a strong webhook secret in `RAZORPAY_WEBHOOK_SECRET`.

Recommended events:

- `payment.captured`
- `payment.failed`
- `order.paid`
- `refund.created`
- `refund.processed`
- `refund.failed`

Razorpay webhook signature verification uses the raw request body. The application also stores webhook event IDs to prevent duplicate processing.

## 7. Order workflow

Customer:

`Order Placed`

Admin:

`Confirm Order → Processing → Packed → Shipped → Out for Delivery → Delivered`

The backend rejects invalid status jumps and customers cannot move their own order to an administrative status.

## 8. Cancellation and refunds

Customers can cancel before the order reaches Packed/Shipped. For captured Razorpay payments, cancellation initiates a Razorpay refund.

Admins can also refund an order from the API.

COD cancellations do not create a payment refund.

## 9. Real-time notifications

Socket.IO authenticates connections with the JWT.

- Admins join the `admins` room.
- Customers join their own `user:<id>` room.
- New orders emit `new-order`.
- Status changes emit `order-updated`.

The admin dashboard still keeps a polling fallback.

## 10. Email and WhatsApp

Email uses SMTP.

WhatsApp uses the Meta WhatsApp Cloud API. For business-initiated order notifications outside the customer service window, configure an approved WhatsApp template:

```env
WHATSAPP_TEMPLATE_NAME=your_approved_template
WHATSAPP_TEMPLATE_LANG=en_US
```

The template should have four body variables:

1. Event/title
2. Order number
3. Amount
4. Status

Admin notification number:

```env
ADMIN_WHATSAPP_TO=919353630646
```

The WhatsApp API credentials are server-side only.

## 11. Deployment

Recommended architecture:

Browser → HTTPS domain → Node/Express → MongoDB Atlas
                              ↘ Razorpay
                              ↘ SMTP
                              ↘ WhatsApp Cloud API
                              ↘ Socket.IO

Use a Node-capable host such as Render, Railway, Fly.io, AWS, Azure, or another HTTPS Node host.

Set all `.env` values as hosting-provider environment variables. Do not upload `.env`.

Set:

```env
NODE_ENV=production
FRONTEND_URL=https://your-domain.com
```

Use HTTPS. Razorpay webhooks require a public HTTPS endpoint on port 443/80.

Before going live:

- Replace Test Razorpay keys with Live keys.
- Configure Live-mode Razorpay webhook separately.
- Change the admin password.
- Use a strong `JWT_SECRET`.
- Use a separate strong `RAZORPAY_WEBHOOK_SECRET`.
- Restrict CORS to your production domain.
- Configure MongoDB IP/network access securely.
- Configure SMTP.
- Configure WhatsApp Cloud API and an approved template.
- Enable automated MongoDB backups.
- Test successful, failed, duplicate, cancelled and refunded payments.

## Important

This project is an application starter, not a substitute for a production security review. Payment fulfilment should happen only after the payment is confirmed as captured by Razorpay.
