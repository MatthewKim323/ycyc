/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import type { Id } from "../../convex/_generated/dataModel";
import * as discovery from "../../convex/nativeDiscovery";
import * as actions from "../../convex/nativeDiscoveryActions";
import { RevylClient } from "../re/lib/revyl";

const api = discovery as unknown as Record<string, any>;
const action = actions as unknown as Record<string, any>;
const token = "owner-native-capability";
const otherToken = "other-native-capability";
const app = "app_123456";
const origin = "https://api.acme.com";
const build = { appSlug: app, buildId: "admin-reviewed-build", packageName: "com.acme.mobile", platform: "android" as const, approvedOrigins: [origin], sessionHeaders: ["authorization", "cookie"] };
const nativeSession = { sessionId: "native_session", workflowRunId: "native_run", viewerUrl: "https://app.revyl.ai/sessions/native_session" };

function fixture() {
  let next = 0;
  const rows = new Map<string, any>();
  const seed = (table: string, fields: Record<string, unknown>) => {
    const id = `${table}:${++next}`; rows.set(id, { ...structuredClone(fields), _id: id, _creationTime: next, table }); return id;
  };
  const userId = seed("users", { mcpToken: token });
  const otherId = seed("users", { mcpToken: otherToken });
  seed("discoveredApps", { slug: app, name: "Acme Native", webOrigin: "https://www.acme.com", loginUrl: "https://www.acme.com/login" });
  seed("discoveredApps", { slug: "app_234567", name: "Another Native" });
  const scheduled: any[] = [];
  const db = {
    get: async (id: string) => structuredClone(rows.get(id) ?? null),
    normalizeId: (table: string, id: string) => id.startsWith(`${table}:`) ? id : null,
    insert: async (table: string, fields: Record<string, unknown>) => seed(table, fields),
    delete: async (id: string) => { rows.delete(id); },
    patch: async (id: string, patch: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete rows.get(id)[key]; else rows.get(id)[key] = structuredClone(value);
      }
    },
    query(table: string) {
      const filters: [string, unknown][] = [];
      let direction = 1;
      const range = { eq(key: string, value: unknown) { filters.push([key, value]); return range; }, field(key: string) { return key; } };
      const selected = () => [...rows.values()].filter((row) => row.table === table && filters.every(([key, value]) => row[key] === value))
        .sort((a, b) => direction * (a._creationTime - b._creationTime)).map((row) => structuredClone(row));
      const q = {
        withIndex(_name: string, fn: (q: typeof range) => unknown) { fn(range); return q; },
        filter(fn: (q: typeof range) => unknown) { fn(range); return q; },
        order(order: string) { direction = order === "desc" ? -1 : 1; return q; },
        collect: async () => selected(), first: async () => selected()[0] ?? null,
        unique: async () => { const matches = selected(); assert.ok(matches.length <= 1); return matches[0] ?? null; },
      }; return q;
    },
  };
  const ctx = { db, scheduler: { runAfter: async (delay: number, ref: Parameters<typeof getFunctionName>[0], args: unknown) => { scheduled.push({ delay, name: getFunctionName(ref), args }); return "scheduled"; } } };
  const actionCtx = {
    scheduler: ctx.scheduler,
    runQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => api[getFunctionName(ref).split(":")[1]]._handler(ctx, args),
    runMutation: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => api[getFunctionName(ref).split(":")[1]]._handler(ctx, args),
  };
  const register = (extra = {}) => api.registerBuild._handler(ctx, { ...build, ...extra });
  const begin = (slug = app, capability = token) => api.begin._handler(ctx, { token: capability, app: slug });
  const get = (id: string) => rows.get(id);
  const running = async () => {
    await register();
    const result = await begin();
    await api.claimStart._handler(ctx, { jobId: result.jobId });
    await api.attachSession._handler(ctx, { jobId: result.jobId, sessionId: nativeSession.sessionId, workflowRunId: nativeSession.workflowRunId });
    await api.markRunning._handler(ctx, { jobId: result.jobId });
    return result.jobId as string;
  };
  return { ctx, actionCtx, rows, seed, userId, otherId, register, begin, get, running, scheduled };
}

