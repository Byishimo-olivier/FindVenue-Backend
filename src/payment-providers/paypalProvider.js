const axios = require('axios');
const { HttpError } = require('../utils/errors');

class PayPalProvider {
  constructor(config) {
    if (!config.clientId || !config.clientSecret) {
      throw new Error('PayPal Client ID and Secret are required');
    }

    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.callbackUrl = config.callbackUrl;
    this.mode = String(config.mode || 'sandbox').toLowerCase(); // 'sandbox' or 'live'
    this.baseUrl =
      this.mode === 'sandbox'
        ? 'https://api.sandbox.paypal.com'
        : 'https://api.paypal.com';
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Get access token from PayPal
   */
  async getAccessToken() {
    // Return cached token if still valid
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString(
        'base64'
      );

      const response = await axios.post(
        `${this.baseUrl}/v1/oauth2/token`,
        'grant_type=client_credentials',
        {
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      this.accessToken = response.data.access_token;
      // Token expires in ~3600 seconds, cache for 3500 seconds
      this.tokenExpiry = Date.now() + 3500000;

      return this.accessToken;
    } catch (error) {
      const status = error.response?.status;
      const paypalError = error.response?.data?.error_description || error.response?.data?.error;
      const modeHint =
        status === 401
          ? ` Check that PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET are PayPal REST ${this.mode} credentials and that PAYPAL_MODE matches them.`
          : '';
      throw new HttpError(
        status === 401 ? 401 : 500,
        `PayPal authentication failed${paypalError ? `: ${paypalError}` : `: ${error.message}`}.${modeHint}`
      );
    }
  }

  /**
   * Get authorization header with token
   */
  async getAuthHeader() {
    const token = await this.getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Create an order for payment
   */
  async createOrder(paymentData) {
    const { amount, currency, orderId, description, metadata } = paymentData;

    try {
      const headers = await this.getAuthHeader();

      const orderData = {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: orderId,
            amount: {
              currency_code: currency || 'USD',
              value: amount.toString(),
            },
            description,
          },
        ],
        application_context: {
          return_url: `${this.callbackUrl}?orderId=${orderId}&status=success`,
          cancel_url: `${this.callbackUrl}?orderId=${orderId}&status=cancel`,
          brand_name: 'Smart Event Venue',
          landing_page: 'BILLING',
        },
      };

      const response = await axios.post(
        `${this.baseUrl}/v2/checkout/orders`,
        orderData,
        { headers }
      );

      const approvalLink = response.data.links.find(
        (link) => link.rel === 'approve'
      );

      return {
        provider: 'paypal',
        providerId: response.data.id,
        redirectUrl: approvalLink?.href,
        status: 'pending',
        amount,
        currency,
      };
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }

      const errorMsg = error.response?.data?.details?.[0]?.issue || error.message;
      throw new HttpError(500, `PayPal order creation failed: ${errorMsg}`);
    }
  }

  /**
   * Capture an order (after user approval)
   */
  async captureOrder(orderId) {
    try {
      const headers = await this.getAuthHeader();

      const response = await axios.post(
        `${this.baseUrl}/v2/checkout/orders/${orderId}/capture`,
        {},
        { headers }
      );

      const captureStatus = response.data.status;
      const purchase = response.data.purchase_units?.[0];
      const capture = purchase?.payments?.captures?.[0];

      return {
        status: captureStatus,
        transactionId: capture?.id,
        amount: purchase?.amount?.value,
        currency: purchase?.amount?.currency_code,
        succeeded: captureStatus === 'COMPLETED',
      };
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }

      const errorMsg = error.response?.data?.details?.[0]?.issue || error.message;
      throw new HttpError(500, `PayPal order capture failed: ${errorMsg}`);
    }
  }

  /**
   * Get order details
   */
  async getOrderDetails(orderId) {
    try {
      const headers = await this.getAuthHeader();

      const response = await axios.get(
        `${this.baseUrl}/v2/checkout/orders/${orderId}`,
        { headers }
      );

      const purchase = response.data.purchase_units?.[0];
      const capture = purchase?.payments?.captures?.[0];

      return {
        status: response.data.status,
        transactionId: capture?.id,
        amount: purchase?.amount?.value,
        currency: purchase?.amount?.currency_code,
        succeeded: response.data.status === 'COMPLETED',
      };
    } catch (error) {
      throw new HttpError(500, `Error retrieving order details: ${error.message}`);
    }
  }

  /**
   * Refund a captured payment
   */
  async refundPayment(transactionId, amount = null) {
    try {
      const headers = await this.getAuthHeader();

      const refundData = {};
      if (amount) {
        refundData.amount = {
          value: amount.toString(),
          currency_code: 'USD', // Should be made dynamic
        };
      }

      const response = await axios.post(
        `${this.baseUrl}/v2/payments/captures/${transactionId}/refund`,
        refundData,
        { headers }
      );

      return {
        refundId: response.data.id,
        status: response.data.status,
        amount: response.data.amount?.value,
        links: response.data.links,
      };
    } catch (error) {
      const errorMsg = error.response?.data?.details?.[0]?.issue || error.message;
      throw new HttpError(500, `PayPal refund failed: ${errorMsg}`);
    }
  }
}

module.exports = PayPalProvider;
