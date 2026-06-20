import React, { useEffect, useState } from 'react';
import { AlertCircle, RefreshCw, TrendingUp, TrendingDown, ShieldAlert, Zap } from 'lucide-react';
import { isMarketOpen } from '../utils/market';

const TradingSignals = () => {
  const [symbol, setSymbol] = useState('NIFTY');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [signalData, setSignalData] = useState(null);
  const [cooldown, setCooldown] = useState(false);

  const fetchSignals = async () => {
    if (cooldown) return;
    
    setLoading(true);
    setError(null);
    setSignalData(null); // Clear old data to avoid showing wrong data for new symbol
    
    // Set cooldown for 10 seconds
    setCooldown(true);
    setTimeout(() => setCooldown(false), 10000);

    try {
      // Fetch Option Chain
      const response = await fetch(`/api/option-chain?symbol=${symbol}`);
      const result = await response.json();

      // Fetch Chart Data for EMA
      const chartResponse = await fetch(`/api/charts/intraday?symbol=${symbol}&interval=5`);
      const chartResult = await chartResponse.json();
      
      let chartData = [];
      if (chartResult.success && chartResult.data) {
        chartData = chartResult.data.sort((a, b) => a.time - b.time);
      }

      if (result.success && result.data) {
        calculateSignals(result.data, result.spotPrice, chartData, result.atr);
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

  useEffect(() => {
    setCooldown(false); // Reset cooldown when switching symbols
    fetchSignals();
    // Auto refresh every 1 minute
    const interval = setInterval(() => {
      if (isMarketOpen()) {
        fetchSignals();
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [symbol]);

  const calculateSignals = (ocData, spotPrice, chartData, apiAtr) => {
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
    
    // Calculate EMA 9 from chart data
    let ema9 = 0;
    let priceAboveEma = false;
    
    if (chartData.length >= 9) {
      const k = 2 / (9 + 1);
      let ema = chartData[0].close;
      for (let i = 1; i < chartData.length; i++) {
        ema = (chartData[i].close * k) + (ema * (1 - k));
      }
      ema9 = parseFloat(ema.toFixed(2));
      priceAboveEma = spotPrice > ema9;
    }

    // Calculate ATR from chart data
    let computedAtr = 0;
    const atrPeriod = 14;
    if (chartData.length > atrPeriod) {
      let trs = [];
      for (let i = 1; i < chartData.length; i++) {
        const h_l = chartData[i].high - chartData[i].low;
        const h_pc = Math.abs(chartData[i].high - chartData[i - 1].close);
        const l_pc = Math.abs(chartData[i].low - chartData[i - 1].close);
        trs.push(Math.max(h_l, h_pc, l_pc));
      }
      let atr = trs.slice(0, atrPeriod).reduce((a, b) => a + b, 0) / atrPeriod;
      for (let i = atrPeriod; i < trs.length; i++) {
        atr = ((atr * (atrPeriod - 1)) + trs[i]) / atrPeriod;
      }
      computedAtr = atr;
    } else {
      computedAtr = apiAtr || (symbol === 'NIFTY' ? 15 : symbol === 'BANKNIFTY' ? 40 : symbol === 'FINNIFTY' ? 18 : 10);
    }

    // Determine Signal
    let signal = 'NEUTRAL';
    let signalColor = 'var(--text-secondary)';
    let recommendation = 'Wait for a clear trend or better setup.';
    let stoploss = 0;
    let target = 0;

    // Combine Option Chain and Chart (EMA)
    if (pcr > 1.2 && spotPrice > supportStrike && priceAboveEma) {
      signal = 'STRONG BULLISH';
      signalColor = 'var(--bullish)';
      recommendation = `Option Chain & Chart are Bullish! Price is above EMA 9. Consider buying Call.`;
      stoploss = supportStrike;
      target = resistanceStrike;
    } else if (pcr < 0.8 && spotPrice < resistanceStrike && !priceAboveEma) {
      signal = 'STRONG BEARISH';
      signalColor = 'var(--bearish)';
      recommendation = `Option Chain & Chart are Bearish! Price is below EMA 9. Consider buying Put.`;
      stoploss = resistanceStrike;
      target = supportStrike;
    } else if (pcr > 1.0 && priceAboveEma) {
      signal = 'MILD BULLISH';
      signalColor = '#10B981';
      recommendation = 'Price is above EMA and PCR is positive. Slight bullish bias.';
    } else if (pcr < 1.0 && !priceAboveEma) {
      signal = 'MILD BEARISH';
      signalColor = '#EF4444';
      recommendation = 'Price is below EMA and PCR is negative. Slight bearish bias.';
    } else if (pcr > 1.0 && !priceAboveEma) {
      signal = 'CONFLICTING';
      signalColor = '#EAB308';
      recommendation = 'Option Chain is Bullish but Chart is Bearish (Below EMA). Avoid trading.';
    } else if (pcr < 1.0 && priceAboveEma) {
      signal = 'CONFLICTING';
      signalColor = '#EAB308';
      recommendation = 'Option Chain is Bearish but Chart is Bullish (Above EMA). Avoid trading.';
    }

    // Calculate dynamic ATR-based target and stoploss (Target: 3.0 * ATR, SL: 1.5 * ATR)
    let dynamicTarget = 0;
    let dynamicStoploss = 0;
    if (signal.includes('BULLISH')) {
      dynamicTarget = spotPrice + (3.0 * computedAtr);
      dynamicStoploss = spotPrice - (1.5 * computedAtr);
    } else if (signal.includes('BEARISH')) {
      dynamicTarget = spotPrice - (3.0 * computedAtr);
      dynamicStoploss = spotPrice + (1.5 * computedAtr);
    } else {
      dynamicTarget = spotPrice + (3.0 * computedAtr);
      dynamicStoploss = spotPrice - (1.5 * computedAtr);
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
      totalPutOi,
      ema9,
      priceAboveEma,
      atr: computedAtr,
      dynamicTarget,
      dynamicStoploss
    });
  };

  const saveToTesting = async () => {
    if (!signalData) return;
    
    try {
      const response = await fetch('/api/signals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          symbol,
          type: signalData.signal.includes('BULLISH') ? 'CALL' : 'PUT',
          entry_price: signalData.spotPrice,
          target_price: signalData.dynamicTarget > 0 ? parseFloat(signalData.dynamicTarget.toFixed(2)) : signalData.target,
          stoploss_price: signalData.dynamicStoploss > 0 ? parseFloat(signalData.dynamicStoploss.toFixed(2)) : signalData.stoploss,
          source: 'CHART'
        })
      });
      
      const result = await response.json();
      if (result.success) {
        alert('Signal saved to AI Testing page!');
      } else {
        alert('Failed to save signal: ' + result.message);
      }
    } catch (err) {
      console.error(err);
      alert('Error saving signal');
    }
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
            
            {signalData.signal.includes('STRONG') && (
              <button
                onClick={saveToTesting}
                style={{
                  marginTop: '1.5rem',
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: 'white',
                  border: '1px solid rgba(255,255,255,0.2)',
                  padding: '0.5rem 1rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}
              >
                <TrendingUp size={16} />
                Track this Signal
              </button>
            )}
          </div>

          {/* Target & Stoploss Card */}
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h3 style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>Trade Setup</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>
                <span>Spot Price:</span>
                <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{signalData.spotPrice.toFixed(2)}</span>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                {/* Dynamic Volatility Setup */}
                <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--accent-primary)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Zap size={14} color="#F59E0B" /> Volatility Setup (ATR)
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.85rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--bullish)' }}>Target:</span>
                      <span style={{ fontWeight: 'bold', color: 'var(--bullish)' }}>
                        {signalData.dynamicTarget > 0 ? signalData.dynamicTarget.toFixed(2) : 'N/A'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--bearish)' }}>Stoploss:</span>
                      <span style={{ fontWeight: 'bold', color: 'var(--bearish)' }}>
                        {signalData.dynamicStoploss > 0 ? signalData.dynamicStoploss.toFixed(2) : 'N/A'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.25rem', textAlign: 'right' }}>
                      ATR (3.0x / 1.5x): {signalData.atr ? signalData.atr.toFixed(1) : 'N/A'}
                    </div>
                  </div>
                </div>

                {/* Major OI Strikes Setup */}
                <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--accent-primary)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <TrendingUp size={14} color="#3B82F6" /> Major OI Strikes
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.85rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--bullish)' }}>Target (Res):</span>
                      <span style={{ fontWeight: 'bold', color: 'var(--bullish)' }}>
                        {signalData.target > 0 ? signalData.target : 'N/A'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--bearish)' }}>Stoploss (Sup):</span>
                      <span style={{ fontWeight: 'bold', color: 'var(--bearish)' }}>
                        {signalData.stoploss > 0 ? signalData.stoploss : 'N/A'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.25rem', textAlign: 'right' }}>
                      Key OI Levels
                    </div>
                  </div>
                </div>
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
