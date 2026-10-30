// npm run gemini:check -- [count] [subjectId] [medium] (in functions/) tests the key in .secret.local
// by asking for real questions.
import { getExam, getMedium, getSubject } from '../../shared/catalog.ts';
import type { MediumId } from '../../shared/catalog.ts';
import { config } from './config.ts';
import { GeminiError, generateQuestions, geminiConfigured } from './gemini.ts';

const count = Number(process.argv[2] ?? 2);
const subjectId = process.argv[3] ?? 'geography';
const medium = (process.argv[4] ?? 'ml') as MediumId;

async function main() {
  if (!geminiConfigured()) {
    console.error('PSC_GEMINI_API_KEY is empty. Add it to functions/.secret.local and run this again.');
    process.exitCode = 1;
    return;
  }
  console.log(`Asking ${config.gemini.model} (fallback ${config.gemini.fallbackModel}) for ${count} ${getMedium(medium)?.name} ${subjectId} questions...`);
  const started = Date.now();
  try {
    const questions = await generateQuestions(
      {
        exam: getExam('ldc')!,
        subject: getSubject(subjectId)!,
        topic: null,
        medium,
        difficulty: 'easy',
        pyq: false,
        year: null,
        count,
        avoid: [],
      },
      {
        skipPrimary: false,
        onPrimaryDown: () => console.log(`  ${config.gemini.model} is unavailable, switching to the fallback.`),
      },
      new AbortController().signal,
    );
    console.log(`Key works. Got ${questions.length} questions in ${((Date.now() - started) / 1000).toFixed(1)}s:`);
    for (const q of questions) {
      console.log(`\n${q.question}`);
      q.options.forEach((option, i) => console.log(`  ${i === q.correctIndex ? '*' : ' '} ${option}`));
      console.log(`  Why: ${q.explanation}`);
    }
  } catch (error) {
    const code = error instanceof GeminiError ? error.code : 'error';
    console.error(`Failed (${code}): ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

await main();
