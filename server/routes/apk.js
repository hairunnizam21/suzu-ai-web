import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { verifyAuth } from '../middleware/auth.js';
import { getDB } from '../db.js';
import {
  APK_WORKSPACE_ROOT,
  ensureProjectDir,
  getProjectPath,
  getOriginalApkPath,
  getDecompiledPath,
  getRecompiledApkPath,
  decompile,
  recompileAndSign,
  listTree,
  safeResolve,
  isProbablyText,
} from '../utils/apkTools.js';

export const apkRouter = Router();

apkRouter.use(verifyAuth);

const MAX_APK_SIZE = parseInt(process.env.APK_MAX_UPLOAD_MB || '200', 10) * 1024 * 1024;
const MAX_TEXT_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

// Storage that places the file in the project workspace under a UUID-named directory.
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const projectId = uuidv4();
      req.apkProjectId = projectId;
      const dir = await ensureProjectDir(req.user.uid, projectId);
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => cb(null, 'original.apk'),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_APK_SIZE },
  fileFilter: (req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    if (!name.endsWith('.apk') && !name.endsWith('.xapk')) {
      return cb(new Error('Only .apk files are accepted'));
    }
    cb(null, true);
  },
});

function ownedProject(req) {
  const db = getDB();
  const row = db
    .prepare('SELECT * FROM apk_projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.uid);
  return row || null;
}

// List user's APK projects
apkRouter.get('/projects', (req, res) => {
  const db = getDB();
  const rows = db
    .prepare(
      'SELECT id, name, original_filename, original_size, status, created_at, updated_at FROM apk_projects WHERE user_id = ? ORDER BY updated_at DESC'
    )
    .all(req.user.uid);
  res.json({ projects: rows });
});

// Upload an APK file
apkRouter.post('/upload', (req, res) => {
  upload.single('apk')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const db = getDB();
    const projectId = req.apkProjectId;
    const name = (req.body?.name || req.file.originalname || 'project.apk').replace(/[\r\n]/g, '').slice(0, 200);
    db.prepare(
      `INSERT INTO apk_projects (id, user_id, name, original_filename, original_size, status)
       VALUES (?, ?, ?, ?, ?, 'uploaded')`
    ).run(projectId, req.user.uid, name, req.file.originalname, req.file.size);

    res.json({
      project: {
        id: projectId,
        name,
        original_filename: req.file.originalname,
        original_size: req.file.size,
        status: 'uploaded',
      },
    });
  });
});

