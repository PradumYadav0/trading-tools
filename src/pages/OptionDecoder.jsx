import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { RefreshCw, Zap, TrendingUp, TrendingDown, Minus, Activity, Cpu, Brain, Target, ShieldAlert, Flame, Percent } from 'lucide-react';
import { isMarketOpen } from '../utils/market';

const OptionDecoder = () => {
  const [symbol, setSymbol] = useState('NIFTY');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [spotPrice, setSpotPrice] = useState(0);
  const [atr, setAtr] = useState(15);
  
  // Data states
  const [pcrData, setPcrData] = useState({ value: 1.0, status: 'Neutral', velocity: 'Stable' });
  const [oiDecode, setOiDecode] = useState({ callChg: 0, putChg: 0, signal: 'Neutral', ratio: 1 });
  const [maxPain, setMaxPain] = useState('N/A');
  const [concentration, setConcentration] = useState({ callConc: 0, putConc: 0, signal: 'Neutral' });
  const [overallScore, setOverallScore] = useState({ score: 50, signal: 'Neutral', color: 'var(--text-secondary)' });
  
  // New States for Advanced Features
  const [straddleValue, setStraddleValue] = useState(0);
  const [trapAlert, setTrapAlert] = useState({ active: false, type: '', message: '', color: '' });
  
  // For PCR Velocity
  const prevPcrRef = useRef(null);

  const calculateMaxPain = (data) => {
    if (!data || data.length === 0) return 'N/A';
    
    let minLoss = Infinity;
    let maxPainStrike = 'N/A';
    
    data.forEach(targetStrike => {
      let totalLoss = 0;
      data.forEach(strikeRow => {
        // Call loss
        if (targetStrike.strike > strikeRow.strike) {
          totalLoss += strikeRow.callOi * (targetStrike.strike - strikeRow.strike);
        }
        // Put loss
        if (targetStrike.strike < strikeRow.strike) {
          totalLoss += strikeRow.putOi * (strikeRow.strike - targetStrike.strike);
        }
      });
      
      if (totalLoss < minLoss) {
        minLoss = totalLoss;
        maxPainStrike = targetStrike.strike;
      }
    });
    
    return maxPainStrike;
  };

  const fetchData = async () => {
    setIsRefreshing(true);
    try {
      const response = await axios.get(`/api/option-chain?symbol=${symbol}`);
      if (response.data.success) {
        const strikes = response.data.data;
        const spot = response.data.spotPrice;
        setSpotPrice(spot);
        setAtr(response.data.atr || 15);

        // 1. Calculate PCR
        const totalCallOi = strikes.reduce((sum, row) => sum + row.callOi, 0);
        const totalPutOi = strikes.reduce((sum, row) => sum + row.putOi, 0);
        const pcr = totalCallOi > 0 ? totalPutOi / totalCallOi : 1.0;
        
        const prevPcr = prevPcrRef.current;
        const velocity = prevPcr === null ? 'Stable ➡️' : pcr > prevPcr ? 'Rising 📈' : pcr < prevPcr ? 'Falling 📉' : 'Stable ➡️';
        prevPcrRef.current = pcr;

        setPcrData({
          value: pcr.toFixed(2),
          status: pcr > 1.1 ? 'Bullish' : pcr < 0.9 ? 'Bearish' : 'Neutral',
          velocity
        });

        // 2. OI Decode (Change in OI)
        const totalCallChg = strikes.reduce((sum, row) => sum + row.callChgOi, 0);
        const totalPutChg = strikes.reduce((sum, row) => sum + row.putChgOi, 0);
        const oiRatio = totalCallChg > 0 ? totalPutChg / totalCallChg : 1;

        setOiDecode({
          callChg: totalCallChg,
          putChg: totalPutChg,
          signal: totalPutChg > totalCallChg ? 'Bullish' : totalPutChg < totalCallChg ? 'Bearish' : 'Neutral',
          ratio: oiRatio.toFixed(2)
        });

        // 3. Max Pain
        const painPoint = calculateMaxPain(strikes);
        setMaxPain(painPoint);

        // 4. Strike Concentration (ATM +- 5 strikes)
        const atmStrikeObj = strikes.reduce((prev, curr) => {
          return (Math.abs(curr.strike - spot) < Math.abs(prev.strike - spot) ? curr : prev);
        }, strikes[0] || { strike: 0 });
        const atmStrike = atmStrikeObj.strike;

        const atmIndex = strikes.findIndex(s => s.strike === atmStrike);
        const nearStrikes = strikes.slice(Math.max(0, atmIndex - 5), Math.min(strikes.length, atmIndex + 6));
        
        const nearCallOi = nearStrikes.reduce((sum, row) => sum + row.callOi, 0);
        const nearPutOi = nearStrikes.reduce((sum, row) => sum + row.putOi, 0);
        
        setConcentration({
          callConc: nearCallOi,
          putConc: nearPutOi,
          signal: nearPutOi > nearCallOi ? 'Bullish' : nearPutOi < nearCallOi ? 'Bearish' : 'Neutral'
        });

        // 5. Straddle Value (ATM Call LTP + ATM Put LTP)
        const straddle = (atmStrikeObj.callLtp || 0) + (atmStrikeObj.putLtp || 0);
        setStraddleValue(straddle);

        // 6. Operator Trap Alert (Short Covering / Long Unwinding)
        const maxCallOiRow = strikes.reduce((prev, curr) => (curr.callOi > prev.callOi ? curr : prev), strikes[0]);
        const maxPutOiRow = strikes.reduce((prev, curr) => (curr.putOi > prev.putOi ? curr : prev), strikes[0]);

        if (spot > maxCallOiRow.strike && maxCallOiRow.callChgOi < 0) {
          setTrapAlert({
            active: true,
            type: 'Short Covering',
            message: `🔥 Call Writers are TRAPPED at ${maxCallOiRow.strike}! Expect a fast upward blast.`,
            color: 'var(--bullish)'
          });
        } else if (spot < maxPutOiRow.strike && maxPutOiRow.putChgOi < 0) {
          setTrapAlert({
            active: true,
            type: 'Long Unwinding',
            message: `❄️ Put Writers are TRAPPED at ${maxPutOiRow.strike}! Expect a fast downward fall.`,
            color: 'var(--bearish)'
          });
        } else {
          setTrapAlert({ active: false, type: '', message: '', color: '' });
        }

        // 7. Overall Score Calculation
        let bullishPoints = 0;
        let totalPoints = 4;

        if (pcr > 1.0) bullishPoints++;
        if (totalPutChg > totalCallChg) bullishPoints++;
        if (painPoint > spot) bullishPoints++;
        if (nearPutOi > nearCallOi) bullishPoints++;

        const percentage = (bullishPoints / totalPoints) * 100;
        
        let finalSignal = 'Neutral';
        let finalColor = '#EAB308'; // Yellow

        if (percentage >= 75) {
          finalSignal = 'Strong Bullish';
          finalColor = 'var(--bullish)';
        } else if (percentage === 50) {
          finalSignal = 'Neutral / Rangebound';
          finalColor = 'var(--text-secondary)';
        } else if (percentage <= 25) {
          finalSignal = 'Strong Bearish';
          finalColor = 'var(--bearish)';
        }

        setOverallScore({ score: percentage, signal: finalSignal, color: finalColor });

        setLoading(false);
        setError(null);
      } else {
        setError(response.data.message || 'Failed to fetch data');
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
    const intervalId = setInterval(() => {
      if (isMarketOpen()) {
        fetchData();
      } else {
        console.log('Skipping auto-refresh: Market is closed.');
      }
    }, 60000);
    
    return () => clearInterval(intervalId);
  }, [symbol]);

  const getSignalIcon = (signal) => {
    if (signal.includes('Bullish')) return <TrendingUp size={20} color="var(--bullish)" />;
    if (signal.includes('Bearish')) return <TrendingDown size={20} color="var(--bearish)" />;
    return <Minus size={20} color="var(--text-secondary)" />;
  };

  const buyerSignal = overallScore.score >= 75 ? 'BUY CALL' : overallScore.score <= 25 ? 'BUY PUT' : 'WAIT';

  useEffect(() => {
    if (buyerSignal === 'WAIT' || !spotPrice || loading) return;

    const dynamicTargetVal = 2.0 * atr;
    const targetVal = buyerSignal === 'BUY CALL' ? spotPrice + dynamicTargetVal : spotPrice - dynamicTargetVal;
    
    const slAmt = 1.0 * atr;
    const stoplossVal = buyerSignal === 'BUY CALL' 
      ? spotPrice - slAmt 
      : spotPrice + slAmt;

    const saveOptionSignal = async () => {
      try {
        await axios.post('/api/signals', {
          symbol,
          type: buyerSignal === 'BUY CALL' ? 'CALL' : 'PUT',
          entry_price: parseFloat(spotPrice),
          target_price: parseFloat(targetVal.toFixed(2)),
          stoploss_price: parseFloat(stoplossVal.toFixed(2)),
          source: 'OPTION_CHAIN'
        });
      } catch (e) {
        console.error("Error auto-saving option chain signal:", e);
      }
    };

    saveOptionSignal();
  }, [buyerSignal, spotPrice, symbol, loading, atr]);

  if (loading) {
    return <div className="container flex-center" style={{ height: '80vh' }}>Loading Option Decoder Math...</div>;
  }

  const buyerColor = overallScore.score >= 75 ? 'var(--bullish)' : overallScore.score <= 25 ? 'var(--bearish)' : '#EAB308';
  
  const dynamicTarget = 2.0 * atr;
  const targetPoints = `${dynamicTarget.toFixed(1)} Points`;
  const stoplossPoints = `${(1.0 * atr).toFixed(1)} Points`;

  return (
    <div className="container" style={{ padding: '2rem', color: 'white' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>Option Decoder (Quant Lab)</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Advanced Mathematical Analysis for Option Buyers</p>
        </div>
        
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <select 
            value={symbol} 
            onChange={(e) => setSymbol(e.target.value)}
            style={{ padding: '0.5rem', background: '#1E293B', color: 'white', border: '1px solid #334155', borderRadius: '6px' }}
          >
            <option value="NIFTY">NIFTY</option>
            <option value="BANKNIFTY">BANKNIFTY</option>
            <option value="FINNIFTY">FINNIFTY</option>
            <option value="MIDCPNIFTY">MIDCPNIFTY</option>
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

      {/* Operator Trap Alert Box requested by user */}
      {trapAlert.active && (
        <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1.5rem', border: `2px solid ${trapAlert.color}`, background: 'rgba(255, 0, 0, 0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Flame size={24} color={trapAlert.color} />
            <h3 style={{ margin: 0, color: trapAlert.color }}>{trapAlert.type} Alert!</h3>
          </div>
          <p style={{ marginTop: '0.5rem', fontSize: '1.1rem', fontWeight: 'bold' }}>{trapAlert.message}</p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
        
        {/* Overall Mood Score Card */}
        <div className="glass-panel" style={{ padding: '1.5rem', border: `2px solid ${overallScore.color}`, textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
            <Brain size={28} color={overallScore.color} />
            <h2 style={{ fontSize: '1.75rem', margin: 0, color: overallScore.color }}>{overallScore.signal}</h2>
          </div>
          <p style={{ fontSize: '1rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
            Mathematical Confidence Score
          </p>
          <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: 'white' }}>
            {overallScore.score}%
          </div>
          <div style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            Spot Price: <span style={{ color: 'white', fontWeight: 'bold' }}>{spotPrice.toFixed(2)}</span>
          </div>
        </div>

        {/* Straddle Value Card */}
        <div className="glass-panel" style={{ padding: '1.5rem', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', color: 'var(--accent-primary)' }}>
            <Percent size={20} />
            <h3 style={{ margin: 0 }}>ATM Straddle</h3>
          </div>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Combined Premium (CE + PE)
          </p>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'white' }}>
            {straddleValue.toFixed(2)}
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            Shrinking = Rangebound<br />Expanding = Big Move Coming
          </p>
        </div>
      </div>

      {/* Option Buyer's Signal Box */}
      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem', border: `2px solid ${buyerColor}`, background: 'rgba(255,255,255,0.01)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '0.25rem' }}>
              <ShieldAlert size={16} color={buyerColor} />
              <span>Live Dynamic Target (लाईव मार्केट के हिसाब से)</span>
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: buyerColor }}>
              {buyerSignal}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '2rem', textAlign: 'right' }}>
            <div>
              <div style={{ color: 'var(--bullish)', fontSize: '0.8rem' }}>Live Target</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--bullish)' }}>{targetPoints}</div>
            </div>
            <div>
              <div style={{ color: 'var(--bearish)', fontSize: '0.8rem' }}>Stoploss</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--bearish)' }}>{stoplossPoints}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Hold Time</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>10 - 30 Mins</div>
            </div>
          </div>
        </div>
        <div style={{ marginTop: '1rem', fontSize: '0.9rem', color: 'white', lineHeight: '1.4' }}>
          {overallScore.score >= 75 ? (
            <span>🎯 **Rule**: Momentum is strong. Target is calculated based on distance to Max Pain. Exit as soon as you get **{targetPoints}** or if score drops.</span>
          ) : overallScore.score <= 25 ? (
            <span>🎯 **Rule**: Panic is high. Target is calculated based on distance to Max Pain. Exit as soon as you get **{targetPoints}** or if score rises.</span>
          ) : (
            <span>⌛ **Rule**: No clear momentum. Option buyers lose money in sideways markets due to Theta decay. **Wait** for a better opportunity.</span>
          )}
        </div>
      </div>

      {error && (
        <div style={{ color: 'var(--bearish)', marginBottom: '1rem', padding: '1rem', background: 'rgba(255, 0, 0, 0.05)', borderRadius: '8px' }}>
          {error}
        </div>
      )}

      {/* 3. Grid of 4 Mathematical Models */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        
        {/* Model 1: OI Decode */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Cpu size={20} color="#3B82F6" />
              <h3 style={{ margin: 0 }}>OI Decode (Change in OI)</h3>
            </div>
            {getSignalIcon(oiDecode.signal)}
          </div>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Analyzes where new contracts are being written.
          </p>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>New Call Writers:</span>
              <span style={{ color: 'var(--bearish)' }}>{oiDecode.callChg.toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>New Put Writers:</span>
              <span style={{ color: 'var(--bullish)' }}>{oiDecode.putChg.toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', marginTop: '0.5rem', borderTop: '1px solid #334155', paddingTop: '0.5rem' }}>
              <span>OI Ratio:</span>
              <span>{oiDecode.ratio}</span>
            </div>
          </div>
        </div>

        {/* Model 2: Max Pain */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Target size={20} color="#EF4444" />
              <h3 style={{ margin: 0 }}>Max Pain Point</h3>
            </div>
            {getSignalIcon(maxPain > spotPrice ? 'Bullish' : 'Bearish')}
          </div>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            The strike where option buyers will lose the most money.
          </p>
          <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
            <div style={{ fontSize: '1rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Target Expiry Strike</div>
            <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: 'var(--accent-primary)' }}>{maxPain}</div>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
            Market tends to gravitate towards this level.
          </div>
        </div>

        {/* Model 3: PCR Velocity */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Activity size={20} color="#10B981" />
              <h3 style={{ margin: 0 }}>PCR & Velocity</h3>
            </div>
            {getSignalIcon(pcrData.status)}
          </div>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Measures the speed of data change.
          </p>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Current PCR:</span>
              <span style={{ fontWeight: 'bold' }}>{pcrData.value}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>PCR Velocity:</span>
              <span style={{ fontWeight: 'bold', color: pcrData.velocity.includes('Rising') ? 'var(--bullish)' : pcrData.velocity.includes('Falling') ? 'var(--bearish)' : 'white' }}>
                {pcrData.velocity}
              </span>
            </div>
          </div>
        </div>

        {/* Model 4: Strike Concentration */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Zap size={20} color="#F59E0B" />
              <h3 style={{ margin: 0 }}>Strike Concentration</h3>
            </div>
            {getSignalIcon(concentration.signal)}
          </div>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Analyzes battle zone (ATM +- 5 strikes).
          </p>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>ATM Call OI:</span>
              <span style={{ color: 'var(--bearish)' }}>{concentration.callConc.toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>ATM Put OI:</span>
              <span style={{ color: 'var(--bullish)' }}>{concentration.putConc.toLocaleString()}</span>
            </div>
          </div>
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

export default OptionDecoder;
