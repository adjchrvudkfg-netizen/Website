import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import {
  connectWebsiteToSession,
  createSampleApkBuffer,
  createSampleWebsiteZipBuffer,
  extractApkOrSourceArchive,
  extractApkOrSourceFromFile,
  packageSourceZipToFile,
  rebuildSessionApk,
} from './server/apk/apkProcessor.ts';
import type { BridgeConfig } from './server/apk/bridgeTemplates.ts';
import {
  getSession,
  getSessionRoot,
  isTextEditable,
  listSessionFiles,
  readSessionFile,
  resolveConfinedPath,
  saveSession,
  validateSessionId,
  writeSessionFile,
} from './server/apk/sessionStore.ts';

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';
const UPLOAD_TEMP_DIR = '/tmp/apkbridge-uploads';
fs.mkdirSync(UPLOAD_TEMP_DIR, { recursive: true });

// Streaming disk storage for large APK/ZIP archives up to 1 GB
const apkUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(UPLOAD_TEMP_DIR, { recursive: true });
      cb(null, UPLOAD_TEMP_DIR);
    },
    filename: (_req, _file, cb) => {
      cb(null, `${crypto.randomUUID()}.upload`);
    },
  }),
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1 GB
    files: 1,
  },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 150 * 1024 * 1024, // 150 MB for website bundle/files
    files: 100,
  },
});

const MIME_MAP: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

