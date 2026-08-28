const { connectDatabase } = require('../backend/db');
const app = require('../backend/server');

let dbReady;

module.exports = async function handler(req, res) {
  try {
    // Reuse the same connection promise across warm Vercel invocations.
    if (!dbReady) dbReady = connectDatabase();
    await dbReady;
    return app(req, res);
  } catch (err) {
    console.error('API startup error:', err);
    dbReady = null;
    return res.status(500).json({
      message: 'Database connection failed',
      error: process.env.NODE_ENV === 'production' ? undefined : err.message
    });
  }
};
