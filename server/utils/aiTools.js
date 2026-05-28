import fs from 'fs';
import path from 'path';
import { getDB } from '../db.js';
import {
  getOriginalApkPath,
  getDecompiledPath,
  decompile,
  recompileAndSign,
  listTree,
  safeResolve,
  isProbablyText,
} from './apkTools.js';

const MAX_SEARCH_HITS = 60;
const MAX_SEARCH_BYTES_PER_FILE = 2 * 1024 * 1024; // 2 MB per file scanned

/**
 * OpenAI/Fiqstr-compatible function tool definitions.
 * The model may decide to call any of these.
 */
export const AI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'apk_list_projects',
      description:
        'List all APK projects belonging to the current user (id, name, status). Use this when the user mentions an APK without saying which one.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apk_decompile',
      description:
        'Run apktool to decompile the original APK of a project. Must be done once before reading/editing/recompiling. Use the projectId returned from the upload step.',
      parameters: {
        type: 'object',
        properties: { project_id: { type: 'string', description: 'UUID of the APK project.' } },
        required: ['project_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apk_list_files',
      description:
        'List files and directories inside the decompiled APK project. Returns up to 500 entries. Optionally filter by a path prefix.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          prefix: {
            type: 'string',
            description: 'Optional prefix to filter results, e.g. "smali/" or "res/values".',
          },
        },
        required: ['project_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apk_read_file',
      description:
        'Read the text content of a single file in the decompiled project (e.g. AndroidManifest.xml, smali, xml, json). Files larger than 200KB are truncated.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          path: { type: 'string', description: 'Path relative to the decompiled project root.' },
        },
        required: ['project_id', 'path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apk_edit_file',
      description:
        'Overwrite the text content of a single file in the decompiled project. Use after reading and deciding on a modification.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          path: { type: 'string' },
          content: { type: 'string', description: 'Full new file content.' },
        },
        required: ['project_id', 'path', 'content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apk_search',
      description:
        'Grep-style search across all decompiled text files. Returns up to 60 matches with file path, line number and matched line. Use this to find URLs, suspicious API calls (e.g. "sendTextMessage", "Runtime;->exec"), package references, etc.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          pattern: {
            type: 'string',
            description: 'Case-insensitive substring or simple regex (JS syntax) to search for.',
          },
          path_prefix: {
            type: 'string',
            description: 'Optional path prefix to limit the search (e.g. "smali/" or "res/values").',
          },
        },
        required: ['project_id', 'pattern'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apk_info',
      description:
        'Quick summary of a decompiled APK: package name, version, min/target SDK, requested permissions, activities, services, receivers, providers. Reads AndroidManifest.xml and apktool.yml.',
      parameters: {
        type: 'object',
        properties: { project_id: { type: 'string' } },
        required: ['project_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apk_recompile',
      description:
        'Rebuild the APK from the decompiled project (apktool b + zipalign + apksigner debug-sign). Returns a download URL for the user.',
      parameters: {
        type: 'object',
        properties: { project_id: { type: 'string' } },
        required: ['project_id'],
        additionalProperties: false,
      },
    },
  },
];

const MAX_READ_BYTES = 200 * 1024; // 200 KB returned to the AI to limit context blowup
const MAX_WRITE_BYTES = 1 * 1024 * 1024; // 1 MB max edit
const MAX_TREE_ENTRIES = 500;

function getProject(userId, projectId) {
  if (!projectId) return null;
  const db = getDB();
  return db
    .prepare('SELECT * FROM apk_projects WHERE id = ? AND user_id = ?')
    .get(projectId, userId);
}

async function execListProjects(userId) {
  const db = getDB();
  const rows = db
    .prepare(
      'SELECT id, name, status, original_filename, original_size, created_at FROM apk_projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50'
    )
    .all(userId);
  return { projects: rows };
}

