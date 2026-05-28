import { Router } from 'express';
import { verifyAdmin } from '../middleware/admin.js';
import { getDB, DEFAULT_DAILY_TOKEN_LIMIT } from '../db.js';
import { getEnvVar, setEnvVars, maskSecret } from '../utils/envFile.js';

export const adminRouter = Router();

// All routes require admin token
adminRouter.use(verifyAdmin);

// --- Health ---
adminRouter.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// --- Config ---
adminRouter.get('/config', (_req, res) => {
  const apiKey = getEnvVar('AI_API_KEY');
  res.json({
    domain: getEnvVar('SUZU_DOMAIN') || '',
    base_url: getEnvVar('AI_API_BASE_URL') || '',
    model: getEnvVar('AI_DEFAULT_MODEL') || '',
    api_key_masked: maskSecret(apiKey),
    api_key_set: !!apiKey,
    default_daily_token_limit: DEFAULT_DAILY_TOKEN_LIMIT,
  });
});

adminRouter.post('/config', (req, res) => {
  const { base_url, model, api_key, domain } = req.body || {};
  const updates = {};
  if (typeof base_url === 'string' && base_url.trim()) updates.AI_API_BASE_URL = base_url.trim();
  if (typeof model === 'string' && model.trim()) updates.AI_DEFAULT_MODEL = model.trim();
  if (typeof api_key === 'string' && api_key.trim()) updates.AI_API_KEY = api_key.trim();
  if (typeof domain === 'string' && domain.trim()) updates.SUZU_DOMAIN = domain.trim();
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }
  setEnvVars(updates);
  res.json({ ok: true, updated: Object.keys(updates) });
});

// --- Users ---
adminRouter.get('/users', (_req, res) => {
  const db = getDB();
  const rows = db
    .prepare(
      `SELECT id, email, display_name, photo_url,
              IFNULL(plan, 'free') AS plan,
              plan_expires_at,
              tokens_used_today,
              tokens_limit_daily,
              tokens_reset_at,
              created_at
       FROM users
       ORDER BY (plan='premium') DESC, tokens_used_today DESC
       LIMIT 500`
    )
    .all();
  res.json({ users: rows });
});

// --- Premium grant/extend/revoke ---
function parseDurationToMs(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (/^\d+$/.test(str)) return Number(str) * 86400_000; // bare = days
  const m = str.match(/^(\d+)\s*(s|m|h|d|w|mo|y)$/);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2];
  const map = { s: 1000, m: 60_000, h: 3600_000, d: 86400_000, w: 604800_000, mo: 2592000_000, y: 31536000_000 };
  return n * map[u];
}

adminRouter.post('/users/:id/grant-premium', (req, res) => {
  const { duration, limit } = req.body || {};
  const ms = parseDurationToMs(duration || '30d');
  if (!ms) return res.status(400).json({ error: 'Invalid duration (use 24h / 7d / 30d / 3mo / 1y / N)' });
  const lim = Number(limit) > 0 ? Number(limit) : 20_000_000;
  const expiresAt = new Date(Date.now() + ms).toISOString();
  const db = getDB();
  const r = db
    .prepare(
      "UPDATE users SET plan='premium', plan_expires_at=?, tokens_limit_daily=? WHERE id=?"
    )
    .run(expiresAt, lim, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true, plan: 'premium', plan_expires_at: expiresAt, tokens_limit_daily: lim });
});

adminRouter.post('/users/:id/extend-premium', (req, res) => {
  const { duration } = req.body || {};
  const ms = parseDurationToMs(duration);
  if (!ms) return res.status(400).json({ error: 'Invalid duration' });
  const db = getDB();
  const row = db
    .prepare('SELECT plan, plan_expires_at FROM users WHERE id = ?')
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'User not found' });
  if (row.plan !== 'premium' || !row.plan_expires_at) {
    return res.status(400).json({ error: 'User is not premium; use grant-premium' });
  }
  const newExp = new Date(new Date(row.plan_expires_at).getTime() + ms).toISOString();
  db.prepare('UPDATE users SET plan_expires_at=? WHERE id=?').run(newExp, req.params.id);
  res.json({ ok: true, plan_expires_at: newExp });
});

adminRouter.post('/users/:id/revoke-premium', (req, res) => {
  const db = getDB();
  const r = db
    .prepare(
      'UPDATE users SET plan=?, plan_expires_at=NULL, tokens_limit_daily=? WHERE id=?'
    )
    .run('free', DEFAULT_DAILY_TOKEN_LIMIT, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true, plan: 'free' });
});

adminRouter.post('/users/:id/limit', (req, res) => {
  const limit = Number((req.body || {}).limit);
  if (!Number.isInteger(limit) || limit < 0) {
    return res.status(400).json({ error: 'limit must be a non-negative integer' });
  }
  const db = getDB();
  const r = db.prepare('UPDATE users SET tokens_limit_daily=? WHERE id=?').run(limit, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true, tokens_limit_daily: limit });
});

adminRouter.post('/users/:id/reset-tokens', (req, res) => {
  const db = getDB();
  const r = db.prepare('UPDATE users SET tokens_used_today=0 WHERE id=?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});
