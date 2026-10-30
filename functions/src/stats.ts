import type { Transaction } from 'firebase-admin/firestore';
import { getExam } from '../../shared/catalog.ts';
import type { DayStat, ProgressView, QuizSummary, SubjectStat } from '../../shared/types.ts';
import { db, FieldValue, refs } from './firestore.ts';
import type { MonthDoc, QuizDoc, SummaryDoc, SummaryEntry } from './firestore.ts';
import { addDays, advanceStreak, currentStreak, dayOf } from './time.ts';

const HEATMAP_DAYS = 112; // 16 weeks

export type AnswerStat = {
  examId: string;
  subjectId: string;
  questionId: string;
  medium: string;
  correct: boolean;
  ms: number;
};

const increment = (n: number) => FieldValue.increment(n);

function nextEntry(previous: SummaryEntry | undefined, today: string, attempted: number, correct: number) {
  return {
    ...advanceStreak(previous, today),
    a: increment(attempted),
    c: increment(correct),
  };
}

// Writes rolled-up stats instead of scanning answers later, so the dashboard costs a few reads.
// `summary` must have been read in the same transaction.
export function recordAnswers(tx: Transaction, uid: string, items: AnswerStat[], summary: SummaryDoc | undefined) {
  if (items.length === 0) return;
  const today = dayOf();
  const dayEntry: Record<string, unknown> = {};
  const examEntries: Record<string, unknown> = {};

  for (const examId of new Set(items.map((item) => item.examId))) {
    const forExam = items.filter((item) => item.examId === examId);
    const correct = forExam.filter((item) => item.correct).length;
    const subjects: Record<string, unknown> = {};
    for (const subjectId of new Set(forExam.map((item) => item.subjectId))) {
      const forSubject = forExam.filter((item) => item.subjectId === subjectId);
      subjects[subjectId] = {
        a: increment(forSubject.length),
        c: increment(forSubject.filter((item) => item.correct).length),
      };
    }
    dayEntry[examId] = {
      a: increment(forExam.length),
      c: increment(correct),
      ms: increment(forExam.reduce((sum, item) => sum + item.ms, 0)),
      s: subjects,
    };
    examEntries[examId] = nextEntry(summary?.exams?.[examId], today, forExam.length, correct);
  }

  tx.set(refs.month(uid, today.slice(0, 7)), { days: { [today]: dayEntry } }, { merge: true });
  tx.set(
    refs.summary(uid),
    {
      all: nextEntry(summary?.all, today, items.length, items.filter((item) => item.correct).length),
      exams: examEntries,
    },
    { merge: true },
  );

  for (const item of items) {
    const ref = refs.mistake(uid, item.questionId);
    if (item.correct) {
      tx.delete(ref);
    } else {
      tx.set(ref, { examId: item.examId, medium: item.medium, subjectId: item.subjectId, at: Date.now() });
    }
  }
}

export function remainingSeconds(quiz: Pick<QuizDoc, 'startedAt' | 'timeLimitSec' | 'status'>) {
  if (quiz.timeLimitSec === null || quiz.status === 'finished') return null;
  return Math.max(0, Math.round(quiz.timeLimitSec - (Date.now() - quiz.startedAt) / 1000));
}

export function toSummary(id: string, quiz: QuizDoc): QuizSummary {
  return {
    id,
    config: quiz.config,
    status: quiz.status,
    startedAt: quiz.startedAt,
    total: quiz.total,
    answered: quiz.answered,
    remainingSec: remainingSeconds(quiz),
    result: quiz.result,
  };
}

export async function getProgress(uid: string, examId: string | null, days: number, historyLimit: number): Promise<ProgressView> {
  const today = dayOf();
  const heatmapStart = addDays(today, -(HEATMAP_DAYS - 1));

  const months = new Set<string>();
  for (let day = heatmapStart; day <= today; day = addDays(day, 1)) months.add(day.slice(0, 7));

  const historyQuery = examId
    ? refs.quizzes(uid).where('examId', '==', examId).orderBy('startedAt', 'desc').limit(historyLimit)
    : refs.quizzes(uid).orderBy('startedAt', 'desc').limit(historyLimit);

  const [statDocs, historySnap, userSnap] = await Promise.all([
    db.getAll(refs.summary(uid), ...[...months].map((month) => refs.month(uid, month))),
    historyQuery.get(),
    refs.user(uid).get(),
  ]);

  const summary = statDocs[0].data() as SummaryDoc | undefined;
  const allDays: MonthDoc['days'] = {};
  for (const snap of statDocs.slice(1)) Object.assign(allDays, (snap.data() as MonthDoc | undefined)?.days);

  const heatmap: DayStat[] = [];
  const subjectTotals = new Map<string, { attempted: number; correct: number }>();
  const rangeStart = addDays(today, -(days - 1));
  let seconds = 0;

  for (let day = heatmapStart; day <= today; day = addDays(day, 1)) {
    const entries = allDays[day] ?? {};
    const relevant = examId ? (entries[examId] ? [entries[examId]] : []) : Object.values(entries);
    heatmap.push({
      day,
      attempted: relevant.reduce((sum, e) => sum + (e.a ?? 0), 0),
      correct: relevant.reduce((sum, e) => sum + (e.c ?? 0), 0),
    });
    if (day >= rangeStart) {
      for (const entry of relevant) {
        seconds += (entry.ms ?? 0) / 1000;
        for (const [subjectId, stat] of Object.entries(entry.s ?? {})) {
          const total = subjectTotals.get(subjectId) ?? { attempted: 0, correct: 0 };
          total.attempted += stat.a ?? 0;
          total.correct += stat.c ?? 0;
          subjectTotals.set(subjectId, total);
        }
      }
    }
  }

  const daily = heatmap.slice(-days);
  // Show the whole syllabus so untouched subjects stay visible.
  for (const entry of getExam(examId)?.syllabus ?? []) {
    if (!subjectTotals.has(entry.subjectId)) subjectTotals.set(entry.subjectId, { attempted: 0, correct: 0 });
  }
  const subjects: SubjectStat[] = [...subjectTotals].map(([subjectId, stat]) => ({ subjectId, ...stat }));

  const entry = examId ? summary?.exams?.[examId] : summary?.all;
  const todayStat = daily.at(-1)!;
  const goal = examId ? (userSnap.data()?.tracks?.[examId]?.dailyGoal ?? null) : null;

  return {
    examId,
    days,
    today: { day: today, attempted: todayStat.attempted, correct: todayStat.correct, goal },
    streak: { current: currentStreak(entry, today), best: entry?.best ?? 0 },
    range: {
      attempted: daily.reduce((sum, d) => sum + d.attempted, 0),
      correct: daily.reduce((sum, d) => sum + d.correct, 0),
      seconds: Math.round(seconds),
      activeDays: daily.filter((d) => d.attempted > 0).length,
    },
    allTime: { attempted: entry?.a ?? 0, correct: entry?.c ?? 0 },
    daily,
    heatmap,
    subjects,
    history: historySnap.docs.map((doc) => toSummary(doc.id, doc.data() as QuizDoc)),
  };
}