async function execDecompile(userId, projectId) {
  const project = getProject(userId, projectId);
  if (!project) return { ok: false, error: 'Project not found' };
  const apk = getOriginalApkPath(userId, projectId);
  const outDir = getDecompiledPath(userId, projectId);
  const { code, log } = await decompile(apk, outDir);
  const db = getDB();
  if (code !== 0) {
    db.prepare(
      "UPDATE apk_projects SET status='decompile_failed', decompile_log=?, updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).run(log, projectId);
    return { ok: false, error: 'Decompile failed', log: log.slice(-4000) };
  }
  db.prepare(
    "UPDATE apk_projects SET status='decompiled', decompile_log=?, updated_at=CURRENT_TIMESTAMP WHERE id=?"
  ).run(log, projectId);
  return { ok: true, message: 'Decompiled successfully' };
}

async function execListFiles(userId, projectId, prefix) {
  const project = getProject(userId, projectId);
  if (!project) return { ok: false, error: 'Project not found' };
  const dir = getDecompiledPath(userId, projectId);
  if (!fs.existsSync(dir)) return { ok: false, error: 'Project is not decompiled yet' };
  let tree = await listTree(dir);
  if (prefix && typeof prefix === 'string') {
    tree = tree.filter((e) => e.path.startsWith(prefix));
  }
  const truncated = tree.length > MAX_TREE_ENTRIES;
  if (truncated) tree = tree.slice(0, MAX_TREE_ENTRIES);
  return { ok: true, count: tree.length, truncated, entries: tree };
}

async function execReadFile(userId, projectId, relPath) {
  const project = getProject(userId, projectId);
  if (!project) return { ok: false, error: 'Project not found' };
  const dir = getDecompiledPath(userId, projectId);
  if (!fs.existsSync(dir)) return { ok: false, error: 'Project is not decompiled yet' };
  let abs;
  try {
    abs = safeResolve(dir, relPath);
  } catch {
    return { ok: false, error: 'Invalid path' };
  }
  try {
    const stat = await fs.promises.stat(abs);
    if (stat.isDirectory()) return { ok: false, error: 'Path is a directory' };
    if (!isProbablyText(abs)) {
      return { ok: true, path: relPath, size: stat.size, binary: true, content: null };
    }
    const buf = await fs.promises.readFile(abs);
    const truncated = buf.length > MAX_READ_BYTES;
    const slice = truncated ? buf.subarray(0, MAX_READ_BYTES) : buf;
    return {
      ok: true,
      path: relPath,
      size: stat.size,
      binary: false,
      truncated,
      content: slice.toString('utf8'),
    };
  } catch (err) {
    return { ok: false, error: err?.message || 'Read failed' };
  }
}

async function execEditFile(userId, projectId, relPath, content) {
  const project = getProject(userId, projectId);
  if (!project) return { ok: false, error: 'Project not found' };
  if (typeof content !== 'string') return { ok: false, error: 'content must be a string' };
  if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) {
    return { ok: false, error: 'content too large (max 1 MB)' };
  }
  const dir = getDecompiledPath(userId, projectId);
  if (!fs.existsSync(dir)) return { ok: false, error: 'Project is not decompiled yet' };
  let abs;
  try {
    abs = safeResolve(dir, relPath);
  } catch {
    return { ok: false, error: 'Invalid path' };
  }
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, content, 'utf8');
  const stat = await fs.promises.stat(abs);
  const db = getDB();
  db.prepare('UPDATE apk_projects SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(projectId);
  return { ok: true, path: relPath, size: stat.size };
}

