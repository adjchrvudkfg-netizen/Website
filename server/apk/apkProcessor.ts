import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import {
  decodeAxml,
  encodeSimpleAxmlManifest,
  extractManifestMetadataFromXml,
  isBinaryAxml,
  patchAxmlStringPool,
  type DecodedManifest,
} from './axml.ts';
import {
  buildSampleWebViewDex,
  isValidDex,
  parseDex,
  renderDecompiledJavaClass,
  type ParsedDex,
} from './dexParser.ts';
import { generateMetaInfFromDigests, signApkZip, type EntryDigest } from './apkSigner.ts';

const execFileAsync = promisify(execFile);
const ZIP_STREAM_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'zip_stream.py'
);

async function runZipStream(args: string[]): Promise<void> {
  await execFileAsync('/usr/bin/python3', [ZIP_STREAM_SCRIPT, ...args], {
    shell: false,
    maxBuffer: 16 * 1024 * 1024,
  });
}
import {
  generateActivityMainLayout,
  generateAndroidBridgeJs,
  generateAndroidManifestXml,
  generateAppBuildGradle,
  generateMainActivityJava,
  generateStringsXml,
  generateWebAppBridgeJava,
  injectBridgeIntoHtml,
  type BridgeConfig,
} from './bridgeTemplates.ts';
import {
  createSessionId,
  getSession,
  getSessionRoot,
  listSessionFiles,
  readSessionFile,
  resolveConfinedPath,
  sanitizeZipEntryPath,
  saveSession,
  writeSessionFile,
  type SessionData,
} from './sessionStore.ts';

// 1x1 transparent-emerald PNG icon fallback (68 bytes) for generated sample APK
const SAMPLE_PNG_ICON = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAWElEQVR4nO3PQQ0AIQDAMMF/Z3PAB44kQ9o255wzg97M7gD/A0AAgQABAQICBAQICBAQICBAQICBAQICBAQICBAQICBAQICBAQICBAQICBAQICAwX+ADr6AAy84t37AAAAAElFTkSuQmCC',
  'base64'
);

