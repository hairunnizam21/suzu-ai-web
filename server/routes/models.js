import { Router } from 'express';
import { verifyAuth } from '../middleware/auth.js';

export const modelsRouter = Router();

modelsRouter.use(verifyAuth);

// Available models from Fiqstr API
const AVAILABLE_MODELS = [
  { id: 'fiqstr/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', provider: 'Anthropic' },
  { id: 'fiqstr/claude-sonnet-4.6-thinking', name: 'Claude Sonnet 4.6 Thinking', provider: 'Anthropic' },
  { id: 'fiqstr/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', provider: 'Anthropic' },
  { id: 'fiqstr/claude-sonnet-4.5-thinking', name: 'Claude Sonnet 4.5 Thinking', provider: 'Anthropic' },
  { id: 'fiqstr/claude-opus-4.7', name: 'Claude Opus 4.7', provider: 'Anthropic' },
  { id: 'fiqstr/claude-opus-4.7-thinking', name: 'Claude Opus 4.7 Thinking', provider: 'Anthropic' },
  { id: 'fiqstr/claude-opus-4.6', name: 'Claude Opus 4.6', provider: 'Anthropic' },
  { id: 'fiqstr/claude-opus-4.6-thinking', name: 'Claude Opus 4.6 Thinking', provider: 'Anthropic' },
  { id: 'fiqstr/gpt-5.5', name: 'GPT 5.5', provider: 'OpenAI' },
  { id: 'fiqstr/gpt-5.4', name: 'GPT 5.4', provider: 'OpenAI' },
];

modelsRouter.get('/', (req, res) => {
  res.json({ models: AVAILABLE_MODELS });
});
