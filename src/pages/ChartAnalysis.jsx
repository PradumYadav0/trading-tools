import React, { useEffect, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';

const ChartAnalysis = () => {
  const chartContainerRef = useRef();
  const chartRef = useRef();
  const seriesRef = useRef();
  const [symbol, setSymbol] = useState('NIFTY');
  const [interval, setInterval] = useState('5');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [debugStatus, setDebugStatus] = useState('Idle');

  useEffect(() => {
    if (!chartContainerRef.current) return;

    try {
      chartRef.current = createChart(chartContainerRef.current, {
        width: chartContainerRef.current.clientWidth || 800,
        height: 500,
        layout: {
          background: { type: 'solid', color: '#0B0F19' },
          textColor: '#94A3B8',
        },
        grid: {
          vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
          horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
        },
        timeScale: {
          borderColor: 'rgba(255, 255, 255, 0.1)',
          timeVisible: true,
        },
      });

      seriesRef.current = chartRef.current.addCandlestickSeries({
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

      fetchData();

      return () => {
        resizeObserver.disconnect();
        if (chartRef.current) {
          chartRef.current.remove();
          chartRef.current = null;
        }
      };
    } catch (e) {
      console.error('Chart Error:', e);
      setDebugStatus('Error creating chart: ' + e.message);
    }
  }, []);

  // Fetch data when symbol or interval changes
  useEffect(() => {
    if (seriesRef.current) {
      fetchData();
    }
  }, [symbol, interval]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    setDebugStatus('Fetching data...');
    try {
      let url = '';
      if (interval === 'DAY' || interval === 'MONTH') {
        url = `/api/charts/historical?symbol=${symbol}`;
      } else {
        url = `/api/charts/intraday?symbol=${symbol}&interval=${interval}`;
      }

      const response = await fetch(url);
      
      if (response.status === 429) {
        setDebugStatus('Error: Rate limit reached. Wait 1 min.');
        setError('Dhan API rate limit reached.');
        setLoading(false);
        return;
      }

      const result = await response.json();
      
      if (result.success && result.data) {
        let chartData = result.data
          .filter(d => d.close !== undefined && d.close !== null)
          .sort((a, b) => a.time - b.time);

        // Deduplicate
        const uniqueChartData = [];
        const seenTimes = new Set();
        for (const candle of chartData) {
          if (!seenTimes.has(candle.time)) {
            seenTimes.add(candle.time);
            uniqueChartData.push(candle);
          }
        }

        seriesRef.current.setData(uniqueChartData);
        setDebugStatus(`Loaded ${uniqueChartData.length} candles.`);
        chartRef.current.timeScale().fitContent();
      } else {
        setError(result.message || 'Failed to fetch data');
        setDebugStatus('Error: ' + (result.message || 'Failed to fetch'));
      }
    } catch (err) {
      setError('Error connecting to server');
      setDebugStatus('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container" style={{ padding: '2rem', color: 'white' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem' }}>Chart Analysis</h1>
        
        <div style={{ display: 'flex', gap: '1rem' }}>
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
            <option value="1">1 Min</option>
            <option value="5">5 Min</option>
            <option value="15">15 Min</option>
            <option value="DAY">Daily</option>
          </select>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '1rem', marginBottom: '2rem', minHeight: '520px' }}>
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
          Debug Status: <span style={{ color: 'var(--primary-color)', fontWeight: 'bold' }}>{debugStatus}</span>
        </div>
        
        {loading && <p>Loading data...</p>}
        {error && <p style={{ color: 'var(--bearish)' }}>{error}</p>}
        
        <div ref={chartContainerRef} style={{ width: '100%', height: '500px' }} />
      </div>
    </div>
  );
};

export default ChartAnalysis;
