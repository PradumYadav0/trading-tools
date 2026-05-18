import React, { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts';
import { RefreshCw, AlertCircle, Zap, TrendingUp, TrendingDown, Minus } from 'lucide-react';

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
    color: 'var(--text-secondary)',
    spotPrice: 'N/A'
  });

  const [indicators, setIndicators] = useState({
    ema9: { status: 'Loading...', color: 'var(--text-secondary)' },
    ema20: { status: 'Loading...', color: 'var(--text-secondary)' },
    emaCross: { status: 'Loading...', color: 'var(--text-secondary)' },
    rsi: { value: 'N/A', status: 'Loading...', color: 'var(--text-secondary)' },
    macd: { status: 'Loading...', color: 'var(--text-secondary)' },
    pcr: { value: 'N/A', status: 'Loading...', color: 'var(--text-secondary)' }
  });

  useEffect(() => {
    // Initialize chart
    if (chartContainerRef.current) {
      try {
        const width = chartContainerRef.current.clientWidth || 800;
        const chart = createChart(chartContainerRef.current, {
          width: width,
          height: 400, // Reduced height to fit the larger info box
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

  // Helper function to calculate EMA
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

  // Helper function to calculate RSI
  const calculateRSI = (data, period = 14) => {
    if (data.length < period) return [];
    
    let gains = 0;
    let losses = 0;
    
    for (let i = 1; i <= period; i++) {
      const diff = data[i].close - data[i-1].close;
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    
    let avgGain = gains / period;
    let avgLoss = losses / period;
    
    let rsiArray = [];
    const firstRS = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiArray.push({ time: data[period].time, value: 100 - (100 / (1 + firstRS)) });
    
    for (let i = period + 1; i < data.length; i++) {
      const diff = data[i].close - data[i-1].close;
      const gain = diff >= 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      
      avgGain = ((avgGain * (period - 1)) + gain) / period;
      avgLoss = ((avgLoss * (period - 1)) + loss) / period;
      
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      const rsi = 100 - (100 / (1 + rs));
      rsiArray.push({ time: data[i].time, value: rsi });
    }
    
    return rsiArray;
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

        if (uniqueData.length >= 26) {
          // Calculate EMAs
          const ema9Data = calculateEMA(uniqueData, 9);
          const ema20Data = calculateEMA(uniqueData, 20);
          
          ema9SeriesRef.current.setData(ema9Data);
          ema20SeriesRef.current.setData(ema20Data);

          // Calculate RSI
          const rsiData = calculateRSI(uniqueData, 14);
          
          // Calculate MACD (Simplified for latest point)
          const ema12Data = calculateEMA(uniqueData, 12);
          const ema26Data = calculateEMA(uniqueData, 26);
          const lastEma12 = ema12Data[ema12Data.length - 1].value;
          const lastEma26 = ema26Data[ema26Data.length - 1].value;
          const macdLine = lastEma12 - lastEma26;

          // Get latest values
          const lastCandle = uniqueData[uniqueData.length - 1];
          const lastEma9 = ema9Data[ema9Data.length - 1].value;
          const lastEma20 = ema20Data[ema20Data.length - 1].value;
          const lastRsi = rsiData.length > 0 ? rsiData[rsiData.length - 1].value : 50;

          // Option Chain Data
          let pcr = 1.0;
          let support = 'N/A';
          let resistance = 'N/A';

          if (ocResult.success && ocResult.data) {
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

          // Individual Indicator Analysis
          const indStatus = {
            ema9: lastCandle.close > lastEma9 ? { status: 'Bullish (Price Above)', color: 'var(--bullish)' } : { status: 'Bearish (Price Below)', color: 'var(--bearish)' },
            ema20: lastCandle.close > lastEma20 ? { status: 'Bullish (Price Above)', color: 'var(--bullish)' } : { status: 'Bearish (Price Below)', color: 'var(--bearish)' },
            emaCross: lastEma9 > lastEma20 ? { status: 'Bullish (9 > 20)', color: 'var(--bullish)' } : { status: 'Bearish (9 < 20)', color: 'var(--bearish)' },
            rsi: { value: lastRsi.toFixed(2), status: lastRsi > 70 ? 'Overbought' : lastRsi < 30 ? 'Oversold' : 'Neutral', color: lastRsi > 70 ? 'var(--bearish)' : lastRsi < 30 ? 'var(--bullish)' : 'var(--text-secondary)' },
            macd: macdLine > 0 ? { status: 'Bullish (Above 0)', color: 'var(--bullish)' } : { status: 'Bearish (Below 0)', color: 'var(--bearish)' },
            pcr: { value: pcr.toFixed(2), status: pcr > 1.1 ? 'Bullish' : pcr < 0.9 ? 'Bearish' : 'Neutral', color: pcr > 1.1 ? 'var(--bullish)' : pcr < 0.9 ? 'var(--bearish)' : 'var(--text-secondary)' }
          };
          setIndicators(indStatus);

          // Overall Decision
          let action = 'WAIT';
          let reason = 'Market is in neutral zone or conflicting signals.';
          let color = 'var(--text-secondary)';
          let target = 'N/A';
          let stoploss = 'N/A';

          // Scoring system
          let bullishScore = 0;
          let bearishScore = 0;

          if (indStatus.ema9.status.includes('Bullish')) bullishScore++; else bearishScore++;
          if (indStatus.ema20.status.includes('Bullish')) bullishScore++; else bearishScore++;
          if (indStatus.emaCross.status.includes('Bullish')) bullishScore++; else bearishScore++;
          if (macdLine > 0) bullishScore++; else bearishScore++;
          if (pcr > 1.1) bullishScore++; else if (pcr < 0.9) bearishScore++;
          if (lastRsi < 40) bullishScore++; else if (lastRsi > 60) bearishScore++;

          if (bullishScore >= 4 && lastCandle.close > lastEma9) {
            action = 'BUY CALL';
            reason = `Strong Bullish consensus (${bullishScore}/6 indicators). Price is in upward momentum.`;
            color = 'var(--bullish)';
            target = resistance;
            stoploss = support !== 'N/A' ? support : lastEma20.toFixed(2);
          } else if (bearishScore >= 4 && lastCandle.close < lastEma9) {
            action = 'BUY PUT';
            reason = `Strong Bearish consensus (${bearishScore}/6 indicators). Trend is clearly downward.`;
            color = 'var(--bearish)';
            target = support;
            stoploss = resistance !== 'N/A' ? resistance : lastEma20.toFixed(2);
          } else {
            action = 'WAIT';
            reason = `No clear consensus (Bullish: ${bullishScore}, Bearish: ${bearishScore}). High risk of whipsaws.`;
            color = '#EAB308';
          }

          setDecision({ action, reason, target, stoploss, color, spotPrice: lastCandle.close });
        } else {
          setDecision({ action: 'WAIT', reason: 'Not enough data points to calculate all indicators (min 26 required).', color: '#EAB308', target: 'N/A', stoploss: 'N/A', spotPrice: 'N/A' });
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

  const getIndicatorIcon = (color) => {
    if (color === 'var(--bullish)') return <TrendingUp size={16} color="var(--bullish)" />;
    if (color === 'var(--bearish)') return <TrendingDown size={16} color="var(--bearish)" />;
    return <Minus size={16} color="var(--text-secondary)" />;
  };

  return (
    <div className="container" style={{ padding: '2rem', color: 'white' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>Chart Analysis & Signals</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Multi-Indicator Decision System</p>
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

      {/* Advanced Decision Box */}
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
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '1rem' }}>
          {/* Left Column: Indicator Breakdown */}
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px' }}>
            <h4 style={{ marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>Indicator Analysis</h4>
            <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.9rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>9 EMA</span>
                <span style={{ color: indicators.ema9.color, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  {getIndicatorIcon(indicators.ema9.color)} {indicators.ema9.status}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>20 EMA</span>
                <span style={{ color: indicators.ema20.color, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  {getIndicatorIcon(indicators.ema20.color)} {indicators.ema20.status}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>EMA Crossover</span>
                <span style={{ color: indicators.emaCross.color, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  {getIndicatorIcon(indicators.emaCross.color)} {indicators.emaCross.status}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>RSI (14)</span>
                <span style={{ color: indicators.rsi.color, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  {getIndicatorIcon(indicators.rsi.color)} {indicators.rsi.value} ({indicators.rsi.status})
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>MACD (12, 26)</span>
                <span style={{ color: indicators.macd.color, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  {getIndicatorIcon(indicators.macd.color)} {indicators.macd.status}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>PCR (Open Interest)</span>
                <span style={{ color: indicators.pcr.color, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  {getIndicatorIcon(indicators.pcr.color)} {indicators.pcr.value} ({indicators.pcr.status})
                </span>
              </div>
            </div>
          </div>

          {/* Right Column: Decision & Levels */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <h4 style={{ marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Analysis Result</h4>
              <p style={{ fontSize: '1.1rem', color: 'white', lineHeight: '1.4' }}>{decision.reason}</p>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '8px' }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Spot Price</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{decision.spotPrice}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '8px' }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Expected Target</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--bullish)' }}>{decision.target}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '8px', gridColumn: 'span 2' }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Strict Stoploss</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--bearish)' }}>{decision.stoploss}</div>
              </div>
            </div>
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

      <div className="glass-panel" style={{ padding: '1rem', minHeight: '420px' }}>
        <div ref={chartContainerRef} style={{ width: '100%', height: '400px' }} />
      </div>
    </div>
  );
};

export default ChartAnalysis;
