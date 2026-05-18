import React, { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';
import { RefreshCw, AlertCircle } from 'lucide-react';

const ChartAnalysis = () => {
  const chartContainerRef = useRef();
  const chartRef = useRef(null);
  const candlestickSeriesRef = useRef(null);
  
  const [symbol, setSymbol] = useState('NIFTY');
  const [interval, setInterval] = useState('5');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Initialize chart
    if (chartContainerRef.current) {
      try {
        const width = chartContainerRef.current.clientWidth || 800; // Fallback to 800 if 0
        const chart = createChart(chartContainerRef.current, {
          width: width,
          height: 600,
          layout: {
            background: { color: '#111827' },
            textColor: '#D1D5DB',
          },
          grid: {
            vertLines: { color: '#1F2937' },
            horzLines: { color: '#1F2937' },
          },
          crosshair: {
            mode: 1, // Normal mode
          },
          timeScale: {
            timeVisible: true,
            secondsVisible: false,
          },
        });

        // Use addSeries with CandlestickSeries for version 5.0+
        const candlestickSeries = chart.addSeries(CandlestickSeries, {
          upColor: '#10B981',
          downColor: '#EF4444',
          borderUpColor: '#10B981',
          borderDownColor: '#EF4444',
          wickUpColor: '#10B981',
          wickDownColor: '#EF4444',
        });

        chartRef.current = chart;
        candlestickSeriesRef.current = candlestickSeries;

        // Handle resize
        const handleResize = () => {
          if (chartContainerRef.current) {
            chart.applyOptions({ width: chartContainerRef.current.clientWidth });
          }
        };
        window.addEventListener('resize', handleResize);

        // Fetch initial data
        fetchChartData();

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
    fetchChartData();
  }, [symbol, interval]);

  const fetchChartData = async () => {
    if (!candlestickSeriesRef.current) return;

    setLoading(true);
    setError(null);

    try {
      const url = interval === 'D' 
        ? `/api/charts/historical?symbol=${symbol}`
        : `/api/charts/intraday?symbol=${symbol}&interval=${interval}`;
        
      const response = await fetch(url);
      const result = await response.json();

      if (result.success && result.data) {
        // Filter and validate data
        const validData = result.data.filter(item => {
          return item && typeof item.time === 'number' && !isNaN(item.time) && item.time > 0;
        });

        if (validData.length === 0) {
          setError('No valid chart data received from server');
          return;
        }

        // Sort data by time ascending (required by lightweight-charts)
        const sortedData = validData.sort((a, b) => a.time - b.time);
        
        // Remove duplicates if any
        const uniqueData = [];
        const seenTimes = new Set();
        for (const item of sortedData) {
          if (!seenTimes.has(item.time)) {
            seenTimes.add(item.time);
            uniqueData.push(item);
          }
        }

        try {
          candlestickSeriesRef.current.setData(uniqueData);
          chartRef.current.timeScale().fitContent();
        } catch (chartError) {
          console.error('Lightweight charts error:', chartError);
          setError('Error rendering chart data: ' + chartError.message);
        }
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

  return (
    <div className="container" style={{ padding: '2rem', color: 'white' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Chart Analysis</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Powered by Dhan API Live Data</p>
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
            <option value="M">1 Month</option>
          </select>

          <button 
            onClick={fetchChartData}
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

      <div className="glass-panel" style={{ padding: '1rem', minHeight: '620px' }}>
        <div ref={chartContainerRef} style={{ width: '100%', height: '600px' }} />
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem', marginTop: '2rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>How it works</h3>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
          This chart uses the **Lightweight Charts** library by TradingView but fetches actual data from the **Dhan API** via your backend. 
          This ensures that the data you see here is the same data used by the AI Analysis and Signal Generator systems.
        </p>
      </div>
    </div>
  );
};

export default ChartAnalysis;
