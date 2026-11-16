/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import * as functions from "../../convex/marketplace";
import { epoch } from "../../convex/lib/learningPolicy";
import { capturedWriteSchema } from "../../convex/lib/learnedWritePolicy";
import { context as mcpContext } from "../../convex/mcpData";
import { context as learningContext, list as learnedList } from "../../convex/appLearning";
import { request as requestWrite, claimExecution } from "../../convex/appLearningWrites";

const api = functions as unknown as Record<string, any>;
const token = "owner-marketplace-capability";
const otherToken = "other-marketplace-capability";
const manifest = JSON.stringify([{ name: "ask_question", description: "Read public documentation", inputSchemaJson: '{"type":"object","properties":{}}' }]);
function fixture() {
  let next = 0;
  const rows = new Map<string, any>();
  const seed = (table: string, fields: Record<string, unknown>) => {
    const id = `${table}:${++next}`; rows.set(id, { ...structuredClone(fields), _id: id, _creationTime: next, table }); return id;
  };
  const owner = seed("users", { mcpToken: token });
  const other = seed("users", { mcpToken: otherToken });
  const scheduled: unknown[] = [];
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
      const range = { eq(key: string, value: unknown) { filters.push([key, value]); return range; } };
      const selected = () => [...rows.values()].filter((row) => row.table === table && filters.every(([key, value]) => row[key] === value))
        .sort((a, b) => direction * (a._creationTime - b._creationTime)).map((row) => structuredClone(row));
      const q = {
        withIndex(_name: string, build: (q: typeof range) => unknown) { build(range); return q; },
        order(order: string) { direction = order === "desc" ? -1 : 1; return q; },
        collect: async () => selected(), take: async (count: number) => selected().slice(0, count), first: async () => selected()[0] ?? null,
        unique: async () => { const matches = selected(); assert.ok(matches.length <= 1); return matches[0] ?? null; },
      };
      return q;
    },
  };
  const ctx = { db, scheduler: { runAfter: async (delay: number, ref: Parameters<typeof getFunctionName>[0], args: unknown) => { scheduled.push({ delay, name: getFunctionName(ref), args }); return "scheduled"; } } };
  const begin = (pluginId = "mcp:deepwiki", mode = "install", capability = token) => api.begin._handler(ctx, { token: capability, pluginId, mode });
  const installation = (pluginId = "mcp:deepwiki", user = owner) => [...rows.values()].find((row) => row.table === "pluginInstallations" && row.userId === user && row.pluginId === pluginId);
  const complete = (attempt: { epoch: string }, extra: Record<string, unknown> = {}) => api.complete._handler(ctx, { token, pluginId: "mcp:deepwiki", epoch: attempt.epoch, toolsJson: manifest, ...extra });
  const connect = (fields: Record<string, unknown> = {}) => seed("connections", { userId: owner, appSlug: "cronometer", status: "live",
    sessionJson: '{"capturedAt":1,"cookies":{"sid":"PRIVATE_APP_SESSION"}}', createdAt: 1, updatedAt: 1, ...fields });
  return { ctx, rows, seed, owner, other, begin, installation, complete, connect, scheduled };
}

test("marketplace APIs require the exact capability and expose both curated source kinds", async () => {
  const f = fixture();
  for (const name of ["list", "get", "installed", "context", "begin", "nativeTools", "deactivate"]) {
    await assert.rejects(api[name]._handler(f.ctx, { token: "unknown-marketplace-capability", pluginId: "mcp:deepwiki", mode: "install" }), /session is unavailable/);
  }
  const catalog = await api.list._handler(f.ctx, { token });
  assert.ok(catalog.some((item: any) => item.id === "yuzu:cronometer" && item.kind === "yuzu"));
  assert.ok(catalog.some((item: any) => item.id === "mcp:deepwiki" && item.kind === "mcp" && item.auth === "none"));
  assert.ok(catalog.some((item: any) => item.id === "mcp:github" && item.readOnly));
  assert.equal(await api.get._handler(f.ctx, { token, pluginId: "mcp:arbitrary-user-url" }), null);
  assert.ok((await api.list._handler(f.ctx, { token, kind: "mcp", query: "context7" })).every((item: any) => item.id === "mcp:context7"));
  assert.equal(f.rows.size, 2);
});

