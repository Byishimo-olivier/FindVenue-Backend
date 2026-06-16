const { loadEnv } = require('../src/env');
const PesaPalProvider = require('../src/payment-providers/pesapalProvider');

loadEnv();

const key = process.env.PesaPal_Consumer_Key;
const secret = process.env.PesaPal_Consumer_Secret;
const callbackUrl = process.env.PesaPal_Callback_URL;

if (!key || !secret || !callbackUrl) {
  console.error('Missing credentials');
  process.exit(1);
}

const provider = new PesaPalProvider({
  consumerKey: key,
  consumerSecret: secret,
  callbackUrl: callbackUrl,
  apiUrl: 'https://pay.pesapal.com/v3'
});

async function run() {
  try {
    console.log('Testing createPaymentOrder...');
    const result = await provider.createPaymentOrder({
      amount: 1000,
      currency: 'RWF',
      orderId: 'test_order_' + Date.now(),
      customerEmail: 'test@example.com',
      customerPhone: '0788888888',
      description: 'Test PesaPal Card Payment'
    });

    console.log('Order creation success!', result);
  } catch (error) {
    console.error('Order creation failed:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
  }
}

run().catch(console.error);
