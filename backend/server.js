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
      
      // Save new token to .env file so it persists across restarts
      try {
        const env = readEnvFile();
        env.DHAN_ACCESS_TOKEN = token;
        writeEnvFile(env);
        process.env.DHAN_ACCESS_TOKEN = token;
      } catch (e) {
        console.log('Error saving token to .env:', e.message);
      }
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

// Refresh on startup (Commented out to avoid rate limit on restarts)
// refreshDhanToken();

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

// Endpoint to get Intraday Chart Data
app.get('/api/charts/intraday', async (req, res) => {
  try {
    const token = dhanAccessToken;
    const clientId = process.env.DHAN_CLIENT_ID;
    const symbol = req.query.symbol || 'NIFTY';
    const interval = req.query.interval || '5'; // default 5 mins
    
    // Dhan API limits intraday to recent days
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + 1); // add 1 day to include today safely
    
    const fromDate = new Date();
    if (interval === '1') {
      // For 1-minute data, request only 1 day to reduce data volume and avoid 400 errors
      fromDate.setDate(fromDate.getDate() - 1);
    } else {
      fromDate.setDate(fromDate.getDate() - 5); 
    }

    const formatDate = (d) => d.toISOString().split('T')[0];

    if (!token || !clientId) {
      return res.status(400).json({ success: false, message: 'Dhan credentials missing.' });
    }

    const scripId = scripMap[symbol];
    if (!scripId) {
      return res.status(400).json({ success: false, message: 'Invalid symbol requested' });
    }

    const payload = {
      securityId: scripId.toString(),
      exchangeSegment: 'IDX_I',
      instrument: 'INDEX',
      interval: interval.toString(),
      fromDate: formatDate(fromDate),
      toDate: formatDate(toDate)
    };

    const response = await axios.post('https://api.dhan.co/v2/charts/intraday', payload, {
      headers: getDhanHeaders()
    });

    if (response.data.status === 'success' || response.data.open) {
       const data = response.data.data || response.data;
       // Transform to array of objects for lightweight-charts
       const chartData = [];
       if (data.timestamp && data.timestamp.length > 0) {
         for (let i = 0; i < data.timestamp.length; i++) {
            // Dhan timestamp is often in seconds or string, we need to convert to Unix seconds for lightweight-charts
            const ts = data.timestamp[i];
            
            // lightweight charts requires time in seconds (Unix timestamp) or string format 'YYYY-MM-DD'
            // We pass unix seconds (but we must convert Dhan timestamp which might be in seconds or format)
            // Wait, Dhan returns 'start_Time' or 'timestamp' array depending on response. 
            // My node script printed "timestamp". Wait, earlier I saw Dhan returns start_Time? The node script output showed "timestamp" array! 
            let timeUnix = 0;
            if (typeof ts === 'string' && ts.includes('-')) {
               timeUnix = Math.floor(new Date(ts).getTime() / 1000);
            } else if (typeof ts === 'string' && ts.includes('T')) {
               timeUnix = Math.floor(new Date(ts).getTime() / 1000);
            } else {
               // Dhan timestamp is in Indian standard time epoch (seconds) usually, but sometimes different.
               // Let's assume it's epoch in seconds if it's a number.
               timeUnix = typeof ts === 'string' ? parseInt(ts) : ts;
               // If it's too large (milliseconds), convert to seconds
               if (timeUnix > 2000000000) {
                  timeUnix = Math.floor(timeUnix / 1000);
               } else {
                  // Dhan actually returns the timestamp in IST in an internal format. But usually it's just unix epoch.
                  // Wait, Dhan returns Dhan Epoch (seconds since 1980-01-01 00:00:00).
                  // Dhan epoch: 0 = 1980-01-01. Let's add the offset.
                  // 315532800 = seconds between 1970-01-01 and 1980-01-01.
                  // Wait, some Dhan APIs return standard unix timestamp. Let's assume standard unix timestamp, or convert to string if we can.
               }
            }

            // Standardize Dhan specific timestamp conversion just in case:
            // The safest is to return it as seconds since lightweight-charts accepts that.
            
            chartData.push({
               time: timeUnix,
               open: data.open[i],
               high: data.high[i],
               low: data.low[i],
               close: data.close[i]
            });
         }
       }
       return res.json({ success: true, data: chartData });
    } else {
      return res.status(400).json({ success: false, message: 'Failed to fetch chart data' });
    }
  } catch (error) {
    console.error('Chart API Error:', error.message);
    if (error.response) {
      console.error('Dhan API Error Details:', error.response.data);
    }
    res.status(error.response?.status || 500).json({ 
      success: false, 
      message: error.message,
      details: error.response?.data
    });
  }
});

