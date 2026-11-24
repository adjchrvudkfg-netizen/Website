import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  FileArchive,
  Globe,
  RefreshCw,
  Smartphone,
  Upload,
} from 'lucide-react';
import { formatBytes, t } from '../lib/i18n';
import type {
  ApkSession,
  BridgeConfig,
  BridgeEventLog,
  LanguageCode,
  WorkspaceStage,
} from '../types/apk';

interface WebsiteConnectorProps {
  lang: LanguageCode;
  session: ApkSession;
  onSessionUpdated: (session: ApkSession) => void;
  onNavigate: (stage: WorkspaceStage) => void;
}

export function WebsiteConnector({
  lang,
  session,
  onSessionUpdated,
  onNavigate,
}: WebsiteConnectorProps) {
  const copy = t(lang);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [config, setConfig] = useState<BridgeConfig>(session.bridgeConfig);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');
  const [previewNonce, setPreviewNonce] = useState(() => Date.now());
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [bridgeLogs, setBridgeLogs] = useState<BridgeEventLog[]>([]);

  useEffect(() => {
    setConfig(session.bridgeConfig);
  }, [session.bridgeConfig]);

  // Listen to real APKBridge calls coming from the connected website inside the Android WebView iframe
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        type?: string;
        action?: string;
        payload?: Record<string, unknown>;
        timestamp?: number;
      };
      if (!data || data.type !== 'APKBRIDGE_CALL' || !data.action) return;

      if (data.action === 'showToast' && typeof data.payload?.message === 'string') {
        setToastMessage(data.payload.message);
        setTimeout(() => setToastMessage(null), 2600);
      }

      setBridgeLogs((prev) => [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          action: data.action!,
          payload: data.payload || {},
          timestamp: data.timestamp || Date.now(),
        },
        ...prev.slice(0, 14),
      ]);
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const submitConnection = async (useSampleWebsite = false, overrideFiles?: File[]) => {
    setIsConnecting(true);
    setError('');
    try {
      const form = new FormData();
      form.append('config', JSON.stringify(config));
      if (useSampleWebsite) {
        form.append('useSampleWebsite', 'true');
      } else {
        const filesToSend = overrideFiles ?? pendingFiles;
        filesToSend.forEach((file) => form.append('files', file, file.name));
      }

      const res = await fetch(`/api/session/${session.id}/connect-website`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to connect website');
      onSessionUpdated(data.session);
      setPendingFiles([]);
      setPreviewNonce(Date.now());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsConnecting(false);
    }
  };

  const hasPreview = session.webFiles.length > 0;
  const previewUrl = `/api/session/${session.id}/preview/${encodeURIComponent(
    config.entryFile || 'index.html'
  )}?v=${previewNonce}`;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
      {/* Left Column: Website Upload & Java Bridge Configuration */}
      <div className="lg:col-span-7 space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{copy.connectTitle}</h2>
            <p className="mt-1 text-sm text-slate-600">{copy.connectSub}</p>
          </div>

          {/* Website File / ZIP Picker */}
          <div className="border border-dashed border-slate-300 rounded-xl p-5 bg-slate-50/70 space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".zip,.html,.htm,.css,.js,.mjs,.json,.svg,.png,.jpg,.jpeg,.webp,.woff,.woff2"
              className="hidden"
              onChange={(e) => {
                const list = Array.from(e.target.files || []);
                if (list.length > 0) {
                  setPendingFiles(list);
                }
                e.target.value = '';
              }}
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-700">
                  <FileArchive className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {pendingFiles.length > 0
                      ? `${pendingFiles.length} file${pendingFiles.length > 1 ? 's' : ''} queued`
                      : session.webFiles.length > 0
                      ? `${session.webFiles.length} website files connected`
                      : 'No website files uploaded yet'}
                  </p>
                  <p className="text-xs text-slate-500">
                    Upload a website .zip or select index.html + CSS/JS/assets
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{copy.uploadWebZipBtn}</span>
                </button>
                <button
                  type="button"
                  disabled={isConnecting}
                  onClick={() => submitConnection(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>{copy.useSampleWebBtn}</span>
                </button>
              </div>
            </div>

            {pendingFiles.length > 0 && (
              <div className="pt-3 border-t border-slate-200 flex flex-wrap gap-3 text-xs text-slate-600 font-mono">
                {pendingFiles.slice(0, 6).map((f) => (
                  <span key={f.name}>
                    {f.name} ({formatBytes(f.size)})
                  </span>
                ))}
                {pendingFiles.length > 6 && <span>+{pendingFiles.length - 6} more</span>}
              </div>
            )}
          </div>

          {/* App & Bridge Wiring Settings */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-700">App Name (Launcher Label)</span>
              <input
                type="text"
                value={config.appName}
                onChange={(e) => setConfig({ ...config, appName: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-700">Android Package ID</span>
              <input
                type="text"
                value={config.packageName}
                onChange={(e) => setConfig({ ...config, packageName: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-700">Version Name</span>
              <input
                type="text"
                value={config.versionName}
                onChange={(e) => setConfig({ ...config, versionName: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-700">Website Entry File</span>
              <input
                type="text"
                value={config.entryFile}
                onChange={(e) => setConfig({ ...config, entryFile: e.target.value })}
                placeholder="index.html"
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {(
              [
                ['enableBridge', 'Inject APKBridge JS & WebAppBridge.java'],
                ['handleBackButton', 'Android Back Button WebView History'],
                ['allowMixedContent', 'Allow HTTP / Mixed Content URLs'],
                ['enableGeolocation', 'Enable GPS Geolocation Permission'],
                ['enableCamera', 'Enable Camera File Chooser Permission'],
                ['enableStorage', 'Enable External Storage Access'],
              ] as Array<[keyof BridgeConfig, string]>
            ).map(([key, label]) => (
              <label
                key={key}
                className="flex items-center gap-2.5 px-3 py-2.5 border border-slate-200 rounded-lg text-xs text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={Boolean(config[key])}
                  onChange={(e) => setConfig({ ...config, [key]: e.target.checked })}
                  className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-100">
            <label className="flex items-center gap-2.5 text-xs text-slate-700">
              <span>Status Bar Color</span>
              <input
                type="color"
                value={config.statusBarColor}
                onChange={(e) => setConfig({ ...config, statusBarColor: e.target.value })}
                className="w-8 h-8 rounded border border-slate-200 cursor-pointer bg-white"
              />
              <span className="font-mono text-slate-500">{config.statusBarColor}</span>
            </label>

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={isConnecting || (pendingFiles.length === 0 && session.webFiles.length === 0)}
                onClick={() => submitConnection(false)}
                className="px-4 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {isConnecting ? copy.connecting : copy.connectActionBtn}
              </button>
              {hasPreview && (
                <button
                  type="button"
                  onClick={() => onNavigate('build')}
                  className="px-4 py-2.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {copy.nextBuild}
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Connected Files List */}
        {session.webFiles.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                <span>Connected Website Assets (app/src/main/assets/www/)</span>
              </h3>
              <button
                type="button"
                onClick={() => onNavigate('source')}
                className="text-xs font-medium text-emerald-700 hover:underline cursor-pointer"
              >
                Inspect Connected Java & Bridge Code
              </button>
            </div>
            <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {session.webFiles.map((wf) => (
                <div
                  key={wf.path}
                  className="px-3 py-1.5 flex items-center justify-between text-xs font-mono"
                >
                  <span className="text-slate-800 truncate">{wf.path}</span>
                  <span className="text-slate-500 tabular-nums shrink-0">{formatBytes(wf.size)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right Column: Live Android WebView Phone Preview & Bridge Console */}
      <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-slate-700" />
            <span>{copy.previewHeading}</span>
          </h3>
          {hasPreview && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => iframeRef.current?.contentWindow?.history.back()}
                title="Android Back"
                className="p-1.5 text-slate-600 hover:text-slate-900 border border-slate-200 rounded-md cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setPreviewNonce(Date.now())}
                title="Reload WebView"
                className="p-1.5 text-slate-600 hover:text-slate-900 border border-slate-200 rounded-md cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Device Frame */}
        <div className="mx-auto w-full max-w-[360px] border-[6px] border-slate-900 rounded-[28px] overflow-hidden bg-slate-950 shadow-sm relative">
          {/* Android Status Bar */}
          <div
            className="px-4 py-1.5 flex items-center justify-between text-[11px] font-mono text-white"
            style={{ backgroundColor: config.statusBarColor || '#0F172A' }}
          >
            <span className="truncate">{config.appName}</span>
            <span className="opacity-80">WebView</span>
          </div>

          {/* WebView Viewport */}
          <div className="bg-white h-[480px] relative">
            {hasPreview ? (
              <iframe
                ref={iframeRef}
                key={previewNonce}
                src={previewUrl}
                title="Android WebView Live Preview"
                sandbox="allow-scripts allow-forms allow-modals allow-same-origin"
                className="w-full h-full border-0"
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center p-6 text-center text-xs text-slate-500">
                <Globe className="w-8 h-8 text-slate-300 mb-3" />
                <p>{copy.previewEmpty}</p>
              </div>
            )}

            {/* Simulated Android Toast */}
            {toastMessage && (
              <div className="absolute bottom-5 left-1/2 -translate-x-1/2 px-4 py-2 bg-slate-900/95 text-white text-xs rounded-lg shadow-md max-w-[90%] text-center pointer-events-none">
                {toastMessage}
              </div>
            )}
          </div>

          {/* Android Nav Bar */}
          <div className="bg-slate-900 px-6 py-2 flex items-center justify-around text-slate-400 text-[11px] font-mono">
            <button
              type="button"
              onClick={() => iframeRef.current?.contentWindow?.history.back()}
              className="hover:text-white cursor-pointer"
            >
              Back
            </button>
            <span>Home</span>
            <span>Overview</span>
          </div>
        </div>

        {/* Live Bridge Call Log */}
        <div className="border-t border-slate-200 pt-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-700">Native Bridge Calls (Live)</span>
            <span className="font-mono tabular-nums text-slate-500">{bridgeLogs.length} events</span>
          </div>
          <div className="bg-slate-900 text-slate-200 rounded-lg p-2.5 font-mono text-[11px] h-28 overflow-y-auto space-y-1">
            {bridgeLogs.length === 0 ? (
              <div className="text-slate-500">
                Interact with the website preview above to observe window.APKBridge calls.
              </div>
            ) : (
              bridgeLogs.map((log) => (
                <div key={log.id} className="truncate">
                  <span className="text-emerald-400">{log.action}</span>{' '}
                  <span className="text-slate-400">{JSON.stringify(log.payload)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
