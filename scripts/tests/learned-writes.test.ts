import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import * as writes from "../../convex/appLearningWrites";
import * as approvals from "../../convex/approvals";
import { capturedWriteSchema } from "../../convex/lib/learnedWritePolicy";
import { epoch } from "../../convex/lib/learningPolicy";

const handlers = writes as any;
const approvalHandlers = approvals as any;
const args = { title: "new task", done: true, tags: ["first", "second"] };
const canonicalArgs = { done: true, tags: ["first", "second"], title: "new task" };
const appOrigin = "https://app.acme.com";
const endpoint = appOrigin + "/api/items?list=main";

async function fixture() {
  let n = 0;
  const rows = new Map<string, any>();
  const seed = (table: string, value: object) => {
    const id = `${table}:${++n}`;
    rows.set(id, { _id: id, _creationTime: n, table, ...structuredClone(value) });
    return id;
  };
  const token = "own-private-write-capability";
  const foreignToken = "foreign-private-write-capability";
  const userId = seed("users", { mcpToken: token });
  const foreignId = seed("users", { mcpToken: foreignToken });
  const session = {
    capturedAt: 100,
    headers: { authorization: "Bearer PRIVATE_WRITE_BEARER", "x-csrf-token": "PRIVATE_CSRF_VALUE", "x-idempotency-key": "OLD_IDEMPOTENCY", "x-request-id": "OLD_REQUEST_ID", "x-timestamp": "OLD_TIMESTAMP" },
    cookies: { sid: "PRIVATE_WRITE_COOKIE" },
    storage: { auth: JSON.stringify({ access_token: "PRIVATE_STORAGE_TOKEN" }) },
    credentials: { username: "private@example.test", password: "PRIVATE_WRITE_PASSWORD" },
  };
  const sessionJson = JSON.stringify(session);
  const connectionId = seed("connections", { userId, appSlug: "app_test", status: "live", sessionJson });
  const evidenceId = seed("appLearningEvidence", {
    userId, appSlug: "app_test", kind: "write_endpoint", origin: appOrigin, url: endpoint,
    method: "POST", bodyPresent: true, requestSchemaJson: capturedWriteSchema('{"title":"PRIVATE_CAPTURED_TITLE","done":false,"tags":["PRIVATE_CAPTURED_TAG"]}'),
    shapeJson: '{"ok":"boolean"}', headerNames: ["authorization", "cookie", "x-csrf-token", "x-idempotency-key", "x-request-id", "x-timestamp"],
    connectionId, sessionEpoch: await epoch(sessionJson), createdAt: Date.now(), expiresAt: Date.now() + 3_600_000,
  });
  const toolId = seed("appLearnedTools", { userId, appSlug: "app_test", evidenceId, name: "add_item", title: "Add item", kind: "write", status: "published", responsePath: "", createdAt: Date.now() });
  seed("discoveredApps", { slug: "app_test", name: "Acme", webUrl: appOrigin, webOrigin: appOrigin, loginUrl: appOrigin, blurb: "Test app" });
  const db = {
    get: async (id: string) => structuredClone(rows.get(id) ?? null),
    normalizeId: (table: string, id: string) => id.startsWith(`${table}:`) ? id : null,
    insert: async (table: string, value: object) => seed(table, value),
    delete: async (id: string) => { rows.delete(id); },
    patch: async (id: string, value: object) => { assert.ok(rows.has(id)); Object.assign(rows.get(id), structuredClone(value)); },
    query(table: string) {
      const filters: ((row: any) => boolean)[] = [];
      let direction = "asc";
      const eq = { eq(key: string, value: unknown) { filters.push((row) => row[key] === value); return eq; } };
      const values = () => [...rows.values()].filter((row) => row.table === table && filters.every((filter) => filter(row)))
        .sort((a, b) => (direction === "desc" ? -1 : 1) * (a._creationTime - b._creationTime)).map((row) => structuredClone(row));
      const query = { withIndex(_name: string, build: (filter: typeof eq) => unknown) { build(eq); return query; },
        order(value: string) { direction = value; return query; },
        collect: async () => values(), take: async (count: number) => values().slice(0, count), first: async () => values()[0] ?? null,
        unique: async () => { const all = values(); assert.ok(all.length <= 1); return all[0] ?? null; } };
      return query;
    },
  };
  const scheduled: { delay: number; name: string; args: any }[] = [];
  const ctx = { db, auth: { getUserIdentity: async () => null }, scheduler: {
    runAfter: async (delay: number, reference: Parameters<typeof getFunctionName>[0], input: unknown) => { scheduled.push({ delay, name: getFunctionName(reference), args: structuredClone(input) }); },
  } };
  const request = (extra: object = {}) => handlers.request._handler(ctx, { token, toolId, argsJson: JSON.stringify(args), requestId: "logical-action-1", ...extra });
  const approve = async (approvalId: string) => {
    assert.equal((await approvalHandlers.decide._handler(ctx, { approvalId, decision: "approve", token })).status, "approved");
    assert.equal(await approvalHandlers.claimRun._handler(ctx, { approvalId }), true);
  };
  const receipt = (approvalId: string) => {
    const outer = JSON.parse(rows.get(approvalId).resultJson);
    return { ok: outer.ok, ...JSON.parse(outer.text) };
  };
  const run = async (approvalId: string, response: { status: number; text: string } | Error = { status: 200, text: '{"ok":true}' }) => {
    const calls: { name: string; args: any }[] = [];
    const actionCtx = {
      runMutation: async (reference: Parameters<typeof getFunctionName>[0], input: unknown) => {
        const name = getFunctionName(reference);
        if (name === "appLearningWrites:claimExecution") return handlers.claimExecution._handler(ctx, input);
        if (name === "appLearningWrites:finishRun") return handlers.finishRun._handler(ctx, input);
        assert.fail(`unexpected mutation ${name}`);
      },
      runAction: async (reference: Parameters<typeof getFunctionName>[0], input: unknown) => {
        calls.push({ name: getFunctionName(reference), args: structuredClone(input) });
        assert.equal(getFunctionName(reference), "learningResearch:writeEndpoint");
        if (response instanceof Error) throw response;
        return response;
      },
    };
    await handlers.runApproved._handler(actionCtx, { approvalId });
    return calls;
  };
  return { rows, seed, ctx, token, foreignToken, userId, foreignId, session, sessionJson, connectionId, evidenceId, toolId, scheduled, request, approve, receipt, run };
}

