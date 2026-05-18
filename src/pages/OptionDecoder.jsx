import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { RefreshCw, Zap, TrendingUp, TrendingDown, Minus, Activity, Cpu, Brain, Target } from 'lucide-react';

const OptionDecoder = () => {
  const [symbol, setSymbol] = useState('NIFTY');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [spotPrice, setSpotPrice] = useState(0);
  
  // Data states
  const [pcrData, setPcrData] = useState({ value: 1.0, status: 'Neutral', velocity: 'Stable' });
  const [oiDecode, setOiDecode] = useState({ callChg: 0, putChg: 0, signal: 'Neutral', ratio: 1 });
  const [maxPain, setMaxPain] = useState('N/A');
  const [concentration, setConcentration] = useState({ callConc: 0, putConc: 0, signal: 'Neutral' });
  const [overallScore, setOverallScore] = useState({ score: 50, signal: 'Neutral', color: 'var(--text-secondary)' });
  
  // For PCR Velocity
  const prevPcrRef = useRef(1.0);

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

        // 1. Calculate PCR
        const totalCallOi = strikes.reduce((sum, row) => sum + row.callOi, 0);
        const totalPutOi = strikes.reduce((sum, row) => sum + row.putOi, 0);
        const pcr = totalCallOi > 0 ? totalPutOi / totalCallOi : 1.0;
        
        const prevPcr = prevPcrRef.current;
        const velocity = pcr > prevPcr ? 'Rising 📈' : pcr < prevPcr ? 'Falling 📉' : 'Stable ➡️';
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
        const atmStrike = strikes.reduce((prev, curr) => {
          return (Math.abs(curr.strike - spot) < Math.abs(prev.strike - spot) ? curr : prev);
        }, strikes[0] || { strike: 0 }).strike;

        const atmIndex = strikes.findIndex(s => s.strike === atmStrike);
        const nearStrikes = strikes.slice(Math.max(0, atmIndex - 5), Math.min(strikes.length, atmIndex + 6));
        
        const nearCallOi = nearStrikes.reduce((sum, row) => sum + row.callOi, 0);
        const nearPutOi = nearStrikes.reduce((sum, row) => sum + row.putOi, 0);
        
        setConcentration({
          callConc: nearCallOi,
          putConc: nearPutOi,
          signal: nearPutOi > nearCallOi ? 'Bullish' : nearPutOi < nearCallOi ? 'Bearish' : 'Neutral'
        });

        // 5. Overall Score Calculation
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
    // Auto refresh every 1 minute as requested in previous turns
    const intervalId = setInterval(() => {
      fetchData();
    }, 60000);
    
    return () => clearInterval(intervalId);
  }, [symbol]);

  const getSignalIcon = (signal) => {
    if (signal.includes('Bullish')) return <TrendingUp size={20} color="var(--bullish)" />;
    if (signal.includes('Bearish')) return <TrendingDown size={20} color="var(--bearish)" />;
    return <Minus size={20} color="var(--text-secondary)" />;
  };

  if (loading) {
    return <div className="container flex-center" style={{ height: '80vh' }}>Loading Option Decoder Math...</div>;
  }

  return (
    <div className="container" style={{ padding: '2rem', color: 'white' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>Option Decoder (Quant Lab)</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Pure Mathematical Analysis of Live Option Chain</p>
        </div>
        
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <select 
            value={symbol} 
            onChange={(e) => setSymbol(e.target.value)}
            style={{ padding: '0.5rem', background: '#1E293B', color: 'white', border: '1px solid #334155', borderRadius: '6px' }}
          >
            <option value="NIFTY">NIFTY</option>
            <option value="BANKNIFTY">BANKNIFTY</option>
          </select>

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

      {/* 1. Overall Mood Score Card */}
      <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem', border: `2px solid ${overallScore.color}`, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
          <Brain size={32} color={overallScore.color} />
          <h2 style={{ fontSize: '2rem', margin: 0, color: overallScore.color }}>{overallScore.signal}</h2>
        </div>
        <p style={{ fontSize: '1.2rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
          Mathematical Confidence Score
        </p>
        <div style={{ fontSize: '3rem', fontWeight: 'bold', color: 'white' }}>
          {overallScore.score}%
        </div>
        <div style={{ marginTop: '1rem', fontSize: '1rem', color: 'var(--text-secondary)' }}>
          Spot Price: <span style={{ color: 'white', fontWeight: 'bold' }}>{spotPrice.toFixed(2)}</span>
        </div>
      </div>

      {error && (
        <div style={{ color: 'var(--bearish)', marginBottom: '1rem', padding: '1rem', background: 'rgba(255, 0, 0, 0.05)', borderRadius: '8px' }}>
          {error}
        </div>
      )}

      {/* 2. Grid of 4 Mathematical Models */}
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
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div style={{ fontSize: '1.2rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Target Expiry Strike</div>
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
