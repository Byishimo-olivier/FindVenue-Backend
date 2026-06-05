const axios = require('axios');
const { HttpError } = require('../utils/errors');

class PesaPalProvider {
  constructor(config) {
    if (!config.consumerKey || !config.consumerSecret) {
      throw new Error('PesaPal consumer key and consumer secret are required');
    }

    this.consumerKey = config.consumerKey;
    this.consumerSecret = config.consumerSecret;
    this.applicationId = config.applicationId || '';
    this.callbackUrl = config.callbackUrl;
    this.apiUrl = normalizePesaPalApiUrl(config.apiUrl);
    this.notificationId = config.notificationId || '';
    this.authToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Get authentication token from PesaPal
   * @returns {Promise<string>} auth token
   */
  async getAuthToken() {
    // Return cached token if still valid
    if (this.authToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.authToken;
    }

    try {
      // Avoid logging secrets directly. Log masked consumer key and API URL for debugging.
      const maskedKey = String(this.consumerKey || '').replace(/(.{4}).+(.{4})/, '$1....$2');
      console.info(`PesaPal auth request -> apiUrl=${this.apiUrl}, consumerKey=${maskedKey}`);

      const payload = {
        consumer_key: this.consumerKey,
        consumer_secret: this.consumerSecret,
      };

      const response = await axios.post(
        `${this.apiUrl}/api/Auth/RequestToken`,
        payload,
        {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.data?.error) {
        console.error('PesaPal auth response contained error', {
          status: response.status,
          errorCode: response.data.error.code,
          errorMessage: response.data.error.message,
          dataSnippet: JSON.stringify(response.data).slice(0, 300),
        });
      }

      this.authToken =
        response.data?.token ||
        response.data?.access_token ||
        response.data?.oauth_token ||
        response.data?.accessToken;

      if (!this.authToken) {
        console.error('PesaPal auth response missing token', { status: response.status, dataSnippet: String(response.data).slice(0, 200) });
        throw new Error(getPesaPalErrorMessage({ response }));
      }

      // Token expires in ~3600 seconds, cache for 3500 seconds
      this.tokenExpiry = Date.now() + 3500000;

      return this.authToken;
    } catch (error) {
      // Log response status and a small snippet for diagnostics (do not log secrets)
      const respStatus = error.response?.status;
      const respDataSnippet = String(error.response?.data || error.message).slice(0, 300);
      console.error('PesaPal auth failed', { status: respStatus, dataSnippet: respDataSnippet });
      const message = getPesaPalErrorMessage(error);
      throw new HttpError(respStatus || 500, `PesaPal authentication failed: ${message}`);
    }
  }

  /**
   * Get authorization header with token
   * @returns {Promise<Object>} header object
   */
  async getAuthHeader() {
    const token = await this.getAuthToken();
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  async getNotificationId() {
    if (this.notificationId) return this.notificationId;

    if (!this.callbackUrl) {
      throw new HttpError(500, 'PesaPal callback URL is required.');
    }

    try {
      const headers = await this.getAuthHeader();
      const response = await axios.post(
        `${this.apiUrl}/api/URLSetup/RegisterIPN`,
        {
          url: this.callbackUrl,
          ipn_notification_type: 'POST',
        },
        { headers }
      );

      this.notificationId = response.data.ipn_id || response.data.ipnId || '';
      if (!this.notificationId) {
        throw new Error('PesaPal did not return an IPN notification id.');
      }

      return this.notificationId;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const message = getPesaPalErrorMessage(error);
      throw new HttpError(
        error.response?.status || 500,
        `PesaPal IPN registration failed: ${message}. Use a public callback URL and set PesaPal_Notification_ID if you already registered one.`
      );
    }
  }

  /**
   * Create an order/payment request
   * @param {Object} paymentData
   * @returns {Promise<Object>} order details
   */
  async createPaymentOrder(paymentData) {
    const {
      amount,
      currency,
      orderId,
      customerEmail,
      customerPhone,
      description,
      metadata,
    } = paymentData;

    try {
      const headers = await this.getAuthHeader();
      const notificationId = await this.getNotificationId();

      const orderData = {
        id: orderId,
        currency: currency || 'RWF',
        amount,
        description,
        callback_url: this.callbackUrl,
        notification_id: notificationId,
        redirect_mode: 'TOP_WINDOW',
        billing_address: {
          email_address: customerEmail,
          phone_number: customerPhone,
        },
      };

      const response = await axios.post(
        `${this.apiUrl}/api/Transactions/SubmitOrderRequest`,
        orderData,
        { headers }
      );

      return {
        provider: 'pesapal',
        providerId: response.data.order_tracking_id || response.data.order_id,
        redirectUrl: response.data.redirect_url || response.data.redirectUrl,
        message: response.data.message,
        error: response.data.error,
        rawResponse: response.data,
        status: 'pending',
        amount,
        currency,
      };
    } catch (error) {
      const respStatus = error.response?.status;
      const respDataSnippet = String(error.response?.data || error.message).slice(0, 500);
      console.error('PesaPal SubmitOrderRequest failed', { status: respStatus, dataSnippet: respDataSnippet });
      const errorMsg = getPesaPalErrorMessage(error);
      throw new HttpError(respStatus || 500, `PesaPal order creation failed: ${errorMsg}`);
    }
  }

  /**
   * Check payment status
   * @param {string} orderId
   * @returns {Promise<Object>} payment status
   */
  async getPaymentStatus(orderId) {
    try {
      const headers = await this.getAuthHeader();

      const response = await axios.get(
        `${this.apiUrl}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderId)}`,
        { headers }
      );

      if (response.data) {
        const transaction = response.data;
        const status = transaction.payment_status_description || transaction.status;
        return {
          status,
          amount: transaction.amount,
          currency: transaction.currency,
          succeeded: status === 'Completed' || status === 'COMPLETED',
          transactionId: transaction.id,
          reference: transaction.reference,
        };
      }

      return {
        status: 'pending',
        succeeded: false,
      };
    } catch (error) {
      throw new HttpError(500, `Error retrieving payment status: ${error.message}`);
    }
  }

  /**
   * Refund a payment
   * @param {string} transactionId
   * @param {number} amount - Optional: amount to refund
   * @returns {Promise<Object>} refund details
   */
  async refundPayment(transactionId, amount = null) {
    try {
      const headers = await this.getAuthHeader();

      const refundData = {
        transaction_id: transactionId,
      };

      if (amount) {
        refundData.amount = amount;
      }

      const response = await axios.post(
        `${this.apiUrl}/api/transactions/refund`,
        refundData,
        { headers }
      );

      return {
        refundId: response.data.id,
        status: response.data.status,
        amount: response.data.amount,
        message: response.data.message,
      };
    } catch (error) {
      const errorMsg = error.response?.data?.message || error.message;
      throw new HttpError(500, `Refund failed: ${errorMsg}`);
    }
  }

  /**
   * Validate webhook signature (for callback verification)
   * @param {Object} data
   * @param {string} signature
   * @returns {boolean}
   */
  validateWebhookSignature(data, signature) {
    // PesaPal webhook validation would go here
    // For now, basic validation
    return true;
  }
}

function normalizePesaPalApiUrl(value) {
  const apiUrl = String(value || 'https://pay.pesapal.com/v3').trim().replace(/^['"]|['"]$/g, '').replace(/\/+$/, '');

  if (!apiUrl) return 'https://pay.pesapal.com/v3';
  if (/cybqa\.pesapal\.com/i.test(apiUrl)) return 'https://cybqa.pesapal.com/pesapalv3';
  if (/\/v3$/i.test(apiUrl)) return apiUrl;
  if (/\/pesapalv3$/i.test(apiUrl)) return apiUrl;

  return 'https://pay.pesapal.com/v3';
}

function getPesaPalErrorMessage(error) {
  const data = error.response?.data;
  const status = error.response?.status;
  if (typeof data === 'string' && data.trim()) {
    if (status === 401 || /<html[\s>]/i.test(data) || /401\s*-\s*Unauthorized/i.test(data)) {
      return `PesaPal returned 401 Unauthorized. Check your PesaPal credentials and API URL. Sandbox should use https://cybqa.pesapal.com/pesapalv3 and live should use https://pay.pesapal.com/v3.`;
    }

    return data.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  if (data?.error) {
    const code = data.error.code || data.error.error_type || '';
    const message = data.error.message || data.error.error || '';
    return [code, message].filter(Boolean).join(': ') || JSON.stringify(data.error);
  }

  if (data?.message) return data.message;
  if (data?.error && typeof data.error === 'string') return data.error;
  return error.message;
}

module.exports = PesaPalProvider;
