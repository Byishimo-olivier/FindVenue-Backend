const axios = require('axios');
const { loadEnv } = require('../src/env');

loadEnv();

const api = process.env.PesaPal_API_URL || process.env.PESAPAL_API_URL;
const key = process.env.PesaPal_Consumer_Key;
const secret = process.env.PesaPal_Consumer_Secret;

async function run() {
  if (!api) {
    console.error('Missing PesaPal API URL');
    process.exit(1);
  }
  if (!key || !secret) {
    console.error('Missing PesaPal key or secret');
    process.exit(1);
  }

  const tests = [
    {
      type: 'json',
      body: { consumer_key: key, consumer_secret: secret },
      headers: { 'Content-Type': 'application/json' },
    },
    {
      type: 'form',
      body: new URLSearchParams({ consumer_key: key, consumer_secret: secret }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
  ];

  for (const test of tests) {
    try {
      const response = await axios.post(`${api}/api/Auth/RequestToken`, test.body, {
        headers: { Accept: 'application/json', ...test.headers },
      });
      console.log('RESULT', test.type, response.status, response.data);
    } catch (error) {
      console.error('ERROR', test.type, error.response?.status, error.response?.data || error.message);
    }
  }
}

run().catch((err) => {
  console.error('Unexpected error', err);
  process.exit(1);
});