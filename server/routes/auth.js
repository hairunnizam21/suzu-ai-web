import { Router } from 'express';
import { verifyAuth } from '../middleware/auth.js';
import { getUsage } from '../db.js';

export const authRouter = Router();

// Verify token and return user profile + daily token usage
authRouter.get('/me', verifyAuth, (req, res) => {
  const usage = getUsage(req.user.uid);
  res.json({ user: req.user, usage });
});

