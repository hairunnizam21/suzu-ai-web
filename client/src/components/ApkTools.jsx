import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  apkDecompile,
  apkDelete,
  apkDownloadBlob,
  apkList,
  apkReadFile,
  apkRecompile,
  apkTree,
  apkUpload,
  apkWriteFile,
} from '../api';

function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function statusLabel(s) {
  return {
    uploaded: 'Uploaded',
    decompiling: 'Decompiling…',
    decompiled: 'Decompiled',
    decompile_failed: 'Decompile failed',
    recompiling: 'Recompiling…',
    recompiled: 'Recompiled',
    recompile_failed: 'Recompile failed',
  }[s] || s || '';
}

function FileTree({ entries, onSelect, selected }) {
  // Group by directory
  const sorted = useMemo(() => {
    return [...entries].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
  }, [entries]);

  const [collapsed, setCollapsed] = useState(new Set());

  const toggle = (path) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const isHidden = (path) => {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/');
      if (collapsed.has(parent)) return true;
    }
    return false;
  };

  return (
    <div className="apk-tree">
      {sorted.map((e) => {
        if (isHidden(e.path)) return null;
        const depth = e.path.split('/').length - 1;
        return (
          <div
            key={e.path}
            className={`apk-tree-row ${e.type} ${selected === e.path ? 'selected' : ''}`}
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={() => {
              if (e.type === 'dir') toggle(e.path);
              else onSelect(e.path);
            }}
          >
            <span className="apk-tree-icon">{e.type === 'dir' ? (collapsed.has(e.path) ? '▶' : '▼') : '📄'}</span>
            <span className="apk-tree-name">{e.path.split('/').pop()}</span>
            {e.type === 'file' && (
              <span className="apk-tree-size">{formatSize(e.size)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ApkTools() {
  const [projects, setProjects] = useState([]);
  const [active, setActive] = useState(null);
  const [tree, setTree] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [fileMeta, setFileMeta] = useState(null);
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [busy, setBusy] = useState(null);
  const [logs, setLogs] = useState('');
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const loadProjects = useCallback(async () => {
    try {
      const list = await apkList();
      setProjects(list);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const refreshTree = useCallback(async (projectId) => {
    try {
      const t = await apkTree(projectId);
      setTree(t);
    } catch (e) {
      // Project may not be decompiled yet
      setTree([]);
      if (!String(e.message).includes('not decompiled')) setError(e.message);
    }
  }, []);

  const handleSelectProject = useCallback(
    async (p) => {
      setActive(p);
      setSelectedFile(null);
      setFileContent('');
      setFileMeta(null);
      setLogs('');
      setError(null);
      await refreshTree(p.id);
    },
    [refreshTree]
  );

  const handleUpload = async (file) => {
    if (!file) return;
    setError(null);
    setUploading(true);
    setUploadProgress(0);
    try {
      const project = await apkUpload(file, (frac) => setUploadProgress(frac));
      await loadProjects();
      const list = await apkList();
      const created = list.find((p) => p.id === project.id) || project;
      setProjects(list);
      await handleSelectProject(created);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileChange = (e) => {
    handleUpload(e.target.files?.[0]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    handleUpload(f);
  };

  const handleDecompile = async () => {
    if (!active) return;
    setBusy('decompile');
    setError(null);
    setLogs('Running apktool d …\n');
    try {
      const result = await apkDecompile(active.id);
      setLogs(result.log || 'Done.');
      await loadProjects();
      await refreshTree(active.id);
      setActive((p) => p && { ...p, status: 'decompiled' });
    } catch (e) {
      setError(e.message);
      setLogs((prev) => prev + '\n' + (e.message || ''));
    } finally {
      setBusy(null);
    }
  };

  const handleRecompile = async () => {
    if (!active) return;
    setBusy('recompile');
    setError(null);
    setLogs('Running apktool b + zipalign + apksigner …\n');
    try {
      const result = await apkRecompile(active.id);
      setLogs(result.log || 'Done.');
      await loadProjects();
      setActive((p) => p && { ...p, status: 'recompiled' });
    } catch (e) {
      setError(e.message);
      setLogs((prev) => prev + '\n' + (e.message || ''));
    } finally {
      setBusy(null);
    }
  };

  const handleDownload = async () => {
    if (!active) return;
    try {
      await apkDownloadBlob(active.id, (active.name || 'app').replace(/\.apk$/i, '') + '_modded.apk');
    } catch (e) {
      setError(e.message);
    }
  };

  const handleDelete = async (project) => {
    if (!confirm(`Delete project "${project.name}"? This removes the uploaded and decompiled files from the server.`)) return;
    try {
      await apkDelete(project.id);
      if (active?.id === project.id) {
        setActive(null);
        setTree([]);
        setSelectedFile(null);
        setFileContent('');
      }
      await loadProjects();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleSelectFile = async (relPath) => {
    if (!active) return;
    setSelectedFile(relPath);
    setEditing(false);
    setFileContent('');
    setFileMeta(null);
    try {
      const data = await apkReadFile(active.id, relPath);
      setFileMeta(data);
      setFileContent(data.binary ? '' : (data.content || ''));
    } catch (e) {
      setError(e.message);
    }
  };

  const handleSaveFile = async () => {
    if (!active || !selectedFile) return;
    try {
      await apkWriteFile(active.id, selectedFile, fileContent);
      setEditing(false);
    } catch (e) {
      setError(e.message);
    }
  };

  const canDecompile = active && ['uploaded', 'decompile_failed', 'recompiled', 'recompiling', 'recompile_failed'].includes(active.status);
  const canRecompile = active && tree.length > 0;
  const canDownload = active && active.status === 'recompiled';

  return (
    <div className="apk-tools">
      <div className="apk-sidebar">
        <div className="apk-upload">
          <label
            className="apk-dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".apk,.xapk,application/vnd.android.package-archive"
              onChange={handleFileChange}
              hidden
            />
            <div className="apk-dropzone-inner">
              {uploading ? (
                <>
                  <div className="apk-progress">
                    <div className="apk-progress-bar" style={{ width: `${Math.round(uploadProgress * 100)}%` }} />
                  </div>
                  <div className="apk-progress-text">Uploading… {Math.round(uploadProgress * 100)}%</div>
                </>
              ) : (
                <>
                  <div className="apk-dropzone-icon">📦</div>
                  <div className="apk-dropzone-title">Drop APK here or click to upload</div>
                  <div className="apk-dropzone-hint">.apk / .xapk (max 200 MB)</div>
                </>
              )}
            </div>
          </label>
        </div>

        <div className="apk-projects">
          <div className="apk-projects-title">Projects</div>
          {projects.length === 0 && <div className="apk-empty">No projects yet</div>}
          {projects.map((p) => (
            <div
              key={p.id}
              className={`apk-project-item ${active?.id === p.id ? 'active' : ''}`}
              onClick={() => handleSelectProject(p)}
            >
              <div className="apk-project-row">
                <span className="apk-project-name">{p.name}</span>
                <button
                  className="apk-project-del"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(p);
                  }}
                  title="Delete project"
                >
                  ×
                </button>
              </div>
              <div className="apk-project-meta">
                {statusLabel(p.status)} · {formatSize(p.original_size)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="apk-main">
        {!active && (
          <div className="apk-placeholder">
            <h2>APK Tools</h2>
            <p>Upload an APK, decompile it, edit smali / xml / resources, then recompile and download.</p>
            <p>You can also ask the AI in the chat — it can run these same tools for you.</p>
          </div>
        )}

        {active && (
          <>
            <div className="apk-actions-bar">
              <div className="apk-active-name">{active.name}</div>
              <div className="apk-active-status">{statusLabel(active.status)}</div>
              <div className="apk-actions-spacer" />
              <button className="apk-btn" disabled={!canDecompile || busy} onClick={handleDecompile}>
                {busy === 'decompile' ? 'Decompiling…' : 'Decompile'}
              </button>
              <button className="apk-btn primary" disabled={!canRecompile || busy} onClick={handleRecompile}>
                {busy === 'recompile' ? 'Recompiling…' : 'Recompile + Sign'}
              </button>
              <button className="apk-btn success" disabled={!canDownload} onClick={handleDownload}>
                Download APK
              </button>
            </div>

            <div className="apk-workspace">
              <div className="apk-tree-pane">
                {tree.length === 0 ? (
                  <div className="apk-empty">Run "Decompile" to populate the file tree.</div>
                ) : (
                  <FileTree entries={tree} onSelect={handleSelectFile} selected={selectedFile} />
                )}
              </div>
              <div className="apk-editor-pane">
                {!selectedFile && <div className="apk-empty">Select a file to view or edit.</div>}
                {selectedFile && (
                  <>
                    <div className="apk-editor-header">
                      <span className="apk-editor-path">{selectedFile}</span>
                      {fileMeta?.binary ? (
                        <span className="apk-editor-binary">Binary file (preview not available)</span>
                      ) : editing ? (
                        <>
                          <button className="apk-btn" onClick={() => setEditing(false)}>Cancel</button>
                          <button className="apk-btn primary" onClick={handleSaveFile}>Save</button>
                        </>
                      ) : (
                        <button className="apk-btn" onClick={() => setEditing(true)}>Edit</button>
                      )}
                    </div>
                    {fileMeta?.binary ? null : editing ? (
                      <textarea
                        className="apk-editor-textarea"
                        value={fileContent}
                        onChange={(e) => setFileContent(e.target.value)}
                        spellCheck={false}
                      />
                    ) : (
                      <pre className="apk-editor-pre">{fileContent}</pre>
                    )}
                  </>
                )}
              </div>
            </div>

            {logs && (
              <details className="apk-logs" open>
                <summary>Build log</summary>
                <pre>{logs}</pre>
              </details>
            )}
          </>
        )}

        {error && <div className="apk-error">{error}</div>}
      </div>
    </div>
  );
}
