"use node";

import { createHash, timingSafeEqual } from "node:crypto";
import { chmod, mkdtemp, open, rm, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

export type NativeProvider = "claude" | "codex";
type Expectation = { entry: string; bytes: number; integrity: string };
type Artifact = Expectation & { url: string };
type Limits = { compressed: number; extracted: number };
const LIMITS: Limits = { compressed: 250_000_000, extracted: 450_000_000 };

// Official npm distribution metadata, pinned to the published unmodified CLIs.
// Native-package optional resources are not installed: this helper proves CLI
// startup/auth capabilities; full agent features may need additional resources.
const ARTIFACTS: Record<NativeProvider, Record<"arm64" | "x64", Artifact>> = {
  claude: {
    arm64: {
      url: "https://registry.npmjs.org/@anthropic-ai/claude-code-linux-arm64/-/claude-code-linux-arm64-2.1.325.tgz",
      entry: "package/claude", bytes: 364_701_112,
      integrity: "sha512-NCvQcOxr685Y4mkYUjQT8l/Ouzw0k2xWloWeyzfsUtWiOedHosPkaW6XCSpzAl1dMuvDNBF97qpWgVDrSdK2Vw==",
    },
    x64: {
      url: "https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/-/claude-code-linux-x64-2.1.325.tgz",
      entry: "package/claude", bytes: 365_842_960,
      integrity: "sha512-BqZzMvP/zgLLL34S+7OzbG+cyoFp7gwWHU5koVwsyMlTAz+0zZAmbY+UkzvtN2RXxp6AcMenbYIjQJxoXfUY3w==",
    },
  },
  codex: {
    arm64: {
      url: "https://registry.npmjs.org/@openai/codex/-/codex-0.169.0-linux-arm64.tgz",
      entry: "package/vendor/aarch64-unknown-linux-musl/bin/codex", bytes: 290_069_784,
      integrity: "sha512-NZ/DaQUpcQmxmqee7Z9uC1rzw3GhSbooawcaTe1LN5Yk+WlinUKGdTXJgClRT/9ogQEEM9TWxYzvxPfj5G/xFg==",
    },
    x64: {
      url: "https://registry.npmjs.org/@openai/codex/-/codex-0.169.0-linux-x64.tgz",
      entry: "package/vendor/x86_64-unknown-linux-musl/bin/codex", bytes: 294_277_432,
      integrity: "sha512-o05NyAOCDygSPRo1yinzxvkRSdmsZyBD9E7mbpmjRanSfM8lypqWtQgEo4XfNkwhuCR2aFu8mlGOsQGFXVbVww==",
    },
  },
};

function octal(field: Buffer): number {
  const value = field.toString("ascii").replace(/\0.*$/s, "").trim();
  if (!/^[0-7]*$/.test(value)) throw new Error("Unsupported tar numeric field");
  const number = value ? Number.parseInt(value, 8) : 0;
  if (!Number.isSafeInteger(number)) throw new Error("Invalid tar size");
  return number;
}

const stringField = (field: Buffer) => field.toString("utf8").replace(/\0.*$/s, "");
const zero = (bytes: Buffer) => bytes.every((byte) => byte === 0);

// This is a fixed-entry reader, not a general tar extractor. Header paths never
// become filesystem paths. Only exact, regular-file matches reach an already
// opened private file; links, duplicate targets and malformed archives fail.
class FixedEntrySink extends Writable {
  private header = Buffer.alloc(512);
  private headerUsed = 0;
  private remaining = 0;
  private padding = 0;
  private selected = false;
  private seen = false;
  private written = 0;
  private total = 0;
  private zeroBlocks = 0;
  private ended = false;

  constructor(private file: FileHandle, private expected: Expectation, private maxBytes: number) { super(); }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.consume(chunk).then(() => callback(), (error: Error) => callback(error));
  }

  private async consume(chunk: Buffer) {
    this.total += chunk.length;
    if (this.total > this.maxBytes) throw new Error("Decompressed archive exceeds limit");
    let offset = 0;
    while (offset < chunk.length) {
      if (this.ended) {
        if (!zero(chunk.subarray(offset))) throw new Error("Unexpected data after tar terminator");
        return;
      }
      if (this.remaining) {
        const length = Math.min(this.remaining, chunk.length - offset);
        if (this.selected) {
          await this.file.writeFile(chunk.subarray(offset, offset + length));
          this.written += length;
        }
        this.remaining -= length;
        offset += length;
        continue;
      }
      if (this.padding) {
        const length = Math.min(this.padding, chunk.length - offset);
        if (!zero(chunk.subarray(offset, offset + length))) throw new Error("Invalid tar padding");
        this.padding -= length;
        offset += length;
        continue;
      }
      const length = Math.min(512 - this.headerUsed, chunk.length - offset);
      chunk.copy(this.header, this.headerUsed, offset, offset + length);
      this.headerUsed += length;
      offset += length;
      if (this.headerUsed !== 512) continue;
      this.headerUsed = 0;
      if (zero(this.header)) {
        this.zeroBlocks++;
        this.ended = this.zeroBlocks === 2;
        continue;
      }
      if (this.zeroBlocks) throw new Error("Invalid tar terminator");
      const checksum = octal(this.header.subarray(148, 156));
      let sum = 0;
      for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : this.header[i]!;
      if (checksum !== sum) throw new Error("Invalid tar header checksum");
      const prefix = stringField(this.header.subarray(345, 500));
      const name = stringField(this.header.subarray(0, 100));
      this.selected = (prefix ? `${prefix}/${name}` : name) === this.expected.entry;
      const size = octal(this.header.subarray(124, 136));
      if (size > this.maxBytes) throw new Error("Tar entry exceeds limit");
      if (this.selected) {
        if (this.seen) throw new Error("Duplicate native executable");
        if (this.header[156] !== 0 && this.header[156] !== 48) throw new Error("Native executable is not a regular file");
        if (size !== this.expected.bytes) throw new Error("Native executable size mismatch");
        this.seen = true;
      }
      this.remaining = size;
      this.padding = (512 - size % 512) % 512;
    }
  }

  override _final(callback: (error?: Error | null) => void) {
    if (!this.ended || this.headerUsed || this.remaining || this.padding) return callback(new Error("Truncated tar archive"));
    if (!this.seen || this.written !== this.expected.bytes) return callback(new Error("Native executable missing or incomplete"));
    callback();
  }
}