export async function createSampleApkBuffer(): Promise<Buffer> {
  const pkg = 'com.apkbridge.sampleapp';
  const zip = new JSZip();

  const axml = encodeSimpleAxmlManifest({
    packageName: pkg,
    versionCode: 1,
    versionName: '1.0.0',
    appName: 'Sample Shell App',
    mainActivityName: '.MainActivity',
    minSdkVersion: 21,
    targetSdkVersion: 34,
    permissions: ['android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE'],
    usesCleartextTraffic: true,
  });

  const dex = buildSampleWebViewDex(pkg);

  zip.file('AndroidManifest.xml', axml);
  zip.file('classes.dex', dex);
  zip.file('res/mipmap-mdpi/ic_launcher.png', SAMPLE_PNG_ICON);
  zip.file(
    'assets/www/index.html',
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Sample Shell App</title>
  <style>
    body { font-family: sans-serif; margin: 0; padding: 24px; background: #f8fafc; color: #0f172a; }
    .box { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Original APK WebView Content</h1>
    <p>Replace this content by connecting your own website ZIP in Step 3.</p>
  </div>
</body>
</html>`
  );

  const { signedBuffer } = await signApkZip(zip, 'Sample Shell App');
  return signedBuffer;
}

export async function createSampleWebsiteZipBuffer(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    'index.html',
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>ShopPulse Mobile Store</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <header class="topbar">
    <div>
      <h1>ShopPulse</h1>
      <p class="sub">Connected Website inside Android APK</p>
    </div>
    <button id="device-btn" class="btn-outline" type="button">Device Info</button>
  </header>

  <main class="container">
    <section class="card">
      <h2>Quick Order Catalog</h2>
      <p class="muted">Tap any item to add it to your local APK cart and trigger a native Android Toast.</p>
      <div id="catalog" class="grid"></div>
    </section>

    <section class="card">
      <div class="row-between">
        <h2>Cart (<span id="cart-count">0</span>)</h2>
        <button id="share-btn" class="btn-primary" type="button">Share Order</button>
      </div>
      <ul id="cart-list" class="cart-list"></ul>
      <div id="bridge-output" class="output">Bridge ready. Interact with controls above.</div>
    </section>
  </main>

  <script src="./app.js"></script>
</body>
</html>`
  );

  zip.file(
    'styles.css',
    `* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: system-ui, -apple-system, sans-serif;
  background: #f1f5f9;
  color: #0f172a;
}
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: #0f172a;
  color: #f8fafc;
}
.topbar h1 { margin: 0; font-size: 18px; }
.sub { margin: 2px 0 0; font-size: 12px; color: #94a3b8; }
.container { padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 14px;
}
.card h2 { margin: 0 0 6px; font-size: 15px; }
.muted { margin: 0 0 12px; font-size: 13px; color: #475569; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.item {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px;
  background: #f8fafc;
}
.item-title { font-weight: 600; font-size: 13px; margin-bottom: 4px; }
.item-price { font-size: 12px; color: #059669; margin-bottom: 8px; font-weight: 600; }
.btn-primary {
  background: #059669;
  color: #ffffff;
  border: none;
  border-radius: 6px;
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.btn-outline {
  background: transparent;
  color: #f8fafc;
  border: 1px solid #475569;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}
.row-between { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.cart-list { margin: 0 0 10px; padding-left: 18px; font-size: 13px; color: #334155; }
.output {
  background: #0f172a;
  color: #34d399;
  font-family: monospace;
  font-size: 11px;
  padding: 8px 10px;
  border-radius: 6px;
  word-break: break-word;
}`
  );

  zip.file(
    'app.js',
    `const ITEMS = [
  { id: 'sku-1', name: 'Wireless Earbuds', price: '$49' },
  { id: 'sku-2', name: 'USB-C Hub Pro', price: '$34' },
  { id: 'sku-3', name: 'Mechanical Pad', price: '$62' },
  { id: 'sku-4', name: 'Smart Desk Lamp', price: '$41' }
];

const catalogEl = document.getElementById('catalog');
const cartListEl = document.getElementById('cart-list');
const cartCountEl = document.getElementById('cart-count');
const outputEl = document.getElementById('bridge-output');

let cart = [];
try {
  const saved = window.APKBridge ? window.APKBridge.readStorage('shop_cart') : null;
  if (saved) cart = JSON.parse(saved);
} catch (_) {}

function renderCart() {
  cartCountEl.textContent = String(cart.length);
  cartListEl.innerHTML = '';
  cart.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item.name + ' (' + item.price + ')';
    cartListEl.appendChild(li);
  });
}

ITEMS.forEach((item) => {
  const card = document.createElement('div');
  card.className = 'item';
  const title = document.createElement('div');
  title.className = 'item-title';
  title.textContent = item.name;
  const price = document.createElement('div');
  price.className = 'item-price';
  price.textContent = item.price;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-primary';
  btn.textContent = 'Add to Cart';
  btn.addEventListener('click', () => {
    cart.push(item);
    renderCart();
    if (window.APKBridge) {
      window.APKBridge.writeStorage('shop_cart', JSON.stringify(cart));
      window.APKBridge.vibrate(40);
      window.APKBridge.showToast('Added ' + item.name + ' to cart');
      outputEl.textContent = 'Bridge -> showToast & writeStorage("' + item.name + '")';
    }
  });
  card.append(title, price, btn);
  catalogEl.appendChild(card);
});

document.getElementById('device-btn').addEventListener('click', () => {
  if (window.APKBridge) {
    const info = window.APKBridge.getDeviceInfo();
    outputEl.textContent = 'Device: ' + JSON.stringify(info);
  }
});

document.getElementById('share-btn').addEventListener('click', () => {
  const summary = cart.length
    ? 'My ShopPulse Order: ' + cart.map((i) => i.name).join(', ')
    : 'Check out ShopPulse Mobile Store!';
  if (window.APKBridge) {
    window.APKBridge.shareText('ShopPulse Order', summary);
    outputEl.textContent = 'Bridge -> shareText("' + summary + '")';
  }
});

renderCart();`
  );

  return zip.generateAsync({ type: 'nodebuffer' });
}

function verifyZipMagicOnDisk(filePath: string): void {
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(4);
    const bytesRead = fs.readSync(fd, header, 0, 4, 0);
    if (bytesRead < 4 || header[0] !== 0x50 || header[1] !== 0x4b) {
      throw new Error('Uploaded file is not a valid APK or ZIP archive.');
    }
  } finally {
    fs.closeSync(fd);
  }
}

export async function extractApkOrSourceArchive(
  fileBuffer: Buffer,
  fileName: string,
  isSample = false
): Promise<SessionData> {
  const sessionId = createSessionId();
  const root = getSessionRoot(sessionId);
  const tempPath = resolveConfinedPath(root, 'upload-temp.apk');
  fs.writeFileSync(tempPath, fileBuffer);
  return extractApkOrSourceFromFile(tempPath, fileName, isSample, sessionId);
}

export async function extractApkOrSourceFromFile(
  filePath: string,
  fileName: string,
  isSample = false,
  existingSessionId?: string
): Promise<SessionData> {
  verifyZipMagicOnDisk(filePath);

  const sessionId = existingSessionId || createSessionId();
  const root = getSessionRoot(sessionId);
  const rawExtractDir = resolveConfinedPath(root, 'raw_extract');
  fs.mkdirSync(rawExtractDir, { recursive: true });

  // Stream-extract relevant APK/ZIP entries on disk (supports up to 1 GB archives safely)
  await runZipStream(['extract', filePath, rawExtractDir]);

  const indexPath = resolveConfinedPath(rawExtractDir, '_apk_entries_index.json');
  const entriesIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as Array<{
    path: string;
    size: number;
    compressedSize: number;
  }>;
  const entryNames = entriesIndex.map((e) => e.path);

  const hasRootBinaryManifest = entryNames.includes('AndroidManifest.xml');
  const hasDexFiles = entryNames.some((e) => /^classes\d*\.dex$/i.test(e));
  const isApkPackage =
    hasRootBinaryManifest || hasDexFiles || fileName.toLowerCase().endsWith('.apk');

  let manifest: DecodedManifest = {
    xml: '',
    packageName: 'com.apkbridge.webapp',
    versionCode: '1',
    versionName: '1.0.0',
    minSdkVersion: '21',
    targetSdkVersion: '34',
    appName: 'APKBridge App',
    permissions: ['android.permission.INTERNET'],
    activities: ['com.apkbridge.webapp.MainActivity'],
    mainActivity: 'com.apkbridge.webapp.MainActivity',
    usesCleartextTraffic: true,
    stringPool: [],
  };

  const dexSummaries: Array<{ fileName: string; parsed: ParsedDex }> = [];
  let hasWebAssets = false;
  let detectedWebRoot = 'assets/www';

  if (isApkPackage) {
    // Move or copy original binary APK onto disk in session/original/base.apk without loading into RAM
    const origDir = resolveConfinedPath(root, 'original');
    fs.mkdirSync(origDir, { recursive: true });
    const baseApkPath = resolveConfinedPath(origDir, 'base.apk');
    if (path.resolve(filePath) !== baseApkPath) {
      fs.copyFileSync(filePath, baseApkPath);
    }

    // 1. Decode AndroidManifest.xml (and save binary manifest copy for fast patching on rebuild)
    const extractedManifestPath = resolveConfinedPath(rawExtractDir, 'AndroidManifest.xml');
    if (fs.existsSync(extractedManifestPath)) {
      const mBuf = fs.readFileSync(extractedManifestPath);
      writeSessionFile(sessionId, 'original', 'AndroidManifest.xml', mBuf);
      manifest = decodeAxml(mBuf);
    }

    writeSessionFile(
      sessionId,
      'source',
      'app/src/main/AndroidManifest.xml',
      manifest.xml ||
        generateAndroidManifestXml({
          appName: manifest.appName || 'APKBridge App',
          packageName: manifest.packageName || 'com.apkbridge.webapp',
          versionName: manifest.versionName || '1.0.0',
          versionCode: Number(manifest.versionCode) || 1,
          entryFile: 'index.html',
          enableBridge: true,
          enableGeolocation: false,
          enableCamera: false,
          enableStorage: false,
          allowMixedContent: true,
          handleBackButton: true,
          statusBarColor: '#0F172A',
          bridgeMethods: [
            'showToast',
            'getDeviceInfo',
            'vibrate',
            'shareText',
            'writeStorage',
            'readStorage',
          ],
        })
    );

    // 2. Parse DEX files & extract Java class outlines
    const dexNames = entryNames.filter((e) => /^classes\d*\.dex$/i.test(e)).sort();
    const classIndexLines: string[] = [];

    for (const dexName of dexNames) {
      const dexDiskPath = resolveConfinedPath(rawExtractDir, dexName);
      if (!fs.existsSync(dexDiskPath)) continue;
      const dBuf = fs.readFileSync(dexDiskPath);
      if (!isValidDex(dBuf)) continue;
      const parsed = parseDex(dBuf, 280);
      dexSummaries.push({ fileName: dexName, parsed });
      classIndexLines.push(
        `=== ${dexName} (DEX v${parsed.version}, ${parsed.classCount} classes, ${parsed.methodCount} methods, SHA-1: ${parsed.sha1Hex}) ===`
      );

      const pkgPrefix = manifest.packageName ? `${manifest.packageName}.` : '';
      const sortedClasses = [...parsed.classes].sort((a, b) => {
        const aOwn = pkgPrefix && a.javaName.startsWith(pkgPrefix) ? 0 : 1;
        const bOwn = pkgPrefix && b.javaName.startsWith(pkgPrefix) ? 0 : 1;
        return aOwn - bOwn || a.javaName.localeCompare(b.javaName);
      });

      let writtenCount = 0;
      for (const cls of sortedClasses) {
        classIndexLines.push(
          `  - ${cls.javaName} (${cls.methods.length} methods, ${cls.fields.length} fields)`
        );
        if (writtenCount < 140 && cls.javaName && !cls.javaName.includes('$')) {
          const javaRelPath = `app/src/main/java/${cls.javaName.replace(/\./g, '/')}.java`;
          writeSessionFile(sessionId, 'source', javaRelPath, renderDecompiledJavaClass(cls));
          writtenCount++;
        }
      }
    }

    if (classIndexLines.length > 0) {
      writeSessionFile(sessionId, 'source', 'DEX_CLASS_INDEX.txt', classIndexLines.join('\n'));
    }

    // Write full APK contents inventory (essential for 1 GB APKs containing large native libs/OBBs)
    const inventoryLines = entriesIndex.map(
      (item) => `${item.path}\t${item.size} bytes (compressed ${item.compressedSize} bytes)`
    );
    writeSessionFile(sessionId, 'source', 'APK_CONTENTS_INDEX.txt', inventoryLines.join('\n'));

    // 3. Copy extracted assets/ and decoded res/ into source/
    const walkExtracted = (dir: string, prefix: string) => {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const rel = prefix ? `${prefix}/${item.name}` : item.name;
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
          walkExtracted(full, rel);
        } else if (item.isFile()) {
          if (rel.startsWith('assets/')) {
            const buf = fs.readFileSync(full);
            writeSessionFile(sessionId, 'source', `app/src/main/${rel}`, buf);
            if (rel.startsWith('assets/public/')) {
              hasWebAssets = true;
              detectedWebRoot = 'assets/public';
            } else if (rel.startsWith('assets/www/')) {
              hasWebAssets = true;
              detectedWebRoot = 'assets/www';
            } else if (rel.endsWith('.html')) {
              hasWebAssets = true;
            }
          } else if (rel.startsWith('res/')) {
            const buf = fs.readFileSync(full);
            if (rel.endsWith('.xml') && isBinaryAxml(buf)) {
              const decoded = decodeAxml(buf);
              writeSessionFile(sessionId, 'source', `app/src/main/${rel}`, decoded.xml);
            } else {
              writeSessionFile(sessionId, 'source', `app/src/main/${rel}`, buf);
            }
          }
        }
      }
    };
    walkExtracted(rawExtractDir, '');
  } else {
    // User uploaded an Android source ZIP
    let foundManifestPath = '';
    const walkSourceZip = (dir: string, prefix: string) => {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const rel = prefix ? `${prefix}/${item.name}` : item.name;
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
          walkSourceZip(full, rel);
        } else if (item.isFile() && rel !== '_apk_entries_index.json') {
          const buf = fs.readFileSync(full);
          writeSessionFile(sessionId, 'source', rel, buf);
          if (rel.endsWith('AndroidManifest.xml') && !foundManifestPath) {
            foundManifestPath = rel;
            manifest = isBinaryAxml(buf)
              ? decodeAxml(buf)
              : extractManifestMetadataFromXml(buf.toString('utf8'), []);
          }
          if (rel.includes('assets/www/')) {
            hasWebAssets = true;
            detectedWebRoot = 'assets/www';
          }
        }
      }
    };
    walkSourceZip(rawExtractDir, '');
  }

  // Clean up temporary raw extraction directory & temp upload copy
  fs.rmSync(rawExtractDir, { recursive: true, force: true });
  const tempUploadFile = resolveConfinedPath(root, 'upload-temp.apk');
  if (fs.existsSync(tempUploadFile)) {
    fs.rmSync(tempUploadFile, { force: true });
  }

  // Ensure Gradle scaffold exists
  const defaultBridgeConfig: BridgeConfig = {
    appName: manifest.appName || 'APKBridge App',
    packageName: manifest.packageName || 'com.apkbridge.webapp',
    versionName: manifest.versionName || '1.0.0',
    versionCode: Number(manifest.versionCode) || 1,
    entryFile: 'index.html',
    enableBridge: true,
    enableGeolocation: manifest.permissions.includes('android.permission.ACCESS_FINE_LOCATION'),
    enableCamera: manifest.permissions.includes('android.permission.CAMERA'),
    enableStorage: manifest.permissions.includes('android.permission.READ_EXTERNAL_STORAGE'),
    allowMixedContent: true,
    handleBackButton: true,
    statusBarColor: '#0F172A',
    bridgeMethods: [
      'showToast',
      'getDeviceInfo',
      'vibrate',
      'shareText',
      'openExternalUrl',
      'writeStorage',
      'readStorage',
    ],
  };

  const ensureSourceFile = (relPath: string, content: string) => {
    const full = resolveConfinedPath(resolveConfinedPath(root, 'source'), relPath);
    if (!fs.existsSync(full)) {
      writeSessionFile(sessionId, 'source', relPath, content);
    }
  };

  ensureSourceFile(
    'build.gradle',
    `buildscript {\n    repositories {\n        google()\n        mavenCentral()\n    }\n    dependencies {\n        classpath 'com.android.tools.build:gradle:8.3.2'\n    }\n}\n`
  );
  ensureSourceFile(
    'settings.gradle',
    `rootProject.name = "${defaultBridgeConfig.appName.replace(/"/g, '')}"\ninclude ':app'\n`
  );
  ensureSourceFile('app/build.gradle', generateAppBuildGradle(defaultBridgeConfig));
  ensureSourceFile('app/src/main/res/layout/activity_main.xml', generateActivityMainLayout());
  ensureSourceFile(
    'app/src/main/res/values/strings.xml',
    generateStringsXml(defaultBridgeConfig.appName)
  );

  const session: SessionData = {
    id: sessionId,
    createdAt: Date.now(),
    originalFileName: fileName,
    sourceType: isSample ? 'sample' : isApkPackage ? 'apk' : 'zip',
    manifest,
    dexSummaries,
    hasWebAssets,
    detectedWebRoot,
    sourceFiles: listSessionFiles(sessionId, 'source'),
    webFiles: listSessionFiles(sessionId, 'www'),
    bridgeConfig: defaultBridgeConfig,
  };

  for (const sf of session.sourceFiles) {
    if (sf.path.startsWith('app/src/main/assets/www/')) {
      const relWeb = sf.path.slice('app/src/main/assets/www/'.length);
      const buf = readSessionFile(sessionId, 'source', sf.path);
      writeSessionFile(sessionId, 'www', relWeb, buf);
    }
  }
  session.webFiles = listSessionFiles(sessionId, 'www');
  saveSession(session);
  return session;
}