// Run apktool decompile
apkRouter.post('/projects/:id/decompile', async (req, res) => {
  const project = ownedProject(req);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const db = getDB();
  db.prepare("UPDATE apk_projects SET status = 'decompiling', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
    project.id
  );

  const apkPath = getOriginalApkPath(req.user.uid, project.id);
  const outDir = getDecompiledPath(req.user.uid, project.id);

  try {
    const { code, log } = await decompile(apkPath, outDir);
    if (code !== 0) {
      db.prepare(
        "UPDATE apk_projects SET status = 'decompile_failed', decompile_log = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(log, project.id);
      return res.status(500).json({ error: 'Decompile failed', log });
    }
    db.prepare(
      "UPDATE apk_projects SET status = 'decompiled', decompile_log = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(log, project.id);
    res.json({ ok: true, log });
  } catch (err) {
    db.prepare(
      "UPDATE apk_projects SET status = 'decompile_failed', decompile_log = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(String(err?.message || err), project.id);
    res.status(500).json({ error: err?.message || 'Decompile error' });
  }
});

// File tree of the decompiled project
apkRouter.get('/projects/:id/tree', async (req, res) => {
  const project = ownedProject(req);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const dir = getDecompiledPath(req.user.uid, project.id);
  if (!fs.existsSync(dir)) {
    return res.status(409).json({ error: 'Project is not decompiled yet' });
  }
  const tree = await listTree(dir);
  res.json({ tree });
});

// Read a single file from the decompiled tree
apkRouter.get('/projects/:id/file', async (req, res) => {
  const project = ownedProject(req);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const rel = req.query.path;
  if (typeof rel !== 'string' || !rel) {
    return res.status(400).json({ error: 'path query param is required' });
  }

  const dir = getDecompiledPath(req.user.uid, project.id);
  let abs;
  try {
    abs = safeResolve(dir, rel);
  } catch {
    return res.status(400).json({ error: 'Invalid path' });
  }

  try {
    const stat = await fs.promises.stat(abs);
    if (stat.isDirectory()) return res.status(400).json({ error: 'Path is a directory' });
    if (stat.size > MAX_TEXT_FILE_SIZE) {
      return res.status(413).json({ error: 'File too large to preview', size: stat.size });
    }
    if (!isProbablyText(abs)) {
      return res.json({ path: rel, size: stat.size, binary: true });
    }
    const content = await fs.promises.readFile(abs, 'utf8');
    res.json({ path: rel, size: stat.size, binary: false, content });
  } catch (err) {
    res.status(404).json({ error: 'File not found', detail: err?.message });
  }
});

// Write/overwrite a single text file in the decompiled tree
apkRouter.put('/projects/:id/file', async (req, res) => {
  const project = ownedProject(req);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const rel = req.body?.path;
  const content = req.body?.content;
  if (typeof rel !== 'string' || !rel || typeof content !== 'string') {
    return res.status(400).json({ error: 'path and content (string) are required' });
  }

  const dir = getDecompiledPath(req.user.uid, project.id);
  let abs;
  try {
    abs = safeResolve(dir, rel);
  } catch {
    return res.status(400).json({ error: 'Invalid path' });
  }

  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, content, 'utf8');
  const stat = await fs.promises.stat(abs);

  const db = getDB();
  db.prepare(
    'UPDATE apk_projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(project.id);

  res.json({ path: rel, size: stat.size });
});

// Recompile + zipalign + sign
apkRouter.post('/projects/:id/recompile', async (req, res) => {
  const project = ownedProject(req);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const dir = getDecompiledPath(req.user.uid, project.id);
  if (!fs.existsSync(dir)) {
    return res.status(409).json({ error: 'Project is not decompiled yet' });
  }

  const db = getDB();
  db.prepare("UPDATE apk_projects SET status = 'recompiling', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
    project.id
  );

  try {
    const { ok, log } = await recompileAndSign(req.user.uid, project.id);
    if (!ok) {
      db.prepare(
        "UPDATE apk_projects SET status = 'recompile_failed', recompile_log = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(log, project.id);
      return res.status(500).json({ error: 'Recompile failed', log });
    }
    db.prepare(
      "UPDATE apk_projects SET status = 'recompiled', recompile_log = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(log, project.id);
    res.json({ ok: true, log, downloadUrl: `/api/apk/projects/${project.id}/download` });
  } catch (err) {
    db.prepare(
      "UPDATE apk_projects SET status = 'recompile_failed', recompile_log = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(String(err?.message || err), project.id);
    res.status(500).json({ error: err?.message || 'Recompile error' });
  }
});

// Download the signed APK
apkRouter.get('/projects/:id/download', (req, res) => {
  const project = ownedProject(req);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const file = getRecompiledApkPath(req.user.uid, project.id);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'No recompiled APK available' });
  }
  const downloadName = (project.name || 'app').replace(/[^\w.\-]+/g, '_').replace(/\.apk$/i, '') + '_modded.apk';
  res.download(file, downloadName);
});

// Delete a project (and clean up its workspace)
apkRouter.delete('/projects/:id', async (req, res) => {
  const project = ownedProject(req);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const dir = getProjectPath(req.user.uid, project.id);
  await fs.promises.rm(dir, { recursive: true, force: true });

  const db = getDB();
  db.prepare('DELETE FROM apk_projects WHERE id = ?').run(project.id);

  res.json({ success: true });
});

// Expose workspace root for debugging/admin (auth required)
apkRouter.get('/__workspace_root', (req, res) => {
  res.json({ root: APK_WORKSPACE_ROOT });
});
