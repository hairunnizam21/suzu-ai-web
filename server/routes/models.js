import { Router } from 'express';
import { verifyAuth } from '../middleware/auth.js';
import { getDB } from '../db.js';

export const modelsRouter = Router();

modelsRouter.use(verifyAuth);

// Hardcoded fallback when no tokens in pool
const FALLBACK_MODELS = [
  { id: 'fiqstr/claude-opus-4.7-thinking-agentic', name: 'Claude Opus 4.7 Thinking', provider: 'Anthropic' },
  { id: 'fiqstr/gpt-5.5', name: 'GPT 5.5', provider: 'OpenAI' },
  { id: 'fiqstr/claude-sonnet-4.6-thinking-agentic', name: 'Claude Sonnet 4.6 Thinking', provider: 'Anthropic' },
];

function guessProvider(id) {
  if (/claude|sonnet|opus|haiku/i.test(id)) return 'Anthropic';
  if (/gpt|o[134]/i.test(id)) return 'OpenAI';
  if (/gemini/i.test(id)) return 'Google';
  return 'Other';
}

function prettyName(id) {
  // "fiqstr/claude-opus-4.7-thinking-agentic" → "Claude Opus 4.7 Thinking"
  const raw = id.includes('/') ? id.split('/').pop() : id;
  return raw
    .replace(/-/g, ' ')
    .replace(/\bagentic\b/i, '')
    .replace(/\bthinking\b/i, 'Thinking')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

modelsRouter.get('/', (_req, res) => {
  const db = getDB();
  const rows = db
    .prepare("SELECT model FROM api_tokens WHERE status = 'active'")
    .all();

  if (rows.length === 0) {
    return res.json({ models: FALLBACK_MODELS });
  }

  // Collect unique models from all active tokens (comma-separated)
  const seen = new Set();
  const models = [];
  for (const row of rows) {
    const parts = row.model.split(',').map((s) => s.trim()).filter(Boolean);
    for (const id of parts) {
      if (!seen.has(id)) {
        seen.add(id);
        models.push({ id, name: prettyName(id), provider: guessProvider(id) });
      }
    }
  }

  res.json({ models });
});
