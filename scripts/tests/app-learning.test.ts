import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import * as api from "../../convex/appLearning";
import { capturedHeaders, endpointUrl, epoch, parameterizedUrl, querySchema, responseAt, safePath, valueShape } from "../../convex/lib/learningPolicy";

const handlers = api as any;
function fixture() {
  let n = 0;
  const rows = new Map<string, any>();
  const seed = (table: string, value: object) => { const id = `${table}:${++n}`; rows.set(id, { _id: id, table, ...value }); return id; };
  const token = "own-private-capability";
  const user = seed("users", { mcpToken: token });
  const foreign = seed("users", { mcpToken: "other-private-capability" });
  const db = {
    get: async (id: string) => structuredClone(rows.get(id) ?? null),
    normalizeId: (table: string, id: string) => id.startsWith(`${table}:`) ? id : null,
    insert: async (table: string, value: object) => seed(table, value),
    delete: async (id: string) => { rows.delete(id); },
    patch: async (id: string, fields: object) => { Object.assign(rows.get(id), fields); },
    query(table: string) {
      const filters: ((row: any) => boolean)[] = [];
      const eq = { eq(key: string, value: unknown) { filters.push((r) => r[key] === value); return eq; } };
      const values = () => [...rows.values()].filter((r) => r.table === table && filters.every((f) => f(r))).map((row) => structuredClone(row));
      const q = { withIndex(_name: string, build: (x: typeof eq) => unknown) { build(eq); return q; }, order() { return q; },
        take: async (count: number) => values().slice(0, count), unique: async () => values()[0] ?? null, first: async () => values()[0] ?? null };
      return q;
    },
  };
  const ctx = { db };
  const evidence = seed("appLearningEvidence", { userId: user, appSlug: "app_test", kind: "endpoint", origin: "https://app.acme.com", url: "https://app.acme.com/api/items", shapeJson: '{}', headerNames: [], expiresAt: Date.now() + 60_000 });
  const build = (extra: object = {}) => handlers.build._handler(ctx, { token, app: "app_test", evidenceId: evidence, name: "read_items", title: "Read items", responsePath: "", ...extra });
  return { rows, seed, ctx, token, user, foreign, evidence, build };
}

test("endpoint policy refuses foreign, secret-bearing and mutation endpoints even via GET", () => {
  const origin = "https://app.acme.com";
  assert.equal(endpointUrl("/api/items?page=2", origin), `${origin}/api/items?page=2`);
  for (const url of ["https://evil.acme.com/api/items", "http://app.acme.com/api/items", "/api/items/delete", "/api/execute", "/api/transfer", "/graphql", "/api/items?token=secret", "/api/items?action=delete", "/api/items?callback=evil", "/api/items/{{url}}", "/api/items/%64elete", "https://u:p@app.acme.com/api/items"]) assert.throws(() => endpointUrl(url, origin), url);
});

test("inspection emits types and scrubbed paths, never response or URL values", () => {
  const shape = JSON.stringify(valueShape({ email: "person@example.com", password: "secret", items: [{ name: "private diary", calories: 123 }], accessToken: "secret", constructor: "bad" }));
  for (const value of ["person@example.com", "secret", "private diary", "123", "constructor"]) assert.ok(!shape.includes(value));
  assert.match(shape, /"email":"string"/);
  assert.equal(safePath("https://app.acme.com/api/users/person%40example.com/123?token=secret"), "/api/users/:value/:value");
  assert.throws(() => responseAt({ a: 1 }, "constructor"));
  assert.throws(() => responseAt({ token: "secret" }, "token"));
  assert.deepEqual(responseAt({ data: { items: [] } }, "data.items"), []);
});

test("credential headers come only from observed names; never forward authority or storage", () => {
  const headers = capturedHeaders(["authorization", "cookie", "x-forwarded-host", "x-api-url", "x-api-token"], { capturedAt: 1, headers: { authorization: "Bearer own", "x-forwarded-host": "evil", "x-api-url": "evil", "x-api-token": "own" }, cookies: { session: "own", bad: "x; other=y" }, storage: { password: "never" } });
  assert.deepEqual(headers, { accept: "application/json", authorization: "Bearer own", "x-api-token": "own", cookie: "session=own" });
  assert.deepEqual(capturedHeaders([], { capturedAt: 1, headers: { authorization: "Bearer own" }, cookies: { session: "own" } }), { accept: "application/json" });
});

