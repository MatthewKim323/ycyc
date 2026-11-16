/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import * as learning from "../../convex/appLearning";
import * as writes from "../../convex/appLearningWrites";
import * as native from "../../convex/nativeDiscovery";
import { readOperation } from "../../convex/learningResearch";
import { capturedAppOrigin, epoch } from "../../convex/lib/learningPolicy";
import { evidenceSession } from "../../convex/lib/learningSession";

const api = learning as unknown as Record<string, any>;
const writeApi = writes as unknown as Record<string, any>;
const nativeApi = native as unknown as Record<string, any>;
const app = "app_upgrade";
const token = "owner-learning-upgrade-capability";
const otherToken = "other-learning-upgrade-capability";
const webOrigin = "https://www.example.com";
const apiOrigin = "https://api.example.com";
const query = "query FindItems($term: String!) { items(term: $term) { id name } }";
const fullBody = JSON.stringify({ query, operationName: "FindItems", variables: { term: "PRIVATE_CAPTURED_SEARCH" } });
const opaqueBody = JSON.stringify({ operationName: "AddItem", extensions: { persistedQuery: { version: 1, sha256Hash: "a".repeat(64) } }, variables: { name: "PRIVATE_CAPTURED_NAME" } });
const webSession = JSON.stringify({ capturedAt: 1, headers: { authorization: "Bearer PRIVATE_WEB_AUTH" }, cookies: { sid: "PRIVATE_WEB_COOKIE" } });
const nativeSession = JSON.stringify({ capturedAt: 2, headers: { authorization: "Bearer PRIVATE_NATIVE_AUTH" } });
function entry(body = fullBody, overrides = {}) {
  return { id: "capture-1", ts: 100, method: "POST", url: `${apiOrigin}/graphql`, status: 200,
    reqHeaders: { authorization: "<redacted:authorization>", "content-type": "application/json" },
    reqBody: body, resBody: '{"data":{"items":[{"id":"PRIVATE_ITEM_ID","name":"PRIVATE_ITEM_NAME"}]}}', initiator: "fetch", ...overrides };
}
function fixture(withWebsite = true) {
  let next = 0;
  const rows = new Map<string, any>();
  const seed = (table: string, value: object) => { const id = `${table}:${++next}`; rows.set(id, { ...structuredClone(value), table, _id: id, _creationTime: next }); return id; };
  const userId = seed("users", { mcpToken: token });
  const otherId = seed("users", { mcpToken: otherToken });
  seed("discoveredApps", { slug: app, name: "Example App", webOrigin, loginUrl: `${webOrigin}/login` });
  const connectionId = seed("connections", { userId, appSlug: app, status: "capturing", sessionJson: webSession });
  const entries = [entry()];
  const calls: { name: string; args: any }[] = [], scheduled: { name: string; args: any }[] = [];
  const db = {
    get: async (id: string) => structuredClone(rows.get(id) ?? null),
    normalizeId: (table: string, id: string) => id.startsWith(`${table}:`) ? id : null,
    insert: async (table: string, value: object) => seed(table, value),
    delete: async (id: string) => { rows.delete(id); },
    patch: async (id: string, value: object) => {
      for (const [key, field] of Object.entries(value)) {
        if (field === undefined) delete rows.get(id)[key]; else rows.get(id)[key] = structuredClone(field);
      }
    },
    query(table: string) {
      const predicates: ((row: any) => boolean)[] = [];
      let direction = 1;
      const index = { eq(key: string, value: unknown) { predicates.push((row) => row[key] === value); return index; } };
      const filter = { field: (key: string) => key, eq: (key: string, value: unknown) => (row: any) => row[key] === value };
      const selected = () => [...rows.values()].filter((row) => row.table === table && predicates.every((fn) => fn(row)))
        .sort((a, b) => direction * (a._creationTime - b._creationTime)).map((row) => structuredClone(row));
      const q = {
        withIndex(_name: string, fn: (value: typeof index) => unknown) { fn(index); return q; },
        filter(fn: (value: typeof filter) => (row: any) => boolean) { predicates.push(fn(filter)); return q; },
        order(value: string) { direction = value === "desc" ? -1 : 1; return q; },
        take: async (limit: number) => selected().slice(0, limit), collect: async () => selected(), first: async () => selected()[0] ?? null,
        unique: async () => { const found = selected(); assert.ok(found.length <= 1); return found[0] ?? null; },
      }; return q;
    },
  };
  const ctx = { db, scheduler: { runAfter: async (_delay: number, ref: Parameters<typeof getFunctionName>[0], args: unknown) => { scheduled.push({ name: getFunctionName(ref), args }); return "scheduled"; } } };
  let respond = async (name: string, _args: any): Promise<any> => {
    assert.equal(name, "learningResearch:readOperation");
    return { status: 200, text: '{"data":{"items":[{"id":"LIVE_PRIVATE_RESULT"}]}}' };
  };
  const actionCtx = {
    runQuery: async (ref: Parameters<typeof getFunctionName>[0], args: any): Promise<any> => {
      const name = getFunctionName(ref);
      if (name.startsWith("appLearning:")) return api[name.split(":")[1]]._handler(ctx, args);
      if (name.startsWith("nativeDiscovery:")) return nativeApi[name.split(":")[1]]._handler(ctx, args);
      if (name === "apps:resolve") return { slug: app, name: "Example App", ...(withWebsite ? { webOrigin } : {}) };
      if (name === "connections:captureEntries") { assert.equal(args.connectionId, connectionId); return structuredClone(entries); }
      assert.fail(`unexpected query ${name}`);
    },
    runMutation: async (ref: Parameters<typeof getFunctionName>[0], args: any): Promise<any> => {
      const name = getFunctionName(ref); calls.push({ name, args });
      const handlers = name.startsWith("appLearning:") ? api : name.startsWith("appLearningWrites:") ? writeApi : null;
      assert.ok(handlers, `unexpected mutation ${name}`);
      return handlers[name.split(":")[1]]._handler(ctx, args);
    },
    runAction: async (ref: Parameters<typeof getFunctionName>[0], args: any): Promise<any> => {
      const name = getFunctionName(ref); calls.push({ name, args }); return respond(name, args);
    },
  };
  const tool = async (operation: string, args: object, capability = token) => JSON.parse(await api.tool._handler(actionCtx, { token: capability, operation, argsJson: JSON.stringify(args) }));
  const inspect = (args = {}) => tool("inspect_app_capture", { app, ...args });
  const build = (evidenceId: string, kind?: "write") => tool("build_app_tool", { app, evidenceId, name: kind ? "change_item" : "read_items", title: kind ? "Change item" : "Read items", responsePath: "", ...(kind ? { kind } : {}) });
  const readyNative = () => {
    seed("nativeAppBuilds", { appSlug: app, buildId: "approved-build", approvedOrigins: [apiOrigin], sessionHeaders: ["authorization"] });
    const jobId = seed("nativeDiscoveryJobs", { userId, connectionId, appSlug: app, buildId: "approved-build", status: "ready", sessionJson: nativeSession, captureExpiresAt: Date.now() + 60_000 });
    seed("nativeDiscoveryCaptures", { userId, jobId, chunk: 0, entriesJson: JSON.stringify(entries) });
    return jobId;
  };
  return { rows, seed, ctx, actionCtx, userId, otherId, connectionId, entries, calls, scheduled, tool, inspect, build, readyNative, setResponse: (fn: typeof respond) => { respond = fn; } };
}

