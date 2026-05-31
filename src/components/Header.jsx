import React, { useState, useEffect, useContext } from 'react';
import { Bell, User, Search, Wifi, WifiOff, Menu, LogOut } from 'lucide-react';
import { getMarketStatus } from '../utils/market';
import { AuthContext } from '../App';

const Header = ({ toggleSidebar }) => {
  const { logout, username } = useContext(AuthContext);
  const [marketStatus, setMarketStatus] = useState({ isOpen: false, reason: 'Checking...' });

  useEffect(() => {
    const checkMarketStatus = () => {
      setMarketStatus(getMarketStatus());
    };

    checkMarketStatus();
    const interval = setInterval(checkMarketStatus, 15000); // Check every 15 seconds
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="header">
      <div className="header-left">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* Hamburger Menu on mobile */}
          <button 
            className="mobile-menu-btn"
            onClick={toggleSidebar}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Menu size={24} />
          </button>
          
          <h2 style={{ fontSize: '1.25rem', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>Market Overview</h2>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.5rem', 
            fontSize: '0.85rem', 
            color: marketStatus.isOpen ? 'var(--bullish)' : 'var(--bearish)',
            background: marketStatus.isOpen ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            padding: '0.25rem 0.75rem',
            borderRadius: '20px',
            fontWeight: '600',
            whiteSpace: 'nowrap',
            border: `1px solid ${marketStatus.isOpen ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
            transition: 'all 0.3s ease'
          }}>
            {marketStatus.isOpen ? <Wifi size={14} /> : <WifiOff size={14} />}
            <span>Market: {marketStatus.isOpen ? 'OPEN' : `CLOSED (${marketStatus.reason})`}</span>
          </div>
        </div>
      </div>

      <div className="header-right" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <div className="search-container" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
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
              width: '180px',
              fontSize: '0.9rem',
              outline: 'none',
              transition: 'var(--transition-smooth)'
            }}
            onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
            onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
          />
        </div>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
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
            background: 'rgba(255, 255, 255, 0.03)',
            padding: '0.35rem 0.75rem',
            borderRadius: '10px',
            border: '1px solid var(--border-color)'
          }}>
            <User size={18} color="var(--text-secondary)" />
            <span style={{ fontSize: '0.9rem', fontWeight: '500' }}>{username || 'Trader'}</span>
          </div>

          <button 
            onClick={logout}
            style={{ 
              background: 'rgba(239, 68, 68, 0.1)', 
              border: '1px solid rgba(239, 68, 68, 0.2)', 
              color: '#ef4444', 
              cursor: 'pointer',
              padding: '0.35rem 0.75rem',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.25rem',
              fontSize: '0.85rem',
              fontWeight: '600',
              transition: 'var(--transition-smooth)'
            }}
            title="Sign Out"
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
          >
            <LogOut size={16} />
            <span style={{ display: 'none' }}>Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
