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
    const toDateObj = new Date();
    toDateObj.setDate(toDateObj.getDate() + 1);
    const fromDateObj = new Date();
    fromDateObj.setDate(fromDateObj.getDate() - 2);
    
    const formatDateWithTime = (d) => `${d.toISOString().split('T')[0]} 00:00:00`;

    const payload = {
      securityId: "13", // Nifty
      exchangeSegment: 'IDX_I',
      instrument: 'INDEX',
      interval: 5,
      fromDate: formatDateWithTime(fromDateObj),
      toDate: formatDateWithTime(toDateObj)
    };
    
    const response = await axios.post('https://api.dhan.co/v2/charts/intraday', payload, {
      headers: getDhanHeaders()
    });
    
    const data = response.data.data || response.data;
    console.log('First 5 timestamps:', data.timestamp?.slice(0, 5));
    console.log('Type of first timestamp:', typeof data.timestamp?.[0]);
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.log('Error Data:', error.response.data);
    }
  }
}

test();
