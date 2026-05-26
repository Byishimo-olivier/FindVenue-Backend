const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getAdminOverview } = require('../services/adminService');

const router = express.Router();

router.use(requireAuth, requireRole('admin'));

router.get('/overview', async (req, res, next) => {
  try {
    const overview = await getAdminOverview(req.user);
    res.json({ overview });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
