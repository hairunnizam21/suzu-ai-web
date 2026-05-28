import { getDB } from '../db.js';

// Verify Firebase ID token via Google's public endpoint
export async function verifyAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    // Verify token with Google's tokeninfo endpoint
    const response = await fetch(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?id_token=${idToken}`
    );

    if (!response.ok) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const payload = await response.json();

    // Verify the token is for our Firebase project
    const projectId = process.env.FIREBASE_PROJECT_ID || 'suzu-ai-39dc5';
    if (payload.aud !== projectId && !payload.aud?.includes(projectId)) {
      // For Firebase tokens, check issuer instead
      if (!payload.iss?.includes('securetoken.google.com')) {
        return res.status(401).json({ error: 'Token not for this project' });
      }
    }

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
    console.error('Auth error:', error);
    return res.status(401).json({ error: 'Authentication failed' });
  }
}
