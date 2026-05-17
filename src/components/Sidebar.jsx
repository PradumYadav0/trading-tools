import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BarChart2, LineChart, Settings, Zap } from 'lucide-react';

const Sidebar = () => {
  return (
    <div className="sidebar">
      <div className="logo-area">
        <div className="logo-icon">
          <Zap size={20} fill="white" />
        </div>
        <span>TradeSuggest</span>
      </div>
      
      <ul className="nav-links">
        <li className="nav-item">
          <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} end>
            <LayoutDashboard size={20} />
            <span>Dashboard</span>
          </NavLink>
        </li>
        <li className="nav-item">
          <NavLink to="/option-chain" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <BarChart2 size={20} />
            <span>Option Chain</span>
          </NavLink>
        </li>
        <li className="nav-item">
          <NavLink to="/charts" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <LineChart size={20} />
            <span>Chart Analysis</span>
          </NavLink>
        </li>
        <li className="nav-item">
          <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <Settings size={20} />
            <span>Settings</span>
          </NavLink>
        </li>
      </ul>
    </div>
  );
};

export default Sidebar;
