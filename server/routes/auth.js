import { Router } from 'express';
import { verifyAuth } from '../middleware/auth.js';
import { getUsage, getPlan } from '../db.js';

export const authRouter = Router();

// Verify token and return user profile + daily token usage + plan
authRouter.get('/me', verifyAuth, (req, res) => {
  const usage = getUsage(req.user.uid);
  const { plan, plan_expires_at } = getPlan(req.user.uid);
  res.json({ user: req.user, usage, plan, plan_expires_at });
});

