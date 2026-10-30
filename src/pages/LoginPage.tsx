import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '../components/ui.tsx';
import { usesEmulators } from '../lib/firebase.ts';
import { normalisePhone } from '../lib/phone.ts';
import { useSession } from '../lib/session.tsx';

const CODE_LENGTH = 6;

// A row from an OMR sheet with one bubble shaded in. Purely decorative.
const OMR_ROWS = [1, 3, 0, 2];

function OmrStrip() {
  return (
    <div aria-hidden className="flex flex-col gap-2.5">
      {OMR_ROWS.map((filled, row) => (
        <div key={row} className="flex items-center gap-2.5">
          <span className="w-4 text-right text-xs tabular-nums text-on-band/60">{row + 1}</span>
          {['A', 'B', 'C', 'D'].map((letter, column) => (
            <span
              key={letter}
              className={`flex size-7 items-center justify-center rounded-full border text-xs font-medium ${
                column === filled ? 'border-band-gold bg-band-gold text-band' : 'border-on-band/35 text-on-band/70'
              }`}
            >
              {letter}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

// Firebase does not say which of the two was wrong, so that nobody can find out which numbers have accounts.
const NO_MATCH = 'That number and code don’t match. Check both and try again.';

const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': NO_MATCH,
  'auth/invalid-login-credentials': NO_MATCH,
  'auth/user-not-found': NO_MATCH,
  'auth/wrong-password': NO_MATCH,
  'auth/invalid-email': NO_MATCH,
  'auth/too-many-requests': 'Too many wrong tries. Please wait a few minutes and try again.',
  'auth/network-request-failed': 'No connection. Check your internet and try again.',
  'auth/user-disabled': 'This number has been switched off. Ask the person who invited you.',
};

export function LoginPage() {
  const { logIn } = useSession();
  const [number, setNumber] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeBox = useRef<HTMLInputElement>(null);

  // A number typed with its own country code replaces the +91 shown in front.
  const ownCode = number.trim().startsWith('+');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const phone = normalisePhone(number);
    if (!phone) {
      setError('Enter your 10-digit mobile number.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await logIn(phone, code);
    } catch (err) {
      const message = MESSAGES[(err as { code?: string }).code ?? ''];
      if (!message) console.error(err);
      setError(message ?? 'Something went wrong. Please try again.');
      // Empty the box, so the next try starts clean instead of adding to the wrong digits.
      setCode('');
      setBusy(false);
      codeBox.current?.focus();
    }
  };

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-2">
      <div className="bg-band text-on-band lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] font-semibold lg:p-0">
          <img src="/favicon.svg" alt="" width={32} height={32} className="size-8" />
          PSC Practice
        </div>
        <div className="hidden lg:block">
          <p className="max-w-md text-4xl font-semibold leading-tight">Practice the way the exam feels.</p>
          <p className="mt-3 max-w-md text-on-band/85">
            Choose your exam, subject, level and medium. Track what you solve every day, separately for each exam.
          </p>
          <div className="mt-8">
            <OmrStrip />
          </div>
        </div>
        <p className="hidden text-xs text-on-band/70 lg:block">
          Independent practice tool. Not affiliated with the Kerala Public Service Commission.
        </p>
        <div className="kasavu lg:hidden" />
      </div>

      <main className="flex items-start justify-center px-5 py-8 lg:items-center lg:py-12">
        <form onSubmit={submit} noValidate className="rise-in w-full max-w-sm">
          <h1 className="text-2xl">Sign in to PSC Practice</h1>
          <p className="mt-1 text-ink-2">Enter your mobile number and the code you were given.</p>

          <label htmlFor="phone" className="mb-1.5 mt-6 block text-sm font-medium text-ink">Mobile number</label>
          <div className="flex min-h-12 items-center gap-3 rounded-xl border border-control bg-surface px-3.5 text-lg focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand">
            {!ownCode && <span className="select-none text-ink-3">+91</span>}
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="username"
              autoFocus
              value={number}
              onChange={(e) => {
                setNumber(e.target.value);
                setError(null);
              }}
              placeholder="98765 43210"
              maxLength={20}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'login-error' : undefined}
              className="min-w-0 flex-1 bg-transparent py-2 tracking-wide text-ink placeholder:text-ink-3 focus-visible:outline-none"
            />
          </div>

          <label htmlFor="code" className="mb-1.5 mt-4 block text-sm font-medium text-ink">Code</label>
          <input
            id="code"
            ref={codeBox}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH));
              setError(null);
            }}
            placeholder={'•'.repeat(CODE_LENGTH)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'login-error' : undefined}
            className="block min-h-14 w-full rounded-xl border border-control bg-surface px-3.5 text-center text-2xl tracking-[0.5em] text-ink tabular-nums placeholder:text-ink-3"
          />

          <p id="login-error" role="alert" className="mt-2 min-h-5 text-sm text-bad">{error}</p>

          <Button type="submit" loading={busy} disabled={!number.trim() || code.length !== CODE_LENGTH} className="mt-3 w-full">
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>

          <p className="mt-4 text-sm text-ink-2">
            PSC Practice is by invitation for now. If you don’t have a code, ask the person who invited you.
          </p>

          {usesEmulators && (
            <p className="mt-4 rounded-xl border border-dashed border-control px-4 py-3 text-sm text-ink-2">
              Running locally, where any number works: the first code you use with a number becomes its code.
            </p>
          )}

          <p className="pt-4 text-xs text-ink-3 lg:hidden">
            Independent practice tool. Not affiliated with the Kerala Public Service Commission.
          </p>
        </form>
      </main>
    </div>
  );
}
