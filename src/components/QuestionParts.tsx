import { useState } from 'react';
import { Check, Flag, X } from 'lucide-react';
import { getSubject } from '../../shared/catalog.ts';
import type { QuizQuestionView } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useToast } from './Toast.tsx';
import { Button, Modal } from './ui.tsx';

export const LETTERS = ['A', 'B', 'C', 'D'];

export type OptionState = 'idle' | 'selected' | 'correct' | 'wrong' | 'dimmed';

const ROW: Record<OptionState, string> = {
  idle: 'border-control bg-surface',
  selected: 'border-ink bg-surface-2 ring-1 ring-ink',
  correct: 'border-good bg-good-soft ring-1 ring-good',
  wrong: 'border-bad bg-bad-soft ring-1 ring-bad',
  dimmed: 'border-line bg-surface',
};

const BUBBLE: Record<OptionState, string> = {
  idle: 'border-2 border-control text-ink-2',
  selected: 'border-2 border-ink bg-ink text-paper',
  correct: 'border-2 border-good bg-good text-surface',
  wrong: 'border-2 border-bad bg-bad text-surface',
  dimmed: 'border-2 border-line text-ink-3',
};

// Answer rows copy the bubbles on a PSC OMR sheet: choosing one shades it in.
export function OptionBody({
  index,
  text,
  state,
  lang,
  note,
}: {
  index: number;
  text: string;
  state: OptionState;
  lang: string;
  note?: string;
}) {
  return (
    <>
      <span aria-hidden className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors duration-150 ${BUBBLE[state]}`}>
        {state === 'correct' ? <Check className="size-5" /> : state === 'wrong' ? <X className="size-5" /> : LETTERS[index]}
      </span>
      <span className="sr-only">Option {LETTERS[index]}: </span>
      <span lang={lang} className={`min-w-0 flex-1 self-center text-base ${state === 'dimmed' ? 'text-ink-2' : 'text-ink'}`} style={{ overflowWrap: 'anywhere' }}>
        {text}
      </span>
      {note && <span className={`shrink-0 self-center text-xs font-semibold ${state === 'wrong' ? 'text-bad' : 'text-good'}`}>{note}</span>}
    </>
  );
}

export function optionRowClass(state: OptionState) {
  return `flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors duration-150 ${ROW[state]}`;
}

export function revealedState(q: QuizQuestionView, index: number): OptionState {
  if (index === q.correctIndex) return 'correct';
  if (index === q.selectedIndex) return 'wrong';
  return 'dimmed';
}

export function revealedNote(q: QuizQuestionView, index: number) {
  if (index === q.correctIndex) return index === q.selectedIndex ? 'Your answer' : 'Correct answer';
  if (index === q.selectedIndex) return 'Your answer';
  return undefined;
}

export function QuestionMeta({ question }: { question: QuizQuestionView }) {
  const subject = getSubject(question.subjectId)?.name ?? question.subjectId;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs font-medium text-ink-2">
      <span className="rounded-md bg-surface-2 px-2 py-1">{subject}</span>
      <span className="rounded-md bg-surface-2 px-2 py-1 capitalize">{question.difficulty}</span>
      {question.source === 'pyq' && (
        <span className="rounded-md bg-gold-soft px-2 py-1 font-semibold text-gold">
          {question.year ? `${question.year} pattern` : 'Past-paper pattern'}
        </span>
      )}
      {question.source === 'sample' && <span className="rounded-md bg-surface-2 px-2 py-1">Sample</span>}
    </div>
  );
}

const SOURCE_NOTES: Record<QuizQuestionView['source'], string> = {
  pyq: 'Written by Gemini in the style of past papers. This is not from an official question paper.',
  ai: 'Written by Gemini. AI can make mistakes, so report anything that looks wrong.',
  sample: 'A built-in sample question.',
};

export function SourceNote({ question }: { question: QuizQuestionView }) {
  return <p className="text-xs text-ink-3">{SOURCE_NOTES[question.source]}</p>;
}

const REASONS = [
  { value: 'wrong_answer', label: 'The marked answer is wrong' },
  { value: 'wrong_question', label: 'The question or options have a mistake' },
  { value: 'bad_translation', label: 'The language or translation is poor' },
  { value: 'other', label: 'Something else' },
];

export function ReportButton({ quizId, question }: { quizId: string; question: QuizQuestionView }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0].value);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(question.reported);
  const toast = useToast();

  if (done) {
    return (
      <span className="inline-flex min-h-11 items-center gap-1.5 text-sm text-ink-3">
        <Flag aria-hidden className="size-4" /> Reported
      </span>
    );
  }

  const submit = async () => {
    setSending(true);
    try {
      await api(`/quizzes/${quizId}/report`, { method: 'POST', body: { position: question.position, reason } });
      setDone(true);
      setOpen(false);
      toast("Thanks. You won't see this question again.");
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Button variant="ghost" className="-ml-2 text-sm font-medium" onClick={() => setOpen(true)}>
        <Flag aria-hidden className="size-4" /> Report a problem
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="What is wrong with this question?">
        <div className="space-y-1">
          {REASONS.map((option) => (
            <label key={option.value} className="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-surface-2">
              <input
                type="radio"
                name="report-reason"
                checked={reason === option.value}
                onChange={() => setReason(option.value)}
                className="size-4 accent-[var(--brand)]"
              />
              <span className="text-[15px]">{option.label}</span>
            </label>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button loading={sending} onClick={submit}>Send report</Button>
        </div>
      </Modal>
    </>
  );
}
