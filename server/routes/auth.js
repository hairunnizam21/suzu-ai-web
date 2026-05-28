import { Router } from 'express';
import { verifyAuth } from '../middleware/auth.js';

export const authRouter = Router();

// Verify token and return user profile
authRouter.get('/me', verifyAuth, (req, res) => {
  res.json({ user: req.user });
});
