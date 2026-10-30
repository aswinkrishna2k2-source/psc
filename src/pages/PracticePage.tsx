import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BookOpen, ChevronDown, Clock, FileClock, History, RotateCcw, Sparkles, Timer, Zap } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  examsForLevel,
  getExam,
  getLevel,
  getMedium,
  getSubject,
  LEVELS,
  MEDIUMS,
  MOCK_COUNTS,
  PYQ_YEARS,
  QUESTION_COUNTS,
  SECONDS_PER_QUESTION,
  subjectsForExam,
} from '../../shared/catalog.ts';
import type { DifficultyChoice, LevelId, MediumId, QuizKind, QuizMode } from '../../shared/catalog.ts';
import type { QuizConfig, QuizSummary } from '../../shared/types.ts';
import { CheckChips, RadioTiles } from '../components/Choice.tsx';
import { Alert, Button, Field, inputClass, LinkButton, Meter, PageHeader } from '../components/ui.tsx';
import { streamQuiz, useApi } from '../lib/api.ts';
import { clock, KIND_LABELS, subjectsLabel } from '../lib/format.ts';
import { useSession } from '../lib/session.tsx';

const SAVED_KEY = 'psc.practice';

type Saved = Partial<Pick<QuizConfig, 'kind' | 'mode' | 'difficulty' | 'count'>>;

function readSaved(): Saved {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? '{}') as Saved;
  } catch {
    return {};
  }
}

function writeSaved(saved: Saved) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
  } catch {
    // Only a convenience, so it is fine if this browser blocks storage.
  }
}

