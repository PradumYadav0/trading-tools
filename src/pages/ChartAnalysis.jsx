import React, { useEffect, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';
import { AlertCircle, RefreshCw, Brain, Sparkles, X } from 'lucide-react';

const ChartAnalysis = () => {
  const chartContainerRef = useRef();
  const [symbol, setSymbol] = useState('NIFTY');
  const [interval, setInterval] = useState('5'); // '1', '5', '10', '15', '60', 'DAY', 'MONTH'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [aiCooldown, setAiCooldown] = useState(false);
  const [technicalSignals, setTechnicalSignals] = useState({ ema: 'N/A', rsi: 'N/A', status: 'N/A' });
  const [debugStatus, setDebugStatus] = useState('Idle');

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart with basic options and try-catch
    try {
      chartRef.current = createChart(chartContainerRef.current, {
        width: 800,
        height: 500,
      });
    } catch (e) {
      console.error('Error creating chart:', e);
      setError('Failed to initialize chart: ' + e.message);
      return;
    }

    // Add series
    seriesRef.current = chartRef.current.addCandlestickSeries({
      upColor: '#10B981',
      downColor: '#EF4444',
      borderVisible: false,
      wickUpColor: '#10B981',
      wickDownColor: '#EF4444',
    });

    // Add a dummy candle to test rendering
    seriesRef.current.setData([
      { time: Math.floor(Date.now() / 1000), open: 22000, high: 22100, low: 21900, close: 22050 }
    ]);

    // Add EMA Line Series
    const emaSeries = chartRef.current.addLineSeries({
      color: '#F59E0B', // Amber color for EMA
      lineWidth: 2,
      title: 'EMA 9',
    });
    
    // Store reference to EMA series
    chartRef.current.emaSeries = emaSeries;

    // Handle resize
    const resizeObserver = new ResizeObserver(entries => {
      if (entries.length === 0 || entries[0].target !== chartContainerRef.current) return;
      const newRect = entries[0].contentRect;
      chartRef.current.applyOptions({ width: newRect.width });
    });

    resizeObserver.observe(chartContainerRef.current);

    // Fetch initial data
    // fetchData();

    return () => {
      resizeObserver.disconnect();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, []);

  // Fetch data when symbol or interval changes
  useEffect(() => {
    fetchData();
  }, [symbol, interval]);

  const fetchData = async () => {
    if (!seriesRef.current) {
      setDebugStatus('Error: seriesRef.current is null');
      return;
    }
    
    setLoading(true);
    setError(null);
    setDebugStatus('Fetching data from API...');
    try {
      let url = '';
      if (interval === 'DAY' || interval === 'MONTH') {
        url = `/api/charts/historical?symbol=${symbol}`;
      } else if (interval === '10') {
        url = `/api/charts/intraday?symbol=${symbol}&interval=5`;
      } else {
        url = `/api/charts/intraday?symbol=${symbol}&interval=${interval}`;
      }

      setDebugStatus(`Calling URL: ${url}`);
      const response = await fetch(url);
      
      if (response.status === 429) {
        setDebugStatus('Error: Dhan API Limit reached. Please wait 1-2 minutes without refreshing.');
        setError('Dhan API rate limit reached. Please wait a moment before refreshing again.');
        setLoading(false);
        return;
      }

      setDebugStatus('Response received, parsing JSON...');
      const result = await response.json();
      
      if (result.success && result.data) {
        setDebugStatus(`Success! Data length: ${result.data.length}. Processing...`);
        // Filter out any invalid candles and sort
        let chartData = result.data
          .filter(d => d.close !== undefined && d.close !== null)
          .sort((a, b) => a.time - b.time);
        
        // Deduplicate by time (CRITICAL for lightweight-charts)
        const uniqueChartData = [];
        const seenTimes = new Set();
        chartData.forEach(item => {
          if (!seenTimes.has(item.time)) {
            seenTimes.add(item.time);
            uniqueChartData.push(item);
          }
        });
        chartData = uniqueChartData;
        
        if (interval === 'MONTH') {
          chartData = aggregateToMonthly(chartData);
        } else if (interval === '10') {
          chartData = aggregateTo10Min(chartData);
        }
        
        // Add IST offset (5 hours 30 mins = 19800 seconds) for intraday charts
        if (interval !== 'DAY' && interval !== 'MONTH') {
          chartData = chartData.map(item => ({
            ...item,
            time: item.time + 19800
          }));
        }
        
        seriesRef.current.setData(chartData);
        setDebugStatus(`Chart updated with ${chartData.length} candles.`);
        
        chartRef.current.timeScale().fitContent();
      } else {
        setError(result.message || 'Failed to fetch chart data');
      }
    } catch (err) {
      setError('Error connecting to server');
      setDebugStatus('Error: ' + err.message);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Helper to aggregate 5m candles to 10m
  const aggregateTo10Min = (fiveMinData) => {
    const tenMinData = [];
    for (let i = 0; i < fiveMinData.length; i += 2) {
      const first = fiveMinData[i];
      const second = fiveMinData[i + 1];
      
      if (second) {
        tenMinData.push({
          time: first.time,
          open: first.open,
          high: Math.max(first.high, second.high),
          low: Math.min(first.low, second.low),
          close: second.close
        });
      } else {
        tenMinData.push(first);
      }
    }
    return tenMinData;
  };

  // Helper to aggregate daily candles to monthly
  const aggregateToMonthly = (dailyData) => {
    const monthlyMap = {};
    
    dailyData.forEach(candle => {
      const date = new Date(candle.time * 1000);
      const year = date.getFullYear();
      const month = date.getMonth();
      const key = `${year}-${month}`;
      
      if (!monthlyMap[key]) {
        monthlyMap[key] = {
          time: candle.time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        };
      } else {
        monthlyMap[key].high = Math.max(monthlyMap[key].high, candle.high);
        monthlyMap[key].low = Math.min(monthlyMap[key].low, candle.low);
        monthlyMap[key].close = candle.close;
      }
    });
    
    return Object.values(monthlyMap).sort((a, b) => a.time - b.time).map(item => ({
      time: item.time,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close
    }));
  };

  // Helper to calculate EMA
  const calculateEMA = (data, period) => {
    const k = 2 / (period + 1);
    let emaData = [];
    
    if (data.length === 0) return emaData;
    
    let ema = data[0].close; // Start with first close
    emaData.push({ time: data[0].time, value: ema });
    
    for (let i = 1; i < data.length; i++) {
      ema = (data[i].close * k) + (ema * (1 - k));
      emaData.push({ time: data[i].time, value: ema });
    }
    return emaData;
  };

  // Helper to calculate RSI
  const calculateRSI = (data, period = 14) => {
    let rsiData = [];
    if (data.length < period + 1) return rsiData;
    
    let gains = [];
    let losses = [];
    
    for (let i = 1; i < data.length; i++) {
      const change = data[i].close - data[i-1].close;
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? -change : 0);
    }
    
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    let rs = avgGain / (avgLoss || 1);
    let rsi = 100 - (100 / (1 + rs));
    
    rsiData.push({ time: data[period].time, value: rsi });
    
    for (let i = period + 1; i < data.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i-1]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i-1]) / period;
      
      rs = avgGain / (avgLoss || 1);
      rsi = 100 - (100 / (1 + rs));
      rsiData.push({ time: data[i].time, value: rsi });
    }
    
    return rsiData;
  };

  const handleAiAnalysis = async () => {
    if (aiCooldown) return;
    setAiLoading(true);
    setAiResponse('');
    setModalOpen(true);
    
    setAiCooldown(true);
    setTimeout(() => setAiCooldown(false), 30000);

    try {
      // 1. Take screenshot of chart
      const canvas = chartContainerRef.current.querySelector('canvas');
      let base64Image = '';
      if (canvas) {
        base64Image = canvas.toDataURL('image/png');
      }

      // 2. Call API
      const response = await fetch('/api/ai-analysis', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          symbol, 
          image: base64Image
        })
      });
      
      const result = await response.json();
      if (result.success) {
        setAiResponse(result.analysis);
      } else {
        setAiResponse('Error: ' + result.message);
      }
    } catch (err) {
      setAiResponse('Error connecting to server');
      console.error(err);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="container">
      <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Chart Analysis</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Live data from Dhan API (IST Timezone)</p>
        </div>
        
        {/* Controls */}
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

          <select 
            value={interval} 
            onChange={(e) => setInterval(e.target.value)}
            style={{ 
              background: '#1E293B', 
              color: 'white', 
              border: '1px solid var(--border-color)', 
              padding: '0.5rem 1rem', 
              borderRadius: '8px',
              cursor: 'pointer'
            }}
          >
            <option value="1">1 Minute</option>
            <option value="5">5 Minutes</option>
            <option value="10">10 Minutes</option>
            <option value="15">15 Minutes</option>
            <option value="60">1 Hour</option>
            <option value="DAY">1 Day</option>
            <option value="MONTH">Monthly</option>
          </select>

          <button 
            onClick={fetchData}
            disabled={loading}
            style={{ 
              background: 'rgba(255, 255, 255, 0.05)', 
              color: 'white', 
              border: '1px solid var(--border-color)', 
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

          <button 
            onClick={handleAiAnalysis}
            disabled={aiCooldown}
            style={{ 
              background: 'linear-gradient(135deg, #6366F1 0%, #A855F7 100%)', 
              color: 'white', 
              border: 'none', 
              padding: '0.5rem 1.25rem', 
              borderRadius: '8px',
              cursor: aiCooldown ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontWeight: '600',
              opacity: aiCooldown ? 0.7 : 1
            }}
          >
            <Sparkles size={16} />
            {aiCooldown ? 'Wait 30s...' : 'Ask AI'}
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

      <div className="glass-panel" style={{ padding: '1rem', marginBottom: '2rem', minHeight: '520px', position: 'relative' }}>
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '0.5rem', background: 'rgba(255,255,255,0.05)', padding: '0.5rem', borderRadius: '4px' }}>
          Debug Status: <span style={{ color: 'var(--primary-color)', fontWeight: 'bold' }}>{debugStatus}</span>
        </div>
        {loading && !error && (
          <div style={{ 
            position: 'absolute', 
            top: 0, left: 0, right: 0, bottom: 0, 
            background: 'rgba(15, 23, 42, 0.5)', 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center',
            zIndex: 10,
            borderRadius: '12px'
          }}>
            <RefreshCw size={24} className="spin" style={{ color: 'var(--primary-color)' }} />
          </div>
        )}
        <div ref={chartContainerRef} style={{ width: '100%', height: '500px' }} />
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Technical Suggestions</h3>
        <div style={{ display: 'flex', gap: '1rem', flexDirection: 'column' }}>
          <div style={{ padding: '1rem', background: 'rgba(16, 185, 129, 0.05)', borderRadius: '10px', border: '1px solid rgba(16, 185, 129, 0.1)' }}>
            <div style={{ color: 'var(--bullish)', fontWeight: '600', marginBottom: '0.25rem' }}>Automated Insights</div>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              {interval === 'DAY' || interval === 'MONTH' 
                ? 'Viewing historical data. Monthly view is auto-aggregated from daily data.' 
                : interval === '10' 
                ? 'Viewing 10-minute data (Aggregated from 5-minute candles).' 
                : 'Viewing intraday data. Time is shown in Indian Standard Time (IST).'}
            </p>
          </div>
        </div>
      </div>

      {/* AI Analysis Modal */}
      {modalOpen && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(5px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
          animation: 'fadeIn 0.3s ease-out'
        }}>
          <div className="glass-panel" style={{
            width: '90%',
            maxWidth: '600px',
            maxHeight: '80vh',
            overflowY: 'auto',
            padding: '2rem',
            position: 'relative',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
          }}>
            <button 
              onClick={() => setModalOpen(false)}
              style={{
                position: 'absolute',
                top: '1rem',
                right: '1rem',
                background: 'rgba(255,255,255,0.05)',
                border: 'none',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                cursor: 'pointer',
                color: 'var(--text-secondary)'
              }}
            >
              <X size={18} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
              <Brain size={24} color="#A855F7" />
              <h2 style={{ fontSize: '1.5rem' }}>AI Chart & Option Chain Analysis</h2>
            </div>

            {aiLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '3rem 0' }}>
                <RefreshCw size={36} className="spin" style={{ color: '#A855F7', marginBottom: '1rem' }} />
                <p style={{ color: 'var(--text-secondary)' }}>AI is analyzing the chart screenshot and option chain...</p>
              </div>
            ) : (
              <div style={{ 
                color: 'var(--text-primary)', 
                fontSize: '1.05rem', 
                lineHeight: '1.8',
                whiteSpace: 'pre-wrap',
                fontFamily: 'Inter, sans-serif'
              }}>
                {aiResponse}
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default ChartAnalysis;
