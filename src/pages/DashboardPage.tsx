import { useState } from 'react';
import { BookOpen, CalendarDays, ChevronRight, Clock, FileClock, Flame, History, RotateCcw, Target, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { getLevel } from '../../shared/catalog.ts';
import type { ProgressView, QuizSummary } from '../../shared/types.ts';
import { ActivityColumns, SubjectBars, toColumnPoints } from '../components/Charts.tsx';
import { useToast } from '../components/Toast.tsx';
import { Button, Card, EmptyState, ErrorState, LinkButton, Meter, PageSkeleton } from '../components/ui.tsx';
import { accuracy, clock, configTitle, daysUntil, greeting, KIND_LABELS, mediumName, whenLabel } from '../lib/format.ts';
import { api, useApi } from '../lib/api.ts';
import { useActiveExam, useSession } from '../lib/session.tsx';

function StatTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3 shadow-card sm:p-4">
      <div aria-hidden className="mb-1.5 text-brand">{icon}</div>
      <p className="text-xl font-semibold sm:text-2xl">{value}</p>
      <p className="text-xs text-ink-3 sm:text-sm">{label}</p>
    </div>
  );
}

const QUICK_STARTS = [
  { to: '/practice?kind=subject', label: 'Subject-wise', hint: 'Pick a subject', icon: BookOpen },
  { to: '/practice?kind=pyq', label: 'Previous-year', hint: 'Past-paper pattern', icon: History },
  { to: '/practice?kind=mock', label: 'Model exam', hint: 'Timed, with negative marks', icon: Clock },
  { to: '/practice?kind=mistakes', label: 'My mistakes', hint: 'Revise wrong answers', icon: RotateCcw },
];

export function SessionRow({ quiz }: { quiz: QuizSummary }) {
  const result = quiz.result;
  const to = quiz.status === 'finished' ? `/quiz/${quiz.id}/results` : `/quiz/${quiz.id}`;
  return (
    <li>
      <Link to={to} className="-mx-2 flex min-h-14 items-center gap-3 rounded-lg px-2 py-2.5 transition-colors duration-150 hover:bg-surface-2">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium text-ink">{configTitle(quiz.config)}</p>
          <p className="text-sm text-ink-3">{whenLabel(quiz.startedAt)} · {KIND_LABELS[quiz.config.kind]}</p>
        </div>
        <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">
          {result ? `${result.correct}/${quiz.total}` : 'In progress'}
        </p>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-3" />
      </Link>
    </li>
  );
}

