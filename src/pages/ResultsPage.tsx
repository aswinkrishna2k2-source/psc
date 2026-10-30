import { useMemo, useState } from 'react';
import { Lightbulb, RotateCcw } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { getSubject } from '../../shared/catalog.ts';
import type { QuizQuestionView, QuizView } from '../../shared/types.ts';
import {
  LETTERS,
  OptionBody,
  optionRowClass,
  QuestionMeta,
  ReportButton,
  revealedNote,
  revealedState,
  SourceNote,
} from '../components/QuestionParts.tsx';
import { RadioTiles } from '../components/Choice.tsx';
import { Button, Card, EmptyState, ErrorState, LinkButton, PageSkeleton } from '../components/ui.tsx';
import { useApi } from '../lib/api.ts';
import { accuracy, configTitle, questionLang } from '../lib/format.ts';

type Filter = 'all' | 'wrong' | 'skipped';

function ScoreBar({ correct, wrong, skipped }: { correct: number; wrong: number; skipped: number }) {
  const total = correct + wrong + skipped;
  const parts = [
    { name: 'Correct', value: correct, fill: 'bg-series-1' },
    { name: 'Wrong', value: wrong, fill: 'bg-series-2' },
    { name: 'Skipped', value: skipped, fill: 'bg-surface-2' },
  ];
  return (
    <div>
      <div
        role="img"
        aria-label={`${correct} correct, ${wrong} wrong, ${skipped} skipped, out of ${total}`}
        className="flex h-3 gap-0.5 overflow-hidden rounded-full"
      >
        {parts.filter((p) => p.value > 0).map((p) => (
          <div key={p.name} className={p.fill} style={{ width: `${(p.value / total) * 100}%` }} />
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2">
        {parts.map((p) => (
          <div key={p.name}>
            <dt className="flex items-center gap-1.5 text-sm text-ink-2">
              <span aria-hidden className={`size-2.5 rounded-sm ${p.fill} ${p.name === 'Skipped' ? 'border border-control' : ''}`} />
              {p.name}
            </dt>
            <dd className="text-xl font-semibold">{p.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ReviewCard({ quizId, question, number }: { quizId: string; question: QuizQuestionView; number: number }) {
  const lang = questionLang(question);
  return (
    <li className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <QuestionMeta question={question} />
      <p lang={lang} className="mt-3 font-medium leading-relaxed" style={{ overflowWrap: 'anywhere' }}>
        <span className="text-ink-3">{number}. </span>{question.question}
      </p>
      <div className="mt-3 space-y-2">
        {question.options.map((text, option) => (
          <div key={option} className={optionRowClass(revealedState(question, option))}>
            <OptionBody index={option} text={text} state={revealedState(question, option)} lang={lang} note={revealedNote(question, option)} />
          </div>
        ))}
      </div>
      {question.selectedIndex === null && (
        <p className="mt-2 text-sm font-medium text-ink-2">Not answered. The answer is {LETTERS[question.correctIndex!]}.</p>
      )}
      <p className="mt-3 flex items-start gap-2 text-[15px] text-ink" lang={question.medium}>
        <Lightbulb aria-hidden className="mt-1 size-4 shrink-0 text-gold" />
        <span>{question.explanation}</span>
      </p>
      <div className="mt-2 border-t border-line pt-2">
        <SourceNote question={question} />
        <ReportButton quizId={quizId} question={question} />
      </div>
    </li>
  );
}

export function ResultsPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: quiz, error, reload } = useApi<QuizView>(`/quizzes/${id}`);
  const [filter, setFilter] = useState<Filter>('all');

  const bySubject = useMemo(() => {
    const totals = new Map<string, { attempted: number; correct: number; total: number }>();
    for (const q of quiz?.questions ?? []) {
      const entry = totals.get(q.subjectId) ?? { attempted: 0, correct: 0, total: 0 };
      entry.total += 1;
      if (q.selectedIndex !== null) entry.attempted += 1;
      if (q.isCorrect) entry.correct += 1;
      totals.set(q.subjectId, entry);
    }
    return [...totals].map(([subjectId, stat]) => ({ subjectId, ...stat }));
  }, [quiz]);

  if (error && !quiz) return <ErrorState message={error.message} onRetry={reload} />;
  if (!quiz) return <PageSkeleton />;

  if (quiz.status !== 'finished' || !quiz.result) {
    return (
      <EmptyState
        icon={<RotateCcw className="size-6" />}
        title="This session is still running"
        action={<LinkButton to={`/quiz/${id}`}>Resume session</LinkButton>}
      >
        Finish it to see your results.
      </EmptyState>
    );
  }

  const { correct, wrong, skipped, score } = quiz.result;
  const isTest = quiz.config.mode === 'test';
  const percent = accuracy(correct, correct + wrong);
  const shown = quiz.questions.filter((q) => {
    if (filter === 'wrong') return q.selectedIndex !== null && !q.isCorrect;
    if (filter === 'skipped') return q.selectedIndex === null;
    return true;
  });

  return (
    <div className="space-y-4 sm:space-y-5">
      <section aria-label="Your score" className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        <div className="kasavu" />
        <div className="p-5 sm:p-6">
          <p className="text-sm font-medium text-ink-2">{configTitle(quiz.config)}</p>
          <p className="mt-1 text-5xl font-semibold leading-none">
            {isTest ? score : correct}
            <span className="ml-2 text-lg font-medium text-ink-3">out of {quiz.questions.length}</span>
          </p>
          <p className="mt-2 text-[15px] text-ink-2">
            {percent === null ? 'No questions answered.' : `${percent}% of your answers were correct.`}
            {isTest && wrong > 0 && ` Includes −${(wrong / 3).toFixed(2)} for ${wrong} wrong.`}
          </p>
          <div className="mt-4">
            <ScoreBar correct={correct} wrong={wrong} skipped={skipped} />
          </div>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Button className="w-full sm:w-auto" onClick={() => navigate('/practice', { state: { config: quiz.config } })}>
              Practice again
            </Button>
            <LinkButton to="/" variant="secondary" className="w-full sm:w-auto">Back to Home</LinkButton>
          </div>
        </div>
      </section>

      {bySubject.length > 1 && (
        <Card>
          <h2 className="mb-1 text-lg">By subject</h2>
          <ul className="divide-y divide-line">
            {bySubject.map((s) => (
              <li key={s.subjectId} className="flex items-baseline justify-between gap-3 py-2.5 text-[15px]">
                <span className="min-w-0">{getSubject(s.subjectId)?.name ?? s.subjectId}</span>
                <span className="shrink-0 text-sm tabular-nums text-ink-2">{s.correct} of {s.total} correct</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <section aria-label="Review answers">
        <h2 className="mb-2.5 text-lg">Review answers</h2>
        <RadioTiles<Filter>
          legend="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All ${quiz.questions.length}` },
            { value: 'wrong', label: `Wrong ${wrong}` },
            { value: 'skipped', label: `Skipped ${skipped}` },
          ]}
        />
        {shown.length ? (
          <ol className="mt-3 space-y-3">
            {shown.map((q) => <ReviewCard key={q.position} quizId={quiz.id} question={q} number={q.position + 1} />)}
          </ol>
        ) : (
          <p className="mt-4 text-sm text-ink-3">Nothing to show here.</p>
        )}
      </section>
    </div>
  );
}
