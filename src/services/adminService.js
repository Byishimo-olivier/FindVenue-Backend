const { readCollection } = require('../db/mongoStore');
const { listBookings } = require('./bookingService');
const { listPayments } = require('./paymentService');
const { listVenues } = require('./venueService');
const { publicUser } = require('./authService');

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const amount = Number(String(value || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(amount) ? amount : 0;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function getRevenueFromBooking(booking) {
  return toNumber(booking.amountPaid || booking.totals?.total);
}

function summarizeByProvince(venues, bookings) {
  return venues.reduce((rows, venue) => {
    const province = venue.province || 'Unassigned';
    const existing = rows[province] || { province, venues: 0, bookings: 0, revenue: 0 };
    const venueBookings = bookings.filter((booking) => booking.venueId === venue.id);

    rows[province] = {
      ...existing,
      venues: existing.venues + 1,
      bookings: existing.bookings + venueBookings.length,
      revenue: existing.revenue + venueBookings.reduce((total, booking) => total + getRevenueFromBooking(booking), 0),
    };

    return rows;
  }, {});
}

async function getAdminOverview(adminUser) {
  const [usersRaw, venues, bookings, payments] = await Promise.all([
    readCollection('users'),
    listVenues(),
    listBookings(adminUser),
    listPayments(adminUser),
  ]);
  const users = usersRaw.map(publicUser);
  const paidPayments = payments.filter((payment) => payment.status === 'paid');
  const totalRevenue = bookings.reduce((total, booking) => total + getRevenueFromBooking(booking), 0);
  const paidRevenue = paidPayments.reduce((total, payment) => total + toNumber(payment.amount), 0);
  const commission = Math.round((paidRevenue || totalRevenue) * 0.1);
  const activeVenues = venues.filter((venue) => ['approved', 'active'].includes(String(venue.status || '').toLowerCase()));
  const pendingVenues = venues.filter((venue) => ['pending', 'pending_review', 'review'].includes(String(venue.status || '').toLowerCase()));
  const confirmedBookings = bookings.filter((booking) => booking.status === 'confirmed');
  const provinceSummary = Object.values(summarizeByProvince(venues, bookings))
    .sort((a, b) => b.revenue - a.revenue || b.venues - a.venues);
  const topVenues = [...venues]
    .map((venue) => {
      const venueBookings = bookings.filter((booking) => booking.venueId === venue.id);
      return {
        ...venue,
        bookingCount: venueBookings.length,
        revenue: venueBookings.reduce((total, booking) => total + getRevenueFromBooking(booking), 0),
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.bookingCount - a.bookingCount || toNumber(b.price) - toNumber(a.price))
    .slice(0, 8);

  return {
    summary: {
      totalUsers: users.length,
      customers: users.filter((user) => user.role === 'customer').length,
      owners: users.filter((user) => user.role === 'owner').length,
      admins: users.filter((user) => user.role === 'admin').length,
      verifiedUsers: users.filter((user) => user.verified).length,
      totalVenues: venues.length,
      activeVenues: activeVenues.length,
      pendingVenues: pendingVenues.length,
      totalBookings: bookings.length,
      confirmedBookings: confirmedBookings.length,
      pendingBookings: bookings.filter((booking) => String(booking.status || '').includes('pending')).length,
      totalRevenue,
      paidRevenue,
      commission,
      pendingPayouts: Math.max(totalRevenue - paidRevenue, 0),
      conversionRate: bookings.length ? Math.round((confirmedBookings.length / bookings.length) * 100) : 0,
    },
    users: users
      .sort((a, b) => formatDate(b.createdAt).localeCompare(formatDate(a.createdAt)))
      .slice(0, 50),
    venues: venues.slice(0, 50),
    pendingVenues,
    bookings: bookings.slice(0, 50),
    payments: payments.slice(0, 50),
    topVenues,
    provinceSummary,
  };
}

module.exports = { getAdminOverview };
