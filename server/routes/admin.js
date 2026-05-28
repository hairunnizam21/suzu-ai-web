import { Router } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { pipeline } from 'stream';
import archiver from 'archiver';
import yauzl from 'yauzl';
import multer from 'multer';
import Database from 'better-sqlite3';
import { verifyAdmin } from '../middleware/admin.js';
import {
  getDB,
  getDbPath,
  closeDB,
  backupTo,
  initDB,
  DEFAULT_DAILY_TOKEN_LIMIT,
} from '../db.js';
import { getEnvVar, setEnvVars, maskSecret } from '../utils/envFile.js';

const pipelineAsync = promisify(pipeline);
const yauzlOpen = promisify(yauzl.open.bind(yauzl));

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

// --- API Token Sets (multi-key failover) ---

adminRouter.get('/tokens', (_req, res) => {
  const db = getDB();
  const rows = db
    .prepare('SELECT * FROM api_tokens ORDER BY priority ASC, id ASC')
    .all();
  // Mask keys before sending
  const tokens = rows.map((r) => ({
    ...r,
    api_key_masked: maskSecret(r.api_key),
  }));
  // Remove raw key from response
  tokens.forEach((t) => delete t.api_key);
  res.json({ tokens });
});

adminRouter.post('/tokens', (req, res) => {
  const { name, base_url, api_key, model, priority } = req.body || {};
  if (!name || !base_url || !api_key || !model) {
    return res.status(400).json({ error: 'name, base_url, api_key, model are required' });
  }
  const db = getDB();
  const r = db
    .prepare(
      'INSERT INTO api_tokens (name, base_url, api_key, model, priority) VALUES (?, ?, ?, ?, ?)'
    )
    .run(name, base_url, api_key, model, Number(priority) || 100);
  res.json({ ok: true, id: r.lastInsertRowid });
});

adminRouter.put('/tokens/:id', (req, res) => {
  const { name, base_url, api_key, model, priority, status } = req.body || {};
  const db = getDB();
  const existing = db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Token not found' });

  const updates = {
    name: name || existing.name,
    base_url: base_url || existing.base_url,
    api_key: api_key || existing.api_key,
    model: model || existing.model,
    priority: priority != null ? Number(priority) : existing.priority,
    status: status || existing.status,
  };
  db.prepare(
    'UPDATE api_tokens SET name=?, base_url=?, api_key=?, model=?, priority=?, status=? WHERE id=?'
  ).run(updates.name, updates.base_url, updates.api_key, updates.model, updates.priority, updates.status, req.params.id);
  res.json({ ok: true });
});

adminRouter.delete('/tokens/:id', (req, res) => {
  const db = getDB();
  const r = db.prepare('DELETE FROM api_tokens WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Token not found' });
  res.json({ ok: true });
});

// --- Backup / Restore ---

/**
 * GET /api/admin/backup
 * Streams a ZIP containing:
 *   - suzu.db      : online-backup snapshot of the SQLite database
 *   - meta.json    : { version, exported_at, user_count, conversation_count }
 *
 * The client (APK or browser) saves this file. To restore, POST it back to
 * /api/admin/restore as multipart/form-data with field name "file".
 */
adminRouter.get('/backup', async (_req, res) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'suzu-backup-'));
  const snapshotPath = path.join(tmpDir, 'suzu.db');
  try {
    await backupTo(snapshotPath);
    const db = getDB();
    const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    const convCount = db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n;
    const meta = {
      version: 1,
      app: 'suzu-ai-web',
      exported_at: new Date().toISOString(),
      user_count: userCount,
      conversation_count: convCount,
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="suzu-backup-${stamp}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('backup archive error', err);
      try { res.status(500).end(); } catch {/* ignore */}
    });
    archive.on('end', () => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {/* ignore */}
    });
    archive.pipe(res);
    archive.file(snapshotPath, { name: 'suzu.db' });
    archive.append(JSON.stringify(meta, null, 2), { name: 'meta.json' });
    archive.finalize();
  } catch (err) {
    console.error('backup failed', err);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {/* ignore */}
    res.status(500).json({ error: err.message });
  }
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, fs.mkdtempSync(path.join(os.tmpdir(), 'suzu-restore-'))),
    filename: (_req, file, cb) => cb(null, file.originalname || 'upload.zip'),
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
});