test("installing an existing Yuzu app preserves its live connection and all private session state", async () => {
  const f = fixture();
  const id = f.connect({ recipeVersion: 99, authCacheJson: '{"PRIVATE_AUTH_CACHE":true}' });
  const before = structuredClone(f.rows.get(id));
  const first = await f.begin("yuzu:cronometer");
  assert.equal(first.status, "installed");
  assert.deepEqual(f.rows.get(id), before);
  const again = await f.begin("yuzu:cronometer");
  assert.equal(again.reused, true);
  assert.equal(again.epoch, first.epoch);
  assert.deepEqual(f.rows.get(id), before);
  assert.equal([...f.rows.values()].filter((row) => row.table === "connections").length, 1);
  assert.equal([...f.rows.values()].filter((row) => row.table === "pluginInstallations").length, 1);
});

test("Yuzu install creates only a missing owned connection and never adopts another user's app session", async () => {
  const f = fixture(); const foreign = f.connect({ userId: f.other });
  const beforeForeign = structuredClone(f.rows.get(foreign));
  const first = await f.begin("yuzu:cronometer");
  assert.equal(first.status, "needs_connection");
  const owned = [...f.rows.values()].filter((row) => row.table === "connections" && row.userId === f.owner);
  assert.equal(owned.length, 1); assert.equal(owned[0].status, "needs_login"); assert.equal(owned[0].sessionJson, undefined);
  await f.begin("yuzu:cronometer");
  assert.equal([...f.rows.values()].filter((row) => row.table === "connections" && row.userId === f.owner).length, 1);
  assert.deepEqual(f.rows.get(foreign), beforeForeign);
});

test("a stale installed Yuzu record recreates a connection only after the old connection disappeared", async () => {
  const f = fixture(); const original = f.connect();
  await f.begin("yuzu:cronometer");
  f.rows.delete(original);
  const next = await f.begin("yuzu:cronometer");
  assert.equal(next.status, "needs_connection");
  const owned = [...f.rows.values()].filter((row) => row.table === "connections" && row.userId === f.owner);
  assert.equal(owned.length, 1); assert.notEqual(owned[0]._id, original); assert.equal(owned[0].status, "needs_login");
});

test("repeated external install reuses in-flight discovery rather than superseding its own completion", async () => {
  const f = fixture();
  const first = await f.begin();
  assert.equal(first.status, "connecting");
  const duplicate = await f.begin();
  assert.equal(duplicate.reused, true);
  assert.equal(duplicate.epoch, first.epoch);
  assert.equal(await f.complete(first), true);
  const installed = await f.begin();
  assert.equal(installed.reused, true); assert.equal(installed.epoch, first.epoch);
  assert.equal((await api.get._handler(f.ctx, { token, pluginId: "mcp:deepwiki" })).state, "installed");
});

test("key-required plugins stay pending until explicit connect and public APIs never return sealed or raw secrets", async () => {
  const f = fixture();
  const start = await f.begin("mcp:github");
  assert.equal(start.status, "needs_connection");
  const next = await f.begin("mcp:github", "connect");
  assert.equal(next.status, "connecting");
  assert.equal(await f.complete(next, { pluginId: "mcp:github", credentialsCipher: "PRIVATE_SEALED_KEY", toolsJson: '[{"name":"get_me","PRIVATE_METADATA":"not public"}]' }), true);
  const live = f.connect();
  const outputs = [await api.list._handler(f.ctx, { token }), await api.installed._handler(f.ctx, { token }), await api.get._handler(f.ctx, { token, pluginId: "mcp:github" })];
  for (const value of outputs) {
    const json = JSON.stringify(value);
    for (const hidden of ["PRIVATE_SEALED_KEY", "PRIVATE_METADATA", "PRIVATE_APP_SESSION", "credentialsCipher", "sessionJson", token, live]) assert.ok(!json.includes(hidden), hidden);
  }
  assert.equal((await api.get._handler(f.ctx, { token, pluginId: "mcp:github" })).state, "installed");
});

