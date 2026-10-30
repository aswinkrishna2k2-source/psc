// Mobile numbers and login names, kept the same as Ceeq Tutor (apps/tutor-web/lib/phone.ts) because
// both apps share this Firebase project's login list. A number typed in either app must lead to the
// same account, so changing the format here would cut students off from their accounts.

/** The number in international form (+919876543210), or null if it cannot be one. */
export function normalisePhone(input: string): string | null {
  const text = input.trim();
  const digits = text.replace(/\D/g, '');
  if (text.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  // 98765 43210, 098765 43210 and 91 98765 43210 are all the same Indian mobile.
  const local = digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}

/** For showing a number back to the student: "+91 98765 43210". Other countries are left as they are. */
export function formatPhone(phone: string): string {
  const indian = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return indian ? `+91 ${indian[1]} ${indian[2]}` : phone;
}

const ACCOUNT_DOMAIN = 'ceeq.student';

/** The name of the account for a number in international form: "+919876543210" becomes "9876543210@ceeq.student". */
export function accountName(phone: string): string {
  const indian = /^\+91([6-9]\d{9})$/.exec(phone);
  return `${indian ? indian[1] : `00${phone.replace(/\D/g, '')}`}@${ACCOUNT_DOMAIN}`;
}

/** The number an account name stands for, in international form, or "" if it is not one of ours. */
export function phoneOfAccount(name: string | null | undefined): string {
  const [digits, domain] = (name ?? '').split('@');
  if (domain !== ACCOUNT_DOMAIN) return '';
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  return /^00\d{8,15}$/.test(digits) ? `+${digits.slice(2)}` : '';
}
