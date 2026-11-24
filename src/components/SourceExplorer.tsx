import { useEffect, useMemo, useState } from 'react';
import { Check, Download, FileCode2, FileText, Image, Save, Search } from 'lucide-react';
import { formatBytes, t } from '../lib/i18n';
import type { ApkSession, LanguageCode, WorkspaceFileNode } from '../types/apk';

interface SourceExplorerProps {
  lang: LanguageCode;
  session: ApkSession;
  initialFilePath?: string | null;
  onSessionUpdated: (session: ApkSession) => void;
}

type KindFilter = 'all' | 'source' | 'manifest' | 'web' | 'resource';

export function SourceExplorer({
  lang,
  session,
  initialFilePath,
  onSessionUpdated,
}: SourceExplorerProps) {
  const copy = t(lang);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<KindFilter>('all');
  const [selectedPath, setSelectedPath] = useState<string>(() => {
    if (initialFilePath) return initialFilePath;
    const manifestFile = session.sourceFiles.find((f) => f.path.endsWith('AndroidManifest.xml'));
    return manifestFile?.path || session.sourceFiles[0]?.path || '';
  });

  const [fileContent, setFileContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [isImage, setIsImage] = useState(false);
  const [isBinary, setIsBinary] = useState(false);
  const [imageDataUrl, setImageDataUrl] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlag, setSavedFlag] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialFilePath && session.sourceFiles.some((f) => f.path === initialFilePath)) {
      setSelectedPath(initialFilePath);
    }
  }, [initialFilePath, session.sourceFiles]);

  const filteredFiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return session.sourceFiles.filter((f) => {
      if (filter !== 'all') {
        if (filter === 'manifest' && f.kind !== 'manifest' && f.kind !== 'gradle') return false;
        if (filter !== 'manifest' && f.kind !== filter) return false;
      }
      if (q && !f.path.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [session.sourceFiles, search, filter]);

  useEffect(() => {
    if (!selectedPath) return;
    let active = true;
    setLoadingFile(true);
    setError('');
    setSavedFlag(false);

    fetch(`/api/session/${session.id}/file?path=${encodeURIComponent(selectedPath)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load file');
        return res.json();
      })
      .then((data) => {
        if (!active) return;
        setIsImage(Boolean(data.isImage));
        setIsBinary(Boolean(data.isBinary));
        setImageDataUrl(data.dataUrl || '');
        const text = data.content || '';
        setFileContent(text);
        setOriginalContent(text);
      })
      .catch((err) => {
        if (!active) return;
        setError((err as Error).message);
      })
      .finally(() => {
        if (active) setLoadingFile(false);
      });

    return () => {
      active = false;
    };
  }, [session.id, selectedPath]);

  const selectedNode: WorkspaceFileNode | undefined = session.sourceFiles.find(
    (f) => f.path === selectedPath
  );
  const isDirty = !isBinary && fileContent !== originalContent;

  const handleSave = async () => {
    if (!selectedPath || isBinary) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/session/${session.id}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedPath, content: fileContent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setOriginalContent(fileContent);
      setSavedFlag(true);
      if (data.session) onSessionUpdated(data.session);
      setTimeout(() => setSavedFlag(false), 2500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Explorer Header */}
      <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-slate-900">{copy.sourceTreeHeading}</h2>
          <span className="text-xs text-slate-500 font-mono tabular-nums">
            {filteredFiles.length} / {session.sourceFiles.length} files
          </span>
        </div>

        <div className="flex items-center gap-3">
          <a
            href={`/api/session/${session.id}/download-source`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{copy.downloadSourceZip}</span>
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[580px]">
        {/* Left Sidebar Tree */}
        <div className="lg:col-span-4 xl:col-span-3 border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col bg-slate-50/50">
          <div className="p-3 space-y-2.5 border-b border-slate-200">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter files..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg overflow-x-auto">
              {(
                [
                  ['all', 'All'],
                  ['source', 'Java'],
                  ['manifest', 'Manifest'],
                  ['web', 'Web'],
                  ['resource', 'Res'],
                ] as Array<[KindFilter, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={`px-2 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    filter === key
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[520px] divide-y divide-slate-100">
            {filteredFiles.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                No matching files in extracted project.
              </div>
            ) : (
              filteredFiles.map((node) => {
                const active = node.path === selectedPath;
                return (
                  <button
                    key={node.path}
                    type="button"
                    onClick={() => setSelectedPath(node.path)}
                    className={`w-full text-left px-3.5 py-2 flex items-center justify-between gap-2 text-xs transition-colors cursor-pointer ${
                      active
                        ? 'bg-emerald-50 text-emerald-900 font-medium'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {node.kind === 'source' ? (
                        <FileCode2 className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                      ) : node.kind === 'resource' ? (
                        <Image className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                      ) : (
                        <FileText className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                      )}
                      <span className="font-mono truncate">{node.path}</span>
                    </span>
                    <span className="font-mono tabular-nums text-[11px] text-slate-400 shrink-0">
                      {formatBytes(node.size)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Code Editor Pane */}
        <div className="lg:col-span-8 xl:col-span-9 flex flex-col bg-slate-900 text-slate-100">
          <div className="px-4 py-2.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-950/60">
            <div className="min-w-0 flex items-center gap-2 text-xs font-mono text-slate-300">
              <span className="truncate">{selectedPath || 'No file selected'}</span>
              {selectedNode && (
                <span className="text-slate-500 tabular-nums shrink-0">
                  · {formatBytes(selectedNode.size)}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {savedFlag && (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-400 whitespace-nowrap">
                  <Check className="w-3.5 h-3.5" />
                  <span>{copy.savedNotice}</span>
                </span>
              )}
              {!isBinary && selectedNode?.editable && (
                <button
                  type="button"
                  disabled={!isDirty || saving}
                  onClick={handleSave}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{copy.saveFile}</span>
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="px-4 py-2 text-xs text-red-300 bg-red-950/60 border-b border-red-900">
              {error}
            </div>
          )}

          <div className="flex-1 flex flex-col">
            {loadingFile ? (
              <div className="p-6 text-xs font-mono text-slate-400">Loading file contents...</div>
            ) : isImage && imageDataUrl ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 gap-3">
                <img
                  src={imageDataUrl}
                  alt={selectedPath}
                  referrerPolicy="no-referrer"
                  className="max-w-xs max-h-64 rounded-lg border border-slate-700 bg-slate-800 p-2 object-contain"
                />
                <span className="text-xs font-mono text-slate-400">{selectedPath}</span>
              </div>
            ) : (
              <textarea
                value={fileContent}
                readOnly={isBinary}
                onChange={(e) => setFileContent(e.target.value)}
                spellCheck={false}
                className="w-full h-full min-h-[520px] p-4 bg-slate-900 text-slate-100 font-mono text-xs leading-relaxed resize-none focus:outline-none"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
