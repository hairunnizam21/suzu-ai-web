import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Root directory for APK workspaces. Override with APK_WORKSPACE_DIR env var.
 */
export const APK_WORKSPACE_ROOT =
  process.env.APK_WORKSPACE_DIR || path.resolve(process.cwd(), 'data', 'apk_workspaces');

/**
 * Path to the debug keystore used to sign recompiled APKs.
 */
export const DEBUG_KEYSTORE =
  process.env.APK_DEBUG_KEYSTORE ||
  path.resolve(process.cwd(), 'server', 'keystores', 'debug.keystore');

export const DEBUG_KEYSTORE_PASS = process.env.APK_DEBUG_KEYSTORE_PASS || 'android';
export const DEBUG_KEY_ALIAS = process.env.APK_DEBUG_KEY_ALIAS || 'androiddebugkey';

export function getProjectPath(userId, projectId) {
  return path.join(APK_WORKSPACE_ROOT, userId, projectId);
}

export function getOriginalApkPath(userId, projectId) {
  return path.join(getProjectPath(userId, projectId), 'original.apk');
}

export function getDecompiledPath(userId, projectId) {
  return path.join(getProjectPath(userId, projectId), 'decompiled');
}

export function getRecompiledApkPath(userId, projectId) {
  return path.join(getProjectPath(userId, projectId), 'recompiled.apk');
}

export function getUnsignedApkPath(userId, projectId) {
  return path.join(getProjectPath(userId, projectId), 'unsigned.apk');
}

export function getAlignedApkPath(userId, projectId) {
  return path.join(getProjectPath(userId, projectId), 'aligned.apk');
}

export async function ensureProjectDir(userId, projectId) {
  const dir = getProjectPath(userId, projectId);
  await fs.promises.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Run a child process and capture output. Resolves with { code, stdout, stderr }.
 * Rejects only if the process cannot be spawned.
 */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/**
 * Run `apktool d -f -o <out> <apk>`.
 */
export async function decompile(apkPath, outDir) {
  await fs.promises.rm(outDir, { recursive: true, force: true });
  const res = await run('apktool', ['d', '-f', '-o', outDir, apkPath]);
  return { ...res, log: `${res.stdout}\n${res.stderr}`.trim() };
}

/**
 * Run `apktool b -o <out> <decompiledDir>`.
 */
export async function recompileRaw(decompiledDir, outApkPath) {
  const res = await run('apktool', ['b', '-o', outApkPath, decompiledDir]);
  return { ...res, log: `${res.stdout}\n${res.stderr}`.trim() };
}

/**
 * Run `zipalign -p -f 4 <in> <out>`.
 */
export async function zipalign(inApk, outApk) {
  const res = await run('zipalign', ['-p', '-f', '4', inApk, outApk]);
  return { ...res, log: `${res.stdout}\n${res.stderr}`.trim() };
}

/**
 * Run `apksigner sign --ks <keystore> --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android <apk>`.
 */
export async function apksign(apkPath) {
  const res = await run('apksigner', [
    'sign',
    '--ks', DEBUG_KEYSTORE,
    '--ks-pass', `pass:${DEBUG_KEYSTORE_PASS}`,
    '--ks-key-alias', DEBUG_KEY_ALIAS,
    '--key-pass', `pass:${DEBUG_KEYSTORE_PASS}`,
    apkPath,
  ]);
  return { ...res, log: `${res.stdout}\n${res.stderr}`.trim() };
}

/**
 * Full recompile pipeline: apktool b -> zipalign -> apksigner.
 * Returns { ok, log, outputPath } where outputPath points at the final signed APK.
 */
export async function recompileAndSign(userId, projectId) {
  const decompiled = getDecompiledPath(userId, projectId);
  const unsigned = getUnsignedApkPath(userId, projectId);
  const aligned = getAlignedApkPath(userId, projectId);
  const signed = getRecompiledApkPath(userId, projectId);

  let log = '';

  const build = await recompileRaw(decompiled, unsigned);
  log += `[apktool b]\n${build.log}\n\n`;
  if (build.code !== 0) return { ok: false, log, outputPath: null };

  const align = await zipalign(unsigned, aligned);
  log += `[zipalign]\n${align.log}\n\n`;
  if (align.code !== 0) return { ok: false, log, outputPath: null };

  await fs.promises.copyFile(aligned, signed);
  const sign = await apksign(signed);
  log += `[apksigner]\n${sign.log}\n`;
  if (sign.code !== 0) return { ok: false, log, outputPath: null };

  // Cleanup intermediates
  await fs.promises.rm(unsigned, { force: true });
  await fs.promises.rm(aligned, { force: true });

  return { ok: true, log, outputPath: signed };
}

/**
 * Build a recursive file tree for the decompiled folder.
 * Returns array of { path, type, size }.
 */
export async function listTree(decompiledDir) {
  const entries = [];
  async function walk(dir, rel) {
    let dirents;
    try {
      dirents = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      const abs = path.join(dir, d.name);
      const relPath = path.posix.join(rel, d.name);
      if (d.isDirectory()) {
        entries.push({ path: relPath, type: 'dir' });
        await walk(abs, relPath);
      } else {
        let size = 0;
        try {
          const stat = await fs.promises.stat(abs);
          size = stat.size;
        } catch {
          // ignore
        }
        entries.push({ path: relPath, type: 'file', size });
      }
    }
  }
  await walk(decompiledDir, '');
  return entries;
}

/**
 * Resolve a relative file path inside a decompiled project safely.
 * Throws if the resolved path escapes the project root.
 */
export function safeResolve(rootDir, relPath) {
  const normalized = path.normalize(relPath).replace(/^([/\\])+/, '');
  const abs = path.resolve(rootDir, normalized);
  const relCheck = path.relative(rootDir, abs);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    throw new Error('Path escapes project root');
  }
  return abs;
}

/**
 * File extensions that we treat as text and editable.
 */
const TEXT_EXTS = new Set([
  '.smali', '.xml', '.json', '.txt', '.html', '.htm', '.js', '.css',
  '.java', '.kt', '.kts', '.gradle', '.properties', '.cfg', '.ini',
  '.md', '.yaml', '.yml', '.svg', '.csv', '.tsv', '.log', '.sh', '.bat',
]);

export function isProbablyText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTS.has(ext)) return true;
  return false;
}
