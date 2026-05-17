import React, { useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';

const ChartAnalysis = () => {
  const chartContainerRef = useRef();

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 400,
      layout: {
        background: { color: '#161B22' },
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
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#10B981',
      downColor: '#EF4444',
      borderVisible: false,
      wickUpColor: '#10B981',
      wickDownColor: '#EF4444',
    });

    // Mock Data
    candleSeries.setData([
      { time: '2026-05-10', open: 22000, high: 22100, low: 21950, close: 22050 },
      { time: '2026-05-11', open: 22050, high: 22200, low: 22000, close: 22150 },
      { time: '2026-05-12', open: 22150, high: 22180, low: 22050, close: 22100 },
      { time: '2026-05-13', open: 22100, high: 22300, low: 22080, close: 22250 },
      { time: '2026-05-14', open: 22250, high: 22350, low: 22200, close: 22300 },
      { time: '2026-05-15', open: 22300, high: 22500, low: 22250, close: 22450 },
    ]);

    const handleResize = () => {
      chart.applyOptions({ width: chartContainerRef.current.clientWidth });
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  return (
    <div className="container">
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Chart Analysis</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Technical analysis and automated pattern detection.</p>
      </div>

      <div className="glass-panel" style={{ padding: '1rem', marginBottom: '2rem' }}>
        <div ref={chartContainerRef} style={{ width: '100%' }} />
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Technical Suggestions</h3>
        <div style={{ display: 'flex', gap: '1rem', flexDirection: 'column' }}>
          <div style={{ padding: '1rem', background: 'rgba(16, 185, 129, 0.05)', borderRadius: '10px', border: '1px solid rgba(16, 185, 129, 0.1)' }}>
            <div style={{ color: 'var(--bullish)', fontWeight: '600', marginBottom: '0.25rem' }}>Bullish Trend Intact</div>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Price is trading above 20 DMA. Suggesting a strong uptrend. Look for buying opportunities on pullbacks.</p>
          </div>
          <div style={{ padding: '1rem', background: 'rgba(245, 158, 11, 0.05)', borderRadius: '10px', border: '1px solid rgba(245, 158, 11, 0.1)' }}>
            <div style={{ color: 'var(--neutral)', fontWeight: '600', marginBottom: '0.25rem' }}>RSI Divergence Warning</div>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>RSI is making lower highs while price is making higher highs. Possible exhaustion. Avoid aggressive buying at current levels.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChartAnalysis;
