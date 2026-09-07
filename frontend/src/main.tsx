import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

// Prevent browser context menu on UI chrome (desktop native feel)
window.addEventListener('contextmenu', (e) => {
  const target = e.target as HTMLElement;
  if (!target.closest('input, textarea, .document-prose, pre, code')) {
    e.preventDefault();
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
