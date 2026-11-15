/// <reference types="node" />
"use node";

// Internal-only smoke test for running native provider runtimes in Convex.
// No account credentials, external model calls, or app tools are involved.
import { execFile } from "node:child_process";
import { mkdtemp, rm, statfs, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nodeProcess from "node:process";
import { promisify } from "node:util";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { withNativeProvider } from "./lib/nativeProvider";

const execute = promisify(execFile);

export const environment = internalAction({
  args: {},
  handler: async () => {
    const directory = await mkdtemp(join(tmpdir(), "ycyc-runtime-probe-"));
    try {
      await writeFile(join(directory, "probe"), "temporary files work", { mode: 0o600 });
      const child = await execute(nodeProcess.execPath, ["--version"], { timeout: 10_000, maxBuffer: 1024 });
      const disk = await statfs(directory);
      const tar = await execute("tar", ["--version"], { timeout: 10_000, maxBuffer: 4096 })
        .then((result) => result.stdout.split("\n")[0]).catch(() => "unavailable");
      return {
        platform: nodeProcess.platform,
        architecture: nodeProcess.arch,
        node: nodeProcess.version,
        childProcess: child.stdout.trim(),
        temporaryFiles: true,
        temporaryBytesAvailable: disk.bavail * disk.bsize,
        residentBytes: nodeProcess.memoryUsage().rss,
        tar,
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
});

export const runtime = internalAction({
  args: { provider: v.union(v.literal("claude"), v.literal("codex")) },
  handler: async (_ctx, { provider }) => withNativeProvider(provider, async (binary, directory) => {
    const started = Date.now();
    const options = { cwd: directory, timeout: 30_000, maxBuffer: 16_000 };
    const version = await execute(binary, ["--version"], options);
    const help = await execute(binary, provider === "claude" ? ["auth", "login", "--help"] : ["login", "--help"], options);
    return { provider, version: version.stdout.trim(), loginHelp: help.stdout.slice(0, 1800), milliseconds: Date.now() - started };
  }),
});
