import React from 'react';
import { Bell, User, Search, Wifi } from 'lucide-react';

const Header = () => {
  return (
    <header className="header">
      <div className="header-left">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h2 style={{ fontSize: '1.25rem', color: 'var(--text-primary)' }}>Market Overview</h2>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.5rem', 
            fontSize: '0.85rem', 
            color: 'var(--bullish)',
            background: 'rgba(16, 185, 129, 0.1)',
            padding: '0.25rem 0.75rem',
            borderRadius: '20px',
            fontWeight: '500'
          }}>
            <Wifi size={14} />
            <span>Connected to Dhan</span>
          </div>
        </div>
      </div>

      <div className="header-right" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={18} style={{ position: 'absolute', left: '12px', color: 'var(--text-muted)' }} />
          <input 
            type="text" 
            placeholder="Search symbol..." 
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              padding: '0.5rem 1rem 0.5rem 2.5rem',
              color: 'var(--text-primary)',
              width: '240px',
              fontSize: '0.9rem',
              outline: 'none',
              transition: 'var(--transition-smooth)'
            }}
            onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
            onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
          />
        </div>

        <div style={{ display: 'flex', gap: '1rem' }}>
          <button style={{ 
            background: 'none', 
            border: 'none', 
            color: 'var(--text-secondary)', 
            cursor: 'pointer',
            position: 'relative'
          }}>
            <Bell size={20} />
            <span style={{
              position: 'absolute',
              top: '-2px',
              right: '-2px',
              width: '8px',
              height: '8px',
              background: 'var(--bearish)',
              borderRadius: '50%'
            }}></span>
          </button>
          
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.5rem', 
            cursor: 'pointer',
            background: 'rgba(255, 255, 255, 0.03)',
            padding: '0.35rem 0.75rem',
            borderRadius: '10px',
            border: '1px solid var(--border-color)'
          }}>
            <User size={18} color="var(--text-secondary)" />
            <span style={{ fontSize: '0.9rem', fontWeight: '500' }}>Trader</span>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
