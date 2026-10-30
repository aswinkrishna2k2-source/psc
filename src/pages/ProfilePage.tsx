import { useEffect, useState } from 'react';
import { LogOut, Pencil, Plus } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { examsForLevel, getExam, getLevel, LEVELS, MEDIUMS } from '../../shared/catalog.ts';
import type { LevelId, MediumId } from '../../shared/catalog.ts';
import type { Me, Track } from '../../shared/types.ts';
import { RadioTiles } from '../components/Choice.tsx';
import { useToast } from '../components/Toast.tsx';
import { Alert, Button, Card, Field, inputClass, Modal, PageHeader, TextInput } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { mediumName } from '../lib/format.ts';
import { formatPhone, phoneOfAccount } from '../lib/phone.ts';
import { useSession } from '../lib/session.tsx';
import { getThemePreference, setThemePreference } from '../lib/theme.ts';
import type { ThemePreference } from '../lib/theme.ts';

function TrackForm({
  track,
  onClose,
}: {
  track: Track | null;
  onClose: () => void;
}) {
  const { setMe } = useSession();
  const toast = useToast();
  const existing = getExam(track?.examId);
  const [level, setLevel] = useState<LevelId | null>(existing?.level ?? null);
  const [examId, setExamId] = useState<string | null>(track?.examId ?? null);
  const [medium, setMedium] = useState<MediumId>(track?.medium ?? 'en');
  const [dailyGoal, setDailyGoal] = useState(String(track?.dailyGoal ?? 20));
  const [examDate, setExamDate] = useState(track?.examDate ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!examId) {
      setError('Choose an exam.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      setMe(await api<Me>('/tracks', { method: 'POST', body: { examId, medium, dailyGoal: Number(dailyGoal), examDate: examDate || null } }));
      toast(track ? 'Saved.' : 'Exam added.');
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {!track && (
        <>
          <div>
            <p className="mb-2 text-sm font-medium">Level</p>
            <RadioTiles
              legend="Level"
              value={level}
              onChange={(value) => {
                setLevel(value);
                setExamId(null);
              }}
              options={LEVELS.map((l) => ({ value: l.id, label: l.name }))}
            />
          </div>
          {level && (
            <div>
              <p className="mb-2 text-sm font-medium">Exam</p>
              <RadioTiles
                legend="Exam"
                layout="stack"
                value={examId}
                onChange={setExamId}
                options={examsForLevel(level).map((e) => ({ value: e.id, label: e.name }))}
              />
            </div>
          )}
        </>
      )}
      <div>
        <p className="mb-2 text-sm font-medium">Medium</p>
        <RadioTiles legend="Medium" value={medium} onChange={setMedium} options={MEDIUMS.map((m) => ({ value: m.id, label: m.native, lang: m.id }))} />
      </div>
      <Field label="Daily goal (questions)">
        {(props) => (
          <TextInput {...props} type="number" inputMode="numeric" min={1} max={500} value={dailyGoal} onChange={(e) => setDailyGoal(e.target.value)} />
        )}
      </Field>
      <Field label="Exam date (optional)">
        {(props) => <TextInput {...props} type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />}
      </Field>
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={saving} onClick={save}>{track ? 'Save changes' : 'Add exam'}</Button>
      </div>
    </div>
  );
}

export function ProfilePage() {
  const { me, setMe, logOut } = useSession();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [name, setName] = useState(me?.user?.name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Track | 'new' | null>(null);
  const [removing, setRemoving] = useState<Track | null>(null);
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference);

  useEffect(() => {
    if (params.get('add')) {
      setEditing('new');
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const saveName = async () => {
    setSavingName(true);
    setNameError(null);
    try {
      setMe(await api<Me>('/me', { method: 'PATCH', body: { name } }));
      toast('Name saved.');
    } catch (err) {
      setNameError((err as Error).message);
    } finally {
      setSavingName(false);
    }
  };

  const removeTrack = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      setMe(await api<Me>(`/tracks/${removing.examId}`, { method: 'DELETE' }));
      setRemoving(null);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader title="Profile" subtitle={formatPhone(phoneOfAccount(me?.user?.email)) || me?.user?.email} />

      <Card>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg">Exams you are preparing for</h2>
          <Button variant="secondary" className="shrink-0 px-3 text-sm" onClick={() => setEditing('new')}>
            <Plus aria-hidden className="size-4" /> Add
          </Button>
        </div>
        <ul className="mt-2 divide-y divide-line">
          {me?.tracks.map((track) => {
            const exam = getExam(track.examId);
            return (
              <li key={track.examId} className="py-3">
                <p className="font-medium">{exam?.name ?? track.examId}</p>
                <p className="text-sm text-ink-3">
                  {getLevel(exam?.level)?.name} · {mediumName(track.medium)} · {track.dailyGoal} a day
                  {track.examDate && ` · Exam on ${track.examDate}`}
                </p>
                <div className="mt-1 flex gap-1">
                  <Button variant="ghost" className="-ml-2 text-sm font-medium" onClick={() => setEditing(track)}>
                    <Pencil aria-hidden className="size-4" /> Edit
                  </Button>
                  {(me?.tracks.length ?? 0) > 1 && (
                    <Button variant="ghost" className="text-sm font-medium text-bad hover:text-bad" onClick={() => setRemoving(track)}>
                      Remove
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg">Your details</h2>
        <Field label="Name" error={nameError}>
          {(props) => <input {...props} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={inputClass} />}
        </Field>
        <Button variant="secondary" className="mt-3 w-full sm:w-auto" loading={savingName} disabled={name.trim() === me?.user?.name} onClick={saveName}>
          Save name
        </Button>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg">Appearance</h2>
        <RadioTiles<ThemePreference>
          legend="Theme"
          value={theme}
          onChange={(value) => {
            setTheme(value);
            setThemePreference(value);
          }}
          options={[
            { value: 'system', label: 'Match device' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </Card>

      <div className="pt-2">
        <Button variant="danger" className="w-full sm:w-auto" onClick={() => logOut()}>
          <LogOut aria-hidden className="size-4" /> Log out
        </Button>
      </div>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add an exam' : `Edit ${getExam(editing?.examId)?.name ?? 'exam'}`} sheetOnMobile>
        {editing !== null && (
          <TrackForm key={editing === 'new' ? 'new' : editing.examId} track={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
        )}
      </Modal>

      <Modal open={removing !== null} onClose={() => setRemoving(null)} title={`Remove ${getExam(removing?.examId)?.name ?? 'exam'}?`}>
        <p className="text-[15px] text-ink-2">It leaves your list, but your progress is kept. Add it again any time to bring it back.</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setRemoving(null)}>Keep it</Button>
          <Button variant="danger" loading={busy} onClick={removeTrack}>Remove</Button>
        </div>
      </Modal>
    </div>
  );
}
