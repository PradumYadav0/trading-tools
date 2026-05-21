import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ArrowUpRight, ArrowDownRight, Activity, Zap, RefreshCw } from 'lucide-react';
import { isMarketOpen } from '../utils/market';

const Dashboard = () => {
  const [indexData, setIndexData] = useState({
    'NIFTY': { name: 'NIFTY 50', spot: 0, pcr: 0, loading: true },
    'BANKNIFTY': { name: 'BANK NIFTY', spot: 0, pcr: 0, loading: true },
    'FINNIFTY': { name: 'FINNIFTY', spot: 0, pcr: 0, loading: true },
    'MIDCPNIFTY': { name: 'MIDCPNIFTY', spot: 0, pcr: 0, loading: true }
  });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = async () => {
    setIsRefreshing(true);
    const symbols = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];
    
    await Promise.all(symbols.map(async (symbol) => {
      try {
        const response = await axios.get(`/api/option-chain?symbol=${symbol}`);
        if (response.data.success) {
          const strikes = response.data.data;
          const totalCallOi = strikes.reduce((sum, row) => sum + row.callOi, 0);
          const totalPutOi = strikes.reduce((sum, row) => sum + row.putOi, 0);
          const pcr = totalCallOi > 0 ? totalPutOi / totalCallOi : 1.0;
          
          setIndexData(prev => ({
            ...prev,
            [symbol]: {
              ...prev[symbol],
              spot: response.data.spotPrice,
              pcr: pcr.toFixed(2),
              loading: false
            }
          }));
        } else {
          setIndexData(prev => ({
            ...prev,
            [symbol]: {
              ...prev[symbol],
              loading: false
            }
          }));
        }
      } catch (err) {
        console.error(`Error fetching data for ${symbol}:`, err);
        setIndexData(prev => ({
          ...prev,
          [symbol]: {
            ...prev[symbol],
            loading: false
          }
        }));
      }
    }));
    setIsRefreshing(false);
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      if (isMarketOpen()) {
        fetchData();
      }
    }, 60000); // Auto refresh every 1 minute if market is open
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="container" style={{ padding: '2rem', color: 'white' }}>
      <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Welcome Back, Trader</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Here is your live market summary from Dhan API.</p>
        </div>
        
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {/* Market Status Badge */}
          <div style={{
            background: isMarketOpen() ? 'rgba(0, 200, 5, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            color: isMarketOpen() ? '#00c805' : '#ef4444',
            border: `1px solid ${isMarketOpen() ? '#00c805' : '#ef4444'}`,
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            fontSize: '0.9rem',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem'
          }}>
            <span style={{ fontSize: '0.6rem' }}>●</span> {isMarketOpen() ? 'Live' : 'Closed'}
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
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        {Object.entries(indexData).map(([key, data]) => (
          <div key={key} className="glass-panel" style={{ flex: '1', minWidth: '240px', padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: 'bold' }}>{data.name}</span>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{isMarketOpen() ? 'Live' : 'Closed'}</span>
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--accent-primary)' }}>
              {data.loading ? 'Loading...' : (typeof data.spot === 'number' ? data.spot.toFixed(2) : data.spot)}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
              PCR: <span style={{ color: parseFloat(data.pcr) >= 1 ? 'var(--bullish)' : 'var(--bearish)', fontWeight: 'bold' }}>{data.pcr}</span>
            </div>
          </div>
        ))}
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
            <Activity size={16} /> Auto-refresh is {isMarketOpen() ? 'ON (1m)' : 'OFF (Market Closed)'}
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
