import React, { useState, useEffect } from 'react';
import axios from 'axios';

const FullOptionChain = ({ activeSymbol }) => {
  const [optionChainData, setOptionChainData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchChain = async () => {
      try {
        const response = await axios.get(`/api/option-chain?symbol=${activeSymbol}`);
        if (response.data.success) {
          setOptionChainData(response.data);
        }
        setLoading(false);
      } catch (error) {
        console.error('Error fetching option chain:', error);
        setLoading(false);
      }
    };

    fetchChain();
    const interval = setInterval(fetchChain, 2000); // 2 second refresh
    return () => clearInterval(interval);
  }, [activeSymbol]);

  if (loading || !optionChainData) {
    return <div style={{ padding: '20px', textAlign: 'center', color: 'var(--primary)' }}>LOADING ADVANCED CHAIN...</div>;
  }

  const { data: strikes, spotPrice } = optionChainData;

  const formatLakhs = (val) => (val / 100000).toFixed(1) + 'L';
  const formatK = (val) => (val / 1000).toFixed(1) + 'K';

  return (
    <div className="glass-panel" style={{ padding: '0', overflowX: 'auto', border: '1px solid var(--primary-glow)' }}>
      <div style={{ minWidth: '1000px' }}>
        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(17, 1fr)', background: 'rgba(255,255,255,0.05)', padding: '12px', borderBottom: '1px solid var(--border)' }}>
          {/* CE Headers */}
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: '9px' }}>VEGA</div>
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: '9px' }}>GAMMA</div>
          <div style={{ color: 'var(--danger)', textAlign: 'center', fontSize: '9px' }}>THETA</div>
          <div style={{ color: 'var(--primary)', textAlign: 'center', fontSize: '9px' }}>DELTA</div>
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: '9px' }}>IV</div>
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: '9px' }}>VOL</div>
          <div style={{ color: 'var(--danger)', textAlign: 'center', fontSize: '10px', fontWeight: 800 }}>CALL OI</div>
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: '10px' }}>CE LTP</div>
          
          {/* Center */}
          <div style={{ color: 'var(--primary)', textAlign: 'center', fontSize: '11px', fontWeight: 900 }}>STRIKE</div>
          
          {/* PE Headers */}
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: '10px' }}>PE LTP</div>
          <div style={{ color: 'var(--success)', textAlign: 'center', fontSize: '10px', fontWeight: 800 }}>PUT OI</div>
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: '9px' }}>VOL</div>
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: '9px' }}>IV</div>
          <div style={{ color: 'var(--primary)', textAlign: 'center', fontSize: '9px' }}>DELTA</div>
          <div style={{ color: 'var(--danger)', textAlign: 'center', fontSize: '9px' }}>THETA</div>
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: '9px' }}>GAMMA</div>
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: '9px' }}>VEGA</div>
        </div>

        {/* Rows */}
        <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
          {strikes.map((s, idx) => {
            const isATM = s.strike === spotPrice;
            const isITM_CE = s.strike < spotPrice;
            const isITM_PE = s.strike > spotPrice;

            return (
              <div key={idx} style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(17, 1fr)', 
                padding: '12px 6px', 
                borderBottom: '1px solid rgba(255,255,255,0.02)',
                background: isATM ? 'rgba(0, 255, 255, 0.15)' : 'transparent',
                borderTop: isATM ? '1px solid var(--primary)' : 'none',
                borderBottom2: isATM ? '1px solid var(--primary)' : 'none',
                transition: 'background 0.2s ease',
                position: 'relative',
                alignItems: 'center'
              }} className="hover-highlight">
                
                {/* Call Side (Left) */}
                <div style={{ textAlign: 'center', fontSize: '9px', color: 'var(--text-muted)', background: isITM_CE ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{s.CE.vega}</div>
                <div style={{ textAlign: 'center', fontSize: '9px', color: 'var(--text-muted)', background: isITM_CE ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{s.CE.gamma}</div>
                <div style={{ textAlign: 'center', fontSize: '9px', color: 'var(--danger)', background: isITM_CE ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{s.CE.theta}</div>
                <div style={{ textAlign: 'center', fontSize: '10px', color: 'var(--primary)', fontWeight: 600, background: isITM_CE ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{s.CE.delta}</div>
                <div style={{ textAlign: 'center', fontSize: '10px', color: 'var(--warning)', background: isITM_CE ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{s.CE.iv}</div>
                <div style={{ textAlign: 'center', fontSize: '10px', color: 'var(--text-muted)', background: isITM_CE ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{formatK(s.CE.volume)}</div>
                <div style={{ textAlign: 'center', fontSize: '11px', fontWeight: 600, color: 'white', background: isITM_CE ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{formatLakhs(s.CE.oi)}</div>
                <div style={{ textAlign: 'center', fontSize: '13px', color: 'var(--danger)', fontWeight: 800, background: isITM_CE ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{s.CE.ltp}</div>
                
                {/* Strike (Center) */}
                <div style={{ textAlign: 'center', fontSize: '14px', fontWeight: 900, color: 'var(--primary)', background: 'rgba(0, 255, 136, 0.08)', borderRadius: '4px', padding: '4px 0' }}>
                  {s.strike}
                </div>
                
                {/* Put Side (Right) */}
                <div style={{ textAlign: 'center', fontSize: '13px', color: 'var(--success)', fontWeight: 800, background: isITM_PE ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{s.PE.ltp}</div>
                <div style={{ textAlign: 'center', fontSize: '11px', fontWeight: 600, color: 'white', background: isITM_PE ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{formatLakhs(s.PE.oi)}</div>
                <div style={{ textAlign: 'center', fontSize: '10px', color: 'var(--text-muted)', background: isITM_PE ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{formatK(s.PE.volume)}</div>
                <div style={{ textAlign: 'center', fontSize: '10px', color: 'var(--warning)', background: isITM_PE ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{s.PE.iv}</div>
                <div style={{ textAlign: 'center', fontSize: '10px', color: 'var(--primary)', fontWeight: 600, background: isITM_PE ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{s.PE.delta}</div>
                <div style={{ textAlign: 'center', fontSize: '9px', color: 'var(--danger)', background: isITM_PE ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{s.PE.theta}</div>
                <div style={{ textAlign: 'center', fontSize: '9px', color: 'var(--text-muted)', background: isITM_PE ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{s.PE.gamma}</div>
                <div style={{ textAlign: 'center', fontSize: '9px', color: 'var(--text-muted)', background: isITM_PE ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{s.PE.vega}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default FullOptionChain;
