const crypto = require('crypto');
const { readCollection, writeCollection } = require('../db/mongoStore');
const { HttpError } = require('../utils/errors');
const { cleanString } = require('../utils/validators');
const { getBooking, markBookingPaid } = require('./bookingService');
const { sendBookingConfirmation } = require('./emailService');
const { getVenue } = require('./venueService');
const PesaPalProvider = require('../payment-providers/pesapalProvider');
const PaypackProvider = require('../payment-providers/paypackProvider');

// Initialize payment providers
let pesapalProvider;
let paypackProvider;

function initializeProviders() {
  // PesaPal for card payments
  if (
    process.env.PesaPal_Consumer_Key &&
    process.env.PesaPal_Consumer_Secret
  ) {
    pesapalProvider = new PesaPalProvider({
      consumerKey: process.env.PesaPal_Consumer_Key,
      consumerSecret: process.env.PesaPal_Consumer_Secret,
      applicationId: process.env.APPLICATION_ID,
      callbackUrl: process.env.PesaPal_Callback_URL || 'http://localhost:4000/api/payments/webhook/pesapal',
      apiUrl: process.env.PesaPal_API_URL || process.env.PESAPAL_API_URL,
      notificationId: process.env.PesaPal_Notification_ID || process.env.PESAPAL_NOTIFICATION_ID,
    });
  }

  const paypackClientId = process.env.PAYPACK_CLIENT_ID || process.env.PAYPAL_CLIENT_ID;
  const paypackClientSecret =
    process.env.PAYPACK_CLIENT_SECRET || process.env.PAYPAL_CLIENT_SECRET;

  // Paypack for Rwanda mobile money payments.
  if (paypackClientId && paypackClientSecret) {
    paypackProvider = new PaypackProvider({
      clientId: paypackClientId,
      clientSecret: paypackClientSecret,
      apiUrl: process.env.PAYPACK_API_URL || 'https://payments.paypack.rw/api',
      environment: process.env.PAYPACK_ENV || process.env.NODE_ENV || 'development',
      testAmount:
        process.env.NODE_ENV === 'production'
          ? null
          : process.env.PAYPACK_TEST_AMOUNT,
    });
  }
}

// Initialize on module load
initializeProviders();

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

/**
 * Create payment intent with real payment provider
 */
