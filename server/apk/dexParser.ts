import crypto from 'node:crypto';

export interface DexFieldInfo {
  name: string;
  type: string;
  accessFlags: string[];
  isStatic: boolean;
}

export interface DexMethodInfo {
  name: string;
  returnType: string;
  parameters: string[];
  accessFlags: string[];
  bytecodeBytes: number;
  isDirect: boolean;
}

export interface DexClassInfo {
  descriptor: string;
  javaName: string;
  packageName: string;
  simpleName: string;
  superclass: string;
  sourceFile: string;
  accessFlags: string[];
  fields: DexFieldInfo[];
  methods: DexMethodInfo[];
}

export interface ParsedDex {
  version: string;
  fileSize: number;
  checksum: number;
  sha1Hex: string;
  stringCount: number;
  typeCount: number;
  methodCount: number;
  classCount: number;
  classes: DexClassInfo[];
  sampleStrings: string[];
}

function readUleb128(buf: Buffer, offset: number): { value: number; next: number } {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buf.length) {
    const byte = buf[pos++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return { value: result >>> 0, next: pos };
}

function decodeAccessFlags(flags: number, isClass = false): string[] {
  const res: string[] = [];
  if (flags & 0x0001) res.push('public');
  if (flags & 0x0002) res.push('private');
  if (flags & 0x0004) res.push('protected');
  if (flags & 0x0008) res.push('static');
  if (flags & 0x0010) res.push('final');
  if (flags & 0x0020 && !isClass) res.push('synchronized');
  if (flags & 0x0200) res.push('interface');
  if (flags & 0x0400) res.push('abstract');
  return res;
}

export function descriptorToJavaType(desc: string): string {
  if (!desc) return 'void';
  let arrays = 0;
  let i = 0;
  while (desc[i] === '[') {
    arrays++;
    i++;
  }
  const core = desc.slice(i);
  let base = core;
  switch (core) {
    case 'V':
      base = 'void';
      break;
    case 'Z':
      base = 'boolean';
      break;
    case 'B':
      base = 'byte';
      break;
    case 'S':
      base = 'short';
      break;
    case 'C':
      base = 'char';
      break;
    case 'I':
      base = 'int';
      break;
    case 'J':
      base = 'long';
      break;
    case 'F':
      base = 'float';
      break;
    case 'D':
      base = 'double';
      break;
    default:
      if (core.startsWith('L') && core.endsWith(';')) {
        base = core.slice(1, -1).replace(/\//g, '.');
      }
      break;
  }
  return base + '[]'.repeat(arrays);
}

export function isValidDex(buf: Buffer): boolean {
  if (buf.length < 112) return false;
  return (
    buf[0] === 0x64 &&
    buf[1] === 0x65 &&
    buf[2] === 0x78 &&
    buf[3] === 0x0a &&
    buf[7] === 0x00
  );
}

export function parseDex(buf: Buffer, maxClasses = 350): ParsedDex {
  if (!isValidDex(buf)) {
    throw new Error('Invalid Dalvik DEX magic header');
  }

  const version = buf.toString('ascii', 4, 7);
  const checksum = buf.readUInt32LE(8);
  const sha1Hex = buf.subarray(12, 32).toString('hex');
  const fileSize = buf.readUInt32LE(32);

  const stringIdsSize = buf.readUInt32LE(56);
  const stringIdsOff = buf.readUInt32LE(60);
  const typeIdsSize = buf.readUInt32LE(64);
  const typeIdsOff = buf.readUInt32LE(68);
  const protoIdsSize = buf.readUInt32LE(72);
  const protoIdsOff = buf.readUInt32LE(76);
  const fieldIdsSize = buf.readUInt32LE(80);
  const fieldIdsOff = buf.readUInt32LE(84);
  const methodIdsSize = buf.readUInt32LE(88);
  const methodIdsOff = buf.readUInt32LE(92);
  const classDefsSize = buf.readUInt32LE(96);
  const classDefsOff = buf.readUInt32LE(100);

  // Read string table lazily/cached
  const stringCache = new Map<number, string>();
  const getString = (idx: number): string => {
    if (idx < 0 || idx >= stringIdsSize) return '';
    const cached = stringCache.get(idx);
    if (cached !== undefined) return cached;
    const strDataOff = buf.readUInt32LE(stringIdsOff + idx * 4);
    if (strDataOff >= buf.length) return '';
    const uleb = readUleb128(buf, strDataOff);
    let end = uleb.next;
    while (end < buf.length && buf[end] !== 0) end++;
    const str = buf.toString('utf8', uleb.next, end);
    stringCache.set(idx, str);
    return str;
  };

  const getTypeDescriptor = (typeIdx: number): string => {
    if (typeIdx < 0 || typeIdx >= typeIdsSize) return '';
    const strIdx = buf.readUInt32LE(typeIdsOff + typeIdx * 4);
    return getString(strIdx);
  };

  const getProtoSignature = (protoIdx: number): { returnType: string; params: string[] } => {
    if (protoIdx < 0 || protoIdx >= protoIdsSize) {
      return { returnType: 'void', params: [] };
    }
    const base = protoIdsOff + protoIdx * 12;
    const returnTypeIdx = buf.readUInt32LE(base + 4);
    const paramsOff = buf.readUInt32LE(base + 8);
    const returnType = descriptorToJavaType(getTypeDescriptor(returnTypeIdx));
    const params: string[] = [];
    if (paramsOff > 0 && paramsOff + 4 <= buf.length) {
      const size = buf.readUInt32LE(paramsOff);
      const count = Math.min(size, 32);
      for (let i = 0; i < count; i++) {
        const pTypeIdx = buf.readUInt16LE(paramsOff + 4 + i * 2);
        params.push(descriptorToJavaType(getTypeDescriptor(pTypeIdx)));
      }
    }
    return { returnType, params };
  };

  const getFieldSignature = (fieldIdx: number): { name: string; type: string } => {
    if (fieldIdx < 0 || fieldIdx >= fieldIdsSize) return { name: 'unknown', type: 'Object' };
    const base = fieldIdsOff + fieldIdx * 8;
    const typeIdx = buf.readUInt16LE(base + 2);
    const nameIdx = buf.readUInt32LE(base + 4);
    return {
      name: getString(nameIdx),
      type: descriptorToJavaType(getTypeDescriptor(typeIdx)),
    };
  };

  const getMethodSignature = (
    methodIdx: number
  ): { name: string; returnType: string; parameters: string[] } => {
    if (methodIdx < 0 || methodIdx >= methodIdsSize) {
      return { name: 'unknown', returnType: 'void', parameters: [] };
    }
    const base = methodIdsOff + methodIdx * 8;
    const protoIdx = buf.readUInt16LE(base + 2);
    const nameIdx = buf.readUInt32LE(base + 4);
    const proto = getProtoSignature(protoIdx);
    return {
      name: getString(nameIdx),
      returnType: proto.returnType,
      parameters: proto.params,
    };
  };

  const classes: DexClassInfo[] = [];
  const limit = Math.min(classDefsSize, maxClasses);

  for (let i = 0; i < limit; i++) {
    const base = classDefsOff + i * 32;
    if (base + 32 > buf.length) break;

    const classIdx = buf.readUInt32LE(base);
    const accessFlags = buf.readUInt32LE(base + 4);
    const superclassIdx = buf.readUInt32LE(base + 8);
    const sourceFileIdx = buf.readInt32LE(base + 16);
    const classDataOff = buf.readUInt32LE(base + 24);

    const descriptor = getTypeDescriptor(classIdx);
    const javaName = descriptorToJavaType(descriptor);
    const lastDot = javaName.lastIndexOf('.');
    const packageName = lastDot > 0 ? javaName.slice(0, lastDot) : '';
    const simpleName = lastDot > 0 ? javaName.slice(lastDot + 1) : javaName;
    const superclass =
      superclassIdx === 0xffffffff
        ? 'java.lang.Object'
        : descriptorToJavaType(getTypeDescriptor(superclassIdx));
    const sourceFile = sourceFileIdx >= 0 ? getString(sourceFileIdx) : `${simpleName}.java`;

    const fields: DexFieldInfo[] = [];
    const methods: DexMethodInfo[] = [];

    if (classDataOff > 0 && classDataOff < buf.length) {
      let pos = classDataOff;
      const staticFieldsSize = readUleb128(buf, pos);
      pos = staticFieldsSize.next;
      const instanceFieldsSize = readUleb128(buf, pos);
      pos = instanceFieldsSize.next;
      const directMethodsSize = readUleb128(buf, pos);
      pos = directMethodsSize.next;
      const virtualMethodsSize = readUleb128(buf, pos);
      pos = virtualMethodsSize.next;

      let prevFieldIdx = 0;
      for (let f = 0; f < Math.min(staticFieldsSize.value, 100); f++) {
        const diff = readUleb128(buf, pos);
        pos = diff.next;
        const fFlags = readUleb128(buf, pos);
        pos = fFlags.next;
        prevFieldIdx += diff.value;
        const sig = getFieldSignature(prevFieldIdx);
        fields.push({
          name: sig.name,
          type: sig.type,
          accessFlags: decodeAccessFlags(fFlags.value),
          isStatic: true,
        });
      }

      prevFieldIdx = 0;
      for (let f = 0; f < Math.min(instanceFieldsSize.value, 100); f++) {
        const diff = readUleb128(buf, pos);
        pos = diff.next;
        const fFlags = readUleb128(buf, pos);
        pos = fFlags.next;
        prevFieldIdx += diff.value;
        const sig = getFieldSignature(prevFieldIdx);
        fields.push({
          name: sig.name,
          type: sig.type,
          accessFlags: decodeAccessFlags(fFlags.value),
          isStatic: false,
        });
      }

      let prevMethodIdx = 0;
      for (let m = 0; m < Math.min(directMethodsSize.value, 120); m++) {
        const diff = readUleb128(buf, pos);
        pos = diff.next;
        const mFlags = readUleb128(buf, pos);
        pos = mFlags.next;
        const codeOff = readUleb128(buf, pos);
        pos = codeOff.next;
        prevMethodIdx += diff.value;
        const sig = getMethodSignature(prevMethodIdx);
        let bytecodeBytes = 0;
        if (codeOff.value > 0 && codeOff.value + 16 <= buf.length) {
          bytecodeBytes = buf.readUInt32LE(codeOff.value + 12) * 2;
        }
        methods.push({
          name: sig.name,
          returnType: sig.returnType,
          parameters: sig.parameters,
          accessFlags: decodeAccessFlags(mFlags.value),
          bytecodeBytes,
          isDirect: true,
        });
      }

      prevMethodIdx = 0;
      for (let m = 0; m < Math.min(virtualMethodsSize.value, 120); m++) {
        const diff = readUleb128(buf, pos);
        pos = diff.next;
        const mFlags = readUleb128(buf, pos);
        pos = mFlags.next;
        const codeOff = readUleb128(buf, pos);
        pos = codeOff.next;
        prevMethodIdx += diff.value;
        const sig = getMethodSignature(prevMethodIdx);
        let bytecodeBytes = 0;
        if (codeOff.value > 0 && codeOff.value + 16 <= buf.length) {
          bytecodeBytes = buf.readUInt32LE(codeOff.value + 12) * 2;
        }
        methods.push({
          name: sig.name,
          returnType: sig.returnType,
          parameters: sig.parameters,
          accessFlags: decodeAccessFlags(mFlags.value),
          bytecodeBytes,
          isDirect: false,
        });
      }
    }

    classes.push({
      descriptor,
      javaName,
      packageName,
      simpleName,
      superclass,
      sourceFile,
      accessFlags: decodeAccessFlags(accessFlags, true),
      fields,
      methods,
    });
  }

  const sampleStrings: string[] = [];
  for (let i = 0; i < Math.min(stringIdsSize, 80); i++) {
    const s = getString(i);
    if (s && s.length <= 160) sampleStrings.push(s);
  }

  return {
    version,
    fileSize,
    checksum,
    sha1Hex,
    stringCount: stringIdsSize,
    typeCount: typeIdsSize,
    methodCount: methodIdsSize,
    classCount: classDefsSize,
    classes,
    sampleStrings,
  };
}

export function renderDecompiledJavaClass(cls: DexClassInfo): string {
  const lines: string[] = [];
  if (cls.packageName) {
    lines.push(`package ${cls.packageName};`);
    lines.push('');
  }
  lines.push(`// Decompiled DEX outline from ${cls.sourceFile}`);
  const mods = cls.accessFlags.filter((f) => f !== 'interface').join(' ');
  const kind = cls.accessFlags.includes('interface') ? 'interface' : 'class';
  const ext =
    cls.superclass && cls.superclass !== 'java.lang.Object'
      ? ` extends ${cls.superclass}`
      : '';
  lines.push(`${mods ? mods + ' ' : ''}${kind} ${cls.simpleName}${ext} {`);

  if (cls.fields.length > 0) {
    lines.push('');
    for (const f of cls.fields) {
      const fMods = f.accessFlags.join(' ');
      lines.push(`    ${fMods ? fMods + ' ' : ''}${f.type} ${f.name};`);
    }
  }

  for (const m of cls.methods) {
    lines.push('');
    const mMods = m.accessFlags.join(' ');
    const params = m.parameters.map((p, idx) => `${p} arg${idx}`).join(', ');
    if (m.name === '<init>' || m.name === '<clinit>') {
      const ctorName = m.name === '<clinit>' ? 'static' : cls.simpleName;
      lines.push(
        `    ${m.name === '<clinit>' ? 'static' : `${mMods ? mMods + ' ' : ''}${ctorName}(${params})`} {`
      );
    } else {
      lines.push(
        `    ${mMods ? mMods + ' ' : ''}${m.returnType} ${m.name}(${params}) {`
      );
    }
    lines.push(`        // Dalvik bytecode body (${m.bytecodeBytes} bytes)`);
    if (m.returnType !== 'void' && m.name !== '<init>' && m.name !== '<clinit>') {
      if (m.returnType === 'boolean') lines.push('        return false;');
      else if (['int', 'long', 'short', 'byte', 'float', 'double', 'char'].includes(m.returnType))
        lines.push('        return 0;');
      else lines.push('        return null;');
    }
    lines.push('    }');
  }

  lines.push('}');
  return lines.join('\n');
}

function adler32(buf: Buffer): number {
  let a = 1;
  let b = 0;
  const MOD = 65521;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}

function writeUleb128(value: number): Buffer {
  const bytes: number[] = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);
  return Buffer.from(bytes);
}

// Builds a spec-compliant minimal Dalvik classes.dex with MainActivity & WebAppBridge metadata
export function buildSampleWebViewDex(packageName: string): Buffer {
  const pkgPath = packageName.replace(/\./g, '/');
  const mainClassDesc = `L${pkgPath}/MainActivity;`;
  const bridgeClassDesc = `L${pkgPath}/WebAppBridge;`;

  // DEX requires string table sorted lexicographically by UTF-8 bytes
  const rawStrings = [
    '<init>',
    'Landroid/app/Activity;',
    'Landroid/os/Bundle;',
    'Landroid/webkit/WebView;',
    bridgeClassDesc,
    mainClassDesc,
    'Ljava/lang/Object;',
    'Ljava/lang/String;',
    'MainActivity.java',
    'V',
    'VL',
    'WebAppBridge.java',
    'file:///android_asset/www/index.html',
    'getDeviceInfo',
    'onCreate',
    'showToast',
  ];
  const strings = Array.from(new Set(rawStrings)).sort();
  const strIdx = (s: string) => strings.indexOf(s);

  // Types sorted by descriptor string index
  const typeStrings = [
    'Landroid/app/Activity;',
    'Landroid/os/Bundle;',
    'Landroid/webkit/WebView;',
    bridgeClassDesc,
    mainClassDesc,
    'Ljava/lang/Object;',
    'Ljava/lang/String;',
    'V',
  ].sort((a, b) => strIdx(a) - strIdx(b));
  const typeIdx = (s: string) => typeStrings.indexOf(s);

  // Protos: ()V, (Landroid/os/Bundle;)V, ()Ljava/lang/String;
  const protos = [
    { shorty: strIdx('V'), ret: typeIdx('V'), params: [] as number[] },
    {
      shorty: strIdx('VL'),
      ret: typeIdx('V'),
      params: [typeIdx('Landroid/os/Bundle;')],
    },
  ];

  // Methods sorted by (class_idx, name_idx, proto_idx)
  const methods = [
    {
      classIdx: typeIdx(mainClassDesc),
      protoIdx: 0,
      nameIdx: strIdx('<init>'),
    },
    {
      classIdx: typeIdx(mainClassDesc),
      protoIdx: 1,
      nameIdx: strIdx('onCreate'),
    },
    {
      classIdx: typeIdx(bridgeClassDesc),
      protoIdx: 0,
      nameIdx: strIdx('<init>'),
    },
  ].sort(
    (a, b) =>
      a.classIdx - b.classIdx || a.nameIdx - b.nameIdx || a.protoIdx - b.protoIdx
  );

  // Layout offsets
  const headerSize = 112;
  const stringIdsOff = headerSize;
  const stringIdsSize = strings.length;
  const typeIdsOff = stringIdsOff + stringIdsSize * 4;
  const typeIdsSize = typeStrings.length;
  const protoIdsOff = typeIdsOff + typeIdsSize * 4;
  const protoIdsSize = protos.length;
  const methodIdsOff = protoIdsOff + protoIdsSize * 12;
  const methodIdsSize = methods.length;
  const classDefsOff = methodIdsOff + methodIdsSize * 8;
  const classDefsSize = 2;

  let dataCursor = classDefsOff + classDefsSize * 32;
  const align4 = () => {
    const rem = dataCursor % 4;
    if (rem !== 0) dataCursor += 4 - rem;
  };

  // Proto type_list for proto[1]
  align4();
  const proto1ParamsOff = dataCursor;
  const proto1ParamsBuf = Buffer.alloc(8);
  proto1ParamsBuf.writeUInt32LE(1, 0);
  proto1ParamsBuf.writeUInt16LE(typeIdx('Landroid/os/Bundle;'), 4);
  dataCursor += 8;

  // String data section
  const stringDataOffsets: number[] = [];
  const stringDataBufs: Buffer[] = [];
  for (const s of strings) {
    stringDataOffsets.push(dataCursor);
    const bytes = Buffer.from(s, 'utf8');
    const entry = Buffer.concat([writeUleb128(s.length), bytes, Buffer.from([0])]);
    stringDataBufs.push(entry);
    dataCursor += entry.length;
  }

  // Class data items
  const buildClassData = (directMethodIndices: number[]) => {
    const parts: Buffer[] = [
      writeUleb128(0), // static fields
      writeUleb128(0), // instance fields
      writeUleb128(directMethodIndices.length),
      writeUleb128(0), // virtual methods
    ];
    let prev = 0;
    for (const mIdx of directMethodIndices) {
      parts.push(writeUleb128(mIdx - prev));
      parts.push(writeUleb128(0x0001 | 0x10000)); // public constructor/method
      parts.push(writeUleb128(0)); // code_off = 0 (abstract/stub)
      prev = mIdx;
    }
    return Buffer.concat(parts);
  };

  const mainMethodIndices = methods
    .map((m, idx) => (m.classIdx === typeIdx(mainClassDesc) ? idx : -1))
    .filter((i) => i >= 0);
  const bridgeMethodIndices = methods
    .map((m, idx) => (m.classIdx === typeIdx(bridgeClassDesc) ? idx : -1))
    .filter((i) => i >= 0);

  const mainClassDataOff = dataCursor;
  const mainClassDataBuf = buildClassData(mainMethodIndices);
  dataCursor += mainClassDataBuf.length;

  const bridgeClassDataOff = dataCursor;
  const bridgeClassDataBuf = buildClassData(bridgeMethodIndices);
  dataCursor += bridgeClassDataBuf.length;

  align4();
  const fileSize = dataCursor;
  const dex = Buffer.alloc(fileSize);

  // Magic
  Buffer.from('dex\n035\0', 'ascii').copy(dex, 0);
  dex.writeUInt32LE(fileSize, 32);
  dex.writeUInt32LE(headerSize, 36);
  dex.writeUInt32LE(0x12345678, 40);
  dex.writeUInt32LE(stringIdsSize, 56);
  dex.writeUInt32LE(stringIdsOff, 60);
  dex.writeUInt32LE(typeIdsSize, 64);
  dex.writeUInt32LE(typeIdsOff, 68);
  dex.writeUInt32LE(protoIdsSize, 72);
  dex.writeUInt32LE(protoIdsOff, 76);
  dex.writeUInt32LE(0, 80); // field_ids_size
  dex.writeUInt32LE(0, 84);
  dex.writeUInt32LE(methodIdsSize, 88);
  dex.writeUInt32LE(methodIdsOff, 92);
  dex.writeUInt32LE(classDefsSize, 96);
  dex.writeUInt32LE(classDefsOff, 100);
  dex.writeUInt32LE(fileSize - proto1ParamsOff, 104); // data_size
  dex.writeUInt32LE(proto1ParamsOff, 108); // data_off

  stringDataOffsets.forEach((off, i) => dex.writeUInt32LE(off, stringIdsOff + i * 4));
  typeStrings.forEach((t, i) => dex.writeUInt32LE(strIdx(t), typeIdsOff + i * 4));

  protos.forEach((p, i) => {
    const off = protoIdsOff + i * 12;
    dex.writeUInt32LE(p.shorty, off);
    dex.writeUInt32LE(p.ret, off + 4);
    dex.writeUInt32LE(p.params.length > 0 ? proto1ParamsOff : 0, off + 8);
  });

  methods.forEach((m, i) => {
    const off = methodIdsOff + i * 8;
    dex.writeUInt16LE(m.classIdx, off);
    dex.writeUInt16LE(m.protoIdx, off + 2);
    dex.writeUInt32LE(m.nameIdx, off + 4);
  });

  // Class defs
  const writeClassDef = (
    idx: number,
    classIdx: number,
    superIdx: number,
    sourceIdx: number,
    dataOff: number
  ) => {
    const off = classDefsOff + idx * 32;
    dex.writeUInt32LE(classIdx, off);
    dex.writeUInt32LE(0x0001, off + 4);
    dex.writeUInt32LE(superIdx, off + 8);
    dex.writeUInt32LE(0, off + 12);
    dex.writeInt32LE(sourceIdx, off + 16);
    dex.writeUInt32LE(0, off + 20);
    dex.writeUInt32LE(dataOff, off + 24);
    dex.writeUInt32LE(0, off + 28);
  };

  writeClassDef(
    0,
    typeIdx(mainClassDesc),
    typeIdx('Landroid/app/Activity;'),
    strIdx('MainActivity.java'),
    mainClassDataOff
  );
  writeClassDef(
    1,
    typeIdx(bridgeClassDesc),
    typeIdx('Ljava/lang/Object;'),
    strIdx('WebAppBridge.java'),
    bridgeClassDataOff
  );

  proto1ParamsBuf.copy(dex, proto1ParamsOff);
  stringDataBufs.forEach((b, i) => b.copy(dex, stringDataOffsets[i]));
  mainClassDataBuf.copy(dex, mainClassDataOff);
  bridgeClassDataBuf.copy(dex, bridgeClassDataOff);

  // Compute SHA-1 signature (bytes 32..end) and Adler-32 checksum (bytes 12..end)
  const sha1 = crypto.createHash('sha1').update(dex.subarray(32)).digest();
  sha1.copy(dex, 12);
  dex.writeUInt32LE(adler32(dex.subarray(12)), 8);

  return dex;
}
