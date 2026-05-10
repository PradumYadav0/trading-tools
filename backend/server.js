const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');
const kotakNeo = require('./services/kotakNeoService');
const dbService = require('./services/DatabaseService');


dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

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

const nseFetcher = require('./services/NseFetcher');

// Option Chain Endpoint with Greeks
app.get('/api/option-chain', async (req, res) => {
  const { symbol, expiry } = req.query;
  const isBN = symbol === 'BANKNIFTY';
  let basePrice = isBN ? 48200 : 22400;
  
  let options = [];
  
  try {
     // Fetch REAL Data from NSE API
     const nseData = await nseFetcher.getOptionChain(symbol || 'NIFTY');
     
     if (nseData && nseData.records && nseData.records.data) {
         basePrice = nseData.records.underlyingValue;
         const currentExpiry = nseData.records.expiryDates[0];
         
         // Filter data for current expiry and closest strikes
         const chain = nseData.records.data
            .filter(item => item.expiryDate === currentExpiry)
            .sort((a, b) => a.strikePrice - b.strikePrice);
            
         // Find ATM strike index
         let atmIndex = 0;
         let minDiff = Infinity;
         chain.forEach((item, index) => {
             const diff = Math.abs(item.strikePrice - basePrice);
             if (diff < minDiff) {
                 minDiff = diff;
                 atmIndex = index;
             }
         });
         
         // Take 5 ITM, 1 ATM, 5 OTM
         const startIndex = Math.max(0, atmIndex - 5);
         const endIndex = Math.min(chain.length, atmIndex + 6);
         const selectedChain = chain.slice(startIndex, endIndex);
         
         options = selectedChain.map(item => ({
             strike: item.strikePrice,
             CE: item.CE ? {
                 ltp: item.CE.lastPrice.toFixed(2),
                 oi: item.CE.openInterest * 50, // Convert to approx shares
                 volume: item.CE.totalTradedVolume * 50,
                 iv: item.CE.impliedVolatility.toFixed(2),
                 delta: "0.50", // Placeholder until Kotak IV/Greeks map
                 theta: "-5.00",
                 gamma: "0.002",
                 vega: "10.00"
             } : null,
             PE: item.PE ? {
                 ltp: item.PE.lastPrice.toFixed(2),
                 oi: item.PE.openInterest * 50,
                 volume: item.PE.totalTradedVolume * 50,
                 iv: item.PE.impliedVolatility.toFixed(2),
                 delta: "-0.50",
                 theta: "-5.00",
                 gamma: "0.002",
                 vega: "10.00"
             } : null
         }));
     }
  } catch (error) {
     console.error('Failed to parse NSE data', error);
  }

  // Fallback if NSE blocks us
  if (options.length === 0) {
      const step = isBN ? 100 : 50;
      for (let i = -5; i <= 5; i++) {
        const strike = basePrice + (i * step);
        options.push({
          strike: strike,
          CE: { ltp: "150.00", oi: 1500000, volume: 800000, iv: "14.20", delta: "0.50", theta: "-5.50", gamma: "0.0025", vega: "11.20" },
          PE: { ltp: "160.00", oi: 1400000, volume: 750000, iv: "15.10", delta: "-0.50", theta: "-4.80", gamma: "0.0028", vega: "10.90" }
        });
      }
  }

  // Save the current snapshot to the Database for historical backtesting
  await dbService.saveOptionChain(symbol || 'NIFTY', basePrice, options);

  res.json({
    success: true,
    symbol: symbol || 'NIFTY',
    spotPrice: basePrice,
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
        res.json({ success: true, token });
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