function entry(body = '{"items":[]}') {
  return { id: "native-1", method: "GET", url: `${origin}/api/items`, status: 200, reqHeaders: {}, resHeaders: { "content-type": "application/json" }, resBody: body, ts: Date.now() };
}

async function withClientMethods(methods: Record<string, unknown>, fn: () => Promise<void>) {
  const previous = new Map(Object.keys(methods).map((name) => [name, (RevylClient.prototype as any)[name]]));
  const key = process.env.REVYL_API_KEY;
  process.env.REVYL_API_KEY = "PRIVATE_REVYL_KEY";
  for (const [name, value] of Object.entries(methods)) (RevylClient.prototype as any)[name] = value;
  try { await fn(); }
  finally {
    for (const [name, value] of previous) (RevylClient.prototype as any)[name] = value;
    if (key === undefined) delete process.env.REVYL_API_KEY; else process.env.REVYL_API_KEY = key;
  }
}

test("registered builds are admin-only, immutable and restrict origins and session headers", async () => {
  const f = fixture();
  const id = await f.register();
  assert.equal(await f.register(), id);
  await assert.rejects(f.register({ packageName: "com.changed.mobile" }), /immutable/);
  for (const approvedOrigins of [["http://api.acme.com"], ["https://127.0.0.1"], ["https://[::1]"], ["https://metadata.internal"], ["https://localhost"], ["https://api.acme.com/"], ["https://api.acme.com:444"], ["https://u:p@api.acme.com"], ["https://api.acme.com/path"]]) {
    assert.throws(() => discovery.validateNativeBuild({ ...build, approvedOrigins }), /native_invalid/);
  }
  for (const sessionHeaders of [["Authorization"], ["x-forwarded-host"], ["origin"], ["__proto__"], ["authorization", "authorization"]]) assert.throws(() => discovery.validateNativeBuild({ ...build, sessionHeaders }), /native_invalid/);
});

test("missing builds return a native setup requirement; unknown apps and capabilities cannot allocate", async () => {
  const f = fixture();
  assert.equal((await f.begin()).status, "needs_native_build");
  assert.equal(f.scheduled.length, 0);
  await assert.rejects(f.begin("no-such-app"), /native_unknown_app/);
  await assert.rejects(f.begin(app, "invalid-token"), /native_unavailable/);
  assert.equal([...f.rows.values()].filter((r) => r.table === "connections").length, 0);
});

test("start is idempotent, one active phone per user and never overwrites web session or capture", async () => {
  const f = fixture();
  await f.register(); await f.register({ appSlug: "app_234567", buildId: "second-build" });
  const connectionId = f.seed("connections", { userId: f.userId, appSlug: app, status: "live", sessionJson: '{"headers":{"authorization":"PRIVATE_WEB_AUTH"}}', updatedAt: 1 });
  const captureId = f.seed("captures", { connectionId, entriesJson: "PRIVATE_WEB_CAPTURE" });
  const originalConnection = structuredClone(f.get(connectionId));
  const first = await f.begin(), again = await f.begin();
  assert.equal(first.jobId, again.jobId);
  assert.deepEqual(f.get(connectionId), originalConnection);
  assert.equal(f.get(captureId).entriesJson, "PRIVATE_WEB_CAPTURE");
  assert.equal((await f.begin("app_234567")).status, "native_job_in_progress");
  assert.equal(f.scheduled.filter((s) => s.name === "nativeDiscoveryActions:start").length, 1);
  assert.equal(f.scheduled.find((s) => s.name === "nativeDiscoveryActions:expire").delay, discovery.NATIVE_LEASE_MS);
  assert.equal((await f.begin(app, otherToken)).status, "starting");
});

