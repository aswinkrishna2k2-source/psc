import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { AppShell } from './components/AppShell.tsx';
import { ErrorState, FullPageLoader } from './components/ui.tsx';
import { useSession } from './lib/session.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';

// Loaded on demand so a phone only downloads the pages it opens.
const OnboardingPage = lazy(() => import('./pages/OnboardingPage.tsx').then((m) => ({ default: m.OnboardingPage })));
const PracticePage = lazy(() => import('./pages/PracticePage.tsx').then((m) => ({ default: m.PracticePage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage.tsx').then((m) => ({ default: m.ProfilePage })));
const ProgressPage = lazy(() => import('./pages/ProgressPage.tsx').then((m) => ({ default: m.ProgressPage })));
const QuizPage = lazy(() => import('./pages/QuizPage.tsx').then((m) => ({ default: m.QuizPage })));
const ResultsPage = lazy(() => import('./pages/ResultsPage.tsx').then((m) => ({ default: m.ResultsPage })));

function RequireAuth() {
  const { me, loading, error, retry, loggedOut } = useSession();
  const location = useLocation();
  if (loading) return <FullPageLoader />;
  if (error) {
    return (
      <div className="mx-auto max-w-md p-4 pt-16">
        <ErrorState message={error.message} onRetry={retry} />
      </div>
    );
  }
  if (!me?.user) return <Navigate to="/login" replace state={loggedOut ? null : { from: location.pathname + location.search }} />;
  return <Outlet />;
}

function RequireTrack() {
  const { me } = useSession();
  if (!me?.tracks.length) return <Navigate to="/welcome" replace />;
  return <Outlet />;
}

function PublicOnly() {
  const { me, loading } = useSession();
  const location = useLocation();
  if (loading) return <FullPageLoader />;
  if (me?.user) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? '/'} replace />;
  }
  return <Outlet />;
}

export function App() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <Routes>
        <Route element={<PublicOnly />}>
          <Route path="/login" element={<LoginPage />} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route path="/welcome" element={<OnboardingPage />} />
          <Route path="/quiz/:id" element={<QuizPage />} />
          <Route element={<RequireTrack />}>
            <Route element={<AppShell />}>
              <Route index element={<DashboardPage />} />
              <Route path="/practice" element={<PracticePage />} />
              <Route path="/progress" element={<ProgressPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/quiz/:id/results" element={<ResultsPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