function rowsFor(f: Awaited<ReturnType<typeof fixture>>, table: string) {
  return [...f.rows.values()].filter((row) => row.table === table);
}

test("write intent freezes the canonical new arguments, full target and exact approval preview without captured secrets", async () => {
  const f = await fixture();
  const result = await f.request();
  assert.equal(result.status, "approval_required"); assert.equal(result.executed, false);
  const intent = rowsFor(f, "appLearnedWrites")[0]!;
  const approval = f.rows.get(result.approvalId);
  assert.deepEqual(JSON.parse(intent.argsJson), canonicalArgs);
  assert.deepEqual(JSON.parse(intent.requestJson), { method: "POST", url: endpoint, body: JSON.stringify(canonicalArgs) });
  assert.deepEqual(result.preview, { method: "POST", path: "/api/items", args: { query: { list: "main" }, body: canonicalArgs } });
  assert.equal(intent.previewJson, JSON.stringify(result.preview));
  assert.equal(intent.requestHash, await epoch(`${f.toolId}:${intent.requestJson}`));
  assert.equal(approval.argsJson, intent.argsJson); assert.equal(approval.learnedWriteId, intent._id); assert.equal(intent.approvalId, approval._id);
  assert.equal(approval.status, "pending"); assert.equal(approval.runState, undefined);
  assert.equal(rowsFor(f, "activity")[0]!.status, "pending_approval");
  assert.equal(f.scheduled[0]?.name, "approvals:expire");
  const stored = JSON.stringify([intent, approval, rowsFor(f, "activity")]);
  for (const secret of ["PRIVATE_CAPTURED_TITLE", "PRIVATE_CAPTURED_TAG", "PRIVATE_WRITE_BEARER", "PRIVATE_WRITE_COOKIE", "PRIVATE_WRITE_PASSWORD", f.token]) assert.ok(!stored.includes(secret), secret);
});

test("intent requests enforce owner, current evidence, supported schema and stable action identities", async () => {
  const f = await fixture();
  await assert.rejects(f.request({ token: f.foreignToken }), /unavailable/);
  await assert.rejects(f.request({ token: "invalid-capability" }), /Authentication/);
  await assert.rejects(f.request({ requestId: "short" }), /stable requestId/);
  await assert.rejects(f.request({ argsJson: JSON.stringify({ ...args, unobserved: "x" }) }), /extra fields/);
  await assert.rejects(f.request({ argsJson: JSON.stringify({ ...args, title: "PRIVATE_WRITE_BEARER" }) }), /Credentials/);
  assert.equal(rowsFor(f, "appLearnedWrites").length, 0);
  const original = await f.request();
  const reordered = await f.request({ argsJson: JSON.stringify({ tags: args.tags, title: args.title, done: args.done }) });
  assert.equal(reordered.approvalId, original.approvalId);
  await assert.rejects(f.request({ argsJson: JSON.stringify({ ...args, title: "different task" }) }), /another exact action/);
  assert.equal(rowsFor(f, "appLearnedWrites").length, 1);
});

