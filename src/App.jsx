import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import axios from 'axios';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Analysis from './pages/Analysis';
import RiskManagement from './pages/RiskManagement';
import SignalRoom from './pages/SignalRoom';
import Settings from './pages/Settings';
import AIInsights from './pages/AIInsights';

function App() {
  const [activeSymbol, setActiveSymbol] = useState('BANKNIFTY');
  const [marketData, setMarketData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await axios.get(`http://localhost:5000/api/market-data?symbol=${activeSymbol}`);
        setMarketData(response.data);
        setLoading(false);

      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 2000);
    return () => clearInterval(interval);
  }, [activeSymbol]);

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0b0f' }}>
        <div className="animate-pulse-subtle" style={{ color: 'var(--primary)', fontSize: '20px', fontWeight: 800 }}>
          INITIALIZING TRADING PRO ENGINE...
        </div>
      </div>
    );
  }

  return (
    <Router>
      <div style={{ display: 'flex', minHeight: '100vh', background: '#050608', padding: '16px', gap: '16px', paddingBottom: '50px' }}>
        <Sidebar />
        
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Header activeSymbol={activeSymbol} setActiveSymbol={setActiveSymbol} />
          
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <Routes>
              <Route path="/" element={<Dashboard activeSymbol={activeSymbol} marketData={marketData} />} />
              <Route path="/signal" element={<SignalRoom activeSymbol={activeSymbol} data={marketData} />} />
              <Route path="/analysis" element={<Analysis activeSymbol={activeSymbol} data={marketData} />} />
              <Route path="/risk" element={<RiskManagement />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/insights" element={<AIInsights activeSymbol={activeSymbol} data={marketData} />} />
            </Routes>
          </div>
        </div>

        {/* Scrolling News Ticker */}
        <div style={{ 
          position: 'fixed', 
          bottom: 0, 
          left: 0, 
          width: '100%', 
          background: 'rgba(0,0,0,0.8)', 
          backdropFilter: 'blur(10px)',
          borderTop: '1px solid var(--border)',
          padding: '8px 0',
          zIndex: 1000
        }}>
          <marquee scrollamount="5" style={{ color: 'var(--primary)', fontWeight: 600, fontSize: '13px' }}>
            🔥 BREAKING: FIIs net buyers of ₹1,420 Cr today... ⚡ RBI expected to keep rates unchanged in next meeting... 📊 Nifty OI shows strong support at 22,300... 🚀 Bank Nifty HDFC weightage update expected soon...
          </marquee>
        </div>
      </div>
    </Router>
  );
}

export default App;
