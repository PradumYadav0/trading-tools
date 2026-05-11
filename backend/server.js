const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');
const kotakNeo = require('./services/kotakNeoService');
const dbService = require('./services/DatabaseService');
const newsService = require('./services/NewsService');

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// Live News Endpoint
app.get('/api/news', async (req, res) => {
  const news = await newsService.getLiveNews();
  res.json({ success: true, data: news });
});

// Dynamic Market Data Generator
const getMockData = (symbol) => {
  const isBN = symbol === 'BANKNIFTY';
  const basePrice = isBN ? 48200 : 22400;
  const randomMove = 25.50; // Frozen value
  const currentPrice = basePrice + randomMove;
  const pcr = 1.15;
  
  return {
    symbol,
    price: currentPrice.toFixed(2),
    change: (randomMove / basePrice * 100).toFixed(2),
    pcr: pcr,
    rsi: (40 + Math.random() * 30).toFixed(1),
    isMarketOpen: false,
    strikes: Array.from({ length: 21 }, (_, i) => {
      const step = isBN ? 100 : 50;
      const start = basePrice - (step * 10);
      return start + (i * step);
    }),
    signals: {
      type: pcr > 1.1 ? 'BUY' : pcr < 0.8 ? 'SELL' : 'NONE',
      strike: isBN ? '48100 CE' : '22400 CE',
      target: (currentPrice + (isBN ? 200 : 50)).toFixed(2),
      sl: (currentPrice - (isBN ? 100 : 30)).toFixed(2)
    }
  };
};

// Endpoint to get Market Data
app.get('/api/market-data', (req, res) => {
  const { symbol } = req.query;
  const data = getMockData(symbol || 'BANKNIFTY');
  res.json(data);
});

// Option Chain Endpoint with Greeks
app.get('/api/option-chain', async (req, res) => {
  const { symbol, expiry } = req.query;
  const isBN = symbol === 'BANKNIFTY';
  const basePrice = isBN ? 48200 : 22400; // Will be replaced by live Spot price in production
  const step = isBN ? 100 : 50;
  
  let optionsMap = {};
  let fetchErrorMsg = null;
  
  try {
     // STRICTLY USE KOTAK NEO API
     // This will only work if Kotak Neo is successfully connected
     if (kotakNeo.sessionToken) {
         // Lazy load master scrip if user logged in earlier but scrip wasn't loaded
         if (!kotakNeo.masterScripLoaded) {
             console.log("Session active but scrip not loaded. Loading now...");
             await kotakNeo.fetchAndParseMasterScrip();
         }

         if (kotakNeo.masterScripLoaded) {
             const allTokens = kotakNeo.getOptionTokens(symbol || 'NIFTY');
         if (allTokens && allTokens.length > 0) {
             // 1. Find the closest expiry date
             const sortedExpiries = [...new Set(allTokens.map(t => t.expiry))].sort((a, b) => moment(a, "DD-MMM-YYYY").valueOf() - moment(b, "DD-MMM-YYYY").valueOf());
             const targetExpiry = expiry || sortedExpiries[0];

             // 2. Filter for nearest strikes (-25 to +25) AND the target expiry
             const minStrike = basePrice - (25 * step);
             const maxStrike = basePrice + (25 * step);
             
             const targetTokens = allTokens.filter(t => {
                 const strikeNum = parseFloat(t.strike);
                 return t.expiry === targetExpiry && strikeNum >= minStrike && strikeNum <= maxStrike;
             });

             // Initialize Map
             for (let i = -25; i <= 25; i++) {
                 optionsMap[basePrice + (i * step)] = {
                    strike: basePrice + (i * step),
                    CE: { ltp: "---", oi: 0, volume: 0, iv: "0.00", delta: "0.00", theta: "0.00", gamma: "0.00", vega: "0.00" },
                    PE: { ltp: "---", oi: 0, volume: 0, iv: "0.00", delta: "0.00", theta: "0.00", gamma: "0.00", vega: "0.00" }
                 };
             }

             if (targetTokens.length > 0) {
                 // Kotak API expects exchange segment prefixed tokens
                 const tokenStrs = targetTokens.map(t => `nse_fo-${t.token}`);
                 
                 // Fetch in chunks of 50 to avoid URL length / API limits
                 let allQuotes = [];
                 for (let i = 0; i < tokenStrs.length; i += 50) {
                     const chunk = tokenStrs.slice(i, i + 50);
                     try {
                         const resp = await kotakNeo.getQuotes(chunk);
                         // Kotak might return 200 OK but with an error inside
                         if (resp && Array.isArray(resp.data)) {
                             allQuotes = allQuotes.concat(resp.data);
                         } else if (resp && resp.success) {
                             allQuotes = allQuotes.concat(resp.success);
                         } else {
                             // Silent failure (e.g. 200 OK but error payload)
                             console.error("Silent API Failure:", JSON.stringify(resp));
                             fetchErrorMsg = "Silent Failure: " + JSON.stringify(resp).substring(0, 100);
                         }
                     } catch (e) {
                         console.error("Chunk fetch failed", e.message);
                         fetchErrorMsg = e.response ? JSON.stringify(e.response.data) : e.message;
                     }
                 }
                 
                 // Process live data
                 if (allQuotes.length > 0) {
                     const quotes = allQuotes; // Array of quote objects
                     
                     // 2. Map data
                     targetTokens.forEach(t => {
                         const strike = parseFloat(t.strike);
                         const type = t.optType === 'CE' ? 'CE' : 'PE';
                         
                         // Find quote for this token
                         const quote = quotes.find(q => 
                            String(q.instrumentToken) === String(t.token) || 
                            String(q.instrumentToken) === `nse_fo-${t.token}` ||
                            String(q.instrumentTokens?.[0]?.instrument_token) === String(t.token)
                         );
                         
                         if (quote && optionsMap[strike]) {
                             const ltp = parseFloat(quote.lastPrice || quote.ltp || 0);
                             optionsMap[strike][type].ltp = ltp > 0 ? ltp.toFixed(2) : "---";
                             optionsMap[strike][type].oi = parseInt(quote.openInterest || quote.oi || 0);
                             optionsMap[strike][type].volume = parseInt(quote.volume || quote.v || 0);
                             
                             // 3. Calculate Greeks using OptionMath
                             const OptionMath = require('./utils/OptionMath');
                             if (ltp > 0) {
                                 const greeks = OptionMath.calculateGreeks(type, basePrice, strike, ltp, t.expiry || moment().format("DD-MMM-YYYY"));
                                 optionsMap[strike][type] = { ...optionsMap[strike][type], ...greeks };
                             }
                         }
                     });
                 }
                 }
             }
         }
     }
  } catch (error) {
      console.error('Failed to fetch from Kotak', error.message);
      fetchErrorMsg = error.message;
  }

  let options = Object.values(optionsMap).sort((a, b) => a.strike - b.strike);

  // If market is closed, Kotak not mapped yet, or API failed, show frozen framework
  if (options.length === 0) {
      for (let i = -25; i <= 25; i++) {
        const strike = basePrice + (i * step);
        options.push({
          strike: strike,
          CE: { ltp: "---", oi: 0, volume: 0, iv: "0.00", delta: "0.00", theta: "0.00", gamma: "0.00", vega: "0.00" },
          PE: { ltp: "---", oi: 0, volume: 0, iv: "0.00", delta: "0.00", theta: "0.00", gamma: "0.00", vega: "0.00" }
        });
      }
  }

  // Save the current snapshot to the Database for historical backtesting
  await dbService.saveOptionChain(symbol || 'NIFTY', basePrice, options);

  res.json({
    success: true,
    symbol: symbol || 'NIFTY',
    spotPrice: basePrice,
    apiError: fetchErrorMsg, // Added for debugging
    data: options
  });
});

