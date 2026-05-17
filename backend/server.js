const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const sqlite3 = require('sqlite3').verbose();
const { authenticator } = require('otplib');

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

// Global state for token
let dhanAccessToken = process.env.DHAN_ACCESS_TOKEN;

// Helper to get Dhan Headers
const getDhanHeaders = () => ({
  'Content-Type': 'application/json',
  'access-token': dhanAccessToken,
  'client-id': process.env.DHAN_CLIENT_ID
});

// Function to refresh Dhan Token automatically
const refreshDhanToken = async () => {
  const secret = process.env.DHAN_TOTP_SECRET;
  const pin = process.env.DHAN_PIN;
  const clientId = process.env.DHAN_CLIENT_ID;

  if (!secret || !pin || pin === 'xxxx') {
    console.log('Auto token refresh skipped: DHAN_TOTP_SECRET or DHAN_PIN not set in .env');
    return;
  }

  try {
    const totp = authenticator.generate(secret);
    console.log(`[${new Date().toLocaleTimeString()}] Generating new Dhan token with TOTP...`);
    
    const url = `https://auth.dhan.co/app/generateAccessToken?dhanClientId=${clientId}&pin=${pin}&totp=${totp}`;
    const response = await axios.post(url);
    
    // Dhan response usually contains the token directly or in data
    if (response.data && (response.data.access_token || response.data.data?.access_token)) {
      dhanAccessToken = response.data.access_token || response.data.data.access_token;
      console.log('Dhan Access Token refreshed successfully!');
    } else {
      console.error('Failed to refresh Dhan token. Response:', response.data);
    }
  } catch (error) {
    console.error('Error refreshing Dhan token:', error.message);
    if (error.response) {
      console.error('Error response from Dhan:', error.response.data);
    }
  }
};

// Refresh on startup
refreshDhanToken();

// Refresh every 23 hours to be safe
setInterval(refreshDhanToken, 23 * 60 * 60 * 1000);

// Initialize SQLite Database
const db = new sqlite3.Database('./option_chain.db', (err) => {
  if (err) {
    console.error('Database opening error:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    db.run(`CREATE TABLE IF NOT EXISTS option_chain_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      spot_price REAL,
      expiry TEXT,
      data TEXT
    )`);
  }
});

// Scrip Mapping for Indices
const scripMap = {
  'NIFTY': 13,
  'BANKNIFTY': 25
};

// Endpoint to get Option Chain
app.get('/api/option-chain', async (req, res) => {
  try {
    const token = dhanAccessToken;
    const clientId = process.env.DHAN_CLIENT_ID;
    const symbol = req.query.symbol || 'NIFTY';

    if (!token || !clientId) {
      return res.status(400).json({ success: false, message: 'Dhan credentials missing. Please set them or wait for auto-refresh.' });
    }

    const scripId = scripMap[symbol];
    if (!scripId) {
      return res.status(400).json({ success: false, message: 'Invalid symbol requested' });
    }

    // 1. Get Expiry List for requested symbol
    const expiryResponse = await axios.post('https://api.dhan.co/v2/optionchain/expirylist', {
      UnderlyingScrip: scripId,
      UnderlyingSeg: 'IDX_I'
    }, { headers: getDhanHeaders() });

    if (expiryResponse.data.status !== 'success' || !expiryResponse.data.data.length) {
      return res.status(400).json({ success: false, message: `Failed to fetch expiry list for ${symbol}` });
    }

    const expiryList = expiryResponse.data.data;
    const expiryToUse = req.query.expiry || expiryList[0];

    // 2. Get Option Chain for that expiry
    const ocResponse = await axios.post('https://api.dhan.co/v2/optionchain', {
      UnderlyingScrip: scripId,
      UnderlyingSeg: 'IDX_I',
      Expiry: expiryToUse
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

    // 4. Save to Database for history (Optional: Avoid duplicates or save on interval)
    db.run(
      `INSERT INTO option_chain_history (symbol, spot_price, expiry, data) VALUES (?, ?, ?, ?)`,
      [symbol, spotPrice, expiryToUse, JSON.stringify(strikesArray)],
      function(err) {
        if (err) {
          console.error('Error saving to DB:', err.message);
        } else {
          console.log(`Saved history for ${symbol} with ID: ${this.lastID}`);
        }
      }
    );

    res.json({ 
      success: true, 
      spotPrice,
      expiry: expiryToUse,
      expiryList,
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

// Endpoint to get historical data
app.get('/api/option-chain/history', (req, res) => {
  const symbol = req.query.symbol || 'NIFTY';
  const date = req.query.date; // Format: YYYY-MM-DD

  if (!date) {
    return res.status(400).json({ success: false, message: 'Date is required (YYYY-MM-DD)' });
  }

  db.all(
    `SELECT * FROM option_chain_history WHERE symbol = ? AND timestamp LIKE ? ORDER BY timestamp DESC`,
    [symbol, `${date}%`],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ success: false, message: err.message });
      }
      
      // Parse the JSON data in each row
      const parsedRows = rows.map(row => ({
        ...row,
        data: JSON.parse(row.data)
      }));

      res.json({ success: true, data: parsedRows });
    }
  );
});

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
