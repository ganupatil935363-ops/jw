# Render deployment

Build command: `npm install`
Start command: `node backend/server.js`
Do not set PORT; Render supplies it.

Required environment variables are listed in `.env.example`. Never commit `.env`.

For production image uploads, configure all three Cloudinary variables.
For MongoDB Atlas, allow Render connections in Network Access and use a database user with read/write permissions.
After deployment, test `/api/health` and `/api/products`.
