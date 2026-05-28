import { getEnvVar } from '../utils/envFile.js';

export function verifyAdmin(req, res, next) {
  const expected = (getEnvVar('SUZU_ADMIN_TOKEN') || process.env.SUZU_ADMIN_TOKEN || '').trim();
  if (!expected) {
    return res
      .status(503)
      .json({ error: 'Admin token not configured. Set SUZU_ADMIN_TOKEN in the server .env.' });
  }
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : (req.headers['x-admin-token'] || '').trim();
  if (!token || token !== expected) {
    return res.status(401).json({ error: 'Invalid admin token' });
  }
  next();
}
