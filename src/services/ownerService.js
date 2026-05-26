const { listBookings } = require('./bookingService');
const { listVenues } = require('./venueService');

function toNumber(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

async function getOwnerOverview(user) {
  const venues = await listVenues({ ownerId: user.id });
  const bookings = await listBookings(user);
  const confirmedBookings = bookings.filter((booking) => booking.status === 'confirmed').length;
  const pendingBookings = bookings.filter((booking) => String(booking.status || '').includes('pending')).length;
  const totalRevenue = bookings.reduce((total, booking) => {
    if (booking.status === 'cancelled') return total;
    return total + toNumber(booking.totals && booking.totals.total);
  }, 0);
  const paidRevenue = bookings.reduce((total, booking) => total + toNumber(booking.amountPaid), 0);
  const guestCount = bookings.reduce((total, booking) => total + toNumber(booking.guestCount), 0);

  return {
    venues,
    bookings,
    summary: {
      activeVenues: venues.filter((venue) => ['approved', 'active'].includes(String(venue.status || '').toLowerCase())).length,
      confirmedBookings,
      conversionRate: bookings.length ? Math.round((confirmedBookings / bookings.length) * 100) : 0,
      guestCount,
      paidRevenue,
      pendingBookings,
      pendingRevenue: Math.max(totalRevenue - paidRevenue, 0),
      totalBookings: bookings.length,
      totalRevenue,
    },
  };
}

module.exports = { getOwnerOverview };
