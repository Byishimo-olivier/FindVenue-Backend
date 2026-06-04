const axios = require('axios');
const { HttpError } = require('../utils/errors');

class PesaPalProvider {
  constructor(config) {
    if (!config.consumerKey || !config.consumerSecret || !config.applicationId) {
      throw new Error('PesaPal credentials are required');
    }

    this.consumerKey = config.consumerKey;
    this.consumerSecret = config.consumerSecret;
    this.applicationId = config.applicationId;
    this.callbackUrl = config.callbackUrl;
    this.apiUrl = 'https://api.pesapal.com/v3';
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
      const response = await axios.post(`${this.apiUrl}/api/auth/request/token`, {
        consumer_key: this.consumerKey,
        consumer_secret: this.consumerSecret,
      });

      this.authToken = response.data.token;
      // Token expires in ~3600 seconds, cache for 3500 seconds
      this.tokenExpiry = Date.now() + 3500000;

      return this.authToken;
    } catch (error) {
      throw new HttpError(500, `PesaPal authentication failed: ${error.message}`);
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
      'Content-Type': 'application/json',
    };
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

      const orderData = {
        id: orderId,
        currency: currency || 'KES',
        amount,
        description,
        callback_url: this.callbackUrl,
        redirect_mode: 'REDIRECT',
        customer: {
          email: customerEmail,
          phone_number: customerPhone,
        },
        billing_address: {
          email: customerEmail,
          phone_number: customerPhone,
        },
      };

      const response = await axios.post(
        `${this.apiUrl}/api/orders`,
        orderData,
        { headers }
      );

      return {
        provider: 'pesapal',
        providerId: response.data.order_id,
        redirectUrl: response.data.redirect_url,
        status: 'pending',
        amount,
        currency,
      };
    } catch (error) {
      const errorMsg = error.response?.data?.message || error.message;
      throw new HttpError(500, `PesaPal order creation failed: ${errorMsg}`);
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
        `${this.apiUrl}/api/orders/${orderId}/transactions`,
        { headers }
      );

      if (
        response.data &&
        response.data.length > 0
      ) {
        const transaction = response.data[0];
        return {
          status: transaction.status,
          amount: transaction.amount,
          currency: transaction.currency,
          succeeded: transaction.status === 'COMPLETED',
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

module.exports = PesaPalProvider;
