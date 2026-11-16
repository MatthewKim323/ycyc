"use node";

import { createHash } from "node:crypto";
import { Inflate } from "fflate";

const MiB = 1024 * 1024;
const MAX_ARCHIVE = 200 * MiB;
const MAX_DEX = 24;
const MAX_ENTRY = 32 * MiB;
const MAX_TOTAL = 96 * MiB;
const MAX_STRINGS = 1_000_000;
const MAX_STRING_BYTES = 96 * MiB;
const MAX_HINT_BYTES = 4096;
const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();
const invalid = () => new Error("apk_invalid_archive");
const dexInvalid = () => new Error("apk_invalid_dex");

export type ApkAnalysis = {
  archiveSha256: string;
  dexFileCount: number;
  stringsExamined: number;
  hosts: string[];
  paths: string[];
  excerpt: string[];
  truncated: boolean;
  analysis: "dex-string-inspection";
};

type Entry = { name: string; start: number; compressed: number; size: number; method: number; crc: number };

/** Read ZIP metadata first. Never extract names to disk or inflate unrelated resources. */
function dexEntries(bytes: Uint8Array): Entry[] {
  if (bytes.length < 22 || bytes.length > MAX_ARCHIVE) throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  const floor = Math.max(0, end - 65535);
  for (; end >= floor; end--) {
    if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === bytes.length) break;
  }
  if (end < floor || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw invalid();
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const central = view.getUint32(end + 16, true);
  if (!count || count > 20000 || count !== view.getUint16(end + 8, true) || central + centralSize !== end) throw invalid();
  const names = new Set<string>();
  const ranges: [number, number][] = [];
  const selected: Entry[] = [];
  let position = central;
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (position + 46 > end || view.getUint32(position, true) !== 0x02014b50) throw invalid();
    const flags = view.getUint16(position + 8, true);
    const method = view.getUint16(position + 10, true);
    const crc = view.getUint32(position + 16, true);
    const compressed = view.getUint32(position + 20, true);
    const size = view.getUint32(position + 24, true);
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLength = view.getUint16(position + 32, true);
    const local = view.getUint32(position + 42, true);
    const next = position + 46 + nameLength + extraLength + commentLength;
    if (!nameLength || nameLength > 1024 || next > end || view.getUint16(position + 34, true) ||
      [compressed, size, local].includes(0xffffffff)) throw invalid();
    let name: string;
    try { name = decoder.decode(bytes.subarray(position + 46, position + 46 + nameLength)); } catch { throw invalid(); }
    if (name.startsWith("/") || /[\\\x00-\x1f:]/.test(name) || name.split("/").some((part) => part === ".." || part === ".") || names.has(name)) throw invalid();
    names.add(name);
    if (local + 30 > central || view.getUint32(local, true) !== 0x04034b50 ||
      view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method ||
      view.getUint16(local + 26, true) !== nameLength) throw invalid();
    const start = local + 30 + nameLength + view.getUint16(local + 28, true);
    if (start + compressed > central || start > central) throw invalid();
    for (let n = 0; n < nameLength; n++) if (bytes[local + 30 + n] !== bytes[position + 46 + n]) throw invalid();
    // Data descriptors are allowed; otherwise both headers must agree exactly.
    if (!(flags & 8) && (view.getUint32(local + 14, true) !== crc || view.getUint32(local + 18, true) !== compressed || view.getUint32(local + 22, true) !== size)) throw invalid();
    let entryEnd = start + compressed;
    if (flags & 8) {
      if (entryEnd + 12 > central) throw invalid();
      const descriptor = view.getUint32(entryEnd, true) === 0x08074b50 ? entryEnd + 4 : entryEnd;
      if (descriptor + 12 > central || view.getUint32(descriptor, true) !== crc ||
        view.getUint32(descriptor + 4, true) !== compressed || view.getUint32(descriptor + 8, true) !== size) throw invalid();
      entryEnd = descriptor + 12;
    }
    ranges.push([local, entryEnd]);
    if (/^classes(?:[1-9]\d*)?\.dex$/.test(name)) {
      if (flags & 0x41 || ![0, 8].includes(method) || !size || size > MAX_ENTRY || compressed > MAX_ENTRY || (method === 0 && compressed !== size)) throw invalid();
      total += size;
      if (total > MAX_TOTAL || selected.length >= MAX_DEX) throw new Error("apk_dex_budget_exceeded");
      selected.push({ name, start, compressed, size, method, crc });
    }
    position = next;
  }
  if (position !== end || !selected.length) throw invalid();
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1]) throw invalid();
  return selected;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, initial) => {
  let value = initial;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function inflateEntry(archive: Uint8Array, entry: Entry): Uint8Array {
  const compressed = archive.subarray(entry.start, entry.start + entry.compressed);
  let result: Uint8Array;
  if (entry.method === 0) result = compressed;
  else {
    result = new Uint8Array(entry.size);
    let written = 0;
    let finished = false;
    const stream = new Inflate((chunk, final) => {
      if (written + chunk.length > entry.size || written + chunk.length > MAX_ENTRY) throw invalid();
      result.set(chunk, written);
      written += chunk.length;
      finished = final;
    });
    // Tiny compressed pushes bound the inflater's temporary output even if the ZIP
    // size lies. A DEFLATE bomb cannot force a whole unbounded entry allocation.
    try {
      for (let offset = 0; offset < compressed.length; offset += 256) {
        stream.push(compressed.subarray(offset, Math.min(offset + 256, compressed.length)), offset + 256 >= compressed.length);
      }
    } catch { throw invalid(); }
    if (!finished || written !== entry.size) throw invalid();
  }
  if (crc32(result) !== entry.crc) throw invalid();
  return result;
}

type Budget = { strings: number; bytes: number; truncated: boolean };
/** DEX strings are MUTF-8: accept only its valid one/two/three-byte code units. */
function readString(bytes: Uint8Array, offset: number, budget: Budget): string | undefined {
  let length = 0;
  let used = 0;
  for (; used < 5; used++) {
    if (offset >= bytes.length) throw dexInvalid();
    const byte = bytes[offset++];
    if (used === 4 && byte > 15) throw dexInvalid();
    length += (byte & 127) * 2 ** (used * 7);
    if (!(byte & 128)) break;
  }
  if (used === 5) throw dexInvalid();
  // Large code constants are not useful API hints. Do not allocate their text.
  const retain = length <= 16384;
  if (!retain) budget.truncated = true;
  const units: number[] = [];
  let count = 0;
  while (true) {
    if (offset >= bytes.length || budget.bytes++ >= MAX_STRING_BYTES) {
      if (budget.bytes >= MAX_STRING_BYTES) { budget.truncated = true; return undefined; }
      throw dexInvalid();
    }
    const first = bytes[offset++];
    if (first === 0) break;
    let unit: number;
    if (first < 128) unit = first;
    else {
      const continuation = () => {
        if (offset >= bytes.length) throw dexInvalid();
        budget.bytes++;
        const next = bytes[offset++];
        if ((next & 0xc0) !== 0x80) throw dexInvalid();
        return next & 63;
      };
      if (first >= 0xc0 && first <= 0xdf) {
        unit = ((first & 31) << 6) | continuation();
        if (unit < 128 && unit !== 0) throw dexInvalid();
      } else if (first >= 0xe0 && first <= 0xef) {
        unit = ((first & 15) << 12) | (continuation() << 6) | continuation();
        if (unit < 2048) throw dexInvalid();
      } else throw dexInvalid();
    }
    if (++count > length) throw dexInvalid();
    if (retain) units.push(unit);
  }
  if (count !== length) throw dexInvalid();
  return retain ? String.fromCharCode(...units) : undefined;
}

const field = /^(?:access[_-]?token|refresh[_-]?token|id[_-]?token|authorization|bearer|client[_-]?id|client[_-]?secret|client[_-]?token|api[_-]?key|password|username|grant[_-]?type|scope|oauth2?|graphql|application\/json|application\/x-protobuf|grpc)$/i;
const secretAssignment = /(?:token|password|secret|api[_-]?key|authorization|cookie)\s*[=:]\s*\S/i;
function safePath(value: string): string | undefined {
  const path = value.split(/[?#]/, 1)[0].replace(/\/(token|password|secret|api[_-]?key|authorization|cookie)\/[^/]+/gi, "/$1/{redacted}");
  if (!path.startsWith("/") || path.startsWith("//") || path.length > 240 || !/^\/[a-zA-Z0-9_~.{}%:/-]*$/.test(path) || /%[0-9a-f]{2}/i.test(path)) return undefined;
  if (path.split("/").some((part) => part.length > 48 || /[a-f0-9]{24,}/i.test(part) || /^[A-Za-z0-9_-]{20,}$/.test(part))) return undefined;
  return path;
}
function hints(text: string): { kind: "host" | "path" | "field"; value: string }[] {
  // Never expose arbitrary neighboring strings, assignments, URL credentials,
  // queries, fragments, or long identifier-like segments from embedded app code.
  if (secretAssignment.test(text) || /bearer\s+\S/i.test(text)) return [];
  if (field.test(text)) return [{ kind: "field", value: text }];
  const result: { kind: "host" | "path" | "field"; value: string }[] = [];
  if (/^https?:\/\//i.test(text) && text.length <= 2048) {
    try {
      const url = new URL(text);
      if (url.username || url.password || !/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(url.hostname) || url.hostname.length > 253) return [];
      result.push({ kind: "host", value: url.hostname });
      const path = safePath(url.pathname);
      if (path && path !== "/") result.push({ kind: "path", value: path });
    } catch { /* Not a complete URL literal. */ }
  } else if (/^\/(?:api|v\d|graphql|oauth|auth|login|token|me|users|accounts|playlists|search|profile|rpc)(?:\/|$)/i.test(text)) {
    const path = safePath(text);
    if (path) result.push({ kind: "path", value: path });
  }
  return result;
}

/** Static hints only. This is neither decompilation nor evidence an operation is safe. */
export function inspectApkBytes(bytes: Uint8Array, query?: string): ApkAnalysis {
  if (query !== undefined && (typeof query !== "string" || query.length > 80 || /[\x00-\x1f]/.test(query))) throw new Error("apk_invalid_query");
  const entries = dexEntries(bytes);
  const budget: Budget = { strings: 0, bytes: 0, truncated: false };
  const candidates = new Map<string, { kind: "host" | "path" | "field"; value: string; rank: number }>();
  const needle = query?.trim().toLowerCase();
  let stopped = false;
  for (const entry of entries) {
    const dex = inflateEntry(bytes, entry);
    const view = new DataView(dex.buffer, dex.byteOffset, dex.byteLength);
    if (dex.length < 112 || !/^dex\n0(?:35|37|38|39|40)\x00$/.test(String.fromCharCode(...dex.subarray(0, 8))) ||
      view.getUint32(32, true) !== dex.length || view.getUint32(36, true) !== 112 || view.getUint32(40, true) !== 0x12345678) throw dexInvalid();
    const count = view.getUint32(56, true);
    const table = view.getUint32(60, true);
    const dataSize = view.getUint32(104, true);
    const data = view.getUint32(108, true);
    if ((count && (table < 112 || table % 4)) || table + count * 4 > dex.length || data < 112 || data + dataSize !== dex.length) throw dexInvalid();
    for (let i = 0; i < count; i++) {
      if (budget.strings >= MAX_STRINGS || budget.bytes >= MAX_STRING_BYTES) { budget.truncated = true; stopped = true; break; }
      const offset = view.getUint32(table + i * 4, true);
      if (offset < data || offset >= dex.length) throw dexInvalid();
      budget.strings++;
      const text = readString(dex, offset, budget);
      if (text === undefined) continue;
      for (const hint of hints(text)) {
        const key = `${hint.kind} ${hint.value}`;
        if (candidates.has(key)) continue;
        const rank = needle && (hint.value.toLowerCase().includes(needle) || text.toLowerCase().includes(needle)) ? 2 : /(?:api|oauth|graphql|\/v\d)/i.test(hint.value) ? 1 : 0;
        if (candidates.size < 200) candidates.set(key, { ...hint, rank });
        else {
          budget.truncated = true;
          const replace = [...candidates].find(([, candidate]) => candidate.rank < rank);
          if (replace) { candidates.delete(replace[0]); candidates.set(key, { ...hint, rank }); }
        }
      }
    }
    if (stopped) break;
  }
  const hosts: string[] = [];
  const paths: string[] = [];
  const excerpt: string[] = [];
  let outputBytes = 0;
  for (const hint of [...candidates.values()].sort((a, b) => b.rank - a.rank)) {
    const line = `${hint.kind} ${hint.value}`;
    const cost = encoder.encode(line).length + encoder.encode(hint.kind === "field" ? "" : hint.value).length + 12;
    if (outputBytes + cost > MAX_HINT_BYTES) { budget.truncated = true; continue; }
    outputBytes += cost;
    excerpt.push(line);
    if (hint.kind === "host") hosts.push(hint.value);
    if (hint.kind === "path") paths.push(hint.value);
  }
  return { archiveSha256: createHash("sha256").update(bytes).digest("hex"), dexFileCount: entries.length,
    stringsExamined: budget.strings, hosts, paths, excerpt, truncated: budget.truncated, analysis: "dex-string-inspection" };
}
