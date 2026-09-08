import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import HealthCheck from './HealthCheck';
import './index.css';

const page = window.location.pathname === '/healthcheck' ? <HealthCheck /> : <App />;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{page}</React.StrictMode>
);
