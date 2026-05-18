import React, { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts';
import { RefreshCw, AlertCircle, TrendingUp, TrendingDown, Zap } from 'lucide-react';

const ChartAnalysis = () => {
  const chartContainerRef = useRef();
  const chartRef = useRef(null);
  const candlestickSeriesRef = useRef(null);
  const ema9SeriesRef = useRef(null);
  const ema20SeriesRef = useRef(null);
  
  const [symbol, setSymbol] = useState('NIFTY');
  const [interval, setInterval] = useState('5');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const [decision, setDecision] = useState({
    action: 'WAIT',
    reason: 'Loading data...',
    target: 'N/A',
    stoploss: 'N/A',
    color: 'var(--text-secondary)'
  });

  useEffect(() => {
    // Initialize chart
    if (chartContainerRef.current) {
      try {
        const width = chartContainerRef.current.clientWidth || 800;
        const chart = createChart(chartContainerRef.current, {
          width: width,
          height: 500,
          layout: {
            background: { color: '#111827' },
            textColor: '#D1D5DB',
          },
          grid: {
            vertLines: { color: '#1F2937' },
            horzLines: { color: '#1F2937' },
          },
          crosshair: { mode: 1 },
          timeScale: { timeVisible: true, secondsVisible: false },
        });

        // Candlestick Series
        const candlestickSeries = chart.addSeries(CandlestickSeries, {
          upColor: '#10B981',
          downColor: '#EF4444',
          borderUpColor: '#10B981',
          borderDownColor: '#EF4444',
          wickUpColor: '#10B981',
          wickDownColor: '#EF4444',
        });

        // EMA 9 Line (Blue)
        const ema9Series = chart.addSeries(LineSeries, {
          color: '#3B82F6',
          lineWidth: 2,
          title: 'EMA 9',
        });

        // EMA 20 Line (Yellow)
        const ema20Series = chart.addSeries(LineSeries, {
          color: '#F59E0B',
          lineWidth: 2,
          title: 'EMA 20',
        });

        chartRef.current = chart;
        candlestickSeriesRef.current = candlestickSeries;
        ema9SeriesRef.current = ema9Series;
        ema20SeriesRef.current = ema20Series;

        // Handle resize
        const handleResize = () => {
          if (chartContainerRef.current) {
            chart.applyOptions({ width: chartContainerRef.current.clientWidth });
          }
        };
        window.addEventListener('resize', handleResize);

        // Fetch initial data
        fetchData();

        return () => {
          window.removeEventListener('resize', handleResize);
          chart.remove();
        };
      } catch (e) {
        console.error('Error creating chart:', e);
        setError('Error initializing chart: ' + e.message);
      }
    }
  }, []);

  // Fetch data when symbol or interval changes
  useEffect(() => {
    fetchData();
  }, [symbol, interval]);

  const calculateEMA = (data, period) => {
    const k = 2 / (period + 1);
    let emaArray = [];
    let ema = data[0].close;
    
    for (let i = 0; i < data.length; i++) {
      if (i === 0) {
        emaArray.push({ time: data[i].time, value: ema });
      } else {
        ema = (data[i].close * k) + (ema * (1 - k));
        emaArray.push({ time: data[i].time, value: ema });
      }
    }
    return emaArray;
  };

  const fetchData = async () => {
    if (!candlestickSeriesRef.current) return;

    setLoading(true);
    setError(null);

    try {
      // 1. Fetch Chart Data
      const chartUrl = interval === 'D' 
        ? `/api/charts/historical?symbol=${symbol}`
        : `/api/charts/intraday?symbol=${symbol}&interval=${interval}`;
        
      const chartResponse = await fetch(chartUrl);
      const chartResult = await chartResponse.json();

      // 2. Fetch Option Chain Data
      const ocResponse = await fetch(`/api/option-chain?symbol=${symbol}`);
      const ocResult = await ocResponse.json();

      if (chartResult.success && chartResult.data && chartResult.data.length > 0) {
        // Validate and sort chart data
        const validData = chartResult.data.filter(item => typeof item.time === 'number' && !isNaN(item.time));
        const sortedData = validData.sort((a, b) => a.time - b.time);
        
        // Remove duplicates
        const uniqueData = [];
        const seenTimes = new Set();
        for (const item of sortedData) {
          if (!seenTimes.has(item.time)) {
            seenTimes.add(item.time);
            uniqueData.push(item);
          }
        }

        // Set Candlestick data
        candlestickSeriesRef.current.setData(uniqueData);

        // Calculate and set EMAs
        if (uniqueData.length >= 20) {
          const ema9Data = calculateEMA(uniqueData, 9);
          const ema20Data = calculateEMA(uniqueData, 20);
          
          ema9SeriesRef.current.setData(ema9Data);
          ema20SeriesRef.current.setData(ema20Data);

          // Get latest values for decision
          const lastCandle = uniqueData[uniqueData.length - 1];
          const lastEma9 = ema9Data[ema9Data.length - 1].value;
          const lastEma20 = ema20Data[ema20Data.length - 1].value;

          // Option Chain Data
          let pcr = 1.0;
          let support = 'N/A';
          let resistance = 'N/A';

          if (ocResult.success && ocResult.data) {
            // Find Support/Resistance from Max OI
            let maxCallOi = 0;
            let maxPutOi = 0;
            let totalCallOi = 0;
            let totalPutOi = 0;

            ocResult.data.forEach(strike => {
              totalCallOi += strike.callOi;
              totalPutOi += strike.putOi;
              if (strike.callOi > maxCallOi) {
                maxCallOi = strike.callOi;
                resistance = strike.strike;
              }
              if (strike.putOi > maxPutOi) {
                maxPutOi = strike.putOi;
                support = strike.strike;
              }
            });
            pcr = totalCallOi > 0 ? totalPutOi / totalCallOi : 1.0;
          }

          // Make Decision
          let action = 'WAIT';
          let reason = 'Market is in neutral zone or conflicting signals.';
          let color = 'var(--text-secondary)';
          let target = 'N/A';
          let stoploss = 'N/A';

          const isBullishCrossover = lastEma9 > lastEma20;
          const isPriceAboveEma = lastCandle.close > lastEma9;

          if (isBullishCrossover && isPriceAboveEma && pcr > 1.1) {
            action = 'BUY CALL';
            reason = '9 EMA crossed above 20 EMA, price is above EMA, and PCR is bullish (>1.1). Strong momentum!';
            color = 'var(--bullish)';
            target = resistance;
            stoploss = support !== 'N/A' ? support : lastEma20.toFixed(2);
          } else if (!isBullishCrossover && !isPriceAboveEma && pcr < 0.9) {
            action = 'BUY PUT';
            reason = '9 EMA is below 20 EMA, price is below EMA, and PCR is bearish (<0.9). Trend is down.';
            color = 'var(--bearish)';
            target = support;
            stoploss = resistance !== 'N/A' ? resistance : lastEma20.toFixed(2);
          } else if (isBullishCrossover && !isPriceAboveEma) {
            action = 'WAIT';
            reason = 'EMA is bullish but price broke below 9 EMA. Wait for pullback or reversal.';
            color = '#EAB308';
          } else if (!isBullishCrossover && isPriceAboveEma) {
            action = 'WAIT';
            reason = 'EMA is bearish but price is bouncing. High risk of trap.';
            color = '#EAB308';
          }

          setDecision({ action, reason, target, stoploss, color });
        } else {
          setDecision({ action: 'WAIT', reason: 'Not enough data points to calculate indicators (min 20 required).', color: '#EAB308', target: 'N/A', stoploss: 'N/A' });
        }

        chartRef.current.timeScale().fitContent();
      } else {
        setError(chartResult.message || 'Failed to fetch chart data');
      }
    } catch (err) {
      setError('Error connecting to server');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container" style={{ padding: '2rem', color: 'white' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>Chart Analysis & Signals</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Automated Decision System (9 EMA + 20 EMA + Option Chain)</p>
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

          <select 
            value={interval} 
            onChange={(e) => setInterval(e.target.value)}
            style={{ padding: '0.5rem', background: '#1E293B', color: 'white', border: '1px solid #334155', borderRadius: '6px' }}
          >
            <option value="5">5 Min</option>
            <option value="10">10 Min</option>
            <option value="15">15 Min</option>
            <option value="60">1 Hour</option>
            <option value="D">1 Day</option>
          </select>

          <button 
            onClick={fetchData}
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

      {/* Decision Box requested by user */}
      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem', border: `2px solid ${decision.color}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Zap size={24} fill={decision.color} color={decision.color} />
            <h2 style={{ fontSize: '1.5rem', margin: 0 }}>Auto Trade Advisor</h2>
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: decision.color }}>
            {decision.action}
          </div>
        </div>
        
        <p style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'white' }}>{decision.reason}</p>
        
        <div style={{ display: 'flex', gap: '2rem' }}>
          <div>
            <span style={{ color: 'var(--text-secondary)' }}>Expected Target: </span>
            <span style={{ fontWeight: 'bold', color: 'var(--bullish)' }}>{decision.target}</span>
          </div>
          <div>
            <span style={{ color: 'var(--text-secondary)' }}>Strict Stoploss: </span>
            <span style={{ fontWeight: 'bold', color: 'var(--bearish)' }}>{decision.stoploss}</span>
          </div>
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

      <div className="glass-panel" style={{ padding: '1rem', minHeight: '520px' }}>
        <div ref={chartContainerRef} style={{ width: '100%', height: '500px' }} />
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem', marginTop: '1.5rem' }}>
        <h3>Legend</h3>
        <div style={{ display: 'flex', gap: '2rem', marginTop: '0.5rem', fontSize: '0.9rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: '12px', height: '12px', background: '#3B82F6' }}></div>
            <span>EMA 9 (Short term trend)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: '12px', height: '12px', background: '#F59E0B' }}></div>
            <span>EMA 20 (Medium term trend)</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChartAnalysis;
