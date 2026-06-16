const axios = require('axios');
const { loadEnv } = require('../src/env');

loadEnv();

const key = process.env.PesaPal_Consumer_Key;
const secret = process.env.PesaPal_Consumer_Secret;

if (!key || !secret) {
  console.error('Missing key or secret in .env');
  process.exit(1);
}

const urls = [
  'https://cybqa.pesapal.com/pesapalv3',
  'https://pay.pesapal.com/v3'
];

async function run() {
  for (const api of urls) {
    console.log(`--- Testing URL: ${api} ---`);
    
    // Test JSON payload
    try {
      const response = await axios.post(`${api}/api/Auth/RequestToken`, {
        consumer_key: key,
        consumer_secret: secret
      }, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      console.log('JSON success! Status:', response.status, 'Response:', response.data);
    } catch (error) {
      console.log('JSON failed. Status:', error.response?.status, 'Response:', error.response?.data || error.message);
    }

    // Test URL-encoded Form payload
    try {
      const response = await axios.post(`${api}/api/Auth/RequestToken`, 
        new URLSearchParams({ consumer_key: key, consumer_secret: secret }).toString(), 
        {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );
      console.log('Form success! Status:', response.status, 'Response:', response.data);
    } catch (error) {
      console.log('Form failed. Status:', error.response?.status, 'Response:', error.response?.data || error.message);
    }
  }
}

run().catch(console.error);
