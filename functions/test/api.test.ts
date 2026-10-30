// Runs against the Firebase emulators and a fake Gemini server. Start it with "npm test".
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';
import { getExam } from '../../shared/catalog.ts';
import type { AnswerResult, BuildEvent, Me, ProgressView, QuizConfig, QuizSummary, QuizView } from '../../shared/types.ts';
import { getFirestore } from 'firebase-admin/firestore';
import { accountName, formatPhone, normalisePhone, phoneOfAccount } from '../../src/lib/phone.ts';
import { db, DATABASE_ID, refs } from '../src/firestore.ts';
import { cleanQuestion, shuffleOptions } from '../src/gemini.ts';
import { planSlots } from '../src/quiz-builder.ts';
import { addDays, advanceStreak, currentStreak } from '../src/time.ts';

const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-psc-test';
const API = `http://127.0.0.1:5101/${PROJECT}/asia-south1/pscApi`;
const AUTH = 'http://127.0.0.1:9199/identitytoolkit.googleapis.com/v1';

type GeminiMode = 'ok' | 'primary_down' | 'all_down' | 'bad_key' | 'slow_primary';
const gemini = {
  mode: 'ok' as GeminiMode,
  calls: [] as { model: string; body: Record<string, any>; key: string | undefined }[],
  counter: 0,
};

function fakeResponse(count: number) {
  const questions = Array.from({ length: count }, () => {
    gemini.counter += 1;
    return {
      question: `Generated question number ${gemini.counter} for testing?`,
      options: ['Right', 'Wrong one', 'Wrong two', 'Wrong three'],
      correctIndex: 0,
      explanation: 'Because this is the right one.',
      topic: 'Test topic',
      difficulty: 'easy',
    };
  });
  return {
    status: 'completed',
    steps: [
      { type: 'thought', summary: [] },
      { type: 'model_output', content: [{ type: 'text', text: JSON.stringify({ questions }) }] },
    ],
  };
}

let mockServer: Server;
before(async () => {
  mockServer = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', async () => {
      const body = JSON.parse(raw);
      gemini.calls.push({ model: body.model, body, key: req.headers['x-goog-api-key'] as string | undefined });
      const fail = (status: number, message: string) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message } }));
      };
      if (gemini.mode === 'bad_key') return fail(400, 'API key not valid. Please pass a valid API key.');
      if (gemini.mode === 'all_down') return fail(503, 'High demand.');
      if (gemini.mode === 'primary_down' && body.model === 'primary-model') return fail(503, 'High demand.');
      if (gemini.mode === 'slow_primary' && body.model === 'primary-model') {
        await new Promise((resolve) => setTimeout(resolve, 3500));
      }
      const count = Number(/Write (\d+) questions/.exec(body.input)?.[1] ?? 1);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fakeResponse(count)));
    });
  });
  await new Promise<void>((resolve) => mockServer.listen(9911, '127.0.0.1', resolve));
});
after(() => mockServer.close());

beforeEach(async () => {
  gemini.mode = 'ok';
  gemini.calls = [];
  await refs.meta('gemini').delete();
});

