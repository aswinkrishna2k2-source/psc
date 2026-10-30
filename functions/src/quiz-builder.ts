import { getSubject, NEGATIVE_MARK, SECONDS_PER_QUESTION } from '../../shared/catalog.ts';
import type { Exam } from '../../shared/catalog.ts';
import type { BuildEvent, QuizConfig } from '../../shared/types.ts';
import { config } from './config.ts';
import { db, FieldValue, poolId, refs } from './firestore.ts';
import type { QuestionDoc, QuizContentDoc, QuizDoc, StoredQuestion, SummaryDoc } from './firestore.ts';
import { GeminiError, generateQuestions, geminiConfigured, questionId } from './gemini.ts';
import type { CleanQuestion, GenerateSpec, ModelPolicy } from './gemini.ts';
import { HttpError } from './http.ts';
import { recordAnswers } from './stats.ts';
import type { AnswerStat } from './stats.ts';
import { dayOf } from './time.ts';

const BATCH_SIZE = 10;
const MAX_PARALLEL = 3;
const REPORTS_TO_HIDE = 3;
const AVOID_LIST_SIZE = 30;
const MIN_CANDIDATES = 40;
const PRIMARY_COOLDOWN_MS = 5 * 60 * 1000;

export type Slot = { subjectId: string; count: number };

