# PSC Practice

Mobile-first Kerala PSC MCQ practice. Students choose their level, exam, medium, subject and question set, and Gemini writes matching questions. Progress is tracked daily and separately for each exam.

| Part | Technology |
|---|---|
| Web app | React and Vite, deployed to Vercel |
| Accounts | Firebase Auth: mobile number and 6-digit code, by invitation |
| Database | Firestore, named database `psc-practice` in `asia-south1` (Mumbai) |
| Server | One Cloud Function, `pscApi` (`functions/`), which holds the Gemini key and all scoring |

Browsers never touch Firestore directly (see `firestore.rules`), so students cannot read answers early or change their scores.

## Adding a student

There is no sign-up. Add students in the Firebase console, the same way as for Ceeq Tutor: **Authentication > Users > Add user**.

| Field | Value |
|---|---|
| Email | The number, then `@ceeq.student`. For example `9876543210@ceeq.student`. For other countries, `00` and the country code, such as `0014155550100@ceeq.student` |
| Password | The 6-digit code you give the student |

To change a forgotten code, try **Reset password** on the student's row with a test account first. If it only sends an email, it cannot work here, because these addresses are made up. Do not delete and re-add a student to get round that: the new account gets a new ID, so they lose their progress in both apps. The fallback is setting the password with the Admin SDK's `updateUser`.

## Shared Firebase project

This app lives in the `codeeaq-ai-tutor` project alongside **Ceeq Tutor** (`D:\Projects\codeeaq-ai-tutor`), and they share one login list. Everyone added can sign in to both apps with the same number and code. To give someone only one app, a separate Firebase project would be needed for the other.

| Resource | Ceeq Tutor | PSC Practice |
|---|---|---|
| Firestore database and rules | `(default)` | `psc-practice` |
| Functions codebase | `default` | `psc` |
| Gemini secret | `GEMINI_API_KEY` | `PSC_GEMINI_API_KEY` |
| Login list | **Shared** | **Shared** |

Rules for working here:

- Deploy with `npm run deploy:backend`. It only touches `psc-practice` and the `psc` codebase.
- The default project in `.firebaserc` is a demo one, so stray commands cannot reach production.
- Do not change Authentication settings for PSC's sake. Ceeq Tutor relies on sign-up staying off.
- `src/lib/phone.ts` must keep the same format as Ceeq Tutor's `apps/tutor-web/lib/phone.ts`, or numbers will stop matching their accounts.

## Run it locally

Needs Node 24 and **JDK 21 or newer** for the emulators (`winget install Microsoft.OpenJDK.21`). Ports do not clash with Ceeq Tutor's emulators, so both can run together.

```bash
npm install
npm --prefix functions install
```

Put the Gemini key in `functions/.secret.local` (this file is never committed or deployed):

```
PSC_GEMINI_API_KEY=your-key
```

Then:

```bash
npm run dev
```

Open http://localhost:5173. Any number works locally: the first code you use with a number becomes its code. Local data stays in the emulators, and nothing touches the live project.

To try the production build against the live backend, run `npm run build`, then `npm run preview`, and open http://localhost:4173. This uses real accounts and real data.

| Command | What it does |
|---|---|
| `npm test` | Runs the API tests against the emulators and a fake Gemini |
| `npm run typecheck` | Checks types across the app and functions |
| `npm --prefix functions run gemini:check` | Tests the real Gemini key. Add `-- 6 arithmetic en` to choose count, subject and medium |
| `npm run deploy:check` | Dry run of the function deploy |
| `npm run deploy:backend` | Deploys PSC's rules, indexes and function to the live project |

Do not add Firestore to a dry run: the CLI tries to create the database even with `--dry-run`.

## Deploy the web app on Vercel

Run `npx vercel` from this folder, or import this repository in Vercel. Then add these under Project Settings > Environment Variables and redeploy:

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_APP_ID
```

Get the values with `npx firebase-tools apps:sdkconfig WEB --project prod`. They identify the project and are safe to ship to browsers. Never put the Gemini key in a `VITE_` variable.

`vercel.json` handles the rest. To replace the Gemini key later, run `npx firebase-tools functions:secrets:set PSC_GEMINI_API_KEY --project prod`, then `npm run deploy:backend`.

## Configuration

Optional settings go in `functions/.env`:

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Model tried first |
| `GEMINI_FALLBACK_MODEL` | `gemini-3.8-flash` | Used when the first is overloaded |
| `DAILY_AI_QUESTION_LIMIT` | `300` | New questions per student per day |
| `DAILY_AI_QUESTION_LIMIT_TOTAL` | `3000` | New questions per day for the whole app, to cap Gemini spend |
| `APP_TIMEZONE` | `Asia/Kolkata` | Decides when "today" starts |

To add exams, subjects or topics, edit `shared/catalog.ts`. The server validates against it and the app renders from it. Syllabus weights there are approximate, so check them against official notifications.

## How questions work

Questions are saved to a shared bank, so Gemini is only called when a student has already seen everything that matches. Previous-year sets are written by Gemini in the style of past papers and labelled that way: they are not official question papers. Current Affairs is limited to what the model already knows. Students can report a bad question; it is hidden from them straight away, and from everyone after three reports. Reports are stored under `questions/{id}/reports` in `psc-practice` for review.