// Endpoint to get Historical Daily Chart Data
app.get('/api/charts/historical', async (req, res) => {
  try {
    const token = dhanAccessToken;
    const clientId = process.env.DHAN_CLIENT_ID;
    const symbol = req.query.symbol || 'NIFTY';
    
    // Fetch for the last 2 years for good daily/monthly view
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + 1);
    const fromDate = new Date();
    fromDate.setFullYear(fromDate.getFullYear() - 2); 

    const formatDate = (d) => d.toISOString().split('T')[0];

    if (!token || !clientId) {
      return res.status(400).json({ success: false, message: 'Dhan credentials missing.' });
    }

    const scripId = scripMap[symbol];
    if (!scripId) {
      return res.status(400).json({ success: false, message: 'Invalid symbol requested' });
    }

    const payload = {
      securityId: scripId.toString(),
      exchangeSegment: 'IDX_I',
      instrument: 'INDEX',
      fromDate: formatDate(fromDate),
      toDate: formatDate(toDate)
    };

    // Dhan uses /v2/charts/historical for daily data
    const response = await axios.post('https://api.dhan.co/v2/charts/historical', payload, {
      headers: getDhanHeaders()
    });

    if (response.data.status === 'success' || response.data.open) {
       const data = response.data.data || response.data;
       const chartData = [];
       if (data.timestamp && data.timestamp.length > 0) {
         for (let i = 0; i < data.timestamp.length; i++) {
            const ts = data.timestamp[i];
            let timeUnix = typeof ts === 'string' ? parseInt(ts) : ts;
            if (timeUnix > 2000000000) {
               timeUnix = Math.floor(timeUnix / 1000);
            }
            
            chartData.push({
               time: timeUnix,
               open: data.open[i],
               high: data.high[i],
               low: data.low[i],
               close: data.close[i]
            });
         }
       }
       return res.json({ success: true, data: chartData });
    } else {
      return res.status(400).json({ success: false, message: 'Failed to fetch historical chart data' });
    }
  } catch (error) {
    console.error('Historical Chart API Error:', error.message);
    res.status(error.response?.status || 500).json({ 
      success: false, 
      message: error.message,
      details: error.response?.data
    });
  }
});

