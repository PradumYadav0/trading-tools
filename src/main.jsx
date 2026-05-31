import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Intercept native fetch to automatically add the Authorization header for local API calls
const originalFetch = window.fetch;
window.fetch = async (input, init) => {
  let url = typeof input === 'string' ? input : input?.url;
  if (url) {
    const isApiRoute = url.startsWith('/api') || url.includes('/api/');
    const isExternal = url.startsWith('http') && !url.includes(window.location.host);
    if (isApiRoute && !isExternal) {
      const token = localStorage.getItem('sessionToken');
      if (token) {
        init = init || {};
        init.headers = init.headers || {};
        if (init.headers instanceof Headers) {
          if (!init.headers.has('Authorization')) {
            init.headers.append('Authorization', `Bearer ${token}`);
          }
        } else if (Array.isArray(init.headers)) {
          const hasAuth = init.headers.some(([key]) => key.toLowerCase() === 'authorization');
          if (!hasAuth) {
            init.headers.push(['Authorization', `Bearer ${token}`]);
          }
        } else {
          if (!init.headers['Authorization'] && !init.headers['authorization']) {
            init.headers['Authorization'] = `Bearer ${token}`;
          }
        }
      }
    }
  }
  return originalFetch(input, init);
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

