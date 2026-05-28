import { Router } from 'express';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { verifyAuth } from '../middleware/auth.js';
import { getDB, getUsage, addTokens, DEFAULT_DAILY_TOKEN_LIMIT } from '../db.js';
import { AI_TOOLS, runToolCall } from '../utils/aiTools.js';

export const chatRouter = Router();

// All chat routes require auth
chatRouter.use(verifyAuth);

const openai = new OpenAI({
  apiKey: process.env.AI_API_KEY || 'placeholder-key',
  baseURL: process.env.AI_API_BASE_URL || 'https://core.fiqstr.com/v1',
});

const DEFAULT_MODEL =
  process.env.AI_DEFAULT_MODEL || 'fiqstr/claude-sonnet-4.6-thinking-agentic';

const MAX_TOOL_ITERATIONS = 6;

const SYSTEM_PROMPT = `You are SuzuneiAyano-AI, a helpful and intelligent assistant, plus an Android reverse-engineering specialist. Respond in the same language the user uses. Be concise and helpful. When analyzing images, describe what you see in detail.

You have APK reverse-engineering tools:
- apk_list_projects: list the user's APK projects
- apk_decompile: run apktool d on a project (must run once before reading/editing/recompiling)
- apk_info: quick summary from AndroidManifest.xml (package, version, SDK, permissions, components)
- apk_list_files: list files in the decompiled project (optional prefix filter)
- apk_read_file: read a single text file (AndroidManifest, smali, xml, json)
- apk_search: grep-style search across the decompiled tree for a regex/substring
- apk_edit_file: overwrite a text file
- apk_recompile: apktool b + zipalign + apksigner debug-sign, returns a downloadUrl

When the user attaches or references an APK:
1. If you don't have a project_id, call apk_list_projects.
2. If the project is in 'uploaded' state, call apk_decompile.
3. Proactively run apk_info to summarize: package, version, SDK targets, requested permissions (call out dangerous ones such as SMS, CONTACTS, READ_PHONE_STATE, ACCESSIBILITY_SERVICE, REQUEST_INSTALL_PACKAGES, SYSTEM_ALERT_WINDOW), and the main activities/services/receivers/providers.
4. Use apk_search to look for indicators of interest, e.g.:
   - URLs / endpoints: pattern "https?://"
   - Suspicious APIs: pattern "Runtime;->exec", "sendTextMessage", "DexClassLoader", "WebView;->loadUrl"
   - Hardcoded secrets: pattern "api[_-]?key|token|secret"
5. Summarize findings clearly in the user's language. Offer concrete modification ideas (e.g. "I can change the package name to X, remove the SMS permission, or replace the API URL").
6. Only modify or recompile when the user asks. Use apk_edit_file then apk_recompile, then share the downloadUrl.

Be honest if you can't find something. Never invent file contents.`;

// Get current user's daily token usage
chatRouter.get('/usage', (req, res) => {
  const usage = getUsage(req.user.uid);
  res.json(usage);
});

// Get all conversations for a user
chatRouter.get('/conversations', (req, res) => {
  const db = getDB();
  const conversations = db
    .prepare(
      'SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC'
    )
    .all(req.user.uid);
  res.json({ conversations });
});

// Create new conversation
chatRouter.post('/conversations', (req, res) => {
  const db = getDB();
  const id = uuidv4();
  const model = req.body.model || DEFAULT_MODEL;

  db.prepare(
    'INSERT INTO conversations (id, user_id, title, model) VALUES (?, ?, ?, ?)'
  ).run(id, req.user.uid, 'New Chat', model);

  const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  res.json({ conversation });
});

// Get messages in a conversation
chatRouter.get('/conversations/:id/messages', (req, res) => {
  const db = getDB();

  const conversation = db
    .prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.uid);

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  const messages = db
    .prepare(
      'SELECT id, role, content, image, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
    )
    .all(req.params.id);

  res.json({ messages, conversation });
});

