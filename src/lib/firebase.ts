import { initializeApp } from 'firebase/app';
import { browserLocalPersistence, connectAuthEmulator, indexedDBLocalPersistence, initializeAuth } from 'firebase/auth';

const env = import.meta.env;

// `npm run dev` talks to the local emulators and needs no Firebase account.
export const usesEmulators = env.DEV && env.VITE_USE_EMULATORS !== '0';

const projectId = usesEmulators ? 'demo-psc' : env.VITE_FIREBASE_PROJECT_ID;

export const firebaseConfigured = usesEmulators || Boolean(env.VITE_FIREBASE_API_KEY && projectId);

const app = initializeApp({
  apiKey: usesEmulators ? 'demo-key' : env.VITE_FIREBASE_API_KEY || 'missing',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: projectId || 'missing',
  appId: env.VITE_FIREBASE_APP_ID,
});

// initializeAuth without the popup resolver leaves sign-in-with-popup code out of the bundle.
export const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });

if (usesEmulators) connectAuthEmulator(auth, 'http://127.0.0.1:9199', { disableWarnings: true });

const REGION = 'asia-south1';

// Called directly rather than through a Hosting rewrite, which cuts requests off at 60 seconds.
export const API_BASE = usesEmulators
  ? `http://127.0.0.1:5101/${projectId}/${REGION}/pscApi`
  : `https://${REGION}-${projectId}.cloudfunctions.net/pscApi`;
