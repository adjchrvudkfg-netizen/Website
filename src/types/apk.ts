export type WorkspaceStage = 'extract' | 'source' | 'connect' | 'build';

export type LanguageCode = 'en' | 'hi';

export interface WorkspaceFileNode {
  path: string;
  size: number;
  kind: 'source' | 'manifest' | 'resource' | 'web' | 'binary' | 'gradle';
  editable: boolean;
}

export interface BridgeConfig {
  appName: string;
  packageName: string;
  versionName: string;
  versionCode: number;
  entryFile: string;
  enableBridge: boolean;
  enableGeolocation: boolean;
  enableCamera: boolean;
  enableStorage: boolean;
  allowMixedContent: boolean;
  handleBackButton: boolean;
  statusBarColor: string;
  bridgeMethods: string[];
}

export interface DexSummary {
  fileName: string;
  version: string;
  fileSize: number;
  sha1Hex: string;
  stringCount: number;
  typeCount: number;
  methodCount: number;
  classCount: number;
  sampleClasses: Array<{
    javaName: string;
    superclass: string;
    methodCount: number;
    fieldCount: number;
  }>;
}

export interface BuildArtifactSummary {
  apkFileName: string;
  sourceZipFileName: string;
  apkSize: number;
  sourceZipSize: number;
  builtAt: string;
  signingInfo: {
    signerSubject: string;
    fingerprintSha256: string;
    entriesSigned: number;
    algorithm: string;
  };
  webFilesCount: number;
}

export interface ApkSession {
  id: string;
  createdAt: number;
  originalFileName: string;
  sourceType: 'apk' | 'zip' | 'sample';
  manifest: {
    packageName: string;
    versionCode: string;
    versionName: string;
    minSdkVersion: string;
    targetSdkVersion: string;
    appName: string;
    permissions: string[];
    activities: string[];
    mainActivity: string;
    usesCleartextTraffic: boolean;
  };
  dexSummaries: DexSummary[];
  hasWebAssets: boolean;
  detectedWebRoot: string;
  sourceFiles: WorkspaceFileNode[];
  webFiles: WorkspaceFileNode[];
  bridgeConfig: BridgeConfig;
  lastBuild: BuildArtifactSummary | null;
}

export interface BridgeEventLog {
  id: string;
  action: string;
  payload: Record<string, unknown>;
  timestamp: number;
}
