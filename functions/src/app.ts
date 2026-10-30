import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { EXAMS, getExam, getMedium, getSubject, MOCK_COUNTS, PYQ_YEARS, QUESTION_COUNTS } from '../../shared/catalog.ts';
import type { MediumId } from '../../shared/catalog.ts';
import type { AnswerResult, BuildEvent, Me, QuizConfig, QuizQuestionView, QuizView, Track } from '../../shared/types.ts';
import { adminAuth, db, FieldValue, refs } from './firestore.ts';
import type { QuizContentDoc, QuizDoc, SummaryDoc, UserDoc } from './firestore.ts';
import { geminiConfigured } from './gemini.ts';
import { fieldError, HttpError } from './http.ts';
import { aiMessage, buildQuiz, finishQuiz } from './quiz-builder.ts';
import { ensureSeeded } from './seed-questions.ts';
import { getProgress, recordAnswers, remainingSeconds, toSummary } from './stats.ts';

const EXPIRY_GRACE_SEC = 5;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_NAME = 'Student';

const uidOf = (res: Response) => res.locals.uid as string;

async function requireUser(req: Request, res: Response, next: NextFunction) {
  const token = /^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1];
  if (!token) throw new HttpError(401, 'unauthenticated', 'Please log in to continue.');
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    res.locals.uid = decoded.uid;
    res.locals.email = decoded.email ?? '';
  } catch {
    throw new HttpError(401, 'unauthenticated', 'Your session has expired. Please log in again.');
  }
  next();
}

function tracksOf(user: UserDoc): Track[] {
  return Object.entries(user.tracks ?? {})
    .sort(([, a], [, b]) => a.createdAt - b.createdAt)
    .map(([examId, t]) => ({ examId, medium: t.medium, dailyGoal: t.dailyGoal, examDate: t.examDate }));
}

function meView(uid: string, user: UserDoc): Me {
  return {
    user: { id: uid, name: user.name, email: user.email, activeExamId: user.activeExamId },
    tracks: tracksOf(user),
    ai: { configured: geminiConfigured() },
  };
}

async function loadOrCreateUser(uid: string, email: string): Promise<UserDoc> {
  const ref = refs.user(uid);
  const snap = await ref.get();
  if (snap.exists) return snap.data() as UserDoc;
  const user: UserDoc = {
    name: DEFAULT_NAME, // Asked for during onboarding. The account name is only a phone number.
    email,
    activeExamId: null,
    adultConfirmedAt: null,
    createdAt: Date.now(),
    tracks: {},
  };
  await ref.set(user, { merge: true });
  return user;
}

function parseTrackFields(body: Record<string, unknown>) {
  const medium = body.medium;
  if (typeof medium !== 'string' || !getMedium(medium)) throw fieldError('medium', 'Choose a medium.');
  const dailyGoal = Number(body.dailyGoal ?? 20);
  if (!Number.isInteger(dailyGoal) || dailyGoal < 1 || dailyGoal > 500) {
    throw fieldError('dailyGoal', 'Daily goal must be between 1 and 500 questions.');
  }
  let examDate: string | null = null;
  if (body.examDate) {
    if (typeof body.examDate !== 'string' || !DAY_PATTERN.test(body.examDate)) throw fieldError('examDate', 'Enter a valid date.');
    examDate = body.examDate;
  }
  return { medium: medium as MediumId, dailyGoal, examDate };
}

