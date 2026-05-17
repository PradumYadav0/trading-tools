import React, { useState, useEffect } from 'react';
import axios from 'axios';

const OptionChain = () => {
  const [spotPrice, setSpotPrice] = useState(0);
  const [strikes, setStrikes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expiry, setExpiry] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await axios.get('/api/option-chain');
        if (response.data.success) {
          setStrikes(response.data.data);
          setSpotPrice(response.data.spotPrice);
          setExpiry(response.data.expiry);
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
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000); // Poll every 5 seconds

    return () => clearInterval(interval);
  }, []);

  // Find ATM Strike
  const atmStrike = strikes.reduce((prev, curr) => {
    return (Math.abs(curr.strike - spotPrice) < Math.abs(prev.strike - spotPrice) ? curr : prev);
  }, strikes[0] || { strike: 0 }).strike;

  if (loading) {
    return <div className="container flex-center" style={{ height: '80vh' }}>Loading Option Chain from Dhan API...</div>;
  }

  if (error) {
    return (
      <div className="container flex-center" style={{ height: '80vh', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ color: 'var(--bearish)', fontSize: '1.2rem' }}>Error: {error}</div>
        <p style={{ color: 'var(--text-secondary)' }}>Make sure your Dhan token is valid and set in .env file.</p>
      </div>
    );
  }

  return (
    <div className="container">
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>Option Chain Analysis</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <p style={{ color: 'var(--text-secondary)' }}>Live Data from Dhan API.</p>
            <div style={{ 
              background: 'rgba(255, 255, 255, 0.03)', 
              padding: '0.25rem 0.75rem', 
              borderRadius: '8px',
              fontSize: '0.9rem',
              fontWeight: '600'
            }}>
              Spot: <span style={{ color: 'var(--accent-primary)' }}>{spotPrice.toFixed(2)}</span>
            </div>
            <div style={{ 
              background: 'rgba(255, 255, 255, 0.03)', 
              padding: '0.25rem 0.75rem', 
              borderRadius: '8px',
              fontSize: '0.9rem',
              fontWeight: '500',
              color: 'var(--text-secondary)'
            }}>
              Expiry: {expiry}
            </div>
          </div>
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
              
              return (
                <tr 
                  key={row.strike} 
                  className={isAtm ? 'atm-row' : ''}
                  style={{ borderBottom: '1px solid var(--border-color)', height: '35px' }}
                >
                  <td style={{ color: 'var(--text-secondary)' }}>{row.callOi.toLocaleString()}</td>
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
                  <td style={{ color: 'var(--text-secondary)' }}>{row.putOi.toLocaleString()}</td>
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
