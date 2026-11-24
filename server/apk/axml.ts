// Android Binary XML (AXML) decoder, string-pool patcher, and encoder

export interface ManifestAttribute {
  namespace: string;
  name: string;
  value: string;
  type: number;
  rawData: number;
}

export interface DecodedManifest {
  xml: string;
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
  stringPool: string[];
}

const RES_XML_TYPE = 0x0003;
const RES_STRING_POOL_TYPE = 0x0001;
const RES_XML_RESOURCE_MAP_TYPE = 0x0180;
const RES_XML_START_NAMESPACE_TYPE = 0x0100;
const RES_XML_END_NAMESPACE_TYPE = 0x0101;
const RES_XML_START_ELEMENT_TYPE = 0x0102;
const RES_XML_END_ELEMENT_TYPE = 0x0103;
const RES_XML_CDATA_TYPE = 0x0104;
const UTF8_FLAG = 0x00000100;

// TypedValue types
const TYPE_NULL = 0x00;
const TYPE_REFERENCE = 0x01;
const TYPE_ATTRIBUTE = 0x02;
const TYPE_STRING = 0x03;
const TYPE_FLOAT = 0x04;
const TYPE_DIMENSION = 0x05;
const TYPE_FRACTION = 0x06;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const TYPE_INT_BOOLEAN = 0x12;

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function readUtf8Length(buf: Buffer, offset: number): { length: number; next: number } {
  const first = buf[offset];
  if ((first & 0x80) !== 0) {
    const second = buf[offset + 1];
    return { length: ((first & 0x7f) << 8) | second, next: offset + 2 };
  }
  return { length: first, next: offset + 1 };
}

function readUtf16Length(buf: Buffer, offset: number): { length: number; next: number } {
  const first = buf.readUInt16LE(offset);
  if ((first & 0x8000) !== 0) {
    const second = buf.readUInt16LE(offset + 2);
    return { length: ((first & 0x7fff) << 16) | second, next: offset + 4 };
  }
  return { length: first, next: offset + 2 };
}

export function decodeStringPool(buf: Buffer, chunkStart: number): {
  strings: string[];
  isUtf8: boolean;
  chunkSize: number;
} {
  const headerSize = buf.readUInt16LE(chunkStart + 2);
  const chunkSize = buf.readUInt32LE(chunkStart + 4);
  const stringCount = buf.readUInt32LE(chunkStart + 8);
  const flags = buf.readUInt32LE(chunkStart + 16);
  const stringsStart = buf.readUInt32LE(chunkStart + 20);
  const isUtf8 = (flags & UTF8_FLAG) !== 0;

  const strings: string[] = [];
  const offsetsBase = chunkStart + headerSize;
  const dataBase = chunkStart + stringsStart;

  for (let i = 0; i < stringCount; i++) {
    const strOff = buf.readUInt32LE(offsetsBase + i * 4);
    let pos = dataBase + strOff;
    if (pos >= chunkStart + chunkSize || pos >= buf.length) {
      strings.push('');
      continue;
    }

    if (isUtf8) {
      const charLen = readUtf8Length(buf, pos);
      pos = charLen.next;
      const byteLen = readUtf8Length(buf, pos);
      pos = byteLen.next;
      const end = Math.min(pos + byteLen.length, buf.length);
      strings.push(buf.toString('utf8', pos, end));
    } else {
      const charLen = readUtf16Length(buf, pos);
      pos = charLen.next;
      const byteLen = charLen.length * 2;
      const end = Math.min(pos + byteLen, buf.length);
      strings.push(buf.toString('utf16le', pos, end));
    }
  }

  return { strings, isUtf8, chunkSize };
}