test("ownership gates status, finish and private evidence and public status has no raw material", async () => {
  const f = fixture(), jobId = await f.running();
  for (const name of ["status", "requestFinish", "privateContext"]) await assert.rejects(api[name]._handler(f.ctx, { token: otherToken, jobId }), /native_unavailable/);
  await assert.rejects(api.status._handler(f.ctx, { token, jobId: "not-a-job" }), /native_unavailable/);
  Object.assign(f.get(jobId), { sessionJson: "PRIVATE_NATIVE_SESSION", sessionId: "PRIVATE_PROVIDER_ID", workflowRunId: "PRIVATE_WORKFLOW", buildId: "PRIVATE_BUILD" });
  const result = JSON.stringify(await api.status._handler(f.ctx, { token, jobId }));
  assert.ok(!result.includes("PRIVATE"));
  assert.ok(!result.includes("sessionJson"));
  assert.ok(!result.includes("workflowRunId"));
  assert.ok(result.includes("viewerUrl"));
});

test("atomic dispatch claims reject repeats and a revoked job refuses a newly allocated phone", async () => {
  const f = fixture(); await f.register();
  const { jobId } = await f.begin();
  assert.ok(await api.claimStart._handler(f.ctx, { jobId }));
  assert.equal(await api.claimStart._handler(f.ctx, { jobId }), null);
  f.get(jobId).expiresAt = Date.now() - 1;
  await api.expireJob._handler(f.ctx, { jobId });
  assert.equal(await api.attachSession._handler(f.ctx, { jobId, sessionId: "late_phone", workflowRunId: "late_run" }), false);
  assert.equal(f.get(jobId).status, "stopped");
});

test("finish collects once into private byte-bounded chunks and keeps ready evidence after phone lease", async () => {
  const f = fixture(), jobId = await f.running();
  assert.equal((await api.requestFinish._handler(f.ctx, { token, jobId })).status, "collecting");
  await api.requestFinish._handler(f.ctx, { token, jobId });
  assert.equal(f.scheduled.filter((s) => s.name === "nativeDiscoveryActions:collect").length, 1);
  assert.ok(await api.claimCollection._handler(f.ctx, { jobId }));
  assert.equal(await api.claimCollection._handler(f.ctx, { jobId }), null);
  const entries = Array.from({ length: 8 }, () => entry(JSON.stringify({ text: "é".repeat(20_000) })));
  const sessionJson = JSON.stringify({ capturedAt: Date.now(), headers: { authorization: "PRIVATE_NATIVE_AUTH" } });
  assert.equal(await api.saveCapture._handler(f.ctx, { jobId, entriesJson: JSON.stringify(entries), sessionJson, hasPartialCapture: true }), true);
  assert.equal(await api.saveCapture._handler(f.ctx, { jobId, entriesJson: JSON.stringify(entries), sessionJson, hasPartialCapture: true }), false);
  const privateContext = await api.privateContext._handler(f.ctx, { token, jobId });
  assert.equal(privateContext.job.sessionJson, sessionJson);
  assert.equal(privateContext.job.hasPartialCapture, true);
  assert.ok(privateContext.captures.length > 1);
  for (const chunk of privateContext.captures) assert.ok(Buffer.byteLength(chunk.entriesJson) <= discovery.NATIVE_CHUNK_BYTES);
  f.get(jobId).expiresAt = Date.now() - 1;
  assert.equal(await api.expireJob._handler(f.ctx, { jobId }), false);
  assert.equal((await api.status._handler(f.ctx, { token, jobId })).status, "ready");
  assert.ok(!JSON.stringify(await api.status._handler(f.ctx, { token, jobId })).includes("PRIVATE_NATIVE_AUTH"));
  f.get(jobId).captureExpiresAt = Date.now() - 1;
  await api.expireJob._handler(f.ctx, { jobId });
  assert.equal(f.get(jobId).sessionJson, undefined);
  assert.equal([...f.rows.values()].filter((r) => r.table === "nativeDiscoveryCaptures").length, 0);
  await assert.rejects(api.privateContext._handler(f.ctx, { token, jobId }), /native_evidence_unavailable/);
});

