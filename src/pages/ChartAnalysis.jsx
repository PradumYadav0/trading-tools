import React, { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';
import { AlertCircle, RefreshCw } from 'lucide-react';

const ChartAnalysis = () => {
  const chartContainerRef = useRef();
  const [symbol, setSymbol] = useState('NIFTY');
  const [interval, setInterval] = useState('5'); // '1', '5', '15', '60', 'DAY', 'MONTH'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart
    chartRef.current = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth || 800,
      height: 500,
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: '#94A3B8',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      crosshair: {
        mode: 0,
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        timeVisible: true,
      },
    });

    // Add series
    seriesRef.current = chartRef.current.addSeries(CandlestickSeries, {
      upColor: '#10B981',
      downColor: '#EF4444',
      borderVisible: false,
      wickUpColor: '#10B981',
      wickDownColor: '#EF4444',
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(entries => {
      if (entries.length === 0 || entries[0].target !== chartContainerRef.current) return;
      const newRect = entries[0].contentRect;
      chartRef.current.applyOptions({ width: newRect.width });
    });

    resizeObserver.observe(chartContainerRef.current);

    // Fetch initial data
    fetchData();

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
    if (!seriesRef.current) return;
    
    setLoading(true);
    setError(null);
    try {
      let url = '';
      if (interval === 'DAY' || interval === 'MONTH') {
        url = `/api/charts/historical?symbol=${symbol}`;
      } else {
        url = `/api/charts/intraday?symbol=${symbol}&interval=${interval}`;
      }

      const response = await fetch(url);
      const result = await response.json();
      
      if (result.success && result.data) {
        let chartData = result.data.sort((a, b) => a.time - b.time);
        
        if (interval === 'MONTH') {
          // Aggregate daily data to monthly
          chartData = aggregateToMonthly(chartData);
        }
        
        seriesRef.current.setData(chartData);
        chartRef.current.timeScale().fitContent();
      } else {
        setError(result.message || 'Failed to fetch chart data');
      }
    } catch (err) {
      setError('Error connecting to server');
      console.error(err);
    } finally {
      setLoading(false);
    }
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
          time: candle.time, // Use the time of the first day of the month as reference
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        };
      } else {
        // Update high and low
        monthlyMap[key].high = Math.max(monthlyMap[key].high, candle.high);
        monthlyMap[key].low = Math.min(monthlyMap[key].low, candle.low);
        // Update close to the latest candle in the month
        monthlyMap[key].close = candle.close;
      }
    });
    
    // Convert map back to array and sort by time
    return Object.values(monthlyMap).sort((a, b) => a.time - b.time).map(item => ({
      time: item.time,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close
    }));
  };

  return (
    <div className="container">
      <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Chart Analysis</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Live data from Dhan API</p>
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
            <option value="15">15 Minutes</option>
            <option value="60">1 Hour</option>
            <option value="DAY">1 Day</option>
            <option value="MONTH">Monthly</option>
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
                : 'Viewing intraday data. (Note: Intraday data might not be available on market holidays or weekends).'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChartAnalysis;
