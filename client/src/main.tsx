import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import HealthCheck from './HealthCheck';
import './index.css';

function getPage() {
  switch (window.location.pathname) {
    case '/healthcheck':
      return <HealthCheck />;
    default:
      return <App />;
  }
}

const page = getPage();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{page}</React.StrictMode>
);
