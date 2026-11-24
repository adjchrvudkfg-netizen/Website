import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DecodedManifest } from './axml.ts';
import type { ParsedDex } from './dexParser.ts';
import type { BridgeConfig } from './bridgeTemplates.ts';
import type { SigningInfo } from './apkSigner.ts';

export interface WorkspaceFileNode {
  path: string;
  size: number;
  kind: 'source' | 'manifest' | 'resource' | 'web' | 'binary' | 'gradle';
  editable: boolean;
}

export interface SessionData {
  id: string;
  createdAt: number;
  originalFileName: string;
  sourceType: 'apk' | 'zip' | 'sample';
  manifest: DecodedManifest;
  dexSummaries: Array<{ fileName: string; parsed: ParsedDex }>;
  hasWebAssets: boolean;
  detectedWebRoot: string;
  sourceFiles: WorkspaceFileNode[];
  webFiles: WorkspaceFileNode[];
  bridgeConfig: BridgeConfig;
  lastBuild?: {
    apkFileName: string;
    sourceZipFileName: string;
    apkSize: number;
    sourceZipSize: number;
    builtAt: string;
    signingInfo: SigningInfo;
    webFilesCount: number;
  };
}

const SESSION_BASE_DIR = '/tmp/apkbridge-sessions';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

const sessions = new Map<string, SessionData>();

export function ensureSessionBaseDir(): void {
  fs.mkdirSync(SESSION_BASE_DIR, { recursive: true });
}

export function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(id);
      const dir = path.join(SESSION_BASE_DIR, id);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

export function createSessionId(): string {
  ensureSessionBaseDir();
  cleanupExpiredSessions();
  return crypto.randomUUID();
}

export function validateSessionId(id: string): boolean {
  return UUID_REGEX.test(id);
}

export function getSession(id: string): SessionData | undefined {
  if (!validateSessionId(id)) return undefined;
  return sessions.get(id);
}

export function saveSession(data: SessionData): void {
  sessions.set(data.id, data);
}

export function getSessionRoot(id: string): string {
  if (!validateSessionId(id)) {
    throw new Error('Invalid session identifier');
  }
  const resolved = path.resolve(SESSION_BASE_DIR, id);
  if (!resolved.startsWith(SESSION_BASE_DIR + path.sep)) {
    throw new Error('Invalid session path');
  }
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

// Strict path confinement check preventing zip-slip or path traversal
export function resolveConfinedPath(baseDir: string, unsafeRelPath: string): string {
  if (!unsafeRelPath || unsafeRelPath.includes('\0')) {
    throw new Error('Invalid file path');
  }
  const cleanRel = unsafeRelPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = cleanRel.split('/').filter(Boolean);
  if (segments.length === 0 || segments.some((s) => s === '..' || s === '.')) {
    throw new Error('Disallowed path segment');
  }
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, ...segments);
  if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error('Path traversal rejected');
  }
  return resolvedTarget;
}

export function sanitizeZipEntryPath(entryPath: string): string | null {
  if (!entryPath || entryPath.includes('\0')) return null;
  const normalized = entryPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.endsWith('/')) return null;
  const parts = normalized.split('/');
  if (parts.some((p) => !p || p === '.' || p === '..')) return null;
  // Ignore macOS metadata folders
  if (parts[0] === '__MACOSX' || parts[parts.length - 1] === '.DS_Store') return null;
  return parts.join('/');
}

export function writeSessionFile(sessionId: string, subdir: string, relPath: string, content: Buffer | string): void {
  const root = getSessionRoot(sessionId);
  const subBase = resolveConfinedPath(root, subdir);
  const fullPath = resolveConfinedPath(subBase, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

export function readSessionFile(sessionId: string, subdir: string, relPath: string): Buffer {
  const root = getSessionRoot(sessionId);
  const subBase = resolveConfinedPath(root, subdir);
  const fullPath = resolveConfinedPath(subBase, relPath);
  return fs.readFileSync(fullPath);
}

export function sessionFileExists(sessionId: string, subdir: string, relPath: string): boolean {
  try {
    const root = getSessionRoot(sessionId);
    const subBase = resolveConfinedPath(root, subdir);
    const fullPath = resolveConfinedPath(subBase, relPath);
    return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
  } catch {
    return false;
  }
}

export function listSessionFiles(sessionId: string, subdir: string): WorkspaceFileNode[] {
  const root = getSessionRoot(sessionId);
  const subBase = resolveConfinedPath(root, subdir);
  if (!fs.existsSync(subBase)) return [];

  const result: WorkspaceFileNode[] = [];
  const walk = (dir: string, prefix: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, rel);
      } else if (entry.isFile()) {
        const size = fs.statSync(full).size;
        result.push({
          path: rel,
          size,
          kind: classifyFileKind(rel),
          editable: isTextEditable(rel),
        });
      }
    }
  };
  walk(subBase, '');
  result.sort((a, b) => a.path.localeCompare(b.path));
  return result;
}

export function classifyFileKind(relPath: string): WorkspaceFileNode['kind'] {
  const lower = relPath.toLowerCase();
  if (lower.endsWith('androidmanifest.xml')) return 'manifest';
  if (lower.endsWith('.gradle') || lower.endsWith('gradle.properties')) return 'gradle';
  if (
    lower.includes('/assets/www/') ||
    lower.startsWith('www/') ||
    /\.(html?|css|js|mjs|json|svg)$/.test(lower)
  ) {
    return 'web';
  }
  if (/\.(java|kt|smali|txt)$/.test(lower)) return 'source';
  if (/\.(xml|png|jpg|jpeg|webp|ico|woff2?)$/.test(lower)) return 'resource';
  return 'binary';
}

export function isTextEditable(relPath: string): boolean {
  return /\.(xml|java|kt|gradle|properties|html?|css|js|mjs|ts|json|svg|txt|md|pro|smali)$/i.test(
    relPath
  );
}
