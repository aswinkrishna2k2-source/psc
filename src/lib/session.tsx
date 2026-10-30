import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { getExam } from '../../shared/catalog.ts';
import type { Me, Track } from '../../shared/types.ts';
import { api, ApiError } from './api.ts';
import { auth, usesEmulators } from './firebase.ts';
import { accountName } from './phone.ts';

type SessionValue = {
  me: Me | null;
  loading: boolean;
  error: ApiError | null;
  retry: () => void;
  refresh: () => Promise<void>;
  setMe: (me: Me) => void;
  activeTrack: Track | null;
  loggedOut: boolean;
  logIn: (phone: string, code: string) => Promise<void>;
  logOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [loggedOut, setLoggedOut] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api<Me>('/me')
      .then(setMe)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  useEffect(
    () =>
      onAuthStateChanged(auth, (user) => {
        if (user) {
          load();
        } else {
          setMe(null);
          setLoading(false);
        }
      }),
    [load],
  );

  const value = useMemo<SessionValue>(() => {
    const tracks = me?.tracks ?? [];
    const activeTrack = tracks.find((t) => t.examId === me?.user?.activeExamId) ?? tracks[0] ?? null;
    return {
      me,
      loading,
      error,
      retry: load,
      setMe,
      activeTrack,
      loggedOut,
      // Unlike retry, this keeps the current page mounted while it updates.
      refresh: async () => setMe(await api<Me>('/me')),
      // Underneath it is Firebase's sign-in by password, as in Ceeq Tutor: the number is the account's
      // name and the code is its password. Students are added in the Firebase console, never by the app.
      logIn: async (phone, code) => {
        const name = accountName(phone);
        try {
          await signInWithEmailAndPassword(auth, name, code);
        } catch (error) {
          // Local development has nobody to add students, so a number's first code becomes its code.
          if (usesEmulators) {
            try {
              await createUserWithEmailAndPassword(auth, name, code);
              return;
            } catch {
              // The account already exists, so the code was simply wrong.
            }
          }
          throw error;
        }
      },
      logOut: async () => {
        setLoggedOut(true);
        await firebaseSignOut(auth);
      },
    };
  }, [me, loading, error, load, loggedOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

export function useActiveExam() {
  const { activeTrack } = useSession();
  return { track: activeTrack, exam: getExam(activeTrack?.examId) ?? null };
}