export async function connectWebsiteToSession(
  sessionId: string,
  files: Array<{ originalName: string; buffer: Buffer }>,
  config: BridgeConfig
): Promise<SessionData> {
  const session = getSession(sessionId);
  if (!session) throw new Error('Session not found or expired');

  const root = getSessionRoot(sessionId);
  const wwwDir = resolveConfinedPath(root, 'www');
  fs.rmSync(wwwDir, { recursive: true, force: true });
  fs.mkdirSync(wwwDir, { recursive: true });

  // Also clear old assets/www inside source
  const sourceWwwDir = resolveConfinedPath(
    resolveConfinedPath(root, 'source'),
    'app/src/main/assets/www'
  );
  fs.rmSync(sourceWwwDir, { recursive: true, force: true });
  fs.mkdirSync(sourceWwwDir, { recursive: true });

  const extractedWebEntries = new Map<string, Buffer>();

  for (const uploaded of files) {
    const lower = uploaded.originalName.toLowerCase();
    const isZip =
      lower.endsWith('.zip') ||
      (uploaded.buffer.length >= 4 && uploaded.buffer[0] === 0x50 && uploaded.buffer[1] === 0x4b);

    if (isZip) {
      const zip = await JSZip.loadAsync(uploaded.buffer);
      const rawPaths = Object.keys(zip.files)
        .filter((k) => !zip.files[k].dir)
        .map((k) => sanitizeZipEntryPath(k))
        .filter((k): k is string => Boolean(k));

      // Detect if all files share a single top-level directory (e.g. dist/index.html -> index.html)
      let stripPrefix = '';
      if (rawPaths.length > 0 && !rawPaths.includes('index.html')) {
        const firstSegments = new Set(rawPaths.map((p) => p.split('/')[0]));
        if (firstSegments.size === 1) {
          const candidate = `${Array.from(firstSegments)[0]}/`;
          if (rawPaths.some((p) => p === `${candidate}index.html` || p.startsWith(candidate))) {
            stripPrefix = candidate;
          }
        }
      }

      for (const rawKey of Object.keys(zip.files)) {
        if (zip.files[rawKey].dir) continue;
        const clean = sanitizeZipEntryPath(rawKey);
        if (!clean) continue;
        const finalRel = stripPrefix && clean.startsWith(stripPrefix)
          ? clean.slice(stripPrefix.length)
          : clean;
        if (!finalRel) continue;
        const buf = await zip.file(rawKey)!.async('nodebuffer');
        extractedWebEntries.set(finalRel, buf);
      }
    } else {
      const clean = sanitizeZipEntryPath(uploaded.originalName);
      if (clean) {
        extractedWebEntries.set(clean, uploaded.buffer);
      }
    }
  }

  if (extractedWebEntries.size === 0) {
    throw new Error('No valid website files found in upload.');
  }

  // Determine entry HTML file
  let entryFile = config.entryFile.replace(/^\/+/, '');
  if (!extractedWebEntries.has(entryFile)) {
    const htmlCandidate = Array.from(extractedWebEntries.keys()).find((p) =>
      p.toLowerCase().endsWith('.html')
    );
    entryFile = htmlCandidate || Array.from(extractedWebEntries.keys())[0];
  }

  const normalizedConfig: BridgeConfig = {
    ...config,
    entryFile,
  };

  // Inject android-bridge.js and wire entry HTML
  if (normalizedConfig.enableBridge) {
    const bridgeJs = generateAndroidBridgeJs(normalizedConfig);
    extractedWebEntries.set('android-bridge.js', Buffer.from(bridgeJs, 'utf8'));

    if (entryFile.toLowerCase().endsWith('.html') && extractedWebEntries.has(entryFile)) {
      const depth = entryFile.split('/').length - 1;
      const prefix = depth > 0 ? '../'.repeat(depth) : './';
      const origHtml = extractedWebEntries.get(entryFile)!.toString('utf8');
      const patchedHtml = injectBridgeIntoHtml(origHtml, `${prefix}android-bridge.js`);
      extractedWebEntries.set(entryFile, Buffer.from(patchedHtml, 'utf8'));
    }
  }

  // Write connected website files into both www/ (live preview) and source/app/src/main/assets/www/
  for (const [relPath, buf] of extractedWebEntries.entries()) {
    writeSessionFile(sessionId, 'www', relPath, buf);
    writeSessionFile(sessionId, 'source', `app/src/main/assets/www/${relPath}`, buf);
  }

  // Connect Android Java Source & Manifest to the Website
  const pkgPath = normalizedConfig.packageName.replace(/\./g, '/');
  writeSessionFile(
    sessionId,
    'source',
    `app/src/main/java/${pkgPath}/MainActivity.java`,
    generateMainActivityJava(normalizedConfig)
  );
  writeSessionFile(
    sessionId,
    'source',
    `app/src/main/java/${pkgPath}/WebAppBridge.java`,
    generateWebAppBridgeJava(normalizedConfig)
  );
  const newManifestXml = generateAndroidManifestXml(normalizedConfig);
  writeSessionFile(sessionId, 'source', 'app/src/main/AndroidManifest.xml', newManifestXml);
  writeSessionFile(sessionId, 'source', 'app/src/main/res/layout/activity_main.xml', generateActivityMainLayout());
  writeSessionFile(sessionId, 'source', 'app/src/main/res/values/strings.xml', generateStringsXml(normalizedConfig.appName));
  writeSessionFile(sessionId, 'source', 'app/build.gradle', generateAppBuildGradle(normalizedConfig));

  session.bridgeConfig = normalizedConfig;
  session.hasWebAssets = true;
  session.manifest = extractManifestMetadataFromXml(newManifestXml, session.manifest.stringPool);
  session.sourceFiles = listSessionFiles(sessionId, 'source');
  session.webFiles = listSessionFiles(sessionId, 'www');
  saveSession(session);

  return session;
}

