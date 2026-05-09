import React from 'react';
import { LayoutDashboard, Activity, BarChart2, ShieldCheck, Lightbulb, Settings, Zap, PlayCircle } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

const Sidebar = () => {
  const location = useLocation();
  
  const menuItems = [
    { name: 'Dashboard', icon: <LayoutDashboard size={20} />, path: '/' },
    { name: 'Live Signal', icon: <Zap size={20} />, path: '/signal' },
    { name: 'Deep Analysis', icon: <BarChart2 size={20} />, path: '/analysis' },
    { name: 'Risk Control', icon: <ShieldCheck size={20} />, path: '/risk' },
    { name: 'AI Insights', icon: <Lightbulb size={20} />, path: '/insights' },
    { name: 'Settings', icon: <Settings size={20} />, path: '/settings' },
  ];

  return (
    <div className="glass-panel" style={{ width: '240px', height: 'calc(100vh - 32px)', display: 'flex', flexDirection: 'column', padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '32px', padding: '0 8px' }}>
        <div style={{ background: 'var(--primary)', padding: '6px', borderRadius: '8px' }}>
          <Zap size={20} color="black" />
        </div>
        <h2 style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '1px' }}>TRADING PRO</h2>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
        {menuItems.map((item) => (
          <Link 
            key={item.path} 
            to={item.path}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '12px', 
              padding: '12px 16px', 
              borderRadius: '10px', 
              textDecoration: 'none',
              color: location.pathname === item.path ? 'var(--primary)' : 'var(--text-secondary)',
              background: location.pathname === item.path ? 'rgba(0, 255, 136, 0.05)' : 'transparent',
              transition: 'all 0.2s ease',
              border: location.pathname === item.path ? '1px solid rgba(0, 255, 136, 0.1)' : '1px solid transparent'
            }}
          >
            {item.icon}
            <span style={{ fontSize: '14px', fontWeight: 600 }}>{item.name}</span>
          </Link>
        ))}
      </nav>

      <div className="glass-card" style={{ padding: '12px', marginTop: 'auto', background: 'rgba(0, 255, 136, 0.03)' }}>
        <p style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' }}>CONNECTION STATUS</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '8px', height: '8px', background: 'var(--success)', borderRadius: '50%' }}></div>
          <span style={{ fontSize: '12px', fontWeight: 600 }}>KOTAK NEO LIVE</span>
        </div>
      </div>
      {/* Win-Rate Tracker Widget */}
      <div style={{ padding: '20px', borderTop: '1px solid var(--border)', background: 'rgba(0, 255, 136, 0.02)' }}>
        <p style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '1px' }}>AI ACCURACY</p>
        <h2 style={{ color: 'var(--success)', margin: '4px 0' }}>84.5%</h2>
        <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', marginTop: '8px' }}>
          <div style={{ width: '84.5%', height: '100%', background: 'var(--success)', borderRadius: '10px', boxShadow: '0 0 10px var(--success)' }}></div>
        </div>
        <p style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '8px' }}>Last 100 Signals Verified</p>
      </div>
    </div>
  );
};

export default Sidebar;
