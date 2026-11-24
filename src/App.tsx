import { useState } from 'react';
import { t } from './lib/i18n';
import { BuildStage } from './components/BuildStage';
import { ExtractStage } from './components/ExtractStage';
import { SourceExplorer } from './components/SourceExplorer';
import { WebsiteConnector } from './components/WebsiteConnector';
import type { ApkSession, LanguageCode, WorkspaceStage } from './types/apk';

export default function App() {
  const [lang, setLang] = useState<LanguageCode>('en');
  const [stage, setStage] = useState<WorkspaceStage>('extract');
  const [session, setSession] = useState<ApkSession | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    loaded: number;
    total: number;
    percent: number;
  } | null>(null);
  const [error, setError] = useState('');
  const [selectedSourcePath, setSelectedSourcePath] = useState<string | null>(null);

  const copy = t(lang);

  const handleUploadApk = async (file: File) => {
    const maxBytes = 1024 * 1024 * 1024;
    if (file.size > maxBytes) {
      setError('File exceeds the 1 GB limit.');
      return;
    }

    setIsBusy(true);
    setError('');
    setUploadProgress({ loaded: 0, total: file.size, percent: 0 });

    try {
      const data = await new Promise<{ session: ApkSession }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/apk/extract');
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            const percent = Math.min(100, Math.round((ev.loaded / ev.total) * 100));
            setUploadProgress({ loaded: ev.loaded, total: ev.total, percent });
          }
        };
        xhr.onload = () => {
          try {
            const parsed = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(parsed);
            } else {
              reject(new Error(parsed.error || 'Failed to extract APK'));
            }
          } catch {
            reject(new Error(`Server error (${xhr.status}) while extracting archive`));
          }
        };
        xhr.onerror = () => reject(new Error('Network error while uploading file'));
        const form = new FormData();
        form.append('file', file, file.name);
        xhr.send(form);
      });

      setSession(data.session);
      setSelectedSourcePath(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsBusy(false);
      setUploadProgress(null);
    }
  };

  const handleLoadSample = async () => {
    setIsBusy(true);
    setError('');
    try {
      const res = await fetch('/api/apk/load-sample', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load sample APK');
      setSession(data.session);
      setSelectedSourcePath(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleInspectClassFile = (javaClassName: string) => {
    if (!session) return;
    const targetPath = `app/src/main/java/${javaClassName.replace(/\./g, '/')}.java`;
    const match = session.sourceFiles.find((f) => f.path === targetPath);
    setSelectedSourcePath(match ? match.path : null);
    setStage('source');
  };

  const handlePrimaryBuildCta = () => {
    if (session) {
      setStage('build');
    } else {
      setStage('extract');
    }
  };

  const navItems: Array<{ id: WorkspaceStage; label: string }> = [
    { id: 'extract', label: copy.navExtract },
    { id: 'source', label: copy.navSource },
    { id: 'connect', label: copy.navConnect },
    { id: 'build', label: copy.navBuild },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar: Strictly 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-[1440px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single text element wordmark */}
          <button
            type="button"
            onClick={() => setStage('extract')}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            APKBridge
          </button>

          {/* Zone 2: 4 concise single-line navigation links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
            {navItems.map((item) => {
              const active = stage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setStage(item.id)}
                  className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'border-emerald-700 text-slate-900'
                      : 'border-transparent text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Single primary action */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={handlePrimaryBuildCta}
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copy.ctaBuild}
            </button>
          </div>
        </div>
      </header>

      {/* Workspace Sub-Toolbar */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-[1440px] mx-auto px-6 py-2.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {session ? (
              <>
                <span className="font-medium text-slate-800">{session.originalFileName}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{session.manifest.packageName}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {session.sourceFiles.length} source files
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {session.webFiles.length} web assets
                </span>
              </>
            ) : (
              <span>No APK loaded yet — upload an .apk/.zip or load the sample APK</span>
            )}
          </div>

          <div className="flex items-center gap-4">
            {session?.lastBuild && (
              <a
                href={`/api/session/${session.id}/download-apk`}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                {copy.downloadApkBtn}
              </a>
            )}

            {/* Mobile stage switcher */}
            <div className="flex md:hidden items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {navItems.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setStage(item.id)}
                  className={`px-2 py-1 text-xs font-medium rounded cursor-pointer whitespace-nowrap ${
                    stage === item.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  {idx + 1}
                </button>
              ))}
            </div>

            {/* Language Switcher */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setLang('en')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  lang === 'en' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setLang('hi')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  lang === 'hi' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                हिंदी
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center justify-between gap-4">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError('')}
              className="font-medium underline cursor-pointer shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {stage === 'extract' && (
          <ExtractStage
            lang={lang}
            session={session}
            isBusy={isBusy}
            uploadProgress={uploadProgress}
            onUploadFile={handleUploadApk}
            onLoadSample={handleLoadSample}
            onNavigate={setStage}
            onInspectClassFile={handleInspectClassFile}
          />
        )}

        {stage !== 'extract' && !session && (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center max-w-xl mx-auto space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">
              Extract an APK or Source Archive First
            </h2>
            <p className="text-sm text-slate-600">
              Upload your Android APK or load the built-in sample APK to inspect source files,
              connect a website ZIP, and build a new signed package.
            </p>
            <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setStage('extract')}
                className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
              >
                Go to Upload APK
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={async () => {
                  await handleLoadSample();
                }}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                {copy.loadSampleBtn}
              </button>
            </div>
          </div>
        )}

        {stage === 'source' && session && (
          <SourceExplorer
            lang={lang}
            session={session}
            initialFilePath={selectedSourcePath}
            onSessionUpdated={setSession}
          />
        )}

        {stage === 'connect' && session && (
          <WebsiteConnector
            lang={lang}
            session={session}
            onSessionUpdated={setSession}
            onNavigate={setStage}
          />
        )}

        {stage === 'build' && session && (
          <BuildStage
            lang={lang}
            session={session}
            onSessionUpdated={setSession}
            onNavigate={setStage}
          />
        )}
      </main>
    </div>
  );
}