test("private evidence is owner/app scoped and immutable tool build is idempotent", async () => {
  const f = fixture();
  const first = await f.build();
  assert.deepEqual(await f.build(), first);
  assert.equal(f.rows.get(first.toolId).status, "draft");
  await assert.rejects(f.build({ token: "other-private-capability" }), /current endpoint evidence/);
  await assert.rejects(f.build({ app: "another_app" }), /current endpoint evidence/);
  await assert.rejects(f.build({ token: "not-a-real-capability" }), /Authentication/);
  await assert.rejects(handlers.context._handler(f.ctx, { token: "other-private-capability", toolId: first.toolId }), /Unknown private tool/);
  assert.deepEqual(await handlers.list._handler(f.ctx, { token: "other-private-capability" }), []);
});

test("publishing requires server verification of the exact revision and current session", async () => {
  const f = fixture();
  const { toolId } = await f.build();
  await assert.rejects(handlers.publish._handler(f.ctx, { token: f.token, toolId }), /Verify this exact/);
  const json = JSON.stringify({ capturedAt: 1, headers: { authorization: "secret" } });
  const sessionEpoch = await epoch(json);
  const connectionId = f.seed("connections", { userId: f.user, appSlug: "app_test", status: "live", sessionJson: json });
  Object.assign(f.rows.get(f.evidence), { connectionId, sessionEpoch });
  await assert.rejects(handlers.recordVerification._handler(f.ctx, { token: f.token, toolId, epoch: "wrong", receiptJson: '{}' }), /session changed/);
  await handlers.recordVerification._handler(f.ctx, { token: f.token, toolId, epoch: sessionEpoch, receiptJson: '{"ok":true}' });
  assert.equal((await handlers.publish._handler(f.ctx, { token: f.token, toolId })).private, true);
  f.rows.get(connectionId).sessionJson = JSON.stringify({ capturedAt: 2 });
  await assert.rejects(handlers.publish._handler(f.ctx, { token: f.token, toolId }), /session changed/);
});

test("source evidence cannot become a tool and expired evidence cannot publish", async () => {
  const f = fixture();
  f.rows.get(f.evidence).kind = "source";
  await assert.rejects(f.build(), /current endpoint evidence/);
  f.rows.get(f.evidence).kind = "endpoint";
  const { toolId } = await f.build();
  Object.assign(f.rows.get(toolId), { status: "verified", verifiedAt: Date.now(), verificationJson: '{}' });
  f.rows.get(f.evidence).expiresAt = Date.now() - 1;
  await assert.rejects(handlers.publish._handler(f.ctx, { token: f.token, toolId }), /Verify this exact/);
});

async function learnedRead(session: object, body: object, duringFetch?: (f: ReturnType<typeof fixture>, connectionId: string) => void) {
  const f = fixture();
  const sessionJson = JSON.stringify(session);
  const sessionEpoch = await epoch(sessionJson);
  const connectionId = f.seed("connections", { userId: f.user, appSlug: "app_test", status: "live", sessionJson });
  Object.assign(f.rows.get(f.evidence), { connectionId, sessionEpoch });
  const { toolId } = await f.build();
  Object.assign(f.rows.get(toolId), { status: "published", verifiedAt: Date.now(), verificationJson: '{"ok":true}' });
  const calls: string[] = [];
  const ctx = {
    runQuery: async (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
      assert.equal(getFunctionName(ref), "appLearning:context");
      return handlers.context._handler(f.ctx, args);
    },
    runAction: async (ref: Parameters<typeof getFunctionName>[0], args: { url: string; headersJson: string }) => {
      calls.push(getFunctionName(ref));
      assert.equal(getFunctionName(ref), "learningResearch:readEndpoint");
      assert.equal(args.url, "https://app.acme.com/api/items");
      duringFetch?.(f, connectionId);
      return { status: 200, text: JSON.stringify(body) };
    },
    runMutation: async () => assert.fail("published reads must not mutate tools"),
  };
  const output = JSON.parse(await handlers.tool._handler(ctx, { token: f.token, operation: "call_learned_tool", argsJson: JSON.stringify({ toolId }) }));
  assert.deepEqual(calls, ["learningResearch:readEndpoint"]);
  return output;
}