// Splits the question count across subjects in proportion to syllabus weight.
export function planSlots(exam: Exam, cfg: Pick<QuizConfig, 'subjectIds' | 'count'>): Slot[] {
  const chosen = cfg.subjectIds.length
    ? exam.syllabus.filter((s) => cfg.subjectIds.includes(s.subjectId))
    : exam.syllabus;
  const totalWeight = chosen.reduce((sum, s) => sum + s.weight, 0);
  const shares = chosen.map((s) => {
    const exact = (s.weight / totalWeight) * cfg.count;
    return { subjectId: s.subjectId, count: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let left = cfg.count - shares.reduce((sum, s) => sum + s.count, 0);
  for (const share of [...shares].sort((a, b) => b.remainder - a.remainder)) {
    if (left-- <= 0) break;
    share.count += 1;
  }
  return shares.filter((s) => s.count > 0).map(({ subjectId, count }) => ({ subjectId, count }));
}

// Starts at a random point in the pool and wraps around, which samples without a full scan.
async function loadPool(pool: string, want: number): Promise<StoredQuestion[]> {
  const start = Math.random();
  const collection = refs.questions().where('pool', '==', pool).orderBy('rand');
  const first = await collection.startAt(start).limit(want).get();
  const docs = [...first.docs];
  if (docs.length < want) {
    const wrapped = await collection.endBefore(start).limit(want - docs.length).get();
    docs.push(...wrapped.docs);
  }
  return docs.map((doc) => ({ ...(doc.data() as QuestionDoc), id: doc.id }));
}

function matchesConfig(q: StoredQuestion, cfg: QuizConfig, uid: string) {
  if (cfg.kind === 'pyq' && (q.source !== 'pyq' || (cfg.year && q.year !== cfg.year))) return false;
  if (cfg.kind === 'subject' && q.source === 'pyq') return false;
  if (cfg.difficulty !== 'mixed' && q.difficulty !== cfg.difficulty) return false;
  if (cfg.topic && q.topic !== cfg.topic) return false;
  const reports = q.reportedBy ?? [];
  return reports.length < REPORTS_TO_HIDE && !reports.includes(uid);
}

type SlotPlan = Slot & { fresh: StoredQuestion[]; repeats: StoredQuestion[]; stems: string[] };

async function planFromBank(uid: string, exam: Exam, cfg: QuizConfig, slot: Slot, seenSets: Map<string, Set<string>>): Promise<SlotPlan> {
  const pools = [poolId(exam.level, slot.subjectId, cfg.medium), poolId('any', slot.subjectId, cfg.medium)];
  const want = Math.max(MIN_CANDIDATES, slot.count * 3);
  const loaded = (await Promise.all(pools.map((pool) => loadPool(pool, want)))).flat();
  const matching = loaded.filter((q) => matchesConfig(q, cfg, uid));
  const isSeen = (q: StoredQuestion) => seenSets.get(q.pool)?.has(q.id) ?? false;
  // A question written for this exam fits best; others at the same level still count.
  const ranked = [...matching].sort((a, b) => Number(b.examId === exam.id) - Number(a.examId === exam.id));
  return {
    ...slot,
    fresh: ranked.filter((q) => !isSeen(q)),
    repeats: ranked.filter(isSeen),
    stems: loaded.slice(0, AVOID_LIST_SIZE).map((q) => q.question.slice(0, 110)),
  };
}

async function saveGenerated(questions: CleanQuestion[], spec: GenerateSpec) {
  const saved = await Promise.all(
    questions.map(async (q): Promise<StoredQuestion | null> => {
      const id = questionId(spec.medium, q.question);
      const doc: QuestionDoc = {
        pool: poolId(spec.exam.level, spec.subject.id, spec.medium),
        rand: Math.random(),
        source: spec.pyq ? 'pyq' : 'ai',
        examId: spec.exam.id,
        level: spec.exam.level,
        subjectId: spec.subject.id,
        topic: q.topic,
        medium: spec.medium,
        difficulty: q.difficulty,
        year: spec.pyq ? spec.year : null,
        question: q.question,
        options: q.options,
        correctIndex: q.correctIndex,
        explanation: q.explanation,
        reportedBy: [],
        createdAt: Date.now(),
      };
      try {
        await refs.question(id).create(doc);
        return { ...doc, id };
      } catch (error) {
        // Already in the bank (gRPC ALREADY_EXISTS), so it cannot count as a new question.
        if ((error as { code?: number }).code === 6) return null;
        throw error;
      }
    }),
  );
  return saved.filter((q): q is StoredQuestion => q !== null);
}

async function runPool(tasks: (() => Promise<void>)[], limit: number) {
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      await task();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

const AI_MESSAGES: Record<string, () => string> = {
  no_key: () => (config.showSetupHints ? 'Gemini is not set up. Add PSC_GEMINI_API_KEY to functions/.secret.local, then restart.' : 'New questions cannot be written right now.'),
  bad_key: () => (config.showSetupHints ? 'Gemini rejected the API key. Check PSC_GEMINI_API_KEY in functions/.secret.local.' : 'New questions cannot be written right now.'),
  bad_model: () => (config.showSetupHints ? 'Gemini does not recognise the configured model. Check GEMINI_MODEL.' : 'New questions cannot be written right now.'),
  quota: () => 'Gemini has hit its rate limit. Wait a minute and try again, or choose fewer questions.',
  unavailable: () => 'Gemini is very busy right now. Try again in a minute.',
  bad_output: () => 'Gemini returned questions that could not be used. Try again.',
  bad_request: () => 'Gemini could not process this request. Try a different selection.',
  limit: () => "Today's limit for newly written questions has been reached. Questions already in the bank are still available.",
};

export const aiMessage = (code: string) => (AI_MESSAGES[code] ?? AI_MESSAGES.bad_request)();

async function aiAllowance(uid: string) {
  const usage = (await refs.aiUsage(dayOf()).get()).data() as { total?: number; users?: Record<string, number> } | undefined;
  return Math.max(
    0,
    Math.min(
      config.dailyAiLimitPerUser - (usage?.users?.[uid] ?? 0),
      config.dailyAiLimitTotal - (usage?.total ?? 0),
    ),
  );
}

function recordAiUsage(uid: string, questions: number) {
  return refs.aiUsage(dayOf()).set(
    { total: FieldValue.increment(questions), users: { [uid]: FieldValue.increment(questions) } },
    { merge: true },
  );
}

// Remembered across instances, so a cold start doesn't wait out a timeout on an overloaded model.
async function loadModelPolicy(): Promise<ModelPolicy> {
  const blockedUntil = ((await refs.meta('gemini').get()).data()?.primaryBlockedUntil as number | undefined) ?? 0;
  return {
    skipPrimary: Date.now() < blockedUntil,
    onPrimaryDown: () => {
      refs.meta('gemini').set({ primaryBlockedUntil: Date.now() + PRIMARY_COOLDOWN_MS }, { merge: true }).catch(console.error);
    },
  };
}

type Progress = (event: Extract<BuildEvent, { type: 'progress' }>) => void;

async function fillWithGemini(
  uid: string,
  exam: Exam,
  cfg: QuizConfig,
  plans: SlotPlan[],
  picked: Map<string, StoredQuestion>,
  onProgress: Progress,
  clientSignal: AbortSignal,
): Promise<string | null> {
  if (!geminiConfigured()) return 'no_key';

  let allowance = await aiAllowance(uid);
  if (allowance <= 0) return 'limit';

  const policy = await loadModelPolicy();
  // Stops before the function's own time limit, so what was written still becomes a session.
  const signal = AbortSignal.any([clientSignal, AbortSignal.timeout(config.buildDeadlineMs)]);
  let failure: string | null = null;

  const generateFor = async (plan: SlotPlan, count: number) => {
    const subject = getSubject(plan.subjectId);
    if (!subject) return;
    const spec: GenerateSpec = {
      exam,
      subject,
      topic: cfg.topic,
      medium: cfg.medium,
      difficulty: cfg.difficulty,
      pyq: cfg.kind === 'pyq',
      year: cfg.year,
      count,
      avoid: plan.stems,
    };
    const questions = await generateQuestions(spec, policy, signal);
    const saved = await saveGenerated(questions, spec);
    await recordAiUsage(uid, saved.length);
    saved.slice(0, count).forEach((q) => picked.set(q.id, q));
    plan.stems.push(...saved.map((q) => q.question.slice(0, 110)));
    onProgress({ type: 'progress', stage: 'ai', ready: Math.min(picked.size, cfg.count), total: cfg.count });
  };

  const missingFor = (plan: SlotPlan) =>
    plan.count - [...picked.values()].filter((q) => q.subjectId === plan.subjectId).length;

  // Gemini sometimes repeats a question already in the bank, so a second round tops up the gap.
  for (let round = 0; round < 2 && !failure; round++) {
    const tasks: (() => Promise<void>)[] = [];
    for (const plan of plans) {
      let left = Math.min(Math.max(0, missingFor(plan)), allowance);
      allowance -= left;
      for (; left > 0; left -= BATCH_SIZE) {
        const size = Math.min(left, BATCH_SIZE);
        tasks.push(async () => {
          try {
            await generateFor(plan, size);
          } catch (error) {
            if (clientSignal.aborted) throw error;
            failure = error instanceof GeminiError ? error.code : 'unavailable';
            console.error(`[gemini] ${failure}: ${(error as Error).message}`);
          }
        });
      }
    }
    if (tasks.length === 0) break;
    await runPool(tasks, MAX_PARALLEL);
  }
  return failure;
}

async function mistakeQuestions(uid: string, cfg: QuizConfig) {
  const snap = await refs.mistakes(uid).where('examId', '==', cfg.examId).where('medium', '==', cfg.medium).limit(200).get();
  const ids = snap.docs
    .filter((doc) => !cfg.subjectIds.length || cfg.subjectIds.includes(doc.data().subjectId))
    .map((doc) => doc.id);
  const chosen = shuffled(ids).slice(0, cfg.count);
  if (chosen.length === 0) return [];
  const docs = await db.getAll(...chosen.map((id) => refs.question(id)));
  return docs.filter((doc) => doc.exists).map((doc) => ({ ...(doc.data() as QuestionDoc), id: doc.id }));
}

function shuffled<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export async function buildQuiz(uid: string, exam: Exam, cfg: QuizConfig, onProgress: Progress, signal: AbortSignal) {
  const picked = new Map<string, StoredQuestion>();
  let aiFailure: string | null = null;

  if (cfg.kind === 'mistakes') {
    (await mistakeQuestions(uid, cfg)).forEach((q) => picked.set(q.id, q));
    if (picked.size === 0) {
      throw new HttpError(404, 'no_mistakes', 'No mistakes to revise yet for this exam and medium. Wrong answers will collect here.');
    }
  } else {
    const slots = planSlots(exam, cfg);
    const pools = slots.flatMap((slot) => [poolId(exam.level, slot.subjectId, cfg.medium), poolId('any', slot.subjectId, cfg.medium)]);
    const seenDocs = await db.getAll(...pools.map((pool) => refs.seen(uid, pool)));
    const seenSets = new Map(pools.map((pool, i) => [pool, new Set<string>((seenDocs[i].data()?.ids as string[] | undefined) ?? [])]));

    const plans = await Promise.all(slots.map((slot) => planFromBank(uid, exam, cfg, slot, seenSets)));
    for (const plan of plans) plan.fresh.slice(0, plan.count).forEach((q) => picked.set(q.id, q));
    onProgress({ type: 'progress', stage: 'bank', ready: picked.size, total: cfg.count });

    if (picked.size < cfg.count) {
      aiFailure = await fillWithGemini(uid, exam, cfg, plans, picked, onProgress, signal);

      // Better to repeat a question than to stop the student practising.
      for (const plan of plans) {
        for (const q of [...plan.fresh, ...plan.repeats]) {
          if (picked.size >= cfg.count) break;
          picked.set(q.id, q);
        }
      }
    }
  }

  if (picked.size === 0) {
    const message = aiFailure ? aiMessage(aiFailure) : 'No questions are available for this selection yet.';
    throw new HttpError(503, aiFailure ?? 'no_questions', message);
  }

  const questions = shuffled([...picked.values()]).slice(0, cfg.count);
  const quizRef = refs.quizzes(uid).doc();

  const open = await refs.quizzes(uid).where('status', '==', 'in_progress').get();
  // Only one session runs at a time, so an older unfinished one is scored as it stands.
  await Promise.all(open.docs.map((doc) => finishQuiz(uid, doc.id)));

  const quiz: QuizDoc = {
    config: cfg,
    examId: cfg.examId,
    status: 'in_progress',
    startedAt: Date.now(),
    finishedAt: null,
    timeLimitSec: cfg.mode === 'test' ? questions.length * SECONDS_PER_QUESTION : null,
    total: questions.length,
    answered: 0,
    questionIds: questions.map((q) => q.id),
    subjects: questions.map((q) => q.subjectId),
    key: questions.map((q) => q.correctIndex),
    answers: {},
    result: null,
  };
  const content: QuizContentDoc = {
    questions: questions.map((q) => ({
      id: q.id,
      source: q.source,
      subjectId: q.subjectId,
      topic: q.topic,
      medium: q.medium,
      difficulty: q.difficulty,
      year: q.year,
      question: q.question,
      options: q.options,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
    })),
  };

  const batch = db.batch();
  batch.set(quizRef, quiz);
  batch.set(refs.quizContent(uid, quizRef.id), content);
  const idsByPool = new Map<string, string[]>();
  for (const q of questions) idsByPool.set(q.pool, [...(idsByPool.get(q.pool) ?? []), q.id]);
  for (const [pool, ids] of idsByPool) {
    batch.set(refs.seen(uid, pool), { ids: FieldValue.arrayUnion(...ids) }, { merge: true });
  }
  await batch.commit();

  let notice: string | null = null;
  if (questions.length < cfg.count) {
    notice = `Only ${questions.length} of ${cfg.count} questions were available.${aiFailure ? ` ${aiMessage(aiFailure)}` : ''}`;
  }
  return { id: quizRef.id, requested: cfg.count, got: questions.length, notice };
}

export async function finishQuiz(uid: string, quizId: string) {
  const ref = refs.quiz(uid, quizId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const quiz = snap.data() as QuizDoc | undefined;
    if (!quiz || quiz.status === 'finished') return;

    const isTest = quiz.config.mode === 'test';
    const summary = isTest ? ((await tx.get(refs.summary(uid))).data() as SummaryDoc | undefined) : undefined;

    let correct = 0;
    let wrong = 0;
    const items: AnswerStat[] = [];
    for (let i = 0; i < quiz.total; i++) {
      const answer = quiz.answers[i];
      if (answer?.s === null || answer?.s === undefined) continue;
      if (answer.c) correct += 1;
      else wrong += 1;
      items.push({
        examId: quiz.examId,
        subjectId: quiz.subjects[i],
        questionId: quiz.questionIds[i],
        medium: quiz.config.medium,
        correct: Boolean(answer.c),
        ms: answer.t ?? 0,
      });
    }

    // Practice answers were counted as they were given. Test answers can change until now.
    if (isTest) recordAnswers(tx, uid, items, summary);

    const score = isTest ? correct - wrong * NEGATIVE_MARK : correct;
    tx.update(ref, {
      status: 'finished',
      finishedAt: Date.now(),
      result: { correct, wrong, skipped: quiz.total - correct - wrong, score: Math.round(score * 100) / 100 },
    });
  });
}