function formatTypedValue(
  type: number,
  data: number,
  rawValueIndex: number,
  strings: string[]
): string {
  if (rawValueIndex >= 0 && rawValueIndex < strings.length) {
    return strings[rawValueIndex];
  }
  switch (type) {
    case TYPE_NULL:
      return '';
    case TYPE_STRING:
      return data >= 0 && data < strings.length ? strings[data] : `@string/${data}`;
    case TYPE_REFERENCE:
      return `@0x${(data >>> 0).toString(16).padStart(8, '0')}`;
    case TYPE_ATTRIBUTE:
      return `?0x${(data >>> 0).toString(16).padStart(8, '0')}`;
    case TYPE_INT_DEC:
      return String(data | 0);
    case TYPE_INT_HEX:
      return `0x${(data >>> 0).toString(16)}`;
    case TYPE_INT_BOOLEAN:
      return data !== 0 ? 'true' : 'false';
    case TYPE_FLOAT: {
      const b = Buffer.allocUnsafe(4);
      b.writeInt32LE(data, 0);
      return String(Number(b.readFloatLE(0).toFixed(4)));
    }
    case TYPE_DIMENSION:
    case TYPE_FRACTION:
      return `${data}`;
    default:
      return `0x${(data >>> 0).toString(16)}`;
  }
}

export function isBinaryAxml(buf: Buffer): boolean {
  if (buf.length < 8) return false;
  return buf.readUInt16LE(0) === RES_XML_TYPE;
}

