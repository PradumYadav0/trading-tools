import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { RefreshCw, Filter, Zap, ZapOff, BarChart2, Calendar } from 'lucide-react';

const OptionChain = () => {
  const [spotPrice, setSpotPrice] = useState(0);
  const [strikes, setStrikes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expiry, setExpiry] = useState('');
  const [expiryList, setExpiryList] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [visibleStrikesCount, setVisibleStrikesCount] = useState(30); // Default to 30
  const [autoRefresh, setAutoRefresh] = useState(false); // Default to off
  const [symbol, setSymbol] = useState('NIFTY'); // Default to NIFTY
  const [selectedExpiry, setSelectedExpiry] = useState(''); // Selected expiry

  const fetchData = async () => {
    setIsRefreshing(true);
    try {
      const response = await axios.get(`/api/option-chain?symbol=${symbol}&expiry=${selectedExpiry}`);
      if (response.data.success) {
        setStrikes(response.data.data);
        setSpotPrice(response.data.spotPrice);
        setExpiry(response.data.expiry);
        setExpiryList(response.data.expiryList || []);
        setLoading(false);
        setError(null);
      } else {
        const detailStr = response.data.details ? JSON.stringify(response.data.details) : '';
        setError(`${response.data.message} ${detailStr}`.trim() || 'Failed to fetch data');
        setLoading(false);
      }
    } catch (err) {
      setError(err.message || 'Server Error');
      setLoading(false);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [symbol, selectedExpiry]); // Refetch when symbol or expiry changes

  // Auto-Refresh Logic (1 Minute interval)
  useEffect(() => {
    let interval = null;
    if (autoRefresh) {
      interval = setInterval(() => {
        fetchData();
      }, 60000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh, symbol, selectedExpiry]);

  // Find ATM Strike
  const atmStrike = strikes.reduce((prev, curr) => {
    return (Math.abs(curr.strike - spotPrice) < Math.abs(prev.strike - spotPrice) ? curr : prev);
  }, strikes[0] || { strike: 0 }).strike;

  // Filter to show N strikes around ATM
  const atmIndex = strikes.findIndex(s => s.strike === atmStrike);
  const half = Math.floor(visibleStrikesCount / 2);
  
  const displayedStrikes = atmIndex >= 0 ? strikes.slice(
    Math.max(0, atmIndex - half),
    Math.min(strikes.length, atmIndex + half + 1)
  ) : strikes;

  // Auto-center Spot Line
  useEffect(() => {
    if (displayedStrikes.length > 0) {
      setTimeout(() => {
        const spotLine = document.getElementById('spot-line');
        if (spotLine) {
          spotLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 500);
    }
  }, [strikes, visibleStrikesCount, symbol, selectedExpiry]);

  if (loading) {
    return <div className="container flex-center" style={{ height: '80vh' }}>Loading Option Chain from Dhan API...</div>;
  }

  if (error) {
    return (
      <div className="container flex-center" style={{ height: '80vh', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ color: 'var(--bearish)', fontSize: '1.2rem' }}>Error: {error}</div>
        <p style={{ color: 'var(--text-secondary)' }}>Dhan API might be rate limiting or token is invalid.</p>
        <button 
          onClick={fetchData} 
          style={{
            background: 'var(--accent-primary)',
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
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="container">
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>Option Chain Analysis</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            
            {/* Symbol Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <BarChart2 size={16} style={{ color: 'var(--text-secondary)' }} />
              <select 
                value={symbol} 
                onChange={(e) => {
                  setSymbol(e.target.value);
                  setSelectedExpiry(''); // Reset expiry when symbol changes
                }}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  padding: '0.4rem 0.6rem',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: '600'
                }}
              >
                <option value="NIFTY">NIFTY</option>
                <option value="BANKNIFTY">BANKNIFTY</option>
              </select>
            </div>

            {/* Expiry Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Calendar size={16} style={{ color: 'var(--text-secondary)' }} />
              <select 
                value={selectedExpiry || expiry} 
                onChange={(e) => setSelectedExpiry(e.target.value)}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  padding: '0.4rem 0.6rem',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '0.9rem'
                }}
              >
                {expiryList.map(exp => (
                  <option key={exp} value={exp}>{exp}</option>
                ))}
              </select>
            </div>

            <div style={{ 
              background: 'rgba(255, 255, 255, 0.03)', 
              padding: '0.25rem 0.75rem', 
              borderRadius: '8px',
              fontSize: '0.9rem',
              fontWeight: '600'
            }}>
              Spot: <span style={{ color: 'var(--accent-primary)' }}>{spotPrice.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* Auto Refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            style={{
              background: autoRefresh ? 'rgba(0, 200, 5, 0.1)' : 'rgba(255, 255, 255, 0.05)',
              color: autoRefresh ? '#00c805' : 'var(--text-secondary)',
              border: `1px solid ${autoRefresh ? '#00c805' : 'var(--border-color)'}`,
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.9rem',
              transition: 'var(--transition-smooth)'
            }}
          >
            {autoRefresh ? <Zap size={16} /> : <ZapOff size={16} />}
            {autoRefresh ? 'Live Auto-Refresh (1m)' : 'Auto-Refresh Off'}
          </button>

          {/* Filter Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Filter size={16} style={{ color: 'var(--text-secondary)' }} />
            <select 
              value={visibleStrikesCount} 
              onChange={(e) => setVisibleStrikesCount(Number(e.target.value))}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                padding: '0.5rem',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '0.9rem'
              }}
            >
              <option value={10}>Show 10 Strikes</option>
              <option value={20}>Show 20 Strikes</option>
              <option value={30}>Show 30 Strikes</option>
              <option value={50}>Show 50 Strikes</option>
            </select>
          </div>

          <button 
            onClick={fetchData} 
            disabled={isRefreshing}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              padding: '0.5rem 1rem',
              borderRadius: '10px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'var(--transition-smooth)'
            }}
          >
            <RefreshCw size={16} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
            {isRefreshing ? 'Refreshing...' : 'Refresh Data'}
          </button>
        </div>
      </div>

      <div className="glass-panel">
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '0.85rem' }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#161B22' }}>
            <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
              <th colSpan="4" style={{ padding: '0.75rem', color: 'var(--bearish)', borderRight: '1px solid var(--border-color)' }}>CALLS</th>
              <th style={{ padding: '0.75rem' }}>STRIKE</th>
              <th colSpan="4" style={{ padding: '0.75rem', color: 'var(--bullish)', borderLeft: '1px solid var(--border-color)' }}>PUTS</th>
            </tr>
            <tr style={{ background: 'rgba(255, 255, 255, 0.01)', borderBottom: '1px solid var(--border-color)' }}>
              <th style={{ padding: '0.5rem' }}>OI</th>
              <th style={{ padding: '0.5rem' }}>Chg OI</th>
              <th style={{ padding: '0.5rem' }}>Volume</th>
              <th style={{ padding: '0.5rem', borderRight: '1px solid var(--border-color)' }}>LTP</th>
              <th style={{ padding: '0.5rem' }}>Strike Price</th>
              <th style={{ padding: '0.5rem', borderLeft: '1px solid var(--border-color)' }}>LTP</th>
              <th style={{ padding: '0.5rem' }}>Volume</th>
              <th style={{ padding: '0.5rem' }}>Chg OI</th>
              <th style={{ padding: '0.5rem' }}>OI</th>
            </tr>
          </thead>
          <tbody>
            {displayedStrikes.flatMap((row, index) => {
              const isAtm = row.strike === atmStrike;
              const elements = [];
              
              elements.push(
                <tr 
                  key={row.strike} 
                  style={{ 
                    borderBottom: '1px solid var(--border-color)', 
                    height: '35px'
                  }}
                >
                  <td style={{ color: 'var(--text-secondary)' }}>{row.callOi.toLocaleString()}</td>
                  <td style={{ color: row.callChgOi > 0 ? 'var(--bearish)' : 'var(--bullish)' }}>
                    {row.callChgOi > 0 ? `+${row.callChgOi}` : row.callChgOi}
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{(row.callVolume || 0).toLocaleString()}</td>
                  <td style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-color)' }}>
                    {row.callLtp.toFixed(2)}
                  </td>
                  <td style={{ fontWeight: '700' }}>
                    {row.strike}
                  </td>
                  <td style={{ color: 'var(--text-primary)', borderLeft: '1px solid var(--border-color)' }}>
                    {row.putLtp.toFixed(2)}
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{(row.putVolume || 0).toLocaleString()}</td>
                  <td style={{ color: row.putChgOi > 0 ? 'var(--bullish)' : 'var(--bearish)' }}>
                    {row.putChgOi > 0 ? `+${row.putChgOi}` : row.putChgOi}
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{row.putOi.toLocaleString()}</td>
                </tr>
              );

              // Insert Dhan-style Spot Price Line
              const nextRow = displayedStrikes[index + 1];
              if (nextRow && row.strike <= spotPrice && nextRow.strike > spotPrice) {
                elements.push(
                  <tr key="spot-line" id="spot-line" style={{ height: '3px', background: 'transparent' }}>
                    <td colSpan="9" style={{ padding: '0', position: 'relative' }}>
                      <div style={{ 
                        height: '3px', 
                        background: 'var(--accent-primary)', 
                        width: '100%',
                        boxShadow: '0 0 10px var(--accent-primary)'
                      }}>
                        <span style={{ 
                          position: 'absolute', 
                          top: '-10px', 
                          left: '50%', 
                          transform: 'translateX(-50%)',
                          background: 'var(--accent-primary)',
                          color: '#000',
                          padding: '0.1rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: '700',
                          zIndex: 3
                        }}>
                          SPOT: {spotPrice.toFixed(2)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              }

              return elements;
            })}
          </tbody>
        </table>
      </div>

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default OptionChain;