test("fresh request IDs deduplicate the same pending or running action rather than scheduling a second write", async () => {
  const f = await fixture();
  const first = await f.request();
  assert.equal((await f.request({ requestId: "fresh-action-id" })).approvalId, first.approvalId);
  await f.approve(first.approvalId);
  assert.equal((await f.request({ requestId: "another-action-id" })).approvalId, first.approvalId);
  assert.equal(rowsFor(f, "appLearnedWrites").length, 1); assert.equal(rowsFor(f, "approvals").length, 1);
});

test("expired evidence, revoked connections and rotated sessions fail before creating an approval", async () => {
  for (const change of [
    (f: Awaited<ReturnType<typeof fixture>>) => { f.rows.get(f.evidenceId).expiresAt = Date.now() - 1; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.rows.get(f.connectionId).status = "needs_login"; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.rows.get(f.connectionId).sessionJson = JSON.stringify({ capturedAt: 200 }); },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.rows.get(f.connectionId).userId = f.foreignId; },
  ]) {
    const f = await fixture(); change(f);
    await assert.rejects(f.request(), /unavailable|session changed/);
    assert.equal(rowsFor(f, "approvals").length, 0);
  }
});

test("claimExecution requires exact approval binding and can claim a request only once", async () => {
  const f = await fixture();
  const result = await f.request();
  assert.equal(await handlers.claimExecution._handler(f.ctx, { approvalId: result.approvalId }), null);
  await f.approve(result.approvalId);
  const claim = await handlers.claimExecution._handler(f.ctx, { approvalId: result.approvalId });
  assert.deepEqual({ method: claim.method, url: claim.url, body: claim.body, origin: claim.origin }, { method: "POST", url: endpoint, body: JSON.stringify(canonicalArgs), origin: appOrigin });
  assert.deepEqual(JSON.parse(claim.headersJson), { accept: "application/json", authorization: "Bearer PRIVATE_WRITE_BEARER", "x-csrf-token": "PRIVATE_CSRF_VALUE", cookie: "sid=PRIVATE_WRITE_COOKIE" });
  assert.equal(await handlers.claimExecution._handler(f.ctx, { approvalId: result.approvalId }), null);
  assert.equal(f.scheduled.filter((item) => item.name === "appLearningWrites:expireRun").length, 1);
  assert.equal(f.scheduled.find((item) => item.name === "appLearningWrites:expireRun")?.delay, 30_000);
});

test("denied, absent and incorrectly bound approvals never reach the write transport", async () => {
  for (const mode of ["absent", "pending", "denied", "wrong_owner", "wrong_connection", "wrong_intent", "not_running"]) {
    const f = await fixture();
    const result = await f.request();
    const approval = f.rows.get(result.approvalId);
    if (mode === "denied") await approvalHandlers.decide._handler(f.ctx, { approvalId: result.approvalId, decision: "deny", token: f.token });
    if (!["absent", "pending", "denied"].includes(mode)) {
      await f.approve(result.approvalId);
      if (mode === "wrong_owner") approval.userId = f.foreignId;
      if (mode === "wrong_connection") approval.connectionId = "connections:unknown";
      if (mode === "wrong_intent") approval.learnedWriteId = "appLearnedWrites:unknown";
      if (mode === "not_running") approval.runState = undefined;
    }
    assert.deepEqual(await f.run(mode === "absent" ? "approvals:unknown" : result.approvalId), [], mode);
  }
});

test("changed methods, targets, approved args, sessions and expired intents are blocked before dispatch", async () => {
  const changes: ((f: Awaited<ReturnType<typeof fixture>>, approvalId: string) => void)[] = [
    (f) => { f.rows.get(f.evidenceId).method = "DELETE"; },
    (f) => { f.rows.get(f.evidenceId).url = appOrigin + "/api/other"; },
    (f, id) => { f.rows.get(id).argsJson = JSON.stringify({ ...canonicalArgs, title: "tampered" }); },
    (f) => { rowsFor(f, "appLearnedWrites")[0]!.requestJson = '{}'; },
    (f) => { f.rows.get(f.connectionId).sessionJson = JSON.stringify({ capturedAt: 300 }); },
    (f) => { f.rows.get(f.connectionId).status = "needs_login"; },
    (f) => { rowsFor(f, "appLearnedWrites")[0]!.expiresAt = Date.now() - 1; },
    (f, id) => { f.rows.get(id).expiresAt = Date.now() - 1; },
    (f) => { f.rows.get(f.evidenceId).expiresAt = Date.now() - 1; },
    (f) => { f.rows.get(f.toolId).status = "draft"; },
  ];
  for (const change of changes) {
    const f = await fixture(); const result = await f.request(); await f.approve(result.approvalId); change(f, result.approvalId);
    assert.deepEqual(await f.run(result.approvalId), []);
    assert.equal(f.receipt(result.approvalId).status, "blocked");
  }
});

