const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { addFavorite, listFavoriteVenueIds, removeFavorite } = require('../services/favoriteService');
const { asyncHandler } = require('../utils/errors');

const router = express.Router();

router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const venueIds = await listFavoriteVenueIds(req.user);
  res.json({ venueIds });
}));

router.post('/:venueId', asyncHandler(async (req, res) => {
  await addFavorite(req.user, req.params.venueId);
  const venueIds = await listFavoriteVenueIds(req.user);
  res.status(201).json({ venueIds });
}));

router.delete('/:venueId', asyncHandler(async (req, res) => {
  await removeFavorite(req.user, req.params.venueId);
  const venueIds = await listFavoriteVenueIds(req.user);
  res.json({ venueIds });
}));

module.exports = router;
