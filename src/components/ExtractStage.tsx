import { useRef, useState, type DragEvent } from 'react';
import { Download, FileArchive, FileCode2, FolderOpen, Layers, Shield, Upload } from 'lucide-react';
import { formatBytes, t } from '../lib/i18n';
import type { ApkSession, LanguageCode, WorkspaceStage } from '../types/apk';

interface ExtractStageProps {
  lang: LanguageCode;
  session: ApkSession | null;
  isBusy: boolean;
  uploadProgress: { loaded: number; total: number; percent: number } | null;
  onUploadFile: (file: File) => void;
  onLoadSample: () => void;
  onNavigate: (stage: WorkspaceStage) => void;
  onInspectClassFile: (javaClassName: string) => void;
}

export function ExtractStage({
  lang,
  session,
  isBusy,
  uploadProgress,
  onUploadFile,
  onLoadSample,
  onNavigate,
  onInspectClassFile,
}: ExtractStageProps) {
  const copy = t(lang);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onUploadFile(file);
  };

  return (
    <div className="space-y-8">
      {/* Hero & Upload Workbench */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-5 flex flex-col justify-between bg-white border border-slate-200 rounded-xl p-6">
          <div className="space-y-4">
            <p className="text-xs font-medium text-emerald-700">
              Android APK Decompiler · WebView Bridge · Rebuilder
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance leading-tight">
              {copy.heroTitle}
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              {copy.heroSub}
            </p>
          </div>

          <div className="mt-6 pt-5 border-t border-slate-100 flex flex-wrap items-center gap-4 text-xs text-slate-600">
            <a
              href="/api/samples/apk"
              className="inline-flex items-center gap-1.5 font-medium text-slate-700 hover:text-emerald-700 transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{copy.downloadSampleApk}</span>
            </a>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <a
              href="/api/samples/website-zip"
              className="inline-flex items-center gap-1.5 font-medium text-slate-700 hover:text-emerald-700 transition-colors whitespace-nowrap"
            >
              <FileArchive className="w-3.5 h-3.5" />
              <span>{copy.downloadSampleWeb}</span>
            </a>
          </div>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`lg:col-span-7 bg-white border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center transition-colors ${
            isDragging
              ? 'border-emerald-600 bg-emerald-50/40'
              : 'border-slate-300 hover:border-slate-400'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".apk,.aab,.zip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUploadFile(file);
              e.target.value = '';
            }}
          />

          <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 mb-4">
            <Upload className="w-5 h-5" />
          </div>

          <h2 className="text-lg font-semibold text-slate-900">
            {isBusy ? copy.extracting : copy.dropApkTitle}
          </h2>
          <p className="mt-1.5 text-sm text-slate-500 max-w-md">
            {copy.dropApkHint}
          </p>

          {uploadProgress && isBusy && (
            <div className="mt-5 w-full max-w-sm space-y-1.5">
              <div className="flex justify-between text-xs font-mono tabular-nums text-slate-600">
                <span>
                  {uploadProgress.percent < 100 ? 'Uploading archive' : 'Extracting source'}
                </span>
                <span>
                  {formatBytes(uploadProgress.loaded)} / {formatBytes(uploadProgress.total)} (
                  {uploadProgress.percent}%)
                </span>
              </div>
              <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-600 transition-all duration-150"
                  style={{ width: `${uploadProgress.percent}%` }}
                />
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => inputRef.current?.click()}
              className="px-4 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {copy.chooseApkBtn}
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={onLoadSample}
              className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {copy.loadSampleBtn}
            </button>
          </div>
        </div>
      </section>

      {/* Extracted Inspection Data */}
      {session && (
        <section className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                {session.manifest.appName || session.originalFileName}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                <span>{session.manifest.packageName}</span>
                <span aria-hidden="true">·</span>
                <span>v{session.manifest.versionName} ({session.manifest.versionCode})</span>
                <span aria-hidden="true">·</span>
                <span>SDK {session.manifest.minSdkVersion}–{session.manifest.targetSdkVersion}</span>
                <span aria-hidden="true">·</span>
                <span>{session.sourceFiles.length} extracted files</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => onNavigate('source')}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>{copy.navSource}</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('connect')}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>{copy.nextConnect}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Decoded Manifest Details */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-emerald-700" />
                  <span>{copy.manifestHeading}</span>
                </h3>
                <a
                  href={`/api/session/${session.id}/download-source`}
                  className="text-xs font-medium text-emerald-700 hover:underline whitespace-nowrap"
                >
                  {copy.downloadSourceZip}
                </a>
              </div>

              <dl className="divide-y divide-slate-100 text-xs">
                <div className="py-2.5 flex justify-between gap-4">
                  <dt className="text-slate-500">Package ID</dt>
                  <dd className="font-mono text-slate-900 text-right break-all">{session.manifest.packageName}</dd>
                </div>
                <div className="py-2.5 flex justify-between gap-4">
                  <dt className="text-slate-500">Main Activity</dt>
                  <dd className="font-mono text-slate-900 text-right break-all">{session.manifest.mainActivity}</dd>
                </div>
                <div className="py-2.5 flex justify-between gap-4">
                  <dt className="text-slate-500">Version</dt>
                  <dd className="font-mono tabular-nums text-slate-900">
                    {session.manifest.versionName} (code {session.manifest.versionCode})
                  </dd>
                </div>
                <div className="py-2.5 flex justify-between gap-4">
                  <dt className="text-slate-500">Existing Web Assets</dt>
                  <dd className="font-mono text-slate-900">
                    {session.hasWebAssets ? session.detectedWebRoot : 'None detected (Native APK)'}
                  </dd>
                </div>
              </dl>

              <div>
                <h4 className="text-xs font-medium text-slate-700 mb-2">
                  Declared Permissions ({session.manifest.permissions.length})
                </h4>
                {session.manifest.permissions.length === 0 ? (
                  <p className="text-xs text-slate-400">No permissions declared in manifest.</p>
                ) : (
                  <ul className="space-y-1 max-h-40 overflow-y-auto pr-1">
                    {session.manifest.permissions.map((perm) => (
                      <li key={perm} className="text-xs font-mono text-slate-600 py-0.5 truncate">
                        {perm}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* DEX Class Summary Table */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <FileCode2 className="w-4 h-4 text-slate-700" />
                  <span>{copy.dexHeading}</span>
                </h3>
                <span className="text-xs text-slate-500 font-mono tabular-nums">
                  {session.dexSummaries.length} DEX file{session.dexSummaries.length === 1 ? '' : 's'}
                </span>
              </div>

              {session.dexSummaries.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">
                  No binary classes.dex found (loaded from source archive).
                </div>
              ) : (
                <div className="space-y-4">
                  {session.dexSummaries.map((dex) => (
                    <div key={dex.fileName} className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono tabular-nums">
                        <span className="font-semibold text-slate-900">{dex.fileName}</span>
                        <span>DEX v{dex.version} · {formatBytes(dex.fileSize)}</span>
                        <span>{dex.classCount} classes · {dex.methodCount} methods</span>
                      </div>

                      <div className="overflow-x-auto border border-slate-200 rounded-lg">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                              <th className="py-2 px-3 font-medium">Java Class</th>
                              <th className="py-2 px-3 font-medium">Superclass</th>
                              <th className="py-2 px-3 font-medium text-right">Methods</th>
                              <th className="py-2 px-3 font-medium text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {dex.sampleClasses.slice(0, 8).map((cls) => (
                              <tr key={cls.javaName} className="hover:bg-slate-50 transition-colors">
                                <td className="py-2 px-3 font-mono text-slate-900 truncate max-w-[220px]">
                                  {cls.javaName}
                                </td>
                                <td className="py-2 px-3 font-mono text-slate-500 truncate max-w-[160px]">
                                  {cls.superclass}
                                </td>
                                <td className="py-2 px-3 font-mono tabular-nums text-right text-slate-700">
                                  {cls.methodCount}
                                </td>
                                <td className="py-2 px-3 text-right">
                                  <button
                                    type="button"
                                    onClick={() => onInspectClassFile(cls.javaName)}
                                    className="text-emerald-700 hover:underline font-medium cursor-pointer whitespace-nowrap"
                                  >
                                    Inspect
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
