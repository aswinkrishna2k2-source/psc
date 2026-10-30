import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Clock, Eraser, Flag, Grid3x3, Lightbulb, TriangleAlert, X } from 'lucide-react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import type { AnswerResult, QuizQuestionView, QuizView } from '../../shared/types.ts';
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
import type { OptionState } from '../components/QuestionParts.tsx';
import { useToast } from '../components/Toast.tsx';
import { Alert, Button, ErrorState, FullPageLoader, Meter, Modal } from '../components/ui.tsx';
import { api, useApi } from '../lib/api.ts';
import { clock, questionLang } from '../lib/format.ts';

function Countdown({ deadline, onExpire }: { deadline: number; onExpire: () => void }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  const expired = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => {
      const next = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setLeft(next);
      if (next === 0 && !expired.current) {
        expired.current = true;
        onExpire();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline, onExpire]);

  const urgent = left <= 60;
  const warning = left <= 300;
  return (
    <>
      <div
        className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[15px] font-semibold tabular-nums ${
          urgent ? 'bg-bad-soft text-bad' : warning ? 'bg-gold-soft text-gold' : 'text-ink'
        }`}
      >
        <Clock aria-hidden className="size-4" />
        <span role="timer" aria-label={`Time left: ${clock(left)}`}>{clock(left)}</span>
      </div>
      <span aria-live="polite" className="sr-only">
        {left === 300 ? '5 minutes left' : left === 60 ? '1 minute left' : ''}
      </span>
    </>
  );
}

// Mirrors a PSC answer sheet: each row shows which bubble is shaded for that question.
function OmrSheet({
  questions,
  current,
  onJump,
  compact,
}: {
  questions: QuizQuestionView[];
  current: number;
  onJump: (index: number) => void;
  compact?: boolean;
}) {
  return (
    <ol className={`grid gap-x-3 ${compact ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {questions.map((q, i) => (
        <li key={q.position}>
          <button
            type="button"
            onClick={() => onJump(i)}
            aria-current={i === current ? 'true' : undefined}
            aria-label={`Question ${i + 1}: ${q.selectedIndex === null ? 'not answered' : `option ${LETTERS[q.selectedIndex]}`}${q.flagged ? ', marked for review' : ''}`}
            className={`flex min-h-11 w-full items-center gap-1.5 rounded-lg px-1.5 ${i === current ? 'bg-brand-soft' : 'hover:bg-surface-2'}`}
          >
            <span className="w-7 text-right text-xs font-medium tabular-nums text-ink-2">{i + 1}</span>
            {LETTERS.map((letter, option) => (
              <span
                key={letter}
                aria-hidden
                className={`flex size-[18px] items-center justify-center rounded-full border text-[10px] font-medium ${
                  q.selectedIndex === option ? 'border-ink bg-ink text-paper' : 'border-control text-ink-3'
                }`}
              >
                {letter}
              </span>
            ))}
            {q.flagged && <Flag aria-hidden className="ml-auto size-3.5 fill-gold-mark text-gold-mark" />}
          </button>
        </li>
      ))}
    </ol>
  );
}

function Player({ quiz, notice }: { quiz: QuizView; notice: string | null }) {
  const navigate = useNavigate();
  const toast = useToast();
  const isTest = quiz.config.mode === 'test';
  const [questions, setQuestions] = useState(quiz.questions);
  const [index, setIndex] = useState(() => {
    const open = quiz.questions.findIndex((q) => q.selectedIndex === null);
    return open === -1 ? 0 : open;
  });
  const [pending, setPending] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dialog, setDialog] = useState<'submit' | 'exit' | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [deadline] = useState(() => (quiz.remainingSec === null ? null : Date.now() + quiz.remainingSec * 1000));
  const shownAt = useRef(Date.now());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const explanationRef = useRef<HTMLDivElement>(null);
  const finishingRef = useRef(false);

  const question = questions[index];
  const lang = questionLang(question);
  const answered = questions.filter((q) => q.selectedIndex !== null).length;
  const flagged = questions.filter((q) => q.flagged).length;
  const correctSoFar = questions.filter((q) => q.isCorrect).length;
  const revealed = question.correctIndex !== undefined;
  const isLast = index === questions.length - 1;

  const patch = (position: number, changes: Partial<QuizQuestionView>) =>
    setQuestions((current) => current.map((q) => (q.position === position ? { ...q, ...changes } : q)));

  const goTo = useCallback((next: number) => {
    setIndex(next);
    setSheetOpen(false);
    shownAt.current = Date.now();
    window.scrollTo(0, 0);
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const finish = useCallback(async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setFinishing(true);
    try {
      await api(`/quizzes/${quiz.id}/finish`, { method: 'POST', body: {} });
      navigate(`/quiz/${quiz.id}/results`, { replace: true });
    } catch (error) {
      toast((error as Error).message, 'error');
      finishingRef.current = false;
      setFinishing(false);
      setDialog(null);
    }
  }, [quiz.id, navigate, toast]);

  const choose = async (option: number) => {
    if (pending !== null || (!isTest && question.selectedIndex !== null)) return;
    const previous = question.selectedIndex;
    const position = question.position;
    const timeMs = Date.now() - shownAt.current;
    // Shades the bubble straight away. The server's reply fills in the rest.
    setPending(option);
    if (isTest) patch(position, { selectedIndex: option });
    try {
      const result = await api<AnswerResult>(`/quizzes/${quiz.id}/answer`, {
        method: 'POST',
        body: { position, selectedIndex: option, timeMs },
      });
      patch(position, {
        selectedIndex: result.selectedIndex,
        correctIndex: result.correctIndex,
        explanation: result.explanation,
        isCorrect: result.isCorrect,
      });
      if (!isTest) {
        requestAnimationFrame(() => explanationRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
      }
    } catch (error) {
      if (isTest) patch(position, { selectedIndex: previous });
      toast(`Your answer was not saved. ${(error as Error).message}`, 'error');
    } finally {
      setPending(null);
    }
  };

  const clearAnswer = async () => {
    const { position, selectedIndex: previous } = question;
    patch(position, { selectedIndex: null });
    try {
      await api(`/quizzes/${quiz.id}/answer`, { method: 'POST', body: { position, selectedIndex: null } });
    } catch (error) {
      patch(position, { selectedIndex: previous });
      toast((error as Error).message, 'error');
    }
  };

  const toggleFlag = async () => {
    const { position, flagged: previous } = question;
    patch(position, { flagged: !previous });
    try {
      await api(`/quizzes/${quiz.id}/answer`, { method: 'POST', body: { position, flagged: !previous } });
    } catch (error) {
      patch(position, { flagged: previous });
      toast((error as Error).message, 'error');
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.ctrlKey || event.metaKey || event.altKey || target.closest('input, select, textarea, dialog')) return;
      const key = event.key.toLowerCase();
      const letter = ['a', 'b', 'c', 'd'].indexOf(key);
      const digit = ['1', '2', '3', '4'].indexOf(key);
      if (letter >= 0 || digit >= 0) {
        event.preventDefault();
        choose(letter >= 0 ? letter : digit);
      } else if (event.key === 'ArrowRight' && !isLast) {
        goTo(index + 1);
      } else if (event.key === 'ArrowLeft' && index > 0) {
        goTo(index - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const optionState = (option: number): OptionState => {
    if (revealed) return revealedState(question, option);
    if (pending === option || question.selectedIndex === option) return 'selected';
    return 'idle';
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/95 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-1.5 px-2 py-1.5 sm:px-4">
          <button
            type="button"
            onClick={() => (isTest ? setDialog('exit') : navigate('/'))}
            aria-label="Leave session"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl text-ink-2 hover:bg-surface-2"
          >
            <X aria-hidden className="size-5" />
          </button>
          <p className="min-w-0 flex-1 text-sm font-semibold tabular-nums text-ink">
            {index + 1}<span className="font-normal text-ink-3"> of {questions.length}</span>
          </p>
          {deadline !== null && <Countdown deadline={deadline} onExpire={finish} />}
          {!isTest && <p className="text-sm font-medium tabular-nums text-ink-2">{correctSoFar} correct</p>}
          {isTest && (
            <>
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                aria-label="Open answer sheet"
                className="flex size-11 shrink-0 items-center justify-center rounded-xl text-ink-2 hover:bg-surface-2 lg:hidden"
              >
                <Grid3x3 aria-hidden className="size-5" />
              </button>
              <Button className="min-h-10 px-3 text-sm" onClick={() => setDialog('submit')}>Submit</Button>
            </>
          )}
        </div>
        <Meter value={isTest ? answered : index + (revealed ? 1 : 0)} max={questions.length} label="Session progress" />
      </header>

      <div className="mx-auto grid w-full max-w-5xl flex-1 gap-6 px-4 pb-6 pt-4 sm:px-6 lg:grid-cols-[1fr_260px]">
        <main key={question.position} className="rise-in min-w-0">
          {notice && index === 0 && (
            <div className="mb-3"><Alert tone="info">{notice}</Alert></div>
          )}
          <QuestionMeta question={question} />
          <h1
            ref={headingRef}
            tabIndex={-1}
            lang={lang}
            className="mt-3 text-lg font-medium leading-relaxed outline-none sm:text-xl"
            style={{ overflowWrap: 'anywhere' }}
          >
            {question.question}
          </h1>

          <div className="mt-4 space-y-2.5">
            {question.options.map((text, option) => (
              <button
                key={option}
                type="button"
                onClick={() => choose(option)}
                disabled={revealed}
                aria-pressed={question.selectedIndex === option}
                className={`${optionRowClass(optionState(option))} min-h-14 ${revealed ? '' : 'hover:bg-surface-2 active:scale-[0.99]'}`}
              >
                <OptionBody
                  index={option}
                  text={text}
                  state={optionState(option)}
                  lang={lang}
                  note={revealed ? revealedNote(question, option) : undefined}
                />
              </button>
            ))}
          </div>

          {revealed && (
            <div ref={explanationRef} className="rise-in mt-4 rounded-xl border border-line bg-surface p-4">
              <p role="status" className={`flex items-center gap-1.5 font-semibold ${question.isCorrect ? 'text-good' : 'text-bad'}`}>
                {question.isCorrect ? 'Correct' : `Not quite. The answer is ${LETTERS[question.correctIndex!]}.`}
              </p>
              <p className="mt-2 flex items-start gap-2 text-[15px] text-ink" lang={question.medium}>
                <Lightbulb aria-hidden className="mt-1 size-4 shrink-0 text-gold" />
                <span>{question.explanation}</span>
              </p>
              <div className="mt-3 border-t border-line pt-2">
                <SourceNote question={question} />
                <ReportButton quizId={quiz.id} question={question} />
              </div>
            </div>
          )}

          {isTest && (
            <div className="mt-3 flex flex-wrap gap-1">
              <Button variant="ghost" className="text-sm font-medium" onClick={toggleFlag} aria-pressed={question.flagged}>
                <Flag aria-hidden className={`size-4 ${question.flagged ? 'fill-gold-mark text-gold-mark' : ''}`} />
                {question.flagged ? 'Marked for review' : 'Mark for review'}
              </Button>
              {question.selectedIndex !== null && (
                <Button variant="ghost" className="text-sm font-medium" onClick={clearAnswer}>
                  <Eraser aria-hidden className="size-4" /> Clear answer
                </Button>
              )}
            </div>
          )}
        </main>

        {isTest && (
          <aside aria-label="Answer sheet" className="hidden lg:block">
            <div className="sticky top-20 rounded-2xl border border-line bg-surface p-3 shadow-card">
              <p className="px-1.5 pb-2 text-sm font-semibold">Answer sheet · {answered}/{questions.length}</p>
              <div className="max-h-[70dvh] overflow-y-auto">
                <OmrSheet questions={questions} current={index} onJump={goTo} />
              </div>
            </div>
          </aside>
        )}
      </div>

      <div className="sticky bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-5xl gap-2 px-4 py-2.5 sm:px-6">
          <Button variant="secondary" disabled={index === 0} onClick={() => goTo(index - 1)} aria-label="Previous question" className="px-4">
            <ArrowLeft aria-hidden className="size-5" />
            <span className="hidden sm:inline">Previous</span>
          </Button>
          {isLast ? (
            <Button
              className="flex-1"
              loading={finishing}
              variant={isTest || revealed ? 'primary' : 'secondary'}
              onClick={() => (isTest ? setDialog('submit') : finish())}
            >
              {isTest ? 'Review and submit' : 'See results'}
            </Button>
          ) : (
            <Button className="flex-1" variant={isTest || revealed ? 'primary' : 'secondary'} onClick={() => goTo(index + 1)}>
              {isTest || revealed ? 'Next' : 'Skip'}
              <ArrowRight aria-hidden className="size-5" />
            </Button>
          )}
        </div>
      </div>

      {isTest && (
        <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} title={`Answer sheet · ${answered}/${questions.length}`} sheetOnMobile>
          <OmrSheet questions={questions} current={index} onJump={goTo} compact />
        </Modal>
      )}

      <Modal open={dialog === 'submit'} onClose={() => setDialog(null)} title="Submit your test?">
        <p className="text-[15px] text-ink-2">
          You have answered {answered} of {questions.length} questions.
        </p>
        {(questions.length - answered > 0 || flagged > 0) && (
          <p className="mt-2 flex items-start gap-2 text-[15px] text-ink-2">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-gold" />
            {[
              questions.length - answered > 0 ? `${questions.length - answered} not answered` : null,
              flagged > 0 ? `${flagged} marked for review` : null,
            ].filter(Boolean).join(', ')}
          </p>
        )}
        <p className="mt-2 text-sm text-ink-3">You cannot change your answers after submitting.</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setDialog(null)}>Keep going</Button>
          <Button loading={finishing} onClick={finish}>Submit test</Button>
        </div>
      </Modal>

      <Modal open={dialog === 'exit'} onClose={() => setDialog(null)} title="Leave this test?">
        <p className="text-[15px] text-ink-2">
          Your answers are saved, but the timer keeps running. You can resume from Home.
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setDialog(null)}>Stay</Button>
          <Button onClick={() => navigate('/')}>Leave</Button>
        </div>
      </Modal>
    </div>
  );
}

export function QuizPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const { data, error, reload } = useApi<QuizView>(`/quizzes/${id}`);
  const notice = (location.state as { notice?: string | null } | null)?.notice ?? null;

  if (error && !data) {
    return (
      <div className="mx-auto max-w-md p-4 pt-16">
        <ErrorState message={error.message} onRetry={reload} />
      </div>
    );
  }
  if (!data) return <FullPageLoader />;
  if (data.status === 'finished') return <Navigate to={`/quiz/${id}/results`} replace />;
  return <Player key={data.id} quiz={data} notice={notice} />;
}
