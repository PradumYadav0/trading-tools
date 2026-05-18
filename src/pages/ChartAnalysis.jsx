import React, { useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';

const ChartAnalysis = () => {
  const chartContainerRef = useRef();
  const chartRef = useRef();

  useEffect(() => {
    if (!chartContainerRef.current) return;

    try {
      chartRef.current = createChart(chartContainerRef.current, {
        width: 800,
        height: 500,
      });

      const series = chartRef.current.addCandlestickSeries();
      series.setData([
        { time: '2026-05-18', open: 22000, high: 22100, low: 21900, close: 22050 }
      ]);
    } catch (e) {
      console.error('Chart Error:', e);
    }

    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, []);

  return (
    <div className="container" style={{ padding: '2rem', color: 'white' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Chart Analysis (Simple Mode)</h1>
      <div ref={chartContainerRef} style={{ width: '800px', height: '500px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }} />
    </div>
  );
};

export default ChartAnalysis;