test("disconnect revokes capture access and collection completion cannot restore it", async () => {
  const f = fixture(), jobId = await f.running();
  await api.requestFinish._handler(f.ctx, { token, jobId });
  f.rows.delete(f.get(jobId).connectionId);
  assert.equal((await api.status._handler(f.ctx, { token, jobId })).status, "stopped");
  assert.equal(await api.saveCapture._handler(f.ctx, { jobId, entriesJson: JSON.stringify([entry()]), sessionJson: '{"capturedAt":1}', hasPartialCapture: false }), false);
  assert.equal(f.get(jobId).status, "stopped");
  assert.ok(f.scheduled.some((s) => s.name === "nativeDiscoveryActions:stop"));
});

test("broker rejects extra instructions, URLs and build overrides and sanitizes all failures", async () => {
  const f = fixture();
  for (const [operation, args] of [["native_start", { app, instruction: "send messages" }], ["native_start", { app, buildId: "attacker-build" }], ["native_finish", { jobId: "bad", url: "https://evil.acme.com" }], ["native_step", { instruction: "type password" }]]) {
    const result = JSON.parse(await action.tool._handler(f.actionCtx, { token, operation, argsJson: JSON.stringify(args) }));
    assert.equal(result.errorCode, "native_invalid_arguments");
  }
  const failCtx = { runMutation: async () => { throw new Error("PRIVATE_PROVIDER_URL PRIVATE_KEY"); } };
  const result = await action.tool._handler(failCtx, { token, operation: "native_start", argsJson: JSON.stringify({ app }) });
  assert.deepEqual(JSON.parse(result), { status: "error", errorCode: "native_unavailable" });
});

test("cloud startup persists allocation before navigation and uses a bounded fixed read-only exploration", async () => {
  const f = fixture(); await f.register(); const { jobId } = await f.begin();
  const calls: string[] = [];
  await withClientMethods({
    start: async (opts: any) => {
      assert.equal(opts.idleTimeoutSeconds, 120); assert.equal(opts.readyTimeoutMs, 90_000);
      await opts.onAllocated(nativeSession);
      assert.equal(f.get(jobId).sessionId, nativeSession.sessionId);
      calls.push("allocated"); return nativeSession;
    },
    launch: async (_session: unknown, pkg: string) => { assert.equal(pkg, build.packageName); calls.push("launch"); },
    step: async (_session: unknown, type: string, text: string, timeout: number) => {
      assert.equal(type, "instruction"); assert.match(text, /read-only/); assert.match(text, /Do not sign in/); assert.equal(timeout, 45_000); calls.push("step"); return { ok: true };
    },
    stop: async () => { calls.push("stop"); },
  }, async () => {
    await action.start._handler(f.actionCtx, { jobId });
    await action.start._handler(f.actionCtx, { jobId });
  });
  assert.deepEqual(calls, ["allocated", "launch", "step"]);
  assert.equal(f.get(jobId).status, "running");
});

test("collection stops before artifact retrieval, scopes origins, stores secrets privately, and marks partial evidence", async () => {
  const f = fixture(), jobId = await f.running(); await api.requestFinish._handler(f.ctx, { token, jobId });
  const calls: string[] = [];
  await withClientMethods({
    stop: async () => { calls.push("stop"); },
    getNetworkArtifact: async () => {
      calls.push("artifact");
      return { partial: true, requests: [{ url: `${origin}/api/items`, method: "GET", status_code: 200,
        request_headers: { authorization: "Bearer PRIVATE_NATIVE_TOKEN" }, response_headers: { "content-type": "application/json" },
        response_body_preview: '{"items":[]}', response_body_size: 12, response_body_truncated: false, hasBodyPreview: true }] };
    },
  }, async () => { await action.collect._handler(f.actionCtx, { jobId }); await action.collect._handler(f.actionCtx, { jobId }); });
  assert.deepEqual(calls, ["stop", "artifact"]);
  assert.equal(f.get(jobId).status, "ready"); assert.equal(f.get(jobId).hasPartialCapture, true);
  assert.ok(f.get(jobId).sessionJson.includes("PRIVATE_NATIVE_TOKEN"));
  assert.ok(!JSON.stringify(await api.status._handler(f.ctx, { token, jobId })).includes("PRIVATE_NATIVE_TOKEN"));
  const captures = [...f.rows.values()].filter((r) => r.table === "nativeDiscoveryCaptures");
  assert.ok(!JSON.stringify(captures).includes("PRIVATE_NATIVE_TOKEN"));
});