let userCounter = 0;
async function newUser() {
  userCounter += 1;
  const res = await fetch(`${AUTH}/accounts:signUp?key=demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `student${userCounter}-${Date.now()}@example.com`, password: 'password123', returnSecureToken: true }),
  });
  const data = (await res.json()) as { idToken: string; localId: string };
  assert.ok(data.idToken, 'auth emulator returned a token');
  return { token: data.idToken, uid: data.localId };
}

type User = Awaited<ReturnType<typeof newUser>>;

async function call<T>(user: User | null, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(user ? { Authorization: `Bearer ${user.token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
}

async function build(user: User, overrides: Partial<QuizConfig>) {
  const config: QuizConfig = {
    examId: 'ldc',
    medium: 'en',
    kind: 'subject',
    mode: 'practice',
    subjectIds: ['geography'],
    topic: null,
    year: null,
    difficulty: 'mixed',
    count: 10,
    ...overrides,
  };
  const res = await fetch(`${API}/quizzes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const events = text.trim().split('\n').map((line) => JSON.parse(line) as BuildEvent);
  return { events, last: events.at(-1)! };
}

async function buildOk(user: User, overrides: Partial<QuizConfig>) {
  const { last } = await build(user, overrides);
  assert.equal(last.type, 'done', JSON.stringify(last));
  return (last as Extract<BuildEvent, { type: 'done' }>).quizId;
}

const correctIndexOf = async (user: User, quizId: string, position: number) => {
  const content = (await refs.quizContent(user.uid, quizId).get()).data()!;
  return content.questions[position].correctIndex as number;
};

describe('accounts', () => {
  test('rejects requests without a valid token', async () => {
    assert.equal((await call(null, '/me')).status, 401);
    assert.equal((await call({ token: 'not-a-token', uid: 'x' }, '/me')).status, 401);
  });

  test('there is no public sign-up', async () => {
    const res = await call(null, '/register', 'POST', { name: 'Someone', email: 'someone@example.com', password: 'password123', adult: true });
    assert.equal(res.status, 404);
  });

  test('a new account starts unnamed, then saves its name and age confirmation', async () => {
    const user = await newUser();
    const first = await call<Me>(user, '/me');
    assert.equal(first.status, 200);
    assert.equal(first.data.user?.name, 'Student');
    assert.deepEqual(first.data.tracks, []);
    assert.equal((await refs.user(user.uid).get()).data()!.adultConfirmedAt, null);

    const named = await call<Me>(user, '/me', 'PATCH', { name: 'Anu Krishnan', adultConfirmed: true });
    assert.equal(named.data.user?.name, 'Anu Krishnan');
    assert.ok((await refs.user(user.uid).get()).data()!.adultConfirmedAt > 0);
  });

  test('keeps a separate goal and medium for each exam', async () => {
    const user = await newUser();
    await call(user, '/tracks', 'POST', { examId: 'ldc', medium: 'ml', dailyGoal: 30, examDate: '2027-02-01' });
    const second = await call<Me>(user, '/tracks', 'POST', { examId: 'kas', medium: 'en', dailyGoal: 50 });
    assert.equal(second.data.tracks.length, 2);
    assert.equal(second.data.user?.activeExamId, 'kas');
    assert.equal(second.data.tracks.find((t) => t.examId === 'ldc')?.dailyGoal, 30);
    const removed = await call<Me>(user, '/tracks/kas', 'DELETE');
    assert.deepEqual(removed.data.tracks.map((t) => t.examId), ['ldc']);
    assert.equal(removed.data.user?.activeExamId, 'ldc');
  });

  test('rejects invalid selections', async () => {
    const user = await newUser();
    assert.equal((await call(user, '/tracks', 'POST', { examId: 'nope', medium: 'en' })).status, 400);
    assert.equal((await call(user, '/tracks', 'POST', { examId: 'ldc', medium: 'xx' })).status, 400);
    assert.equal((await call(user, '/quizzes', 'POST', { examId: 'ldc', medium: 'en', kind: 'subject', mode: 'practice', count: 7 })).status, 400);
    assert.equal(
      (await call(user, '/quizzes', 'POST', { examId: 'ldc', medium: 'en', kind: 'subject', mode: 'practice', count: 10, subjectIds: ['police-law'] })).status,
      400,
      'subject outside the exam syllabus',
    );
  });
});

describe('security', () => {
  test('browsers cannot read or write Firestore directly', async () => {
    const user = await newUser();
    const base = `http://127.0.0.1:8180/v1/projects/${PROJECT}/databases/psc-practice/documents`;
    const headers = { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' };
    assert.equal((await fetch(`${base}/questions`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/users/${user.uid}`, { headers })).status, 403);
    const write = await fetch(`${base}/users/${user.uid}/stats/summary`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ fields: { all: { integerValue: 999 } } }),
    });
    assert.equal(write.status, 403);
  });

  test("one student cannot open another student's session", async () => {
    const [owner, other] = [await newUser(), await newUser()];
    const quizId = await buildOk(owner, { count: 10 });
    assert.equal((await call(other, `/quizzes/${quizId}`)).status, 404);
    assert.equal((await call(other, `/quizzes/${quizId}/answer`, 'POST', { position: 0, selectedIndex: 0 })).status, 404);
    assert.equal((await call(other, `/quizzes/${quizId}/finish`, 'POST', {})).status, 404);
  });

  test('a test never sends the answer key before it is finished', async () => {
    const user = await newUser();
    const quizId = await buildOk(user, { mode: 'test' });
    const { data } = await call<QuizView>(user, `/quizzes/${quizId}`);
    const raw = JSON.stringify(data);
    assert.ok(!raw.includes('correctIndex') && !raw.includes('explanation') && !raw.includes('"key"'));
    const answer = await call<AnswerResult>(user, `/quizzes/${quizId}/answer`, 'POST', { position: 0, selectedIndex: 1 });
    assert.equal(answer.data.correctIndex, undefined);
    assert.equal(answer.data.isCorrect, undefined);
  });

  test('practice hides each answer until that question is answered', async () => {
    const user = await newUser();
    const quizId = await buildOk(user, {});
    const before = await call<QuizView>(user, `/quizzes/${quizId}`);
    assert.ok(before.data.questions.every((q) => q.correctIndex === undefined));
    await call(user, `/quizzes/${quizId}/answer`, 'POST', { position: 0, selectedIndex: 0 });
    const after = await call<QuizView>(user, `/quizzes/${quizId}`);
    assert.notEqual(after.data.questions[0].correctIndex, undefined);
    assert.equal(after.data.questions[1].correctIndex, undefined);
  });
});

describe('practice mode', () => {
  test('tops up the sample questions with Gemini when there are too few', async () => {
    const user = await newUser();
    const { events, last } = await build(user, { subjectIds: ['constitution'], count: 10, difficulty: 'easy' });
    assert.equal(last.type, 'done');
    assert.ok(events.some((e) => e.type === 'progress'), 'streams progress');
    assert.ok(gemini.calls.length >= 1, 'the easy sample set has fewer than 10 questions');
  });

  test('the first answer stands and counts once in daily progress', async () => {
    const user = await newUser();
    await call(user, '/tracks', 'POST', { examId: 'ldc', medium: 'en', dailyGoal: 20 });
    const quizId = await buildOk(user, {});
    const key = await correctIndexOf(user, quizId, 0);

    const first = await call<AnswerResult>(user, `/quizzes/${quizId}/answer`, 'POST', { position: 0, selectedIndex: key, timeMs: 5000 });
    assert.equal(first.data.isCorrect, true);
    assert.ok(first.data.explanation);

    const changed = await call<AnswerResult>(user, `/quizzes/${quizId}/answer`, 'POST', { position: 0, selectedIndex: (key + 1) % 4 });
    assert.equal(changed.data.selectedIndex, key, 'cannot change after seeing the answer');

    const wrongKey = await correctIndexOf(user, quizId, 1);
    await call(user, `/quizzes/${quizId}/answer`, 'POST', { position: 1, selectedIndex: (wrongKey + 1) % 4, timeMs: 5000 });

    const { data } = await call<ProgressView>(user, '/progress?examId=ldc&days=7');
    assert.equal(data.today.attempted, 2);
    assert.equal(data.today.correct, 1);
    assert.equal(data.today.goal, 20);
    assert.equal(data.streak.current, 1);
    assert.equal(data.range.seconds, 10);
    assert.equal(data.subjects.find((s) => s.subjectId === 'geography')?.attempted, 2);
    assert.equal(data.daily.length, 7);
    assert.equal(data.heatmap.length, 112);
  });

  test('progress is tracked separately for each exam', async () => {
    const user = await newUser();
    const ldc = await buildOk(user, { examId: 'ldc' });
    await call(user, `/quizzes/${ldc}/answer`, 'POST', { position: 0, selectedIndex: 0 });
    const lgs = await buildOk(user, { examId: 'lgs', subjectIds: ['biology'] });
    await call(user, `/quizzes/${lgs}/answer`, 'POST', { position: 0, selectedIndex: 0 });
    await call(user, `/quizzes/${lgs}/answer`, 'POST', { position: 1, selectedIndex: 0 });

    assert.equal((await call<ProgressView>(user, '/progress?examId=ldc&days=7')).data.today.attempted, 1);
    assert.equal((await call<ProgressView>(user, '/progress?examId=lgs&days=7')).data.today.attempted, 2);
    assert.equal((await call<ProgressView>(user, '/progress?days=7')).data.today.attempted, 3);
  });

  test('wrong answers become mistakes and leave once answered correctly', async () => {
    const user = await newUser();
    const quizId = await buildOk(user, {});
    const key = await correctIndexOf(user, quizId, 0);
    await call(user, `/quizzes/${quizId}/answer`, 'POST', { position: 0, selectedIndex: (key + 1) % 4 });
    await call(user, `/quizzes/${quizId}/finish`, 'POST', {});

    const revise = await buildOk(user, { kind: 'mistakes', subjectIds: [], count: 10 });
    const view = await call<QuizView>(user, `/quizzes/${revise}`);
    assert.equal(view.data.questions.length, 1);

    const reviseKey = await correctIndexOf(user, revise, 0);
    await call(user, `/quizzes/${revise}/answer`, 'POST', { position: 0, selectedIndex: reviseKey });
    await call(user, `/quizzes/${revise}/finish`, 'POST', {});

    const { last } = await build(user, { kind: 'mistakes', subjectIds: [], count: 10 });
    assert.equal(last.type, 'error');
    assert.equal((last as { code: string }).code, 'no_mistakes');
  });
});

describe('test mode', () => {
  test('scores with negative marking and only counts progress on finish', async () => {
    const user = await newUser();
    const quizId = await buildOk(user, { mode: 'test', count: 10 });
    const view = await call<QuizView>(user, `/quizzes/${quizId}`);
    assert.equal(view.data.timeLimitSec, 450);
    assert.ok(view.data.remainingSec! > 400);

    // 3 right, 3 wrong, 4 skipped. Answers may change before submitting.
    for (const position of [0, 1, 2]) {
      const key = await correctIndexOf(user, quizId, position);
      await call(user, `/quizzes/${quizId}/answer`, 'POST', { position, selectedIndex: (key + 1) % 4 });
      await call(user, `/quizzes/${quizId}/answer`, 'POST', { position, selectedIndex: key });
    }
    for (const position of [3, 4, 5]) {
      const key = await correctIndexOf(user, quizId, position);
      await call(user, `/quizzes/${quizId}/answer`, 'POST', { position, selectedIndex: (key + 1) % 4 });
    }
    const key6 = await correctIndexOf(user, quizId, 6);
    await call(user, `/quizzes/${quizId}/answer`, 'POST', { position: 6, selectedIndex: key6 });
    await call(user, `/quizzes/${quizId}/answer`, 'POST', { position: 6, selectedIndex: null }); // cleared again

    assert.equal((await call<ProgressView>(user, '/progress?examId=ldc&days=7')).data.today.attempted, 0);

    const finished = await call<QuizView>(user, `/quizzes/${quizId}/finish`, 'POST', {});
    assert.deepEqual(finished.data.result, { correct: 3, wrong: 3, skipped: 4, score: 2 });
    assert.ok(finished.data.questions.every((q) => q.correctIndex !== undefined), 'answers shown after finishing');

    const progress = await call<ProgressView>(user, '/progress?examId=ldc&days=7');
    assert.equal(progress.data.today.attempted, 6);
    assert.equal(progress.data.today.correct, 3);

    const late = await call(user, `/quizzes/${quizId}/answer`, 'POST', { position: 7, selectedIndex: 0 });
    assert.equal(late.status, 409);

    await call(user, `/quizzes/${quizId}/finish`, 'POST', {});
    const repeat = await call<ProgressView>(user, '/progress?examId=ldc&days=7');
    assert.equal(repeat.data.today.attempted, 6, 'finishing twice does not double count');
  });

  test('a test that runs out of time is scored and rejects late answers', async () => {
    const user = await newUser();
    const quizId = await buildOk(user, { mode: 'test' });
    await call(user, `/quizzes/${quizId}/answer`, 'POST', { position: 0, selectedIndex: 0 });
    await refs.quiz(user.uid, quizId).update({ startedAt: Date.now() - 451_000 - 10_000 });

    const late = await call(user, `/quizzes/${quizId}/answer`, 'POST', { position: 1, selectedIndex: 0 });
    assert.equal(late.status, 409);
    const view = await call<QuizView>(user, `/quizzes/${quizId}`);
    assert.equal(view.data.status, 'finished');
    assert.equal(view.data.result!.skipped, 9);
    assert.equal((await call<QuizSummary | null>(user, '/quizzes/active')).data, null);
  });

  test('starting a new session scores the unfinished one', async () => {
    const user = await newUser();
    const first = await buildOk(user, {});
    assert.equal((await call<QuizSummary>(user, '/quizzes/active')).data.id, first);
    const second = await buildOk(user, { subjectIds: ['biology'] });
    assert.equal((await call<QuizSummary>(user, '/quizzes/active')).data.id, second);
    assert.equal((await call<QuizView>(user, `/quizzes/${first}`)).data.status, 'finished');
  });

  test('model exams use the whole syllabus and are always timed', async () => {
    const user = await newUser();
    const quizId = await buildOk(user, { kind: 'mock', mode: 'practice', subjectIds: [], count: 25 });
    const { data } = await call<QuizView>(user, `/quizzes/${quizId}`);
    assert.equal(data.config.mode, 'test');
    assert.equal(data.questions.length, 25);
    assert.ok(new Set(data.questions.map((q) => q.subjectId)).size >= 8);
  });
});

describe('Gemini', () => {
  test('sends the documented request and stores what comes back', async () => {
    const user = await newUser();
    const quizId = await buildOk(user, { subjectIds: ['current-affairs'], medium: 'ml', count: 10 });
    const call0 = gemini.calls[0];
    assert.equal(call0.model, 'primary-model');
    assert.ok(call0.key);
    assert.equal(call0.body.response_format.mime_type, 'application/json');
    assert.equal(call0.body.store, false);
    assert.equal(call0.body.temperature, undefined, 'current models ignore temperature');
    assert.match(call0.body.input, /formal Malayalam script/);
    assert.match(call0.body.input, /Current Affairs/);
    assert.ok(call0.body.system_instruction.includes('Never invent a name'));

    const { data } = await call<QuizView>(user, `/quizzes/${quizId}`);
    assert.equal(data.questions.length, 10);
    assert.ok(data.questions.every((q) => q.source === 'ai' && q.medium === 'ml'));
  });

  test('previous-year sets are labelled and use the chosen year', async () => {
    const user = await newUser();
    const quizId = await buildOk(user, { kind: 'pyq', year: 2019, subjectIds: ['economics'], count: 10 });
    assert.match(gemini.calls[0].body.input, /around 2019/);
    const { data } = await call<QuizView>(user, `/quizzes/${quizId}`);
    assert.ok(data.questions.every((q) => q.source === 'pyq' && q.year === 2019));
    gemini.calls = [];

    // Asking for a different year must not reuse the 2019 set.
    const other = await newUser();
    await buildOk(other, { kind: 'pyq', year: 2021, subjectIds: ['economics'], count: 10 });
    assert.ok(gemini.calls.length >= 1);
    assert.match(gemini.calls[0].body.input, /around 2021/);
  });

  test('a second student reuses the bank, and a student never repeats a question while new ones can be written', async () => {
    const [first, second] = [await newUser(), await newUser()];
    const firstQuiz = await buildOk(first, { subjectIds: ['fire-safety'], examId: 'fro', count: 10 });
    assert.ok(gemini.calls.length >= 1);
    gemini.calls = [];

    await buildOk(second, { subjectIds: ['fire-safety'], examId: 'fro', count: 10 });
    assert.equal(gemini.calls.length, 0, 'served from the shared bank');

    const again = await buildOk(first, { subjectIds: ['fire-safety'], examId: 'fro', count: 10 });
    assert.ok(gemini.calls.length >= 1, 'writes new ones for a student who has seen the bank');
    const [a, b] = await Promise.all([call<QuizView>(first, `/quizzes/${firstQuiz}`), call<QuizView>(first, `/quizzes/${again}`)]);
    const seen = new Set(a.data.questions.map((q) => q.questionId));
    assert.ok(b.data.questions.every((q) => !seen.has(q.questionId)));
  });

  test('falls back when the primary model is down, then skips it for a while', async () => {
    const user = await newUser();
    gemini.mode = 'primary_down';
    await buildOk(user, { subjectIds: ['forestry'], examId: 'bfo', count: 10 });
    assert.ok(gemini.calls.some((c) => c.model === 'fallback-model'));

    gemini.calls = [];
    gemini.mode = 'ok';
    await buildOk(user, { subjectIds: ['forestry'], examId: 'bfo', count: 10 });
    assert.ok(gemini.calls.length > 0 && gemini.calls.every((c) => c.model === 'fallback-model'), 'cooldown remembered');
  });

  test('falls back when the primary model is too slow', async () => {
    const user = await newUser();
    gemini.mode = 'slow_primary';
    await buildOk(user, { subjectIds: ['excise-law'], examId: 'excise', count: 10 });
    assert.ok(gemini.calls.some((c) => c.model === 'fallback-model'));
  });

  test('reports a clear error when Gemini fails and nothing is in the bank', async () => {
    const user = await newUser();
    gemini.mode = 'bad_key';
    const { last } = await build(user, { subjectIds: ['governance'], examId: 'kas', medium: 'ta', count: 10 });
    assert.equal(last.type, 'error');
    assert.equal((last as { code: string }).code, 'bad_key');
    assert.match((last as { message: string }).message, /rejected the API key/);
  });

  test('still starts a session from the bank when Gemini is down', async () => {
    const user = await newUser();
    gemini.mode = 'all_down';
    const { last } = await build(user, { subjectIds: ['kerala-history'], count: 25, difficulty: 'easy', medium: 'ml' });
    assert.equal(last.type, 'done', JSON.stringify(last));
    const done = last as Extract<BuildEvent, { type: 'done' }>;
    assert.ok(done.got > 0 && done.got < 25);
    assert.match(done.notice!, /Only \d+ of 25/);
  });

  test('stops writing new questions at the daily limit per student', async () => {
    const user = await newUser();
    await refs.aiUsage(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(Date.now())).set(
      { users: { [user.uid]: 60 } },
      { merge: true },
    );
    const { last } = await build(user, { subjectIds: ['land-revenue'], examId: 'vfa', medium: 'kn', count: 10 });
    assert.equal(last.type, 'error');
    assert.equal((last as { code: string }).code, 'limit');
    assert.equal(gemini.calls.length, 0);
  });

  test('a reported question is not shown to that student again', async () => {
    const user = await newUser();
    const quizId = await buildOk(user, { subjectIds: ['arts-sports'], medium: 'en', count: 10 });
    const before = await call<QuizView>(user, `/quizzes/${quizId}`);
    const reported = before.data.questions[0];
    assert.equal((await call(user, `/quizzes/${quizId}/report`, 'POST', { position: 0, reason: 'wrong_answer' })).status, 200);
    const after = await call<QuizView>(user, `/quizzes/${quizId}`);
    assert.equal(after.data.questions[0].reported, true);
    const stored = (await refs.question(reported.questionId).get()).data()!;
    assert.deepEqual(stored.reportedBy, [user.uid]);
    assert.equal((await call(user, `/quizzes/${quizId}/report`, 'POST', { position: 0, reason: 'nonsense' })).status, 400);

    // With Gemini down the session repeats questions already seen, except the reported one.
    gemini.mode = 'all_down';
    const repeat = await buildOk(user, { subjectIds: ['arts-sports'], medium: 'en', count: 10 });
    const repeated = await call<QuizView>(user, `/quizzes/${repeat}`);
    assert.ok(repeated.data.questions.length >= 5);
    assert.ok(repeated.data.questions.every((q) => q.questionId !== reported.questionId));
  });
});

describe('logic', () => {
  const spec = { difficulty: 'mixed' as const, topic: null };
  const raw = (options: string[], correctIndex = 0) => ({
    question: 'A valid question?',
    options,
    correctIndex,
    explanation: 'Why.',
    topic: 'T',
    difficulty: 'easy',
  });

  test('phone numbers become the same account names as Ceeq Tutor', () => {
    for (const typed of ['9876543210', '98765 43210', '09876543210', '919876543210', '+91 98765 43210']) {
      assert.equal(accountName(normalisePhone(typed)!), '9876543210@ceeq.student', typed);
    }
    assert.equal(accountName('+14155550100'), '0014155550100@ceeq.student');
    assert.equal(normalisePhone('12345'), null);
    assert.equal(normalisePhone('1234567890'), null, 'Indian mobiles start with 6 to 9');
    assert.equal(formatPhone(phoneOfAccount('9876543210@ceeq.student')), '+91 98765 43210');
    assert.equal(phoneOfAccount('0014155550100@ceeq.student'), '+14155550100');
    assert.equal(phoneOfAccount('someone@example.com'), '');
  });

  test('keeps initials in names when removing option labels', () => {
    const names = cleanQuestion(raw(['A. P. J. Abdul Kalam', 'K. R. Narayanan', 'Zakir Husain', 'V. V. Giri']), spec)!;
    assert.ok(names.options.includes('A. P. J. Abdul Kalam'));
    const labelled = cleanQuestion(raw(['A) One', 'B) Two', 'C) Three', 'D) Four']), spec)!;
    assert.deepEqual([...labelled.options].sort(), ['Four', 'One', 'Three', 'Two']);
  });

  test('rejects malformed questions', () => {
    assert.equal(cleanQuestion(raw(['One', 'Two', 'Three']), spec), null);
    assert.equal(cleanQuestion(raw(['One', 'One', 'Two', 'Three']), spec), null);
    assert.equal(cleanQuestion(raw(['One', 'Two', 'Three', 'Four'], 4), spec), null);
    assert.equal(cleanQuestion({ ...raw(['One', 'Two', 'Three', 'Four']), explanation: ' ' }, spec), null);
    assert.equal(cleanQuestion(null, spec), null);
  });

  test('shuffling keeps the correct answer and leaves position-dependent sets alone', () => {
    for (let i = 0; i < 50; i++) {
      const options = ['Right', 'B', 'C', 'D'];
      const result = shuffleOptions(options, 0);
      assert.equal(result.options[result.correctIndex], 'Right');
    }
    const fixed = ['One', 'Two', 'Both of these', 'None of the above'];
    assert.deepEqual(shuffleOptions(fixed, 2), { options: fixed, correctIndex: 2 });
  });

  test('splits questions across subjects without losing any', () => {
    const exam = getExam('ldc')!;
    for (const count of [10, 25, 50, 100]) {
      const slots = planSlots(exam, { subjectIds: [], count });
      assert.equal(slots.reduce((sum, s) => sum + s.count, 0), count);
    }
    assert.deepEqual(planSlots(exam, { subjectIds: ['geography'], count: 10 }), [{ subjectId: 'geography', count: 10 }]);
    assert.equal(planSlots(exam, { subjectIds: ['geography', 'biology'], count: 25 }).reduce((sum, s) => sum + s.count, 0), 25);
  });

  test('every exam syllabus only uses known subjects and adds up', async () => {
    const { EXAMS, getSubject } = await import('../../shared/catalog.ts');
    for (const exam of EXAMS) {
      for (const entry of exam.syllabus) assert.ok(getSubject(entry.subjectId), `${exam.id}: ${entry.subjectId}`);
      assert.equal(new Set(exam.syllabus.map((s) => s.subjectId)).size, exam.syllabus.length);
    }
  });

  test('every subject belongs to at least one exam', async () => {
    const { EXAMS, SUBJECTS } = await import('../../shared/catalog.ts');
    const used = new Set(EXAMS.flatMap((exam) => exam.syllabus.map((s) => s.subjectId)));
    for (const subject of SUBJECTS) assert.ok(used.has(subject.id), `${subject.id} cannot be selected`);
  });

  test('streaks grow on consecutive days and reset after a gap', () => {
    const today = '2026-10-31';
    const first = advanceStreak(undefined, today);
    assert.deepEqual(first, { lastDay: today, streak: 1, best: 1 });
    assert.equal(advanceStreak(first, today).streak, 1, 'same day does not add');
    const next = advanceStreak(first, addDays(today, 1));
    assert.equal(next.streak, 2);
    const broken = advanceStreak(next, addDays(today, 5));
    assert.deepEqual(broken, { lastDay: addDays(today, 5), streak: 1, best: 2 });

    assert.equal(currentStreak(next, addDays(today, 2)), 2, 'alive the day after');
    assert.equal(currentStreak(next, addDays(today, 3)), 0, 'gone after a full missed day');
    assert.equal(currentStreak(undefined, today), 0);
  });
});

// Runs last. The (default) database belongs to Ceeq Tutor in production, so PSC must never write there.
describe('isolation', () => {
  test('nothing is written to the default database', async () => {
    assert.match(DATABASE_ID, /^[a-z][a-z0-9-]{3,62}$/, 'Firestore rejects shorter IDs, though the emulator allows them');
    assert.notEqual(DATABASE_ID, '(default)');
    const collections = await getFirestore().listCollections();
    assert.deepEqual(collections.map((c) => c.id), []);
    assert.ok((await db.listCollections()).length > 0, 'the PSC database holds the data');
  });
});

after(async () => {
  await db.terminate();
});