function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {hint && <p className="mt-0.5 text-sm text-ink-3">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

const KIND_OPTIONS: { value: QuizKind; label: string; hint: string; icon: ReactNode }[] = [
  { value: 'subject', label: 'Subject-wise', hint: 'New questions from the syllabus', icon: <BookOpen className="size-5" /> },
  { value: 'pyq', label: 'Previous-year pattern', hint: 'In the style of past papers', icon: <History className="size-5" /> },
  { value: 'mock', label: 'Model exam', hint: 'Whole syllabus, timed', icon: <Clock className="size-5" /> },
  { value: 'mistakes', label: 'My mistakes', hint: 'Questions you got wrong', icon: <RotateCcw className="size-5" /> },
];

const DIFFICULTY_OPTIONS: { value: DifficultyChoice; label: string }[] = [
  { value: 'mixed', label: 'Mixed' },
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

type Build = { stage: 'bank' | 'ai'; ready: number; total: number };

function BuildOverlay({ build, onCancel }: { build: Build; onCancel: () => void }) {
  const writing = build.stage === 'ai' || build.ready > 0;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/50 sm:items-center sm:p-4">
      <div role="status" aria-live="polite" className="rise-in w-full rounded-t-2xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-raised sm:max-w-sm sm:rounded-2xl">
        <div className="flex items-center gap-2 text-brand">
          <Sparkles aria-hidden className="size-5 animate-pulse" />
          <h2 className="text-lg text-ink">Preparing your questions</h2>
        </div>
        <p className="mt-1 text-sm text-ink-2">
          {writing ? `${build.ready} of ${build.total} ready. New ones are being written for you.` : 'Checking the question bank…'}
        </p>
        <div className="mt-3">
          <Meter value={build.ready} max={build.total} label="Questions ready" />
        </div>
        <p className="mt-3 text-xs text-ink-3">This can take a minute or two for a large set.</p>
        <Button variant="secondary" className="mt-4 w-full" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export function PracticePage() {
  const { me, activeTrack, refresh } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const active = useApi<QuizSummary | null>('/quizzes/active');

  const again = (location.state as { config?: QuizConfig } | null)?.config;
  const saved = useMemo(readSaved, []);
  const startExam = getExam(again?.examId ?? activeTrack?.examId);
  const paramKind = params.get('kind') as QuizKind | null;
  const paramSubject = params.get('subject');
  const initialKind = again?.kind ?? paramKind ?? (paramSubject ? 'subject' : saved.kind) ?? 'subject';

  const [level, setLevel] = useState<LevelId | null>(startExam?.level ?? null);
  const [examId, setExamId] = useState<string | null>(startExam?.id ?? null);
  const [medium, setMedium] = useState<MediumId>(again?.medium ?? activeTrack?.medium ?? 'en');
  const [kind, setKind] = useState<QuizKind>(initialKind);
  const [subjectIds, setSubjectIds] = useState<string[]>(again?.subjectIds ?? (paramSubject ? [paramSubject] : []));
  const [topic, setTopic] = useState<string | null>(again?.topic ?? null);
  const [year, setYear] = useState<number | null>(again?.year ?? null);
  const [difficulty, setDifficulty] = useState<DifficultyChoice>(again?.difficulty ?? saved.difficulty ?? 'mixed');
  const [count, setCount] = useState<number>(again?.count ?? saved.count ?? 10);
  const [mode, setMode] = useState<QuizMode>(again?.mode ?? saved.mode ?? 'practice');
  const [examOpen, setExamOpen] = useState(!startExam);
  const [build, setBuild] = useState<Build | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const exam = getExam(examId);
  const subjects = exam ? subjectsForExam(exam) : [];
  const counts = kind === 'mock' ? MOCK_COUNTS : QUESTION_COUNTS;
  const effectiveCount = counts.includes(count) ? count : counts[0];
  const effectiveMode: QuizMode = kind === 'mock' ? 'test' : mode;
  const singleSubject = subjectIds.length === 1 ? getSubject(subjectIds[0]) : undefined;
  const showSubjects = kind !== 'mock';
  const showDifficulty = kind === 'subject' || kind === 'pyq';
  const includesCurrentAffairs = kind !== 'mistakes' && (subjectIds.length === 0 || subjectIds.includes('current-affairs'));

  const chooseLevel = (value: LevelId) => {
    setLevel(value);
    if (getExam(examId)?.level !== value) {
      setExamId(null);
      setSubjectIds([]);
      setTopic(null);
    }
  };

  const chooseExam = (value: string) => {
    setExamId(value);
    const syllabus = new Set(getExam(value)?.syllabus.map((s) => s.subjectId));
    setSubjectIds((current) => current.filter((id) => syllabus.has(id)));
    setTopic(null);
  };

  const toggleSubject = (id: string) => {
    setTopic(null);
    setSubjectIds((current) => (current.includes(id) ? current.filter((s) => s !== id) : [...current, id]));
  };

  const start = async () => {
    if (!examId) return;
    const config: QuizConfig = {
      examId,
      medium,
      kind,
      mode: effectiveMode,
      subjectIds: showSubjects ? subjectIds : [],
      topic: kind === 'subject' || kind === 'pyq' ? topic : null,
      year: kind === 'pyq' ? year : null,
      difficulty: showDifficulty ? difficulty : 'mixed',
      count: effectiveCount,
    };
    writeSaved({ kind, mode, difficulty, count: effectiveCount });

    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setBuild({ stage: 'bank', ready: 0, total: effectiveCount });
    const fail = (message: string) => {
      setBuild(null);
      setError(message);
      requestAnimationFrame(() => errorRef.current?.scrollIntoView({ block: 'center' }));
    };

    let settled = false;
    try {
      await streamQuiz(
        config,
        (event) => {
          if (event.type === 'progress') {
            setBuild({ stage: event.stage, ready: event.ready, total: event.total });
          } else if (event.type === 'done') {
            settled = true;
            refresh().catch(() => undefined);
            navigate(`/quiz/${event.quizId}`, { state: { notice: event.notice } });
          } else {
            settled = true;
            fail(event.message);
          }
        },
        controller.signal,
      );
      if (!settled) fail('The connection dropped before your session was ready. Questions already written are saved, so trying again will be quicker.');
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setBuild(null);
        return;
      }
      fail((err as Error).message);
    }
  };

  const minutes = Math.round((effectiveCount * SECONDS_PER_QUESTION) / 60);
  const summary = [
    exam?.name ?? 'No exam chosen',
    getMedium(medium)?.name,
    KIND_LABELS[kind],
    showSubjects ? subjectsLabel(subjectIds) : null,
    kind === 'pyq' ? (year ?? 'All years') : null,
    `${effectiveCount} questions`,
    effectiveMode === 'test' ? `${minutes} min test` : 'Instant answers',
  ].filter(Boolean);

  const startLabel = exam ? 'Start' : 'Choose an exam';

  return (
    <div>
      <PageHeader title="Practice" subtitle="Choose what you want, and we will show questions to match." />

      <div className="grid gap-4 lg:grid-cols-[1fr_300px] lg:items-start">
        <div className="space-y-3 sm:space-y-4">
          {active.data && (
            <Alert
              tone="info"
              title="You have an unfinished session"
              action={<LinkButton to={`/quiz/${active.data.id}`} variant="secondary"><FileClock aria-hidden className="size-4" /> Resume</LinkButton>}
            >
              {active.data.answered} of {active.data.total} answered
              {active.data.remainingSec !== null && `, ${clock(active.data.remainingSec)} left`}. Starting a new session will score it as it stands.
            </Alert>
          )}

          {me && !me.ai.configured && (
            <Alert tone="info" title="Only sample questions are available">
              New questions cannot be written until the Gemini key is set up.
            </Alert>
          )}

          {error && (
            <div ref={errorRef}>
              <Alert title="Your session could not be started" action={<Button variant="secondary" onClick={start}>Try again</Button>}>
                {error}
              </Alert>
            </div>
          )}

          <section className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
            <button
              type="button"
              onClick={() => setExamOpen((v) => !v)}
              aria-expanded={examOpen}
              className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
            >
              <span className="min-w-0">
                <span className="block text-xs font-medium text-ink-3">Exam, level and medium</span>
                <span className="block font-semibold text-ink">{exam?.name ?? 'Choose your exam'}</span>
                <span className="block text-sm text-ink-2">
                  {[getLevel(level)?.name, getMedium(medium)?.native].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-brand">
                {examOpen ? 'Hide' : 'Change'}
                <ChevronDown aria-hidden className={`size-4 transition-transform duration-150 ${examOpen ? 'rotate-180' : ''}`} />
              </span>
            </button>

            {examOpen && (
              <div className="rise-in mt-4 space-y-4 border-t border-line pt-4">
                <div>
                  <h2 className="mb-2 text-sm font-semibold">Level</h2>
                  <RadioTiles legend="Level" value={level} onChange={chooseLevel} options={LEVELS.map((l) => ({ value: l.id, label: l.name }))} />
                </div>
                {level && (
                  <div>
                    <h2 className="mb-2 text-sm font-semibold">Preparing for</h2>
                    <RadioTiles
                      legend="Exam"
                      layout="stack"
                      value={examId}
                      onChange={chooseExam}
                      options={examsForLevel(level).map((e) => ({ value: e.id, label: e.name, hint: e.about }))}
                    />
                  </div>
                )}
                <div>
                  <h2 className="mb-2 text-sm font-semibold">Medium</h2>
                  <RadioTiles legend="Medium" value={medium} onChange={setMedium} options={MEDIUMS.map((m) => ({ value: m.id, label: m.native, lang: m.id }))} />
                </div>
              </div>
            )}
          </section>

          <Section title="Question set">
            <RadioTiles legend="Question set" layout="cards" value={kind} onChange={setKind} options={KIND_OPTIONS} />
            {kind === 'pyq' && (
              <p className="mt-3 rounded-lg bg-gold-soft p-3 text-sm text-ink-2">
                Gemini writes these in the style of past papers, using facts those papers often test. They are not copies of official question papers.
              </p>
            )}
          </Section>

          {kind === 'pyq' && (
            <Section title="Year pattern">
              <RadioTiles<number | string>
                legend="Year pattern"
                value={year ?? 'all'}
                onChange={(value) => setYear(value === 'all' ? null : Number(value))}
                options={[{ value: 'all', label: 'All years' }, ...PYQ_YEARS.map((y) => ({ value: y, label: String(y) }))]}
              />
            </Section>
          )}

          {showSubjects && exam && (
            <Section title="Subject" hint="Choose one or more.">
              <CheckChips
                legend="Subject"
                values={subjectIds}
                onToggle={toggleSubject}
                onAll={() => {
                  setSubjectIds([]);
                  setTopic(null);
                }}
                allLabel="All subjects"
                options={subjects.map((s) => ({ value: s.id, label: s.name }))}
              />
              {singleSubject && kind !== 'mistakes' && (
                <div className="mt-4">
                  <Field label="Topic (optional)">
                    {(props) => (
                      <select {...props} value={topic ?? ''} onChange={(e) => setTopic(e.target.value || null)} className={inputClass}>
                        <option value="">All topics in {singleSubject.name}</option>
                        {singleSubject.topics.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    )}
                  </Field>
                </div>
              )}
              {includesCurrentAffairs && (
                <p className="mt-3 text-sm text-ink-3">
                  Current Affairs comes from what Gemini already knows, so it may miss the latest months.
                </p>
              )}
            </Section>
          )}

          {showDifficulty && (
            <Section title="Difficulty">
              <RadioTiles legend="Difficulty" value={difficulty} onChange={setDifficulty} options={DIFFICULTY_OPTIONS} />
            </Section>
          )}

          <Section title="Number of questions">
            <RadioTiles legend="Number of questions" value={effectiveCount} onChange={setCount} options={counts.map((c) => ({ value: c, label: String(c) }))} />
          </Section>

          {kind !== 'mock' ? (
            <Section title="Mode">
              <RadioTiles
                legend="Mode"
                layout="cards"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'practice', label: 'Practice', hint: 'See the answer after each question', icon: <Zap className="size-5" /> },
                  { value: 'test', label: 'Test', hint: `${minutes} min timer, −⅓ for each wrong answer`, icon: <Timer className="size-5" /> },
                ]}
              />
            </Section>
          ) : (
            <p className="px-1 text-sm text-ink-3">
              Model exams are timed at {minutes} minutes, with ⅓ of a mark taken off for each wrong answer. Split by subject is approximate, so check your exam's notification.
            </p>
          )}
        </div>

        <aside className="sticky top-8 hidden rounded-2xl border border-line bg-surface p-5 shadow-card lg:block">
          <h2 className="text-base font-semibold">Your session</h2>
          <ul className="mt-2 space-y-1 text-sm text-ink-2">
            {summary.map((item) => <li key={String(item)}>{item}</li>)}
          </ul>
          <Button className="mt-4 w-full" disabled={!exam} onClick={start}>{startLabel}</Button>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 flex items-center gap-3 border-t border-line bg-surface/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <p className="line-clamp-2 min-w-0 flex-1 text-xs text-ink-2">{summary.slice(0, 5).join(' · ')}</p>
        <Button className="shrink-0 px-6" disabled={!exam} onClick={start}>{startLabel}</Button>
      </div>
      <div aria-hidden className="h-16 lg:hidden" />

      {build && <BuildOverlay build={build} onCancel={() => abortRef.current?.abort()} />}
    </div>
  );
}
