const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/errors');
const { updateSubscription, getSubscription, activateSubscription } = require('../services/authService');
const { createPaymentIntent } = require('../services/paymentService');
const { HttpError } = require('../utils/errors');
const { readCollection, writeCollection } = require('../db/mongoStore');

const router = express.Router();

/**
 * GET /api/subscriptions/plans
 * Get all available subscription plans (PUBLIC)
 */
router.get('/plans', asyncHandler(async (req, res) => {
  const plans = await readCollection('plans');
  res.json({ plans });
}));

/**
 * ADMIN: GET /api/subscriptions/admin/plans
 * Get all subscription plans (for admin management)
 */
router.get('/admin/plans', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const plans = await readCollection('plans');
  res.json({ plans });
}));

/**
 * ADMIN: PATCH /api/subscriptions/admin/plans/:planId
 * Update a subscription plan (price, features, etc)
 */
router.patch('/admin/plans/:planId', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { planId } = req.params;
  const updates = req.body;

  const plans = await readCollection('plans');
  const index = plans.findIndex(p => p.id === planId);

  if (index === -1) {
    throw new HttpError(404, 'Plan not found');
  }

  // Update allowed fields
  if (updates.price !== undefined) plans[index].price = Number(updates.price);
  if (updates.name !== undefined) plans[index].name = String(updates.name);
  if (updates.description !== undefined) plans[index].description = String(updates.description);
  if (updates.features !== undefined) plans[index].features = Array.isArray(updates.features) ? updates.features : [];

  await writeCollection('plans', plans);
  res.json({ plan: plans[index], message: `Plan "${planId}" updated successfully` });
}));

// Owner-only routes below
router.use(requireAuth, requireRole('owner'));

/**
 * GET /api/subscriptions/current
 * Get current subscription status for the user
 */
router.get('/current', requireAuth, asyncHandler(async (req, res) => {
  const { subscriptionPlan, subscriptionStatus, subscriptionTrialEndsAt, subscriptionStartedAt, subscriptionNextBillingAt } = req.user;
  res.json({
    subscription: {
      plan: subscriptionPlan,
      status: subscriptionStatus,
      trialEndsAt: subscriptionTrialEndsAt,
      startedAt: subscriptionStartedAt,
      nextBillingAt: subscriptionNextBillingAt,
    },
  });
}));

/**
 * POST /api/subscriptions/initiate
 * Initiate a subscription purchase
 * Request body:
 * {
 *   planId: "starter" | "professional" | "premium",
 *   paymentMethod?: "card" | "phone",
 *   phoneNumber?: string
 * }
 */
router.post('/initiate', requireAuth, asyncHandler(async (req, res) => {
  const { planId, paymentMethod, method: requestMethod, phoneNumber } = req.body;
  const selectedMethod = paymentMethod || requestMethod;
  const normalizedMethod = selectedMethod === 'phone' ? 'phone' : 'card';

  if (!planId) {
    throw new HttpError(400, 'Plan ID is required');
  }

  if (normalizedMethod === 'phone' && (!phoneNumber || !String(phoneNumber).trim())) {
    throw new HttpError(400, 'Phone number is required for mobile subscription payments.');
  }

  // Get plan from database
  const plans = await readCollection('plans');
  const plan = plans.find(p => p.id === planId);

  if (!plan) {
    throw new HttpError(400, 'Invalid plan ID');
  }

  // Create payment intent for subscription
  const payment = await createPaymentIntent(
    {
      type: 'subscription',
      method: normalizedMethod,
      amount: plan.price,
      currency: plan.currency,
      subscriptionPlan: planId,
      phoneNumber: phoneNumber ? String(phoneNumber).trim() : undefined,
      description: `${plan.name} Plan - Monthly Subscription`,
    },
    req.user
  );

  res.status(201).json({ payment, planId });
}));

/**
 * POST /api/subscriptions/activate
 * Activate subscription after successful payment
 * Request body:
 * {
 *   paymentId: string,
 *   planId: string
 * }
 */
router.post('/activate', requireAuth, asyncHandler(async (req, res) => {
  const { paymentId, planId } = req.body;

  if (!paymentId || !planId) {
    throw new HttpError(400, 'Payment ID and Plan ID are required');
  }

  // Validate planId
  const validPlans = ['starter', 'professional', 'premium'];
  if (!validPlans.includes(planId)) {
    throw new HttpError(400, 'Invalid plan ID');
  }

  // Update subscription status to active
  const subscription = await activateSubscription(req.user.id, {
    plan: planId,
    paymentId,
  });

  res.json({ subscription });
}));

/**
 * POST /api/subscriptions/cancel
 * Cancel current subscription
 */
router.post('/cancel', requireAuth, asyncHandler(async (req, res) => {
  await updateSubscription(req.user.id, {
    plan: null,
    status: 'cancelled',
  });

  res.json({ message: 'Subscription cancelled successfully' });
}));

/**
 * POST /api/subscriptions/change-plan
 * Change subscription plan
 * Request body:
 * {
 *   planId: "starter" | "professional" | "premium"
 * }
 */
router.post('/change-plan', requireAuth, asyncHandler(async (req, res) => {
  const { planId } = req.body;

  if (!planId) {
    throw new HttpError(400, 'Plan ID is required');
  }

  // Validate planId
  const validPlans = ['starter', 'professional', 'premium'];
  if (!validPlans.includes(planId)) {
    throw new HttpError(400, 'Invalid plan ID');
  }

  // Update subscription plan
  await updateSubscription(req.user.id, {
    plan: planId,
  });

  res.json({ message: `Subscription changed to ${planId}` });
}));

module.exports = router;