test("a response is revoked if disconnect/reconnect replaces its connection even with identical session material", async () => {
  const session = { capturedAt: 1, cookies: { sid: "private-session-value" } };
  const output = await learnedRead(session, { records: ["PRIVATE_OLD_CONNECTION_RESPONSE"] }, (f, oldId) => {
    f.rows.delete(oldId);
    f.seed("connections", { userId: f.user, appSlug: "app_test", status: "live", sessionJson: JSON.stringify(session) });
  });
  assert.equal(output.status, "learning_blocked");
  assert.ok(!JSON.stringify(output).includes("PRIVATE_OLD_CONNECTION_RESPONSE"));
});

test("an in-flight read must not release a response after its evidence TTL passes", async (t) => {
  let now = 5_000_000;
  t.mock.method(Date, "now", () => now);
  const output = await learnedRead({ capturedAt: 1 }, { records: ["PRIVATE_EXPIRED_RESPONSE"] }, () => { now += 60_000; });
  assert.equal(output.status, "learning_blocked");
  assert.ok(!JSON.stringify(output).includes("PRIVATE_EXPIRED_RESPONSE"));
});

test("the existing session-epoch guard blocks credentials rotated during a network read", async () => {
  const output = await learnedRead({ capturedAt: 1, cookies: { sid: "old-secret" } }, { records: ["PRIVATE_OLD_SESSION_RESPONSE"] }, (f, id) => {
    f.rows.get(id).sessionJson = JSON.stringify({ capturedAt: 2, cookies: { sid: "new-secret" } });
  });
  assert.equal(output.status, "learning_blocked");
  assert.ok(!JSON.stringify(output).includes("PRIVATE_OLD_SESSION_RESPONSE"));
});

test("a learned response cannot echo a known session cookie through JSON escaping", async () => {
  const secret = 'cookie-with-"-quoted-secret';
  const output = await learnedRead({ capturedAt: 1, cookies: { sid: secret } }, { echo: secret, records: ["visible data"] });
  assert.equal(output.ok, true);
  assert.ok(!JSON.stringify(output).includes("quoted-secret"));
  assert.ok(JSON.stringify(output).includes("visible data"));
});

test("a learned response never exposes the session's saved login password under an arbitrary key", async () => {
  const secret = "PRIVATE_LOGIN_PASSWORD";
  const output = await learnedRead({ capturedAt: 1, credentials: { username: "private@example.test", password: secret } }, { echo: secret, records: ["visible data"] });
  assert.equal(output.ok, true);
  assert.ok(!JSON.stringify(output).includes(secret));
  assert.ok(JSON.stringify(output).includes("visible data"));
});

test("bearer values echoed without their Authorization prefix remain private", async () => {
  const secret = "PRIVATE_BEARER_TOKEN";
  const output = await learnedRead({ capturedAt: 1, headers: { authorization: `Bearer ${secret}` } }, { echo: secret });
  assert.equal(output.ok, true);
  assert.ok(!JSON.stringify(output).includes(secret));
});

test("read-looking prefixes do not permit nested mutation verbs or repeated URL encoding", () => {
  for (const url of ["/api/items/%2564elete", "/api/users/transfer", "/api/users/follow", "/api/items/archive"]) {
    assert.throws(() => endpointUrl(url, "https://app.acme.com"), url);
  }
});

test("one capture batch deduplicates identical endpoint evidence instead of consuming its quota repeatedly", async () => {
  const f = fixture();
  const observation = { kind: "endpoint", url: "https://app.acme.com/api/profile", shapeJson: '{"name":"string"}', headerNames: [] };
  const result = await handlers.saveEvidence._handler(f.ctx, { token: f.token, app: "app_test", origin: "https://app.acme.com", observations: [observation, observation] });
  assert.equal(new Set(result.map((row: { evidenceId: string }) => row.evidenceId)).size, 1);
  assert.equal([...f.rows.values()].filter((row) => row.table === "appLearningEvidence" && row.url === observation.url).length, 1);
});