export function decodeAxml(buf: Buffer): DecodedManifest {
  // Handle plain-text XML fallback gracefully
  if (!isBinaryAxml(buf)) {
    const xmlText = buf.toString('utf8');
    return extractManifestMetadataFromXml(xmlText, []);
  }

  const totalSize = Math.min(buf.readUInt32LE(4), buf.length);
  let offset = buf.readUInt16LE(2); // usually 8
  let strings: string[] = [];
  const nsMap = new Map<string, string>();
  const lines: string[] = ['<?xml version="1.0" encoding="utf-8"?>'];
  let indent = 0;

  let packageName = '';
  let versionCode = '1';
  let versionName = '1.0';
  let minSdkVersion = '21';
  let targetSdkVersion = '34';
  let appName = '';
  const permissions: string[] = [];
  const activities: string[] = [];
  let mainActivity = '';
  let usesCleartextTraffic = false;

  let currentActivity = '';
  let currentActivityHasMain = false;
  let currentActivityHasLauncher = false;

  const getStr = (idx: number): string => {
    if (idx < 0 || idx >= strings.length) return '';
    return strings[idx];
  };

  while (offset + 8 <= totalSize) {
    const chunkType = buf.readUInt16LE(offset);
    const headerSize = buf.readUInt16LE(offset + 2);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkSize < 8 || offset + chunkSize > totalSize) break;

    if (chunkType === RES_STRING_POOL_TYPE) {
      const pool = decodeStringPool(buf, offset);
      strings = pool.strings;
    } else if (chunkType === RES_XML_START_NAMESPACE_TYPE) {
      const prefixIdx = buf.readInt32LE(offset + 16);
      const uriIdx = buf.readInt32LE(offset + 20);
      const prefix = getStr(prefixIdx);
      const uri = getStr(uriIdx);
      if (uri) nsMap.set(uri, prefix || 'android');
    } else if (chunkType === RES_XML_START_ELEMENT_TYPE) {
      const nsIdx = buf.readInt32LE(offset + 16);
      const nameIdx = buf.readInt32LE(offset + 20);
      const attrStart = buf.readUInt16LE(offset + 24);
      const attrSize = buf.readUInt16LE(offset + 26);
      const attrCount = buf.readUInt16LE(offset + 28);

      const tagNs = getStr(nsIdx);
      const tagPrefix = tagNs ? nsMap.get(tagNs) : '';
      const rawTagName = getStr(nameIdx);
      const tagName = tagPrefix ? `${tagPrefix}:${rawTagName}` : rawTagName;

      const attrs: string[] = [];
      if (indent === 0) {
        for (const [uri, prefix] of nsMap.entries()) {
          attrs.push(`xmlns:${prefix}="${escapeXml(uri)}"`);
        }
      }

      const attrsBase = offset + 16 + attrStart;
      const parsedAttrs: Record<string, string> = {};

      for (let i = 0; i < attrCount; i++) {
        const aOff = attrsBase + i * attrSize;
        if (aOff + 20 > offset + chunkSize) break;
        const aNsIdx = buf.readInt32LE(aOff);
        const aNameIdx = buf.readInt32LE(aOff + 4);
        const aRawIdx = buf.readInt32LE(aOff + 8);
        const dataType = buf.readUInt8(aOff + 15);
        const data = buf.readInt32LE(aOff + 16);

        const aNs = getStr(aNsIdx);
        const aPrefix = aNs ? nsMap.get(aNs) || 'android' : '';
        const aName = getStr(aNameIdx);
        const val = formatTypedValue(dataType, data, aRawIdx, strings);
        const fullKey = aPrefix ? `${aPrefix}:${aName}` : aName;
        parsedAttrs[aName] = val;
        attrs.push(`${fullKey}="${escapeXml(val)}"`);
      }

      // Extract semantic metadata
      if (rawTagName === 'manifest') {
        if (parsedAttrs.package) packageName = parsedAttrs.package;
        if (parsedAttrs.versionCode) versionCode = parsedAttrs.versionCode;
        if (parsedAttrs.versionName) versionName = parsedAttrs.versionName;
      } else if (rawTagName === 'uses-sdk') {
        if (parsedAttrs.minSdkVersion) minSdkVersion = parsedAttrs.minSdkVersion;
        if (parsedAttrs.targetSdkVersion) targetSdkVersion = parsedAttrs.targetSdkVersion;
      } else if (rawTagName === 'uses-permission' && parsedAttrs.name) {
        permissions.push(parsedAttrs.name);
      } else if (rawTagName === 'application') {
        if (parsedAttrs.label && !parsedAttrs.label.startsWith('@0x')) {
          appName = parsedAttrs.label;
        }
        if (parsedAttrs.usesCleartextTraffic === 'true') {
          usesCleartextTraffic = true;
        }
      } else if (rawTagName === 'activity' || rawTagName === 'activity-alias') {
        const act = parsedAttrs.name || '';
        if (act) {
          const fullAct = act.startsWith('.') && packageName ? `${packageName}${act}` : act;
          activities.push(fullAct);
          currentActivity = fullAct;
          currentActivityHasMain = false;
          currentActivityHasLauncher = false;
        }
      } else if (rawTagName === 'action' && parsedAttrs.name === 'android.intent.action.MAIN') {
        currentActivityHasMain = true;
      } else if (rawTagName === 'category' && parsedAttrs.name === 'android.intent.category.LAUNCHER') {
        currentActivityHasLauncher = true;
      }

      const pad = '  '.repeat(indent);
      if (attrs.length === 0) {
        lines.push(`${pad}<${tagName}>`);
      } else if (attrs.length <= 2) {
        lines.push(`${pad}<${tagName} ${attrs.join(' ')}>`);
      } else {
        lines.push(`${pad}<${tagName}`);
        for (let i = 0; i < attrs.length; i++) {
          const suffix = i === attrs.length - 1 ? '>' : '';
          lines.push(`${pad}  ${attrs[i]}${suffix}`);
        }
      }
      indent++;
    } else if (chunkType === RES_XML_END_ELEMENT_TYPE) {
      indent = Math.max(0, indent - 1);
      const nsIdx = buf.readInt32LE(offset + 16);
      const nameIdx = buf.readInt32LE(offset + 20);
      const tagNs = getStr(nsIdx);
      const tagPrefix = tagNs ? nsMap.get(tagNs) : '';
      const rawTagName = getStr(nameIdx);
      const tagName = tagPrefix ? `${tagPrefix}:${rawTagName}` : rawTagName;

      if ((rawTagName === 'activity' || rawTagName === 'activity-alias') && currentActivity) {
        if (currentActivityHasMain && currentActivityHasLauncher && !mainActivity) {
          mainActivity = currentActivity;
        }
        currentActivity = '';
      }

      lines.push(`${'  '.repeat(indent)}</${tagName}>`);
    } else if (chunkType === RES_XML_CDATA_TYPE) {
      const dataIdx = buf.readInt32LE(offset + 16);
      const text = getStr(dataIdx);
      if (text) {
        lines.push(`${'  '.repeat(indent)}${escapeXml(text)}`);
      }
    } else if (chunkType === RES_XML_RESOURCE_MAP_TYPE || chunkType === RES_XML_END_NAMESPACE_TYPE) {
      // Valid structural chunks; nothing to emit
    } else {
      // Skip unknown chunk safely using headerSize/chunkSize
      void headerSize;
    }

    offset += chunkSize;
  }

  if (!mainActivity && activities.length > 0) {
    mainActivity = activities[0];
  }
  if (!appName && packageName) {
    const parts = packageName.split('.');
    appName = parts[parts.length - 1] || 'AndroidApp';
  }

  return {
    xml: lines.join('\n'),
    packageName,
    versionCode,
    versionName,
    minSdkVersion,
    targetSdkVersion,
    appName,
    permissions: Array.from(new Set(permissions)),
    activities: Array.from(new Set(activities)),
    mainActivity,
    usesCleartextTraffic,
    stringPool: strings,
  };
}