function serializeSession(session: ReturnType<typeof getSession>) {
  if (!session) return null;
  return {
    id: session.id,
    createdAt: session.createdAt,
    originalFileName: session.originalFileName,
    sourceType: session.sourceType,
    manifest: {
      packageName: session.manifest.packageName,
      versionCode: session.manifest.versionCode,
      versionName: session.manifest.versionName,
      minSdkVersion: session.manifest.minSdkVersion,
      targetSdkVersion: session.manifest.targetSdkVersion,
      appName: session.manifest.appName,
      permissions: session.manifest.permissions,
      activities: session.manifest.activities,
      mainActivity: session.manifest.mainActivity,
      usesCleartextTraffic: session.manifest.usesCleartextTraffic,
    },
    dexSummaries: session.dexSummaries.map((d) => ({
      fileName: d.fileName,
      version: d.parsed.version,
      fileSize: d.parsed.fileSize,
      sha1Hex: d.parsed.sha1Hex,
      stringCount: d.parsed.stringCount,
      typeCount: d.parsed.typeCount,
      methodCount: d.parsed.methodCount,
      classCount: d.parsed.classCount,
      sampleClasses: d.parsed.classes.slice(0, 25).map((c) => ({
        javaName: c.javaName,
        superclass: c.superclass,
        methodCount: c.methods.length,
        fieldCount: c.fields.length,
      })),
    })),
    hasWebAssets: session.hasWebAssets,
    detectedWebRoot: session.detectedWebRoot,
    sourceFiles: session.sourceFiles,
    webFiles: session.webFiles,
    bridgeConfig: session.bridgeConfig,
    lastBuild: session.lastBuild ?? null,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Download sample APK or sample website ZIP for testing
  app.get('/api/samples/apk', async (_req: Request, res: Response) => {
    try {
      const buf = await createSampleApkBuffer();
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment; filename="sample-shell-app.apk"');
      res.send(buf);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/samples/website-zip', async (_req: Request, res: Response) => {
    try {
      const buf = await createSampleWebsiteZipBuffer();
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="shoppulse-website.zip"');
      res.send(buf);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Load sample APK directly into a new extraction session
  app.post('/api/apk/load-sample', async (_req: Request, res: Response) => {
    try {
      const sampleBuf = await createSampleApkBuffer();
      const session = await extractApkOrSourceArchive(sampleBuf, 'sample-shell-app.apk', true);
      res.json({ session: serializeSession(session) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Extract uploaded APK or Source ZIP (up to 1 GB via disk streaming)
  app.post('/api/apk/extract', apkUpload.single('file'), async (req: Request, res: Response) => {
    const tempFilePath = req.file?.path;
    try {
      if (!req.file || !tempFilePath) {
        res.status(400).json({ error: 'Please upload an .apk or .zip file.' });
        return;
      }
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (!['.apk', '.zip', '.aab'].includes(ext)) {
        res.status(400).json({ error: 'Unsupported file type. Upload .apk, .aab, or .zip.' });
        return;
      }
      const session = await extractApkOrSourceFromFile(tempFilePath, req.file.originalname, false);
      res.json({ session: serializeSession(session) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    } finally {
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.rmSync(tempFilePath, { force: true });
      }
    }
  });

  // Get session metadata & file trees
  app.get('/api/session/:id', (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!validateSessionId(id)) {
      res.status(400).json({ error: 'Invalid session ID' });
      return;
    }
    const session = getSession(id);
    if (!session) {
      res.status(404).json({ error: 'Session not found or expired' });
      return;
    }
    res.json({ session: serializeSession(session) });
  });

  // Read extracted source file
  app.get('/api/session/:id/file', (req: Request, res: Response) => {
    const id = String(req.params.id);
    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!validateSessionId(id) || !relPath) {
      res.status(400).json({ error: 'Invalid session or file path' });
      return;
    }
    const session = getSession(id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    try {
      const buf = readSessionFile(id, 'source', relPath);
      const ext = path.extname(relPath).toLowerCase();
      if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico'].includes(ext)) {
        const mime = MIME_MAP[ext] || 'application/octet-stream';
        res.json({
          path: relPath,
          isBinary: true,
          isImage: true,
          size: buf.length,
          dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
        });
        return;
      }
      if (!isTextEditable(relPath)) {
        res.json({
          path: relPath,
          isBinary: true,
          isImage: false,
          size: buf.length,
          content: `[Binary file: ${buf.length} bytes]`,
        });
        return;
      }
      res.json({
        path: relPath,
        isBinary: false,
        isImage: false,
        size: buf.length,
        content: buf.toString('utf8'),
      });
    } catch {
      res.status(404).json({ error: 'File not found' });
    }
  });

  // Update extracted source file
  app.put('/api/session/:id/file', (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!validateSessionId(id)) {
      res.status(400).json({ error: 'Invalid session ID' });
      return;
    }
    const session = getSession(id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const { path: relPath, content } = req.body as { path?: string; content?: string };
    if (typeof relPath !== 'string' || typeof content !== 'string' || !isTextEditable(relPath)) {
      res.status(400).json({ error: 'File path is invalid or not text-editable' });
      return;
    }
    try {
      writeSessionFile(id, 'source', relPath, Buffer.from(content, 'utf8'));
      if (relPath.startsWith('app/src/main/assets/www/')) {
        const wwwRel = relPath.slice('app/src/main/assets/www/'.length);
        writeSessionFile(id, 'www', wwwRel, Buffer.from(content, 'utf8'));
      }
      session.sourceFiles = listSessionFiles(id, 'source');
      session.webFiles = listSessionFiles(id, 'www');
      saveSession(session);
      res.json({ ok: true, session: serializeSession(session) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Download extracted source ZIP (streamed from disk)
  app.get('/api/session/:id/download-source', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const session = getSession(id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    try {
      const zipPath = await packageSourceZipToFile(id);
      const stat = fs.statSync(zipPath);
      const slug =
        session.manifest.appName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') ||
        'apk-source';
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Length', String(stat.size));
      res.setHeader('Content-Disposition', `attachment; filename="${slug}-extracted-source.zip"`);
      fs.createReadStream(zipPath).pipe(res);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Connect website ZIP or individual files with APK source
  app.post(
    '/api/session/:id/connect-website',
    upload.array('files', 100),
    async (req: Request, res: Response) => {
      const id = String(req.params.id);
      const session = getSession(id);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      try {
        let parsedConfig: Partial<BridgeConfig> = {};
        if (typeof req.body?.config === 'string') {
          parsedConfig = JSON.parse(req.body.config) as Partial<BridgeConfig>;
        }

        const mergedConfig: BridgeConfig = {
          appName: String(parsedConfig.appName || session.bridgeConfig.appName).slice(0, 64),
          packageName:
            String(parsedConfig.packageName || session.bridgeConfig.packageName)
              .replace(/[^a-zA-Z0-9._]/g, '')
              .slice(0, 120) || 'com.apkbridge.webapp',
          versionName: String(parsedConfig.versionName || session.bridgeConfig.versionName).slice(0, 32),
          versionCode: Math.max(1, Number(parsedConfig.versionCode || session.bridgeConfig.versionCode) || 1),
          entryFile: String(parsedConfig.entryFile || session.bridgeConfig.entryFile || 'index.html'),
          enableBridge: parsedConfig.enableBridge ?? session.bridgeConfig.enableBridge,
          enableGeolocation: parsedConfig.enableGeolocation ?? session.bridgeConfig.enableGeolocation,
          enableCamera: parsedConfig.enableCamera ?? session.bridgeConfig.enableCamera,
          enableStorage: parsedConfig.enableStorage ?? session.bridgeConfig.enableStorage,
          allowMixedContent: parsedConfig.allowMixedContent ?? session.bridgeConfig.allowMixedContent,
          handleBackButton: parsedConfig.handleBackButton ?? session.bridgeConfig.handleBackButton,
          statusBarColor: /^#[0-9a-fA-F]{6}$/.test(String(parsedConfig.statusBarColor || ''))
            ? String(parsedConfig.statusBarColor)
            : '#0F172A',
          bridgeMethods: session.bridgeConfig.bridgeMethods,
        };

        const useSample = req.body?.useSampleWebsite === 'true';
        const uploadedFiles = (req.files as Express.Multer.File[] | undefined) || [];

        let payloadFiles: Array<{ originalName: string; buffer: Buffer }>;
        if (useSample) {
          const sampleWebZip = await createSampleWebsiteZipBuffer();
          payloadFiles = [{ originalName: 'shoppulse-website.zip', buffer: sampleWebZip }];
        } else if (uploadedFiles.length > 0) {
          payloadFiles = uploadedFiles.map((f) => ({
            originalName: f.originalname,
            buffer: f.buffer,
          }));
        } else {
          // Re-apply bridge config to already connected www files
          const existingWeb = listSessionFiles(id, 'www').filter((f) => f.path !== 'android-bridge.js');
          if (existingWeb.length === 0) {
            res.status(400).json({ error: 'Upload a website ZIP or HTML/CSS/JS files first.' });
            return;
          }
          payloadFiles = existingWeb.map((f) => ({
            originalName: f.path,
            buffer: readSessionFile(id, 'www', f.path),
          }));
        }

        const updated = await connectWebsiteToSession(id, payloadFiles, mergedConfig);
        res.json({ session: serializeSession(updated) });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    }
  );

  // Live preview static file server for connected website inside emulator iframe
  app.get(['/api/session/:id/preview', '/api/session/:id/preview/*'], (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!validateSessionId(id)) {
      res.status(400).send('Invalid session');
      return;
    }
    const session = getSession(id);
    if (!session) {
      res.status(404).send('Session expired');
      return;
    }

    const wildcard = req.params[0] ? String(req.params[0]) : '';
    const relTarget = wildcard || session.bridgeConfig.entryFile || 'index.html';

    try {
      const root = getSessionRoot(id);
      const wwwBase = resolveConfinedPath(root, 'www');
      const fullPath = resolveConfinedPath(wwwBase, relTarget);
      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
        res.status(404).send('Preview asset not found');
        return;
      }
      const ext = path.extname(fullPath).toLowerCase();
      res.setHeader('Content-Type', MIME_MAP[ext] || 'application/octet-stream');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      fs.createReadStream(fullPath).pipe(res);
    } catch {
      res.status(404).send('Invalid preview path');
    }
  });

  // Rebuild & sign new APK + connected source ZIP
  app.post('/api/session/:id/build', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!validateSessionId(id)) {
      res.status(400).json({ error: 'Invalid session ID' });
      return;
    }
    try {
      const updated = await rebuildSessionApk(id);
      res.json({ session: serializeSession(updated) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Download rebuilt signed APK (streamed from disk for up to 1 GB APKs)
  app.get('/api/session/:id/download-apk', (req: Request, res: Response) => {
    const id = String(req.params.id);
    const session = getSession(id);
    if (!session || !session.lastBuild) {
      res.status(404).json({ error: 'No built APK found for this session' });
      return;
    }
    try {
      const root = getSessionRoot(id);
      const buildDir = resolveConfinedPath(root, 'build');
      const apkPath = resolveConfinedPath(buildDir, session.lastBuild.apkFileName);
      const stat = fs.statSync(apkPath);
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Length', String(stat.size));
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${session.lastBuild.apkFileName}"`
      );
      fs.createReadStream(apkPath).pipe(res);
    } catch {
      res.status(404).json({ error: 'Built APK file missing' });
    }
  });

  // Download connected Android Studio Gradle ZIP (streamed from disk)
  app.get('/api/session/:id/download-connected-source', (req: Request, res: Response) => {
    const id = String(req.params.id);
    const session = getSession(id);
    if (!session || !session.lastBuild) {
      res.status(404).json({ error: 'No connected source bundle found' });
      return;
    }
    try {
      const root = getSessionRoot(id);
      const buildDir = resolveConfinedPath(root, 'build');
      const zipPath = resolveConfinedPath(buildDir, session.lastBuild.sourceZipFileName);
      const stat = fs.statSync(zipPath);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Length', String(stat.size));
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${session.lastBuild.sourceZipFileName}"`
      );
      fs.createReadStream(zipPath).pipe(res);
    } catch {
      res.status(404).json({ error: 'Connected source archive missing' });
    }
  });

  // Mount Vite in dev or static dist in production
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`APKBridge Studio server listening on http://0.0.0.0:${PORT}`);
  });
  httpServer.requestTimeout = 0;
  httpServer.headersTimeout = 0;
}

startServer();