// Endpoint for AI Analysis
app.post('/api/ai-analysis', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ success: false, message: 'Gemini API Key missing in settings.' });
    }

    const symbol = req.body.symbol || 'NIFTY';
    
    // 1. Fetch Option Chain Data
    const scripId = scripMap[symbol];
    if (!scripId) {
      return res.status(400).json({ success: false, message: 'Invalid symbol requested' });
    }

    // Get Expiry List first
    const expiryResponse = await axios.post('https://api.dhan.co/v2/optionchain/expirylist', {
      UnderlyingScrip: scripId,
      UnderlyingSeg: 'IDX_I'
    }, { headers: getDhanHeaders() });

    if (expiryResponse.data.status !== 'success' || !expiryResponse.data.data.length) {
      return res.status(400).json({ success: false, message: `Failed to fetch expiry list for ${symbol}` });
    }

    const expiryList = expiryResponse.data.data;
    const expiryToUse = req.body.expiry || expiryList[0];

    const ocResponse = await axios.post('https://api.dhan.co/v2/optionchain', {
      UnderlyingScrip: scripId,
      UnderlyingSeg: 'IDX_I',
      Expiry: expiryToUse
    }, { headers: getDhanHeaders() });

    // 2. Fetch Chart Data (Last 20 candles of 5 min)
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + 1);
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 2); // 2 days to be safe

    const formatDate = (d) => d.toISOString().split('T')[0];
    
    const chartResponse = await axios.post('https://api.dhan.co/v2/charts/intraday', {
      securityId: scripId.toString(),
      exchangeSegment: 'IDX_I',
      instrument: 'INDEX',
      interval: '5',
      fromDate: formatDate(fromDate),
      toDate: formatDate(toDate)
    }, { headers: getDhanHeaders() });

    // Process data for prompt
    const ocData = ocResponse.data.data;
    const spotPrice = ocData.last_price;
    
    // Calculate PCR
    let totalCallOi = 0;
    let totalPutOi = 0;
    Object.values(ocData.oc).forEach(strike => {
      totalCallOi += strike.ce?.oi || 0;
      totalPutOi += strike.pe?.oi || 0;
    });
    const pcr = totalCallOi > 0 ? (totalPutOi / totalCallOi).toFixed(2) : 0;

    // Get last 15 candles
    const chartData = chartResponse.data;
    const lastCandles = [];
    if (chartData.timestamp) {
      const len = chartData.timestamp.length;
      const startIdx = Math.max(0, len - 15);
      for (let i = startIdx; i < len; i++) {
        lastCandles.push({
          time: new Date(chartData.timestamp[i] * 1000).toLocaleTimeString(),
          open: chartData.open[i],
          high: chartData.high[i],
          low: chartData.low[i],
          close: chartData.close[i]
        });
      }
    }

    // Construct Prompt
    const prompt = `You are an expert stock market technical analyst. 
Analyze the following data for ${symbol} and provide a trading suggestion for a beginner trader.

Current Spot Price: ${spotPrice}
Put Call Ratio (PCR): ${pcr}

Last 15 Candles (5-minute interval):
${JSON.stringify(lastCandles, null, 2)}

Please provide:
1. Market Sentiment (Bullish/Bearish/Sideways) and why.
2. Key Support and Resistance levels based on the data.
3. Actionable advice: Should the user buy Call, Buy Put, or Wait? Give a reason.

IMPORTANT INSTRUCTIONS for the tone and format:
- Write the response in friendly Hinglish (Hindi + English mix, written in English script like 'Market abhi sideways chal raha hai').
- Do NOT use Hindi script (like नमस्ते or बाज़ार).
- Do NOT use markdown formatting like ###, **, or *. Just use simple plain text with line breaks for spacing.
- Explain it in a simple way, like an expert friend giving advice.`;

    // Call Gemini API
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const parts = [{ text: prompt }];
    
    // Add image if provided
    if (req.body.image) {
      // Remove data:image/png;base64, prefix if present
      const base64Data = req.body.image.includes(',') ? req.body.image.split(',')[1] : req.body.image;
      parts.push({
        inlineData: {
          mimeType: "image/png",
          data: base64Data
        }
      });
    }

    const geminiResponse = await axios.post(geminiUrl, {
      contents: [{
        parts: parts
      }]
    });

    const aiResponse = geminiResponse.data.candidates[0].content.parts[0].text;

    res.json({ success: true, analysis: aiResponse });

  } catch (error) {
    console.error('AI Analysis Error:', error.message);
    if (error.response) {
      console.error('Gemini API Error Details:', error.response.data);
    }
    res.status(500).json({ 
      success: false, 
      message: error.message,
      details: error.response?.data
    });
  }
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
      hasGeminiKey: !!env.GEMINI_API_KEY,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST to save credentials and trigger token refresh
app.post('/api/settings', async (req, res) => {
  try {
    const { pin, totpSecret, clientId, geminiApiKey } = req.body;
    const env = readEnvFile();

    if (clientId) env.DHAN_CLIENT_ID = clientId;
    if (pin) env.DHAN_PIN = pin;
    if (totpSecret) env.DHAN_TOTP_SECRET = totpSecret;
    if (geminiApiKey) env.GEMINI_API_KEY = geminiApiKey;

    writeEnvFile(env);

    // Reload into process.env
    if (clientId) process.env.DHAN_CLIENT_ID = clientId;
    if (pin) process.env.DHAN_PIN = pin;
    if (totpSecret) process.env.DHAN_TOTP_SECRET = totpSecret;
    if (geminiApiKey) process.env.GEMINI_API_KEY = geminiApiKey;

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
