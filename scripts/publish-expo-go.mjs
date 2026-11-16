// Admin-only publication of Expo's supported self-hosted plain-JavaScript format.
// Never publishes credentials, source maps, or Expo account/session headers.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const resume = process.argv[2] === '--resume';
const input = path.resolve(process.argv[2] || path.join(root, 'dist'));
const publicationCache = path.join(root, '.expo/public-preview-publication.json');
const reportArg = process.argv[2] === '--resume' ? process.argv[4] : process.argv[3];
const reportPath = reportArg && path.resolve(reportArg);
const deployment = process.env.CONVEX_PREVIEW_DEPLOYMENT || 'optimistic-newt-247';
const site = `https://${deployment}.convex.site`;
if (!/^[a-z0-9-]+$/.test(deployment)) throw new Error('Invalid deployment');
const sdk = '58.0.0';
const runtimeVersion = `exposdk:${sdk}`;
let snapshot = crypto.randomUUID();
let createdAt = new Date().toISOString();
let sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
function admin(name, args) {
  try {
    const output = execFileSync(process.execPath, [path.join(root, 'node_modules/convex/bin/main.js'), 'run', `publicPreview:${name}`, JSON.stringify(args), '--deployment', deployment, '--codegen', 'disable', '--typecheck', 'disable'], {
      cwd: root, env: { ...process.env, CONVEX_ACCOUNT: process.env.CONVEX_ACCOUNT || 'ycyc' },
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024,
    });
    return JSON.parse(output);
  } catch (error) {
    // Publishing arguments contain public configuration only. Upload URL
    // operations may contain capabilities and never expose their diagnostics.
    if (name === 'publish' && error.stderr) console.error(error.stderr.toString().slice(0, 1800));
    throw new Error(`Preview admin operation failed: ${name}`);
  }
}
let publication;
if (resume) {
  publication = JSON.parse(await fs.readFile(path.resolve(process.argv[3] || publicationCache), 'utf8'));
  snapshot = publication.snapshot;
  const m = JSON.parse(publication.iosManifestJson);
  createdAt = m.createdAt;
  sourceCommit = m.metadata.sourceCommit || sourceCommit;
} else {
  const metadata = JSON.parse(await fs.readFile(path.join(input, 'metadata.json'), 'utf8'));
  const app = JSON.parse(await fs.readFile(path.join(root, 'app.json'), 'utf8')).expo;
  const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', ttf: 'font/ttf', otf: 'font/otf', xml: 'application/xml', svg: 'image/svg+xml', json: 'application/json', webp: 'image/webp' };
  const files = new Map();
  for (const platform of ['ios', 'android']) {
    const meta = metadata.fileMetadata?.[platform];
    if (!meta?.bundle?.endsWith('.js') || !Array.isArray(meta.assets)) throw new Error('Export both platforms with --no-bytecode');
    for (const item of [{ path: meta.bundle, ext: 'bundle' }, ...meta.assets]) {
      const full = path.resolve(input, item.path);
      if (!full.startsWith(input + path.sep)) throw new Error('Asset outside export directory');
      if (files.has(item.path)) continue;
      const buffer = await fs.readFile(full);
      if (!buffer.length || buffer.length > 16 * 1024 * 1024) throw new Error('Invalid export asset size');
      if (item.ext === 'bundle') {
        if (buffer.subarray(0, 8).toString('hex') === 'c61fbc03c103191f') throw new Error('Hermes bytecode is not supported for public self-hosting');
        new TextDecoder('utf8', { fatal: true }).decode(buffer);
        if (!buffer.includes(Buffer.from('optimistic-newt-247.convex.cloud'))) throw new Error('Expected public Convex client configuration missing');
      }
      files.set(item.path, { buffer, contentType: item.ext === 'bundle' ? 'application/javascript' : types[item.ext] || 'application/octet-stream', ext: item.ext,
        key: crypto.createHash('md5').update(buffer).digest('hex'), hash: crypto.createHash('sha256').update(buffer).digest('base64url') });
    }
  }
  const entries = [...files.values()];
  for (let offset = 0; offset < entries.length; offset += 6) {
    const batch = entries.slice(offset, offset + 6), urls = admin('createUploadUrls', { count: batch.length });
    const ids = await Promise.all(batch.map(async (entry, i) => {
      const result = await fetch(urls[i], { method: 'POST', headers: { 'Content-Type': entry.contentType }, body: entry.buffer, signal: AbortSignal.timeout(60000) });
      if (!result.ok) throw new Error(`Preview upload failed: HTTP ${result.status}`);
      const { storageId } = await result.json();
      if (typeof storageId !== 'string') throw new Error('Invalid upload receipt');
      return storageId;
    }));
    const publicUrls = admin('assetUrls', { ids });
    for (let i = 0; i < batch.length; i++) {
      if (!publicUrls[i]?.url) throw new Error('Preview asset unavailable');
      batch[i].url = publicUrls[i].url;
      batch[i].storageId = ids[i];
    }
    console.log(`Uploaded ${Math.min(offset + 6, entries.length)}/${entries.length} public files`);
  }
  const manifestUrl = `${site}/expo-preview/${snapshot}`;
  const asset = (file, launch = false) => ({ key: file.key, hash: file.hash, contentType: file.contentType, url: file.url, ...(!launch ? { fileExtension: `.${file.ext}` } : {}) });
  const expoClient = { ...app, sdkVersion: sdk, owner: 'stephenhung', extra: {}, updates: { url: manifestUrl }, runtimeVersion };
  delete expoClient.plugins;
  const manifests = {};
  for (const platform of ['ios', 'android']) {
    const meta = metadata.fileMetadata[platform];
    manifests[platform] = { id: crypto.randomUUID(), createdAt, runtimeVersion, launchAsset: asset(files.get(meta.bundle), true), assets: meta.assets.map((a) => asset(files.get(a.path))), metadata: { sourceCommit },
      extra: { scopeKey: '@stephenhung/yuzu-public', expoClient } };
  }
  publication = { snapshot, iosManifestJson: JSON.stringify(manifests.ios), androidManifestJson: JSON.stringify(manifests.android), assetIds: entries.map((entry) => entry.storageId) };
  await fs.mkdir(path.dirname(publicationCache), { recursive: true });
  await fs.writeFile(publicationCache, JSON.stringify(publication));
}
admin('publish', publication);
const manifests = { ios: JSON.parse(publication.iosManifestJson), android: JSON.parse(publication.androidManifestJson) };
const manifestUrl = `${site}/expo-preview/${snapshot}`;
const unique = new Map();
for (const m of Object.values(manifests)) for (const a of [m.launchAsset, ...m.assets]) unique.set(a.url, a);
const uploaded = [...unique.values()];

