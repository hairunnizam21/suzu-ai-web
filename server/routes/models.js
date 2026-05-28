import { Router } from 'express';
import { verifyAuth } from '../middleware/auth.js';

export const modelsRouter = Router();

modelsRouter.use(verifyAuth);

// Available models from Fiqstr API
const AVAILABLE_MODELS = [
  { id: 'fiqstr/claude-opus-4.7-thinking-agentic', name: 'Claude Opus 4.7 Thinking', provider: 'Anthropic' },
  { id: 'fiqstr/gpt-5.5', name: 'GPT 5.5', provider: 'OpenAI' },
  { id: 'fiqstr/claude-sonnet-4.6-thinking-agentic', name: 'Claude Sonnet 4.6 Thinking', provider: 'Anthropic' },
];

modelsRouter.get('/', (req, res) => {
  res.json({ models: AVAILABLE_MODELS });
});