export function DashboardPage() {
  const { me } = useSession();
  const { exam, track } = useActiveExam();
  const navigate = useNavigate();
  const toast = useToast();
  const [ending, setEnding] = useState(false);
  const progress = useApi<ProgressView>(track ? `/progress?examId=${track.examId}&days=30&history=4` : null);
  const active = useApi<QuizSummary | null>('/quizzes/active');

  if (!exam || !track) return null;
  if (progress.error && !progress.data) return <ErrorState message={progress.error.message} onRetry={progress.reload} />;
  if (!progress.data) return <PageSkeleton />;

  const data = progress.data;
  const goal = data.today.goal ?? track.dailyGoal;
  const left = Math.max(0, goal - data.today.attempted);
  const percent = accuracy(data.range.correct, data.range.attempted);
  const countdown = track.examDate ? daysUntil(track.examDate) : null;
  const resume = active.data;
  const isNew = data.allTime.attempted === 0;

  const endSession = async () => {
    if (!resume) return;
    setEnding(true);
    try {
      await api(`/quizzes/${resume.id}/finish`, { method: 'POST', body: {} });
      navigate(`/quiz/${resume.id}/results`);
    } catch (error) {
      toast((error as Error).message, 'error');
      setEnding(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div>
        <h1 className="text-2xl sm:text-3xl">{greeting()}, {me?.user?.name?.split(' ')[0]}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-ink-2">
          <span>{getLevel(exam.level)?.name} · {mediumName(track.medium)}</span>
          {countdown !== null && countdown >= 0 && (
            <span className="inline-flex items-center gap-1 font-medium text-gold">
              <CalendarDays aria-hidden className="size-4" />
              {countdown === 0 ? 'Exam is today' : `${countdown} days to exam`}
            </span>
          )}
        </p>
      </div>

      <section aria-label="Today's goal" className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        <div className="kasavu" />
        <div className="p-5 sm:p-6">
          <p className="text-sm font-medium text-ink-2">Today's goal</p>
          <p className="mt-1 text-5xl font-semibold leading-none">
            {data.today.attempted}
            <span className="ml-2 text-lg font-medium text-ink-3">of {goal} questions</span>
          </p>
          <div className="mt-4">
            <Meter value={data.today.attempted} max={goal} label="Today's goal" />
          </div>
          <p className="mt-3 text-[15px] text-ink-2">
            {left === 0 ? 'Goal reached. Well done, keep the streak going tomorrow.' : `${left} more to reach today's goal.`}
          </p>

          <div className="mt-5">
            {resume ? (
              <div className="space-y-2">
                <LinkButton to={`/quiz/${resume.id}`} className="w-full sm:w-auto">
                  <FileClock aria-hidden className="size-5" />
                  Resume session · {resume.answered} of {resume.total}
                  {resume.remainingSec !== null && ` · ${clock(resume.remainingSec)} left`}
                </LinkButton>
                <Button variant="ghost" className="w-full text-sm sm:ml-2 sm:w-auto" loading={ending} onClick={endSession}>
                  End this session
                </Button>
              </div>
            ) : (
              <LinkButton to="/practice" className="w-full sm:w-auto">
                {isNew ? 'Start your first session' : left === 0 ? 'Practice more' : 'Continue practice'}
              </LinkButton>
            )}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <StatTile icon={<Flame className="size-5" />} label="Day streak" value={String(data.streak.current)} />
        <StatTile icon={<Target className="size-5" />} label="Accuracy, 30 days" value={percent === null ? '–' : `${percent}%`} />
        <StatTile icon={<TrendingUp className="size-5" />} label="Total solved" value={data.allTime.attempted.toLocaleString('en-IN')} />
      </div>

      <section aria-label="Start practising">
        <h2 className="mb-2.5 text-lg">Start practising</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          {QUICK_STARTS.map(({ to, label, hint, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex min-h-24 flex-col justify-between gap-2 rounded-2xl border border-line bg-surface p-3.5 shadow-card transition-[background-color,transform] duration-150 hover:bg-surface-2 active:scale-[0.98]"
            >
              <Icon aria-hidden className="size-5 text-brand" />
              <span>
                <span className="block text-[15px] font-semibold text-ink">{label}</span>
                <span className="block text-xs text-ink-3">{hint}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {isNew ? (
        <Card>
          <EmptyState icon={<TrendingUp className="size-6" />} title="Your progress will show up here">
            Finish your first session to see daily activity and subject scores for {exam.name}.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-lg">Last 7 days</h2>
              <Link to="/progress" className="-my-2 -mr-2 inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-sm font-semibold text-brand">See all</Link>
            </div>
            <ActivityColumns points={toColumnPoints(data.daily.slice(-7), false)} unit="day" heightClass="h-32" showTableToggle={false} />
          </Card>
          <Card>
            <h2 className="mb-1 text-lg">Recent sessions</h2>
            {data.history.length ? (
              <ul className="divide-y divide-line">
                {data.history.map((quiz) => <SessionRow key={quiz.id} quiz={quiz} />)}
              </ul>
            ) : (
              <p className="py-4 text-sm text-ink-3">No sessions yet for {exam.name}.</p>
            )}
          </Card>
          <Card className="lg:col-span-2">
            <h2 className="text-lg">{exam.name} syllabus</h2>
            <p className="mb-1 text-sm text-ink-3">Weakest subjects first, from the last 30 days. Tap one to practise it.</p>
            <SubjectBars subjects={data.subjects} />
          </Card>
        </div>
      )}
    </div>
  );
}
