const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  loginUser,
  loginWithGoogle,
  registerUser,
  requestPasswordReset,
  resetPassword,
  resendVerificationCode,
  verifyAccount,
} = require('../services/authService');
const { getEmailStatus } = require('../services/emailService');
const { asyncHandler } = require('../utils/errors');

const router = express.Router();

router.post('/register', asyncHandler(async (req, res) => {
  const result = await registerUser(req.body);
  res.status(201).json(result);
}));

router.post('/login', asyncHandler(async (req, res) => {
  const result = await loginUser(req.body);
  res.json(result);
}));

router.post('/google', asyncHandler(async (req, res) => {
  const result = await loginWithGoogle(req.body);
  res.json(result);
}));

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post('/logout', (_req, res) => {
  res.status(204).send();
});

router.post('/forgot-password', asyncHandler(async (req, res) => {
  const result = await requestPasswordReset(req.body);
  res.json(result);
}));

router.post('/reset-password', asyncHandler(async (req, res) => {
  const result = await resetPassword(req.body);
  res.json(result);
}));

router.post('/verify', requireAuth, asyncHandler(async (req, res) => {
  const result = await verifyAccount(req.user.id, req.body);
  res.json(result);
}));

router.post('/verification-code', requireAuth, asyncHandler(async (req, res) => {
  const result = await resendVerificationCode(req.user.id);
  res.json(result);
}));

router.get('/email-status', (_req, res) => {
  res.json(getEmailStatus());
});

module.exports = router;
