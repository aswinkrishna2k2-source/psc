const isPlaceholder = (key: string) => /^(|your[-_ ].*|paste.*|changeme|x+)$/i.test(key);

export const config = {
  timezone: process.env.APP_TIMEZONE ?? 'Asia/Kolkata',
  // Setup instructions are useful locally but mean nothing to a student.
  showSetupHints: process.env.FUNCTIONS_EMULATOR === 'true',
  dailyAiLimitPerUser: Number(process.env.DAILY_AI_QUESTION_LIMIT ?? 300),
  dailyAiLimitTotal: Number(process.env.DAILY_AI_QUESTION_LIMIT_TOTAL ?? 3000),
  buildDeadlineMs: Number(process.env.BUILD_DEADLINE_MS ?? 240_000),
  gemini: {
    // The secret is only bound at request time, so it must not be read at import.
    get apiKey() {
      const key = (process.env.PSC_GEMINI_API_KEY ?? '').trim();
      return isPlaceholder(key) ? '' : key;
    },
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    fallbackModel: process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.8-flash',
    baseUrl: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com',
    primaryTimeoutMs: Number(process.env.GEMINI_PRIMARY_TIMEOUT_MS ?? 40_000),
    fallbackTimeoutMs: Number(process.env.GEMINI_FALLBACK_TIMEOUT_MS ?? 90_000),
  },
};
