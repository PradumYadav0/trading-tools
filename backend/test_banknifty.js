const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config({ path: '../.env' });

const getDhanHeaders = () => ({
  'Content-Type': 'application/json',
  'access-token': process.env.DHAN_ACCESS_TOKEN,
  'client-id': process.env.DHAN_CLIENT_ID
});

async function test() {
  console.log('Testing with Token:', process.env.DHAN_ACCESS_TOKEN ? 'Present' : 'Missing');
  console.log('Testing with Client ID:', process.env.DHAN_CLIENT_ID);
  
  try {
    console.log('Calling expirylist for BankNifty (25)...');
    const response = await axios.post('https://api.dhan.co/v2/optionchain/expirylist', {
      UnderlyingScrip: 25,
      UnderlyingSeg: 'IDX_I'
    }, { headers: getDhanHeaders() });
    console.log('Success!', response.data);
  } catch (error) {
    console.error('Error Status:', error.response?.status);
    console.error('Error Data:', error.response?.data);
  }
}

test();
