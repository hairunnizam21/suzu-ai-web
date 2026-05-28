import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '..', '..', '.env');

function readLines() {
  if (!fs.existsSync(ENV_PATH)) return [];
  return fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
}

function writeLines(lines) {
  fs.writeFileSync(ENV_PATH, lines.join('\n'), { mode: 0o600 });
}

export function getEnvVar(key) {
  const lines = readLines();
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[1] === key) return m[2];
  }
  return process.env[key] ?? '';
}

export function setEnvVars(updates) {
  const lines = readLines();
  const keys = Object.keys(updates);
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && keys.includes(m[1])) {
      lines[i] = `${m[1]}=${updates[m[1]]}`;
      seen.add(m[1]);
    }
  }
  for (const k of keys) {
    if (!seen.has(k)) lines.push(`${k}=${updates[k]}`);
  }
  if (lines.length && lines[lines.length - 1] !== '') lines.push('');
  writeLines(lines);
  for (const k of keys) process.env[k] = updates[k];
}

export function maskSecret(value, keep = 4) {
  if (!value || value.length <= keep * 2) return value || '';
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}
