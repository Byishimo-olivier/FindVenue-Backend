const crypto = require('crypto');
const { readCollection, writeCollection } = require('../db/mongoStore');
const { HttpError } = require('../utils/errors');
const { cleanString } = require('../utils/validators');
const { getBooking, markBookingPaid } = require('./bookingService');
const { getVenue } = require('./venueService');

function normalizeAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, 'Payment amount must be greater than zero.');
  }
  return amount;
}

function normalizeBookingPaymentAmount(inputAmount, booking) {
  const requestedAmount = normalizeAmount(inputAmount || booking?.totals?.depositDue);
  if (!booking) return requestedAmount;

  const depositDue = Number(booking.totals?.depositDue || 0);
  const total = Number(booking.totals?.total || 0);
  const allowedAmounts = [depositDue, total].filter((amount) => amount > 0);

  if (!allowedAmounts.includes(requestedAmount)) {
    throw new HttpError(400, 'Payment amount must match the deposit or full booking total.');
  }

  return requestedAmount;
}

async function createPaymentIntent(input, user) {
  let bookingId = cleanString(input.bookingId);
  let booking = null;
  let venueId = cleanString(input.venueId);

  if (bookingId) {
    booking = await getBooking(bookingId, user);
    bookingId = booking.id;
    venueId = booking.venueId;
  }

  if (!venueId) throw new HttpError(400, 'Venue ID is required.');
  await getVenue(venueId);

  const payments = await readCollection('payments');
  const payment = {
    id: `pay_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`,
    userId: user.id,
    venueId,
    bookingId: bookingId || null,
    amount: normalizeBookingPaymentAmount(input.amount, booking),
    currency: cleanString(input.currency || 'RWF'),
    method: cleanString(input.method || 'card'),
    status: 'requires_confirmation',
    provider: 'mock',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  payments.unshift(payment);
  await writeCollection('payments', payments);
  return payment;
}

async function confirmPayment(paymentId, user) {
  const payments = await readCollection('payments');
  const index = payments.findIndex((payment) => payment.id === paymentId);
  if (index === -1) throw new HttpError(404, 'Payment not found.');
  if (payments[index].userId !== user.id && user.role !== 'admin') {
    throw new HttpError(403, 'You can only confirm your own payments.');
  }

  payments[index] = {
    ...payments[index],
    status: 'paid',
    paidAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await writeCollection('payments', payments);
  if (payments[index].bookingId) {
    await markBookingPaid(payments[index].bookingId, payments[index]);
  }
  return payments[index];
}

async function listPayments(user) {
  const payments = await readCollection('payments');
  if (user.role === 'admin') return payments;
  return payments.filter((payment) => payment.userId === user.id);
}

module.exports = { confirmPayment, createPaymentIntent, listPayments };
