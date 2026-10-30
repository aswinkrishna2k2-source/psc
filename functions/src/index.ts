import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { app } from './app.ts';

// Named for PSC because this project's GEMINI_API_KEY secret belongs to Ceeq Tutor.
const geminiApiKey = defineSecret('PSC_GEMINI_API_KEY');

export const pscApi = onRequest(
  {
    region: 'asia-south1', // Mumbai, the closest region to Kerala
    timeoutSeconds: 300, // Writing a large question set can take a few minutes
    memory: '512MiB',
    cpu: 1,
    concurrency: 40,
    maxInstances: 10,
    invoker: 'public',
    secrets: [geminiApiKey],
  },
  app,
);
