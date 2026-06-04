const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  addonCatalog,
  cancelBooking,
  createBooking,
  getAvailability,
  getBooking,
  getVenueAddonCatalog,
  listBookings,
  refundBooking,
  updateBooking,
} = require('../services/bookingService');
const { getVenue } = require('../services/venueService');
const { asyncHandler } = require('../utils/errors');
const { cleanString } = require('../utils/validators');

const router = express.Router();

router.get('/addons', asyncHandler(async (req, res) => {
  const venueId = cleanString(req.query.venueId);
  if (!venueId) {
    res.json({ addons: Object.values(addonCatalog) });
    return;
  }

  const venue = await getVenue(venueId);
  res.json({ addons: Object.values(getVenueAddonCatalog(venue)) });
}));

router.get('/availability', asyncHandler(async (req, res) => {
  const availability = await getAvailability(cleanString(req.query.venueId), req.query.month);
  res.json({ availability });
}));

/**
 * GET /api/bookings/:id - Get booking details (public access for checkout)
 */
router.get('/:id', asyncHandler(async (req, res) => {
  // Allow unauthenticated access for booking checkout
  const booking = await getBooking(req.params.id, req.user || null);
  res.json({ booking });
}));

router.use(requireAuth);

/**
 * GET /api/bookings - List user's bookings
 */
router.get('/', asyncHandler(async (req, res) => {
  const bookings = await listBookings(req.user);
  res.json({ bookings });
}));

/**
 * POST /api/bookings - Create new booking
 */
router.post('/', asyncHandler(async (req, res) => {
  const booking = await createBooking(req.body, req.user);
  res.status(201).json({ booking });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const booking = await updateBooking(req.params.id, req.body, req.user);
  res.json({ booking });
}));

router.patch('/:id/cancel', asyncHandler(async (req, res) => {
  const booking = await cancelBooking(req.params.id, req.user);
  res.json({ booking });
}));

router.patch('/:id/refund', asyncHandler(async (req, res) => {
  const booking = await refundBooking(req.params.id, req.user);
  res.json({ booking });
}));

module.exports = router;