export function extractManifestMetadataFromXml(
  xmlText: string,
  stringPool: string[]
): DecodedManifest {
  const getAttr = (tagPattern: RegExp, attrName: string): string => {
    const tagMatch = xmlText.match(tagPattern);
    if (!tagMatch) return '';
    const attrMatch = tagMatch[0].match(new RegExp(`${attrName}="([^"]+)"`));
    return attrMatch ? attrMatch[1] : '';
  };

  const packageName = getAttr(/<manifest\b[\s\S]*?>/, 'package') || 'com.example.webapp';
  const versionCode = getAttr(/<manifest\b[\s\S]*?>/, 'android:versionCode') || '1';
  const versionName = getAttr(/<manifest\b[\s\S]*?>/, 'android:versionName') || '1.0.0';
  const minSdkVersion = getAttr(/<uses-sdk\b[\s\S]*?>/, 'android:minSdkVersion') || '21';
  const targetSdkVersion = getAttr(/<uses-sdk\b[\s\S]*?>/, 'android:targetSdkVersion') || '34';
  const appName = getAttr(/<application\b[\s\S]*?>/, 'android:label') || 'WebBridgeApp';
  const usesCleartextTraffic = /android:usesCleartextTraffic="true"/.test(xmlText);

  const permissions: string[] = [];
  const permRegex = /<uses-permission[^>]*android:name="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = permRegex.exec(xmlText)) !== null) {
    permissions.push(m[1]);
  }

  const activities: string[] = [];
  const actRegex = /<activity[^>]*android:name="([^"]+)"/g;
  while ((m = actRegex.exec(xmlText)) !== null) {
    const act = m[1];
    activities.push(act.startsWith('.') ? `${packageName}${act}` : act);
  }

  return {
    xml: xmlText,
    packageName,
    versionCode,
    versionName,
    minSdkVersion,
    targetSdkVersion,
    appName,
    permissions: Array.from(new Set(permissions)),
    activities: Array.from(new Set(activities)),
    mainActivity: activities[0] || `${packageName}.MainActivity`,
    usesCleartextTraffic,
    stringPool,
  };
}