// Send message and get AI response (streaming, with optional tool calls)
chatRouter.post('/conversations/:id/messages', async (req, res) => {
  const db = getDB();
  const { content, image } = req.body;

  const conversation = db
    .prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.uid);

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  // Enforce daily token limit *before* incurring any tokens
  const usageBefore = getUsage(req.user.uid);
  if (usageBefore.tokens_used_today >= usageBefore.tokens_limit_daily) {
    return res.status(429).json({
      error: 'Daily token limit reached',
      ...usageBefore,
    });
  }

  // Save user message (with image data URL if provided)
  db.prepare(
    'INSERT INTO messages (conversation_id, role, content, image) VALUES (?, ?, ?, ?)'
  ).run(req.params.id, 'user', content || '', image || null);

  // Get conversation history for API
  const history = db
    .prepare(
      'SELECT role, content, image FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
    )
    .all(req.params.id);

  const apiMessages = [{ role: 'system', content: SYSTEM_PROMPT }];

  // All history *except* the just-saved current message (we'll add it below)
  for (const msg of history.slice(0, -1)) {
    if (msg.image && msg.role === 'user') {
      apiMessages.push({
        role: 'user',
        content: [
          ...(msg.content ? [{ type: 'text', text: msg.content }] : []),
          { type: 'image_url', image_url: { url: msg.image } },
        ],
      });
    } else {
      apiMessages.push({ role: msg.role, content: msg.content });
    }
  }

  // Add current message
  if (image) {
    const userContent = [];
    if (content) userContent.push({ type: 'text', text: content });
    userContent.push({ type: 'image_url', image_url: { url: image } });
    apiMessages.push({ role: 'user', content: userContent });
  } else {
    apiMessages.push({ role: 'user', content });
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const writeEvent = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  let finalAssistantContent = '';

  try {
    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      const stream = await openai.chat.completions.create({
        model: conversation.model || DEFAULT_MODEL,
        messages: apiMessages,
        tools: AI_TOOLS,
        stream: true,
        stream_options: { include_usage: true },
      });

      let contentSoFar = '';
      const toolCallsByIndex = {};
      let finishReason = null;
      let usage = null;

      for await (const chunk of stream) {
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta || {};
        if (choice.finish_reason) finishReason = choice.finish_reason;

        if (delta.content) {
          contentSoFar += delta.content;
          writeEvent({ content: delta.content });
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallsByIndex[idx]) {
              toolCallsByIndex[idx] = {
                id: tc.id || '',
                type: 'function',
                function: { name: '', arguments: '' },
              };
            }
            if (tc.id) toolCallsByIndex[idx].id = tc.id;
            if (tc.function?.name) toolCallsByIndex[idx].function.name += tc.function.name;
            if (tc.function?.arguments) {
              toolCallsByIndex[idx].function.arguments += tc.function.arguments;
            }
          }
        }
      }

      if (usage?.total_tokens) {
        addTokens(req.user.uid, usage.total_tokens);
      }

      if (finishReason === 'tool_calls') {
        const toolCallsArr = Object.values(toolCallsByIndex);

        // Add the assistant turn (with tool_calls) to the message history
        apiMessages.push({
          role: 'assistant',
          content: contentSoFar || null,
          tool_calls: toolCallsArr.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        });

        // Execute each tool call and append a "tool" message
        for (const tc of toolCallsArr) {
          let parsedArgs = {};
          try {
            parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
          } catch {
            parsedArgs = {};
          }
          writeEvent({
            event: 'tool_call',
            tool_call_id: tc.id,
            name: tc.function.name,
            arguments: parsedArgs,
          });
          const result = await runToolCall(req.user.uid, tc.function.name, parsedArgs);
          writeEvent({
            event: 'tool_result',
            tool_call_id: tc.id,
            name: tc.function.name,
            result,
          });
          // Tool result fed back to the AI (truncated for safety)
          const resultStr = JSON.stringify(result);
          apiMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: resultStr.length > 16000 ? resultStr.slice(0, 16000) + '…[truncated]' : resultStr,
          });
        }

        // Continue the loop so the model can produce a follow-up response
        continue;
      }

      // No more tool calls — this was the final text answer
      finalAssistantContent = contentSoFar;
      break;
    }

    // Persist the final assistant message
    db.prepare(
      'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)'
    ).run(req.params.id, 'assistant', finalAssistantContent || '');

    // Update conversation title from the first user message if needed
    const userMessagesCount = db
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND role = 'user'")
      .get(req.params.id).n;
    if (userMessagesCount === 1 && content) {
      const title = content.length > 50 ? content.substring(0, 50) + '...' : content;
      db.prepare(
        'UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(title, req.params.id);
    } else {
      db.prepare(
        'UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(req.params.id);
    }

    const usageAfter = getUsage(req.user.uid);
    writeEvent({ event: 'usage', ...usageAfter });
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('AI API error:', error);
    writeEvent({ error: error?.message || 'AI request failed' });
    res.end();
  }
});

// Delete conversation
chatRouter.delete('/conversations/:id', (req, res) => {
  const db = getDB();

  const conversation = db
    .prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.uid);

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(req.params.id);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);

  res.json({ success: true });
});

// Allow user to view their daily limit (for client side display)
chatRouter.get('/limits', (req, res) => {
  const usage = getUsage(req.user.uid);
  res.json({ ...usage, default_limit: DEFAULT_DAILY_TOKEN_LIMIT });
});