function noPrivate(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of [token, "PRIVATE_WEB_AUTH", "PRIVATE_WEB_COOKIE", "PRIVATE_NATIVE_AUTH", "PRIVATE_CAPTURED_SEARCH", "PRIVATE_CAPTURED_NAME", "PRIVATE_ITEM_ID", "PRIVATE_ITEM_NAME"]) assert.ok(!text.includes(secret), secret);
}

test("captured API origin matches registrable ownership including co.uk and private suffix tenant boundaries", () => {
  assert.equal(capturedAppOrigin("https://api.example.com/graphql", "https://www.example.com"), "https://api.example.com");
  assert.equal(capturedAppOrigin("https://api.example.co.uk/graphql", "https://www.example.co.uk"), "https://api.example.co.uk");
  assert.equal(capturedAppOrigin("https://api.tenant.vercel.app/graphql", "https://tenant.vercel.app"), "https://api.tenant.vercel.app");
  for (const [raw, origin] of [["https://api.example.org/graphql", webOrigin], ["https://api.example.com.evil.com/graphql", webOrigin],
    ["https://example.co.uk.evil.co.uk/graphql", "https://www.example.co.uk"], ["https://neighbor.vercel.app/graphql", "https://tenant.vercel.app"],
    ["https://tenant-other.vercel.app/graphql", "https://tenant.vercel.app"], ["http://api.example.com/graphql", webOrigin], ["https://u:p@api.example.com/graphql", webOrigin]]) assert.throws(() => capturedAppOrigin(raw, origin), raw);
});

