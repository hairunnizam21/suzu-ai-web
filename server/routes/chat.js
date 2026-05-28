import { Router } from 'express';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { verifyAuth } from '../middleware/auth.js';
import { getDB } from '../db.js';

export const chatRouter = Router();

// All chat routes require auth
chatRouter.use(verifyAuth);

const openai = new OpenAI({
  apiKey: process.env.AI_API_KEY,
  baseURL: process.env.AI_API_BASE_URL || 'https://core.fiqstr.com/v1',
});

// Get all conversations for a user
chatRouter.get('/conversations', (req, res) => {
  const db = getDB();
  const conversations = db.prepare(
    'SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC'
  ).all(req.user.uid);
  res.json({ conversations });
});

// Create new conversation
chatRouter.post('/conversations', (req, res) => {
  const db = getDB();
  const id = uuidv4();
  const model = req.body.model || process.env.AI_DEFAULT_MODEL || 'fiqstr/claude-sonnet-4.6';

  db.prepare(
    'INSERT INTO conversations (id, user_id, title, model) VALUES (?, ?, ?, ?)'
  ).run(id, req.user.uid, 'New Chat', model);

  const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  res.json({ conversation });
});

// Get messages in a conversation
chatRouter.get('/conversations/:id/messages', (req, res) => {
  const db = getDB();

  // Verify conversation belongs to user
  const conversation = db.prepare(
    'SELECT * FROM conversations WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.uid);

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  const messages = db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(req.params.id);

  res.json({ messages, conversation });
});

// Send message and get AI response (streaming)
chatRouter.post('/conversations/:id/messages', async (req, res) => {
  const db = getDB();
  const { content } = req.body;

  // Verify conversation belongs to user
  const conversation = db.prepare(
    'SELECT * FROM conversations WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.uid);

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  // Save user message
  db.prepare(
    'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)'
  ).run(req.params.id, 'user', content);

  // Get conversation history
  const history = db.prepare(
    'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(req.params.id);

  // Set up SSE for streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = await openai.chat.completions.create({
      model: conversation.model || process.env.AI_DEFAULT_MODEL || 'fiqstr/claude-sonnet-4.6',
      messages: [
        { role: 'system', content: 'You are Suzu AI, a helpful and intelligent assistant. Respond in the same language the user uses. Be concise and helpful.' },
        ...history,
      ],
      stream: true,
    });

    let fullResponse = '';

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) {
        fullResponse += delta;
        res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
      }
    }

    // Save assistant response
    db.prepare(
      'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)'
    ).run(req.params.id, 'assistant', fullResponse);

    // Update conversation title if first message
    if (history.length === 1) {
      const title = content.length > 50 ? content.substring(0, 50) + '...' : content;
      db.prepare(
        'UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(title, req.params.id);
    } else {
      db.prepare(
        'UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(req.params.id);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('AI API error:', error);
    res.write(`data: ${JSON.stringify({ error: error.message || 'AI request failed' })}\n\n`);
    res.end();
  }
});

// Delete conversation
chatRouter.delete('/conversations/:id', (req, res) => {
  const db = getDB();

  const conversation = db.prepare(
    'SELECT * FROM conversations WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.uid);

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(req.params.id);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);

  res.json({ success: true });
});
