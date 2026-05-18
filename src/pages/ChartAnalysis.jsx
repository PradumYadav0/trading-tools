import React from 'react';

const ChartAnalysis = () => {
  return (
    <div className="container" style={{ padding: '2rem', color: 'white' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Chart Analysis (Debug Mode)</h1>
      <div style={{ background: 'rgba(255,255,255,0.05)', padding: '2rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
        <p style={{ fontSize: '1.2rem', color: 'var(--primary-color)', marginBottom: '1rem' }}>
          Hello! If you can see this message, it means the React Component is rendering perfectly fine.
        </p>
        <p style={{ color: 'var(--text-secondary)' }}>
          This proves that the blank screen is NOT because of a basic React error, but specifically because of the Chart Library (lightweight-charts) or the data being passed to it.
        </p>
      </div>
    </div>
  );
};

export default ChartAnalysis;
