// Per-user cloud-phone leases and private network evidence. Only deployment
// administrators may register builds; model tools can select an existing app.
import { v } from "convex/values";
import { validateNativeOriginPattern } from "./lib/nativeOrigins";
import type { CaptureEntry } from "../src/lib/contract";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx, type MutationCtx } from "./_generated/server";
import { resolveApp } from "./lib/appResolver";

export const NATIVE_LEASE_MS = 5 * 60_000;
export const NATIVE_CAPTURE_TTL_MS = 60 * 60_000;
export const NATIVE_CHUNK_BYTES = 200 * 1024;
const active = (status: string) => ["starting", "running", "collecting"].includes(status);
export type NativeJobView = {
  status: string; app: string; jobId?: string; viewerUrl?: string;
  captureCount?: number; hasPartialCapture?: boolean; errorCode?: string; nextStep?: string;
};

export function validateNativeBuild(a: {
  appSlug: string; buildId: string; packageName: string; platform: "android" | "ios";
  approvedOrigins: string[]; sessionHeaders: string[]; sourceSha256?: string; vendorCertificateSha256?: string;
}) {
  if (!/^[a-z][a-z0-9_-]{0,127}$/.test(a.appSlug) || !/^[A-Za-z0-9_-]{1,128}$/.test(a.buildId) ||
      !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(a.packageName) || a.packageName.length > 256 ||
      !["android", "ios"].includes(a.platform) || !a.approvedOrigins.length || a.approvedOrigins.length > 20 || a.sessionHeaders.length > 40) throw new Error("native_invalid_build");
  for (const origin of a.approvedOrigins) {
    validateNativeOriginPattern(origin);
  }
  if (new Set(a.approvedOrigins).size !== a.approvedOrigins.length || new Set(a.sessionHeaders).size !== a.sessionHeaders.length ||
      a.sessionHeaders.some((name) => !/^[a-z0-9-]{1,128}$/.test(name) || /^(?:constructor|prototype|__proto__)$/.test(name) || /host|forward|proxy|origin|referer|url/.test(name))) throw new Error("native_invalid_build");
  if ([a.sourceSha256, a.vendorCertificateSha256].some((hash) => hash !== undefined && !/^[a-f0-9]{64}$/.test(hash))) throw new Error("native_invalid_build");
}

async function owner(ctx: QueryCtx, token: string) {
  const user = token.length >= 16 && token.length <= 256
    ? await ctx.db.query("users").withIndex("by_mcpToken", (q) => q.eq("mcpToken", token)).unique() : null;
  if (!user) throw new Error("native_unavailable");
  return user;
}

async function ownedJob(ctx: QueryCtx, token: string, rawId: string) {
  const user = await owner(ctx, token);
  const id = rawId.length <= 128 ? ctx.db.normalizeId("nativeDiscoveryJobs", rawId) : null;
  const job = id ? await ctx.db.get(id) : null;
  if (!job || job.userId !== user._id) throw new Error("native_unavailable");
  return job;
}

export function nativeJobView(job: Doc<"nativeDiscoveryJobs">, now = Date.now()): NativeJobView {
  const expired = job.status === "ready" ? (job.captureExpiresAt ?? 0) <= now : job.expiresAt <= now;
  return {
    status: expired ? "stopped" : job.status, app: job.appSlug, jobId: job._id,
    ...(!expired && active(job.status) && job.viewerUrl ? { viewerUrl: job.viewerUrl } : {}),
    captureCount: expired ? 0 : job.captureCount ?? 0,
    ...(job.hasPartialCapture !== undefined ? { hasPartialCapture: job.hasPartialCapture } : {}),
    ...(expired ? { errorCode: "native_expired" } : job.errorCode ? { errorCode: job.errorCode } : {}),
    ...(job.status === "starting" && !expired ? { nextStep: "Poll native_status while the cloud phone opens the native app." } : {}),
    ...(job.status === "running" && !expired ? { nextStep: "Call native_finish to stop the cloud phone and collect its network evidence." } : {}),
    ...(job.status === "ready" && !expired ? { nextStep: "Inspect this app with nativeJobId to learn from the captured native requests." } : {}),
  };
}

