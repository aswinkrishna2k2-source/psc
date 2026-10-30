import { Suspense, useEffect, useRef } from 'react';
import { ChartColumn, ChevronDown, House, PencilLine, UserRound } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { getExam } from '../../shared/catalog.ts';
import type { Me } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { useToast } from './Toast.tsx';
import { PageSkeleton } from './ui.tsx';

const NAV = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/practice', label: 'Practice', icon: PencilLine, end: false },
  { to: '/progress', label: 'Progress', icon: ChartColumn, end: false },
  { to: '/profile', label: 'Profile', icon: UserRound, end: false },
];

const ADD_EXAM = '__add';

export function Logo() {
  return (
    <span className="flex items-center gap-2.5 font-semibold text-ink">
      <img src="/favicon.svg" alt="" width={32} height={32} className="size-8" />
      PSC Practice
    </span>
  );
}

function ExamSwitcher() {
  const { me, activeTrack, setMe } = useSession();
  const navigate = useNavigate();
  const toast = useToast();

  return (
    <label className="relative block min-w-0">
      <span className="sr-only">Exam you are preparing for</span>
      <select
        value={activeTrack?.examId ?? ''}
        onChange={(event) => {
          if (event.target.value === ADD_EXAM) {
            navigate('/profile?add=1');
            return;
          }
          api<Me>('/me', { method: 'PATCH', body: { activeExamId: event.target.value } })
            .then(setMe)
            .catch((error) => toast(error.message, 'error'));
        }}
        className="min-h-11 w-full appearance-none truncate rounded-xl border border-control bg-surface py-2 pl-3 pr-9 text-base font-semibold text-ink"
      >
        {me?.tracks.map((track) => (
          <option key={track.examId} value={track.examId}>
            {getExam(track.examId)?.name ?? track.examId}
          </option>
        ))}
        <option value={ADD_EXAM}>Add another exam…</option>
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-2" />
    </label>
  );
}

export function AppShell() {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  // Moves screen readers to the new page and starts each page from the top.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow-raised"
      >
        Skip to main content
      </a>

      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-line bg-surface p-5 lg:flex">
        <Logo />
        <div>
          <p className="mb-1.5 text-xs font-semibold text-ink-3">Preparing for</p>
          <ExamSwitcher />
        </div>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors duration-150 ${
                  isActive ? 'bg-brand-soft font-semibold text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon aria-hidden className={`size-5 ${isActive ? 'text-brand' : ''}`} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <p className="mt-auto text-xs leading-relaxed text-ink-3">
          Independent practice tool. Not affiliated with the Kerala Public Service Commission.
        </p>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-paper/95 px-4 py-2 backdrop-blur lg:hidden">
          <img src="/favicon.svg" alt="PSC Practice" width={32} height={32} className="size-8 shrink-0" />
          <div className="min-w-0 flex-1">
            <ExamSwitcher />
          </div>
        </header>

        <main
          id="main"
          ref={mainRef}
          tabIndex={-1}
          className="mx-auto w-full max-w-5xl px-4 pb-28 pt-5 outline-none sm:px-6 lg:px-8 lg:pb-12 lg:pt-8"
        >
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium ${isActive ? 'font-semibold text-brand' : 'text-ink-2'}`
            }
          >
            <Icon aria-hidden className="size-5" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
