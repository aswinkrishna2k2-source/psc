import type { Difficulty, DifficultyChoice, MediumId, QuizKind, QuizMode } from './catalog.ts';

export type QuestionSource = 'sample' | 'ai' | 'pyq';

export type QuizConfig = {
  examId: string;
  medium: MediumId;
  kind: QuizKind;
  mode: QuizMode;
  subjectIds: string[]; // empty means the whole syllabus
  topic: string | null;
  year: number | null; // previous-year pattern sets only; null means all years
  difficulty: DifficultyChoice;
  count: number;
};

export type Track = {
  examId: string;
  medium: MediumId;
  dailyGoal: number;
  examDate: string | null;
};

export type Me = {
  user: { id: string; name: string; email: string; activeExamId: string | null } | null;
  tracks: Track[];
  ai: { configured: boolean };
};

export type QuizQuestionView = {
  position: number;
  questionId: string;
  subjectId: string;
  topic: string | null;
  difficulty: Difficulty;
  source: QuestionSource;
  year: number | null;
  medium: MediumId;
  question: string;
  options: string[];
  selectedIndex: number | null;
  flagged: boolean;
  reported: boolean;
  // Present only once the answer may be shown.
  correctIndex?: number;
  explanation?: string;
  isCorrect?: boolean;
};

export type QuizResult = {
  correct: number;
  wrong: number;
  skipped: number;
  score: number;
};

export type QuizView = {
  id: string;
  config: QuizConfig;
  status: 'in_progress' | 'finished';
  startedAt: number;
  finishedAt: number | null;
  timeLimitSec: number | null;
  remainingSec: number | null;
  result: QuizResult | null;
  questions: QuizQuestionView[];
};

export type AnswerResult = {
  position: number;
  selectedIndex: number | null;
  flagged: boolean;
  correctIndex?: number;
  explanation?: string;
  isCorrect?: boolean;
};

export type QuizSummary = {
  id: string;
  config: QuizConfig;
  status: 'in_progress' | 'finished';
  startedAt: number;
  total: number;
  answered: number;
  remainingSec: number | null;
  result: QuizResult | null;
};

export type BuildEvent =
  | { type: 'progress'; stage: 'bank' | 'ai'; ready: number; total: number }
  | { type: 'done'; quizId: string; requested: number; got: number; notice: string | null }
  | { type: 'error'; code: string; message: string };

export type DayStat = { day: string; attempted: number; correct: number };

export type SubjectStat = { subjectId: string; attempted: number; correct: number };

export type ProgressView = {
  examId: string | null;
  days: number;
  today: { day: string; attempted: number; correct: number; goal: number | null };
  streak: { current: number; best: number };
  range: { attempted: number; correct: number; seconds: number; activeDays: number };
  allTime: { attempted: number; correct: number };
  daily: DayStat[];
  heatmap: DayStat[];
  subjects: SubjectStat[];
  history: QuizSummary[];
};
