const express = require('express');
const config = require('./config');
const adminRoutes = require('./routes/adminRoutes');
const aiRoutes = require('./routes/aiRoutes');
const authRoutes = require('./routes/authRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const favoriteRoutes = require('./routes/favoriteRoutes');
const ownerRoutes = require('./routes/ownerRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const venueRoutes = require('./routes/venueRoutes');

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (origin === config.frontendUrl) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
}

function createApp() {
  const app = express();

  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (isAllowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin || config.frontendUrl);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') {
      res.status(204).send();
      return;
    }
    next();
  });

  app.use(express.json({ limit: '25mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'smart-event-venue-api' });
  });

  app.use('/api/admin', adminRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/bookings', bookingRoutes);
  app.use('/api/favorites', favoriteRoutes);
  app.use('/api/owner', ownerRoutes);
  app.use('/api/venues', venueRoutes);
  app.use('/api/payments', paymentRoutes);

  app.use((_req, _res, next) => {
    const error = new Error('Route not found.');
    error.status = 404;
    next(error);
  });

  app.use((error, _req, res, _next) => {
    const status = error.status || 500;
    if (status >= 500) {
      console.error(error.stack || error.message || error);
    }
    res.status(status).json({
      error: {
        message: error.message || 'Something went wrong.',
        details: error.details,
      },
    });
  });

  return app;
}

module.exports = { createApp };
