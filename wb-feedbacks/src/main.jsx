import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister();
    }
  });
}

const rootEl = document.getElementById('root');

if (!rootEl) {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<p style="padding:1rem;font-family:system-ui;color:#b91c1c">Не найден контейнер #root</p>'
  );
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  );
}
