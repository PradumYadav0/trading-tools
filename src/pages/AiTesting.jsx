import React, { useEffect, useState } from 'react';
import { AlertCircle, RefreshCw, CheckCircle, XCircle, Clock, TrendingUp } from 'lucide-react';

const AiTesting = () => {
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchSignals();
  }, []);

  const fetchSignals = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/signals');
      const result = await response.json();
      if (result.success) {
        setSignals(result.data);
      } else {
        setError(result.message || 'Failed to fetch signals');
      }
    } catch (err) {
      setError('Error connecting to server');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Calculate stats
  const totalTrades = signals.length;
  const successTrades = signals.filter(s => s.status === 'SUCCESS').length;
  const failedTrades = signals.filter(s => s.status === 'FAILED').length;
  const pendingTrades = signals.filter(s => s.status === 'PENDING').length;
  
  const winRate = totalTrades > 0 ? ((successTrades / (successTrades + failedTrades || 1)) * 100).toFixed(1) : 0;

  return (
    <div className="container">
      <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>AI Performance Testing</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Track how accurate the AI and System signals are.</p>
        </div>

        <button 
          onClick={fetchSignals}
          disabled={loading}
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
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          Refresh & Update
        </button>
      </div>

      {/* Stats Grid */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
        gap: '1.5rem', 
        marginBottom: '2rem' 
      }}>
        <div className="glass-panel" style={{ padding: '1.5rem', textAlign: 'center' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Total Signals</div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{totalTrades}</div>
        </div>
        
        <div className="glass-panel" style={{ padding: '1.5rem', textAlign: 'center' }}>
          <div style={{ color: '#10B981', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Success</div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#10B981' }}>{successTrades}</div>
        </div>

        <div className="glass-panel" style={{ padding: '1.5rem', textAlign: 'center' }}>
          <div style={{ color: '#EF4444', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Failed</div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#EF4444' }}>{failedTrades}</div>
        </div>

        <div className="glass-panel" style={{ padding: '1.5rem', textAlign: 'center', background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(168, 85, 247, 0.1) 100%)' }}>
          <div style={{ color: '#A855F7', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Win Rate</div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#A855F7' }}>{winRate}%</div>
        </div>
      </div>

      {error && (
        <div style={{ 
          background: 'rgba(239, 68, 68, 0.1)', 
          border: '1px solid rgba(239, 68, 68, 0.2)', 
          color: '#FCA5A5', 
          padding: '1rem', 
          borderRadius: '8px', 
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Signals Table */}
      <div className="glass-panel" style={{ padding: '1.5rem', overflowX: 'auto' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Past Signals</h2>
        
        {signals.length === 0 && !loading ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
            No signals recorded yet. Signals will appear here when generated.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                <th style={{ padding: '0.75rem' }}>Time</th>
                <th style={{ padding: '0.75rem' }}>Symbol</th>
                <th style={{ padding: '0.75rem' }}>Type</th>
                <th style={{ padding: '0.75rem' }}>Entry</th>
                <th style={{ padding: '0.75rem' }}>Target</th>
                <th style={{ padding: '0.75rem' }}>Stoploss</th>
                <th style={{ padding: '0.75rem' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {signals.map(signal => (
                <tr key={signal.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '0.75rem', fontSize: '0.9rem' }}>
                    {new Date(signal.created_at).toLocaleString()}
                  </td>
                  <td style={{ padding: '0.75rem', fontWeight: '600' }}>{signal.symbol}</td>
                  <td style={{ padding: '0.75rem' }}>
                    <span style={{ 
                      color: signal.type === 'CALL' ? 'var(--bullish)' : 'var(--bearish)',
                      fontWeight: 'bold'
                    }}>
                      {signal.type}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem' }}>{signal.entry_price}</td>
                  <td style={{ padding: '0.75rem', color: '#10B981' }}>{signal.target_price || 'N/A'}</td>
                  <td style={{ padding: '0.75rem', color: '#EF4444' }}>{signal.stoploss_price || 'N/A'}</td>
                  <td style={{ padding: '0.75rem' }}>
                    <span style={{ 
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      color: signal.status === 'SUCCESS' ? '#10B981' : signal.status === 'FAILED' ? '#EF4444' : '#EAB308',
                      fontWeight: '600',
                      fontSize: '0.9rem'
                    }}>
                      {signal.status === 'SUCCESS' && <CheckCircle size={14} />}
                      {signal.status === 'FAILED' && <XCircle size={14} />}
                      {signal.status === 'PENDING' && <Clock size={14} />}
                      {signal.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default AiTesting;