// Re-encode a UTF-8 or UTF-16 string pool chunk cleanly and adjust all offsets
export function patchAxmlStringPool(
  axmlBuf: Buffer,
  replacements: Record<string, string>
): Buffer {
  if (!isBinaryAxml(axmlBuf)) return axmlBuf;

  const totalSize = Math.min(axmlBuf.readUInt32LE(4), axmlBuf.length);
  const firstChunkOffset = axmlBuf.readUInt16LE(2);
  if (firstChunkOffset + 8 > totalSize) return axmlBuf;

  const chunkType = axmlBuf.readUInt16LE(firstChunkOffset);
  if (chunkType !== RES_STRING_POOL_TYPE) return axmlBuf;

  const headerSize = axmlBuf.readUInt16LE(firstChunkOffset + 2);
  const oldChunkSize = axmlBuf.readUInt32LE(firstChunkOffset + 4);
  const stringCount = axmlBuf.readUInt32LE(firstChunkOffset + 8);
  const styleCount = axmlBuf.readUInt32LE(firstChunkOffset + 12);
  const flags = axmlBuf.readUInt32LE(firstChunkOffset + 16);
  const oldStringsStart = axmlBuf.readUInt32LE(firstChunkOffset + 20);
  const oldStylesStart = axmlBuf.readUInt32LE(firstChunkOffset + 24);
  const isUtf8 = (flags & UTF8_FLAG) !== 0;

  const pool = decodeStringPool(axmlBuf, firstChunkOffset);
  const updatedStrings = pool.strings.map((s) =>
    Object.prototype.hasOwnProperty.call(replacements, s) ? replacements[s] : s
  );

  // Encode strings in the same format (UTF-8 or UTF-16LE)
  const encodedEntries: Buffer[] = [];
  const newOffsets: number[] = [];
  let cursor = 0;

  for (const str of updatedStrings) {
    newOffsets.push(cursor);
    if (isUtf8) {
      const utf16Len = str.length;
      const strBytes = Buffer.from(str, 'utf8');
      const lenBytes: number[] = [];
      if (utf16Len >= 0x80) {
        lenBytes.push(((utf16Len >> 8) & 0x7f) | 0x80, utf16Len & 0xff);
      } else {
        lenBytes.push(utf16Len);
      }
      if (strBytes.length >= 0x80) {
        lenBytes.push(((strBytes.length >> 8) & 0x7f) | 0x80, strBytes.length & 0xff);
      } else {
        lenBytes.push(strBytes.length);
      }
      const entry = Buffer.concat([Buffer.from(lenBytes), strBytes, Buffer.from([0])]);
      encodedEntries.push(entry);
      cursor += entry.length;
    } else {
      const charLen = str.length;
      const lenBuf =
        charLen >= 0x8000
          ? Buffer.from([
              (charLen >> 16) & 0xff,
              ((charLen >> 24) & 0x7f) | 0x80,
              charLen & 0xff,
              (charLen >> 8) & 0xff,
            ])
          : Buffer.from([charLen & 0xff, (charLen >> 8) & 0xff]);
      const strBytes = Buffer.from(str, 'utf16le');
      const entry = Buffer.concat([lenBuf, strBytes, Buffer.from([0, 0])]);
      encodedEntries.push(entry);
      cursor += entry.length;
    }
  }

  const rawStringData = Buffer.concat(encodedEntries);
  const padLen = (4 - (rawStringData.length % 4)) % 4;
  const paddedStringData = Buffer.concat([rawStringData, Buffer.alloc(padLen)]);

  // Preserve existing style bytes if present
  const oldStylesBuf =
    styleCount > 0 && oldStylesStart > 0
      ? axmlBuf.subarray(
          firstChunkOffset + oldStylesStart,
          firstChunkOffset + oldChunkSize
        )
      : Buffer.alloc(0);

  const offsetsTableSize = stringCount * 4 + styleCount * 4;
  const newStringsStart = headerSize + offsetsTableSize;
  const newStylesStart = styleCount > 0 ? newStringsStart + paddedStringData.length : 0;
  const newChunkSize =
    newStringsStart + paddedStringData.length + oldStylesBuf.length;

  const newPoolHeader = Buffer.alloc(headerSize);
  axmlBuf.copy(newPoolHeader, 0, firstChunkOffset, firstChunkOffset + headerSize);
  newPoolHeader.writeUInt32LE(newChunkSize, 4);
  newPoolHeader.writeUInt32LE(newStringsStart, 20);
  newPoolHeader.writeUInt32LE(newStylesStart, 24);

  const offsetsBuf = Buffer.alloc(offsetsTableSize);
  for (let i = 0; i < newOffsets.length; i++) {
    offsetsBuf.writeUInt32LE(newOffsets[i], i * 4);
  }
  if (styleCount > 0 && oldStringsStart > 0) {
    const styleOffsetSrcStart = firstChunkOffset + headerSize + stringCount * 4;
    axmlBuf.copy(
      offsetsBuf,
      stringCount * 4,
      styleOffsetSrcStart,
      styleOffsetSrcStart + styleCount * 4
    );
  }

  const restAfterPool = axmlBuf.subarray(firstChunkOffset + oldChunkSize, totalSize);
  const prefix = axmlBuf.subarray(0, firstChunkOffset);
  const result = Buffer.concat([
    prefix,
    newPoolHeader,
    offsetsBuf,
    paddedStringData,
    oldStylesBuf,
    restAfterPool,
  ]);
  result.writeUInt32LE(result.length, 4);
  return result;
}