// Exported for fixture tests. Production callers use withNativeProvider below;
// no action accepts a URL, archive entry or output path from a client.
export async function withVerifiedNativeArchive<T>(
  provider: NativeProvider, source: Readable, expected: Expectation,
  run: (binaryPath: string, directory: string) => Promise<T>, limits: Limits = LIMITS,
): Promise<T> {
  if (provider !== "claude" && provider !== "codex") throw new Error("Unsupported native provider");
  const directory = await mkdtemp(join(tmpdir(), `ycyc-${provider}-`));
  const binaryPath = join(directory, provider);
  let file: FileHandle | undefined;
  try {
    if (!Number.isSafeInteger(expected.bytes) || expected.bytes < 1 || expected.bytes > limits.extracted) throw new Error("Native executable exceeds limit");
    file = await open(binaryPath, "wx", 0o600);
    const hash = createHash("sha512");
    let compressed = 0;
    const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      compressed += chunk.length;
      if (compressed > limits.compressed) return callback(new Error("Compressed archive exceeds limit"));
      hash.update(chunk);
      callback(null, chunk);
    } });
    await pipeline(source, meter, createGunzip({ chunkSize: 64 * 1024 }), new FixedEntrySink(file, expected, limits.extracted));
    const actual = hash.digest();
    const digest = Buffer.from(expected.integrity.replace(/^sha512-/, ""), "base64");
    if (!expected.integrity.startsWith("sha512-") || digest.length !== actual.length || !timingSafeEqual(actual, digest)) {
      throw new Error("Native archive integrity mismatch");
    }
    await file.close();
    file = undefined;
    await chmod(binaryPath, 0o700);
    return await run(binaryPath, directory);
  } finally {
    source.destroy();
    if (file) await file.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
}

export async function withNativeProvider<T>(
  provider: NativeProvider, run: (binaryPath: string, directory: string) => Promise<T>,
): Promise<T> {
  if (provider !== "claude" && provider !== "codex") throw new Error("Unsupported native provider");
  if (process.platform !== "linux" || (process.arch !== "arm64" && process.arch !== "x64")) {
    throw new Error("Native provider requires Linux arm64 or x64");
  }
  const artifact = ARTIFACTS[provider][process.arch];
  const response = await fetch(artifact.url, { redirect: "error", signal: AbortSignal.timeout(150_000) });
  if (!response.ok || !response.body) throw new Error(`Native provider download failed: HTTP ${response.status}`);
  if (Number(response.headers.get("content-length")) > LIMITS.compressed) {
    await response.body.cancel();
    throw new Error("Compressed archive exceeds limit");
  }
  return await withVerifiedNativeArchive(provider, Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>), artifact, run);
}
