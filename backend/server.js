// Last updated: 2026-05-17 for live testing
const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config({ path: '../.env' }); // Load .env from root

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

// CORS Middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, access-token, client-id');
  next();
});

// Helper to get Dhan Headers
const getDhanHeaders = () => ({
  'Content-Type': 'application/json',
  'access-token': process.env.DHAN_ACCESS_TOKEN,
  'client-id': process.env.DHAN_CLIENT_ID
});

// Endpoint to get Option Chain
app.get('/api/option-chain', async (req, res) => {
  try {
    const token = process.env.DHAN_ACCESS_TOKEN;
    const clientId = process.env.DHAN_CLIENT_ID;

    if (!token || !clientId) {
      return res.status(400).json({ success: false, message: 'Dhan credentials missing in .env file' });
    }

    // 1. Get Expiry List for Nifty (Scrip 13, Segment IDX_I)
    const expiryResponse = await axios.post('https://api.dhan.co/v2/optionchain/expirylist', {
      UnderlyingScrip: 13,
      UnderlyingSeg: 'IDX_I'
    }, { headers: getDhanHeaders() });

    if (expiryResponse.data.status !== 'success' || !expiryResponse.data.data.length) {
      return res.status(400).json({ success: false, message: 'Failed to fetch expiry list' });
    }

    const latestExpiry = expiryResponse.data.data[0]; // Use the closest expiry

    // 2. Get Option Chain for that expiry
    const ocResponse = await axios.post('https://api.dhan.co/v2/optionchain', {
      UnderlyingScrip: 13,
      UnderlyingSeg: 'IDX_I',
      Expiry: latestExpiry
    }, { headers: getDhanHeaders() });

    if (ocResponse.data.status !== 'success') {
      return res.status(400).json({ success: false, message: 'Failed to fetch option chain' });
    }

    const rawData = ocResponse.data.data;
    const ocData = rawData.oc;
    const spotPrice = rawData.last_price;

    // 3. Transform object to sorted array for the frontend
    const strikesArray = Object.keys(ocData).map(strikeStr => {
      const strike = parseFloat(strikeStr);
      const data = ocData[strikeStr];
      return {
        strike,
        callOi: data.ce?.oi || 0,
        callChgOi: data.ce?.oi - data.ce?.previous_oi || 0, 
        callLtp: data.ce?.last_price || 0,
        callVolume: data.ce?.volume || 0,
        putVolume: data.pe?.volume || 0,
        putLtp: data.pe?.last_price || 0,
        putChgOi: data.pe?.oi - data.pe?.previous_oi || 0,
        putOi: data.pe?.oi || 0,
        updateStatus: null
      };
    }).sort((a, b) => a.strike - b.strike);

    res.json({ 
      success: true, 
      spotPrice,
      expiry: latestExpiry,
      data: strikesArray 
    });

  } catch (error) {
    console.error('Dhan API Error:', error.message);
    res.status(error.response?.status || 500).json({ 
      success: false, 
      message: error.message,
      details: error.response?.data
    });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