function parseQuizConfig(body: Record<string, unknown>): QuizConfig {
  const exam = getExam(body.examId as string);
  if (!exam) throw fieldError('examId', 'Choose an exam.');
  if (typeof body.medium !== 'string' || !getMedium(body.medium)) throw fieldError('medium', 'Choose a medium.');

  const kind = body.kind;
  if (kind !== 'subject' && kind !== 'pyq' && kind !== 'mock' && kind !== 'mistakes') {
    throw fieldError('kind', 'Choose a question set.');
  }
  const mode = kind === 'mock' ? 'test' : body.mode;
  if (mode !== 'practice' && mode !== 'test') throw fieldError('mode', 'Choose practice or test mode.');

  const rawSubjects = Array.isArray(body.subjectIds) ? body.subjectIds : [];
  const syllabus = new Set(exam.syllabus.map((s) => s.subjectId));
  if (rawSubjects.some((id) => typeof id !== 'string' || !syllabus.has(id))) {
    throw fieldError('subjectIds', 'One of the chosen subjects is not in this exam.');
  }
  const subjectIds = kind === 'mock' ? [] : (rawSubjects as string[]);

  let topic: string | null = null;
  if (body.topic && kind !== 'mock' && kind !== 'mistakes') {
    const subject = subjectIds.length === 1 ? getSubject(subjectIds[0]) : undefined;
    if (!subject?.topics.includes(body.topic as string)) throw fieldError('topic', 'Choose a topic from the list.');
    topic = body.topic as string;
  }

  let year: number | null = null;
  if (body.year && kind === 'pyq') {
    if (!PYQ_YEARS.includes(Number(body.year))) throw fieldError('year', 'Choose a year from the list.');
    year = Number(body.year);
  }

  const difficulty = kind === 'mock' || kind === 'mistakes' ? 'mixed' : body.difficulty ?? 'mixed';
  if (difficulty !== 'mixed' && difficulty !== 'easy' && difficulty !== 'medium' && difficulty !== 'hard') {
    throw fieldError('difficulty', 'Choose a difficulty.');
  }

  const count = Number(body.count);
  const allowedCounts = kind === 'mock' ? MOCK_COUNTS : QUESTION_COUNTS;
  if (!allowedCounts.includes(count)) throw fieldError('count', 'Choose how many questions you want.');

  return { examId: exam.id, medium: body.medium as MediumId, kind, mode, subjectIds, topic, year, difficulty, count };
}

async function loadQuiz(uid: string, id: string): Promise<QuizDoc> {
  const ref = refs.quiz(uid, id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, 'not_found', 'This session could not be found.');
  const quiz = snap.data() as QuizDoc;
  if (isExpired(quiz)) {
    await finishQuiz(uid, id);
    return (await ref.get()).data() as QuizDoc;
  }
  return quiz;
}

// A test whose time has run out is scored as soon as anyone looks at it.
function isExpired(quiz: QuizDoc) {
  if (quiz.status !== 'in_progress' || quiz.timeLimitSec === null) return false;
  return (Date.now() - quiz.startedAt) / 1000 - quiz.timeLimitSec > EXPIRY_GRACE_SEC;
}

// The server is the only place answers live until they may be shown. A test hides them
// until it is finished; practice reveals each one after it has been answered.
async function quizView(uid: string, id: string, quiz: QuizDoc): Promise<QuizView> {
  const content = (await refs.quizContent(uid, id).get()).data() as QuizContentDoc;
  const finished = quiz.status === 'finished';
  const questions = content.questions.map((q, position): QuizQuestionView => {
    const answer = quiz.answers[position];
    const selected = answer?.s ?? null;
    const reveal = finished || (quiz.config.mode === 'practice' && selected !== null);
    return {
      position,
      questionId: q.id,
      subjectId: q.subjectId,
      topic: q.topic,
      difficulty: q.difficulty,
      source: q.source,
      year: q.year,
      medium: q.medium,
      question: q.question,
      options: q.options,
      selectedIndex: selected,
      flagged: answer?.f === true,
      reported: answer?.r === true,
      ...(reveal ? { correctIndex: q.correctIndex, explanation: q.explanation, isCorrect: answer?.c === true } : {}),
    };
  });
  return {
    id,
    config: quiz.config,
    status: quiz.status,
    startedAt: quiz.startedAt,
    finishedAt: quiz.finishedAt,
    timeLimitSec: quiz.timeLimitSec,
    remainingSec: remainingSeconds(quiz),
    result: quiz.result,
    questions,
  };
}