async function createPaymentIntent(input, user) {
  let bookingId = cleanString(input.bookingId);
  let booking = null;
  let venueId = cleanString(input.venueId);
  const method = cleanString(input.method || 'card');
  const currency = cleanString(input.currency || 'RWF');

  if (bookingId) {
    booking = await getBooking(bookingId, user);
    bookingId = booking.id;
    venueId = booking.venueId;
  }

  if (!venueId) throw new HttpError(400, 'Venue ID is required.');
  await getVenue(venueId);

  const amount = normalizeBookingPaymentAmount(input.amount, booking);
  const payments = await readCollection('payments');

  const paymentRecord = {
    id: `pay_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`,
    userId: user.id,
    venueId,
    bookingId: bookingId || null,
    amount,
    currency,
    method,
    status: 'requires_confirmation',
    provider: null,
    providerId: null,
    providerData: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  let providerResult = null;

  // Route to appropriate payment provider based on method
  if (method === 'card') {
    // Use PesaPal for card payments
    if (!pesapalProvider) {
      throw new HttpError(500, 'Card payment provider (PesaPal) is not configured.');
    }

    providerResult = await pesapalProvider.createPaymentOrder({
      amount,
      currency,
      orderId: paymentRecord.id,
      customerEmail: user.email,
      customerPhone: input.phoneNumber,
      description: `Venue booking - ${venueId}`,
    });

    paymentRecord.provider = 'pesapal';
    paymentRecord.providerId = providerResult.providerId;
    paymentRecord.providerData = {
      redirectUrl: providerResult.redirectUrl,
    };
  } else if (method === 'phone' || method === 'mobile') {
    // Use Paypack for Rwanda mobile money payments.
    if (!paypackProvider) {
      throw new HttpError(500, 'Mobile payment provider (Paypack) is not configured.');
    }

    providerResult = await paypackProvider.createCashin({
      amount,
      currency,
      orderId: paymentRecord.id,
      phoneNumber: input.phoneNumber,
    });

    paymentRecord.provider = 'paypack';
    paymentRecord.providerId = providerResult.providerId;
    paymentRecord.providerData = {
      phoneNumber: input.phoneNumber,
      normalizedPhoneNumber: providerResult.normalizedPhoneNumber,
      paypackStatus: providerResult.status,
      paypackResponse: providerResult.paypackResponse,
      requestedAmount: providerResult.requestedAmount,
      chargedAmount: providerResult.chargedAmount,
    };
  } else {
    throw new HttpError(400, 'Unsupported payment method. Use "card" or "phone".');
  }

  payments.unshift(paymentRecord);
  await writeCollection('payments', payments);

  return {
    id: paymentRecord.id,
    provider: paymentRecord.provider,
    providerId: paymentRecord.providerId,
    amount,
    currency,
    method,
    status: 'requires_confirmation',
    redirectUrl: providerResult.redirectUrl,
    createdAt: paymentRecord.createdAt,
  };
}

/**
 * Confirm payment (handles webhooks and callback confirmations)
 */
async function confirmPayment(paymentId, confirmationData, user) {
  const payments = await readCollection('payments');
  const index = payments.findIndex((payment) => payment.id === paymentId);
  if (index === -1) throw new HttpError(404, 'Payment not found.');

  const payment = payments[index];

  if (payment.userId !== user.id && user.role !== 'admin') {
    throw new HttpError(403, 'You can only confirm your own payments.');
  }

  if (payment.status === 'paid') {
    throw new HttpError(400, 'This payment has already been confirmed.');
  }

  try {
    let confirmationResult = null;

    // Handle confirmation based on provider
    if (payment.provider === 'pesapal') {
      if (!pesapalProvider) {
        throw new HttpError(500, 'PesaPal provider is not configured.');
      }

      confirmationResult = await pesapalProvider.getPaymentStatus(payment.providerId);

      if (!confirmationResult.succeeded) {
        throw new HttpError(400, 'Payment not yet confirmed. Please check PesaPal.');
      }
    } else if (payment.provider === 'paypack') {
      if (!paypackProvider) {
        throw new HttpError(500, 'Paypack provider is not configured.');
      }

      confirmationResult = await paypackProvider.getTransaction(payment.providerId);

      if (!confirmationResult.succeeded) {
        return {
          id: payment.id,
          status: payment.status,
          amount: payment.amount,
          currency: payment.currency,
          provider: payment.provider,
          providerId: payment.providerId,
          message: 'Payment is still pending. Please approve the mobile money prompt, then check again.',
        };
      }
    } else {
      throw new HttpError(500, 'Unknown payment provider.');
    }

    // Mark payment as paid
    payments[index] = {
      ...payment,
      status: 'paid',
      paidAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await writeCollection('payments', payments);

    // Mark booking as paid if applicable
    if (payment.bookingId) {
      const booking = await markBookingPaid(payment.bookingId, payments[index]);
      if (booking) {
        const venue = await getVenue(booking.venueId);
        const users = await readCollection('users');
        const owner = users.find((item) => item.id === venue.ownerId);
        await sendBookingConfirmation({
          booking,
          venue: {
            ...venue,
            contactPerson: venue.contactPerson || owner?.fullName,
            email: venue.email || owner?.email,
          },
        });
      }
    }

    return {
      id: payments[index].id,
      status: 'paid',
      amount: payment.amount,
      currency: payment.currency,
      paidAt: payments[index].paidAt,
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Handle webhook callbacks from payment providers
 */
async function handlePaymentWebhook(provider, webhookData, signature = null) {
  const payments = await readCollection('payments');

  if (provider === 'pesapal') {
    if (!pesapalProvider) {
      throw new HttpError(500, 'PesaPal provider is not configured.');
    }

    // Validate webhook signature if provided
    if (signature) {
      const isValid = pesapalProvider.validateWebhookSignature(webhookData, signature);
      if (!isValid) {
        throw new HttpError(401, 'Invalid webhook signature.');
      }
    }

    // Update payment status based on webhook data
    const orderRef = webhookData.order_id || webhookData.OrderId;
    const paymentIndex = payments.findIndex((p) => p.providerId === orderRef);

    if (paymentIndex !== -1) {
      const transactionStatus = webhookData.transaction_status || webhookData.status;

      if (transactionStatus === 'COMPLETED' || transactionStatus === 'completed') {
        payments[paymentIndex] = {
          ...payments[paymentIndex],
          status: 'paid',
          paidAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await writeCollection('payments', payments);

        // Mark booking as paid
        if (payments[paymentIndex].bookingId) {
          const booking = await markBookingPaid(
            payments[paymentIndex].bookingId,
            payments[paymentIndex]
          );
          if (booking) {
            const venue = await getVenue(booking.venueId);
            const users = await readCollection('users');
            const owner = users.find((item) => item.id === venue.ownerId);
            await sendBookingConfirmation({
              booking,
              venue: {
                ...venue,
                contactPerson: venue.contactPerson || owner?.fullName,
                email: venue.email || owner?.email,
              },
            });
          }
        }
      }
    }
  } else if (provider === 'paypack') {
    if (!paypackProvider) {
      throw new HttpError(500, 'Paypack provider is not configured.');
    }

    const eventType = webhookData.event_kind || webhookData['event-kind'];
    const transaction = webhookData.data || webhookData;
    const status = String(transaction.status || '').toLowerCase();

    if (eventType === 'transaction:processed') {
      const paymentIndex = payments.findIndex((p) => p.providerId === transaction.ref);

      if (paymentIndex !== -1) {
        if (status === 'success' || status === 'successful') {
          payments[paymentIndex] = {
            ...payments[paymentIndex],
            status: 'paid',
            paidAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          await writeCollection('payments', payments);

          // Mark booking as paid
          if (payments[paymentIndex].bookingId) {
            const booking = await markBookingPaid(
              payments[paymentIndex].bookingId,
              payments[paymentIndex]
            );
            if (booking) {
              const venue = await getVenue(booking.venueId);
              const users = await readCollection('users');
              const owner = users.find((item) => item.id === venue.ownerId);
              await sendBookingConfirmation({
                booking,
                venue: {
                  ...venue,
                  contactPerson: venue.contactPerson || owner?.fullName,
                  email: venue.email || owner?.email,
                },
              });
            }
          }
        }
      }
    }
  }
}

/**
 * Get payment status
 */
async function getPaymentStatus(paymentId, user) {
  const payments = await readCollection('payments');
  const payment = payments.find((p) => p.id === paymentId || p.providerId === paymentId);

  if (!payment) {
    throw new HttpError(404, 'Payment not found.');
  }

  if (payment.userId !== user.id && user.role !== 'admin') {
    throw new HttpError(403, 'You can only view your own payments.');
  }

  // Get status from provider if pending
  if (payment.status === 'requires_confirmation') {
    if (payment.provider === 'pesapal' && pesapalProvider) {
      try {
        const status = await pesapalProvider.getPaymentStatus(payment.providerId);
        if (status.succeeded) {
          payment.status = 'paid';
          payment.paidAt = new Date().toISOString();
          const index = payments.findIndex((p) => p.id === paymentId);
          payments[index] = payment;
          await writeCollection('payments', payments);
        }
      } catch (error) {
        // If we can't get status, return current status
      }
    } else if (payment.provider === 'paypack' && paypackProvider) {
      try {
        const status = await paypackProvider.getTransaction(payment.providerId);
        if (status.succeeded) {
          payment.status = 'paid';
          payment.paidAt = new Date().toISOString();
          const index = payments.findIndex((p) => p.id === paymentId);
          payments[index] = payment;
          await writeCollection('payments', payments);
        }
      } catch (error) {
        // If we can't get status, return current status
      }
    }
  }

  return payment;
}

async function listPayments(user) {
  const payments = await readCollection('payments');
  if (user.role === 'admin') return payments;
  return payments.filter((payment) => payment.userId === user.id);
}

module.exports = {
  confirmPayment,
  createPaymentIntent,
  listPayments,
  handlePaymentWebhook,
  getPaymentStatus,
};