for (const platform of ['ios', 'android']) {
  const r = await fetch(manifestUrl, { headers: { Accept: 'application/expo+json', 'expo-platform': platform, 'expo-runtime-version': runtimeVersion, 'expo-expect-signature': 'sig, keyid="expo-root", alg="rsa-v1_5-sha256"' } });
  if (!r.ok) throw new Error(`Preview manifest failed: HTTP ${r.status}`);
  const published = await r.json();
  if (published.id !== manifests[platform].id) throw new Error('Published manifest mismatch');
}
for (let i = 0; i < uploaded.length; i += 6) await Promise.all(uploaded.slice(i, i + 6).map(async (entry) => {
  const r = await fetch(entry.url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`Public asset failed: HTTP ${r.status}`);
  const data = Buffer.from(await r.arrayBuffer());
  if (crypto.createHash('sha256').update(data).digest('base64url') !== entry.hash) throw new Error('Public asset hash mismatch');
  entry.bytes = data.length;
}));
const openUrl = manifestUrl.replace('https:', 'exps:');
const report = { sourceCommit, createdAt, snapshot, manifestUrl, openUrl, sdk, runtimeVersion, publicFileCount: uploaded.length, totalBytes: uploaded.reduce((sum, a) => sum + a.bytes, 0),
  verification: { nativeManifests: ['ios', 'android'], allAssetHashesVerified: true, plainJavaScript: true, noExpoAccountAuthorization: true, physicalPhoneLaunch: 'awaiting user confirmation' },
  limitations: ['Google account linking is unavailable in this preview.', 'Installed-app detection is unavailable in Expo Go.'] };
if (reportPath) {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await require('qrcode').toFile(reportPath.replace(/\.json$/, '.png'), openUrl, { width: 1000, margin: 4, errorCorrectionLevel: 'M' });
}
console.log(JSON.stringify(report, null, 2));