test("uninstall rotates the epoch, wipes credentials/manifests and prevents late completion or failure resurrection", async () => {
  const f = fixture(); const first = await f.begin();
  await api.deactivate._handler(f.ctx, { token, pluginId: "mcp:deepwiki" });
  const removed = structuredClone(f.installation());
  assert.equal(removed.status, "uninstalled"); assert.notEqual(removed.epoch, first.epoch);
  assert.equal(removed.credentialsCipher, undefined); assert.equal(removed.toolsJson, undefined);
  assert.equal(await f.complete(first, { credentialsCipher: "PRIVATE_LATE_KEY" }), false);
  assert.equal(await api.fail._handler(f.ctx, { token, pluginId: "mcp:deepwiki", epoch: first.epoch, code: "unavailable" }), false);
  assert.deepEqual(f.installation(), removed);
  assert.equal((await api.get._handler(f.ctx, { token, pluginId: "mcp:deepwiki" })).state, "not_installed");
  assert.ok(!(await api.installed._handler(f.ctx, { token })).some((item: any) => item.id === "mcp:deepwiki"));
});

test("a newer explicit connect attempt rejects stale completion/failure and accepts only its current epoch", async () => {
  const f = fixture(); const old = await f.begin("mcp:github", "connect");
  const current = await f.begin("mcp:github", "connect");
  assert.notEqual(old.epoch, current.epoch);
  assert.equal(await f.complete(old, { pluginId: "mcp:github", credentialsCipher: "PRIVATE_OLD_KEY" }), false);
  assert.equal(await api.fail._handler(f.ctx, { token, pluginId: "mcp:github", epoch: old.epoch, code: "authentication_required" }), false);
  assert.equal(await f.complete(current, { pluginId: "mcp:github", credentialsCipher: "PRIVATE_CURRENT_KEY" }), true);
  assert.equal(f.installation("mcp:github").credentialsCipher, "PRIVATE_CURRENT_KEY");
});

test("valid other-user capabilities can affect only their own installation lifecycle", async () => {
  const f = fixture(); const original = await f.begin(); await f.complete(original);
  const before = structuredClone(f.installation());
  assert.equal(await f.complete(original, { token: otherToken, credentialsCipher: "PRIVATE_FORGED_KEY" }), false);
  await f.begin("mcp:deepwiki", "install", otherToken);
  await api.deactivate._handler(f.ctx, { token: otherToken, pluginId: "mcp:deepwiki" });
  assert.deepEqual(f.installation(), before);
  assert.equal(f.installation("mcp:deepwiki", f.other).status, "uninstalled");
});

test("native uninstall clears only owned app grants and queued calls and revokes tool access immediately", async () => {
  const f = fixture(); const connection = f.connect(); await f.begin("yuzu:cronometer");
  const grant = f.seed("approvalGrants", { userId: f.owner, appSlug: "cronometer" });
  const otherGrant = f.seed("approvalGrants", { userId: f.other, appSlug: "cronometer" });
  const otherAppGrant = f.seed("approvalGrants", { userId: f.owner, appSlug: "duolingo" });
  const queued = f.seed("calls", { userId: f.owner, appSlug: "cronometer", status: "queued" });
  const done = f.seed("calls", { userId: f.owner, appSlug: "cronometer", status: "done" });
  const foreign = f.seed("calls", { userId: f.other, appSlug: "cronometer", status: "queued" });
  const otherApp = f.seed("calls", { userId: f.owner, appSlug: "duolingo", status: "queued" });
  const capture = f.seed("captures", { connectionId: connection, entriesJson: "PRIVATE_CAPTURE_DATA" });
  const build = f.seed("builds", { connectionId: connection, status: "running" });
  const approval = f.seed("approvals", { userId: f.owner, connectionId: connection, status: "pending" });
  const otherApproval = f.seed("approvals", { userId: f.owner, connectionId: "other-connection", status: "pending" });
  assert.deepEqual(await api.deactivate._handler(f.ctx, { token, pluginId: "yuzu:cronometer" }), { connectionId: connection });
  assert.ok(!f.rows.has(grant)); assert.ok(f.rows.has(otherGrant)); assert.ok(f.rows.has(otherAppGrant));
  assert.equal(f.rows.get(queued).status, "expired"); assert.equal(f.rows.get(done).status, "done");
  assert.equal(f.rows.get(foreign).status, "queued"); assert.equal(f.rows.get(otherApp).status, "queued");
  assert.ok(!f.rows.has(connection)); assert.ok(!f.rows.has(capture)); assert.ok(!f.rows.has(build));
  assert.equal(f.rows.get(approval).status, "denied"); assert.equal(f.rows.get(otherApproval).status, "pending");
  await assert.rejects(api.nativeTools._handler(f.ctx, { token, pluginId: "yuzu:cronometer" }), /Connect this plugin/);
  const reinstalled = await f.begin("yuzu:cronometer");
  assert.equal(reinstalled.status, "needs_connection");
  const fresh = [...f.rows.values()].find((row) => row.table === "connections" && row.userId === f.owner && row.appSlug === "cronometer");
  assert.ok(fresh); assert.notEqual(fresh._id, connection); assert.equal(fresh.status, "needs_login");
});