// Historical Option Chain Endpoint (from Database)
app.get('/api/historical-option-chain', async (req, res) => {
  const { symbol, limit } = req.query;
  try {
    const data = await dbService.getHistoricalOptionChain(symbol || 'NIFTY', parseInt(limit) || 10);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch historical data' });
  }
});

const { GoogleGenAI } = require('@google/genai');

// AI Insights Endpoint (Using Gemini API)
app.post('/api/ai-insights', async (req, res) => {
  const { symbol, data } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    return res.json({ insight: "Gemini API key is missing. Please add GEMINI_API_KEY in the Settings or .env file." });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: apiKey });
    
    const prompt = `You are an expert quantitative stock market analyst. Analyze this live options data for ${symbol}. 
    Current Price: ${data.price}. PCR: ${data.pcr}. 
    Data: ${JSON.stringify(data.signals)}
    
    Give a sharp, 3-sentence professional verdict on the trend and where the smart money is moving. Mention Support, Resistance, and whether to Buy/Sell/Wait.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5',
      contents: prompt,
    });

    res.json({ insight: response.text });
  } catch (error) {
    console.error("Gemini API Error:", error);
    res.json({ insight: "AI Analysis failed to process current market data." });
  }
});

// Kotak Neo Login Endpoint
app.post('/api/kotak/login', async (req, res) => {
    try {
        const result = await kotakNeo.login();
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Kotak Neo TOTP Validation
app.post('/api/kotak/validate-totp', async (req, res) => {
    const { totp } = req.body;
    try {
        const token = await kotakNeo.validateTOTP(totp);
        
        // As soon as login is successful, trigger the CSV download!
        // We do it asynchronously without waiting, or await it. Awaiting ensures it's ready.
        const scripResult = await kotakNeo.fetchAndParseMasterScrip();
        
        res.json({ success: true, token, scripLoaded: scripResult.success });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Real Market Data (Optional if connected)
app.get('/api/kotak/quotes', async (req, res) => {
    const { symbols } = req.query;
    try {
        const quotes = await kotakNeo.getQuotes(symbols.split(','));
        res.json({ success: true, data: quotes });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
