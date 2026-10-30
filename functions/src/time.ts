import { config } from './config.ts';

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// The calendar day (YYYY-MM-DD) in the app's timezone, so "today" follows the student's clock.
export const dayOf = (ms: number = Date.now()) => dayFormat.format(ms);

export function addDays(day: string, delta: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

export type Streak = { lastDay: string | null; streak: number; best: number };

export function advanceStreak(previous: Streak | undefined, today: string): Streak {
  const lastDay = previous?.lastDay ?? null;
  const best = previous?.best ?? 0;
  if (lastDay === today) return { lastDay, streak: previous?.streak ?? 1, best };
  const streak = lastDay === addDays(today, -1) ? (previous?.streak ?? 0) + 1 : 1;
  return { lastDay: today, streak, best: Math.max(best, streak) };
}

// A streak stays alive until a full day is missed.
export function currentStreak(entry: Streak | undefined, today: string) {
  if (!entry?.lastDay) return 0;
  return entry.lastDay === today || entry.lastDay === addDays(today, -1) ? entry.streak : 0;
}
