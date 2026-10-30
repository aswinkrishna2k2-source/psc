import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import type { Difficulty, MediumId } from '../../shared/catalog.ts';
import type { QuestionSource, QuizConfig, QuizResult } from '../../shared/types.ts';
import type { Streak } from './time.ts';

if (getApps().length === 0) initializeApp();

// PSC keeps its data in its own named database. This project's (default) database belongs to Ceeq Tutor.
export const DATABASE_ID = 'psc-practice';
export const db = getFirestore(DATABASE_ID);
db.settings({ ignoreUndefinedProperties: true });

export const adminAuth = getAuth();
export { FieldValue };

export type UserDoc = {
  name: string;
  email: string;
  activeExamId: string | null;
  adultConfirmedAt: number | null;
  createdAt: number;
  tracks: Record<string, { medium: MediumId; dailyGoal: number; examDate: string | null; createdAt: number }>;
};

export type QuestionDoc = {
  pool: string;
  rand: number;
  source: QuestionSource;
  examId: string | null;
  level: string | null;
  subjectId: string;
  topic: string | null;
  medium: MediumId;
  difficulty: Difficulty;
  year: number | null;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  reportedBy: string[];
  createdAt: number;
};

export type StoredQuestion = QuestionDoc & { id: string };

export type AnswerDoc = {
  s?: number | null; // selected option
  c?: boolean | null; // was it correct
  f?: boolean; // flagged for review
  t?: number; // milliseconds spent
  r?: boolean; // reported by this student
};

// The answer key sits in this document only because the server needs it on every answer.
// Firestore rules deny all browser access, so it never reaches a student unseen.
export type QuizDoc = {
  config: QuizConfig;
  examId: string;
  status: 'in_progress' | 'finished';
  startedAt: number;
  finishedAt: number | null;
  timeLimitSec: number | null;
  total: number;
  answered: number;
  questionIds: string[];
  subjects: string[];
  key: number[];
  answers: Record<string, AnswerDoc>;
  result: QuizResult | null;
};

export type QuizContentDoc = {
  questions: Omit<StoredQuestion, 'pool' | 'rand' | 'reportedBy' | 'createdAt' | 'examId' | 'level'>[];
};

export type ExamDayStat = { a: number; c: number; ms: number; s: Record<string, { a: number; c: number }> };
export type MonthDoc = { days: Record<string, Record<string, ExamDayStat>> };
export type SummaryEntry = Streak & { a: number; c: number };
export type SummaryDoc = { all?: SummaryEntry; exams?: Record<string, SummaryEntry> };

export const refs = {
  user: (uid: string) => db.doc(`users/${uid}`),
  quizzes: (uid: string) => db.collection(`users/${uid}/quizzes`),
  quiz: (uid: string, id: string) => db.doc(`users/${uid}/quizzes/${id}`),
  quizContent: (uid: string, id: string) => db.doc(`users/${uid}/quizzes/${id}/private/content`),
  seen: (uid: string, pool: string) => db.doc(`users/${uid}/seen/${pool}`),
  mistakes: (uid: string) => db.collection(`users/${uid}/mistakes`),
  mistake: (uid: string, questionId: string) => db.doc(`users/${uid}/mistakes/${questionId}`),
  month: (uid: string, month: string) => db.doc(`users/${uid}/stats/${month}`),
  summary: (uid: string) => db.doc(`users/${uid}/stats/summary`),
  questions: () => db.collection('questions'),
  question: (id: string) => db.doc(`questions/${id}`),
  aiUsage: (day: string) => db.doc(`aiUsage/${day}`),
  meta: (key: string) => db.doc(`meta/${key}`),
};

// Questions are grouped into pools so one composite index (pool, rand) serves every lookup.
export const poolId = (level: string, subjectId: string, medium: string) => `${level}_${subjectId}_${medium}`;
