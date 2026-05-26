const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getOwnerOverview } = require('../services/ownerService');
const { asyncHandler } = require('../utils/errors');

const router = express.Router();

router.use(requireAuth, requireRole('owner'));

router.get('/overview', asyncHandler(async (req, res) => {
  const overview = await getOwnerOverview(req.user);
  res.json(overview);
}));

module.exports = router;