test("long echoed session values are redacted before public-data truncation can expose a credential prefix", async () => {
  const secret = "LONG_AUTH_SECRET_" + "a".repeat(8192);
  const output = await learnedRead({ capturedAt: 1, storage: { accessToken: secret } }, { echo: secret, records: ["visible data"] });
  assert.equal(output.ok, true);
  assert.ok(!JSON.stringify(output).includes("LONG_AUTH_SECRET_"));
  assert.ok(JSON.stringify(output).includes("visible data"));
});

test("session invalidation during a read blocks its response even if credential bytes did not change", async () => {
  const output = await learnedRead({ capturedAt: 1, cookies: { sid: "unchanged-secret" } }, { records: ["PRIVATE_REVOKED_RESPONSE"] }, (f, id) => {
    f.rows.get(id).status = "needs_login";
  });
  assert.equal(output.status, "learning_blocked");
  assert.ok(!JSON.stringify(output).includes("PRIVATE_REVOKED_RESPONSE"));
});

test("expired evidence no longer consumes quota and cleanup stays scoped to its owner and app", async () => {
  const f = fixture();
  const expired: string[] = [];
  for (let index = 0; index < 199; index++) expired.push(f.seed("appLearningEvidence", {
    userId: f.user, appSlug: "app_test", kind: "endpoint", url: `https://app.acme.com/api/items/${index}`,
    origin: "https://app.acme.com", expiresAt: Date.now() - 1, shapeJson: '{}', headerNames: [],
  }));
  const foreign = f.seed("appLearningEvidence", { userId: f.foreign, appSlug: "app_test", expiresAt: Date.now() - 1 });
  const otherApp = f.seed("appLearningEvidence", { userId: f.user, appSlug: "another_app", expiresAt: Date.now() - 1 });
  const out = await handlers.saveEvidence._handler(f.ctx, { token: f.token, app: "app_test", origin: "https://app.acme.com",
    observations: [{ kind: "endpoint", url: "https://app.acme.com/api/profile", shapeJson: '{}', headerNames: [] }] });
  assert.equal(out.length, 1);
  assert.ok(expired.every((id) => !f.rows.has(id)));
  assert.ok(f.rows.has(foreign));
  assert.ok(f.rows.has(otherApp));
});

test("expired or deleted evidence cannot permanently exhaust the user's private-tool quota", async () => {
  const f = fixture();
  const expired: string[] = [];
  for (let index = 0; index < 200; index++) expired.push(f.seed("appLearnedTools", {
    userId: f.user, appSlug: "app_test", evidenceId: "appLearningEvidence:deleted", name: `old_${index}`, status: "published",
  }));
  const foreign = f.seed("appLearnedTools", { userId: f.foreign, evidenceId: "appLearningEvidence:deleted" });
  const tool = await f.build();
  assert.equal(tool.status, "draft");
  assert.ok(expired.every((id) => !f.rows.has(id)));
  assert.ok(f.rows.has(foreign));
});

test("JSON auth-storage blobs and JSON-encoded response fields cannot hide known session credentials", async () => {
  const stored = "PRIVATE_JSON_STORED_TOKEN";
  const fromStorage = await learnedRead({ capturedAt: 1, storage: { auth: JSON.stringify({ access_token: stored }) } }, { echo: stored });
  assert.equal(fromStorage.ok, true);
  assert.ok(!JSON.stringify(fromStorage).includes(stored));
  const quoted = 'PRIVATE_QUOTED_"_PASSWORD';
  const fromResponse = await learnedRead({ capturedAt: 1, credentials: { username: "private@example.test", password: quoted } }, { echo: JSON.stringify({ value: quoted }) });
  assert.equal(fromResponse.ok, true);
  assert.ok(!JSON.stringify(fromResponse).includes("PRIVATE_QUOTED_"));
});

