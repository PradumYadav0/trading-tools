const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const sqlite3 = require('sqlite3').verbose();
const { generateSync } = require('otplib');

dotenv.config({ path: './.env' }); // Load .env from backend folder

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
    const totp = generateSync({ secret });
    console.log(`[${new Date().toLocaleTimeString()}] Generating new Dhan token with TOTP...`);
    
    const url = `https://auth.dhan.co/app/generateAccessToken?dhanClientId=${clientId}&pin=${pin}&totp=${totp}`;
    const response = await axios.post(url);
    
    const token = response.data?.access_token || response.data?.data?.access_token || response.data?.accessToken || response.data?.data?.accessToken;
    if (token) {
      dhanAccessToken = token;
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

// ─── Settings Endpoints ───────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const ENV_PATH = path.resolve(__dirname, './.env');

// Helper: read .env file into object
function readEnvFile() {
  if (!fs.existsSync(ENV_PATH)) {
    fs.writeFileSync(ENV_PATH, '', 'utf8');
  }
  const raw = fs.readFileSync(ENV_PATH, 'utf8');
  const env = {};
  raw.split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    if (key && key.trim()) env[key.trim()] = rest.join('=').trim();
  });
  return env;
}

// Helper: write object back to .env file
function writeEnvFile(obj) {
  const content = Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  fs.writeFileSync(ENV_PATH, content, 'utf8');
}

// GET current settings (masked)
app.get('/api/settings', (req, res) => {
  try {
    const env = readEnvFile();
    res.json({
      success: true,
      clientId: env.DHAN_CLIENT_ID || '',
      hasPin: !!(env.DHAN_PIN && env.DHAN_PIN !== 'xxxx'),
      hasTotpSecret: !!env.DHAN_TOTP_SECRET,
      hasAccessToken: !!env.DHAN_ACCESS_TOKEN,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST to save credentials and trigger token refresh
app.post('/api/settings', async (req, res) => {
  try {
    const { pin, totpSecret, clientId } = req.body;
    const env = readEnvFile();

    if (clientId) env.DHAN_CLIENT_ID = clientId;
    if (pin) env.DHAN_PIN = pin;
    if (totpSecret) env.DHAN_TOTP_SECRET = totpSecret;

    writeEnvFile(env);

    // Reload into process.env
    if (clientId) process.env.DHAN_CLIENT_ID = clientId;
    if (pin) process.env.DHAN_PIN = pin;
    if (totpSecret) process.env.DHAN_TOTP_SECRET = totpSecret;

    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST to manually trigger token refresh from UI
app.post('/api/settings/refresh-token', async (req, res) => {
  const secret = process.env.DHAN_TOTP_SECRET;
  const pin = process.env.DHAN_PIN;
  const clientId = process.env.DHAN_CLIENT_ID;

  if (!secret || !pin || pin === 'xxxx') {
    return res.status(400).json({ success: false, message: 'TOTP Secret and PIN not configured. Please save settings first.' });
  }

  try {
    const totp = generateSync({ secret });
    const url = `https://auth.dhan.co/app/generateAccessToken?dhanClientId=${clientId}&pin=${pin}&totp=${totp}`;
    const response = await axios.post(url);

    const token = response.data?.access_token || response.data?.data?.access_token || response.data?.accessToken || response.data?.data?.accessToken;
    if (token) {
      dhanAccessToken = token;
      // Save new token to .env
      const env = readEnvFile();
      env.DHAN_ACCESS_TOKEN = token;
      writeEnvFile(env);
      process.env.DHAN_ACCESS_TOKEN = token;
      return res.json({ success: true, message: 'Token refreshed successfully!' });
    } else {
      return res.status(400).json({ success: false, message: 'Token refresh failed. Check your PIN and TOTP Secret.', details: response.data });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
      details: error.response?.data
    });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
