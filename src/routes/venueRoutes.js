const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createVenue, deleteVenue, getVenue, listVenues, updateVenue } = require('../services/venueService');
const { asyncHandler } = require('../utils/errors');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const venues = await listVenues({
    province: req.query.province,
    status: req.query.status,
  });
  res.json({ venues });
}));

router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  const venues = await listVenues({ ownerId: req.user.id });
  res.json({ venues });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const venue = await getVenue(req.params.id);
  res.json({ venue });
}));

router.post('/', requireAuth, requireRole('owner'), asyncHandler(async (req, res) => {
  const venue = await createVenue(req.body, req.user.id);
  res.status(201).json({ venue });
}));

router.put('/:id', requireAuth, requireRole('owner'), asyncHandler(async (req, res) => {
  const venue = await updateVenue(req.params.id, req.body, req.user);
  res.json({ venue });
}));

router.delete('/:id', requireAuth, requireRole('owner'), asyncHandler(async (req, res) => {
  await deleteVenue(req.params.id, req.user);
  res.status(204).send();
}));

module.exports = router;