export const registerBuild = internalMutation({
  args: {
    appSlug: v.string(), buildId: v.string(), packageName: v.string(), platform: v.union(v.literal("android"), v.literal("ios")),
    approvedOrigins: v.array(v.string()), sessionHeaders: v.array(v.string()), sourceSha256: v.optional(v.string()), vendorCertificateSha256: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    validateNativeBuild(a);
    if (!(await resolveApp(ctx, a.appSlug))) throw new Error("native_unknown_app");
    const previous = await ctx.db.query("nativeAppBuilds").withIndex("by_app", (q) => q.eq("appSlug", a.appSlug)).collect();
    const matching = previous.find((row) => row.buildId === a.buildId);
    if (matching) {
      for (const key of Object.keys(a) as (keyof typeof a)[]) {
        if (JSON.stringify(matching[key]) !== JSON.stringify(a[key])) throw new Error("native_build_is_immutable");
      }
      return matching._id;
    }
    return ctx.db.insert("nativeAppBuilds", { ...a, createdAt: Date.now() });
  },
});

export const buildForApp = internalQuery({
  args: { app: v.string() },
  handler: (ctx, { app }) => ctx.db.query("nativeAppBuilds").withIndex("by_app", (q) => q.eq("appSlug", app)).order("desc").first(),
});

export const begin = internalMutation({
  args: { token: v.string(), app: v.string() },
  handler: async (ctx, { token, app }): Promise<NativeJobView> => {
    const user = await owner(ctx, token);
    if (!/^[a-z][a-z0-9_-]{0,127}$/.test(app) || !(await resolveApp(ctx, app))) throw new Error("native_unknown_app");
    const build = await ctx.db.query("nativeAppBuilds").withIndex("by_app", (q) => q.eq("appSlug", app)).order("desc").first();
    if (!build) return { status: "needs_native_build", app, nextStep: "A deployment administrator must verify and register this app's native build before cloud-phone discovery can start." };
    const now = Date.now();
    const ready = await ctx.db.query("nativeDiscoveryJobs").withIndex("by_user_status", (q) => q.eq("userId", user._id).eq("status", "ready")).order("desc").collect();
    for (const job of ready) {
      if (job.appSlug !== app || job.buildId !== build.buildId || (job.captureExpiresAt ?? 0) <= now) continue;
      const conn = await ctx.db.get(job.connectionId);
      if (conn && conn.userId === user._id && conn.appSlug === app) return nativeJobView(job, now);
    }
    // Status indexes keep the active-job check bounded even after many runs.
    for (const state of ["starting", "running", "collecting"] as const) {
      const jobs = await ctx.db.query("nativeDiscoveryJobs").withIndex("by_user_status", (q) => q.eq("userId", user._id).eq("status", state)).collect();
      for (const job of jobs) {
        if (job.expiresAt <= now) { await revoke(ctx, job, "native_expired"); continue; }
        if (job.appSlug === app) return nativeJobView(job, now);
        return { status: "native_job_in_progress", app, nextStep: "Finish the current native discovery before starting another app." };
      }
    }
    let connectionId = (await ctx.db.query("connections").withIndex("by_user_app", (q) => q.eq("userId", user._id).eq("appSlug", app)).first())?._id;
    if (!connectionId) connectionId = await ctx.db.insert("connections", { userId: user._id, appSlug: app, status: "capturing", createdAt: now, updatedAt: now });
    const jobId = await ctx.db.insert("nativeDiscoveryJobs", {
      userId: user._id, connectionId, appSlug: app, buildId: build.buildId,
      status: "starting", createdAt: now, updatedAt: now, expiresAt: now + NATIVE_LEASE_MS,
    });
    await ctx.scheduler.runAfter(NATIVE_LEASE_MS, internal.nativeDiscoveryActions.expire, { jobId });
    await ctx.scheduler.runAfter(0, internal.nativeDiscoveryActions.start, { jobId });
    return { status: "starting", app, jobId, captureCount: 0, nextStep: "Poll native_status while the cloud phone opens the native app." };
  },
});

