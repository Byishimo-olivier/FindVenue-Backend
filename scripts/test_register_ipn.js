const axios = require('axios');
const { loadEnv } = require('../src/env');

loadEnv();

const key = process.env.PesaPal_Consumer_Key;
const secret = process.env.PesaPal_Consumer_Secret;
const callbackUrl = process.env.PesaPal_Callback_URL;

if (!key || !secret || !callbackUrl) {
  console.error('Missing key, secret, or callback URL in .env');
  process.exit(1);
}

const api = 'https://pay.pesapal.com/v3';

async function run() {
  try {
    // 1. Get token
    const authRes = await axios.post(`${api}/api/Auth/RequestToken`, {
      consumer_key: key,
      consumer_secret: secret
    }, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    const token = authRes.data.token;
    console.log('Token obtained successfully.');

    // 2. Register IPN
    console.log(`Attempting to register IPN for URL: ${callbackUrl}`);
    const ipnRes = await axios.post(`${api}/api/URLSetup/RegisterIPN`, {
      url: callbackUrl,
      ipn_notification_type: 'POST'
    }, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    console.log('IPN Registration Success! Response:', ipnRes.data);
  } catch (error) {
    console.error('IPN Registration Failed.');
    console.error('Status:', error.response?.status);
    console.error('Response:', error.response?.data || error.message);
  }
}

run().catch(console.error);