test("empty or failed artifacts never become ready and stop is always durably scheduled", async () => {
  for (const failure of [false, true]) {
    const f = fixture(), jobId = await f.running(); await api.requestFinish._handler(f.ctx, { token, jobId });
    await withClientMethods({ stop: async () => {}, getNetworkArtifact: async () => { if (failure) throw new Error("PRIVATE_SIGNED_URL PRIVATE_TOKEN"); return { requests: [], partial: false }; } },
      async () => { await action.collect._handler(f.actionCtx, { jobId }); });
    assert.equal(f.get(jobId).status, "error");
    assert.equal(f.get(jobId).captureCount, 0);
    assert.equal(f.get(jobId).sessionJson, undefined);
    assert.ok(f.scheduled.some((s) => s.name === "nativeDiscoveryActions:stop"));
    assert.ok(!JSON.stringify(await api.status._handler(f.ctx, { token, jobId })).includes("PRIVATE"));
  }
});

test("disconnect atomically tombstones ready jobs, clears credentials and schedules a cloud stop", async () => {
  const f = fixture(), jobId = await f.running();
  const job = f.get(jobId);
  job.status = "ready"; job.captureExpiresAt = Date.now() + 60_000; job.sessionJson = "PRIVATE_NATIVE_AUTH"; job.captureCount = 1;
  f.seed("nativeDiscoveryCaptures", { jobId, chunk: 0, entriesJson: "PRIVATE_CAPTURE", count: 1 });
  await discovery.revokeNativeForConnection(f.ctx as any, job.connectionId);
  assert.equal(job.status, "stopped"); assert.equal(job.captureCount, 0); assert.equal(job.sessionJson, undefined);
  assert.equal([...f.rows.values()].filter((r) => r.table === "nativeDiscoveryCaptures").length, 0);
  assert.ok(f.scheduled.some((s) => s.name === "nativeDiscoveryActions:stop"));
});

test("absent network artifacts report incomplete discovery instead of inventing API evidence", { timeout: 30_000 }, async () => {
  const f = fixture(), jobId = await f.running(); await api.requestFinish._handler(f.ctx, { token, jobId });
  let stops = 0, polls = 0;
  await withClientMethods({ stop: async () => { stops++; }, getNetworkArtifact: async () => { polls++; return null; } },
    async () => { await action.collect._handler(f.actionCtx, { jobId }); });
  assert.equal(stops, 1); assert.equal(polls, 4);
  assert.equal(f.get(jobId).status, "error"); assert.equal(f.get(jobId).errorCode, "native_missing_artifact");
  assert.equal(f.get(jobId).captureCount, 0);
  assert.equal([...f.rows.values()].filter((row) => row.table === "nativeDiscoveryCaptures").length, 0);
  await assert.rejects(api.privateContext._handler(f.ctx, { token, jobId }), /native_evidence_unavailable/);
});

test("repeating native_start reuses valid ready evidence for the current app build without paying for another phone", async () => {
  const f = fixture(), jobId = await f.running();
  await api.requestFinish._handler(f.ctx, { token, jobId });
  await api.saveCapture._handler(f.ctx, { jobId, entriesJson: JSON.stringify([entry()]), sessionJson: '{"capturedAt":1}', hasPartialCapture: false });
  f.get(jobId).expiresAt = Date.now() - 1;
  const starts = () => f.scheduled.filter((s) => s.name === "nativeDiscoveryActions:start").length;
  const originalStarts = starts();
  const again = await f.begin();
  assert.equal(again.jobId, jobId); assert.equal(again.status, "ready"); assert.equal(starts(), originalStarts);
  f.get(jobId).captureExpiresAt = Date.now() - 1;
  const renewed = await f.begin();
  assert.notEqual(renewed.jobId, jobId); assert.equal(renewed.status, "starting"); assert.equal(starts(), originalStarts + 1);
});

