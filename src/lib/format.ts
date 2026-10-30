import { getMedium, getSubject } from '../../shared/catalog.ts';
import type { MediumId, QuizKind } from '../../shared/catalog.ts';
import type { QuizConfig, QuizQuestionView } from '../../shared/types.ts';

const asDate = (day: string) => new Date(`${day}T00:00:00`);

export const shortDay = (day: string) =>
  asDate(day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export const longDay = (day: string) =>
  asDate(day).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

export const weekdayLetter = (day: string) => asDate(day).toLocaleDateString('en-IN', { weekday: 'narrow' });

export const monthName = (day: string) => asDate(day).toLocaleDateString('en-IN', { month: 'short' });

export const whenLabel = (ms: number) =>
  new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) +
  ', ' +
  new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

export function clock(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function studyTime(seconds: number) {
  if (seconds < 60) return seconds > 0 ? '< 1 min' : '0 min';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export const accuracy = (correct: number, attempted: number) =>
  attempted > 0 ? Math.round((correct / attempted) * 100) : null;

export function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function daysUntil(day: string) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return Math.round((asDate(day).getTime() - start.getTime()) / 86_400_000);
}

export const KIND_LABELS: Record<QuizKind, string> = {
  subject: 'Subject-wise',
  pyq: 'Previous-year pattern',
  mock: 'Model exam',
  mistakes: 'My mistakes',
};

export function subjectsLabel(subjectIds: string[]) {
  if (subjectIds.length === 0) return 'All subjects';
  if (subjectIds.length === 1) return getSubject(subjectIds[0])?.name ?? 'Subject';
  return `${subjectIds.length} subjects`;
}

export function configTitle(config: QuizConfig) {
  if (config.kind === 'pyq') return `${config.year ?? 'All years'} pattern · ${subjectsLabel(config.subjectIds)}`;
  if (config.kind === 'mock') return `Model exam · ${config.count} questions`;
  if (config.kind === 'mistakes') return `My mistakes · ${subjectsLabel(config.subjectIds)}`;
  return subjectsLabel(config.subjectIds);
}

export const mediumName = (id: MediumId) => getMedium(id)?.name ?? id;

// A question's language can differ from the chosen medium: General English is always in English.
export function questionLang(q: Pick<QuizQuestionView, 'subjectId' | 'medium'>) {
  if (q.subjectId === 'english') return 'en';
  if (q.subjectId === 'regional-language') return q.medium === 'en' ? 'ml' : q.medium;
  return q.medium;
}
