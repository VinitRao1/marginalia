// Loads .env (no dependency needed) and exposes studio configuration.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    else val = val.replace(/\s+#.*$/, '');
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv(join(ROOT, '.env'));

const env = (k, d = '') => {
  const v = process.env[k];
  return v === undefined || v === '' ? d : String(v).trim();
};

const PORT = parseInt(env('PORT', '3000'), 10);
const DATA_DIR = env('DATA_DIR', join(ROOT, 'data'));
mkdirSync(join(DATA_DIR, 'sessions'), { recursive: true });
mkdirSync(join(DATA_DIR, 'media'), { recursive: true });

const secretFile = join(DATA_DIR, '.callback-secret');
if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(24).toString('hex'));

export const config = {
  port: PORT,
  host: env('HOST', '0.0.0.0'),
  dataDir: DATA_DIR,
  engine: env('ENGINE', 'auto').toLowerCase(), // auto | n8n | local
  n8nUrl: env('N8N_URL', 'http://localhost:5678').replace(/\/+$/, ''),
  n8nPublicUrl: env('N8N_PUBLIC_URL', env('N8N_URL', 'http://localhost:5678')).replace(/\/+$/, ''),
  callbackBase: env('STUDIO_CALLBACK_URL', `http://localhost:${PORT}`).replace(/\/+$/, ''),
  callbackSecret: readFileSync(secretFile, 'utf8').trim(),
  webhookToken: env('MARGINALIA_WEBHOOK_TOKEN'),
  // Set on public deployments so visitors can browse but only people with the code spend your API credits.
  accessCode: env('STUDIO_ACCESS_CODE'),
  maxConcurrentRuns: parseInt(env('MAX_CONCURRENT_RUNS', '2'), 10),
  elevenlabs: {
    apiKey: env('ELEVENLABS_API_KEY'),
    baseUrl: env('ELEVENLABS_BASE_URL', 'https://api.elevenlabs.io').replace(/\/+$/, ''),
    agentId: env('ELEVENLABS_AGENT_ID'),
    agentLlm: env('ELEVENLABS_AGENT_LLM', 'gemini-2.5-flash'),
    agentVoice: env('ELEVENLABS_AGENT_VOICE_ID'),
    voiceMira: env('PODCAST_VOICE_MIRA', 'EXAVITQu4vr4xnSDxMaL'),
    voiceTheo: env('PODCAST_VOICE_THEO', 'JBFqnCBsd6RMkjVDRZzb'),
    ttsModel: env('PODCAST_TTS_MODEL', 'eleven_multilingual_v2'),
  },
};