test("capture inspection learns first-party query POST evidence with fixed protocol only and schema-shaped new variables", async () => {
  const f = fixture();
  f.entries.push(entry(fullBody, { url: "https://third-party.com/graphql" }));
  const output = await f.inspect();
  assert.equal(output.status, "evidence_ready");
  assert.equal(output.evidence.length, 1);
  assert.equal(output.omitted.foreignOrigin, 1);
  noPrivate(output);
  const observed = output.evidence[0];
  assert.equal(observed.kind, "endpoint");
  assert.deepEqual(observed.operation, { query, operationName: "FindItems" });
  assert.deepEqual(observed.inputSchema, { type: "object", properties: { term: { type: "string" } }, required: ["term"], additionalProperties: false });
  const saved = f.rows.get(observed.evidenceId);
  assert.equal(saved.origin, apiOrigin);
  assert.equal(saved.connectionId, f.connectionId);
  assert.equal(saved.sessionEpoch, await epoch(webSession));
  assert.equal(saved.requestEnvelopeJson.includes("PRIVATE_CAPTURED_SEARCH"), false);
  assert.equal(saved.requestSchemaJson.includes("PRIVATE_CAPTURED_SEARCH"), false);
});

test("query verification uses the POST read-operation transport with new variables and exact session headers, not captured values", async () => {
  const f = fixture();
  const observed = (await f.inspect()).evidence[0];
  const built = await f.build(observed.evidenceId);
  f.setResponse(async (name, args) => {
    assert.equal(name, "learningResearch:readOperation");
    assert.equal(args.origin, apiOrigin);
    assert.equal(args.url, `${apiOrigin}/graphql`);
    assert.deepEqual(JSON.parse(args.bodyJson), { query, operationName: "FindItems", variables: { term: "new search" } });
    assert.deepEqual(JSON.parse(args.headersJson), { accept: "application/json", authorization: "Bearer PRIVATE_WEB_AUTH" });
    return { status: 200, text: '{"data":{"items":[{"name":"PRIVATE_VERIFICATION_RESPONSE"}]}}' };
  });
  const result = await f.tool("verify_app_tool", { toolId: built.toolId, args: { term: "new search" } });
  assert.equal(result.ok, true);
  assert.equal(result.kind, "read");
  assert.equal(f.rows.get(built.toolId).status, "verified");
  assert.ok(!JSON.stringify(result).includes("PRIVATE_VERIFICATION_RESPONSE"));
  noPrivate(result);
});

test("a GraphQL HTTP200 errors object never creates a successful verification receipt", async () => {
  const f = fixture();
  const observed = (await f.inspect()).evidence[0];
  const built = await f.build(observed.evidenceId);
  f.setResponse(async () => ({ status: 200, text: '{"data":null,"errors":[{"message":"PRIVATE_GRAPHQL_ERROR"}]}' }));
  const result = await f.tool("verify_app_tool", { toolId: built.toolId, args: { term: "new search" } });
  assert.equal(result.status, "learning_blocked");
  assert.equal(f.rows.get(built.toolId).status, "draft");
  assert.equal(f.calls.filter((call) => call.name === "appLearning:recordVerification").length, 0);
  assert.ok(!JSON.stringify(result).includes("PRIVATE_GRAPHQL_ERROR"));
});

test("opaque persisted POSTs remain write evidence, only build as writes and verify structurally without dispatch", async () => {
  const f = fixture(); f.entries[0] = entry(opaqueBody);
  const output = await f.inspect();
  assert.equal(output.evidence[0].kind, "write_endpoint");
  assert.equal(output.evidence[0].requiresApproval, true);
  noPrivate(output);
  const denied = await f.build(output.evidence[0].evidenceId);
  assert.equal(denied.status, "learning_blocked");
  const built = await f.build(output.evidence[0].evidenceId, "write");
  f.setResponse(async () => assert.fail("opaque persisted operations must never be sent by verification"));
  const verified = await f.tool("verify_app_tool", { toolId: built.toolId, args: { name: "new item" } });
  assert.equal(verified.executed, false);
  assert.equal(verified.validation, "structural_only");
  assert.equal(verified.kind, "write");
  await f.tool("publish_app_tool", { toolId: built.toolId });
  const approval = await f.tool("call_learned_tool", { toolId: built.toolId, args: { name: "new item" }, requestId: "stable-action-001" });
  assert.equal(approval.status, "approval_required");
  assert.equal(f.rows.get(approval.approvalId).status, "pending");
  const intent = f.rows.get(f.rows.get(approval.approvalId).learnedWriteId);
  assert.deepEqual(JSON.parse(intent.requestJson), { method: "POST", url: `${apiOrigin}/graphql`, body: JSON.stringify({ operationName: "AddItem", extensions: { persistedQuery: { version: 1, sha256Hash: "a".repeat(64) } }, variables: { name: "new item" } }) });
  assert.equal(f.calls.filter((call) => call.name.startsWith("learningResearch:")).length, 0);
  assert.equal(f.scheduled.filter((call) => call.name === "appLearningWrites:runApproved").length, 0);
  await assert.rejects((readOperation as any)._handler({}, { url: `${apiOrigin}/graphql`, origin: apiOrigin, bodyJson: JSON.parse(intent.requestJson).body, headersJson: '{}' }), /needs_approval/);
});