test("runApproved sends the frozen method/body once and stores a sanitized receipt rather than raw credentials", async () => {
  const f = await fixture(); const result = await f.request(); await f.approve(result.approvalId);
  const response = { ok: true, item: { id: "new-item", title: "new task" },
    arbitrary: "PRIVATE_WRITE_BEARER", cookieEcho: "PRIVATE_WRITE_COOKIE", passwordEcho: "PRIVATE_WRITE_PASSWORD", storedEcho: "PRIVATE_STORAGE_TOKEN", capabilityEcho: f.token,
    access_token: "UNRELATED_RESPONSE_TOKEN", nested: JSON.stringify({ value: "PRIVATE_WRITE_PASSWORD" }) };
  const calls = await f.run(result.approvalId, { status: 201, text: JSON.stringify(response) });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { name: "learningResearch:writeEndpoint", args: { url: endpoint, origin: appOrigin, method: "POST", bodyJson: JSON.stringify(canonicalArgs),
    headersJson: JSON.stringify({ accept: "application/json", authorization: "Bearer PRIVATE_WRITE_BEARER", "x-csrf-token": "PRIVATE_CSRF_VALUE", cookie: "sid=PRIVATE_WRITE_COOKIE" }) } });
  assert.deepEqual(await f.run(result.approvalId), []);
  const receipt = f.receipt(result.approvalId);
  assert.equal(receipt.ok, true); assert.equal(receipt.status, "succeeded"); assert.equal(receipt.httpStatus, 201);
  assert.equal((await f.request({ requestId: "fresh-confirmed-id" })).approvalId, result.approvalId);
  assert.equal((await f.request()).executed, true);
  assert.deepEqual(receipt.data.item, { id: "new-item", title: "new task" });
  const stored = f.rows.get(result.approvalId).resultJson;
  for (const secret of ["PRIVATE_WRITE_BEARER", "PRIVATE_WRITE_COOKIE", "PRIVATE_WRITE_PASSWORD", "PRIVATE_STORAGE_TOKEN", f.token, "UNRELATED_RESPONSE_TOKEN"]) assert.ok(!stored.includes(secret), secret);
});

test("transport uncertainty is retained without retries or private exception output", async () => {
  const f = await fixture(); const result = await f.request(); await f.approve(result.approvalId);
  assert.equal((await f.run(result.approvalId, new Error("learning_write_outcome_uncertain PRIVATE_TRANSPORT_SECRET"))).length, 1);
  const receipt = f.receipt(result.approvalId);
  assert.equal(receipt.ok, false); assert.equal(receipt.status, "outcome_uncertain");
  assert.ok(!f.rows.get(result.approvalId).resultJson.includes("PRIVATE_TRANSPORT_SECRET"));
  assert.equal((await f.request()).executed, null, "a terminal unknown outcome must not be reported as an executed success");
  assert.deepEqual(await f.run(result.approvalId), []);
});

test("uncertain outcomes remain deduplicated with a fresh request ID after the recent-result window", async () => {
  const f = await fixture(); const result = await f.request(); await f.approve(result.approvalId);
  await f.run(result.approvalId, new Error("learning_write_outcome_uncertain"));
  rowsFor(f, "appLearnedWrites")[0]!.createdAt = Date.now() - 6 * 60_000;
  rowsFor(f, "appLearnedWrites")[0]!.expiresAt = Date.now() - 1;
  f.rows.get(result.approvalId).expiresAt = Date.now() - 1;
  const repeated = await f.request({ requestId: "fresh-after-uncertain" });
  assert.equal(repeated.approvalId, result.approvalId);
  assert.equal(rowsFor(f, "appLearnedWrites").length, 1);
});