async function submitAnswer(uid: string, quizId: string, body: Record<string, unknown>): Promise<AnswerResult> {
  const position = Number(body.position);
  const hasSelection = 'selectedIndex' in body;
  const selection = body.selectedIndex;
  if (hasSelection && selection !== null && (!Number.isInteger(selection) || (selection as number) < 0 || (selection as number) > 3)) {
    throw new HttpError(400, 'invalid', 'Choose one of the four options.');
  }

  const ref = refs.quiz(uid, quizId);
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, 'not_found', 'This session could not be found.');
    const quiz = snap.data() as QuizDoc;
    if (quiz.status === 'finished' || isExpired(quiz)) throw new HttpError(409, 'finished', 'This session has already ended.');
    if (!Number.isInteger(position) || position < 0 || position >= quiz.total) {
      throw new HttpError(404, 'not_found', 'That question is not part of this session.');
    }

    const isPractice = quiz.config.mode === 'practice';
    const previous = quiz.answers[position] ?? {};
    const previousSelection = previous.s ?? null;
    // In practice mode the first answer stands, because the correct one is now on screen.
    const locked = isPractice && previousSelection !== null;
    const willAnswer = hasSelection && !locked;

    const selected = willAnswer ? (selection as number | null) : previousSelection;
    const correct = selected === null ? null : selected === quiz.key[position];
    const flagged = typeof body.flagged === 'boolean' ? body.flagged : previous.f === true;
    const ms = Math.min(Math.max(Number(body.timeMs) || 0, 0), 600_000);

    const summary =
      willAnswer && isPractice ? ((await tx.get(refs.summary(uid))).data() as SummaryDoc | undefined) : undefined;

    const answeredDelta = (selected === null ? 0 : 1) - (previousSelection === null ? 0 : 1);
    tx.update(ref, {
      [`answers.${position}`]: { ...previous, s: selected, c: correct, f: flagged, t: (previous.t ?? 0) + (willAnswer ? ms : 0) },
      answered: FieldValue.increment(answeredDelta),
    });

    if (willAnswer && isPractice && selected !== null) {
      recordAnswers(
        tx,
        uid,
        [{
          examId: quiz.examId,
          subjectId: quiz.subjects[position],
          questionId: quiz.questionIds[position],
          medium: quiz.config.medium,
          correct: correct === true,
          ms,
        }],
        summary,
      );
    }
    return { isPractice, selected, correct, flagged, correctIndex: quiz.key[position] };
  });

  const result: AnswerResult = { position, selectedIndex: outcome.selected, flagged: outcome.flagged };
  if (outcome.isPractice && outcome.selected !== null) {
    const content = (await refs.quizContent(uid, quizId).get()).data() as QuizContentDoc;
    result.correctIndex = outcome.correctIndex;
    result.explanation = content.questions[position]?.explanation;
    result.isCorrect = outcome.correct === true;
  }
  return result;
}

export const app = express();
app.disable('x-powered-by');

// Requests carry a bearer token, never cookies, so any origin may call the API without CSRF risk.
// The long max-age spares phones a preflight round trip before each request.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Access-Control-Max-Age', '86400');
    res.status(204).end();
    return;
  }
  next();
});

app.use(express.json({ limit: '32kb' }));
app.use(async (_req, _res, next) => {
  await ensureSeeded();
  next();
});

app.get('/me', requireUser, async (_req, res) => {
  const uid = uidOf(res);
  res.json(meView(uid, await loadOrCreateUser(uid, res.locals.email)));
});

app.patch('/me', requireUser, async (req, res) => {
  const uid = uidOf(res);
  const user = await loadOrCreateUser(uid, res.locals.email);
  const changes: Partial<UserDoc> = {};
  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim();
    if (name.length < 2 || name.length > 80) throw fieldError('name', 'Enter your name.');
    changes.name = name;
  }
  if (req.body?.adultConfirmed === true && !user.adultConfirmedAt) changes.adultConfirmedAt = Date.now();
  if (req.body?.activeExamId !== undefined) {
    const examId = String(req.body.activeExamId);
    if (!user.tracks?.[examId]) throw new HttpError(404, 'not_found', 'You are not preparing for that exam yet.');
    changes.activeExamId = examId;
  }
  await refs.user(uid).set(changes, { merge: true });
  res.json(meView(uid, { ...user, ...changes }));
});

app.post('/tracks', requireUser, async (req, res) => {
  const uid = uidOf(res);
  const exam = getExam(req.body?.examId);
  if (!exam) throw fieldError('examId', 'Choose an exam.');
  const fields = parseTrackFields(req.body);
  const user = await loadOrCreateUser(uid, res.locals.email);
  const track = { ...fields, createdAt: user.tracks?.[exam.id]?.createdAt ?? Date.now() };
  await refs.user(uid).set({ activeExamId: exam.id, tracks: { [exam.id]: track } }, { merge: true });
  res.status(201).json(meView(uid, { ...user, activeExamId: exam.id, tracks: { ...user.tracks, [exam.id]: track } }));
});

app.delete('/tracks/:examId', requireUser, async (req, res) => {
  const uid = uidOf(res);
  const examId = String(req.params.examId);
  const user = await loadOrCreateUser(uid, res.locals.email);
  const tracks = { ...user.tracks };
  delete tracks[examId];
  const activeExamId = user.activeExamId === examId ? (tracksOf({ ...user, tracks })[0]?.examId ?? null) : user.activeExamId;
  // Stats stay in place, so re-adding the exam brings its history back.
  await refs.user(uid).update({ [`tracks.${examId}`]: FieldValue.delete(), activeExamId });
  res.json(meView(uid, { ...user, activeExamId, tracks }));
});

