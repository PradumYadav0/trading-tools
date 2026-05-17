const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

const getDhanHeaders = () => ({
  'Content-Type': 'application/json',
  'access-token': process.env.DHAN_ACCESS_TOKEN,
  'client-id': process.env.DHAN_CLIENT_ID
});

async function test() {
  try {
    const payload = {
      securityId: "13", // Nifty
      exchangeSegment: 'IDX_I',
      instrument: 'INDEX',
      interval: '5',
      fromDate: '2026-05-12',
      toDate: '2026-05-18'
    };
    
    const response = await axios.post('https://api.dhan.co/v2/charts/intraday', payload, {
      headers: getDhanHeaders()
    });
    
    const data = response.data.data || response.data;
    console.log('First 5 timestamps:', data.timestamp?.slice(0, 5));
    console.log('Type of first timestamp:', typeof data.timestamp?.[0]);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

test();
