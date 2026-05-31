import React, { useState, createContext, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import OptionChain from './pages/OptionChain';
import ChartAnalysis from './pages/ChartAnalysis';
import TradingSignals from './pages/TradingSignals';
import AiAnalysis from './pages/AiAnalysis';
import AiTesting from './pages/AiTesting';
import Settings from './pages/Settings';
import OptionDecoder from './pages/OptionDecoder';
import OpenClawAi from './pages/OpenClawAi';
import PaperTrading from './pages/PaperTrading';
import ScalpCharts from './pages/ScalpCharts';
import Login from './pages/Login';
import axios from 'axios';
import './App.css';

// Set axios defaults on load
const savedToken = localStorage.getItem('sessionToken');
if (savedToken) {
  axios.defaults.headers.common['Authorization'] = `Bearer ${savedToken}`;
}

export const AuthContext = createContext(null);

function App() {
  const [token, setToken] = useState(localStorage.getItem('sessionToken') || null);
  const [username, setUsername] = useState(localStorage.getItem('username') || null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLoginSuccess = (newToken, newUsername) => {
    localStorage.setItem('sessionToken', newToken);
    localStorage.setItem('username', newUsername);
    axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
    setToken(newToken);
    setUsername(newUsername);
  };

  const handleLogout = async () => {
    try {
      await axios.post('/api/auth/logout');
    } catch (e) {
      console.error('Logout API failed:', e);
    }
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('username');
    delete axios.defaults.headers.common['Authorization'];
    setToken(null);
    setUsername(null);
  };

  // Setup response interceptor to handle 401s (expired session)
  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response && error.response.status === 401) {
          // Invalidate session
          localStorage.removeItem('sessionToken');
          localStorage.removeItem('username');
          delete axios.defaults.headers.common['Authorization'];
          setToken(null);
          setUsername(null);
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(interceptor);
  }, []);

  return (
    <AuthContext.Provider value={{ token, username, login: handleLoginSuccess, logout: handleLogout }}>
      <Router>
        {!token ? (
          <div className="login-wrapper" style={{ background: 'var(--bg-dark)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Login onLoginSuccess={handleLoginSuccess} />
          </div>
        ) : (
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
                  <Route path="/ai-analysis" element={<AiAnalysis />} />
                  <Route path="/ai-testing" element={<AiTesting />} />
                  <Route path="/option-decoder" element={<OptionDecoder />} />
                  <Route path="/openclaw-ai" element={<OpenClawAi />} />
                  <Route path="/paper-trading" element={<PaperTrading />} />
                  <Route path="/scalp-charts" element={<ScalpCharts />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </div>
            </div>
          </div>
        )}
      </Router>
    </AuthContext.Provider>
  );
}

export default App;
