import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router';
import { examsForLevel, LEVELS, MEDIUMS } from '../../shared/catalog.ts';
import type { LevelId, MediumId } from '../../shared/catalog.ts';
import type { Me } from '../../shared/types.ts';
import { RadioTiles } from '../components/Choice.tsx';
import { Alert, Button, Field, Meter, TextInput } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';

const GOALS = [10, 20, 30, 50];
const TOTAL_STEPS = 5;
// The name the server gives an account until the student chooses one.
const DEFAULT_NAME = 'Student';

export function OnboardingPage() {
  const { me, setMe } = useSession();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [name, setName] = useState(me?.user?.name === DEFAULT_NAME ? '' : (me?.user?.name ?? ''));
  const [adult, setAdult] = useState(false);
  const [level, setLevel] = useState<LevelId | null>(null);
  const [examId, setExamId] = useState<string | null>(null);
  const [medium, setMedium] = useState<MediumId | null>(null);
  const [dailyGoal, setDailyGoal] = useState(20);
  const [examDate, setExamDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = async () => {
    setSaving(true);
    setError(null);
    try {
      await api<Me>('/me', { method: 'PATCH', body: { name: name.trim(), adultConfirmed: true } });
      setMe(await api<Me>('/tracks', { method: 'POST', body: { examId, medium, dailyGoal, examDate: examDate || null } }));
      navigate('/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  const canContinue = step === 1 ? name.trim().length >= 2 && adult : step === 2 ? Boolean(level) : step === 3 ? Boolean(examId) : step === 4 ? Boolean(medium) : true;
  const headings = [
    { title: 'Welcome to PSC Practice', hint: 'Tell us a little about you to get started.' },
    { title: 'Which level are you preparing for?', hint: 'This sets how hard the questions are.' },
    { title: 'Which exam are you preparing for?', hint: 'You can add more exams later. Each keeps its own progress.' },
    { title: 'Which medium do you want?', hint: 'Questions and explanations will be written in this language.' },
    { title: 'Set a daily goal', hint: 'A small number you can keep up every day works best.' },
  ];

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="flex items-center gap-2">
        {step > 1 ? (
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            aria-label="Back"
            className="-ml-2 flex size-11 items-center justify-center rounded-xl text-ink-2 hover:bg-surface-2"
          >
            <ArrowLeft aria-hidden className="size-5" />
          </button>
        ) : (
          <img src="/favicon.svg" alt="" width={32} height={32} className="size-8" />
        )}
        <p className="text-sm font-medium text-ink-2">Step {step} of {TOTAL_STEPS}</p>
      </div>
      <div className="mt-2">
        <Meter value={step} max={TOTAL_STEPS} label={`Step ${step} of ${TOTAL_STEPS}`} />
      </div>

      <main key={step} className="rise-in flex-1 pb-6 pt-6">
        <h1 className="text-2xl">{headings[step - 1].title}</h1>
        <p className="mb-5 mt-1 text-ink-2">{headings[step - 1].hint}</p>

        {step === 1 && (
          <div className="space-y-4">
            <Field label="Your name" required>
              {(props) => <TextInput {...props} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />}
            </Field>
            <label className="flex min-h-11 items-start gap-3 py-1 text-[15px] text-ink">
              <input
                type="checkbox"
                checked={adult}
                onChange={(e) => setAdult(e.target.checked)}
                className="mt-1 size-5 shrink-0 accent-[var(--brand)]"
              />
              I am 18 years of age or older.
            </label>
          </div>
        )}

        {step === 2 && (
          <RadioTiles
            legend="Level"
            layout="stack"
            value={level}
            onChange={(value) => {
              setLevel(value);
              setExamId(null);
            }}
            options={LEVELS.map((l) => ({ value: l.id, label: l.name, hint: l.hint }))}
          />
        )}

        {step === 3 && level && (
          <RadioTiles
            legend="Exam"
            layout="stack"
            value={examId}
            onChange={setExamId}
            options={examsForLevel(level).map((exam) => ({ value: exam.id, label: exam.name, hint: exam.about }))}
          />
        )}

        {step === 4 && (
          <RadioTiles
            legend="Medium"
            layout="stack"
            value={medium}
            onChange={setMedium}
            options={MEDIUMS.map((m) => ({
              value: m.id,
              label: m.native,
              lang: m.id,
              hint: m.id === 'en' ? undefined : m.name,
            }))}
          />
        )}

        {step === 5 && (
          <div className="space-y-6">
            <RadioTiles
              legend="Questions a day"
              layout="cards"
              value={dailyGoal}
              onChange={setDailyGoal}
              options={GOALS.map((goal) => ({ value: goal, label: `${goal} questions a day` }))}
            />
            <Field label="Exam date (optional)" helper="We will count down the days for you.">
              {(props) => <TextInput {...props} type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />}
            </Field>
            {error && <Alert>{error}</Alert>}
          </div>
        )}
      </main>

      <div className="sticky bottom-0 -mx-4 border-t border-line bg-paper px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {step < TOTAL_STEPS ? (
          <Button className="w-full" disabled={!canContinue} onClick={() => setStep(step + 1)}>
            Continue
          </Button>
        ) : (
          <Button className="w-full" loading={saving} onClick={finish}>
            Start preparing
          </Button>
        )}
      </div>
    </div>
  );
}
