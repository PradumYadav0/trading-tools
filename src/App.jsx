import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import OptionChain from './pages/OptionChain';
import ChartAnalysis from './pages/ChartAnalysis';
import TradingSignals from './pages/TradingSignals';
import Settings from './pages/Settings';
import './App.css';

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <Router>
      <div className="app-container">
        {/* Sidebar */}
        <Sidebar isOpen={sidebarOpen} closeSidebar={() => setSidebarOpen(false)} />
        
        {/* Mobile Backdrop */}
        {sidebarOpen && (
          <div 
            className="sidebar-backdrop" 
            onClick={() => setSidebarOpen(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100vw',
              height: '100vh',
              background: 'rgba(0, 0, 0, 0.5)',
              zIndex: 9,
              backdropFilter: 'blur(2px)'
            }}
          ></div>
        )}

        <div className="main-content" style={{ marginLeft: '260px' }}>
          <Header toggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
          <div className="content-area">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/option-chain" element={<OptionChain />} />
              <Route path="/charts" element={<ChartAnalysis />} />
              <Route path="/signals" element={<TradingSignals />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </div>
        </div>
      </div>
    </Router>
  );
}

export default App;
