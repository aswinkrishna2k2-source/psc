import { useEffect, useId, useRef } from 'react';
import type { ButtonHTMLAttributes, ComponentProps, InputHTMLAttributes, ReactNode } from 'react';
import { CircleAlert, LoaderCircle, X } from 'lucide-react';
import { Link } from 'react-router';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand-hover',
  secondary: 'border border-control bg-surface text-ink hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  danger: 'border border-bad text-bad hover:bg-bad-soft',
};

export function buttonClass(variant: Variant = 'primary', extra = '') {
  return `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-[15px] font-semibold transition-[background-color,color,transform] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${extra}`;
}

export function Button({
  variant = 'primary',
  loading = false,
  className = '',
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button type={type} className={buttonClass(variant, className)} disabled={disabled || loading} aria-busy={loading} {...props}>
      {loading && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function LinkButton({
  variant = 'primary',
  className = '',
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}

export function Card({ className = '', children, ...props }: ComponentProps<'section'>) {
  return (
    <section className={`rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6 ${className}`} {...props}>
      {children}
    </section>
  );
}

export function Field({
  label,
  error,
  helper,
  children,
  required,
}: {
  label: string;
  error?: string | null;
  helper?: string;
  required?: boolean;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error || helper;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
        {required && <span className="text-bad" aria-hidden> *</span>}
      </label>
      {children({ id, 'aria-describedby': note ? noteId : undefined, 'aria-invalid': error ? true : undefined })}
      {note && (
        <p id={noteId} role={error ? 'alert' : undefined} className={`mt-1.5 flex items-start gap-1.5 text-sm ${error ? 'text-bad' : 'text-ink-3'}`}>
          {error && <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />}
          {note}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  'block min-h-11 w-full rounded-xl border border-control bg-surface px-3.5 py-2 text-base text-ink placeholder:text-ink-3 aria-invalid:border-bad';

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={inputClass} {...props} />;
}

export function Alert({
  tone = 'error',
  title,
  children,
  action,
}: {
  tone?: 'error' | 'info';
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const colors = tone === 'error' ? 'border-bad/40 bg-bad-soft' : 'border-gold-mark/50 bg-gold-soft';
  const iconColor = tone === 'error' ? 'text-bad' : 'text-gold';
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${colors}`}>
      <CircleAlert aria-hidden className={`mt-0.5 size-5 shrink-0 ${iconColor}`} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold text-ink">{title}</p>}
        <div className="text-ink-2">{children}</div>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert
      title="This could not be loaded"
      action={onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}
    >
      {message}
    </Alert>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand" aria-hidden>
        {icon}
      </div>
      <p className="font-semibold text-ink">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-ink-3">{children}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="space-y-4">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-44 w-full" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    </div>
  );
}

export function FullPageLoader() {
  return (
    <div role="status" aria-label="Loading" className="flex min-h-dvh items-center justify-center">
      <LoaderCircle aria-hidden className="size-7 animate-spin text-brand" />
    </div>
  );
}

export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className="h-2 overflow-hidden rounded-full bg-surface-2"
    >
      <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${percent}%` }} />
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  sheetOnMobile = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  sheetOnMobile?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={`w-full ${sheetOnMobile ? 'mb-0 max-w-full sm:mb-auto sm:max-w-lg' : 'sm:max-w-lg'}`}
    >
      {open && (
        <div className={`max-h-[85dvh] overflow-y-auto bg-surface p-5 shadow-raised sm:rounded-2xl sm:p-6 ${sheetOnMobile ? 'rounded-t-2xl' : 'rounded-2xl'}`}>
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-lg">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 -mt-2 flex size-11 shrink-0 items-center justify-center rounded-xl text-ink-2 hover:bg-surface-2"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-ink-2">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
