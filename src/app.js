const express = require('express');
const config = require('./config');
const authRoutes = require('./routes/authRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const venueRoutes = require('./routes/venueRoutes');

function createApp() {
  const app = express();

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', config.frontendUrl);
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

  app.use('/api/auth', authRoutes);
  app.use('/api/bookings', bookingRoutes);
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
