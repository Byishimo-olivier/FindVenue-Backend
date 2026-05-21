const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { confirmPayment, createPaymentIntent, listPayments } = require('../services/paymentService');
const { asyncHandler } = require('../utils/errors');

const router = express.Router();

router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const payments = await listPayments(req.user);
  res.json({ payments });
}));

router.post('/intent', asyncHandler(async (req, res) => {
  const payment = await createPaymentIntent(req.body, req.user);
  res.status(201).json({ payment });
}));

router.post('/:id/confirm', asyncHandler(async (req, res) => {
  const payment = await confirmPayment(req.params.id, req.user);
  res.json({ payment });
}));

module.exports = router;
