import crypto from 'node:crypto';
import forge from 'node-forge';
import JSZip from 'jszip';

export interface SigningInfo {
  signerSubject: string;
  fingerprintSha256: string;
  entriesSigned: number;
  algorithm: string;
}

function sha256Base64(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('base64');
}

function wrapManifestLine(line: string): string {
  // JAR manifest specification: lines <= 72 bytes, continuations start with single space
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 70) return line;
  const parts: string[] = [];
  let i = 0;
  let first = true;
  while (i < line.length) {
    const chunkLen = first ? 68 : 67;
    const chunk = line.slice(i, i + chunkLen);
    parts.push(first ? chunk : ` ${chunk}`);
    i += chunkLen;
    first = false;
  }
  return parts.join('\r\n');
}

export interface EntryDigest {
  name: string;
  sha256: string;
}

export function generateMetaInfFromDigests(
  entries: EntryDigest[],
  appLabel: string
): {
  manifestBuf: Buffer;
  sfBuf: Buffer;
  certRsaBuf: Buffer;
  signingInfo: SigningInfo;
} {
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  const manifestSections: string[] = [];
  const sfSections: string[] = [];

  for (const item of sorted) {
    const mfBlock =
      `${wrapManifestLine(`Name: ${item.name}`)}\r\n` +
      `${wrapManifestLine(`SHA-256-Digest: ${item.sha256}`)}\r\n`;
    manifestSections.push(mfBlock);

    const sfEntryDigest = sha256Base64(Buffer.from(mfBlock + '\r\n', 'utf8'));
    const sfBlock =
      `${wrapManifestLine(`Name: ${item.name}`)}\r\n` +
      `${wrapManifestLine(`SHA-256-Digest: ${sfEntryDigest}`)}\r\n`;
    sfSections.push(sfBlock);
  }

  const manifestHeader =
    'Manifest-Version: 1.0\r\n' +
    'Created-By: APKBridge Studio Signer\r\n' +
    '\r\n';
  const manifestText = manifestHeader + manifestSections.join('\r\n') + '\r\n';
  const manifestBuf = Buffer.from(manifestText, 'utf8');
  const manifestDigest = sha256Base64(manifestBuf);

  const sfHeader =
    'Signature-Version: 1.0\r\n' +
    `SHA-256-Digest-Manifest: ${manifestDigest}\r\n` +
    'Created-By: APKBridge Studio Signer\r\n' +
    '\r\n';
  const sfText = sfHeader + sfSections.join('\r\n') + '\r\n';
  const sfBuf = Buffer.from(sfText, 'utf8');

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = crypto.randomBytes(8).toString('hex');
  const now = new Date();
  cert.validity.notBefore = now;
  cert.validity.notAfter = new Date(now.getTime() + 3650 * 24 * 60 * 60 * 1000);

  const safeCn =
    (appLabel || 'APKBridgeApp').replace(/[^a-zA-Z0-9 ._-]/g, '').slice(0, 48) ||
    'APKBridgeApp';
  const attrs = [
    { name: 'commonName', value: safeCn },
    { name: 'organizationName', value: 'APKBridge Studio' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(sfBuf.toString('binary'), 'raw');
  p7.addCertificate(cert);
  p7.addSigner({
    key: keys.privateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign({ detached: true });

  const asn1Bytes = forge.asn1.toDer(p7.toAsn1()).getBytes();
  const certRsaBuf = Buffer.from(asn1Bytes, 'binary');

  const certDerBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const fingerprintSha256 = crypto
    .createHash('sha256')
    .update(Buffer.from(certDerBytes, 'binary'))
    .digest('hex')
    .toUpperCase()
    .match(/.{2}/g)!
    .join(':');

  return {
    manifestBuf,
    sfBuf,
    certRsaBuf,
    signingInfo: {
      signerSubject: `CN=${safeCn}, O=APKBridge Studio`,
      fingerprintSha256,
      entriesSigned: sorted.length,
      algorithm: 'RSA-2048 / SHA-256 (JAR v1)',
    },
  };
}

export async function signApkZip(
  zip: JSZip,
  appLabel: string
): Promise<{ signedBuffer: Buffer; signingInfo: SigningInfo }> {
  const existingPaths = Object.keys(zip.files);
  for (const p of existingPaths) {
    if (/^META-INF\/.*\.(SF|RSA|DSA|EC)$/i.test(p) || p === 'META-INF/MANIFEST.MF') {
      zip.remove(p);
    }
  }

  const fileEntries = Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir && !name.startsWith('META-INF/'))
    .sort();

  const digests: EntryDigest[] = [];
  for (const entryPath of fileEntries) {
    const fileObj = zip.file(entryPath);
    if (!fileObj) continue;
    const content = await fileObj.async('nodebuffer');
    digests.push({ name: entryPath, sha256: sha256Base64(content) });
  }

  const { manifestBuf, sfBuf, certRsaBuf, signingInfo } = generateMetaInfFromDigests(
    digests,
    appLabel
  );

  zip.file('META-INF/MANIFEST.MF', manifestBuf);
  zip.file('META-INF/CERT.SF', sfBuf);
  zip.file('META-INF/CERT.RSA', certRsaBuf);

  const signedBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return { signedBuffer, signingInfo };
}