app.get('/progress', requireUser, async (req, res) => {
  const examId = req.query.examId ? String(req.query.examId) : null;
  if (examId && !EXAMS.some((e) => e.id === examId)) throw new HttpError(400, 'invalid', 'Unknown exam.');
  const days = Number(req.query.days ?? 30);
  if (![7, 30, 90].includes(days)) throw new HttpError(400, 'invalid', 'Range must be 7, 30 or 90 days.');
  const history = Math.min(Number(req.query.history ?? 20) || 20, 50);
  res.json(await getProgress(uidOf(res), examId, days, history));
});

app.get('/quizzes/active', requireUser, async (_req, res) => {
  const uid = uidOf(res);
  const snap = await refs.quizzes(uid).where('status', '==', 'in_progress').limit(1).get();
  const doc = snap.docs[0];
  if (!doc) {
    res.json(null);
    return;
  }
  const quiz = await loadQuiz(uid, doc.id);
  res.json(quiz.status === 'in_progress' ? toSummary(doc.id, quiz) : null);
});

app.post('/quizzes', requireUser, async (req, res) => {
  const uid = uidOf(res);
  const cfg = parseQuizConfig(req.body ?? {});
  const exam = getExam(cfg.examId)!;

  // Practising for an exam the student hasn't added yet starts tracking it.
  const user = await loadOrCreateUser(uid, res.locals.email);
  const existing = user.tracks?.[cfg.examId];
  await refs.user(uid).set(
    {
      activeExamId: cfg.examId,
      tracks: {
        [cfg.examId]: {
          medium: cfg.medium,
          dailyGoal: existing?.dailyGoal ?? 20,
          examDate: existing?.examDate ?? null,
          createdAt: existing?.createdAt ?? Date.now(),
        },
      },
    },
    { merge: true },
  );

  res.status(200);
  res.set('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.set('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  const send = (event: BuildEvent) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };

  try {
    const built = await buildQuiz(uid, exam, cfg, send, controller.signal);
    send({ type: 'done', quizId: built.id, requested: built.requested, got: built.got, notice: built.notice });
  } catch (error) {
    if (!controller.signal.aborted) {
      const known = error instanceof HttpError;
      if (!known) console.error('[quiz] build failed', error);
      send({
        type: 'error',
        code: known ? error.code : 'unavailable',
        message: known ? error.message : aiMessage('unavailable'),
      });
    }
  }
  res.end();
});

app.get('/quizzes/:id', requireUser, async (req, res) => {
  const uid = uidOf(res);
  const id = String(req.params.id);
  res.json(await quizView(uid, id, await loadQuiz(uid, id)));
});

app.post('/quizzes/:id/answer', requireUser, async (req, res) => {
  res.json(await submitAnswer(uidOf(res), String(req.params.id), req.body ?? {}));
});

app.post('/quizzes/:id/finish', requireUser, async (req, res) => {
  const uid = uidOf(res);
  const id = String(req.params.id);
  await loadQuiz(uid, id);
  await finishQuiz(uid, id);
  res.json(await quizView(uid, id, await loadQuiz(uid, id)));
});

app.post('/quizzes/:id/report', requireUser, async (req, res) => {
  const uid = uidOf(res);
  const id = String(req.params.id);
  const reason = String(req.body?.reason ?? '');
  if (!['wrong_answer', 'wrong_question', 'bad_translation', 'other'].includes(reason)) {
    throw new HttpError(400, 'invalid', 'Choose what is wrong with this question.');
  }
  const position = Number(req.body?.position);
  const quiz = await loadQuiz(uid, id);
  const questionId = quiz.questionIds[position];
  if (!questionId) throw new HttpError(404, 'not_found', 'That question could not be found.');

  const batch = db.batch();
  batch.update(refs.question(questionId), { reportedBy: FieldValue.arrayUnion(uid) });
  batch.set(refs.question(questionId).collection('reports').doc(uid), { reason, at: Date.now() });
  batch.update(refs.quiz(uid, id), { [`answers.${position}.r`]: true });
  await batch.commit();
  res.json({ ok: true });
});

app.use((_req, _res, next) => {
  next(new HttpError(404, 'not_found', 'Not found.'));
});

app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ code: error.code, message: error.message, field: error.field });
    return;
  }
  if (error instanceof SyntaxError) {
    res.status(400).json({ code: 'invalid', message: 'That request could not be read.' });
    return;
  }
  console.error(error);
  res.status(500).json({ code: 'server_error', message: 'Something went wrong on our side. Please try again.' });
});
