import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Table2, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { getSubject } from '../../shared/catalog.ts';
import type { DayStat, SubjectStat } from '../../shared/types.ts';
import { accuracy, longDay, monthName, shortDay } from '../lib/format.ts';

export type ColumnPoint = { key: string; label: string; detail: string; correct: number; wrong: number };

export function toColumnPoints(daily: DayStat[], byWeek: boolean): ColumnPoint[] {
  if (!byWeek) {
    return daily.map((d) => ({
      key: d.day,
      label: shortDay(d.day),
      detail: longDay(d.day),
      correct: d.correct,
      wrong: d.attempted - d.correct,
    }));
  }
  const points: ColumnPoint[] = [];
  // Weeks are counted back from today, so the latest column is always a full seven days.
  for (let end = daily.length; end > 0; end -= 7) {
    const week = daily.slice(Math.max(0, end - 7), end);
    const correct = week.reduce((sum, d) => sum + d.correct, 0);
    const attempted = week.reduce((sum, d) => sum + d.attempted, 0);
    points.unshift({
      key: week[0].day,
      label: shortDay(week[0].day),
      detail: `${shortDay(week[0].day)} to ${shortDay(week.at(-1)!.day)}`,
      correct,
      wrong: attempted - correct,
    });
  }
  return points;
}

function niceMax(value: number) {
  const steps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
  return steps.find((step) => step >= value) ?? value;
}

function Legend() {
  return (
    <div className="flex gap-4 text-sm text-ink-2">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="size-2.5 rounded-sm bg-series-1" /> Correct
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="size-2.5 rounded-sm bg-series-2" /> Wrong
      </span>
    </div>
  );
}

