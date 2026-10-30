import { useState } from 'react';
import { ChartColumn, ChevronDown } from 'lucide-react';
import { getExam } from '../../shared/catalog.ts';
import type { ProgressView } from '../../shared/types.ts';
import { ActivityColumns, ActivityHeatmap, SubjectBars, toColumnPoints } from '../components/Charts.tsx';
import { RadioTiles } from '../components/Choice.tsx';
import { Card, EmptyState, ErrorState, inputClass, LinkButton, PageHeader, PageSkeleton } from '../components/ui.tsx';
import { useApi } from '../lib/api.ts';
import { accuracy, studyTime } from '../lib/format.ts';
import { useSession } from '../lib/session.tsx';
import { SessionRow } from './DashboardPage.tsx';

const ALL_EXAMS = 'all';

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3.5 shadow-card">
      <p className="text-xs text-ink-3 sm:text-sm">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold">{value}</p>
      {note && <p className="text-xs text-ink-3">{note}</p>}
    </div>
  );
}

export function ProgressPage() {
  const { me, activeTrack } = useSession();
  const [examId, setExamId] = useState(activeTrack?.examId ?? ALL_EXAMS);
  const [days, setDays] = useState(30);
  const query = `/progress?days=${days}${examId === ALL_EXAMS ? '' : `&examId=${examId}`}`;
  const { data, error, loading, reload } = useApi<ProgressView>(query);

  const filters = (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <label className="relative block sm:w-72">
        <span className="sr-only">Exam</span>
        <select value={examId} onChange={(e) => setExamId(e.target.value)} className={`${inputClass} appearance-none pr-9 font-medium`}>
          <option value={ALL_EXAMS}>All exams</option>
          {me?.tracks.map((t) => (
            <option key={t.examId} value={t.examId}>{getExam(t.examId)?.name ?? t.examId}</option>
          ))}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-2" />
      </label>
      <RadioTiles
        legend="Time range"
        value={days}
        onChange={setDays}
        options={[7, 30, 90].map((d) => ({ value: d, label: `${d} days` }))}
      />
    </div>
  );

  if (error && !data) return <ErrorState message={error.message} onRetry={reload} />;

  const percent = data ? accuracy(data.range.correct, data.range.attempted) : null;
  const byWeek = days === 90;

  return (
    <div>
      <PageHeader title="Progress" />
      {filters}
      {!data ? (
        <PageSkeleton />
      ) : data.allTime.attempted === 0 ? (
        <Card>
          <EmptyState
            icon={<ChartColumn className="size-6" />}
            title="No practice recorded yet"
            action={<LinkButton to="/practice">Start practising</LinkButton>}
          >
            Answer a few questions and your daily activity will appear here.
          </EmptyState>
        </Card>
      ) : (
        <div className={`space-y-4 transition-opacity duration-150 sm:space-y-5 ${loading ? 'opacity-60' : ''}`}>
          <section aria-label="Summary" className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-4">
            <Tile label="Solved today" value={String(data.today.attempted)} note={data.today.goal ? `Goal: ${data.today.goal}` : undefined} />
            <Tile label="Day streak" value={String(data.streak.current)} note={`Best: ${data.streak.best}`} />
            <Tile label="Accuracy" value={percent === null ? '–' : `${percent}%`} note={`Last ${days} days`} />
            <Tile label="Time practised" value={studyTime(data.range.seconds)} note={`${data.range.activeDays} active ${data.range.activeDays === 1 ? 'day' : 'days'}`} />
          </section>

          <Card>
            <h2 className="text-lg">Questions answered</h2>
            <p className="mb-3 text-sm text-ink-3">{byWeek ? 'Per week' : 'Per day'}, last {days} days</p>
            <ActivityColumns key={query} points={toColumnPoints(data.daily, byWeek)} unit={byWeek ? 'week' : 'day'} />
          </Card>

          <Card>
            <h2 className="mb-3 text-lg">Your practice calendar</h2>
            <ActivityHeatmap days={data.heatmap} />
          </Card>

          <Card>
            <h2 className="text-lg">Subjects</h2>
            <p className="mb-1 text-sm text-ink-3">Weakest first, from the last {days} days.</p>
            {data.subjects.length ? (
              <SubjectBars subjects={data.subjects} linkToPractice={examId !== ALL_EXAMS} />
            ) : (
              <p className="py-3 text-sm text-ink-3">Nothing answered in this period.</p>
            )}
          </Card>

          <Card>
            <h2 className="mb-1 text-lg">Session history</h2>
            {data.history.length ? (
              <ul className="divide-y divide-line">
                {data.history.map((quiz) => <SessionRow key={quiz.id} quiz={quiz} />)}
              </ul>
            ) : (
              <p className="py-3 text-sm text-ink-3">No sessions yet.</p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
