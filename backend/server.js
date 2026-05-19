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

// Cache store to prevent Dhan API rate limit issues
const dhanCache = {
  optionChain: {},
  chartsIntraday: {},
  chartsHistorical: {}
};

const CACHE_DURATION_MS = 15000; // Cache duration: 15 seconds for live data
const HISTORICAL_CACHE_DURATION_MS = 3600000; // Cache duration: 1 hour for historical daily charts

function getCachedData(type, key, duration = CACHE_DURATION_MS) {
  const entry = dhanCache[type]?.[key];
  if (entry && (Date.now() - entry.timestamp < duration)) {
    return entry.data;
  }
  return null;
}

function setCachedData(type, key, data) {
  if (!dhanCache[type]) dhanCache[type] = {};
  dhanCache[type][key] = {
    data,
    timestamp: Date.now()
  };
}

// Scrip Mapping for Indices
const scripMap = {
  'NIFTY': 13,
  'BANKNIFTY': 25
};

// Endpoint to get Option Chain
app.get('/api/option-chain', async (req, res) => {
  const symbol = req.query.symbol || 'NIFTY';
  const expiryToUse = req.query.expiry;
  const cacheKey = `${symbol}_${expiryToUse || 'first'}`;

  const cached = getCachedData('optionChain', cacheKey);
  if (cached) {
    return res.json(cached);
  }

  try {
    const token = dhanAccessToken;
    const clientId = process.env.DHAN_CLIENT_ID;

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
    const finalExpiry = expiryToUse || expiryList[0];

    // 2. Get Option Chain for that expiry
    const ocResponse = await axios.post('https://api.dhan.co/v2/optionchain', {
      UnderlyingScrip: scripId,
      UnderlyingSeg: 'IDX_I',
      Expiry: finalExpiry
    }, { headers: getDhanHeaders() });

    if (ocResponse.data.status !== 'success') {
      return res.status(400).json({ success: false, message: 'Failed to fetch option chain' });
    }

    const rawData = ocResponse.data.data;
    const ocData = rawData.oc;
    const spotPrice = rawData.last_price;

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

    // Save to Database for history
    db.run(
      `INSERT INTO option_chain_history (symbol, spot_price, expiry, data) VALUES (?, ?, ?, ?)`,
      [symbol, spotPrice, finalExpiry, JSON.stringify(strikesArray)],
      function(err) {
        if (err) console.error('Error saving to DB:', err.message);
      }
    );

    // Auto-calculate and save signals to ai_signals
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
      db.get(`SELECT id FROM ai_signals WHERE symbol = ? AND source = 'OPTION_CHAIN' AND status = 'PENDING'`, [symbol], (err, row) => {
        if (!err && !row) {
          db.run(
            `INSERT INTO ai_signals (symbol, type, entry_price, target_price, stoploss_price, source) VALUES (?, ?, ?, ?, ?, 'OPTION_CHAIN')`,
            [symbol, type, spotPrice, target_price, stoploss_price],
            function(err) {
              if (err) console.error('Error auto-saving Option Chain signal:', err.message);
            }
          );
        }
      });
    }

    const result = { 
      success: true, 
      spotPrice,
      expiry: finalExpiry,
      expiryList,
      data: strikesArray 
    };

    setCachedData('optionChain', cacheKey, result);
    res.json(result);

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
  const symbol = req.query.symbol || 'NIFTY';
  const interval = req.query.interval || '5'; // default 5 mins
  const cacheKey = `${symbol}_${interval}`;

  const cached = getCachedData('chartsIntraday', cacheKey);
  if (cached) {
    return res.json(cached);
  }

  try {
    const token = dhanAccessToken;
    const clientId = process.env.DHAN_CLIENT_ID;
    
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
       const chartData = [];
       if (data.timestamp && data.timestamp.length > 0) {
         for (let i = 0; i < data.timestamp.length; i++) {
            const ts = data.timestamp[i];
            
            let timeUnix = 0;
            if (typeof ts === 'string' && ts.includes('-')) {
               timeUnix = Math.floor(new Date(ts).getTime() / 1000);
            } else if (typeof ts === 'string' && ts.includes('T')) {
               timeUnix = Math.floor(new Date(ts).getTime() / 1000);
            } else {
               timeUnix = typeof ts === 'string' ? parseInt(ts) : ts;
               if (timeUnix > 2000000000) {
                  timeUnix = Math.floor(timeUnix / 1000);
               }
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
       const result = { success: true, data: chartData };
       setCachedData('chartsIntraday', cacheKey, result);
       return res.json(result);
    } else {
      return res.status(400).json({ success: false, message: 'Failed to fetch chart data' });
    }
  } catch (error) {
    console.error('Chart API Error:', error.message);
    res.status(error.response?.status || 500).json({ 
      success: false, 
      message: error.message,
      details: error.response?.data
    });
  }
});

// Endpoint to get Historical Daily Chart Data
app.get('/api/charts/historical', async (req, res) => {
  const symbol = req.query.symbol || 'NIFTY';
  const cacheKey = symbol;

  const cached = getCachedData('chartsHistorical', cacheKey, HISTORICAL_CACHE_DURATION_MS);
  if (cached) {
    return res.json(cached);
  }

  try {
    const token = dhanAccessToken;
    const clientId = process.env.DHAN_CLIENT_ID;
    
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
       const result = { success: true, data: chartData };
       setCachedData('chartsHistorical', cacheKey, result);
       return res.json(result);
     } else {
       return res.status(400).json({ success: false, message: 'Failed to fetch historical chart data' });
      }
    } catch (error) {
      console.error('Historical Chart API Error:', error.message);
      return res.status(error.response?.status || 500).json({ 
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

// Background Signal Generator: Unified High-Accuracy Decoder
// Computes Option Chain (OI Decode + PCR Velocity + Max Pain + Concentration), 
// Chart Analysis (5m EMA9/20, RSI, MACD, PCR, VWAP, ATR Dynamic S/R, plus 15m Major Trend Confirmation),
// and convergence-based HYBRID signals to maximize win rate.
async function runAllDecoders() {
  const symbols = ['NIFTY', 'BANKNIFTY'];
  
  for (const symbol of symbols) {
    try {
      const token = dhanAccessToken;
      const clientId = process.env.DHAN_CLIENT_ID;
      if (!token || !clientId) continue;

      const scripId = scripMap[symbol];
      if (!scripId) continue;

      // 1. FETCH OPTION CHAIN
      const expiryResponse = await axios.post('https://api.dhan.co/v2/optionchain/expirylist', {
        UnderlyingScrip: scripId,
        UnderlyingSeg: 'IDX_I'
      }, { headers: getDhanHeaders() });
      
      if (expiryResponse.data.status !== 'success' || !expiryResponse.data.data.length) continue;
      const expiry = expiryResponse.data.data[0];
      
      const ocResponse = await axios.post('https://api.dhan.co/v2/optionchain', {
        UnderlyingScrip: scripId,
        UnderlyingSeg: 'IDX_I',
        Expiry: expiry
      }, { headers: getDhanHeaders() });
      
      if (ocResponse.data.status !== 'success') continue;
      
      const rawData = ocResponse.data.data;
      const ocData = rawData.oc;
      const spotPrice = rawData.last_price;
      
      const strikesArray = Object.keys(ocData).map(strikeStr => {
        const strike = parseFloat(strikeStr);
        const data = ocData[strikeStr];
        return {
          strike,
          callOi: data.ce?.oi || 0,
          callChgOi: (data.ce?.oi || 0) - (data.ce?.previous_oi || 0), 
          putChgOi: (data.pe?.oi || 0) - (data.pe?.previous_oi || 0),
          putOi: data.pe?.oi || 0
        };
      }).sort((a, b) => a.strike - b.strike);
      
      // A. Calculate PCR
      const totalCallOi = strikesArray.reduce((sum, row) => sum + row.callOi, 0);
      const totalPutOi = strikesArray.reduce((sum, row) => sum + row.putOi, 0);
      const pcr = totalCallOi > 0 ? totalPutOi / totalCallOi : 1.0;
      
      // B. Calculate PCR Velocity (Change speed)
      let pcrVelocity = 0;
      await new Promise((resolve) => {
        db.get(
          `SELECT data FROM option_chain_history WHERE symbol = ? ORDER BY timestamp DESC LIMIT 1 OFFSET 1`,
          [symbol],
          (err, row) => {
            if (!err && row) {
              try {
                const prevStrikes = JSON.parse(row.data);
                const prevCallOi = prevStrikes.reduce((sum, r) => sum + (r.callOi || 0), 0);
                const prevPutOi = prevStrikes.reduce((sum, r) => sum + (r.putOi || 0), 0);
                const prevPcr = prevCallOi > 0 ? prevPutOi / prevCallOi : 1.0;
                pcrVelocity = pcr - prevPcr;
              } catch (e) {}
            }
            resolve();
          }
        );
      });

      // C. Max Pain Strike
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
      
      // D. Concentration Ratio
      const callStrikes = [...strikesArray].sort((a,b) => b.callOi - a.callOi).slice(0, 3);
      const putStrikes = [...strikesArray].sort((a,b) => b.putOi - a.putOi).slice(0, 3);
      const topCallOi = callStrikes.reduce((sum, s) => sum + s.callOi, 0);
      const topPutOi = putStrikes.reduce((sum, s) => sum + s.putOi, 0);
      const concentrationRatio = topCallOi > 0 ? topPutOi / topCallOi : 1.0;

      // E. Calculate Option Decoder Score
      let optionScore = 50;
      let optionSignal = 'WAIT';
      let bullishPoints = 0;
      let totalPoints = 0;

      totalPoints += 30;
      if (pcr > 1.2) bullishPoints += 30;
      else if (pcr >= 0.9) bullishPoints += 15;

      totalPoints += 20;
      if (pcrVelocity > 0.02) bullishPoints += 20;
      else if (pcrVelocity >= -0.02) bullishPoints += 10;

      totalPoints += 25;
      if (spotPrice < maxPainStrike) bullishPoints += 25;
      else if (spotPrice === maxPainStrike) bullishPoints += 12;

      totalPoints += 25;
      if (concentrationRatio > 1.2) bullishPoints += 25;
      else if (concentrationRatio >= 0.9) bullishPoints += 12;

      optionScore = Math.round((bullishPoints / totalPoints) * 100);
      if (optionScore >= 75) optionSignal = 'CALL';
      else if (optionScore <= 25) optionSignal = 'PUT';

      // 2. FETCH 5M CHART CANDLES
      const toDate = new Date();
      toDate.setDate(toDate.getDate() + 1);
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 3); 
      const formatDate = (d) => d.toISOString().split('T')[0];
      
      const chartPayload = {
        securityId: scripId.toString(),
        exchangeSegment: 'IDX_I',
        instrument: 'INDEX',
        interval: '5',
        fromDate: formatDate(fromDate),
        toDate: formatDate(toDate)
      };
      
      const chartResponse = await axios.post('https://api.dhan.co/v2/charts/intraday', chartPayload, {
        headers: getDhanHeaders()
      });
      
      if (chartResponse.data.status !== 'success' && !chartResponse.data.open) continue;
      const chartData = chartResponse.data.data || chartResponse.data;
      if (!chartData.timestamp || chartData.timestamp.length < 30) continue;
      
      const candles5m = [];
      for (let i = 0; i < chartData.timestamp.length; i++) {
        candles5m.push({
          close: chartData.close[i],
          high: chartData.high[i],
          low: chartData.low[i],
          open: chartData.open[i]
        });
      }

      // Group into 15m candles for Trend Filter
      const candles15m = [];
      for (let i = 0; i < candles5m.length; i += 3) {
        const chunk = candles5m.slice(i, i + 3);
        if (chunk.length === 0) continue;
        const open = chunk[0].open;
        const close = chunk[chunk.length - 1].close;
        const high = Math.max(...chunk.map(c => c.high));
        const low = Math.min(...chunk.map(c => c.low));
        candles15m.push({ open, close, high, low });
      }

      // Indicator Calculators
      const calculateEMA = (cand, period) => {
        const k = 2 / (period + 1);
        let emaList = [];
        let ema = cand[0].close;
        for (let i = 0; i < cand.length; i++) {
          ema = (cand[i].close * k) + (ema * (1 - k));
          emaList.push(ema);
        }
        return emaList;
      };

      const calculateRSI = (cand, period = 14) => {
        if (cand.length < period) return Array(cand.length).fill(50);
        let gains = 0;
        let losses = 0;
        for (let i = 1; i <= period; i++) {
          const diff = cand[i].close - cand[i-1].close;
          if (diff >= 0) gains += diff;
          else losses -= diff;
        }
        let avgGain = gains / period;
        let avgLoss = losses / period;
        let rsiList = Array(period).fill(50);
        const firstRS = avgLoss === 0 ? 100 : avgGain / avgLoss;
        rsiList.push(100 - (100 / (1 + firstRS)));
        for (let i = period + 1; i < cand.length; i++) {
          const diff = cand[i].close - cand[i-1].close;
          const gain = diff >= 0 ? diff : 0;
          const loss = diff < 0 ? -diff : 0;
          avgGain = ((avgGain * (period - 1)) + gain) / period;
          avgLoss = ((avgLoss * (period - 1)) + loss) / period;
          const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
          rsiList.push(100 - (100 / (1 + rs)));
        }
        return rsiList;
      };

      const calculateATR = (cand, period = 14) => {
        let trs = [];
        for (let i = 1; i < cand.length; i++) {
          const h_l = cand[i].high - cand[i].low;
          const h_pc = Math.abs(cand[i].high - cand[i-1].close);
          const l_pc = Math.abs(cand[i].low - cand[i-1].close);
          trs.push(Math.max(h_l, h_pc, l_pc));
        }
        let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
        let atrList = Array(period).fill(atr);
        for (let i = period; i < trs.length; i++) {
          atr = ((atr * (period - 1)) + trs[i]) / period;
          atrList.push(atr);
        }
        return atrList;
      };

      const ema9List = calculateEMA(candles5m, 9);
      const ema20List = calculateEMA(candles5m, 20);
      const ema12List = calculateEMA(candles5m, 12);
      const ema26List = calculateEMA(candles5m, 26);
      const rsiList = calculateRSI(candles5m, 14);
      const atrList = calculateATR(candles5m, 14);
      const ema20_15m = calculateEMA(candles15m, 20);

      const len5 = candles5m.length;
      const lastCandle = candles5m[len5 - 1];
      const lastEma9 = ema9List[len5 - 1];
      const lastEma20 = ema20List[len5 - 1];
      const lastRsi = rsiList[len5 - 1] || 50;
      const lastEma12 = ema12List[len5 - 1];
      const lastEma26 = ema26List[len5 - 1];
      const macdLine = lastEma12 - lastEma26;
      const lastAtr = atrList[len5 - 1] || (symbol === 'NIFTY' ? 10 : 25);

      // Major Trend Alignment (15m Timeframe Filter)
      const len15 = candles15m.length;
      const last15mClose = candles15m[len15 - 1].close;
      const last15mEma20 = ema20_15m[len15 - 1] || last15mClose;
      const majorTrend = last15mClose > last15mEma20 ? 'BULLISH' : 'BEARISH';

      // VWAP Calculation
      let vwap = lastCandle.close;
      if (chartData.volume && chartData.volume.length > 0) {
        let vwapSum = 0;
        let volSum = 0;
        for (let i = Math.max(0, len5 - 50); i < len5; i++) {
          const typPrice = (chartData.high[i] + chartData.low[i] + chartData.close[i]) / 3;
          const vol = chartData.volume[i] || 1;
          vwapSum += typPrice * vol;
          volSum += vol;
        }
        if (volSum > 0) vwap = vwapSum / volSum;
      }

      // Calculate Chart Analysis Consensus Score
      let chartBullishScore = 0;
      let chartBearishScore = 0;

      if (lastCandle.close > lastEma9) chartBullishScore++; else chartBearishScore++;
      if (lastCandle.close > lastEma20) chartBullishScore++; else chartBearishScore++;
      if (lastEma9 > lastEma20) chartBullishScore++; else chartBearishScore++;
      if (macdLine > 0) chartBullishScore++; else chartBearishScore++;
      if (lastRsi < 40) chartBullishScore++; else if (lastRsi > 60) chartBearishScore++;
      if (lastCandle.close > vwap) chartBullishScore++; else chartBearishScore++;

      let chartSignal = 'WAIT';
      // 5m signal confirmation + 15m major trend alignment
      if (chartBullishScore >= 4 && lastCandle.close > lastEma9 && majorTrend === 'BULLISH') {
        chartSignal = 'CALL';
      } else if (chartBearishScore >= 4 && lastCandle.close < lastEma9 && majorTrend === 'BEARISH') {
        chartSignal = 'PUT';
      }

      // ATR-Based Dynamic Stoploss (1.5 * ATR) and Target (3.0 * ATR)
      const dynamicSlAmt = 1.5 * lastAtr;
      const dynamicTgtAmt = 3.0 * lastAtr;

      const callTarget = parseFloat((lastCandle.close + dynamicTgtAmt).toFixed(2));
      const callStoploss = parseFloat((lastCandle.close - dynamicSlAmt).toFixed(2));
      const putTarget = parseFloat((lastCandle.close - dynamicTgtAmt).toFixed(2));
      const putStoploss = parseFloat((lastCandle.close + dynamicSlAmt).toFixed(2));

      // Save Option Chain Signal
      if (optionSignal !== 'WAIT') {
        const target = optionSignal === 'CALL' ? spotPrice + (2.0 * lastAtr) : spotPrice - (2.0 * lastAtr);
        const sl = optionSignal === 'CALL' ? spotPrice - (1.0 * lastAtr) : spotPrice + (1.0 * lastAtr);
        
        db.get(`SELECT id FROM ai_signals WHERE symbol = ? AND source = 'OPTION_CHAIN' AND status = 'PENDING'`, [symbol], (err, row) => {
          if (!err && !row) {
            db.run(
              `INSERT INTO ai_signals (symbol, type, entry_price, target_price, stoploss_price, source) VALUES (?, ?, ?, ?, ?, 'OPTION_CHAIN')`,
              [symbol, optionSignal, spotPrice, parseFloat(target.toFixed(2)), parseFloat(sl.toFixed(2))]
            );
          }
        });
      }

      // Save Chart Signal
      if (chartSignal !== 'WAIT') {
        const target = chartSignal === 'CALL' ? callTarget : putTarget;
        const sl = chartSignal === 'CALL' ? callStoploss : putStoploss;
        
        db.get(`SELECT id FROM ai_signals WHERE symbol = ? AND source = 'CHART' AND status = 'PENDING'`, [symbol], (err, row) => {
          if (!err && !row) {
            db.run(
              `INSERT INTO ai_signals (symbol, type, entry_price, target_price, stoploss_price, source) VALUES (?, ?, ?, ?, ?, 'CHART')`,
              [symbol, chartSignal, lastCandle.close, target, sl]
            );
          }
        });
      }

      // Save Hybrid Convergence Signal (when both models agree, representing extreme accuracy)
      if (optionSignal !== 'WAIT' && optionSignal === chartSignal) {
        const target = optionSignal === 'CALL' ? callTarget : putTarget;
        const sl = optionSignal === 'CALL' ? callStoploss : putStoploss;
        
        db.get(`SELECT id FROM ai_signals WHERE symbol = ? AND source = 'HYBRID' AND status = 'PENDING'`, [symbol], (err, row) => {
          if (!err && !row) {
            db.run(
              `INSERT INTO ai_signals (symbol, type, entry_price, target_price, stoploss_price, source) VALUES (?, ?, ?, ?, ?, 'HYBRID')`,
              [symbol, optionSignal, lastCandle.close, target, sl],
              function(err) {
                if (!err) console.log(`Background auto-saved HYBRID signal for ${symbol} with ID: ${this.lastID}`);
              }
            );
          }
        });
      }

    } catch (err) {
      console.error(`Unified decoding failed for ${symbol}:`, err.message);
    }
  }
}

// Run unified decoder every 1 minute
setInterval(runAllDecoders, 60000);

// Run immediately on startup (wait 5s for token to be generated)
setTimeout(() => {
  runAllDecoders();
}, 5000);

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
