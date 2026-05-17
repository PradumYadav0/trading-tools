import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BarChart2, LineChart, Settings, Zap, X } from 'lucide-react';

const Sidebar = ({ isOpen, closeSidebar }) => {
  return (
    <div className={`sidebar ${isOpen ? 'open' : ''}`}>
      <div className="logo-area">
        <div className="logo-icon">
          <Zap size={20} fill="white" />
        </div>
        <span>TradeSuggest</span>
        {/* Close button on mobile */}
        <button 
          className="mobile-close-btn" 
          onClick={closeSidebar}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            marginLeft: 'auto'
          }}
        >
          <X size={24} />
        </button>
      </div>
      
      <ul className="nav-links">
        <li className="nav-item">
          <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} end onClick={closeSidebar}>
            <LayoutDashboard size={20} />
            <span>Dashboard</span>
          </NavLink>
        </li>
        <li className="nav-item">
          <NavLink to="/option-chain" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={closeSidebar}>
            <BarChart2 size={20} />
            <span>Option Chain</span>
          </NavLink>
        </li>
        <li className="nav-item">
          <NavLink to="/charts" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={closeSidebar}>
            <LineChart size={20} />
            <span>Chart Analysis</span>
          </NavLink>
        </li>
        <li className="nav-item">
          <NavLink to="/signals" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={closeSidebar}>
            <Zap size={20} />
            <span>Trading Signals</span>
          </NavLink>
        </li>
        <li className="nav-item">
          <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={closeSidebar}>
            <Settings size={20} />
            <span>Settings</span>
          </NavLink>
        </li>
      </ul>
    </div>
  );
};

export default Sidebar;