export const status = internalQuery({
  args: { token: v.string(), jobId: v.string() },
  handler: async (ctx, a): Promise<NativeJobView> => {
    const job = await ownedJob(ctx, a.token, a.jobId);
    const conn = await ctx.db.get(job.connectionId);
    if (!conn || conn.userId !== job.userId || conn.appSlug !== job.appSlug) return { status: "stopped", app: job.appSlug, jobId: job._id, captureCount: 0, errorCode: "native_connection_revoked" };
    return nativeJobView(job);
  },
});

export const requestFinish = internalMutation({
  args: { token: v.string(), jobId: v.string() },
  handler: async (ctx, a): Promise<NativeJobView> => {
    const job = await ownedJob(ctx, a.token, a.jobId);
    const conn = await ctx.db.get(job.connectionId);
    if (!conn || conn.userId !== job.userId || conn.appSlug !== job.appSlug) {
      await revoke(ctx, job, "native_connection_revoked");
      return { status: "stopped", app: job.appSlug, jobId: job._id, errorCode: "native_connection_revoked", captureCount: 0 };
    }
    if (job.status === "ready") return nativeJobView(job);
    if (job.expiresAt <= Date.now()) { await revoke(ctx, job, "native_expired"); return nativeJobView(job); }
    if (job.status !== "running") return nativeJobView(job);
    await ctx.db.patch(job._id, { status: "collecting", updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.nativeDiscoveryActions.collect, { jobId: job._id });
    return { status: "collecting", app: job.appSlug, jobId: job._id, captureCount: 0 };
  },
});

export const privateContext = internalQuery({
  args: { token: v.string(), jobId: v.string() },
  handler: async (ctx, a) => {
    const job = await ownedJob(ctx, a.token, a.jobId);
    const build = await ctx.db.query("nativeAppBuilds").withIndex("by_app", (q) => q.eq("appSlug", job.appSlug)).filter((q) => q.eq(q.field("buildId"), job.buildId)).first();
    const conn = await ctx.db.get(job.connectionId);
    if (!conn || conn.userId !== job.userId || conn.appSlug !== job.appSlug || job.status !== "ready" || (job.captureExpiresAt ?? 0) <= Date.now()) throw new Error("native_evidence_unavailable");
    const captures = await ctx.db.query("nativeDiscoveryCaptures").withIndex("by_job_chunk", (q) => q.eq("jobId", job._id)).collect();
    return { job, build, captures };
  },
});

// APK bytes are never model input. This budgeted claim grants an internal Node
// worker access to the reviewed build belonging to this user's research job.
export const claimPackageInspection = internalMutation({
  args: { token: v.string(), jobId: v.string() },
  handler: async (ctx, a) => {
    const job = await ownedJob(ctx, a.token, a.jobId);
    const conn = await ctx.db.get(job.connectionId);
    if (!conn || conn.userId !== job.userId || job.createdAt + NATIVE_CAPTURE_TTL_MS <= Date.now()) throw new Error("native_package_unavailable");
    const build = await ctx.db.query("nativeAppBuilds").withIndex("by_app", q => q.eq("appSlug", job.appSlug)).filter(q => q.eq(q.field("buildId"), job.buildId)).first();
    if (!build?.sourceSha256 || build.platform !== "android") throw new Error("native_package_needs_verified_build");
    if ((job.packageInspectionCount ?? 0) >= 3) throw new Error("native_package_inspection_limit");
    await ctx.db.patch(job._id, { packageInspectionCount: (job.packageInspectionCount ?? 0) + 1 });
    return { app: job.appSlug, build };
  },
});

export const claimStart = internalMutation({
  args: { jobId: v.id("nativeDiscoveryJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status !== "starting" || job.dispatchClaimedAt || job.expiresAt <= Date.now()) return null;
    const conn = await ctx.db.get(job.connectionId);
    if (!conn || conn.userId !== job.userId || conn.appSlug !== job.appSlug) { await revoke(ctx, job, "native_connection_revoked"); return null; }
    const build = await ctx.db.query("nativeAppBuilds").withIndex("by_app", (q) => q.eq("appSlug", job.appSlug)).filter((q) => q.eq(q.field("buildId"), job.buildId)).first();
    if (!build) return null;
    await ctx.db.patch(jobId, { dispatchClaimedAt: Date.now(), updatedAt: Date.now() });
    return { job, build };
  },
});

export const attachSession = internalMutation({
  args: { jobId: v.id("nativeDiscoveryJobs"), sessionId: v.string(), workflowRunId: v.string() },
  handler: async (ctx, a) => {
    const job = await ctx.db.get(a.jobId);
    if (!job) return false;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(a.sessionId) || !/^[A-Za-z0-9_-]{1,128}$/.test(a.workflowRunId)) throw new Error("native_invalid_provider_session");
    if (job.status !== "starting" || !job.dispatchClaimedAt || job.expiresAt <= Date.now() || job.sessionId) {
      // Cancellation can win while the provider is allocating. Preserve the late
      // allocation for durable stop retries instead of relying on this worker.
      const expiredStarting = job.status === "starting" && job.expiresAt <= Date.now();
      if (job.dispatchClaimedAt && !job.sessionId && (["stopped", "error"].includes(job.status) || expiredStarting)) {
        await ctx.db.patch(job._id, { sessionId: a.sessionId, workflowRunId: a.workflowRunId, updatedAt: Date.now() });
        if (expiredStarting) await revoke(ctx, { ...job, sessionId: a.sessionId, workflowRunId: a.workflowRunId }, "native_expired");
        else await ctx.scheduler.runAfter(0, internal.nativeDiscoveryActions.stop, { jobId: job._id });
        await ctx.scheduler.runAfter(0, internal.nativeDiscovery.cleanupDetachedJob, { jobId: job._id });
      }
      return false;
    }
    const conn = await ctx.db.get(job.connectionId), user = await ctx.db.get(job.userId);
    if (!user || !conn || conn.userId !== job.userId || conn.appSlug !== job.appSlug) {
      await ctx.db.patch(job._id, { sessionId: a.sessionId, workflowRunId: a.workflowRunId });
      await revoke(ctx, { ...job, sessionId: a.sessionId, workflowRunId: a.workflowRunId }, "native_connection_revoked");
      await ctx.scheduler.runAfter(0, internal.nativeDiscovery.cleanupDetachedJob, { jobId: job._id });
      return false;
    }
    await ctx.db.patch(a.jobId, { sessionId: a.sessionId, workflowRunId: a.workflowRunId, viewerUrl: `https://app.revyl.ai/sessions/${a.sessionId}`, updatedAt: Date.now() });
    return true;
  },
});

export const getRun = internalQuery({
  args: { jobId: v.id("nativeDiscoveryJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    const conn = await ctx.db.get(job.connectionId);
    const valid = !!conn && conn.userId === job.userId && conn.appSlug === job.appSlug && job.expiresAt > Date.now();
    const build = await ctx.db.query("nativeAppBuilds").withIndex("by_app", (q) => q.eq("appSlug", job.appSlug)).filter((q) => q.eq(q.field("buildId"), job.buildId)).first();
    return { job, build, valid };
  },
});

export const claimCollection = internalMutation({
  args: { jobId: v.id("nativeDiscoveryJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status !== "collecting" || job.collectionClaimedAt || job.expiresAt <= Date.now()) return null;
    const conn = await ctx.db.get(job.connectionId);
    if (!conn || conn.userId !== job.userId || conn.appSlug !== job.appSlug) { await revoke(ctx, job, "native_connection_revoked"); return null; }
    const build = await ctx.db.query("nativeAppBuilds").withIndex("by_app", (q) => q.eq("appSlug", job.appSlug)).filter((q) => q.eq(q.field("buildId"), job.buildId)).first();
    if (!build) return null;
    await ctx.db.patch(jobId, { collectionClaimedAt: Date.now(), updatedAt: Date.now() });
    return { job, build };
  },
});

export const claimStop = internalMutation({
  args: { jobId: v.id("nativeDiscoveryJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job?.sessionId || !job.workflowRunId || (job.stopAttempts ?? 0) >= 3) return null;
    const attempt = (job.stopAttempts ?? 0) + 1;
    await ctx.db.patch(jobId, { stopAttempts: attempt });
    return { sessionId: job.sessionId, workflowRunId: job.workflowRunId, attempt };
  },
});

// Retain provider IDs until a stop is acknowledged. Account cleanup can then
// distinguish successful cleanup from exhausted or interrupted stop attempts.
export const confirmStopped = internalMutation({
  args: { jobId: v.id("nativeDiscoveryJobs"), sessionId: v.string(), workflowRunId: v.string() },
  handler: async (ctx, a) => {
    const job = await ctx.db.get(a.jobId);
    if (!job || job.sessionId !== a.sessionId || job.workflowRunId !== a.workflowRunId) return false;
    await ctx.db.patch(job._id, { sessionId: undefined, workflowRunId: undefined, viewerUrl: undefined, updatedAt: Date.now() });
    await cleanupDetached(ctx, job._id);
    return true;
  },
});

export const markRunning = internalMutation({
  args: { jobId: v.id("nativeDiscoveryJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status !== "starting" || !job.sessionId || job.expiresAt <= Date.now()) return false;
    const conn = await ctx.db.get(job.connectionId);
    if (!conn || conn.userId !== job.userId || conn.appSlug !== job.appSlug) { await revoke(ctx, job, "native_connection_revoked"); return false; }
    await ctx.db.patch(jobId, { status: "running", updatedAt: Date.now() });
    return true;
  },
});

export function nativeCaptureChunks(entries: CaptureEntry[]): string[] {
  if (entries.length > 2000) throw new Error("native_capture_limit");
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let chunk: string[] = [], bytes = 2;
  for (const entry of entries) {
    const json = JSON.stringify(entry), size = encoder.encode(json).byteLength;
    if (size + 2 > NATIVE_CHUNK_BYTES) throw new Error("native_capture_limit");
    if (bytes + size + (chunk.length ? 1 : 0) > NATIVE_CHUNK_BYTES) { chunks.push(`[${chunk.join(",")}]`); chunk = []; bytes = 2; }
    if (chunk.length) bytes++;
    chunk.push(json); bytes += size;
  }
  if (chunk.length) chunks.push(`[${chunk.join(",")}]`);
  return chunks;
}

export const saveCapture = internalMutation({
  args: { jobId: v.id("nativeDiscoveryJobs"), entriesJson: v.string(), sessionJson: v.string(), hasPartialCapture: v.boolean() },
  handler: async (ctx, a) => {
    const job = await ctx.db.get(a.jobId);
    if (!job || job.status !== "collecting" || job.expiresAt <= Date.now()) return false;
    const conn = await ctx.db.get(job.connectionId);
    if (!conn || conn.userId !== job.userId || conn.appSlug !== job.appSlug) { await revoke(ctx, job, "native_connection_revoked"); return false; }
    if (new TextEncoder().encode(a.sessionJson).byteLength > NATIVE_CHUNK_BYTES || new TextEncoder().encode(a.entriesJson).byteLength > 4 * 1024 * 1024) throw new Error("native_capture_limit");
    const entries = JSON.parse(a.entriesJson) as CaptureEntry[];
    if (!Array.isArray(entries) || !entries.length) throw new Error("native_empty_capture");
    const session = JSON.parse(a.sessionJson);
    if (!session || typeof session !== "object" || !Number.isFinite(session.capturedAt) || session.credentials) throw new Error("native_invalid_session");
    const chunks = nativeCaptureChunks(entries);
    const now = Date.now();
    for (let chunk = 0; chunk < chunks.length; chunk++) await ctx.db.insert("nativeDiscoveryCaptures", { jobId: job._id, chunk, entriesJson: chunks[chunk], count: JSON.parse(chunks[chunk]).length, createdAt: now });
    await ctx.db.patch(job._id, { status: "ready", sessionJson: a.sessionJson, captureCount: entries.length, hasPartialCapture: a.hasPartialCapture, captureExpiresAt: now + NATIVE_CAPTURE_TTL_MS, errorCode: undefined, viewerUrl: undefined, updatedAt: now });
    await ctx.scheduler.runAfter(NATIVE_CAPTURE_TTL_MS, internal.nativeDiscoveryActions.expire, { jobId: job._id });
    return true;
  },
});

async function revoke(ctx: MutationCtx, job: Doc<"nativeDiscoveryJobs">, errorCode: string) {
  await ctx.db.patch(job._id, { status: "stopped", errorCode, sessionJson: undefined, captureCount: 0, viewerUrl: undefined, updatedAt: Date.now() });
  const captures = await ctx.db.query("nativeDiscoveryCaptures").withIndex("by_job_chunk", (q) => q.eq("jobId", job._id)).collect();
  for (const capture of captures) await ctx.db.delete(capture._id);
  if (job.sessionId && job.workflowRunId) await ctx.scheduler.runAfter(0, internal.nativeDiscoveryActions.stop, { jobId: job._id });
}

// Connection deletion calls this in the same transaction so a concurrent
// collection cannot restore evidence after the user's disconnect.
export async function revokeNativeForConnection(ctx: MutationCtx, connectionId: Doc<"connections">["_id"]) {
  const jobs = await ctx.db.query("nativeDiscoveryJobs").withIndex("by_connection", (q) => q.eq("connectionId", connectionId)).collect();
  for (const job of jobs) {
    if (job.status !== "stopped") await revoke(ctx, job, "native_connection_revoked");
    await ctx.scheduler.runAfter(0, internal.nativeDiscovery.cleanupDetachedJob, { jobId: job._id });
  }
}

// Account deletion must also cover jobs whose connection was already removed.
// The scheduled cleanup runs after the account transaction commits.
export async function revokeNativeForUser(ctx: MutationCtx, userId: Doc<"users">["_id"]) {
  const jobs = await ctx.db.query("nativeDiscoveryJobs").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
  for (const job of jobs) {
    await revoke(ctx, job, "native_connection_revoked");
    await ctx.scheduler.runAfter(0, internal.nativeDiscovery.cleanupDetachedJob, { jobId: job._id });
  }
}

async function cleanupDetached(ctx: MutationCtx, jobId: Doc<"nativeDiscoveryJobs">["_id"]) {
  const job = await ctx.db.get(jobId);
  if (!job) return false;
  const user = await ctx.db.get(job.userId), conn = await ctx.db.get(job.connectionId);
  if (user && conn) return false;
  // Strip credential-bearing evidence before any remote cleanup is attempted.
  await revoke(ctx, job, "native_connection_revoked");
  await ctx.db.patch(jobId, { captureExpiresAt: undefined, hasPartialCapture: undefined, packageInspectionCount: undefined, collectionClaimedAt: undefined });
  const allocationMayBeRunning = !!job.dispatchClaimedAt && Date.now() < job.expiresAt;
  if (allocationMayBeRunning) {
    await ctx.scheduler.runAfter(Math.max(1, job.expiresAt - Date.now() + 1), internal.nativeDiscovery.cleanupDetachedJob, { jobId });
  }
  if (job.sessionId || job.workflowRunId) {
    // Exhausted retries leave only the schema-required job metadata and opaque
    // operational IDs. An unconfirmed stop is never reported as successful.
    if ((job.stopAttempts ?? 0) >= 3) await ctx.db.patch(jobId, { errorCode: "native_stop_unconfirmed" });
    return false;
  }
  if (allocationMayBeRunning) return false;
  await ctx.db.delete(jobId);
  return true;
}

export const cleanupDetachedJob = internalMutation({
  args: { jobId: v.id("nativeDiscoveryJobs") },
  handler: (ctx, { jobId }): Promise<boolean> => cleanupDetached(ctx, jobId),
});

export const expireJob = internalMutation({
  args: { jobId: v.id("nativeDiscoveryJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || (job.status === "ready" ? (job.captureExpiresAt ?? 0) > Date.now() : !active(job.status) || job.expiresAt > Date.now())) return false;
    await revoke(ctx, job, "native_expired");
    return true;
  },
});

export const fail = internalMutation({
  args: { jobId: v.id("nativeDiscoveryJobs"), errorCode: v.string() },
  handler: async (ctx, { jobId, errorCode }) => {
    const job = await ctx.db.get(jobId);
    if (!job || !active(job.status)) return null;
    const code = /^[a-z][a-z0-9_]{0,79}$/.test(errorCode) ? errorCode : "native_provider_failed";
    await ctx.db.patch(jobId, { status: "error", errorCode: code, sessionJson: undefined, captureCount: 0, viewerUrl: undefined, updatedAt: Date.now() });
    if (job.sessionId && job.workflowRunId) await ctx.scheduler.runAfter(0, internal.nativeDiscoveryActions.stop, { jobId });
    return null;
  },
});
