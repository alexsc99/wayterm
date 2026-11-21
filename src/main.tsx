import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/index.css';
import { loadAppearance } from './utils/appearance';
import { applyAppTheme } from './utils/appThemes';

// The palette variables must exist before anything renders, including the error boundary fallback.
const storedAppearance = loadAppearance();
applyAppTheme(storedAppearance.appTheme, storedAppearance.accent);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary area="Wayterm" variant="overlay">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
