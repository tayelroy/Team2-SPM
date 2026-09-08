import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import HealthCheck from './HealthCheck';
import Profile from './Profile';
import './index.css';

function routeFor(pathname: string) {
  if (pathname === '/healthcheck') return <HealthCheck />;
  if (pathname === '/profile') return <Profile />;
  return <App />;
}

const page = routeFor(window.location.pathname);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{page}</React.StrictMode>
);
