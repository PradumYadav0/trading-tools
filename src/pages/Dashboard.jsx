import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ArrowUpRight, ArrowDownRight, Activity, Zap, RefreshCw } from 'lucide-react';

const Dashboard = () => {
  const [niftyData, setNiftyData] = useState({ spot: 0, pcr: 0, loading: true });
  const [bankNiftyData, setBankNiftyData] = useState({ spot: 0, pcr: 0, loading: true });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = async () => {
    setIsRefreshing(true);
    try {
      // Fetch NIFTY Data
      const nResponse = await axios.get('/api/option-chain?symbol=NIFTY');
      if (nResponse.data.success) {
        const strikes = nResponse.data.data;
        const totalCallOi = strikes.reduce((sum, row) => sum + row.callOi, 0);
        const totalPutOi = strikes.reduce((sum, row) => sum + row.putOi, 0);
        const pcr = totalCallOi > 0 ? totalPutOi / totalCallOi : 1.0;
        
        setNiftyData({
          spot: nResponse.data.spotPrice,
          pcr: pcr.toFixed(2),
          loading: false
        });
      }
      
      // Fetch BANKNIFTY Data
      const bResponse = await axios.get('/api/option-chain?symbol=BANKNIFTY');
      if (bResponse.data.success) {
        const strikes = bResponse.data.data;
        const totalCallOi = strikes.reduce((sum, row) => sum + row.callOi, 0);
        const totalPutOi = strikes.reduce((sum, row) => sum + row.putOi, 0);
        const pcr = totalCallOi > 0 ? totalPutOi / totalCallOi : 1.0;
        
        setBankNiftyData({
          spot: bResponse.data.spotPrice,
          pcr: pcr.toFixed(2),
          loading: false
        });
      }
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000); // Auto refresh every 1 minute
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="container" style={{ padding: '2rem', color: 'white' }}>
      <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Welcome Back, Trader</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Here is your live market summary from Dhan API.</p>
        </div>
        
        <button 
          onClick={fetchData}
          disabled={isRefreshing}
          style={{ 
            background: 'var(--primary-color)', 
            color: 'white', 
            border: 'none', 
            padding: '0.5rem 1rem', 
            borderRadius: '8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}
        >
          <RefreshCw size={16} className={isRefreshing ? 'spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        
        {/* NIFTY Card */}
        <div className="glass-panel" style={{ flex: '1', minWidth: '240px', padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: 'bold' }}>NIFTY 50</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Live</span>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--accent-primary)' }}>
            {niftyData.loading ? 'Loading...' : niftyData.spot.toFixed(2)}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
            PCR: <span style={{ color: parseFloat(niftyData.pcr) >= 1 ? 'var(--bullish)' : 'var(--bearish)', fontWeight: 'bold' }}>{niftyData.pcr}</span>
          </div>
        </div>

        {/* BANKNIFTY Card */}
        <div className="glass-panel" style={{ flex: '1', minWidth: '240px', padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: 'bold' }}>BANK NIFTY</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Live</span>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--accent-primary)' }}>
            {bankNiftyData.loading ? 'Loading...' : bankNiftyData.spot.toFixed(2)}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
            PCR: <span style={{ color: parseFloat(bankNiftyData.pcr) >= 1 ? 'var(--bullish)' : 'var(--bearish)', fontWeight: 'bold' }}>{bankNiftyData.pcr}</span>
          </div>
        </div>

      </div>

      {/* Suggestion Box */}
      <div className="glass-panel" style={{ padding: '2rem', border: '1px solid var(--border-glow)', background: 'rgba(99, 102, 241, 0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <div style={{ width: '32px', height: '32px', background: 'rgba(99, 102, 241, 0.2)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Zap size={18} color="var(--accent-primary)" fill="var(--accent-primary)" />
          </div>
          <h2 style={{ fontSize: '1.5rem' }}>Quick Tip for Today</h2>
        </div>
        <p style={{ fontSize: '1.1rem', marginBottom: '1rem', lineHeight: '1.6' }}>
          Use the <span style={{ color: 'var(--accent-primary)', fontWeight: 'bold' }}>Option Decoder</span> page for advanced mathematical signals. It will tell you exactly when to BUY CALL or BUY PUT based on live data!
        </p>
        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <Activity size={16} /> Auto-refresh is ON (1m)
          </div>
          <div>|</div>
          <div>Data Source: Dhan API</div>
        </div>
      </div>

      <style>{`
        .spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default Dashboard;
