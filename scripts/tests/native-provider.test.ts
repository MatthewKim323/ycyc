import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { withNativeProvider, withVerifiedNativeArchive } from "../../convex/lib/nativeProvider";

type Entry = { name: string; body?: Buffer; type?: string; size?: number; prefix?: string };
const executable = Buffer.from("#!/bin/sh\nprintf 'fixture only\\n'\n");
function header(entry: Entry) {
  const value = Buffer.alloc(512);
  value.write(entry.name, 0, 100, "utf8");
  value.write("0000755\0", 100);
  value.write((entry.size ?? entry.body?.length ?? 0).toString(8).padStart(11, "0") + "\0", 124);
  value.fill(32, 148, 156);
  value.write(entry.type ?? "0", 156);
  value.write("ustar\0", 257);
  value.write("00", 263);
  if (entry.prefix) value.write(entry.prefix, 345, 155, "utf8");
  const sum = value.reduce((total, byte) => total + byte, 0);
  value.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return value;
}
function tar(entries: Entry[], terminate = true) {
  const buffers: Buffer[] = [];
  for (const entry of entries) {
    const body = entry.body ?? Buffer.alloc(0);
    buffers.push(header(entry), body, Buffer.alloc((512 - body.length % 512) % 512));
  }
  if (terminate) buffers.push(Buffer.alloc(1024));
  return Buffer.concat(buffers);
}
const integrity = (bytes: Buffer) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
function fixture(entries: Entry[], options: { terminate?: boolean; plain?: Buffer } = {}) {
  const compressed = gzipSync(options.plain ?? tar(entries, options.terminate ?? true));
  return { compressed, expected: { entry: "package/claude", bytes: executable.length, integrity: integrity(compressed) } };
}
function chunked(bytes: Buffer) {
  const sizes = [1, 2, 17, 509, 3, 512, 7, 513];
  return Readable.from((function* () {
    for (let offset = 0, i = 0; offset < bytes.length; i++) {
      const end = Math.min(offset + sizes[i % sizes.length]!, bytes.length);
      yield bytes.subarray(offset, end);
      offset = end;
    }
  })());
}
async function privateDirectories() {
  return (await readdir(tmpdir())).filter((name) => name.startsWith("ycyc-claude-")).sort();
}

test("streams arbitrary compressed chunks, skips padding/other files, and cleans after callback", async () => {
  const data = fixture([
    { name: "package/ignored", body: Buffer.alloc(513, 19) },
    { name: "package/claude", body: executable },
    { name: "package/final", body: Buffer.alloc(1025, 31) },
  ]);
  let directory = "";
  const result = await withVerifiedNativeArchive("claude", chunked(data.compressed), data.expected, async (binary, dir) => {
    directory = dir;
    assert.equal(binary, join(dir, "claude"));
    assert.deepEqual(await readFile(binary), executable);
    assert.equal((await stat(binary)).mode & 0o777, 0o700);
    assert.deepEqual(await readdir(dir), ["claude"]);
    return "verified";
  });
  assert.equal(result, "verified");
  await assert.rejects(access(directory));
});

test("writes only the exact fixed entry and ignores traversal, absolute paths and unrelated links", async () => {
  const data = fixture([
    { name: "../../outside", body: Buffer.from("must not be written") },
    { name: "/tmp/absolute-outside", body: Buffer.from("must not be written") },
    { name: "package/link", type: "2" },
    { name: "package/claude", body: executable },
  ]);
  await withVerifiedNativeArchive("claude", chunked(data.compressed), data.expected, async (binary, dir) => {
    assert.deepEqual(await readdir(dir), ["claude"]);
    assert.deepEqual(await readFile(binary), executable);
  });
});

test("streams a selected body across multiple gunzip chunks without buffering or losing bytes", async () => {
  const body = Buffer.alloc(180_013);
  for (let i = 0; i < body.length; i++) body[i] = i % 251;
  const data = fixture([{ name: "package/claude", body }, { name: "package/after", body: Buffer.from("tail") }]);
  await withVerifiedNativeArchive("claude", chunked(data.compressed), { ...data.expected, bytes: body.length }, async (binary) => {
    assert.equal((await stat(binary)).size, body.length);
    assert.deepEqual(await readFile(binary), body);
  });
});

