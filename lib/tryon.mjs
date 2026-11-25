import fs from 'node:fs';
export {
  ALLOWED_IMAGE_MIME_TYPES,
  SUPPORTED_MODELS,
  buildTryOnPrompt,
  extractGeminiImage,
  parseDataUrl,
  synthesizeWithGemini,
} from '../public/tryon-core.js';

/**
 * Loads KEY=VALUE pairs from a .env file into process.env without overriding existing variables.
 */
export function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
