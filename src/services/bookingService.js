const crypto = require('crypto');
const { readCollection, writeCollection } = require('../db/mongoStore');
const { HttpError } = require('../utils/errors');
const { cleanString } = require('../utils/validators');
const { getVenue, listVenues } = require('./venueService');

const vatRate = 0.18;
const depositRate = 0.3;

const addonCatalog = {
  'executive-catering': {
    id: 'executive-catering',
    name: 'Executive Catering',
    description: 'Premium 5-course plated service with dedicated waitstaff.',
    amount: 450000,
  },
  'floral-decor': {
    id: 'floral-decor',
    name: 'Floral & Decor Package',
    description: 'Custom centerpiece arrangements and ambient lighting design.',
    amount: 250000,
  },
  'event-photography': {
    id: 'event-photography',
    name: 'Event Photography',
    description: '4 hours of professional coverage and edited digital gallery.',
    amount: 150000,
  },
  'premium-av': {
    id: 'premium-av',
    name: 'Premium Audiovisual Suite',
    description: 'Projectors, surround sound, lighting, and mic setup.',
    amount: 200000,
  },
};

function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const amount = Number(String(value || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(amount) ? amount : 0;
}

function normalizePositiveNumber(value, fieldName, { min = 1, max } = {}) {
  const number = typeof value === 'number'
    ? value
    : Number(String(value || '').replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(number) || number < min || (max !== undefined && number > max)) {
    throw new HttpError(400, `${fieldName} is invalid.`);
  }
  return number;
}

function normalizeDate(value) {
  const date = cleanString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpError(400, 'Booking date must use YYYY-MM-DD format.');
  }
  if (Number.isNaN(new Date(`${date}T00:00:00.000Z`).getTime())) {
    throw new HttpError(400, 'Booking date is invalid.');
  }
  return date;
}

function normalizeTime(value) {
  const time = cleanString(value);
  if (!time) throw new HttpError(400, 'Start time is required.');
  return time;
}

function normalizeAddons(input = []) {
  if (!Array.isArray(input)) return [];

  return input
    .map((addon) => {
      if (typeof addon === 'string') return addonCatalog[addon];

      const catalogItem = addonCatalog[cleanString(addon?.id)];
      if (catalogItem) return catalogItem;

      const name = cleanString(addon?.name || addon?.title);
      if (!name) return null;

      return {
        id: cleanString(addon?.id) || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
        name,
        description: cleanString(addon?.description || addon?.body),
        amount: parseMoney(addon?.amount || addon?.price),
      };
    })
    .filter(Boolean);
}

function getVenueAddonCatalog(venue) {
  if (!Array.isArray(venue.addons) || venue.addons.length === 0) return {};
  return venue.addons.reduce((catalog, addon) => {
    const id = cleanString(addon?.id);
    if (!id) return catalog;

    return {
      ...catalog,
      [id]: {
        id,
        name: cleanString(addon.name),
        description: cleanString(addon.description),
        amount: parseMoney(addon.amount),
      },
    };
  }, {});
}

function normalizeVenueAddons(input = [], venue) {
  const catalog = getVenueAddonCatalog(venue);
  if (!Array.isArray(input)) return [];

  return input
    .map((addon) => {
      const id = typeof addon === 'string' ? addon : cleanString(addon?.id);
      if (catalog[id]) return catalog[id];

      const name = typeof addon === 'string' ? '' : cleanString(addon?.name || addon?.title);
      if (!name) return null;

      return {
        id: id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
        name,
        description: cleanString(addon?.description || addon?.body),
        amount: parseMoney(addon?.amount || addon?.price),
      };
    })
    .filter(Boolean);
}

function calculateTotals(venue, addons) {
  const baseVenueFee = parseMoney(venue.price);
  const cleaningFee = parseMoney(venue.cleaningFee);
  const decorFee = parseMoney(venue.decorFee);
  const addonsTotal = addons.reduce((total, addon) => total + parseMoney(addon.amount), 0);
  const subtotal = baseVenueFee + cleaningFee + decorFee + addonsTotal;
  const vat = Math.round(subtotal * vatRate);
  const total = subtotal + vat;
  const depositDue = Math.round(total * depositRate);

  return {
    currency: 'RWF',
    baseVenueFee,
    cleaningFee,
    decorFee,
    addonsTotal,
    subtotal,
    vatRate,
    vat,
    total,
    depositRate,
    depositDue,
    balanceDue: total - depositDue,
  };
}

function makeConfirmationNumber(venueId) {
  const prefix = cleanString(venueId).slice(0, 2).toUpperCase() || 'BK';
  const number = crypto.randomInt(1000, 10000);
  return `${prefix}-${number}-RW`;
}

function assertCanAccessBooking(booking, user) {
  if (user.role === 'admin') return;
  if (booking.userId === user.id) return;
  if (booking.ownerId === user.id) return;
  throw new HttpError(403, 'You can only access bookings connected to your account.');
}

function parseTimeToMinutes(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (!match) return 0;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3].toUpperCase();

  if (period === 'PM' && hours < 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;

  return hours * 60 + minutes;
}

function hasTimeOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function hasScheduleConflict(bookings, input, ignoreBookingId) {
  const requestedStart = parseTimeToMinutes(input.startTime);
  const requestedEnd = requestedStart + Number(input.durationHours || 0) * 60;

  return bookings.some((booking) => {
    if (booking.id === ignoreBookingId) return false;
    if (booking.venueId !== input.venueId) return false;
    if (booking.date !== input.date) return false;
    if (booking.status === 'cancelled') return false;

    const existingStart = parseTimeToMinutes(booking.startTime);
    const existingEnd = existingStart + Number(booking.durationHours || 0) * 60;
    return hasTimeOverlap(requestedStart, requestedEnd, existingStart, existingEnd);
  });
}

function parseCapacity(value) {
  const amount = Number(String(value || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(amount) ? amount : 0;
}

function parsePrice(value) {
  const amount = Number(String(value || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(amount) ? amount : 0;
}

async function findSimilarVenues(currentVenue, input, bookings) {
  const allVenues = await listVenues({}, { limit: 30, skip: 0 });
  const requestedCapacity = Number(input.guestCount || 0);
  const requestedProvince = currentVenue.province || '';
  const requestedCategory = currentVenue.category || '';

  return allVenues
    .filter((venue) => venue.id !== currentVenue.id)
    .filter((venue) => String(venue.status || '').toLowerCase() !== 'pending')
    .filter((venue) => parseCapacity(venue.capacity) >= requestedCapacity)
    .map((venue) => {
      let score = 0;
      if (venue.province === requestedProvince) score += 35;
      if (venue.category === requestedCategory) score += 25;
      if (String(venue.setting || '').toLowerCase().includes(String(currentVenue.setting || '').toLowerCase())) score += 15;
      if (parseCapacity(venue.capacity) >= requestedCapacity) score += 10;
      if (venue.rating && venue.rating !== 'New') score += 8;
      if (parsePrice(venue.price) <= parsePrice(currentVenue.price)) score += 7;

      const hasConflict = bookings.some((booking) => {
        if (booking.venueId !== venue.id || booking.date !== input.date || booking.status === 'cancelled') return false;
        const existingStart = parseTimeToMinutes(booking.startTime);
        const existingEnd = existingStart + Number(booking.durationHours || 0) * 60;
        const requestedStart = parseTimeToMinutes(input.startTime);
        const requestedEnd = requestedStart + Number(input.durationHours || 0) * 60;
        return hasTimeOverlap(requestedStart, requestedEnd, existingStart, existingEnd);
      });

      return { venue, score, hasConflict };
    })
    .filter((item) => !item.hasConflict)
    .sort((a, b) => b.score - a.score || parsePrice(a.venue.price) - parsePrice(b.venue.price))
    .slice(0, 4)
    .map(({ venue, score }) => ({
      id: venue.id,
      name: venue.name,
      location: venue.location,
      province: venue.province,
      category: venue.category,
      capacity: venue.capacity,
      price: venue.price,
      heroImage: venue.heroImage,
      score,
    }));
}

async function createBooking(input, user) {
  const venueId = cleanString(input.venueId);
  if (!venueId) throw new HttpError(400, 'Venue ID is required.');

  const venue = await getVenue(venueId);
  const bookings = await readCollection('bookings');
  const date = normalizeDate(input.date);
  const startTime = normalizeTime(input.startTime);
  const durationHours = normalizePositiveNumber(input.durationHours || input.duration, 'Duration', { min: 1, max: 24 });
  const guestCount = normalizePositiveNumber(input.guestCount || input.guests, 'Guest count', { min: 1 });
  const addons = normalizeVenueAddons(input.addons, venue);

  if (hasScheduleConflict(bookings, { venueId, date, startTime, durationHours })) {
    const suggestions = await findSimilarVenues(venue, { date, startTime, durationHours, guestCount }, bookings);
    throw new HttpError(409, 'This venue is already booked for the selected date and time. Here are similar venues you can try instead.', { suggestions });
  }

  const now = new Date().toISOString();
  const booking = {
    id: `book_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`,
    confirmationNumber: makeConfirmationNumber(venueId),
    userId: user.id,
    customerName: user.fullName,
    customerEmail: user.email,
    customerPhone: user.phone,
    ownerId: venue.ownerId || null,
    venueId,
    venueName: venue.name,
    venueLocation: venue.location,
    venueImage: venue.heroImage,
    date,
    startTime,
    durationHours,
    guestCount,
    addons,
    totals: calculateTotals(venue, addons),
    status: 'pending_deposit',
    paymentStatus: 'unpaid',
    notes: cleanString(input.notes),
    createdAt: now,
    updatedAt: now,
  };

  bookings.unshift(booking);
  await writeCollection('bookings', bookings);
  return booking;
}

async function listBookings(user) {
  const bookings = await readCollection('bookings');
  if (user.role === 'admin') return bookings;
  if (user.role === 'owner') {
    return bookings.filter((booking) => booking.ownerId === user.id || booking.userId === user.id);
  }
  return bookings.filter((booking) => booking.userId === user.id);
}

async function getBooking(id, user) {
  const bookings = await readCollection('bookings');
  const booking = bookings.find((item) => item.id === id || item.confirmationNumber === id);
  if (!booking) throw new HttpError(404, 'Booking not found.');
  if (user) assertCanAccessBooking(booking, user);
  return booking;
}

async function updateBooking(id, input, user) {
  const bookings = await readCollection('bookings');
  const index = bookings.findIndex((item) => item.id === id);
  if (index === -1) throw new HttpError(404, 'Booking not found.');
  assertCanAccessBooking(bookings[index], user);
  if (bookings[index].status === 'cancelled') {
    throw new HttpError(400, 'Cancelled bookings cannot be updated.');
  }

  const hasDuration = input.durationHours !== undefined || input.duration !== undefined;
  const hasGuestCount = input.guestCount !== undefined || input.guests !== undefined;

  const next = {
    ...bookings[index],
    date: input.date ? normalizeDate(input.date) : bookings[index].date,
    startTime: input.startTime ? normalizeTime(input.startTime) : bookings[index].startTime,
    durationHours: hasDuration
      ? normalizePositiveNumber(input.durationHours || input.duration, 'Duration', { min: 1, max: 24 })
      : bookings[index].durationHours,
    guestCount: hasGuestCount
      ? normalizePositiveNumber(input.guestCount || input.guests, 'Guest count', { min: 1 })
      : bookings[index].guestCount,
    notes: input.notes === undefined ? bookings[index].notes : cleanString(input.notes),
    updatedAt: new Date().toISOString(),
  };

  if (input.addons !== undefined) {
    const venue = await getVenue(next.venueId);
    next.addons = normalizeVenueAddons(input.addons, venue);
    next.totals = calculateTotals(venue, next.addons);
  }

  if (hasScheduleConflict(bookings, next, next.id)) {
    const suggestions = await findSimilarVenues(await getVenue(next.venueId), next, bookings);
    throw new HttpError(409, 'This venue is already booked for the selected date and time. Here are similar venues you can try instead.', { suggestions });
  }

  bookings[index] = next;
  await writeCollection('bookings', bookings);
  return next;
}

async function cancelBooking(id, user) {
  const bookings = await readCollection('bookings');
  const index = bookings.findIndex((item) => item.id === id);
  if (index === -1) throw new HttpError(404, 'Booking not found.');
  assertCanAccessBooking(bookings[index], user);

  bookings[index] = {
    ...bookings[index],
    status: 'cancelled',
    cancelledAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await writeCollection('bookings', bookings);
  return bookings[index];
}

async function markBookingPaid(id, payment) {
  if (!id) return null;

  const bookings = await readCollection('bookings');
  const index = bookings.findIndex((item) => item.id === id);
  if (index === -1) return null;

  const currentAmountPaid = Number(bookings[index].amountPaid || 0);
  const paymentAmount = Number(payment.amount || 0);
  const amountPaid = currentAmountPaid + (Number.isFinite(paymentAmount) ? paymentAmount : 0);
  const total = Number(bookings[index].totals?.total || 0);
  const isFullyPaid = total > 0 && amountPaid >= total;

  bookings[index] = {
    ...bookings[index],
    status: 'confirmed',
    paymentStatus: isFullyPaid ? 'paid' : 'deposit_paid',
    amountPaid,
    balanceRemaining: Math.max(total - amountPaid, 0),
    lastPaymentId: payment.id,
    lastPaidAt: payment.paidAt || new Date().toISOString(),
    depositPaymentId: bookings[index].depositPaymentId || payment.id,
    depositPaidAt: bookings[index].depositPaidAt || payment.paidAt || new Date().toISOString(),
    paidAt: isFullyPaid ? payment.paidAt || new Date().toISOString() : bookings[index].paidAt,
    updatedAt: new Date().toISOString(),
  };

  await writeCollection('bookings', bookings);
  return bookings[index];
}

async function getAvailability(venueId, month) {
  if (!venueId) throw new HttpError(400, 'Venue ID is required.');
  await getVenue(venueId);

  const normalizedMonth = cleanString(month);
  if (normalizedMonth && !/^\d{4}-\d{2}$/.test(normalizedMonth)) {
    throw new HttpError(400, 'Month must use YYYY-MM format.');
  }

  const bookings = await readCollection('bookings');
  const blocked = bookings
    .filter((booking) => booking.venueId === venueId)
    .filter((booking) => booking.status !== 'cancelled')
    .filter((booking) => !normalizedMonth || booking.date.startsWith(normalizedMonth))
    .map((booking) => ({
      date: booking.date,
      startTime: booking.startTime,
      durationHours: booking.durationHours,
      status: booking.status,
    }));

  return { venueId, month: normalizedMonth || null, blocked };
}

module.exports = {
  addonCatalog,
  cancelBooking,
  createBooking,
  getAvailability,
  getBooking,
  getVenueAddonCatalog,
  listBookings,
  markBookingPaid,
  updateBooking,
};
