const express = require('express');
const { requireAuth } = require('../middleware/auth');
const config = require('../config');
const {
  confirmPayment,
  createPaymentIntent,
  listPayments,
  handlePaymentWebhook,
  getPaymentStatus,
} = require('../services/paymentService');
const { asyncHandler } = require('../utils/errors');

const router = express.Router();

/**
 * GET /api/payments
 * List all payments for the current user
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const payments = await listPayments(req.user);
  res.json({ payments });
}));

/**
 * GET /api/payments/:id
 * Get payment status
 */
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const payment = await getPaymentStatus(req.params.id, req.user);
  res.json({ payment });
}));

/**
 * POST /api/payments/intent
 * Create payment intent (for both card via PesaPal and mobile via Paypack)
 * Request body:
 * {
 *   method: "card" | "phone",
 *   amount: number,
 *   currency: "RWF" | etc,
 *   bookingId?: string,
 *   venueId?: string,
 *   phoneNumber?: string (optional)
 * }
 */
router.post('/intent', requireAuth, asyncHandler(async (req, res) => {
  const payment = await createPaymentIntent(req.body, req.user);
  res.status(201).json({ payment });
}));

/**
 * POST /api/payments/:id/confirm
 * Confirm payment after user action
 * Request body:
 * {
 *   // Additional confirmation data if needed
 * }
 */
router.post('/:id/confirm', requireAuth, asyncHandler(async (req, res) => {
  const payment = await confirmPayment(req.params.id, req.body, req.user);
  res.json({ payment });
}));

/**
 * GET /api/payments/callback/paypal
 * Legacy PayPal callback handler (payment success/cancel redirect)
 */
router.get('/callback/paypal', asyncHandler(async (req, res) => {
  const { orderId, status } = req.query;

  if (status === 'success' && orderId) {
    // Payment was approved by user, now we need to capture it
    // Redirect back to the frontend payment success page.
    res.redirect(`${config.frontendUrl}/payment-success?orderId=${orderId}`);
  } else if (status === 'cancel') {
    res.redirect(`${config.frontendUrl}/payment-cancelled?orderId=${orderId}`);
  } else {
    res.status(400).json({ error: 'Invalid callback' });
  }
}));

/**
 * POST /api/payments/webhook/pesapal
 * PesaPal webhook handler (no auth required)
 */
router.get('/webhook/pesapal', asyncHandler(async (req, res) => {
  try {
    await handlePaymentWebhook('pesapal', req.query);
    const paymentId = req.query.OrderMerchantReference || req.query.orderMerchantReference || '';
    const suffix = paymentId ? `?id=${encodeURIComponent(paymentId)}` : '';
    res.redirect(`${config.frontendUrl}/payment/success${suffix}`);
  } catch (error) {
    res.redirect(`${config.frontendUrl}/payment/success?error=${encodeURIComponent(error.message)}`);
  }
}));

router.post('/webhook/pesapal', asyncHandler(async (req, res) => {
  try {
    await handlePaymentWebhook('pesapal', req.body);
    res.json({ received: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}));

/**
 * POST /api/payments/webhook/paypack
 * Paypack webhook handler (no auth required)
 */
router.post('/webhook/paypack', asyncHandler(async (req, res) => {
  try {
    await handlePaymentWebhook('paypack', req.body);
    res.json({ received: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}));

module.exports = router;
