import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Entry point for the network performance dashboard.  We use
// ReactDOM.createRoot to render the root component.  StrictMode
// enforces additional checks during development.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);