// Encode a valid binary AndroidManifest.xml (AXML) for generated/sample WebView APKs
export function encodeSimpleAxmlManifest(options: {
  packageName: string;
  versionCode: number;
  versionName: string;
  appName: string;
  mainActivityName: string;
  minSdkVersion?: number;
  targetSdkVersion?: number;
  permissions?: string[];
  usesCleartextTraffic?: boolean;
}): Buffer {
  const ANDROID_NS = 'http://schemas.android.com/apk/res/android';
  const permissions = options.permissions ?? ['android.permission.INTERNET'];
  const minSdk = options.minSdkVersion ?? 21;
  const targetSdk = options.targetSdkVersion ?? 34;

  // Ordered strings with resource-mapped attribute names first so resource map aligns
  const attrResourcePairs: Array<[string, number]> = [
    ['versionCode', 0x0101021b],
    ['versionName', 0x0101021c],
    ['minSdkVersion', 0x0101020c],
    ['targetSdkVersion', 0x01010270],
    ['name', 0x01010003],
    ['label', 0x01010001],
    ['usesCleartextTraffic', 0x010104ec],
    ['exported', 0x01010010],
    ['configChanges', 0x0101001f],
  ];

  const stringTable: string[] = [];
  const strIndexMap = new Map<string, number>();
  const intern = (s: string): number => {
    const existing = strIndexMap.get(s);
    if (existing !== undefined) return existing;
    const idx = stringTable.length;
    stringTable.push(s);
    strIndexMap.set(s, idx);
    return idx;
  };

  for (const [name] of attrResourcePairs) {
    intern(name);
  }

  // Intern structural strings
  intern('android');
  intern(ANDROID_NS);
  intern('manifest');
  intern('package');
  intern(options.packageName);
  intern(options.versionName);
  intern('uses-sdk');
  intern('uses-permission');
  for (const p of permissions) intern(p);
  intern('application');
  intern(options.appName);
  intern('activity');
  intern(options.mainActivityName);
  intern('intent-filter');
  intern('action');
  intern('android.intent.action.MAIN');
  intern('category');
  intern('android.intent.category.LAUNCHER');

  // Helper to build chunks
  const xmlChunks: Buffer[] = [];

  const nsPrefixIdx = intern('android');
  const nsUriIdx = intern(ANDROID_NS);

  // Start Namespace
  {
    const b = Buffer.alloc(24);
    b.writeUInt16LE(RES_XML_START_NAMESPACE_TYPE, 0);
    b.writeUInt16LE(16, 2);
    b.writeUInt32LE(24, 4);
    b.writeUInt32LE(1, 8);
    b.writeInt32LE(-1, 12);
    b.writeInt32LE(nsPrefixIdx, 16);
    b.writeInt32LE(nsUriIdx, 20);
    xmlChunks.push(b);
  }

  interface AttrSpec {
    ns: number;
    name: string;
    type: number;
    data: number;
    rawStrIdx: number;
  }

  let line = 2;
  const pushStartTag = (tagName: string, attrs: AttrSpec[]) => {
    const headerSize = 16;
    const extSize = 20;
    const attrSize = 20;
    const chunkSize = headerSize + extSize + attrs.length * attrSize;
    const b = Buffer.alloc(chunkSize);
    b.writeUInt16LE(RES_XML_START_ELEMENT_TYPE, 0);
    b.writeUInt16LE(headerSize, 2);
    b.writeUInt32LE(chunkSize, 4);
    b.writeUInt32LE(line++, 8);
    b.writeInt32LE(-1, 12);
    b.writeInt32LE(-1, 16);
    b.writeInt32LE(intern(tagName), 20);
    b.writeUInt16LE(extSize, 24);
    b.writeUInt16LE(attrSize, 26);
    b.writeUInt16LE(attrs.length, 28);
    b.writeUInt16LE(0, 30);
    b.writeUInt16LE(0, 32);
    b.writeUInt16LE(0, 34);

    attrs.forEach((attr, idx) => {
      const off = 36 + idx * attrSize;
      b.writeInt32LE(attr.ns, off);
      b.writeInt32LE(intern(attr.name), off + 4);
      b.writeInt32LE(attr.rawStrIdx, off + 8);
      b.writeUInt16LE(8, off + 12);
      b.writeUInt8(0, off + 14);
      b.writeUInt8(attr.type, off + 15);
      b.writeInt32LE(attr.data, off + 16);
    });
    xmlChunks.push(b);
  };

  const pushEndTag = (tagName: string) => {
    const b = Buffer.alloc(24);
    b.writeUInt16LE(RES_XML_END_ELEMENT_TYPE, 0);
    b.writeUInt16LE(16, 2);
    b.writeUInt32LE(24, 4);
    b.writeUInt32LE(line++, 8);
    b.writeInt32LE(-1, 12);
    b.writeInt32LE(-1, 16);
    b.writeInt32LE(intern(tagName), 20);
    xmlChunks.push(b);
  };

  pushStartTag('manifest', [
    {
      ns: -1,
      name: 'package',
      type: TYPE_STRING,
      data: intern(options.packageName),
      rawStrIdx: intern(options.packageName),
    },
    {
      ns: nsUriIdx,
      name: 'versionCode',
      type: TYPE_INT_DEC,
      data: options.versionCode,
      rawStrIdx: -1,
    },
    {
      ns: nsUriIdx,
      name: 'versionName',
      type: TYPE_STRING,
      data: intern(options.versionName),
      rawStrIdx: intern(options.versionName),
    },
  ]);

  pushStartTag('uses-sdk', [
    {
      ns: nsUriIdx,
      name: 'minSdkVersion',
      type: TYPE_INT_DEC,
      data: minSdk,
      rawStrIdx: -1,
    },
    {
      ns: nsUriIdx,
      name: 'targetSdkVersion',
      type: TYPE_INT_DEC,
      data: targetSdk,
      rawStrIdx: -1,
    },
  ]);
  pushEndTag('uses-sdk');

  for (const perm of permissions) {
    pushStartTag('uses-permission', [
      {
        ns: nsUriIdx,
        name: 'name',
        type: TYPE_STRING,
        data: intern(perm),
        rawStrIdx: intern(perm),
      },
    ]);
    pushEndTag('uses-permission');
  }

  pushStartTag('application', [
    {
      ns: nsUriIdx,
      name: 'label',
      type: TYPE_STRING,
      data: intern(options.appName),
      rawStrIdx: intern(options.appName),
    },
    {
      ns: nsUriIdx,
      name: 'usesCleartextTraffic',
      type: TYPE_INT_BOOLEAN,
      data: options.usesCleartextTraffic === false ? 0 : -1,
      rawStrIdx: -1,
    },
  ]);

  pushStartTag('activity', [
    {
      ns: nsUriIdx,
      name: 'name',
      type: TYPE_STRING,
      data: intern(options.mainActivityName),
      rawStrIdx: intern(options.mainActivityName),
    },
    {
      ns: nsUriIdx,
      name: 'exported',
      type: TYPE_INT_BOOLEAN,
      data: -1,
      rawStrIdx: -1,
    },
    {
      ns: nsUriIdx,
      name: 'configChanges',
      type: TYPE_INT_HEX,
      data: 0x0480,
      rawStrIdx: -1,
    },
  ]);

  pushStartTag('intent-filter', []);
  pushStartTag('action', [
    {
      ns: nsUriIdx,
      name: 'name',
      type: TYPE_STRING,
      data: intern('android.intent.action.MAIN'),
      rawStrIdx: intern('android.intent.action.MAIN'),
    },
  ]);
  pushEndTag('action');
  pushStartTag('category', [
    {
      ns: nsUriIdx,
      name: 'name',
      type: TYPE_STRING,
      data: intern('android.intent.category.LAUNCHER'),
      rawStrIdx: intern('android.intent.category.LAUNCHER'),
    },
  ]);
  pushEndTag('category');
  pushEndTag('intent-filter');
  pushEndTag('activity');
  pushEndTag('application');
  pushEndTag('manifest');

  // End Namespace
  {
    const b = Buffer.alloc(24);
    b.writeUInt16LE(RES_XML_END_NAMESPACE_TYPE, 0);
    b.writeUInt16LE(16, 2);
    b.writeUInt32LE(24, 4);
    b.writeUInt32LE(line++, 8);
    b.writeInt32LE(-1, 12);
    b.writeInt32LE(nsPrefixIdx, 16);
    b.writeInt32LE(nsUriIdx, 20);
    xmlChunks.push(b);
  }

  // Build String Pool Chunk (UTF-8)
  const stringOffsets: number[] = [];
  const encodedStrings: Buffer[] = [];
  let cursor = 0;
  for (const s of stringTable) {
    stringOffsets.push(cursor);
    const bytes = Buffer.from(s, 'utf8');
    const lenPrefix = Buffer.from([s.length & 0x7f, bytes.length & 0x7f]);
    const entry = Buffer.concat([lenPrefix, bytes, Buffer.from([0])]);
    encodedStrings.push(entry);
    cursor += entry.length;
  }
  const rawStrBuf = Buffer.concat(encodedStrings);
  const strPad = (4 - (rawStrBuf.length % 4)) % 4;
  const paddedStrBuf = Buffer.concat([rawStrBuf, Buffer.alloc(strPad)]);

  const poolHeaderSize = 28;
  const offsetsSize = stringTable.length * 4;
  const stringsStart = poolHeaderSize + offsetsSize;
  const poolChunkSize = stringsStart + paddedStrBuf.length;

  const poolBuf = Buffer.alloc(poolChunkSize);
  poolBuf.writeUInt16LE(RES_STRING_POOL_TYPE, 0);
  poolBuf.writeUInt16LE(poolHeaderSize, 2);
  poolBuf.writeUInt32LE(poolChunkSize, 4);
  poolBuf.writeUInt32LE(stringTable.length, 8);
  poolBuf.writeUInt32LE(0, 12);
  poolBuf.writeUInt32LE(UTF8_FLAG, 16);
  poolBuf.writeUInt32LE(stringsStart, 20);
  poolBuf.writeUInt32LE(0, 24);
  stringOffsets.forEach((off, idx) => {
    poolBuf.writeUInt32LE(off, poolHeaderSize + idx * 4);
  });
  paddedStrBuf.copy(poolBuf, stringsStart);

  // Build Resource Map Chunk
  const resMapSize = 8 + attrResourcePairs.length * 4;
  const resMapBuf = Buffer.alloc(resMapSize);
  resMapBuf.writeUInt16LE(RES_XML_RESOURCE_MAP_TYPE, 0);
  resMapBuf.writeUInt16LE(8, 2);
  resMapBuf.writeUInt32LE(resMapSize, 4);
  attrResourcePairs.forEach(([, resId], idx) => {
    resMapBuf.writeUInt32LE(resId >>> 0, 8 + idx * 4);
  });

  const body = Buffer.concat([poolBuf, resMapBuf, ...xmlChunks]);
  const rootHeader = Buffer.alloc(8);
  rootHeader.writeUInt16LE(RES_XML_TYPE, 0);
  rootHeader.writeUInt16LE(8, 2);
  rootHeader.writeUInt32LE(8 + body.length, 4);

  return Buffer.concat([rootHeader, body]);
}
