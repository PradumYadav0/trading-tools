import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const FullOptionChain = ({ activeSymbol }) => {
  const [optionChainData, setOptionChainData] = useState(null);
  const [loading, setLoading] = useState(true);
  
  const atmRef = useRef(null);
  const [hasScrolled, setHasScrolled] = useState(false);

  // Reset scroll lock when symbol changes
  useEffect(() => {
    setHasScrolled(false);
  }, [activeSymbol]);

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

  // Auto-scroll to ATM
  useEffect(() => {
    if (!hasScrolled && atmRef.current) {
      // Small timeout to ensure DOM is fully rendered
      setTimeout(() => {
        if (atmRef.current) {
          atmRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setHasScrolled(true);
        }
      }, 100);
    }
  });

  if (loading || !optionChainData) {
    return <div style={{ padding: '20px', textAlign: 'center', color: 'var(--primary)' }}>LOADING ADVANCED CHAIN...</div>;
  }

  const { data: strikes, spotPrice } = optionChainData;

  const formatLakhs = (val) => (val / 100000).toFixed(1) + 'L';
  const formatK = (val) => (val / 1000).toFixed(1) + 'K';

  // Find ATM strike and max OI/Volume
  let closestStrike = strikes[0]?.strike;
  let minDiff = Infinity;
  let maxCeOi = 0; let maxPeOi = 0;
  let maxCeVol = 0; let maxPeVol = 0;

  strikes.forEach(s => {
    const diff = Math.abs(s.strike - spotPrice);
    if (diff < minDiff) {
      minDiff = diff;
      closestStrike = s.strike;
    }
    if (s.CE.oi > maxCeOi) maxCeOi = s.CE.oi;
    if (s.PE.oi > maxPeOi) maxPeOi = s.PE.oi;
    if (s.CE.volume > maxCeVol) maxCeVol = s.CE.volume;
    if (s.PE.volume > maxPeVol) maxPeVol = s.PE.volume;
  });

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
            const isATM = s.strike === closestStrike;
            const isITM_CE = s.strike < spotPrice;
            const isITM_PE = s.strike > spotPrice;

            const isMaxCeOi = s.CE.oi === maxCeOi && maxCeOi > 0;
            const isMaxPeOi = s.PE.oi === maxPeOi && maxPeOi > 0;
            const isMaxCeVol = s.CE.volume === maxCeVol && maxCeVol > 0;
            const isMaxPeVol = s.PE.volume === maxPeVol && maxPeVol > 0;

            return (
              <div ref={isATM ? atmRef : null} key={idx} style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(17, 1fr)', 
                padding: '12px 6px', 
                borderBottom: '1px solid rgba(255,255,255,0.02)',
                background: isATM ? 'rgba(0, 255, 136, 0.2)' : 'transparent',
                borderTop: isATM ? '2px solid var(--primary)' : 'none',
                borderBottom2: isATM ? '2px solid var(--primary)' : 'none',
                transition: 'background 0.2s ease',
                position: 'relative',
                alignItems: 'center'
              }} className="hover-highlight">
                
                {/* Call Side (Left) */}
                <div style={{ textAlign: 'center', fontSize: '9px', color: 'var(--text-muted)', background: isITM_CE && !isATM ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{s.CE.vega}</div>
                <div style={{ textAlign: 'center', fontSize: '9px', color: 'var(--text-muted)', background: isITM_CE && !isATM ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{s.CE.gamma}</div>
                <div style={{ textAlign: 'center', fontSize: '9px', color: 'var(--danger)', background: isITM_CE && !isATM ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{s.CE.theta}</div>
                <div style={{ textAlign: 'center', fontSize: '10px', color: 'var(--primary)', fontWeight: 600, background: isITM_CE && !isATM ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{s.CE.delta}</div>
                <div style={{ textAlign: 'center', fontSize: '10px', color: 'var(--warning)', background: isITM_CE && !isATM ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{s.CE.iv}</div>
                
                {/* CE Vol */}
                <div style={{ textAlign: 'center', fontSize: '10px', color: isMaxCeVol ? '#000' : 'var(--text-muted)', background: isMaxCeVol ? '#00ff88' : (isITM_CE && !isATM ? 'rgba(255,255,0,0.03)' : 'transparent'), fontWeight: isMaxCeVol ? 900 : 400, borderRadius: isMaxCeVol ? '4px' : '0' }}>{formatK(s.CE.volume)}</div>
                
                {/* CE OI */}
                <div style={{ textAlign: 'center', fontSize: '11px', fontWeight: isMaxCeOi ? 900 : 600, color: isMaxCeOi ? '#fff' : 'white', background: isMaxCeOi ? '#ff3b30' : (isITM_CE && !isATM ? 'rgba(255,255,0,0.03)' : 'transparent'), border: isMaxCeOi ? '1px solid #ff3b30' : 'none', borderRadius: isMaxCeOi ? '4px' : '0' }}>{formatLakhs(s.CE.oi)}</div>
                
                <div style={{ textAlign: 'center', fontSize: '13px', color: 'var(--danger)', fontWeight: 800, background: isITM_CE && !isATM ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{s.CE.ltp}</div>
                
                {/* Strike (Center) */}
                <div style={{ textAlign: 'center', fontSize: '14px', fontWeight: 900, color: isATM ? '#000' : 'var(--primary)', background: isATM ? 'var(--primary)' : 'rgba(0, 255, 136, 0.08)', borderRadius: '4px', padding: '4px 0', boxShadow: isATM ? '0 0 15px var(--primary)' : 'none' }}>
                  {s.strike}
                </div>
                
                {/* Put Side (Right) */}
                <div style={{ textAlign: 'center', fontSize: '13px', color: 'var(--success)', fontWeight: 800, background: isITM_PE && !isATM ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{s.PE.ltp}</div>
                
                {/* PE OI */}
                <div style={{ textAlign: 'center', fontSize: '11px', fontWeight: isMaxPeOi ? 900 : 600, color: isMaxPeOi ? '#fff' : 'white', background: isMaxPeOi ? '#ff3b30' : (isITM_PE && !isATM ? 'rgba(255,255,0,0.03)' : 'transparent'), border: isMaxPeOi ? '1px solid #ff3b30' : 'none', borderRadius: isMaxPeOi ? '4px' : '0' }}>{formatLakhs(s.PE.oi)}</div>
                
                {/* PE Vol */}
                <div style={{ textAlign: 'center', fontSize: '10px', color: isMaxPeVol ? '#000' : 'var(--text-muted)', background: isMaxPeVol ? '#00ff88' : (isITM_PE && !isATM ? 'rgba(255,255,0,0.03)' : 'transparent'), fontWeight: isMaxPeVol ? 900 : 400, borderRadius: isMaxPeVol ? '4px' : '0' }}>{formatK(s.PE.volume)}</div>
                
                <div style={{ textAlign: 'center', fontSize: '10px', color: 'var(--warning)', background: isITM_PE && !isATM ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{s.PE.iv}</div>
                <div style={{ textAlign: 'center', fontSize: '10px', color: 'var(--primary)', fontWeight: 600, background: isITM_PE && !isATM ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{s.PE.delta}</div>
                <div style={{ textAlign: 'center', fontSize: '9px', color: 'var(--danger)', background: isITM_PE && !isATM ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{s.PE.theta}</div>
                <div style={{ textAlign: 'center', fontSize: '9px', color: 'var(--text-muted)', background: isITM_PE && !isATM ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{s.PE.gamma}</div>
                <div style={{ textAlign: 'center', fontSize: '9px', color: 'var(--text-muted)', background: isITM_PE && !isATM ? 'rgba(255,255,0,0.03)' : 'transparent' }}>{s.PE.vega}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default FullOptionChain;