test("requires full integrity verification before allowing execution and cleans failures", async () => {
  const data = fixture([{ name: "package/claude", body: executable }]);
  const before = await privateDirectories();
  let called = false;
  await assert.rejects(withVerifiedNativeArchive("claude", chunked(data.compressed), {
    ...data.expected, integrity: integrity(Buffer.from("different bytes")),
  }, async () => { called = true; }), /integrity mismatch/);
  assert.equal(called, false);
  assert.deepEqual(await privateDirectories(), before);
});

test("refuses selected symlink/hardlink, duplicates and unexpected exact sizes", async () => {
  for (const type of ["1", "2", "5"]) {
    const data = fixture([{ name: "package/claude", type, body: executable }]);
    await assert.rejects(withVerifiedNativeArchive("claude", chunked(data.compressed), data.expected, async () => assert.fail("must not run")), /not a regular file/);
  }
  const duplicated = fixture([{ name: "package/claude", body: executable }, { name: "package/claude", body: executable }]);
  await assert.rejects(withVerifiedNativeArchive("claude", chunked(duplicated.compressed), duplicated.expected, async () => assert.fail("must not run")), /Duplicate/);
  const wrongSize = fixture([{ name: "package/claude", body: Buffer.from("too short") }]);
  await assert.rejects(withVerifiedNativeArchive("claude", chunked(wrongSize.compressed), wrongSize.expected, async () => assert.fail("must not run")), /size mismatch/);
});

test("bounds compressed bytes, total decompression and oversized declared entries", async () => {
  const data = fixture([{ name: "package/claude", body: executable }]);
  await assert.rejects(withVerifiedNativeArchive("claude", chunked(data.compressed), data.expected, async () => assert.fail("must not run"), {
    compressed: data.compressed.length - 1, extracted: 450_000_000,
  }), /Compressed archive exceeds/);
  await assert.rejects(withVerifiedNativeArchive("claude", chunked(data.compressed), data.expected, async () => assert.fail("must not run"), {
    compressed: 250_000_000, extracted: 1_500,
  }), /Decompressed archive exceeds/);
  const declared = fixture([{ name: "package/ignored", size: 450_000_001 }]);
  await assert.rejects(withVerifiedNativeArchive("claude", chunked(declared.compressed), declared.expected, async () => assert.fail("must not run")), /entry exceeds/);
});

test("rejects malformed headers, truncated tar/gzip and missing selected entry", async () => {
  const badHeader = tar([{ name: "package/claude", body: executable }]);
  badHeader[0] = 1;
  const malformed = fixture([], { plain: badHeader });
  await assert.rejects(withVerifiedNativeArchive("claude", chunked(malformed.compressed), malformed.expected, async () => assert.fail("must not run")), /checksum/);
  const truncated = fixture([{ name: "package/claude", body: executable }], { terminate: false });
  await assert.rejects(withVerifiedNativeArchive("claude", chunked(truncated.compressed), truncated.expected, async () => assert.fail("must not run")), /Truncated tar/);
  const missing = fixture([{ name: "package/other", body: executable }]);
  await assert.rejects(withVerifiedNativeArchive("claude", chunked(missing.compressed), missing.expected, async () => assert.fail("must not run")), /missing or incomplete/);
  const valid = fixture([{ name: "package/claude", body: executable }]);
  await assert.rejects(withVerifiedNativeArchive("claude", chunked(valid.compressed.subarray(0, -5)), valid.expected, async () => assert.fail("must not run")));
});

test("cleans the private directory when the native callback fails", async () => {
  const data = fixture([{ name: "package/claude", body: executable }]);
  let directory = "";
  await assert.rejects(withVerifiedNativeArchive("claude", chunked(data.compressed), data.expected, async (_binary, dir) => {
    directory = dir;
    throw new Error("fixture callback failure");
  }), /fixture callback failure/);
  await assert.rejects(access(directory));
});

test("public installer refuses unknown providers before any download", async () => {
  await assert.rejects(withNativeProvider("other" as "claude", async () => assert.fail("must not run")), /Unsupported native provider/);
});