export function ActivityColumns({
  points,
  unit,
  heightClass = 'h-44',
  showTableToggle = true,
}: {
  points: ColumnPoint[];
  unit: string;
  heightClass?: string;
  showTableToggle?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState(points.length - 1);
  const [showTable, setShowTable] = useState(false);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const max = niceMax(Math.max(...points.map((p) => p.correct + p.wrong), 1));
  const total = points.reduce((sum, p) => sum + p.correct + p.wrong, 0);

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = Math.min(points.length - 1, Math.max(0, index + delta));
    setFocusIndex(next);
    setActive(next);
    refs.current[next]?.focus();
  };

  const tip = active !== null ? points[active] : null;
  const tipAlign =
    active === null ? '' : active < points.length * 0.25 ? 'translate-x-0' : active > points.length * 0.75 ? '-translate-x-full' : '-translate-x-1/2';

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Legend />
        {showTableToggle && (
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-pressed={showTable}
            className="-my-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-ink-2 hover:bg-surface-2"
          >
            <Table2 aria-hidden className="size-4" />
            {showTable ? 'Show chart' : 'Show table'}
          </button>
        )}
      </div>

      {showTable ? (
        <div className="max-h-80 overflow-y-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <caption className="sr-only">Questions answered per {unit}</caption>
            <thead className="sticky top-0 bg-surface-2 text-left text-ink-2">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">{unit === 'week' ? 'Week' : 'Day'}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Correct</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Wrong</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Accuracy</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[...points].reverse().map((p) => {
                const percent = accuracy(p.correct, p.correct + p.wrong);
                return (
                  <tr key={p.key} className="border-t border-line">
                    <td className="px-3 py-2">{p.detail}</td>
                    <td className="px-3 py-2 text-right">{p.correct}</td>
                    <td className="px-3 py-2 text-right">{p.wrong}</td>
                    <td className="px-3 py-2 text-right">{percent === null ? '–' : `${percent}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div>
          <div className="flex gap-2">
            <div aria-hidden className={`flex w-8 shrink-0 flex-col justify-between text-right text-xs tabular-nums text-ink-3 ${heightClass}`}>
              <span className="-translate-y-1/2">{max}</span>
              <span>{max / 2}</span>
              <span className="translate-y-1/2">0</span>
            </div>
            <div className={`relative min-w-0 flex-1 ${heightClass}`} onPointerLeave={() => setActive(null)}>
              <div aria-hidden className="absolute inset-0 flex flex-col justify-between">
                <div className="border-t border-line" />
                <div className="border-t border-line" />
                <div className="border-t border-control/60" />
              </div>
              <div role="group" aria-label={`${total} questions answered. Use the arrow keys to read each ${unit}.`} className="absolute inset-0 flex items-stretch">
                {points.map((p, i) => {
                  const height = ((p.correct + p.wrong) / max) * 100;
                  const wrongShare = p.correct + p.wrong > 0 ? (p.wrong / (p.correct + p.wrong)) * 100 : 0;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      ref={(el) => {
                        refs.current[i] = el;
                      }}
                      tabIndex={i === focusIndex ? 0 : -1}
                      aria-label={`${p.detail}: ${p.correct} correct, ${p.wrong} wrong`}
                      onPointerEnter={() => setActive(i)}
                      onClick={() => setActive(i)}
                      onFocus={() => setActive(i)}
                      onBlur={() => setActive(null)}
                      onKeyDown={(event) => onKeyDown(event, i)}
                      className={`flex min-w-0 flex-1 cursor-default items-end justify-center rounded-sm px-px ${active === i ? 'bg-surface-2/70' : ''}`}
                    >
                      <span className="flex w-full max-w-6 flex-col gap-0.5" style={{ height: `${height}%` }}>
                        {p.wrong > 0 && (
                          <span className="block min-h-0.5 rounded-t bg-series-2" style={{ height: `${wrongShare}%` }} />
                        )}
                        {p.correct > 0 && (
                          <span className={`block min-h-0.5 flex-1 bg-series-1 ${p.wrong === 0 ? 'rounded-t' : ''}`} />
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>

              {tip && (
                <div
                  aria-hidden
                  className={`pointer-events-none absolute -top-2 z-10 w-max min-w-32 -translate-y-full rounded-lg bg-ink px-3 py-2 text-xs text-paper shadow-raised ${tipAlign}`}
                  style={{ left: `${((active! + 0.5) / points.length) * 100}%` }}
                >
                  <p className="font-semibold">{tip.detail}</p>
                  <p className="tabular-nums">{tip.correct} correct · {tip.wrong} wrong</p>
                </div>
              )}
            </div>
          </div>
          <div aria-hidden className="mt-1.5 ml-10 flex justify-between text-xs tabular-nums text-ink-3">
            <span>{points[0]?.label}</span>
            {points.length > 2 && <span>{points[Math.floor(points.length / 2)].label}</span>}
            <span>{points.at(-1)?.label}</span>
          </div>
        </div>
      )}
    </div>
  );
}

const HEAT_CLASSES = ['bg-surface-2', 'bg-heat-1', 'bg-heat-2', 'bg-heat-3', 'bg-heat-4'];

export function ActivityHeatmap({ days }: { days: DayStat[] }) {
  const [picked, setPicked] = useState<DayStat | null>(null);

  const { cells, months, max, activeCount } = useMemo(() => {
    // Monday-first, so the first column may start part-way down.
    const firstWeekday = (new Date(`${days[0].day}T00:00:00`).getDay() + 6) % 7;
    const grid: (DayStat | null)[] = [...Array<null>(firstWeekday).fill(null), ...days];
    const labels: { column: number; label: string }[] = [];
    grid.forEach((cell, index) => {
      if (cell && cell.day.endsWith('-01')) labels.push({ column: Math.floor(index / 7), label: monthName(cell.day) });
    });
    return {
      cells: grid,
      months: labels,
      max: Math.max(...days.map((d) => d.attempted), 1),
      activeCount: days.filter((d) => d.attempted > 0).length,
    };
  }, [days]);

  const columns = Math.ceil(cells.length / 7);
  const levelOf = (attempted: number) => (attempted === 0 ? 0 : Math.min(4, Math.ceil((attempted / max) * 4)));

  return (
    <div>
      <div
        aria-hidden
        className="mb-1 grid text-xs text-ink-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {months.map((m) => (
          <span key={`${m.label}-${m.column}`} style={{ gridColumnStart: m.column + 1 }}>{m.label}</span>
        ))}
      </div>
      <div
        role="img"
        aria-label={`Active on ${activeCount} of the last ${days.length} days.`}
        className="grid grid-flow-col gap-[3px]"
        style={{ gridTemplateRows: 'repeat(7, minmax(0, 1fr))', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        onPointerLeave={() => setPicked(null)}
      >
        {cells.map((cell, index) =>
          cell ? (
            <span
              key={cell.day}
              onPointerEnter={() => setPicked(cell)}
              onClick={() => setPicked(cell)}
              className={`aspect-square rounded-[3px] ${HEAT_CLASSES[levelOf(cell.attempted)]} ${picked?.day === cell.day ? 'outline-2 outline-ink' : ''}`}
            />
          ) : (
            <span key={`pad-${index}`} />
          ),
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-2">
        <p aria-live="polite" className="min-h-5">
          {picked ? `${longDay(picked.day)}: ${picked.attempted} questions` : `Active on ${activeCount} of ${days.length} days`}
        </p>
        <div aria-hidden className="flex items-center gap-1 text-xs text-ink-3">
          Less
          {HEAT_CLASSES.map((c) => (
            <span key={c} className={`size-3 rounded-[3px] ${c}`} />
          ))}
          More
        </div>
      </div>
    </div>
  );
}

const WEAK_BELOW = 50;

export function sortSubjects(subjects: SubjectStat[]) {
  return [...subjects].sort((a, b) => {
    if (a.attempted === 0 || b.attempted === 0) return b.attempted - a.attempted;
    return a.correct / a.attempted - b.correct / b.attempted;
  });
}

// Every value is printed in its row, so this list doubles as its own table view.
export function SubjectBars({ subjects, linkToPractice = true }: { subjects: SubjectStat[]; linkToPractice?: boolean }) {
  const sorted = useMemo(() => sortSubjects(subjects), [subjects]);
  return (
    <ul className="divide-y divide-line">
      {sorted.map((s) => {
        const percent = accuracy(s.correct, s.attempted);
        const name = getSubject(s.subjectId)?.name ?? s.subjectId;
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 text-[15px] font-medium text-ink">{name}</span>
              <span className="shrink-0 text-sm tabular-nums text-ink-2">
                {percent === null ? 'Not started' : `${percent}% · ${s.attempted} ${s.attempted === 1 ? 'question' : 'questions'}`}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-series-1" style={{ width: `${percent ?? 0}%` }} />
            </div>
            {percent !== null && percent < WEAK_BELOW && s.attempted >= 5 && (
              <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-gold">
                <TriangleAlert aria-hidden className="size-3.5" /> Needs work
              </p>
            )}
          </>
        );
        return (
          <li key={s.subjectId}>
            {linkToPractice ? (
              <Link to={`/practice?subject=${s.subjectId}`} className="-mx-2 block rounded-lg px-2 py-3 transition-colors duration-150 hover:bg-surface-2">
                {body}
              </Link>
            ) : (
              <div className="py-3">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