test("private learned listings and tools remain owner-only and uninstall denies only their pending intents", async () => {
  const f = fixture(); const connection = f.connect();
  const sessionEpoch = await epoch(f.rows.get(connection).sessionJson);
  const evidence = f.seed("appLearningEvidence", { userId: f.owner, appSlug: "cronometer", origin: "https://cronometer.com", connectionId: connection,
    sessionEpoch, expiresAt: Date.now() + 60_000 });
  const tool = f.seed("appLearnedTools", { userId: f.owner, evidenceId: evidence, appSlug: "cronometer", title: "PRIVATE_OWN_TOOL", name: "read_diary", status: "published", kind: "read",
    inputSchemaJson: '{"type":"object","properties":{"$ref":{"type":"string"}}}' });
  f.seed("appLearnedTools", { userId: f.other, evidenceId: evidence, appSlug: "cronometer", title: "PRIVATE_FOREIGN_TOOL", name: "read_other", status: "published" });
  const pluginId = `learned:${tool}`;
  const own = await api.get._handler(f.ctx, { token, pluginId });
  assert.equal(own.visibility, "private"); assert.equal(own.state, "installed");
  assert.equal(await api.get._handler(f.ctx, { token: otherToken, pluginId }), null);
  await assert.rejects(f.begin(pluginId, "install", otherToken), /unavailable/);
  const metadata = await api.nativeTools._handler(f.ctx, { token, pluginId });
  assert.equal(metadata[0].toolId, tool); assert.equal(typeof metadata[0].inputSchemaJson, "string");
  const intent = f.seed("appLearnedWrites", { userId: f.owner, toolId: tool });
  const pending = f.seed("approvals", { userId: f.owner, status: "pending", learnedWriteId: intent });
  const unrelated = f.seed("approvals", { userId: f.other, status: "pending", learnedWriteId: intent });
  await api.deactivate._handler(f.ctx, { token, pluginId });
  assert.equal(f.rows.get(pending).status, "denied"); assert.equal(f.rows.get(unrelated).status, "pending");
  await assert.rejects(api.nativeTools._handler(f.ctx, { token, pluginId }), /Connect this plugin/);
  await assert.rejects((learningContext as any)._handler(f.ctx, { token, toolId: tool }), /Private tool removed/);
  assert.deepEqual(await (learnedList as any)._handler(f.ctx, { token }), []);
  assert.ok(!JSON.stringify(await api.list._handler(f.ctx, { token })).includes("PRIVATE_FOREIGN_TOOL"));
});

test("provider failures publish only bounded error codes and never raw details", async () => {
  const f = fixture(); const start = await f.begin();
  assert.equal(await api.fail._handler(f.ctx, { token, pluginId: "mcp:deepwiki", epoch: start.epoch, code: "PRIVATE_RAW_PROVIDER_ERROR" }), true);
  const item = await api.get._handler(f.ctx, { token, pluginId: "mcp:deepwiki" });
  assert.equal(item.errorCode, "unavailable");
  assert.ok(!JSON.stringify(item).includes("PRIVATE_RAW_PROVIDER_ERROR"));
});

test("an expired private listing can still be uninstalled without exposing or reviving the tool", async () => {
  const f = fixture();
  const evidence = f.seed("appLearningEvidence", { userId: f.owner, appSlug: "cronometer", origin: "https://cronometer.com", expiresAt: Date.now() - 1 });
  const tool = f.seed("appLearnedTools", { userId: f.owner, evidenceId: evidence, appSlug: "cronometer", title: "Expired private tool", name: "read_old", status: "published" });
  const pluginId = `learned:${tool}`;
  f.seed("pluginInstallations", { userId: f.owner, pluginId, epoch: "old-private-epoch", version: "1", status: "installed", installedAt: 1, updatedAt: 1 });
  assert.equal(await api.get._handler(f.ctx, { token, pluginId }), null);
  await assert.rejects(api.deactivate._handler(f.ctx, { token: otherToken, pluginId }), /unavailable/);
  await api.deactivate._handler(f.ctx, { token, pluginId });
  assert.equal(f.installation(pluginId).status, "uninstalled");
  assert.equal(await api.get._handler(f.ctx, { token, pluginId }), null);
  await assert.rejects(api.nativeTools._handler(f.ctx, { token, pluginId }), /Connect this plugin/);
});