async function execRecompile(userId, projectId) {
  const project = getProject(userId, projectId);
  if (!project) return { ok: false, error: 'Project not found' };
  const dir = getDecompiledPath(userId, projectId);
  if (!fs.existsSync(dir)) return { ok: false, error: 'Project is not decompiled yet' };
  const db = getDB();
  db.prepare("UPDATE apk_projects SET status='recompiling', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(projectId);
  const { ok, log } = await recompileAndSign(userId, projectId);
  if (!ok) {
    db.prepare(
      "UPDATE apk_projects SET status='recompile_failed', recompile_log=?, updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).run(log, projectId);
    return { ok: false, error: 'Recompile failed', log: log.slice(-4000) };
  }
  db.prepare(
    "UPDATE apk_projects SET status='recompiled', recompile_log=?, updated_at=CURRENT_TIMESTAMP WHERE id=?"
  ).run(log, projectId);
  return {
    ok: true,
    message: 'Recompiled and signed successfully',
    downloadUrl: `/api/apk/projects/${projectId}/download`,
  };
}

async function execSearch(userId, projectId, pattern, pathPrefix) {
  const project = getProject(userId, projectId);
  if (!project) return { ok: false, error: 'Project not found' };
  if (!pattern) return { ok: false, error: 'pattern is required' };
  const dir = getDecompiledPath(userId, projectId);
  if (!fs.existsSync(dir)) return { ok: false, error: 'Project is not decompiled yet' };

  let regex;
  try {
    regex = new RegExp(pattern, 'i');
  } catch {
    // Fallback: literal substring
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    regex = new RegExp(escaped, 'i');
  }

  const tree = await listTree(dir);
  const candidates = tree.filter((e) => {
    if (e.type !== 'file') return false;
    if (pathPrefix && !e.path.startsWith(pathPrefix)) return false;
    if (!isProbablyText(e.path)) return false;
    if (e.size > MAX_SEARCH_BYTES_PER_FILE) return false;
    return true;
  });

  const hits = [];
  let scanned = 0;
  for (const entry of candidates) {
    if (hits.length >= MAX_SEARCH_HITS) break;
    scanned++;
    let content;
    try {
      content = await fs.promises.readFile(safeResolve(dir, entry.path), 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        hits.push({
          path: entry.path,
          line: i + 1,
          text: lines[i].length > 240 ? lines[i].slice(0, 240) + '…' : lines[i],
        });
        if (hits.length >= MAX_SEARCH_HITS) break;
      }
    }
  }

  return { ok: true, pattern, scanned_files: scanned, total_hits: hits.length, truncated: hits.length >= MAX_SEARCH_HITS, hits };
}

function parseManifest(xml) {
  // Lightweight regex-based extraction — AndroidManifest.xml after apktool d is plain XML.
  const out = {};
  const pkg = xml.match(/<manifest[^>]*\bpackage="([^"]+)"/);
  if (pkg) out.package = pkg[1];
  const ver = xml.match(/android:versionName="([^"]+)"/);
  if (ver) out.versionName = ver[1];
  const verCode = xml.match(/android:versionCode="([^"]+)"/);
  if (verCode) out.versionCode = verCode[1];
  const minSdk = xml.match(/android:minSdkVersion="([^"]+)"/);
  if (minSdk) out.minSdk = minSdk[1];
  const targetSdk = xml.match(/android:targetSdkVersion="([^"]+)"/);
  if (targetSdk) out.targetSdk = targetSdk[1];
  const perms = [...xml.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)].map((m) => m[1]);
  out.permissions = perms;
  const activities = [...xml.matchAll(/<activity[^>]*android:name="([^"]+)"/g)].map((m) => m[1]);
  const services = [...xml.matchAll(/<service[^>]*android:name="([^"]+)"/g)].map((m) => m[1]);
  const receivers = [...xml.matchAll(/<receiver[^>]*android:name="([^"]+)"/g)].map((m) => m[1]);
  const providers = [...xml.matchAll(/<provider[^>]*android:name="([^"]+)"/g)].map((m) => m[1]);
  out.activities = activities;
  out.services = services;
  out.receivers = receivers;
  out.providers = providers;
  return out;
}

async function execInfo(userId, projectId) {
  const project = getProject(userId, projectId);
  if (!project) return { ok: false, error: 'Project not found' };
  const dir = getDecompiledPath(userId, projectId);
  if (!fs.existsSync(dir)) return { ok: false, error: 'Project is not decompiled yet' };
  const manifestPath = path.join(dir, 'AndroidManifest.xml');
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, error: 'AndroidManifest.xml not found' };
  }
  const xml = await fs.promises.readFile(manifestPath, 'utf8');
  const parsed = parseManifest(xml);
  return { ok: true, ...parsed };
}

/**
 * Run a tool call invoked by the AI. Returns a plain JSON result that will be
 * stringified and fed back as a "tool" role message.
 */
export async function runToolCall(userId, name, args) {
  try {
    switch (name) {
      case 'apk_list_projects':
        return await execListProjects(userId);
      case 'apk_decompile':
        return await execDecompile(userId, args?.project_id);
      case 'apk_list_files':
        return await execListFiles(userId, args?.project_id, args?.prefix);
      case 'apk_read_file':
        return await execReadFile(userId, args?.project_id, args?.path);
      case 'apk_edit_file':
        return await execEditFile(userId, args?.project_id, args?.path, args?.content);
      case 'apk_search':
        return await execSearch(userId, args?.project_id, args?.pattern, args?.path_prefix);
      case 'apk_info':
        return await execInfo(userId, args?.project_id);
      case 'apk_recompile':
        return await execRecompile(userId, args?.project_id);
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { ok: false, error: err?.message || 'Tool execution failed' };
  }
}