test("30-second expiry records an uncertain outcome and the first terminal receipt wins", async () => {
  const f = await fixture(); const result = await f.request(); await f.approve(result.approvalId);
  await handlers.claimExecution._handler(f.ctx, { approvalId: result.approvalId });
  rowsFor(f, "appLearnedWrites")[0]!.dispatchedAt = Date.now() - 1_000;
  await handlers.expireRun._handler(f.ctx, { approvalId: result.approvalId });
  assert.equal(f.rows.get(result.approvalId).runState, "running");
  rowsFor(f, "appLearnedWrites")[0]!.dispatchedAt = Date.now() - 30_001;
  await handlers.expireRun._handler(f.ctx, { approvalId: result.approvalId });
  assert.equal(f.receipt(result.approvalId).status, "outcome_uncertain");
  const before = f.rows.get(result.approvalId).resultJson;
  await handlers.finishRun._handler(f.ctx, { approvalId: result.approvalId, ok: true, resultJson: '{"status":"succeeded"}' });
  await handlers.expireRun._handler(f.ctx, { approvalId: result.approvalId });
  assert.equal(f.rows.get(result.approvalId).resultJson, before);
});

test("confirmed completion cannot be overwritten by expiry or a second finish", async () => {
  const f = await fixture(); const result = await f.request(); await f.approve(result.approvalId); await f.run(result.approvalId);
  const before = f.rows.get(result.approvalId).resultJson;
  rowsFor(f, "appLearnedWrites")[0]!.dispatchedAt = Date.now() - 30_001;
  await handlers.expireRun._handler(f.ctx, { approvalId: result.approvalId });
  await handlers.finishRun._handler(f.ctx, { approvalId: result.approvalId, ok: false, resultJson: '{"status":"outcome_uncertain"}' });
  assert.equal(f.rows.get(result.approvalId).resultJson, before); assert.equal(f.receipt(result.approvalId).status, "succeeded");
});

test("an expired action claimed before a crash is finalized without ever entering transport", async () => {
  const f = await fixture();
  const requested = await f.request();
  await f.approve(requested.approvalId);
  const intent = rowsFor(f, "appLearnedWrites")[0]!;
  assert.equal(intent.dispatchedAt, undefined);
  intent.expiresAt = Date.now() - 1;
  await handlers.expireUnstarted._handler(f.ctx, { approvalId: requested.approvalId });
  assert.equal(f.receipt(requested.approvalId).status, "blocked");
  assert.equal(f.rows.get(requested.approvalId).runState, "done");
  assert.deepEqual(await f.run(requested.approvalId), []);
});


test("learned PUT/PATCH/DELETE methods retain the approved payload and bodyless deletes never replay captured values", async () => {
  for (const method of ["PUT", "PATCH", "DELETE"]) {
    const f = await fixture(); f.rows.get(f.evidenceId).method = method;
    const result = await f.request(); await f.approve(result.approvalId);
    const calls = await f.run(result.approvalId);
    assert.equal(calls.length, 1); assert.equal(calls[0]!.args.method, method);
    assert.equal(calls[0]!.args.bodyJson, JSON.stringify(canonicalArgs));
  }
  const f = await fixture();
  Object.assign(f.rows.get(f.evidenceId), { method: "DELETE", bodyPresent: false, requestSchemaJson: capturedWriteSchema() });
  const result = await f.request({ argsJson: "{}" }); await f.approve(result.approvalId);
  assert.deepEqual(JSON.parse(rowsFor(f, "appLearnedWrites")[0]!.requestJson), { method: "DELETE", url: endpoint });
  const calls = await f.run(result.approvalId, { status: 204, text: "" });
  assert.equal(calls.length, 1); assert.equal(calls[0]!.args.method, "DELETE");
  assert.equal(Object.hasOwn(calls[0]!.args, "bodyJson"), false);
  assert.equal(f.receipt(result.approvalId).status, "succeeded");
});

test("semantic rejection and server errors never become success receipts or automatic retries", async () => {
  for (const response of [
    { status: 200, text: '{"ok":false}', expected: "rejected" },
    { status: 200, text: '{"success":false}', expected: "rejected" },
    { status: 409, text: '{"message":"conflict"}', expected: "rejected" },
    { status: 503, text: '{"message":"unavailable"}', expected: "outcome_uncertain" },
    { status: 200, text: "PRIVATE_INVALID_JSON_RESPONSE", expected: "outcome_uncertain" },
  ]) {
    const f = await fixture(); const result = await f.request(); await f.approve(result.approvalId);
    assert.equal((await f.run(result.approvalId, response)).length, 1);
    assert.equal(f.receipt(result.approvalId).status, response.expected);
    assert.equal(f.receipt(result.approvalId).ok, false);
    assert.ok(!f.rows.get(result.approvalId).resultJson.includes("PRIVATE_INVALID_JSON_RESPONSE"));
    assert.deepEqual(await f.run(result.approvalId), []);
  }
});
