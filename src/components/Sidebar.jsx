import React from 'react';
import { LayoutDashboard, Activity, BarChart2, ShieldCheck, Lightbulb, Settings, Zap, PlayCircle } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

const Sidebar = () => {
  const location = useLocation();
  
  const menuItems = [
    { name: 'Dashboard', icon: <LayoutDashboard size={20} />, path: '/' },
    { name: 'Live Signal', icon: <Zap size={20} />, path: '/signal' },
    { name: 'Chart AI', icon: <BarChart2 size={20} />, path: '/chart' },
    { name: 'Option AI', icon: <Lightbulb size={20} />, path: '/analysis' },
    { name: 'Risk Control', icon: <ShieldCheck size={20} />, path: '/risk' },
    { name: 'Settings', icon: <Settings size={20} />, path: '/settings' },
  ];

  return (
    <div className="glass-panel sidebar" style={{ width: '240px', height: 'calc(100vh - 32px)', display: 'flex', flexDirection: 'column', padding: '16px' }}>
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
    </div>
  );
};

export default Sidebar;
