/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { zipSync } from "fflate";
import { inspectApkBytes } from "../../convex/lib/apkAnalysis";

function mutf8(text: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const value = text.charCodeAt(i);
    if (value && value < 128) bytes.push(value);
    else if (value < 2048) bytes.push(0xc0 | value >> 6, 0x80 | value & 63);
    else bytes.push(0xe0 | value >> 12, 0x80 | value >> 6 & 63, 0x80 | value & 63);
  }
  return bytes;
}
function uleb(value: number): number[] {
  const bytes: number[] = [];
  do { const byte = value & 127; value >>>= 7; bytes.push(value ? byte | 128 : byte); } while (value);
  return bytes;
}
function dex(strings: string[]): Uint8Array {
  const start = 112 + strings.length * 4;
  const data: number[] = [];
  const offsets: number[] = [];
  for (const string of strings) { offsets.push(start + data.length); data.push(...uleb(string.length), ...mutf8(string), 0); }
  const bytes = new Uint8Array(start + data.length);
  bytes.set([100, 101, 120, 10, 48, 51, 57, 0]);
  const view = new DataView(bytes.buffer);
  view.setUint32(32, bytes.length, true);
  view.setUint32(36, 112, true);
  view.setUint32(40, 0x12345678, true);
  view.setUint32(56, strings.length, true);
  view.setUint32(60, 112, true);
  view.setUint32(104, data.length, true);
  view.setUint32(108, start, true);
  offsets.forEach((value, index) => view.setUint32(112 + index * 4, value, true));
  bytes.set(data, start);
  return bytes;
}
function archive(strings = ["https://api.example.com/v1/items"], level: 0 | 6 = 6): Uint8Array {
  return zipSync({ "classes.dex": dex(strings), "assets/private.txt": new TextEncoder().encode("PRIVATE_UNRELATED_RESOURCE") }, { level });
}
function metadata(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const end = bytes.length - 22;
  return { view, central: view.getUint32(end + 16, true), end };
}

test("inspects only root DEX strings and returns bounded structural hints, never arbitrary code", () => {
  for (const level of [0, 6] as const) {
    const result = inspectApkBytes(archive(["https://api.example.com/v1/items?limit=5#fragment", "/oauth/token", "access_token", "application/json", "PRIVATE_ARBITRARY_NEIGHBOR", "API_KEY=PRIVATE_EMBEDDED_KEY", "Authorization: Bearer PRIVATE_BEARER", "https://user:PRIVATE_PASSWORD@bad.example.com/v1/me"], level));
    assert.equal(result.analysis, "dex-string-inspection");
    assert.equal(result.dexFileCount, 1);
    assert.equal(result.stringsExamined, 8);
    assert.match(result.archiveSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(result.hosts, ["api.example.com"]);
    assert.ok(result.paths.includes("/v1/items"));
    assert.ok(result.paths.includes("/oauth/token"));
    assert.ok(result.excerpt.includes("field access_token"));
    assert.ok(!JSON.stringify(result).includes("PRIVATE"));
    assert.ok(!JSON.stringify(result).includes("limit=5"));
  }
});

test("MUTF-8 null and surrogate code units decode conservatively without exposing non-hint text", () => {
  const result = inspectApkBytes(archive(["embedded\0null", "emoji\ud83d\ude00", "https://api.example.com/v2/ok"]));
  assert.equal(result.stringsExamined, 3);
  assert.deepEqual(result.paths, ["/v2/ok"]);
});

test("queries prioritize later matching hints while the candidate pool and output stay bounded", () => {
  const strings = Array.from({ length: 350 }, (_, i) => `https://host${i}.example.com/v1/items/${i}`);
  strings.push("https://api.target.example.com/v9/needle");
  const result = inspectApkBytes(archive(strings), "needle");
  assert.equal(result.stringsExamined, 351);
  assert.ok(result.paths.includes("/v9/needle"));
  assert.ok(result.hosts.includes("api.target.example.com"));
  assert.ok(result.excerpt.length <= 200);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 5000);
  assert.equal(result.truncated, true);
  assert.throws(() => inspectApkBytes(archive(), "x".repeat(81)), /apk_invalid_query/);
  assert.throws(() => inspectApkBytes(archive(), "\n"), /apk_invalid_query/);
});

test("does not return embedded credentials, query secrets, encoded or identifier-like paths", () => {
  const result = inspectApkBytes(archive(["https://api.example.com/v1/me?access_token=PRIVATE_TOKEN", "/api/items?password=PRIVATE_PASSWORD", "https://api.example.com/api/0123456789abcdef0123456789abcdef", "/api/%50%52%49%56%41%54%45", "https://api.example.com/v1/items?code=PRIVATE_CODE", "client_secret=PRIVATE_SECRET", "Bearer PRIVATE_ACCESS", "/api/token/PRIVATE_SHORT"]));
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
  assert.ok(!JSON.stringify(result).includes("0123456789abcdef"));
  assert.ok(!JSON.stringify(result).includes("%50"));
  assert.ok(result.paths.includes("/v1/items"));
  assert.ok(result.paths.includes("/api/token/{redacted}"));
});