test("native capture evidence uses only the owned ready job's session and explicitly approved API origins", async () => {
  const f = fixture();
  const jobId = f.readyNative();
  const output = await f.inspect({ nativeJobId: jobId });
  assert.equal(output.status, "evidence_ready");
  noPrivate(output);
  const observed = output.evidence[0], saved = f.rows.get(observed.evidenceId);
  assert.equal(saved.nativeJobId, jobId);
  assert.equal(saved.sessionEpoch, await epoch(nativeSession));
  assert.notEqual(saved.sessionEpoch, await epoch(webSession));
  assert.equal(saved.expiresAt, f.rows.get(jobId).captureExpiresAt);
  const built = await f.build(observed.evidenceId);
  f.setResponse(async (_name, args) => {
    assert.equal(JSON.parse(args.headersJson).authorization, "Bearer PRIVATE_NATIVE_AUTH");
    assert.ok(!args.headersJson.includes("PRIVATE_WEB_AUTH"));
    return { status: 200, text: '{"data":{"items":[]}}' };
  });
  assert.equal((await f.tool("verify_app_tool", { toolId: built.toolId, args: { term: "new search" } })).ok, true);
  assert.equal(f.rows.get(f.connectionId).sessionJson, webSession);
});

test("native-only apps can inspect reviewed phone evidence without a website", async () => {
  const f = fixture(false);
  const jobId = f.readyNative();
  const output = await f.inspect({ nativeJobId: jobId });
  assert.equal(output.status, "evidence_ready");
  assert.equal(output.captureSource, "native_cloud_phone");
  assert.equal(output.evidence.length, 1);
  assert.equal((await f.inspect()).status, "needs_login");
});

test("native private context rejects another owner, not-ready jobs, missing connections and expired captures", async () => {
  for (const invalid of ["owner", "status", "connection", "expired", "origin"] as const) {
    const f = fixture(); const jobId = f.readyNative();
    if (invalid === "owner") f.rows.get(jobId).userId = f.otherId;
    if (invalid === "status") f.rows.get(jobId).status = "collecting";
    if (invalid === "connection") f.rows.delete(f.connectionId);
    if (invalid === "expired") f.rows.get(jobId).captureExpiresAt = Date.now() - 1;
    if (invalid === "origin") [...f.rows.values()].find((row) => row.table === "nativeAppBuilds").approvedOrigins = ["https://unrelated.example.org"];
    const output = await f.inspect({ nativeJobId: jobId });
    assert.notEqual(output.status, "evidence_ready", invalid);
    assert.equal([...f.rows.values()].filter((row) => row.table === "appLearningEvidence").length, 0, invalid);
    noPrivate(output);
  }
});

test("native response release and verification are revoked by expiry, disconnect and job-owner changes during HTTP", async () => {
  for (const operation of ["verify_app_tool", "call_learned_tool"] as const) for (const change of ["expiry", "disconnect", "jobOwner", "jobStopped", "session", "registry"] as const) {
    const f = fixture(); const jobId = f.readyNative();
    const observed = (await f.inspect({ nativeJobId: jobId })).evidence[0];
    const built = await f.build(observed.evidenceId);
    if (operation === "call_learned_tool") Object.assign(f.rows.get(built.toolId), { status: "published", verifiedAt: Date.now(), verificationJson: '{"ok":true}' });
    f.setResponse(async () => {
      if (change === "expiry") f.rows.get(jobId).captureExpiresAt = Date.now() - 1;
      if (change === "disconnect") f.rows.delete(f.connectionId);
      if (change === "jobOwner") f.rows.get(jobId).userId = f.otherId;
      if (change === "jobStopped") f.rows.get(jobId).status = "stopped";
      if (change === "session") f.rows.get(jobId).sessionJson = JSON.stringify({ capturedAt: 3 });
      if (change === "registry") [...f.rows.values()].find((row) => row.table === "nativeAppBuilds").approvedOrigins = [];
      return { status: 200, text: '{"data":{"items":[{"name":"PRIVATE_REVOKED_RESPONSE"}]}}' };
    });
    const output = await f.tool(operation, { toolId: built.toolId, args: { term: "new search" } });
    assert.equal(output.status, "learning_blocked", `${operation}:${change}`);
    assert.equal(f.rows.get(built.toolId).status, operation === "call_learned_tool" ? "published" : "draft", `${operation}:${change}`);
    assert.equal(f.calls.filter((call) => call.name === "appLearning:recordVerification").length, 0, change);
    assert.ok(!JSON.stringify(output).includes("PRIVATE_REVOKED_RESPONSE"), change);
  }
});