test("ready evidence for an older reviewed build does not substitute for the current build", async () => {
  const f = fixture(), jobId = await f.running();
  await api.requestFinish._handler(f.ctx, { token, jobId });
  await api.saveCapture._handler(f.ctx, { jobId, entriesJson: JSON.stringify([entry()]), sessionJson: '{"capturedAt":1}', hasPartialCapture: false });
  await f.register({ buildId: "new-admin-reviewed-build" });
  const newer = await f.begin();
  assert.notEqual(newer.jobId, jobId); assert.equal(newer.status, "starting");
  assert.equal(f.get(newer.jobId).buildId, "new-admin-reviewed-build");
});

test("provider stop acknowledgment clears cleanup identifiers, while failed attempts retain them", async () => {
  const f = fixture(), jobId = await f.running();
  await withClientMethods({ stop: async () => { throw new Error("provider unavailable"); } }, async () => { await action.stop._handler(f.actionCtx, { jobId }); });
  assert.equal(f.get(jobId).stopAttempts, 1);
  assert.equal(f.get(jobId).sessionId, nativeSession.sessionId);
  assert.equal(await api.confirmStopped._handler(f.ctx, { jobId, sessionId: "wrong-session", workflowRunId: nativeSession.workflowRunId }), false);
  assert.equal(f.get(jobId).sessionId, nativeSession.sessionId);
  await withClientMethods({ stop: async () => {} }, async () => { await action.stop._handler(f.actionCtx, { jobId }); });
  assert.equal(f.get(jobId).sessionId, undefined); assert.equal(f.get(jobId).workflowRunId, undefined);
  assert.equal(f.get(jobId).viewerUrl, undefined);
  assert.equal(await api.claimStop._handler(f.ctx, { jobId }), null);
});

test("account revocation scrubs captured credentials including orphan jobs and leaves reviewed global builds", async () => {
  const f = fixture(), jobId = await f.running();
  const job = f.get(jobId);
  job.status = "ready"; job.sessionJson = "PRIVATE_NATIVE_AUTH"; job.captureCount = 1; job.captureExpiresAt = Date.now() + 60_000;
  f.seed("nativeDiscoveryCaptures", { jobId, chunk: 0, entriesJson: "PRIVATE_CAPTURE", count: 1 });
  const orphan = f.seed("nativeDiscoveryJobs", { userId: f.userId, connectionId: "connections:missing", appSlug: app, buildId: build.buildId,
    status: "ready", sessionJson: "PRIVATE_ORPHAN_AUTH", captureCount: 1, createdAt: 1, updatedAt: 1, expiresAt: 2, captureExpiresAt: Date.now() + 60_000 });
  f.seed("nativeDiscoveryCaptures", { jobId: orphan, chunk: 0, entriesJson: "PRIVATE_ORPHAN_CAPTURE", count: 1 });
  await discovery.revokeNativeForUser(f.ctx as any, f.userId as Id<"users">);
  assert.equal(f.get(jobId).status, "stopped"); assert.equal(f.get(jobId).sessionJson, undefined);
  assert.equal(f.get(orphan).sessionJson, undefined);
  assert.equal([...f.rows.values()].filter((r) => r.table === "nativeDiscoveryCaptures").length, 0);
  assert.equal([...f.rows.values()].filter((r) => r.table === "nativeAppBuilds").length, 1);
  assert.ok(f.scheduled.some((s) => s.name === "nativeDiscovery:cleanupDetachedJob" && s.args.jobId === orphan));
  f.rows.delete(f.userId); f.rows.delete(job.connectionId);
  await api.cleanupDetachedJob._handler(f.ctx, { jobId });
  assert.equal(f.get(jobId).sessionId, nativeSession.sessionId);
  assert.equal(f.get(jobId).workflowRunId, nativeSession.workflowRunId);
  assert.equal(await api.cleanupDetachedJob._handler(f.ctx, { jobId: orphan }), true);
  assert.equal(f.get(orphan), undefined);
  assert.ok(!JSON.stringify([...f.rows.values()]).includes("PRIVATE_"));
});

