import OpenAI from 'openai';
import { getDB } from '../db.js';

/**
 * Token Pool — multi-key auto-failover for AI API calls.
 *
 * Priority order:
 *   1. Pick from `api_tokens` table: active tokens sorted by priority ASC.
 *   2. Fallback to the single key in process.env (AI_API_KEY / AI_API_BASE_URL).
 *
 * When a streaming call fails with a rate-limit or auth error the token is
 * marked `exhausted` and the next one is tried automatically.
 */

const RETRIABLE_STATUS_CODES = new Set([429, 402, 503]);
const AUTH_ERROR_CODES = new Set([401, 403]);

/**
 * Return all active token rows ordered by priority.
 */
function getActiveTokens() {
  const db = getDB();
  return db
    .prepare(
      "SELECT * FROM api_tokens WHERE status = 'active' ORDER BY priority ASC, id ASC"
    )
    .all();
}

/**
 * Mark a token as exhausted with a reason.
 */
function markExhausted(tokenId, reason) {
  const db = getDB();
  db.prepare(
    "UPDATE api_tokens SET status = 'exhausted', last_failed_at = datetime('now'), failure_reason = ? WHERE id = ?"
  ).run(reason, tokenId);
}

/**
 * Touch last_used_at on successful use.
 */
function touchUsed(tokenId) {
  const db = getDB();
  db.prepare(
    "UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?"
  ).run(tokenId);
}

/**
 * Build an OpenAI client for a given token row.
 */
function clientFromRow(row) {
  return new OpenAI({
    apiKey: row.api_key,
    baseURL: row.base_url,
  });
}

/**
 * Build an OpenAI client from the env fallback.
 */
function clientFromEnv() {
  return new OpenAI({
    apiKey: process.env.AI_API_KEY || 'placeholder-key',
    baseURL: process.env.AI_API_BASE_URL || 'https://core.fiqstr.com/v1',
  });
}

/**
 * Get the best available { client, model, tokenId } to use for a chat call.
 *
 * @param {string} [requestedModel] - model the user picked in the conversation
 * @returns {{ client: OpenAI, model: string, tokenId: number|null }}
 */
export function pickToken(requestedModel) {
  const rows = getActiveTokens();

  if (rows.length > 0) {
    const row = rows[0];
    return {
      client: clientFromRow(row),
      model: requestedModel || row.model.split(',')[0].trim(),
      tokenId: row.id,
    };
  }

  // Fallback to env
  return {
    client: clientFromEnv(),
    model:
      requestedModel ||
      process.env.AI_DEFAULT_MODEL ||
      'fiqstr/claude-sonnet-4.6-thinking-agentic',
    tokenId: null,
  };
}

/**
 * Try a streaming chat completion, rotating through pool tokens on failure.
 *
 * @param {object} params - { messages, model (optional, from conversation), stream: true }
 * @returns {{ stream, model, tokenId }} on success
 * @throws if all tokens (and env fallback) fail
 */
export async function createChatWithFailover(params) {
  const rows = getActiveTokens();
  const candidates = [...rows];
  // Append env fallback as a virtual entry
  candidates.push(null); // null = env fallback

  let lastError = null;

  for (const row of candidates) {
    const client = row ? clientFromRow(row) : clientFromEnv();
    const model = params.model || (row ? row.model.split(',')[0].trim() : null) ||
      process.env.AI_DEFAULT_MODEL || 'fiqstr/claude-sonnet-4.6-thinking-agentic';
    const tokenId = row ? row.id : null;

    try {
      const stream = await client.chat.completions.create({
        ...params,
        model,
        stream: true,
      });

      // Success — touch last_used_at
      if (tokenId) touchUsed(tokenId);

      return { stream, model, tokenId };
    } catch (err) {
      lastError = err;
      const status = err?.status || err?.response?.status;
      const msg = err?.message || String(err);

      if (tokenId && (RETRIABLE_STATUS_CODES.has(status) || AUTH_ERROR_CODES.has(status))) {
        markExhausted(tokenId, `HTTP ${status}: ${msg.slice(0, 200)}`);
        continue; // try next token
      }

      // For non-pool tokens (env fallback) or unknown errors, just throw
      if (!tokenId) throw err;

      // For pool tokens with non-retriable errors, mark and continue
      markExhausted(tokenId, `Error: ${msg.slice(0, 200)}`);
    }
  }

  throw lastError || new Error('All API tokens exhausted');
}
