import jwt from 'jsonwebtoken';
import { getDB } from '../db.js';

let cachedKeys = null;
let cacheExpiry = 0;

async function getGooglePublicKeys() {
  if (cachedKeys && Date.now() < cacheExpiry) return cachedKeys;

  const res = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  const keys = await res.json();

  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;
  cacheExpiry = Date.now() + maxAge * 1000;
  cachedKeys = keys;

  return keys;
}

export async function verifyAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const idToken = authHeader.split('Bearer ')[1];
  if (!idToken || idToken === 'null') {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || 'suzu-ai-39dc5';

  try {
    const decoded = jwt.decode(idToken, { complete: true });
    if (!decoded || !decoded.header || !decoded.header.kid) {
      return res.status(401).json({ error: 'Invalid token format' });
    }

    const keys = await getGooglePublicKeys();
    const publicKey = keys[decoded.header.kid];
    if (!publicKey) {
      return res.status(401).json({ error: 'Unknown signing key' });
    }

    const payload = jwt.verify(idToken, publicKey, {
      algorithms: ['RS256'],
      audience: projectId,
      issuer: `https://securetoken.google.com/${projectId}`,
    });

    // Upsert user in database
    const db = getDB();
    db.prepare(`
      INSERT INTO users (id, email, display_name, photo_url)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        email = excluded.email,
        display_name = excluded.display_name,
        photo_url = excluded.photo_url
    `).run(
      payload.sub,
      payload.email,
      payload.name || payload.email?.split('@')[0],
      payload.picture || null
    );

    req.user = {
      uid: payload.sub,
      email: payload.email,
      name: payload.name || payload.email?.split('@')[0],
    };

    next();
  } catch (error) {
    console.error('Auth error:', error.message);
    return res.status(401).json({ error: 'Authentication failed' });
  }
}