test("detached allocation retains a tombstone and late stop IDs until acknowledgment and the lease end", async () => {
  const f = fixture(); await f.register(); const { jobId } = await f.begin();
  await api.claimStart._handler(f.ctx, { jobId });
  const connectionId = f.get(jobId).connectionId;
  await discovery.revokeNativeForUser(f.ctx as any, f.userId as Id<"users">);
  f.rows.delete(f.userId); f.rows.delete(connectionId);
  assert.equal(await api.cleanupDetachedJob._handler(f.ctx, { jobId }), false);
  assert.ok(f.get(jobId));
  assert.ok(f.scheduled.some((s) => s.name === "nativeDiscovery:cleanupDetachedJob" && s.delay > 0 && s.delay <= discovery.NATIVE_LEASE_MS + 1));
  assert.equal(await api.attachSession._handler(f.ctx, { jobId, sessionId: nativeSession.sessionId, workflowRunId: nativeSession.workflowRunId }), false);
  assert.equal(f.get(jobId).sessionId, nativeSession.sessionId);
  await api.confirmStopped._handler(f.ctx, { jobId, sessionId: nativeSession.sessionId, workflowRunId: nativeSession.workflowRunId });
  assert.ok(f.get(jobId)); assert.equal(f.get(jobId).sessionId, undefined);
  f.get(jobId).expiresAt = Date.now() - 1;
  assert.equal(await api.cleanupDetachedJob._handler(f.ctx, { jobId }), true);
  assert.equal(f.get(jobId), undefined);
});

test("detached cleanup never removes attached jobs or invents acknowledgment after exhausted stop retries", async () => {
  const f = fixture(), jobId = await f.running();
  assert.equal(await api.cleanupDetachedJob._handler(f.ctx, { jobId }), false);
  assert.equal(f.get(jobId).status, "running");
  f.get(jobId).sessionJson = "PRIVATE_NATIVE_AUTH";
  f.seed("nativeDiscoveryCaptures", { jobId, chunk: 0, entriesJson: "PRIVATE_CAPTURE", count: 1 });
  f.rows.delete(f.userId);
  f.get(jobId).expiresAt = Date.now() - 1;
  f.get(jobId).stopAttempts = 2;
  await withClientMethods({ stop: async () => { throw new Error("provider unavailable"); } }, async () => { await action.stop._handler(f.actionCtx, { jobId }); });
  const job = f.get(jobId);
  assert.ok(job); assert.equal(job.status, "stopped"); assert.equal(job.errorCode, "native_stop_unconfirmed");
  assert.equal(job.stopAttempts, 3); assert.equal(job.sessionId, nativeSession.sessionId); assert.equal(job.workflowRunId, nativeSession.workflowRunId);
  assert.equal(job.sessionJson, undefined); assert.equal(job.viewerUrl, undefined);
  assert.equal([...f.rows.values()].filter((r) => r.table === "nativeDiscoveryCaptures").length, 0);
  assert.equal(await api.claimStop._handler(f.ctx, { jobId }), null);
  await api.confirmStopped._handler(f.ctx, { jobId, sessionId: nativeSession.sessionId, workflowRunId: nativeSession.workflowRunId });
  assert.equal(f.get(jobId), undefined);
});

test("late allocation for an expired starting lease is retained and stopped before the expiry scheduler runs", async () => {
  const f = fixture(); await f.register(); const { jobId } = await f.begin();
  await api.claimStart._handler(f.ctx, { jobId });
  f.get(jobId).expiresAt = Date.now() - 1;
  assert.equal(f.get(jobId).status, "starting");
  assert.equal(await api.attachSession._handler(f.ctx, { jobId, sessionId: nativeSession.sessionId, workflowRunId: nativeSession.workflowRunId }), false);
  const job = f.get(jobId);
  assert.equal(job.status, "stopped"); assert.equal(job.errorCode, "native_expired");
  assert.equal(job.sessionId, nativeSession.sessionId); assert.equal(job.workflowRunId, nativeSession.workflowRunId);
  assert.equal(job.viewerUrl, undefined);
  assert.ok(f.scheduled.some((s) => s.name === "nativeDiscoveryActions:stop" && s.args.jobId === jobId));
  assert.equal((await api.claimStop._handler(f.ctx, { jobId })).sessionId, nativeSession.sessionId);
});