test("stalled external install is reclaimed after the reuse window and cannot revive its expired epoch", async (t) => {
  const f = fixture(); let now = 1_000_000; t.mock.method(Date, "now", () => now);
  const old = await f.begin();
  assert.equal((await f.begin()).epoch, old.epoch);
  now += 120_000;
  const retry = await f.begin();
  assert.equal(retry.reused, false); assert.notEqual(retry.epoch, old.epoch);
  assert.equal(await f.complete(old), false);
  assert.equal(await f.complete(retry), true);
});

test("Yuzu tombstones gate both authenticated and sessionless MCP tool discovery per owner", async () => {
  const f = fixture(); f.connect(); f.connect({ userId: f.other });
  f.seed("recipes", { appSlug: "parkmobile", version: 999, status: "verified", json: JSON.stringify({ appSlug: "parkmobile", version: 999, status: "verified",
    auth: { type: "none", sessionKeys: [] }, tools: [{ name: "marketplace_public_lookup", public: true, kind: "read", inputSchema: { type: "object", properties: {} } }],
    provenance: { compiler: "hand" } }) });
  const before = await (mcpContext as any)._handler(f.ctx, { token });
  assert.ok(before.live.some((row: any) => row.conn.appSlug === "cronometer"));
  assert.ok(before.publicRecipes.some((row: any) => row.appSlug === "parkmobile"));
  await api.deactivate._handler(f.ctx, { token, pluginId: "yuzu:cronometer" });
  await api.deactivate._handler(f.ctx, { token, pluginId: "yuzu:parkmobile" });
  f.connect(); // An old app login flow must not bypass the marketplace tombstone.
  const removed = await (mcpContext as any)._handler(f.ctx, { token });
  assert.ok(!removed.live.some((row: any) => row.conn.appSlug === "cronometer"));
  assert.ok(!removed.publicRecipes.some((row: any) => row.appSlug === "parkmobile"));
  const other = await (mcpContext as any)._handler(f.ctx, { token: otherToken });
  assert.ok(other.live.some((row: any) => row.conn.appSlug === "cronometer"));
  assert.ok(other.publicRecipes.some((row: any) => row.appSlug === "parkmobile"));
});

test("private learned-write uninstall blocks new intents and already-approved dispatch through the actual gate", async () => {
  const f = fixture(); const connection = f.connect();
  const sessionEpoch = await epoch(f.rows.get(connection).sessionJson);
  const schema = capturedWriteSchema('{"note":"PRIVATE_CAPTURE_VALUE"}');
  const evidence = f.seed("appLearningEvidence", { userId: f.owner, appSlug: "cronometer", origin: "https://cronometer.com", url: "https://cronometer.com/api/diary", kind: "write_endpoint",
    method: "POST", requestSchemaJson: schema, connectionId: connection, sessionEpoch, headerNames: [], createdAt: Date.now(), expiresAt: Date.now() + 60_000 });
  const tool = f.seed("appLearnedTools", { userId: f.owner, evidenceId: evidence, appSlug: "cronometer", title: "Save note", name: "save_note", kind: "write", status: "published", inputSchemaJson: schema });
  const args = { token, toolId: tool, argsJson: '{"note":"new note"}', requestId: "marketplace-request-a" };
  const staged = await (requestWrite as any)._handler(f.ctx, args);
  assert.equal(staged.status, "approval_required");
  Object.assign(f.rows.get(staged.approvalId), { status: "approved", runState: "running" });
  await api.deactivate._handler(f.ctx, { token, pluginId: `learned:${tool}` });
  await assert.rejects((requestWrite as any)._handler(f.ctx, { ...args, requestId: "marketplace-request-b" }), /Private tool removed/);
  await assert.rejects((claimExecution as any)._handler(f.ctx, { approvalId: staged.approvalId }), /Private tool removed/);
  const intent = [...f.rows.values()].find((row) => row.table === "appLearnedWrites" && row.approvalId === staged.approvalId);
  assert.equal(intent.dispatchedAt, undefined);
  assert.equal([...f.rows.values()].filter((row) => row.table === "appLearnedWrites").length, 1);
});
