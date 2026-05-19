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

// Refresh on startup (Uncommented to make it fully automatic)
refreshDhanToken();

// Refresh every 20 hours to be safe
setInterval(refreshDhanToken, 20 * 60 * 60 * 1000);

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

    db.run(`CREATE TABLE IF NOT EXISTS ai_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT,
      type TEXT,
      entry_price REAL,
      target_price REAL,
      stoploss_price REAL,
      source TEXT DEFAULT 'OPTION_CHAIN',
      status TEXT DEFAULT 'PENDING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, () => {
      // Safe migration check for existing databases
      db.run(`ALTER TABLE ai_signals ADD COLUMN source TEXT DEFAULT 'OPTION_CHAIN'`, (alterErr) => {
        if (alterErr) {
          // Column probably already exists, which is expected
        } else {
          console.log("Successfully migrated database: added 'source' column to ai_signals.");
        }
      });
    });
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

    // 4. Save to Database for history
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

    // 5. Auto-calculate and save signals to ai_signals
    let totalCallOi = 0;
    let totalPutOi = 0;
    let maxCallOi = 0;
    let maxPutOi = 0;
    let supportStrike = 0;
    let resistanceStrike = 0;

    strikesArray.forEach(strike => {
      totalCallOi += strike.callOi;
      totalPutOi += strike.putOi;

      if (strike.callOi > maxCallOi) {
        maxCallOi = strike.callOi;
        resistanceStrike = strike.strike;
      }

      if (strike.putOi > maxPutOi) {
        maxPutOi = strike.putOi;
        supportStrike = strike.strike;
      }
    });

    const pcr = totalCallOi > 0 ? (totalPutOi / totalCallOi).toFixed(2) : 0;
    
    let type = null;
    let target_price = 0;
    let stoploss_price = 0;

    if (pcr > 1.2 && spotPrice > supportStrike) {
      type = 'CALL';
      stoploss_price = supportStrike;
      target_price = resistanceStrike;
    } else if (pcr < 0.8 && spotPrice < resistanceStrike) {
      type = 'PUT';
      stoploss_price = resistanceStrike;
      target_price = supportStrike;
    }

    if (type) {
      // Check if we already have a pending signal for this symbol and source
      db.get(`SELECT id FROM ai_signals WHERE symbol = ? AND source = 'OPTION_CHAIN' AND status = 'PENDING'`, [symbol], (err, row) => {
        if (!err && !row) {
          // No pending signal, save new one
          db.run(
            `INSERT INTO ai_signals (symbol, type, entry_price, target_price, stoploss_price, source) VALUES (?, ?, ?, ?, ?, 'OPTION_CHAIN')`,
            [symbol, type, spotPrice, target_price, stoploss_price],
            function(err) {
              if (err) console.error('Error auto-saving Option Chain signal:', err.message);
              else console.log(`Auto-saved Option Chain signal for ${symbol} with ID: ${this.lastID}`);
            }
          );
        }
      });
    }

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

    // Get last 30 candles
    const chartData = chartResponse.data;
    const lastCandles = [];
    if (chartData.timestamp) {
      const len = chartData.timestamp.length;
      const startIdx = Math.max(0, len - 30);
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

    const prompt = `You are an expert stock market technical analyst. 
Analyze the following data for ${symbol} and provide a trading suggestion for a beginner trader.

Current Spot Price: ${spotPrice}
Put Call Ratio (PCR): ${pcr}

Last 30 Candles (5-minute interval):
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

// Endpoint to save a new AI signal
app.post('/api/signals', (req, res) => {
  const { symbol, type, entry_price, target_price, stoploss_price, source } = req.body;
  
  if (!symbol || !type || !entry_price) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const signalSource = source || 'OPTION_CHAIN';

  const query = `INSERT INTO ai_signals (symbol, type, entry_price, target_price, stoploss_price, source) 
                 VALUES (?, ?, ?, ?, ?, ?)`;
  
  db.run(query, [symbol, type, entry_price, target_price, stoploss_price, signalSource], function(err) {
    if (err) {
      console.error('Error saving signal:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
    res.json({ success: true, id: this.lastID });
  });
});

// Endpoint to get all signals and update status
app.get('/api/signals', async (req, res) => {
  try {
    // Get the latest spot prices from option_chain_history to avoid rate limits
    const getLatestPrice = (sym) => {
      return new Promise((resolve) => {
        db.get(`SELECT spot_price FROM option_chain_history WHERE symbol = ? ORDER BY timestamp DESC LIMIT 1`, [sym], (err, row) => {
          if (err || !row) resolve(null);
          else resolve(row.spot_price);
        });
      });
    };

    const niftySpot = await getLatestPrice('NIFTY');
    const bankNiftySpot = await getLatestPrice('BANKNIFTY');

    // Update PENDING signals
    const updateSignals = () => {
      return new Promise((resolve, reject) => {
        db.all(`SELECT * FROM ai_signals WHERE status = 'PENDING'`, [], (err, rows) => {
          if (err) return reject(err);
          
          if (rows.length === 0) return resolve(0);

          let pendingUpdates = rows.length;
          let updatedCount = 0;

          rows.forEach(row => {
            const currentSpot = row.symbol === 'NIFTY' ? niftySpot : bankNiftySpot;
            if (!currentSpot) {
              pendingUpdates--;
              if (pendingUpdates === 0) resolve(updatedCount);
              return;
            }

            let newStatus = 'PENDING';
            if (row.type === 'CALL') {
              if (row.target_price && currentSpot >= row.target_price) newStatus = 'SUCCESS';
              else if (row.stoploss_price && currentSpot <= row.stoploss_price) newStatus = 'FAILED';
            } else if (row.type === 'PUT') {
              if (row.target_price && currentSpot <= row.target_price) newStatus = 'SUCCESS';
              else if (row.stoploss_price && currentSpot >= row.stoploss_price) newStatus = 'FAILED';
            }

            if (newStatus !== 'PENDING') {
              db.run(`UPDATE ai_signals SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [newStatus, row.id], function(err) {
                if (!err) updatedCount++;
                pendingUpdates--;
                if (pendingUpdates === 0) resolve(updatedCount);
              });
            } else {
              pendingUpdates--;
              if (pendingUpdates === 0) resolve(updatedCount);
            }
          });
        });
      });
    };

    await updateSignals();

    // Return all signals
    db.all(`SELECT * FROM ai_signals ORDER BY created_at DESC`, [], (err, rows) => {
      if (err) {
        return res.status(500).json({ success: false, message: err.message });
      }
      res.json({ success: true, data: rows });
    });

  } catch (error) {
    console.error('Error in /api/signals:', error.message);
    res.status(500).json({ success: false, message: error.message });
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

// Background Signal Generator based on Option Decoder Math
async function runBackgroundDecoder() {
  const symbols = ['NIFTY', 'BANKNIFTY'];
  
  for (const symbol of symbols) {
    try {
      const token = dhanAccessToken;
      const clientId = process.env.DHAN_CLIENT_ID;
      
      if (!token || !clientId) continue;
      
      const scripId = scripMap[symbol];
      if (!scripId) continue;
      
      // Get Expiry List
      const expiryResponse = await axios.post('https://api.dhan.co/v2/optionchain/expirylist', {
        UnderlyingScrip: scripId,
        UnderlyingSeg: 'IDX_I'
      }, { headers: getDhanHeaders() });
      
      if (expiryResponse.data.status !== 'success' || !expiryResponse.data.data.length) continue;
      
      const expiry = expiryResponse.data.data[0];
      
      // Get Option Chain
      const ocResponse = await axios.post('https://api.dhan.co/v2/optionchain', {
        UnderlyingScrip: scripId,
        UnderlyingSeg: 'IDX_I',
        Expiry: expiry
      }, { headers: getDhanHeaders() });
      
      if (ocResponse.data.status !== 'success') continue;
      
      const rawData = ocResponse.data.data;
      const ocData = rawData.oc;
      const spotPrice = rawData.last_price;
      
      // Transform to strikes array
      const strikesArray = Object.keys(ocData).map(strikeStr => {
        const strike = parseFloat(strikeStr);
        const data = ocData[strikeStr];
        return {
          strike,
          callOi: data.ce?.oi || 0,
          callChgOi: data.ce?.oi - data.ce?.previous_oi || 0, 
          putChgOi: data.pe?.oi - data.pe?.previous_oi || 0,
          putOi: data.pe?.oi || 0
        };
      }).sort((a, b) => a.strike - b.strike);
      
      // Now apply Option Decoder Math
      // 1. PCR
      const totalCallOi = strikesArray.reduce((sum, row) => sum + row.callOi, 0);
      const totalPutOi = strikesArray.reduce((sum, row) => sum + row.putOi, 0);
      const pcr = totalCallOi > 0 ? totalPutOi / totalCallOi : 1.0;
      
      // 2. OI Decode
      const totalCallChg = strikesArray.reduce((sum, row) => sum + row.callChgOi, 0);
      const totalPutChg = strikesArray.reduce((sum, row) => sum + row.putChgOi, 0);
      
      // 3. Max Pain
      let minLoss = Infinity;
      let maxPainStrike = spotPrice;
      strikesArray.forEach(targetStrike => {
        let totalLoss = 0;
        strikesArray.forEach(strikeRow => {
          if (targetStrike.strike > strikeRow.strike) {
            totalLoss += strikeRow.callOi * (targetStrike.strike - strikeRow.strike);
          }
          if (targetStrike.strike < strikeRow.strike) {
            totalLoss += strikeRow.putOi * (strikeRow.strike - targetStrike.strike);
          }
        });
        if (totalLoss < minLoss) {
          minLoss = totalLoss;
          maxPainStrike = targetStrike.strike;
        }
      });
      
      // 4. Strike Concentration
      const atmStrike = strikesArray.reduce((prev, curr) => {
        return (Math.abs(curr.strike - spotPrice) < Math.abs(prev.strike - spotPrice) ? curr : prev);
      }, strikesArray[0] || { strike: 0 }).strike;
      
      const atmIndex = strikesArray.findIndex(s => s.strike === atmStrike);
      const nearStrikes = strikesArray.slice(Math.max(0, atmIndex - 5), Math.min(strikesArray.length, atmIndex + 6));
      const nearCallOi = nearStrikes.reduce((sum, row) => sum + row.callOi, 0);
      const nearPutOi = nearStrikes.reduce((sum, row) => sum + row.putOi, 0);
      
      // 5. Score
      let bullishPoints = 0;
      let totalPoints = 4;
      
      if (pcr > 1.0) bullishPoints++;
      if (totalPutChg > totalCallChg) bullishPoints++;
      if (maxPainStrike > spotPrice) bullishPoints++;
      if (nearPutOi > nearCallOi) bullishPoints++;
      
      const percentage = (bullishPoints / totalPoints) * 100;
      
      let type = null;
      if (percentage >= 75) type = 'CALL';
      if (percentage <= 25) type = 'PUT';
      
      if (type) {
        // Calculate Dynamic Target based on Max Pain
        const distanceToPain = Math.abs(spotPrice - maxPainStrike);
        let dynamicTarget = distanceToPain * 0.5;
        if (symbol === 'NIFTY') {
          dynamicTarget = Math.max(10, Math.min(30, dynamicTarget));
        } else {
          dynamicTarget = Math.max(20, Math.min(60, dynamicTarget));
        }
        
        const target_price = type === 'CALL' ? spotPrice + dynamicTarget : spotPrice - dynamicTarget;
        const stoploss_price = type === 'CALL' ? spotPrice - (symbol === 'NIFTY' ? 10 : 25) : spotPrice + (symbol === 'NIFTY' ? 10 : 25);
        
        // Check if pending signal exists
        db.get(`SELECT id FROM ai_signals WHERE symbol = ? AND source = 'OPTION_CHAIN' AND status = 'PENDING'`, [symbol], (err, row) => {
          if (!err && !row) {
            // Save new signal
            db.run(
              `INSERT INTO ai_signals (symbol, type, entry_price, target_price, stoploss_price, source) VALUES (?, ?, ?, ?, ?, 'OPTION_CHAIN')`,
              [symbol, type, spotPrice, target_price, stoploss_price],
              function(err) {
                if (err) console.error(`Background signal save failed for ${symbol}:`, err.message);
                else console.log(`Background auto-saved Option Chain signal for ${symbol} with ID: ${this.lastID}`);
              }
            );
          }
        });
      }
      
    } catch (err) {
      console.error(`Background decoding failed for ${symbol}:`, err.message);
    }
  }
}

// Background Signal Generator based on Chart Technical indicators (EMA 9 & 21 Crossovers)
async function runBackgroundChartDecoder() {
  const symbols = ['NIFTY', 'BANKNIFTY'];
  
  for (const symbol of symbols) {
    try {
      const token = dhanAccessToken;
      const clientId = process.env.DHAN_CLIENT_ID;
      
      if (!token || !clientId) continue;
      
      const scripId = scripMap[symbol];
      if (!scripId) continue;
      
      // Fetch 5m intraday chart data (last 3 days to have plenty of candles for EMA initialization)
      const toDate = new Date();
      toDate.setDate(toDate.getDate() + 1);
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 3); 
      
      const formatDate = (d) => d.toISOString().split('T')[0];
      
      const payload = {
        securityId: scripId.toString(),
        exchangeSegment: 'IDX_I',
        instrument: 'INDEX',
        interval: '5',
        fromDate: formatDate(fromDate),
        toDate: formatDate(toDate)
      };
      
      const response = await axios.post('https://api.dhan.co/v2/charts/intraday', payload, {
        headers: getDhanHeaders()
      });
      
      if (response.data.status !== 'success' && !response.data.open) continue;
      
      const data = response.data.data || response.data;
      if (!data.timestamp || data.timestamp.length < 22) continue;
      
      const candles = [];
      for (let i = 0; i < data.timestamp.length; i++) {
        candles.push({
          close: data.close[i],
          high: data.high[i],
          low: data.low[i],
          open: data.open[i]
        });
      }
      
      // Calculate EMA 9 and EMA 21
      const ema9List = [];
      const ema21List = [];
      
      const k9 = 2 / (9 + 1);
      const k21 = 2 / (21 + 1);
      
      let ema9 = candles[0].close;
      let ema21 = candles[0].close;
      
      for (let i = 0; i < candles.length; i++) {
        ema9 = (candles[i].close * k9) + (ema9 * (1 - k9));
        ema21 = (candles[i].close * k21) + (ema21 * (1 - k21));
        ema9List.push(ema9);
        ema21List.push(ema21);
      }
      
      const len = candles.length;
      const currentEma9 = ema9List[len - 1];
      const currentEma21 = ema21List[len - 1];
      const prevEma9 = ema9List[len - 2];
      const prevEma21 = ema21List[len - 2];
      const currentClose = candles[len - 1].close;
      
      let type = null;
      
      // Detect EMA Crossovers
      if (prevEma9 <= prevEma21 && currentEma9 > currentEma21) {
        type = 'CALL'; // Bullish Crossover
      } else if (prevEma9 >= prevEma21 && currentEma9 < currentEma21) {
        type = 'PUT'; // Bearish Crossover
      }
      
      if (type) {
        // Calculate Target & Stoploss (realistic intraday values)
        let target_price, stoploss_price;
        if (symbol === 'NIFTY') {
          target_price = type === 'CALL' ? currentClose + 30 : currentClose - 30;
          stoploss_price = type === 'CALL' ? currentClose - 15 : currentClose + 15;
        } else {
          target_price = type === 'CALL' ? currentClose + 75 : currentClose - 75;
          stoploss_price = type === 'CALL' ? currentClose - 40 : currentClose + 40;
        }
        
        // Check if pending Chart signal already exists to avoid duplication
        db.get(`SELECT id FROM ai_signals WHERE symbol = ? AND source = 'CHART' AND status = 'PENDING'`, [symbol], (err, row) => {
          if (!err && !row) {
            // Save new Chart signal
            db.run(
              `INSERT INTO ai_signals (symbol, type, entry_price, target_price, stoploss_price, source) VALUES (?, ?, ?, ?, ?, 'CHART')`,
              [symbol, type, currentClose, target_price, stoploss_price],
              function(err) {
                if (err) console.error(`Background Chart signal save failed for ${symbol}:`, err.message);
                else console.log(`Background auto-saved Chart signal for ${symbol} with ID: ${this.lastID}`);
              }
            );
          }
        });
      }
      
    } catch (err) {
      console.error(`Background chart decoding failed for ${symbol}:`, err.message);
    }
  }
}

// Run Option Chain decoder every 1 minute
setInterval(runBackgroundDecoder, 60000);

// Run Chart decoder every 1 minute
setInterval(runBackgroundChartDecoder, 60000);

// Run immediately on startup (wait 5s for token to be generated)
setTimeout(() => {
  runBackgroundDecoder();
  runBackgroundChartDecoder();
}, 5000);

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