export async function rebuildSessionApk(sessionId: string): Promise<SessionData> {
  const session = getSession(sessionId);
  if (!session) throw new Error('Session not found or expired');

  const root = getSessionRoot(sessionId);
  const origDir = resolveConfinedPath(root, 'original');
  fs.mkdirSync(origDir, { recursive: true });
  const origApkPath = resolveConfinedPath(origDir, 'base.apk');

  if (!fs.existsSync(origApkPath)) {
    const sampleBuf = await createSampleApkBuffer();
    fs.writeFileSync(origApkPath, sampleBuf);
  }

  const buildDir = resolveConfinedPath(root, 'build');
  fs.mkdirSync(buildDir, { recursive: true });

  // 1. Patch binary AndroidManifest.xml if original binary manifest exists
  const origManifestDiskPath = resolveConfinedPath(origDir, 'AndroidManifest.xml');
  const patchedManifestPath = resolveConfinedPath(buildDir, 'patched_AndroidManifest.xml');
  let manifestArg = '';
  if (fs.existsSync(origManifestDiskPath)) {
    const mBuf = fs.readFileSync(origManifestDiskPath);
    if (isBinaryAxml(mBuf)) {
      const origDecoded = decodeAxml(mBuf);
      const replacements: Record<string, string> = {};
      if (
        origDecoded.appName &&
        session.bridgeConfig.appName &&
        origDecoded.appName !== session.bridgeConfig.appName
      ) {
        replacements[origDecoded.appName] = session.bridgeConfig.appName;
      }
      if (
        origDecoded.versionName &&
        session.bridgeConfig.versionName &&
        origDecoded.versionName !== session.bridgeConfig.versionName
      ) {
        replacements[origDecoded.versionName] = session.bridgeConfig.versionName;
      }
      if (
        origDecoded.packageName &&
        session.bridgeConfig.packageName &&
        origDecoded.packageName !== session.bridgeConfig.packageName
      ) {
        replacements[origDecoded.packageName] = session.bridgeConfig.packageName;
      }
      if (Object.keys(replacements).length > 0) {
        fs.writeFileSync(patchedManifestPath, patchAxmlStringPool(mBuf, replacements));
        manifestArg = patchedManifestPath;
      }
    }
  }

  // 2. Write bridge runtime config JSON
  const bridgeConfigPath = resolveConfinedPath(buildDir, 'apkbridge-config.json');
  fs.writeFileSync(
    bridgeConfigPath,
    JSON.stringify(
      {
        appName: session.bridgeConfig.appName,
        packageName: session.bridgeConfig.packageName,
        versionName: session.bridgeConfig.versionName,
        versionCode: session.bridgeConfig.versionCode,
        entryFile: session.bridgeConfig.entryFile,
        bridgeEnabled: session.bridgeConfig.enableBridge,
        builtAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  const safeSlug =
    session.bridgeConfig.appName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'app';
  const apkFileName = `${safeSlug}-rebuilt-signed.apk`;
  const sourceZipFileName = `${safeSlug}-connected-source.zip`;

  const outApkPath = resolveConfinedPath(buildDir, apkFileName);
  const digestsOutPath = resolveConfinedPath(buildDir, 'entries_digests.json');
  const wwwDir = resolveConfinedPath(root, 'www');
  fs.mkdirSync(wwwDir, { recursive: true });

  // 3. Stream-rebuild APK on disk (supports up to 1 GB base APKs)
  await runZipStream([
    'rebuild',
    origApkPath,
    wwwDir,
    outApkPath,
    manifestArg,
    bridgeConfigPath,
    digestsOutPath,
  ]);

  // 4. Generate RSA-2048 X.509 PKCS#7 signature from streaming SHA-256 digests and append META-INF
  const digests = JSON.parse(fs.readFileSync(digestsOutPath, 'utf8')) as EntryDigest[];
  const { manifestBuf, sfBuf, certRsaBuf, signingInfo } = generateMetaInfFromDigests(
    digests,
    session.bridgeConfig.appName
  );
  const metaInfDir = resolveConfinedPath(buildDir, 'meta_inf');
  fs.mkdirSync(metaInfDir, { recursive: true });
  fs.writeFileSync(path.join(metaInfDir, 'MANIFEST.MF'), manifestBuf);
  fs.writeFileSync(path.join(metaInfDir, 'CERT.SF'), sfBuf);
  fs.writeFileSync(path.join(metaInfDir, 'CERT.RSA'), certRsaBuf);

  await runZipStream(['append_meta', outApkPath, metaInfDir]);

  // 5. Stream-package complete connected Android Studio source ZIP
  const sourceDir = resolveConfinedPath(root, 'source');
  const sourceZipPath = resolveConfinedPath(buildDir, sourceZipFileName);
  await runZipStream(['zip_dir', sourceDir, sourceZipPath]);

  const apkSize = fs.statSync(outApkPath).size;
  const sourceZipSize = fs.statSync(sourceZipPath).size;
  const webFiles = listSessionFiles(sessionId, 'www');

  session.lastBuild = {
    apkFileName,
    sourceZipFileName,
    apkSize,
    sourceZipSize,
    builtAt: new Date().toISOString(),
    signingInfo,
    webFilesCount: webFiles.length,
  };
  saveSession(session);
  return session;
}

export async function packageSourceZipToFile(sessionId: string): Promise<string> {
  const root = getSessionRoot(sessionId);
  const sourceDir = resolveConfinedPath(root, 'source');
  const buildDir = resolveConfinedPath(root, 'build');
  fs.mkdirSync(buildDir, { recursive: true });
  const outPath = resolveConfinedPath(buildDir, 'extracted-source.zip');
  await runZipStream(['zip_dir', sourceDir, outPath]);
  return outPath;
}
