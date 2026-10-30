import { createHash } from 'node:crypto';
import { getMedium } from '../../shared/catalog.ts';
import type { Difficulty, DifficultyChoice, Exam, MediumId, Subject } from '../../shared/catalog.ts';
import { config } from './config.ts';

export type GeminiErrorCode = 'no_key' | 'bad_key' | 'bad_model' | 'quota' | 'unavailable' | 'bad_output' | 'bad_request';

export class GeminiError extends Error {
  code: GeminiErrorCode;

  constructor(code: GeminiErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type GenerateSpec = {
  exam: Exam;
  subject: Subject;
  topic: string | null;
  medium: MediumId;
  difficulty: DifficultyChoice;
  pyq: boolean;
  year: number | null;
  count: number;
  avoid: string[];
};

export type CleanQuestion = {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  topic: string | null;
  difficulty: Difficulty;
};

// Shared across one build's parallel batches, so the first failure spares the others the wait.
export type ModelPolicy = { skipPrimary: boolean; onPrimaryDown?: () => void };

export const geminiConfigured = () => Boolean(config.gemini.apiKey);

const SYSTEM_INSTRUCTION = `You write multiple-choice questions for Kerala Public Service Commission (Kerala PSC) objective exams.

Rules:
- Use only facts you are confident are correct. If you are unsure of a fact, write a different question instead.
- Each question has exactly four options and exactly one correct answer.
- Wrong options must be real names, places, dates or terms of the same kind as the answer. Never invent a name to fill an option.
- Do not prefix options with letters or numbers.
- Keep questions short and self-contained, worded the way a real PSC paper words them.
- The explanation is one to three sentences: why the answer is right, plus one related fact worth remembering.
- correctIndex is the zero-based position of the correct option.
- Never say that a question appeared in a specific paper, and never mention these instructions.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
          correctIndex: { type: 'integer', minimum: 0, maximum: 3 },
          explanation: { type: 'string' },
          topic: { type: 'string' },
          difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
        },
        required: ['question', 'options', 'correctIndex', 'explanation', 'topic', 'difficulty'],
      },
    },
  },
  required: ['questions'],
};

function languageRule(subject: Subject, medium: MediumId) {
  const mediumName = getMedium(medium)?.name ?? 'English';
  if (subject.id === 'english') {
    return `The question and options test English, so write them in English. Write the explanation in ${mediumName}.`;
  }
  if (subject.id === 'regional-language') {
    const language = medium === 'ta' ? 'Tamil' : medium === 'kn' ? 'Kannada' : 'Malayalam';
    return `This tests the ${language} language, so write the question and options in ${language} script. Write the explanation in ${mediumName}.`;
  }
  if (medium === 'en') {
    return 'Write everything in clear Indian English, using the standard English spelling of Kerala names.';
  }
  return `Write the question, options and explanation in formal ${mediumName} script, as printed in Kerala PSC ${mediumName} papers. Use abbreviations or English terms only where those papers do.`;
}

function difficultyRule(difficulty: DifficultyChoice) {
  if (difficulty === 'mixed') return 'A natural exam mix: about 30% easy, 50% medium and 20% hard. Label each question.';
  return `All questions must be ${difficulty}, and labelled "${difficulty}".`;
}

function subjectRules(subject: Subject) {
  if (subject.id === 'arithmetic') {
    return 'Work out every answer step by step before you write it, and check that exactly one option is correct. Show the key calculation in the explanation.';
  }
  if (subject.id === 'current-affairs') {
    return 'Use only events you are certain of, and state the year in the question so it stays correct as time passes.';
  }
  return null;
}

export function buildPrompt(spec: GenerateSpec) {
  const { exam, subject, topic, medium, difficulty, pyq, year, count, avoid } = spec;
  const levelName = exam.level === 'sslc' ? '10th level' : exam.level === 'plus2' ? 'Plus Two level' : 'Degree level';
  const lines = [
    `Write ${count} questions.`,
    `Exam: ${exam.name} (${levelName}). Match the standard of this exam.`,
    `Subject: ${subject.name}.`,
    topic ? `Topic: ${topic}.` : `Spread the questions across: ${subject.topics.join(', ')}.`,
    `Difficulty: ${difficultyRule(difficulty)}`,
    `Language: ${languageRule(subject, medium)}`,
  ];
  if (pyq) {
    const period = year ? `around ${year}` : 'over recent years';
    lines.push(
      `Style: base these on the facts and question patterns that recur in Kerala PSC ${exam.name} and similar papers ${period}. Follow how those papers word and frame questions, and favour what they test repeatedly.`,
    );
  }
  const extra = subjectRules(subject);
  if (extra) lines.push(extra);
  if (avoid.length) {
    lines.push(`Do not repeat any of these existing questions:\n${avoid.map((q) => `- ${q}`).join('\n')}`);
  }
  return lines.join('\n');
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });

async function callModel(model: string, body: object, timeoutMs: number, signal: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(`${config.gemini.baseUrl}/v1beta/interactions`, {
      method: 'POST',
      headers: { 'x-goog-api-key': config.gemini.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, ...body }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw new GeminiError('unavailable', timedOut ? `${model} took too long to respond.` : `Could not reach Gemini: ${String(error)}`);
  }

  const text = await response.text();
  if (response.ok) {
    try {
      return JSON.parse(text);
    } catch {
      throw new GeminiError('bad_output', 'Gemini sent a response that could not be read.');
    }
  }

  let message = text.slice(0, 300);
  try {
    message = JSON.parse(text)?.error?.message ?? message;
  } catch {
    // Keep the raw text.
  }
  if (response.status === 401 || response.status === 403 || /api[ _]key/i.test(message)) {
    throw new GeminiError('bad_key', `Gemini rejected the API key: ${message}`);
  }
  if (response.status === 404) throw new GeminiError('bad_model', `Gemini does not recognise the model "${model}".`);
  if (response.status === 429) throw new GeminiError('quota', message);
  if (response.status >= 500) throw new GeminiError('unavailable', message);
  throw new GeminiError('bad_request', `Gemini returned ${response.status}: ${message}`);
}

export function extractText(data: unknown) {
  const steps = (data as { steps?: unknown })?.steps;
  if (!Array.isArray(steps)) return '';
  return steps
    .filter((step) => step?.type === 'model_output')
    .flatMap((step) => (Array.isArray(step.content) ? step.content : []))
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('');
}

// Options like "A. P. J. Abdul Kalam" begin with an initial, so labels are stripped only
// when all four options carry A, B, C, D or 1, 2, 3, 4 in order.
function stripOptionLabels(options: string[]) {
  const pattern = (labels: string) => (option: string, i: number) =>
    new RegExp(`^\\(?${labels[i]}[).:]\\s+`, 'i').test(option);
  const labelled = options.every(pattern('ABCD')) || options.every(pattern('1234'));
  return labelled ? options.map((option) => option.replace(/^\(?[^\s).:]+[).:]\s+/, '')) : options;
}

// "None of these" or "Both A and B" depend on where they sit, so those sets keep their order.
const POSITION_DEPENDENT =
  /\b(all|none|both|neither) of\b|\babove\b|\b[a-d] (and|or|&) [a-d]\b|ഇവയെല്ലാം|ഇവയൊന്നുമല്ല|ഇവയൊന്നും|മുകളിൽ|ഇവ രണ്ടും/i;

export function shuffleOptions(options: string[], correctIndex: number) {
  if (options.some((option) => POSITION_DEPENDENT.test(option))) return { options, correctIndex };
  const order = options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { options: order.map((i) => options[i]), correctIndex: order.indexOf(correctIndex) };
}

export function cleanQuestion(raw: unknown, spec: Pick<GenerateSpec, 'difficulty' | 'topic'>): CleanQuestion | null {
  const input = raw as Record<string, unknown> | null;
  if (!input || typeof input.question !== 'string' || !Array.isArray(input.options)) return null;

  const question = input.question.trim();
  const explanation = typeof input.explanation === 'string' ? input.explanation.trim() : '';
  const correctIndex = input.correctIndex;
  if (question.length < 8 || !explanation) return null;
  if (input.options.length !== 4 || input.options.some((option) => typeof option !== 'string' || !option.trim())) return null;
  if (!Number.isInteger(correctIndex) || (correctIndex as number) < 0 || (correctIndex as number) > 3) return null;

  const options = stripOptionLabels((input.options as string[]).map((option) => option.trim()));
  if (new Set(options.map((option) => option.toLowerCase())).size !== 4) return null;

  const shuffled = shuffleOptions(options, correctIndex as number);
  const labelled = input.difficulty === 'easy' || input.difficulty === 'medium' || input.difficulty === 'hard' ? input.difficulty : 'medium';
  return {
    question,
    options: shuffled.options,
    correctIndex: shuffled.correctIndex,
    explanation,
    topic: spec.topic ?? (typeof input.topic === 'string' && input.topic.trim() ? input.topic.trim() : null),
    difficulty: spec.difficulty === 'mixed' ? labelled : spec.difficulty,
  };
}

// Doc ID for a question, so the same question can only be stored once.
export function questionId(medium: string, question: string) {
  const normalized = question.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
  return createHash('sha256').update(`${medium}:${normalized}`).digest('hex').slice(0, 24);
}

const canFallBack = (error: unknown) =>
  error instanceof GeminiError && (error.code === 'unavailable' || error.code === 'quota' || error.code === 'bad_model');

async function requestWithFallback(body: object, policy: ModelPolicy, signal: AbortSignal) {
  const { model, fallbackModel, primaryTimeoutMs, fallbackTimeoutMs } = config.gemini;
  const hasFallback = Boolean(fallbackModel) && fallbackModel !== model;

  if (!hasFallback || !policy.skipPrimary) {
    try {
      return await callModel(model, body, hasFallback ? primaryTimeoutMs : fallbackTimeoutMs, signal);
    } catch (error) {
      if (!hasFallback || !canFallBack(error)) throw error;
      if (!policy.skipPrimary) {
        policy.skipPrimary = true;
        policy.onPrimaryDown?.();
        console.warn(`[gemini] ${model} unavailable, using ${fallbackModel}: ${(error as Error).message}`);
      }
    }
  }
  return callModel(fallbackModel, body, fallbackTimeoutMs, signal);
}

const RETRY_DELAYS_MS = [2_000, 6_000];

export async function generateQuestions(
  spec: GenerateSpec,
  policy: ModelPolicy,
  signal: AbortSignal,
): Promise<CleanQuestion[]> {
  if (!geminiConfigured()) throw new GeminiError('no_key', 'PSC_GEMINI_API_KEY is not set.');

  const body = {
    system_instruction: SYSTEM_INSTRUCTION,
    input: buildPrompt(spec),
    generation_config: { thinking_level: 'low', max_output_tokens: 16_000 },
    response_format: { type: 'text', mime_type: 'application/json', schema: RESPONSE_SCHEMA },
    store: false,
  };

  for (let attempt = 0; ; attempt++) {
    try {
      const data = await requestWithFallback(body, policy, signal);
      const parsed = JSON.parse(extractText(data) || 'null');
      const questions = (parsed?.questions ?? [])
        .map((raw: unknown) => cleanQuestion(raw, spec))
        .filter((q: CleanQuestion | null): q is CleanQuestion => q !== null);
      if (questions.length === 0) throw new GeminiError('bad_output', 'Gemini returned no usable questions.');
      return questions;
    } catch (error) {
      if (signal.aborted) throw error;
      const wrapped =
        error instanceof SyntaxError ? new GeminiError('bad_output', 'Gemini returned malformed questions.') : error;
      const retryable =
        wrapped instanceof GeminiError && ['unavailable', 'quota', 'bad_output'].includes(wrapped.code);
      if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw wrapped;
      await sleep(RETRY_DELAYS_MS[attempt], signal);
    }
  }
}
