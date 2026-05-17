import React, { useEffect, useState } from 'react';
import { AlertCircle, RefreshCw, TrendingUp, TrendingDown, ShieldAlert, Zap } from 'lucide-react';

const TradingSignals = () => {
  const [symbol, setSymbol] = useState('NIFTY');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [signalData, setSignalData] = useState(null);

  useEffect(() => {
    fetchSignals();
    // Auto refresh every 1 minute
    const interval = setInterval(fetchSignals, 60000);
    return () => clearInterval(interval);
  }, [symbol]);

  const fetchSignals = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/option-chain?symbol=${symbol}`);
      const result = await response.json();

      if (result.success && result.data) {
        calculateSignals(result.data, result.spotPrice);
      } else {
        setError(result.message || 'Failed to fetch data');
      }
    } catch (err) {
      setError('Error connecting to server');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const calculateSignals = (ocData, spotPrice) => {
    let totalCallOi = 0;
    let totalPutOi = 0;
    let maxCallOi = 0;
    let maxPutOi = 0;
    let supportStrike = 0;
    let resistanceStrike = 0;

    ocData.forEach(strike => {
      totalCallOi += strike.callOi;
      totalPutOi += strike.putOi;

      if (strike.callOi > maxCallOi) {
        maxCallOi = strike.callOi;
        resistanceStrike = strike.strike;
      }

      if (strike.putOi > maxPutOi) {
        maxPutOi = strike.putOi;
        supportStrike = strike.strike;
      }
    });

    const pcr = totalCallOi > 0 ? (totalPutOi / totalCallOi).toFixed(2) : 0;
    
    // Determine Signal
    let signal = 'NEUTRAL';
    let signalColor = 'var(--text-secondary)';
    let recommendation = 'Wait for a clear trend or better setup.';
    let stoploss = 0;
    let target = 0;

    if (pcr > 1.2 && spotPrice > supportStrike) {
      signal = 'STRONG BULLISH';
      signalColor = 'var(--bullish)';
      recommendation = `Market is bullish. Consider buying Call Options above ${spotPrice}.`;
      stoploss = supportStrike; // Stoploss at support
      target = resistanceStrike; // Target at resistance
    } else if (pcr < 0.8 && spotPrice < resistanceStrike) {
      signal = 'STRONG BEARISH';
      signalColor = 'var(--bearish)';
      recommendation = `Market is bearish. Consider buying Put Options below ${spotPrice}.`;
      stoploss = resistanceStrike; // Stoploss at resistance
      target = supportStrike; // Target at support
    } else if (pcr > 1.0) {
      signal = 'MILD BULLISH';
      signalColor = '#10B981';
      recommendation = 'Slightly bullish bias. Avoid big trades.';
    } else if (pcr < 1.0) {
      signal = 'MILD BEARISH';
      signalColor = '#EF4444';
      recommendation = 'Slightly bearish bias. Avoid big trades.';
    }

    setSignalData({
      spotPrice,
      pcr,
      support: supportStrike,
      resistance: resistanceStrike,
      signal,
      signalColor,
      recommendation,
      stoploss,
      target,
      totalCallOi,
      totalPutOi
    });
  };

  return (
    <div className="container">
      <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Auto Signal Generator</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Rule-based algorithmic trading signals (No knowledge required)</p>
        </div>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <select 
            value={symbol} 
            onChange={(e) => setSymbol(e.target.value)}
            style={{ 
              background: '#1E293B', 
              color: 'white', 
              border: '1px solid var(--border-color)', 
              padding: '0.5rem 1rem', 
              borderRadius: '8px',
              cursor: 'pointer'
            }}
          >
            <option value="NIFTY">NIFTY</option>
            <option value="BANKNIFTY">BANKNIFTY</option>
          </select>

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
            Refresh
          </button>
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

      {signalData && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
          
          {/* Signal Card */}
          <div className="glass-panel" style={{ padding: '1.5rem', border: `2px solid ${signalData.signalColor}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ color: 'var(--text-secondary)' }}>Current Signal</h3>
              <Zap size={24} fill={signalData.signalColor} color={signalData.signalColor} />
            </div>
            <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: signalData.signalColor, marginBottom: '0.5rem' }}>
              {signalData.signal}
            </div>
            <p style={{ color: 'white', fontSize: '1.1rem' }}>{signalData.recommendation}</p>
          </div>

          {/* Target & Stoploss Card */}
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h3 style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>Trade Setup</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Spot Price:</span>
                <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{signalData.spotPrice.toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--bullish)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <TrendingUp size={16} /> Target:
                </span>
                <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--bullish)' }}>
                  {signalData.target > 0 ? signalData.target : 'N/A'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--bearish)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <TrendingDown size={16} /> Stoploss:
                </span>
                <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--bearish)' }}>
                  {signalData.stoploss > 0 ? signalData.stoploss : 'N/A'}
                </span>
              </div>
            </div>
          </div>

          {/* Data Analysis Card */}
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h3 style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>Option Chain Analysis</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Put Call Ratio (PCR):</span>
                <span style={{ fontWeight: 'bold', color: signalData.pcr > 1 ? 'var(--bullish)' : 'var(--bearish)' }}>
                  {signalData.pcr}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Major Support:</span>
                <span style={{ fontWeight: 'bold', color: 'var(--bullish)' }}>{signalData.support}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Major Resistance:</span>
                <span style={{ fontWeight: 'bold', color: 'var(--bearish)' }}>{signalData.resistance}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                <span>Total Call OI: {signalData.totalCallOi.toLocaleString()}</span>
                <span>Total Put OI: {signalData.totalPutOi.toLocaleString()}</span>
              </div>
            </div>
          </div>

        </div>
      )}

      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <ShieldAlert color="var(--primary-color)" />
          <h3>How to use these signals?</h3>
        </div>
        <ul style={{ color: 'var(--text-secondary)', paddingLeft: '1.5rem', lineHeight: '1.6' }}>
          <li><strong>Strong Bullish:</strong> When PCR is above 1.2, it means more puts are being sold than calls. This indicates big players are bullish. Look for buying opportunities near Support.</li>
          <li><strong>Strong Bearish:</strong> When PCR is below 0.8, it means more calls are being sold. This indicates bearish sentiment. Look for selling (Put buying) opportunities near Resistance.</li>
          <li><strong>Target & Stoploss:</strong> These are calculated based on the highest Open Interest strikes. They act as strong psychological barriers for the market.</li>
          <li><em>Always cross-check with price action on the chart before taking any trade.</em></li>
        </ul>
      </div>
    </div>
  );
};

export default TradingSignals;