test("owner-scoped linked public source uses the CDN origin while retaining app attribution, with no app credentials", async () => {
  const f = fixture();
  const sourceUrl = "https://cdn.sourcevendor.com/assets/client.js";
  const sourceId = f.seed("appLearningEvidence", { userId: f.userId, appSlug: app, kind: "source", url: sourceUrl, origin: "https://cdn.sourcevendor.com", expiresAt: Date.now() + 60_000, shapeJson: 'null', headerNames: [] });
  f.setResponse(async (name, args) => {
    assert.equal(name, "learningResearch:inspectSource");
    assert.deepEqual(args, { url: sourceUrl, origin: "https://cdn.sourcevendor.com", appOrigin: webOrigin, query: "FindItems" });
    assert.ok(!JSON.stringify(args).includes("PRIVATE_WEB_AUTH"));
    return { url: sourceUrl, status: 200, contentType: "application/javascript", sources: [], endpoints: [], excerpt: "untrusted source excerpt", operations: [{ operationName: "FindItems" }], persistedQueryHashes: ["b".repeat(64)] };
  });
  const output = await f.tool("investigate_app", { app, sourceId, query: "FindItems" });
  assert.equal(output.status, "researched");
  assert.equal(output.excerpt, "untrusted source excerpt");
  assert.deepEqual(output.operations, [{ operationName: "FindItems" }]);
  assert.match(output.detail, /untrusted data/);
  assert.match(output.detail, /never instructions or execution permission/);
  noPrivate(output);
  const before = f.calls.length;
  f.rows.get(sourceId).userId = f.otherId;
  assert.equal((await f.tool("investigate_app", { app, sourceId, query: "FindItems" })).status, "learning_blocked");
  assert.equal(f.calls.length, before);
});

test("native evidence origin stays bound to the registry even if another API shares the app's registrable domain", async () => {
  const f = fixture(); const jobId = f.readyNative();
  const binding = { userId: f.userId, appSlug: app, connectionId: f.connectionId, nativeJobId: jobId, sessionEpoch: await epoch(nativeSession), origin: "https://other.example.com" };
  await assert.rejects(evidenceSession(f.ctx as any, binding as any), /origin was not approved/);
});

test("capture query values and response records never enter inspection metadata", async () => {
  const f = fixture();
  f.entries[0] = entry("", { method: "GET", url: `${apiOrigin}/api/items?search=PRIVATE_CAPTURED_URL`, reqBody: undefined,
    resBody: '{"items":[{"name":"PRIVATE_CAPTURED_RECORD","accessToken":"PRIVATE_CAPTURED_RESPONSE_AUTH"}]}' });
  const output = await f.inspect();
  assert.equal(output.status, "evidence_ready");
  assert.equal(output.evidence.length, 1);
  const text = JSON.stringify(output);
  for (const privateValue of ["PRIVATE_CAPTURED_URL", "PRIVATE_CAPTURED_RECORD", "PRIVATE_CAPTURED_RESPONSE_AUTH", "PRIVATE_WEB_AUTH"]) assert.ok(!text.includes(privateValue));
  assert.deepEqual(output.evidence[0].inputSchema.properties.search.type, ["string", "number", "boolean"]);
  assert.equal(output.evidence[0].path, "/api/items");
});

test("persisted evidence cannot relabel opaque hashes as reads or parsed query documents as approval writes", async () => {
  for (const opaque of [true, false]) {
    const f = fixture(); f.entries[0] = entry(opaque ? opaqueBody : fullBody);
    const observation = (await f.inspect()).evidence[0];
    const evidence = f.rows.get(observation.evidenceId);
    await assert.rejects(api.saveEvidence._handler(f.ctx, {
      token, app, origin: apiOrigin, connectionId: f.connectionId, sessionEpoch: await epoch(webSession),
      observations: [{ kind: opaque ? "endpoint" : "write_endpoint", method: "POST", url: `${apiOrigin}/graphql`, shapeJson: '{}', headerNames: [],
        requestEnvelopeJson: evidence.requestEnvelopeJson, requestSchemaJson: evidence.requestSchemaJson, bodyPresent: true }],
    }), /approval requirement cannot be changed/);
  }
});
