import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'suzu.db');

export const DEFAULT_DAILY_TOKEN_LIMIT = 2_000_000;

export function getDbPath() {
  return dbPath;
}

let db;

export function getDB() {
  if (!db) {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

export function closeDB() {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
}

/**
 * Snapshot the current database to a destination path using SQLite's online
 * backup API. Safe to call while the server is running.
 */
export async function backupTo(destPath) {
  const database = getDB();
  await database.backup(destPath);
}

function columnExists(database, table, column) {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === column);
}

function tableExists(database, table) {
  const row = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(table);
  return !!row;
}

export function initDB() {
  const database = getDB();

  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      display_name TEXT,
      photo_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT DEFAULT 'New Chat',
      model TEXT DEFAULT 'fiqstr/claude-sonnet-4.6-thinking-agentic',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      image TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );

    CREATE TABLE IF NOT EXISTS apk_projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      original_filename TEXT,
      original_size INTEGER,
      status TEXT NOT NULL DEFAULT 'uploaded',
      decompile_log TEXT,
      recompile_log TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_apk_projects_user ON apk_projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
  `);

  // Lightweight migrations for existing DBs
  if (!columnExists(database, 'messages', 'image')) {
    database.exec(`ALTER TABLE messages ADD COLUMN image TEXT`);
  }
  if (!columnExists(database, 'users', 'tokens_used_today')) {
    database.exec(`ALTER TABLE users ADD COLUMN tokens_used_today INTEGER NOT NULL DEFAULT 0`);
  }
  if (!columnExists(database, 'users', 'tokens_limit_daily')) {
    database.exec(
      `ALTER TABLE users ADD COLUMN tokens_limit_daily INTEGER NOT NULL DEFAULT ${DEFAULT_DAILY_TOKEN_LIMIT}`
    );
  }
  if (!columnExists(database, 'users', 'tokens_reset_at')) {
    database.exec(`ALTER TABLE users ADD COLUMN tokens_reset_at TEXT`);
  }
  if (!columnExists(database, 'users', 'plan')) {
    database.exec(`ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'`);
  }
  if (!columnExists(database, 'users', 'plan_expires_at')) {
    database.exec(`ALTER TABLE users ADD COLUMN plan_expires_at TEXT`);
  }

  // Backfill apk_projects existence (no-op if already created above)
  if (!tableExists(database, 'apk_projects')) {
    database.exec(`
      CREATE TABLE apk_projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        original_filename TEXT,
        original_size INTEGER,
        status TEXT NOT NULL DEFAULT 'uploaded',
        decompile_log TEXT,
        recompile_log TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  console.log('Database initialized');
}

/**
 * Returns the next UTC midnight as ISO string.
 */
export function nextUtcMidnightIso(from = new Date()) {
  const next = new Date(Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate() + 1,
    0, 0, 0, 0
  ));
  return next.toISOString();
}

/**
 * Read the current usage row for a user, resetting if past `tokens_reset_at`.
 * Returns { tokens_used_today, tokens_limit_daily, tokens_reset_at }.
 */
export function getUsage(userId) {
  const database = getDB();
  const row = database
    .prepare(
      'SELECT tokens_used_today, tokens_limit_daily, tokens_reset_at FROM users WHERE id = ?'
    )
    .get(userId);

  if (!row) {
    return {
      tokens_used_today: 0,
      tokens_limit_daily: DEFAULT_DAILY_TOKEN_LIMIT,
      tokens_reset_at: nextUtcMidnightIso(),
    };
  }

  const now = new Date();
  const resetAt = row.tokens_reset_at ? new Date(row.tokens_reset_at) : null;
  if (!resetAt || now >= resetAt) {
    const newReset = nextUtcMidnightIso(now);
    database
      .prepare(
        'UPDATE users SET tokens_used_today = 0, tokens_reset_at = ? WHERE id = ?'
      )
      .run(newReset, userId);
    return {
      tokens_used_today: 0,
      tokens_limit_daily: row.tokens_limit_daily || DEFAULT_DAILY_TOKEN_LIMIT,
      tokens_reset_at: newReset,
    };
  }

  return {
    tokens_used_today: row.tokens_used_today || 0,
    tokens_limit_daily: row.tokens_limit_daily || DEFAULT_DAILY_TOKEN_LIMIT,
    tokens_reset_at: row.tokens_reset_at,
  };
}

/**
 * Read the user's plan, auto-demoting expired premium back to free.
 * Returns { plan, plan_expires_at }.
 */
export function getPlan(userId) {
  const database = getDB();
  const row = database
    .prepare('SELECT plan, plan_expires_at FROM users WHERE id = ?')
    .get(userId);
  if (!row) return { plan: 'free', plan_expires_at: null };

  let plan = row.plan || 'free';
  const expiresAt = row.plan_expires_at ? new Date(row.plan_expires_at) : null;
  if (plan === 'premium' && expiresAt && new Date() >= expiresAt) {
    database
      .prepare(
        "UPDATE users SET plan='free', plan_expires_at=NULL, tokens_limit_daily=? WHERE id=?"
      )
      .run(DEFAULT_DAILY_TOKEN_LIMIT, userId);
    plan = 'free';
    return { plan: 'free', plan_expires_at: null };
  }
  return { plan, plan_expires_at: row.plan_expires_at || null };
}

/**
 * Increment a user's daily token usage by `n`.
 */
export function addTokens(userId, n) {
  if (!n || n <= 0) return;
  const database = getDB();
  // Make sure window is current before adding
  getUsage(userId);
  database
    .prepare('UPDATE users SET tokens_used_today = tokens_used_today + ? WHERE id = ?')
    .run(n, userId);
}
