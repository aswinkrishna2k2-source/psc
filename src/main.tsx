import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App.tsx';
import { ToastProvider } from './components/Toast.tsx';
import { Alert } from './components/ui.tsx';
import { firebaseConfigured } from './lib/firebase.ts';
import { SessionProvider } from './lib/session.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {firebaseConfigured ? (
      <BrowserRouter>
        <ToastProvider>
          <SessionProvider>
            <App />
          </SessionProvider>
        </ToastProvider>
      </BrowserRouter>
    ) : (
      <div className="mx-auto max-w-md p-4 pt-16">
        <Alert title="Firebase is not configured">
          Set the VITE_FIREBASE_ environment variables listed in .env.example, then build again.
        </Alert>
      </div>
    )}
  </StrictMode>,
);