test("supports multidex but rejects no DEX, unsafe filenames, excessive entries and decoded budgets", () => {
  const files = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [i ? `classes${i + 1}.dex` : "classes.dex", dex(["graphql"])]));
  assert.equal(inspectApkBytes(zipSync(files)).dexFileCount, 24);
  assert.throws(() => inspectApkBytes(zipSync({ ...files, "classes25.dex": dex([]) })), /apk_dex_budget_exceeded/);
  for (const name of ["../classes.dex", "/classes.dex", "a/../classes.dex", "a\\classes.dex", "C:classes.dex"]) {
    assert.throws(() => inspectApkBytes(zipSync({ [name]: dex([]), "classes.dex": dex([]) })), /apk_invalid_archive/);
  }
  assert.throws(() => inspectApkBytes(zipSync({ "assets/classes.dex": dex([]) })), /apk_invalid_archive/);
  const oversized = archive();
  const { view, central } = metadata(oversized);
  view.setUint32(central + 24, 32 * 1024 * 1024 + 1, true);
  view.setUint32(22, 32 * 1024 * 1024 + 1, true);
  assert.throws(() => inspectApkBytes(oversized), /apk_invalid_archive/);
});

test("rejects deflate bombs with false declared size before retaining inflated content", () => {
  const bytes = zipSync({ "classes.dex": new Uint8Array(2 * 1024 * 1024) });
  const { view, central } = metadata(bytes);
  view.setUint32(central + 24, 112, true);
  view.setUint32(22, 112, true);
  assert.throws(() => inspectApkBytes(bytes), /apk_invalid_archive/);
});

test("preflights the aggregate decoded budget and verifies actual content CRC", () => {
  const files = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [i ? `classes${i + 1}.dex` : "classes.dex", dex(["graphql"])]));
  const bytes = zipSync(files);
  const { view, central } = metadata(bytes);
  let current = central;
  for (let i = 0; i < 4; i++) {
    const local = view.getUint32(current + 42, true);
    view.setUint32(current + 24, 25 * 1024 * 1024, true);
    view.setUint32(local + 22, 25 * 1024 * 1024, true);
    current += 46 + view.getUint16(current + 28, true) + view.getUint16(current + 30, true) + view.getUint16(current + 32, true);
  }
  assert.throws(() => inspectApkBytes(bytes), /apk_dex_budget_exceeded/);
  const wrongCrc = archive();
  const target = metadata(wrongCrc);
  target.view.setUint32(target.central + 16, 1, true);
  target.view.setUint32(14, 1, true);
  assert.throws(() => inspectApkBytes(wrongCrc), /apk_invalid_archive/);
});

test("requires valid matching data descriptors instead of trusting the central directory", () => {
  const bytes = archive();
  const { view, central } = metadata(bytes);
  view.setUint16(central + 8, 8, true);
  view.setUint16(6, 8, true);
  assert.throws(() => inspectApkBytes(bytes), /apk_invalid_archive/);
});

test("rejects truncated ZIPs, encrypted DEX, ZIP64, invalid methods and header mismatches", () => {
  const original = archive();
  assert.throws(() => inspectApkBytes(original.subarray(0, original.length - 1)), /apk_invalid_archive/);
  for (const change of [
    (v: DataView, c: number) => { v.setUint16(c + 8, 1, true); v.setUint16(6, 1, true); },
    (v: DataView, c: number) => v.setUint32(c + 20, 0xffffffff, true),
    (v: DataView, c: number) => { v.setUint16(c + 10, 99, true); v.setUint16(8, 99, true); },
    (v: DataView, c: number) => v.setUint32(c + 24, 1, true),
    (v: DataView, c: number) => v.setUint32(c + 16, 1, true),
  ]) {
    const bytes = original.slice();
    const { view, central } = metadata(bytes);
    change(view, central);
    assert.throws(() => inspectApkBytes(bytes), /apk_invalid_archive/);
  }
});

test("rejects malformed DEX headers, string table bounds, ULEB lengths and MUTF-8", () => {
  const changes = [
    (b: Uint8Array, v: DataView) => { b[0] = 0; },
    (b: Uint8Array, v: DataView) => v.setUint32(32, 111, true),
    (b: Uint8Array, v: DataView) => v.setUint32(60, b.length, true),
    (b: Uint8Array, v: DataView) => v.setUint32(112, 1, true),
    (b: Uint8Array, v: DataView) => { b.set([255, 255, 255, 255, 255], v.getUint32(112, true)); },
    (b: Uint8Array, v: DataView) => { b[v.getUint32(112, true) + 1] = 255; },
    (b: Uint8Array, v: DataView) => { b[v.getUint32(112, true)] = 100; },
  ];
  for (const change of changes) {
    const bytes = dex(["hello"]);
    change(bytes, new DataView(bytes.buffer));
    assert.throws(() => inspectApkBytes(zipSync({ "classes.dex": bytes })), /apk_invalid_dex/);
  }
});
