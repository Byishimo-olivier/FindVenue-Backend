const axios = require('axios');
const { HttpError } = require('../utils/errors');

class PaypackProvider {
  constructor(config) {
    if (!config.clientId || !config.clientSecret) {
      throw new Error('Paypack client ID and secret are required');
    }

    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.apiUrl = String(config.apiUrl || 'https://payments.paypack.rw/api').replace(/\/+$/, '');
    this.environment = config.environment || 'development';
    this.testAmount = normalizeOptionalAmount(config.testAmount);
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
  }

  async getAccessToken() {
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const response = await axios.post(
        `${this.apiUrl}/auth/agents/authorize`,
        {
          client_id: this.clientId,
          client_secret: this.clientSecret,
        },
        {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
        }
      );

      this.accessToken = response.data.access;
      this.refreshToken = response.data.refresh;
      this.tokenExpiry = Date.now() + 14 * 60 * 1000;

      return this.accessToken;
    } catch (error) {
      const status = error.response?.status;
      const message =
        error.response?.data?.message ||
        error.response?.data?.error ||
        error.message;

      throw new HttpError(
        status === 401 || status === 403 ? status : 500,
        `Paypack authentication failed: ${message}. Check PAYPACK_CLIENT_ID/PAYPACK_CLIENT_SECRET and PAYPACK_API_URL.`
      );
    }
  }

  async getHeaders(idempotencyKey) {
    const token = await this.getAccessToken();
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Webhook-Mode': this.environment,
    };

    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey.slice(0, 32);
    }

    return headers;
  }

  async createCashin(paymentData) {
    const { amount, phoneNumber, orderId } = paymentData;
    const normalizedPhoneNumber = normalizeRwandaPhoneNumber(phoneNumber);
    const chargeAmount = normalizeRequiredAmount(amount);

    if (!phoneNumber) {
      throw new HttpError(400, 'Phone number is required for Paypack mobile payments.');
    }

    if (!normalizedPhoneNumber.match(/^07\d{8}$/)) {
      throw new HttpError(400, 'Use a valid Rwanda mobile money number, for example 078xxxxxxx.');
    }

    if (this.testAmount && chargeAmount !== this.testAmount) {
      throw new HttpError(
        400,
        `Paypack test mode only allows ${this.testAmount} RWF. Your payment amount is ${chargeAmount} RWF. Update PAYPACK_TEST_AMOUNT or remove it to charge the real booking amount.`
      );
    }

    try {
      const headers = await this.getHeaders(orderId);
      console.log('📱 Paypack Request:', {
        amount: chargeAmount,
        phoneNumber: normalizedPhoneNumber,
        orderId,
        environment: this.environment,
      });

      const response = await axios.post(
        `${this.apiUrl}/transactions/cashin`,
        {
          amount: chargeAmount,
          number: normalizedPhoneNumber,
        },
        { headers }
      );

      console.log('✅ Paypack Response:', response.data);

      return {
        provider: 'paypack',
        providerId: response.data.ref,
        status: response.data.status || 'pending',
        amount: response.data.amount || chargeAmount,
        currency: 'RWF',
        normalizedPhoneNumber,
        paypackResponse: response.data,
        requestedAmount: chargeAmount,
        chargedAmount: chargeAmount,
      };
    } catch (error) {
      console.error('❌ Paypack Error:', {
        status: error.response?.status,
        message: error.response?.data?.message || error.response?.data?.error || error.message,
        data: error.response?.data,
      });

      if (error instanceof HttpError) {
        throw error;
      }

      const status = error.response?.status;
      const message =
        error.response?.data?.message ||
        error.response?.data?.error ||
        error.message;
      throw new HttpError(status || 500, `Paypack cashin failed: ${message}`);
    }
  }

  async getTransaction(reference) {
    try {
      const headers = await this.getHeaders();
      const response = await axios.get(
        `${this.apiUrl}/transactions/find/${encodeURIComponent(reference)}`,
        { headers }
      );

      const transaction = response.data;
      const status = String(transaction.status || '').toLowerCase();

      return {
        status,
        transactionId: transaction.ref,
        amount: transaction.amount,
        currency: 'RWF',
        succeeded: status === 'success' || status === 'successful',
      };
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }

      const status = error.response?.status;
      const message =
        error.response?.data?.message ||
        error.response?.data?.error ||
        error.message;

      if (status === 404 && /not found/i.test(String(message))) {
        return {
          status: 'pending',
          transactionId: reference,
          currency: 'RWF',
          succeeded: false,
        };
      }

      throw new HttpError(status || 500, `Error retrieving Paypack transaction: ${message}`);
    }
  }
}

function normalizeRwandaPhoneNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');

  if (digits.startsWith('250') && digits.length === 12) {
    return `0${digits.slice(3)}`;
  }

  if (digits.length === 9 && digits.startsWith('7')) {
    return `0${digits}`;
  }

  return digits;
}

function normalizeOptionalAmount(value) {
  if (value === undefined || value === null || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function normalizeRequiredAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, 'Payment amount must be greater than zero.');
  }
  return amount;
}

module.exports = PaypackProvider;
