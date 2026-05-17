const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config({ path: '../.env' }); // Load .env from root

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

// CORS Middleware (simple for now)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.get('/api/test-dhan', async (req, res) => {
  const token = process.env.DHAN_ACCESS_TOKEN;
  
  if (!token) {
    return res.status(400).json({ success: false, message: 'Dhan Access Token not found in .env file' });
  }

  try {
    // Dhan v2 Profile Endpoint
    const response = await axios.get('https://api.dhan.co/v2/profile', {
      headers: {
        'access-token': token
      }
    });

    res.json({ success: true, data: response.data });
  } catch (error) {
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
