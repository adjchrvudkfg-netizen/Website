import { useState } from 'react';
import { CheckCircle2, Download, FileArchive, PackageCheck, ShieldCheck } from 'lucide-react';
import { formatBytes, t } from '../lib/i18n';
import type { ApkSession, LanguageCode, WorkspaceStage } from '../types/apk';

interface BuildStageProps {
  lang: LanguageCode;
  session: ApkSession;
  onSessionUpdated: (session: ApkSession) => void;
  onNavigate: (stage: WorkspaceStage) => void;
}

export function BuildStage({
  lang,
  session,
  onSessionUpdated,
  onNavigate,
}: BuildStageProps) {
  const copy = t(lang);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState('');

  const handleBuild = async () => {
    setBuilding(true);
    setError('');
    try {
      const res = await fetch(`/api/session/${session.id}/build`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'APK rebuild failed');
      onSessionUpdated(data.session);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBuilding(false);
    }
  };

  const build = session.lastBuild;

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-xl font-semibold text-slate-900">{copy.buildTitle}</h2>
            <p className="mt-1 text-sm text-slate-600">{copy.buildSub}</p>
          </div>

          <button
            type="button"
            disabled={building}
            onClick={handleBuild}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <PackageCheck className="w-4 h-4" />
            <span>{building ? copy.building : copy.buildActionBtn}</span>
          </button>
        </div>

        {/* Pre-Build Configuration Summary Table */}
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <th className="py-2.5 px-4 font-medium">Pipeline Component</th>
                <th className="py-2.5 px-4 font-medium">Configured Value</th>
                <th className="py-2.5 px-4 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="py-2.5 px-4 font-medium text-slate-800">App Label & Package ID</td>
                <td className="py-2.5 px-4 font-mono text-slate-600">
                  {session.bridgeConfig.appName} · {session.bridgeConfig.packageName}
                </td>
                <td className="py-2.5 px-4 text-right text-emerald-700 font-medium">Ready</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-medium text-slate-800">Version</td>
                <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600">
                  {session.bridgeConfig.versionName} (code {session.bridgeConfig.versionCode})
                </td>
                <td className="py-2.5 px-4 text-right text-emerald-700 font-medium">Ready</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-medium text-slate-800">Connected Website Assets</td>
                <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600">
                  {session.webFiles.length} files · Entry: {session.bridgeConfig.entryFile}
                </td>
                <td className="py-2.5 px-4 text-right font-medium">
                  {session.webFiles.length > 0 ? (
                    <span className="text-emerald-700">Connected</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onNavigate('connect')}
                      className="text-amber-700 hover:underline cursor-pointer"
                    >
                      Attach Website First
                    </button>
                  )}
                </td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-medium text-slate-800">Native WebView Bridge</td>
                <td className="py-2.5 px-4 font-mono text-slate-600">
                  {session.bridgeConfig.enableBridge
                    ? 'MainActivity.java + WebAppBridge.java + android-bridge.js'
                    : 'Disabled'}
                </td>
                <td className="py-2.5 px-4 text-right text-emerald-700 font-medium">Wired</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-medium text-slate-800">Package Signature</td>
                <td className="py-2.5 px-4 font-mono text-slate-600">
                  RSA-2048 X.509 · SHA-256 MANIFEST.MF / CERT.SF / CERT.RSA
                </td>
                <td className="py-2.5 px-4 text-right text-emerald-700 font-medium">Auto-Sign</td>
              </tr>
            </tbody>
          </table>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* Build Outputs */}
      {build && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Signed APK Output */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-emerald-700 text-xs font-medium">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Signed Android Package Ready</span>
                </div>
                <h3 className="text-base font-semibold text-slate-900 font-mono">
                  {build.apkFileName}
                </h3>
              </div>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                {formatBytes(build.apkSize)}
              </span>
            </div>

            <dl className="divide-y divide-slate-100 text-xs">
              <div className="py-2 flex justify-between gap-4">
                <dt className="text-slate-500">Signer Subject</dt>
                <dd className="font-mono text-slate-800 text-right">{build.signingInfo.signerSubject}</dd>
              </div>
              <div className="py-2 flex justify-between gap-4">
                <dt className="text-slate-500">Algorithm</dt>
                <dd className="font-mono text-slate-800 text-right">{build.signingInfo.algorithm}</dd>
              </div>
              <div className="py-2 flex justify-between gap-4">
                <dt className="text-slate-500">Signed Entries</dt>
                <dd className="font-mono tabular-nums text-slate-800">
                  {build.signingInfo.entriesSigned} files ({build.webFilesCount} web assets)
                </dd>
              </div>
              <div className="py-2 space-y-1">
                <dt className="text-slate-500">Certificate SHA-256 Fingerprint</dt>
                <dd className="font-mono text-[11px] text-slate-700 break-all bg-slate-50 p-2 rounded border border-slate-200">
                  {build.signingInfo.fingerprintSha256}
                </dd>
              </div>
            </dl>

            <a
              href={`/api/session/${session.id}/download-apk`}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>{copy.downloadApkBtn}</span>
            </a>
          </div>

          {/* Connected Android Studio Source Output */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-slate-700 text-xs font-medium">
                    <ShieldCheck className="w-4 h-4 text-emerald-700" />
                    <span>Connected Android Studio Gradle Project</span>
                  </div>
                  <h3 className="text-base font-semibold text-slate-900 font-mono">
                    {build.sourceZipFileName}
                  </h3>
                </div>
                <span className="text-xs font-mono tabular-nums text-slate-500">
                  {formatBytes(build.sourceZipSize)}
                </span>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                Includes connected <span className="font-mono text-slate-800">MainActivity.java</span>,{' '}
                <span className="font-mono text-slate-800">WebAppBridge.java</span>,{' '}
                <span className="font-mono text-slate-800">AndroidManifest.xml</span>, Gradle scripts,
                and your bridged website inside{' '}
                <span className="font-mono text-slate-800">app/src/main/assets/www/</span>. Open in
                Android Studio or run <span className="font-mono text-slate-800">./gradlew assembleRelease</span>{' '}
                if converting a non-WebView native APK from Java source.
              </p>
            </div>

            <a
              href={`/api/session/${session.id}/download-connected-source`}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              <FileArchive className="w-4 h-4" />
              <span>{copy.downloadGradleBtn}</span>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
