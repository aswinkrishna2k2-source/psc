import { useId } from 'react';
import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

type Option<T> = { value: T; label: ReactNode; hint?: ReactNode; lang?: string; icon?: ReactNode };

const baseTile =
  'relative flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border bg-surface px-3.5 py-2 text-[15px] transition-colors duration-150 hover:bg-surface-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand';
const offTile = 'border-control text-ink';
const onTile = 'border-brand bg-brand-soft font-semibold text-ink ring-1 ring-brand hover:bg-brand-soft';

// Real radio inputs underneath, so keyboards and screen readers get native behaviour.
export function RadioTiles<T extends string | number>({
  legend,
  value,
  onChange,
  options,
  layout = 'wrap',
}: {
  legend?: string;
  value: T | null;
  onChange: (value: T) => void;
  options: Option<T>[];
  layout?: 'wrap' | 'cards' | 'stack';
}) {
  const name = useId();
  const container =
    layout === 'cards'
      ? 'grid gap-2.5 sm:grid-cols-2'
      : layout === 'stack'
        ? 'grid gap-2.5'
        : 'flex flex-wrap gap-2';
  return (
    <fieldset className="min-w-0">
      {legend && <legend className="sr-only">{legend}</legend>}
      <div className={container}>
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <label key={String(option.value)} className={`${baseTile} ${checked ? onTile : offTile} ${layout === 'wrap' ? '' : 'items-start py-3'}`}>
              <input
                type="radio"
                name={name}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {option.icon && <span aria-hidden className="mt-0.5 shrink-0 text-brand">{option.icon}</span>}
              <span className="min-w-0 flex-1">
                <span lang={option.lang} className="block">{option.label}</span>
                {option.hint && <span className="mt-0.5 block text-sm font-normal text-ink-3">{option.hint}</span>}
              </span>
              {checked && <Check aria-hidden className="size-4 shrink-0 text-brand" />}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function CheckChips({
  legend,
  values,
  onToggle,
  options,
  allLabel,
  onAll,
}: {
  legend: string;
  values: string[];
  onToggle: (value: string) => void;
  options: { value: string; label: string }[];
  allLabel: string;
  onAll: () => void;
}) {
  const allOn = values.length === 0;
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        <label className={`${baseTile} ${allOn ? onTile : offTile}`}>
          <input type="checkbox" checked={allOn} onChange={onAll} className="sr-only" />
          {allOn && <Check aria-hidden className="size-4 shrink-0 text-brand" />}
          {allLabel}
        </label>
        {options.map((option) => {
          const checked = values.includes(option.value);
          return (
            <label key={option.value} className={`${baseTile} ${checked ? onTile : offTile}`}>
              <input type="checkbox" checked={checked} onChange={() => onToggle(option.value)} className="sr-only" />
              {checked && <Check aria-hidden className="size-4 shrink-0 text-brand" />}
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