test("query schemas expose observed parameter names and primitive types without captured values", () => {
  const schema = querySchema("https://app.acme.com/api/items?q=PRIVATE_CAPTURED_SEARCH&page=2&q=PRIVATE_OTHER_SEARCH");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties), ["q", "page"]);
  assert.deepEqual(schema.properties.q.type, ["string", "number", "boolean"]);
  assert.ok(!JSON.stringify(schema).includes("PRIVATE_"));
});

test("query overrides stay on the immutable endpoint and encode delimiters as values", () => {
  const origin = "https://app.acme.com";
  const url = new URL(parameterizedUrl(`${origin}/api/items?q=old&page=1&include=false`, origin,
    { q: "search &token=not-a-real-parameter", page: 2, include: true }));
  assert.equal(url.origin, origin);
  assert.equal(url.pathname, "/api/items");
  assert.deepEqual([...url.searchParams.keys()], ["q", "page", "include"]);
  assert.equal(url.searchParams.get("q"), "search &token=not-a-real-parameter");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("include"), "true");
  for (const args of [{ unobserved: "x" }, { q: {} }, { q: [] }, { q: null }, { page: NaN }, { page: Infinity },
    { q: "x".repeat(257) }, { q: "<script>" }, { q: "line\r\nbreak" }, JSON.parse('{"__proto__":"x"}')]) {
    assert.throws(() => parameterizedUrl(`${origin}/api/items?q=old&page=1`, origin, args));
  }
});

test("a built tool persists its observed query schema and the real action forwards only allowed overrides", async () => {
  const f = fixture();
  f.rows.get(f.evidence).url = "https://app.acme.com/api/items?q=PRIVATE_OBSERVED_SEARCH&page=1";
  const { toolId } = await f.build();
  const tool = f.rows.get(toolId);
  const schema = JSON.parse(tool.inputSchemaJson);
  assert.deepEqual(Object.keys(schema.properties), ["q", "page"]);
  assert.ok(!tool.inputSchemaJson.includes("PRIVATE_OBSERVED_SEARCH"));
  tool.status = "published";
  let requests = 0;
  const ctx = {
    runQuery: async (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
      assert.equal(getFunctionName(ref), "appLearning:context"); return handlers.context._handler(f.ctx, args);
    },
    runAction: async (ref: Parameters<typeof getFunctionName>[0], args: { url: string }) => {
      assert.equal(getFunctionName(ref), "learningResearch:readEndpoint"); requests++;
      const url = new URL(args.url);
      assert.equal(url.pathname, "/api/items");
      assert.equal(url.searchParams.get("q"), "new search");
      assert.equal(url.searchParams.get("page"), "3");
      return { status: 200, text: '{"items":["real read seam"]}' };
    },
  };
  const out = JSON.parse(await handlers.tool._handler(ctx, { token: f.token, operation: "call_learned_tool", argsJson: JSON.stringify({ toolId, args: { q: "new search", page: 3 } }) }));
  assert.equal(out.ok, true);
  assert.equal(requests, 1);
  const blocked = JSON.parse(await handlers.tool._handler(ctx, { token: f.token, operation: "call_learned_tool", argsJson: JSON.stringify({ toolId, args: { token: "PRIVATE_PARAMETER_VALUE" } }) }));
  assert.equal(blocked.status, "learning_blocked");
  assert.equal(requests, 1, "an unobserved parameter must fail before the network seam");
  assert.ok(!JSON.stringify(blocked).includes("PRIVATE_PARAMETER_VALUE"));
});

test("oversized metadata fails with bounded generic output and no private values or raw exception details", async () => {
  const f = fixture();
  const ctx = {
    runQuery: async (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
      assert.equal(getFunctionName(ref), "appLearning:context"); return handlers.context._handler(f.ctx, args);
    },
    runAction: async () => ({ data: "PRIVATE_LARGE_SOURCE_VALUE".repeat(4000) }),
  };
  const out = await handlers.tool._handler(ctx, { token: f.token, operation: "search_apps", argsJson: '{"query":"anything"}' });
  assert.equal(JSON.parse(out).status, "learning_blocked");
  assert.ok(Buffer.byteLength(out) < 1024);
  assert.ok(!out.includes("PRIVATE_LARGE_SOURCE_VALUE"));
  assert.ok(!out.includes(f.token));
});