/**
 * POST /api/admin/restore
 * multipart/form-data, field "file" = the ZIP that /api/admin/backup produced.
 *
 * Flow:
 *   1. Receive ZIP, extract to a temp dir.
 *   2. Validate that suzu.db inside is a real SQLite DB with a `users` table.
 *   3. Snapshot the live DB to suzu.db.bak-<timestamp> (safety rollback).
 *   4. Close the live DB, replace suzu.db on disk with the uploaded one, reopen.
 *   5. Return counts of restored rows.
 */
adminRouter.post('/restore', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Missing "file" upload (zip)' });
  const zipPath = req.file.path;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'suzu-restore-work-'));
  const extractedDb = path.join(workDir, 'suzu.db');
  let metaJson = null;
  try {
    await extractZip(zipPath, workDir);
    if (!fs.existsSync(extractedDb)) {
      throw new Error('ZIP does not contain suzu.db');
    }
    const metaPath = path.join(workDir, 'meta.json');
    if (fs.existsSync(metaPath)) {
      try { metaJson = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { /* ignore */ }
    }

    // Validate it's a real SQLite DB with users table
    let userCount = 0;
    let convCount = 0;
    {
      const probe = new Database(extractedDb, { readonly: true });
      try {
        userCount = probe.prepare('SELECT COUNT(*) AS n FROM users').get().n;
        try { convCount = probe.prepare('SELECT COUNT(*) AS n FROM conversations').get().n; } catch {/* table may not exist in older backups */}
      } finally {
        probe.close();
      }
    }

    const live = getDbPath();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupSidePath = `${live}.bak-${stamp}`;

    // Take a safety snapshot of the live DB before we swap.
    await backupTo(backupSidePath);

    // Close live DB so we can replace the file safely.
    closeDB();
    // Remove WAL/SHM sidecars (better-sqlite3 will recreate when we reopen).
    for (const ext of ['', '-wal', '-shm', '-journal']) {
      try { fs.unlinkSync(live + ext); } catch { /* ignore */ }
    }
    fs.copyFileSync(extractedDb, live);

    // Reopen + reapply lightweight migrations to be safe across versions.
    initDB();

    res.json({
      ok: true,
      restored: {
        user_count: userCount,
        conversation_count: convCount,
      },
      meta: metaJson,
      safety_snapshot: path.basename(backupSidePath),
    });
  } catch (err) {
    console.error('restore failed', err);
    res.status(400).json({ error: err.message });
  } finally {
    try { fs.unlinkSync(zipPath); } catch {/* ignore */}
    try { fs.rmSync(path.dirname(zipPath), { recursive: true, force: true }); } catch {/* ignore */}
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {/* ignore */}
  }
});

async function extractZip(zipPath, destDir) {
  const zipfile = await yauzlOpen(zipPath, { lazyEntries: true });
  return await new Promise((resolve, reject) => {
    zipfile.on('error', reject);
    zipfile.on('end', resolve);
    zipfile.readEntry();
    zipfile.on('entry', (entry) => {
      // Reject path traversal
      if (entry.fileName.includes('..') || path.isAbsolute(entry.fileName)) {
        zipfile.readEntry();
        return;
      }
      if (/\/$/.test(entry.fileName)) {
        zipfile.readEntry();
        return;
      }
      // Only restore known filenames
      const allowed = new Set(['suzu.db', 'meta.json']);
      const base = path.basename(entry.fileName);
      if (!allowed.has(base)) {
        zipfile.readEntry();
        return;
      }
      zipfile.openReadStream(entry, (err, readStream) => {
        if (err) return reject(err);
        const outPath = path.join(destDir, base);
        pipelineAsync(readStream, fs.createWriteStream(outPath))
          .then(() => zipfile.readEntry())
          .catch(reject);
      });
    });
  });
}
