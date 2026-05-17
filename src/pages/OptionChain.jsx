import React, { useState, useEffect } from 'react';

const OptionChain = () => {
  const [spotPrice, setSpotPrice] = useState(22415);
  const [strikes, setStrikes] = useState([]);
  
  // Generate 50 strikes centered around 22400
  useEffect(() => {
    const baseStrike = 22400;
    const step = 50;
    const count = 50;
    const startStrike = baseStrike - (Math.floor(count / 2) * step);
    
    const initialStrikes = [];
    for (let i = 0; i < count; i++) {
      const strike = startStrike + (i * step);
      // Mock some realistic values
      const distanceFromAtm = Math.abs(strike - spotPrice);
      const isCallItm = strike < spotPrice;
      const isPutItm = strike > spotPrice;
      
      initialStrikes.push({
        strike,
        callOi: Math.floor(10000 + Math.random() * 50000 - distanceFromAtm * 10),
        callChgOi: Math.floor(Math.random() * 5000 - 2500),
        callLtp: Math.max(1, isCallItm ? (spotPrice - strike) + Math.random() * 20 : 100 - (distanceFromAtm / 5)),
        putLtp: Math.max(1, isPutItm ? (strike - spotPrice) + Math.random() * 20 : 100 - (distanceFromAtm / 5)),
        putChgOi: Math.floor(Math.random() * 5000 - 2500),
        putOi: Math.floor(10000 + Math.random() * 50000 - distanceFromAtm * 10),
        updateStatus: null // 'up', 'down', or null
      });
    }
    setStrikes(initialStrikes);
  }, []);

  // Find ATM Strike
  const atmStrike = strikes.reduce((prev, curr) => {
    return (Math.abs(curr.strike - spotPrice) < Math.abs(prev.strike - spotPrice) ? curr : prev);
  }, strikes[0] || { strike: 22400 }).strike;

  // Simulate Live Updates
  useEffect(() => {
    if (strikes.length === 0) return;

    const interval = setInterval(() => {
      // Randomly change spot price slightly
      setSpotPrice(prev => prev + (Math.random() * 10 - 5));

      setStrikes(prevStrikes => {
        return prevStrikes.map(row => {
          // Only update 20% of rows to look realistic
          if (Math.random() > 0.2) {
            return { ...row, updateStatus: null };
          }

          const callLtpChg = (Math.random() * 2 - 1);
          const putLtpChg = (Math.random() * 2 - 1);
          
          return {
            ...row,
            callLtp: Math.max(1, row.callLtp + callLtpChg),
            putLtp: Math.max(1, row.putLtp + putLtpChg),
            updateStatus: callLtpChg > 0 ? 'up' : 'down'
          };
        });
      });
    }, 2000); // Update every 2 seconds

    return () => clearInterval(interval);
  }, [strikes.length]);

  return (
    <div className="container">
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>Option Chain Analysis</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <p style={{ color: 'var(--text-secondary)' }}>Live Open Interest and Price tracking for NIFTY.</p>
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
        
        <div style={{ display: 'flex', gap: '1rem' }}>
          <select style={{ 
            background: 'rgba(255, 255, 255, 0.03)', 
            border: '1px solid var(--border-color)', 
            color: 'var(--text-primary)',
            padding: '0.5rem 1rem',
            borderRadius: '10px'
          }}>
            <option>NIFTY</option>
            <option>BANKNIFTY</option>
          </select>
          <select style={{ 
            background: 'rgba(255, 255, 255, 0.03)', 
            border: '1px solid var(--border-color)', 
            color: 'var(--text-primary)',
            padding: '0.5rem 1rem',
            borderRadius: '10px'
          }}>
            <option>21 May 2026</option>
            <option>28 May 2026</option>
          </select>
        </div>
      </div>

      <div className="glass-panel" style={{ height: 'calc(100vh - 250px)', overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '0.85rem' }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#161B22' }}>
            <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
              <th colSpan="3" style={{ padding: '0.75rem', color: 'var(--bearish)', borderRight: '1px solid var(--border-color)' }}>CALLS</th>
              <th style={{ padding: '0.75rem' }}>STRIKE</th>
              <th colSpan="3" style={{ padding: '0.75rem', color: 'var(--bullish)', borderLeft: '1px solid var(--border-color)' }}>PUTS</th>
            </tr>
            <tr style={{ background: 'rgba(255, 255, 255, 0.01)', borderBottom: '1px solid var(--border-color)' }}>
              <th style={{ padding: '0.5rem' }}>OI</th>
              <th style={{ padding: '0.5rem' }}>Chg OI</th>
              <th style={{ padding: '0.5rem', borderRight: '1px solid var(--border-color)' }}>LTP</th>
              <th style={{ padding: '0.5rem' }}>Strike Price</th>
              <th style={{ padding: '0.5rem', borderLeft: '1px solid var(--border-color)' }}>LTP</th>
              <th style={{ padding: '0.5rem' }}>Chg OI</th>
              <th style={{ padding: '0.5rem' }}>OI</th>
            </tr>
          </thead>
          <tbody>
            {strikes.map((row) => {
              const isAtm = row.strike === atmStrike;
              const updateClass = row.updateStatus === 'up' ? 'updated-up' : row.updateStatus === 'down' ? 'updated-down' : '';
              
              return (
                <tr 
                  key={row.strike} 
                  className={`${isAtm ? 'atm-row' : ''} ${updateClass}`}
                  style={{ borderBottom: '1px solid var(--border-color)', height: '35px' }}
                >
                  <td style={{ color: 'var(--text-secondary)' }}>{Math.abs(row.callOi).toLocaleString()}</td>
                  <td style={{ color: row.callChgOi > 0 ? 'var(--bearish)' : 'var(--bullish)' }}>
                    {row.callChgOi > 0 ? `+${row.callChgOi}` : row.callChgOi}
                  </td>
                  <td style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-color)' }}>
                    {row.callLtp.toFixed(2)}
                  </td>
                  <td className={isAtm ? 'atm-strike' : ''} style={{ fontWeight: '700' }}>
                    {row.strike}
                  </td>
                  <td style={{ color: 'var(--text-primary)', borderLeft: '1px solid var(--border-color)' }}>
                    {row.putLtp.toFixed(2)}
                  </td>
                  <td style={{ color: row.putChgOi > 0 ? 'var(--bullish)' : 'var(--bearish)' }}>
                    {row.putChgOi > 0 ? `+${row.putChgOi}` : row.putChgOi}
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{Math.abs(row.putOi).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default OptionChain;
