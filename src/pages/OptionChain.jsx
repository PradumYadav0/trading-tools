import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { RefreshCw, Filter, Zap, ZapOff, BarChart2, Calendar, Clock, Trophy, Database, Eye, EyeOff, Award } from 'lucide-react';

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
  const [lastUpdated, setLastUpdated] = useState(''); // Last update timestamp

  // History Mode State
  const [mode, setMode] = useState('live'); // 'live' or 'history'
  const [historyDate, setHistoryDate] = useState(new Date().toISOString().slice(0, 10));
  const [historySnapshots, setHistorySnapshots] = useState([]);
  const [selectedSnapshotIndex, setSelectedSnapshotIndex] = useState(0);

  // Responsive State
  const [showAllColumns, setShowAllColumns] = useState(false); // Toggle for mobile
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const fetchData = async () => {
    if (mode === 'history') return; // Don't fetch live data in history mode
    
    setIsRefreshing(true);
    try {
      const response = await axios.get(`/api/option-chain?symbol=${symbol}&expiry=${selectedExpiry}`);
      if (response.data.success) {
        setStrikes(response.data.data);
        setSpotPrice(response.data.spotPrice);
        setExpiry(response.data.expiry);
        setExpiryList(response.data.expiryList || []);
        setLastUpdated(new Date().toLocaleTimeString());
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

  const fetchHistoryData = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`/api/option-chain/history?symbol=${symbol}&date=${historyDate}`);
      if (response.data.success) {
        setHistorySnapshots(response.data.data);
        if (response.data.data.length > 0) {
          const latestSnap = response.data.data[0];
          setStrikes(latestSnap.data);
          setSpotPrice(latestSnap.spot_price);
          setExpiry(latestSnap.expiry);
          setLastUpdated(new Date(latestSnap.timestamp).toLocaleTimeString());
          setSelectedSnapshotIndex(0);
          setError(null);
        } else {
          setStrikes([]);
          setSpotPrice(0);
          setError('No data found for this date in database');
        }
      } else {
        setError(response.data.message || 'Failed to fetch history');
      }
    } catch (err) {
      setError(err.message || 'Server Error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mode === 'live') {
      fetchData();
    } else {
      fetchHistoryData();
    }
  }, [symbol, selectedExpiry, mode, historyDate]);

  const handleSnapshotChange = (index) => {
    setSelectedSnapshotIndex(index);
    const snap = historySnapshots[index];
    if (snap) {
      setStrikes(snap.data);
      setSpotPrice(snap.spot_price);
      setExpiry(snap.expiry);
      setLastUpdated(new Date(snap.timestamp).toLocaleTimeString());
    }
  };

  useEffect(() => {
    let interval = null;
    if (autoRefresh && mode === 'live') {
      interval = setInterval(() => {
        fetchData();
      }, 60000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh, symbol, selectedExpiry, mode]);

  const atmStrike = strikes.reduce((prev, curr) => {
    return (Math.abs(curr.strike - spotPrice) < Math.abs(prev.strike - spotPrice) ? curr : prev);
  }, strikes[0] || { strike: 0 }).strike;

  const atmIndex = strikes.findIndex(s => s.strike === atmStrike);
  const half = Math.floor(visibleStrikesCount / 2);
  
  const displayedStrikes = atmIndex >= 0 ? strikes.slice(
    Math.max(0, atmIndex - half),
    Math.min(strikes.length, atmIndex + half + 1)
  ) : strikes;

  useEffect(() => {
    if (displayedStrikes.length > 0) {
      setTimeout(() => {
        const spotLine = document.getElementById('spot-line');
        if (spotLine) {
          spotLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 500);
    }
  }, [strikes, visibleStrikesCount, symbol, selectedExpiry, selectedSnapshotIndex]);

  const totalCallOi = strikes.reduce((sum, row) => sum + row.callOi, 0);
  const totalPutOi = strikes.reduce((sum, row) => sum + row.putOi, 0);
  const pcr = totalCallOi > 0 ? (totalPutOi / totalCallOi).toFixed(2) : '0.00';

  // Helper to get Top 3 items
  const getTop3 = (arr, key) => {
    return [...arr]
      .filter(item => item[key] > 0)
      .sort((a, b) => b[key] - a[key])
      .slice(0, 3)
      .map(item => ({ strike: item.strike, value: item[key] }));
  };

  // Filter for OTM (Out of The Money) strikes for accurate Support/Resistance
  // For Calls, we look at strikes ABOVE the spot price
  // For Puts, we look at strikes BELOW the spot price
  const otmCalls = displayedStrikes.filter(s => s.strike >= spotPrice);
  const otmPuts = displayedStrikes.filter(s => s.strike <= spotPrice);

  const top3CallOi = getTop3(otmCalls, 'callOi');
  const top3PutOi = getTop3(otmPuts, 'putOi');
  const top3CallVol = getTop3(otmCalls, 'callVolume');
  const top3PutVol = getTop3(otmPuts, 'putVolume');

  const getRank = (topArr, value) => {
    const index = topArr.findIndex(item => item.value === value);
    return index !== -1 ? index + 1 : 0;
  };

  if (loading) {
    return <div className="container flex-center" style={{ height: '80vh' }}>Loading Option Chain data...</div>;
  }

  return (
    <div className="container">
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>Option Chain Analysis</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            
            {/* Mode Switcher */}
            <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '8px', padding: '2px' }}>
              <button
                onClick={() => setMode('live')}
                style={{
                  background: mode === 'live' ? 'var(--accent-primary)' : 'transparent',
                  color: mode === 'live' ? '#000' : 'var(--text-secondary)',
                  border: 'none',
                  padding: '0.3rem 0.75rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem'
                }}
              >
                <Zap size={14} /> Live
              </button>
              <button
                onClick={() => setMode('history')}
                style={{
                  background: mode === 'history' ? 'var(--accent-primary)' : 'transparent',
                  color: mode === 'history' ? '#000' : 'var(--text-secondary)',
                  border: 'none',
                  padding: '0.3rem 0.75rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem'
                }}
              >
                <Database size={14} /> History
              </button>
            </div>

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
                  background: '#1c2128',
                  color: '#fff',
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
            {mode === 'live' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Calendar size={16} style={{ color: 'var(--text-secondary)' }} />
                <select 
                  value={selectedExpiry || expiry} 
                  onChange={(e) => setSelectedExpiry(e.target.value)}
                  style={{
                    background: '#1c2128',
                    color: '#fff',
                    border: '1px solid var(--border-color)',
                    padding: '0.4rem 0.6rem',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '0.9rem'
                  }}
                >
                  {expiryList.map(exp => (
                    <option key={exp} value={exp} style={{ background: '#1c2128', color: '#fff' }}>{exp}</option>
                  ))}
                </select>
              </div>
            )}

            {/* History Date Picker */}
            {mode === 'history' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Calendar size={16} style={{ color: 'var(--text-secondary)' }} />
                <input 
                  type="date"
                  value={historyDate}
                  onChange={(e) => setHistoryDate(e.target.value)}
                  style={{
                    background: '#1c2128',
                    color: '#fff',
                    border: '1px solid var(--border-color)',
                    padding: '0.4rem 0.6rem',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '0.9rem'
                  }}
                />
              </div>
            )}

            {/* Time Slider */}
            {mode === 'history' && historySnapshots.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Clock size={16} style={{ color: 'var(--text-secondary)' }} />
                <select 
                  value={selectedSnapshotIndex} 
                  onChange={(e) => handleSnapshotChange(Number(e.target.value))}
                  style={{
                    background: '#1c2128',
                    color: '#fff',
                    border: '1px solid var(--border-color)',
                    padding: '0.4rem 0.6rem',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '0.9rem'
                  }}
                >
                  {historySnapshots.map((snap, index) => (
                    <option key={snap.id} value={index}>
                      {new Date(snap.timestamp).toLocaleTimeString()}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ 
              background: 'rgba(255, 255, 255, 0.03)', 
              padding: '0.25rem 0.75rem', 
              borderRadius: '8px',
              fontSize: '0.9rem',
              fontWeight: '600'
            }}>
              Spot: <span style={{ color: 'var(--accent-primary)' }}>{spotPrice.toFixed(2)}</span>
            </div>

            {/* PCR Display */}
            <div style={{ 
              background: 'rgba(255, 255, 255, 0.03)', 
              padding: '0.25rem 0.75rem', 
              borderRadius: '8px',
              fontSize: '0.9rem',
              fontWeight: '600'
            }}>
              PCR: <span style={{ color: parseFloat(pcr) > 1 ? 'var(--bullish)' : 'var(--bearish)' }}>{pcr}</span>
            </div>

            {/* Last Updated Time */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.25rem',
              fontSize: '0.85rem',
              color: 'var(--text-secondary)'
            }}>
              <Clock size={14} />
              <span>{mode === 'live' ? 'Last Updated:' : 'Saved At:'} {lastUpdated}</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* Column Toggle for Mobile */}
          <button
            className="mobile-only"
            onClick={() => setShowAllColumns(!showAllColumns)}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.9rem'
            }}
          >
            {showAllColumns ? <EyeOff size={16} /> : <Eye size={16} />}
            {showAllColumns ? 'Hide Vol/Chg' : 'Show Vol/Chg'}
          </button>

          {/* Auto Refresh Toggle */}
          {mode === 'live' && (
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
          )}

          {/* Filter Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Filter size={16} style={{ color: 'var(--text-secondary)' }} />
            <select 
              value={visibleStrikesCount} 
              onChange={(e) => setVisibleStrikesCount(Number(e.target.value))}
              style={{
                background: '#1c2128',
                color: '#fff',
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

          {mode === 'live' && (
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
          )}
        </div>
      </div>

      {/* Top Levels Dashboard requested by user */}
      <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1.5rem' }}>
        <h3 style={{ marginBottom: '0.75rem', fontSize: '1.1rem' }}>Top Open Interest & Volume Levels</h3>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: '1rem' }}>
          
          {/* Top Call OI (Resistance) */}
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid var(--bearish)' }}>
            <h4 style={{ color: 'var(--bearish)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>Resistances (Max Call OI)</h4>
            <div style={{ display: 'grid', gap: '0.25rem', fontSize: '0.8rem' }}>
              {top3CallOi.map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 'bold' }}>{item.strike}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{item.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top Put OI (Support) */}
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid var(--bullish)' }}>
            <h4 style={{ color: 'var(--bullish)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>Supports (Max Put OI)</h4>
            <div style={{ display: 'grid', gap: '0.25rem', fontSize: '0.8rem' }}>
              {top3PutOi.map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 'bold' }}>{item.strike}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{item.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top Call Volume */}
          {!isMobile && (
            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid #3B82F6' }}>
              <h4 style={{ color: '#3B82F6', fontSize: '0.85rem', marginBottom: '0.5rem' }}>High Volume Calls</h4>
              <div style={{ display: 'grid', gap: '0.25rem', fontSize: '0.8rem' }}>
                {top3CallVol.map((item, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 'bold' }}>{item.strike}</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{item.value.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top Put Volume */}
          {!isMobile && (
            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid #F59E0B' }}>
              <h4 style={{ color: '#F59E0B', fontSize: '0.85rem', marginBottom: '0.5rem' }}>High Volume Puts</h4>
              <div style={{ display: 'grid', gap: '0.25rem', fontSize: '0.8rem' }}>
                {top3PutVol.map((item, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 'bold' }}>{item.strike}</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{item.value.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div style={{ color: 'var(--bearish)', marginBottom: '1rem', padding: '0.5rem', background: 'rgba(255, 0, 0, 0.05)', borderRadius: '8px' }}>
          {error}
        </div>
      )}

      {strikes.length === 0 && !loading && !error && (
        <div className="glass-panel flex-center" style={{ height: '50vh', color: 'var(--text-secondary)' }}>
          No data available for the selected criteria.
        </div>
      )}

      {strikes.length > 0 && (
        <div className="glass-panel" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '0.85rem' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#161B22' }}>
              <tr className={!showAllColumns ? "mobile-hide" : ""} style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th colSpan={showAllColumns ? 4 : 2} style={{ padding: '0.75rem', color: 'var(--bearish)', borderRight: '1px solid var(--border-color)' }}>CALLS</th>
                <th style={{ padding: '0.75rem' }}>STRIKE</th>
                <th colSpan={showAllColumns ? 4 : 2} style={{ padding: '0.75rem', color: 'var(--bullish)', borderLeft: '1px solid var(--border-color)' }}>PUTS</th>
              </tr>
              <tr style={{ background: 'rgba(255, 255, 255, 0.01)', borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '0.5rem' }}>OI</th>
                <th className={!showAllColumns ? "mobile-hide" : ""} style={{ padding: '0.5rem' }}>Chg OI</th>
                <th className={!showAllColumns ? "mobile-hide" : ""} style={{ padding: '0.5rem' }}>Volume</th>
                <th style={{ padding: '0.5rem', borderRight: '1px solid var(--border-color)' }}>LTP</th>
                <th style={{ padding: '0.5rem' }}>Strike Price</th>
                <th style={{ padding: '0.5rem', borderLeft: '1px solid var(--border-color)' }}>LTP</th>
                <th className={!showAllColumns ? "mobile-hide" : ""} style={{ padding: '0.5rem' }}>Volume</th>
                <th className={!showAllColumns ? "mobile-hide" : ""} style={{ padding: '0.5rem' }}>Chg OI</th>
                <th style={{ padding: '0.5rem' }}>OI</th>
              </tr>
            </thead>
            <tbody>
              {displayedStrikes.flatMap((row, index) => {
                const isAtm = row.strike === atmStrike;
                
                const callOiRank = getRank(top3CallOi, row.callOi);
                const putOiRank = getRank(top3PutOi, row.putOi);
                const callVolRank = getRank(top3CallVol, row.callVolume);
                const putVolRank = getRank(top3PutVol, row.putVolume);
                
                const elements = [];
                
                elements.push(
                  <tr 
                    key={row.strike} 
                    style={{ 
                      borderBottom: '1px solid var(--border-color)', 
                      height: '35px',
                      background: isAtm ? 'rgba(255,255,255,0.02)' : 'transparent'
                    }}
                  >
                    {/* CALLS */}
                    <td style={{ 
                      color: 'var(--text-secondary)',
                      background: callOiRank === 1 ? 'rgba(255, 0, 0, 0.15)' : 
                                  callOiRank === 2 ? 'rgba(255, 0, 0, 0.1)' : 
                                  callOiRank === 3 ? 'rgba(255, 0, 0, 0.05)' : 'transparent',
                      fontWeight: callOiRank > 0 ? 'bold' : 'normal'
                    }}>
                      {row.callOi.toLocaleString()}
                      {callOiRank > 0 && <span style={{ fontSize: '0.75rem', color: 'var(--bearish)', marginLeft: '2px' }}>#{callOiRank}</span>}
                    </td>
                    <td className={!showAllColumns ? "mobile-hide" : ""} style={{ color: row.callChgOi > 0 ? 'var(--bearish)' : 'var(--bullish)' }}>
                      {row.callChgOi > 0 ? `+${row.callChgOi}` : row.callChgOi}
                    </td>
                    <td className={!showAllColumns ? "mobile-hide" : ""} style={{ 
                      color: 'var(--text-secondary)',
                      background: callVolRank === 1 ? 'rgba(59, 130, 246, 0.15)' : 
                                  callVolRank === 2 ? 'rgba(59, 130, 246, 0.1)' : 
                                  callVolRank === 3 ? 'rgba(59, 130, 246, 0.05)' : 'transparent'
                    }}>
                      {(row.callVolume || 0).toLocaleString()}
                      {callVolRank > 0 && <span style={{ fontSize: '0.75rem', color: '#3B82F6', marginLeft: '2px' }}>#{callVolRank}</span>}
                    </td>
                    <td style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-color)' }}>
                      {row.callLtp.toFixed(2)}
                    </td>

                    {/* STRIKE */}
                    <td style={{ fontWeight: '700', background: isAtm ? 'var(--accent-primary)' : 'transparent', color: isAtm ? '#000' : '#fff' }}>
                      {row.strike}
                    </td>

                    {/* PUTS */}
                    <td style={{ color: 'var(--text-primary)', borderLeft: '1px solid var(--border-color)' }}>
                      {row.putLtp.toFixed(2)}
                    </td>
                    <td className={!showAllColumns ? "mobile-hide" : ""} style={{ 
                      color: 'var(--text-secondary)',
                      background: putVolRank === 1 ? 'rgba(245, 158, 11, 0.15)' : 
                                  putVolRank === 2 ? 'rgba(245, 158, 11, 0.1)' : 
                                  putVolRank === 3 ? 'rgba(245, 158, 11, 0.05)' : 'transparent'
                    }}>
                      {(row.putVolume || 0).toLocaleString()}
                      {putVolRank > 0 && <span style={{ fontSize: '0.75rem', color: '#F59E0B', marginLeft: '2px' }}>#{putVolRank}</span>}
                    </td>
                    <td className={!showAllColumns ? "mobile-hide" : ""} style={{ color: row.putChgOi > 0 ? 'var(--bullish)' : 'var(--bearish)' }}>
                      {row.putChgOi > 0 ? `+${row.putChgOi}` : row.putChgOi}
                    </td>
                    <td style={{ 
                      color: 'var(--text-secondary)',
                      background: putOiRank === 1 ? 'rgba(0, 200, 5, 0.15)' : 
                                  putOiRank === 2 ? 'rgba(0, 200, 5, 0.1)' : 
                                  putOiRank === 3 ? 'rgba(0, 200, 5, 0.05)' : 'transparent',
                      fontWeight: putOiRank > 0 ? 'bold' : 'normal'
                    }}>
                      {row.putOi.toLocaleString()}
                      {putOiRank > 0 && <span style={{ fontSize: '0.75rem', color: 'var(--bullish)', marginLeft: '2px' }}>#{putOiRank}</span>}
                    </td>
                  </tr>
                );

                // Insert Dhan-style Spot Price Line
                const nextRow = displayedStrikes[index + 1];
                if (nextRow && row.strike <= spotPrice && nextRow.strike > spotPrice) {
                  elements.push(
                    <tr key="spot-line" id="spot-line" style={{ height: '15px', background: 'transparent' }}>
                      <td colSpan={showAllColumns || !isMobile ? 9 : 5} style={{ padding: '0', position: 'relative', verticalAlign: 'middle' }}>
                        <div style={{ 
                          height: '2px', 
                          background: 'var(--accent-primary)', 
                          width: '100%',
                          boxShadow: '0 0 10px var(--accent-primary)',
                          position: 'relative'
                        }}>
                          <span style={{ 
                            position: 'absolute', 
                            top: '50%', 
                            left: '50%', 
                            transform: 'translate(-50%, -50%)',
                            background: 'var(--accent-primary)',
                            color: '#000',
                            padding: '0.1rem 0.4rem',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            fontWeight: '700',
                            zIndex: 3,
                            whiteSpace: 'nowrap'
                          }}>
                            {spotPrice.toFixed(2)}
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
      )}

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @media (max-width: 768px) {
          .mobile-hide {
            display: none !important;
          }
          table {
            font-size: 0.75rem !important;
          }
          th, td {
            padding: 0.25rem !important;
          }
        }
        @media (min-width: 769px) {
          .mobile-only {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
};

export default OptionChain;
