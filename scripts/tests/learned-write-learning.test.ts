/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { getFunctionName } from "convex/server";
import * as learning from "../../convex/appLearning";
import * as writes from "../../convex/appLearningWrites";

const handlers = learning as any;
const writeHandlers = writes as any;
const token = "private-write-learning-capability";
const origin = "https://notes.example.test";
const captured = { title: "PRIVATE_CAPTURED_NOTE", completed: false, metrics: { repetitions: 17 }, labels: ["PRIVATE_CAPTURED_LABEL"] };
const intended = { title: "New explicit note", completed: true, metrics: { repetitions: 3 }, labels: ["new label"] };
type Row = Record<string, any> & { _id: string; table: string };
type Call = { name: string; args: Record<string, any> };

function fixture() {
  let sequence = 0;
  const rows = new Map<string, Row>();
  const seed = (table: string, value: object) => {
    const id = `${table}:${++sequence}`;
    rows.set(id, { _id: id, table, ...value });
    return id;
  };
  const user = seed("users", { mcpToken: token });
  seed("users", { mcpToken: "foreign-private-capability" });
  const sessionJson = JSON.stringify({ capturedAt: 1, headers: { authorization: "Bearer PRIVATE_SESSION_SECRET" } });
  const connectionId = seed("connections", { userId: user, appSlug: "app_test", status: "capturing", sessionJson });
  seed("discoveredApps", { slug: "app_test", name: "Test Notes", webOrigin: origin, loginUrl: origin });
  const entries: any[] = [{ id: "captured-write", ts: 1, method: "POST", url: `${origin}/api/notes?list=PRIVATE_FIXED_TARGET`, status: 201,
    initiator: "fetch", reqHeaders: { "content-type": "application/json", authorization: "<redacted:authorization>" },
    reqBody: JSON.stringify(captured), resBody: JSON.stringify({ id: 12345, title: "PRIVATE_RESPONSE_NOTE", access_token: "PRIVATE_RESPONSE_TOKEN" }) }];
  const queries: Call[] = [], mutations: Call[] = [], actions: Call[] = [], scheduled: Call[] = [];
  const tables: string[] = [];
  const db = {
    get: async (id: string) => structuredClone(rows.get(id) ?? null),
    normalizeId: (table: string, id: string) => id.startsWith(`${table}:`) ? id : null,
    insert: async (table: string, value: object) => seed(table, value),
    delete: async (id: string) => { rows.delete(id); },
    patch: async (id: string, value: Record<string, unknown>) => {
      const row = rows.get(id)!;
      for (const [key, field] of Object.entries(value)) if (field === undefined) delete row[key]; else row[key] = structuredClone(field);
    },
    query(table: string) {
      tables.push(table);
      const filters: [string, unknown][] = [];
      const range = { eq(key: string, value: unknown) { filters.push([key, value]); return range; } };
      const selected = () => [...rows.values()].filter((row) => row.table === table && filters.every(([key, value]) => row[key] === value)).map((row) => structuredClone(row));
      const query = { withIndex(_name: string, build: (filter: typeof range) => unknown) { build(range); return query; }, order() { return query; },
        take: async (count: number) => selected().slice(0, count), first: async () => selected()[0] ?? null,
        unique: async () => { const found = selected(); assert.ok(found.length <= 1); return found[0] ?? null; } };
      return query;
    },
  };
  const store = { db, scheduler: { runAfter: async (delay: number, ref: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => {
    const name = getFunctionName(ref);
    assert.ok(["approvals:expire", "appLearningWrites:expireUnstarted"].includes(name), "learning may only schedule expiry, never a write transport");
    scheduled.push({ name, args: { ...args, delay } });
  } } };
  const ctx = {
    runQuery: async (ref: Parameters<typeof getFunctionName>[0], args: Record<string, any>) => {
      const name = getFunctionName(ref);
      queries.push({ name, args });
      if (name === "appLearning:context") return handlers.context._handler(store, args);
      if (name === "apps:resolve") return { slug: "app_test", webOrigin: origin };
      if (name === "connections:captureEntries") { assert.equal(args.connectionId, connectionId); return structuredClone(entries); }
      throw new Error(`Unexpected query ${name}`);
    },
    runMutation: async (ref: Parameters<typeof getFunctionName>[0], args: Record<string, any>) => {
      const name = getFunctionName(ref);
      mutations.push({ name, args });
      const local = name.startsWith("appLearning:") ? handlers[name.slice("appLearning:".length)] : undefined;
      if (local) return local._handler(store, args);
      if (name === "appLearningWrites:request") return writeHandlers.request._handler(store, args);
      throw new Error(`Unexpected mutation ${name}`);
    },
    runAction: async (ref: Parameters<typeof getFunctionName>[0], args: Record<string, any>) => {
      actions.push({ name: getFunctionName(ref), args });
      assert.fail("write learning, verification, publication and approval creation must never call a transport");
    },
  };
  const tool = async (operation: string, args: Record<string, unknown> = {}, capability = token) =>
    JSON.parse(await handlers.tool._handler(ctx, { token: capability, operation, argsJson: JSON.stringify(args) }));
  const inspect = () => tool("inspect_app_capture", { app: "app_test" });
  const build = (evidenceId: string, extra: Record<string, unknown> = {}) => tool("build_app_tool", {
    app: "app_test", evidenceId, name: "create_note", title: "Create note", kind: "write", ...extra,
  });
  const prepared = async () => {
    const inspected = await inspect();
    const built = await build(inspected.evidence[0].evidenceId);
    assert.equal(built.status, "draft");
    return { evidenceId: inspected.evidence[0].evidenceId as string, toolId: built.toolId as string };
  };
  const table = (name: string) => [...rows.values()].filter((row) => row.table === name);
  return { rows, seed, user, connectionId, entries, queries, mutations, actions, scheduled, tables, tool, inspect, build, prepared, table, store };
}

test("capture inspection produces owned write evidence and nested schemas without captured payload, query or credential values", async () => {
  const f = fixture();
  const result = await f.inspect();
  assert.equal(result.status, "evidence_ready");
  assert.equal(result.evidence.length, 1);
  const evidence = result.evidence[0];
  assert.equal(evidence.kind, "write_endpoint");
  assert.equal(evidence.method, "POST");
  assert.equal(evidence.requestSchema.additionalProperties, false);
  assert.equal(evidence.requestSchema.properties.metrics.properties.repetitions.type, "number");
  assert.equal(evidence.requestSchema.properties.labels.items.type, "string");
  assert.deepEqual(evidence.requestSchema.required, ["completed", "labels", "metrics", "title"]);
  assert.ok(!JSON.stringify(result).includes("PRIVATE_"));
  assert.ok(!JSON.stringify(result).includes("12345"));
  const stored = f.rows.get(evidence.evidenceId)!;
  assert.equal(stored.userId, f.user);
  assert.equal(stored.connectionId, f.connectionId);
  assert.ok(!stored.requestSchemaJson.includes("PRIVATE_"));
  assert.equal(stored.reqBody, undefined);
  assert.equal(f.actions.length, 0);
});

test("write evidence cannot be downgraded into a read, and public read evidence cannot authorize a write", async () => {
  const f = fixture();
  const { evidence } = await f.inspect();
  for (const kind of [undefined, "read"]) {
    assert.equal((await f.build(evidence[0].evidenceId, { kind })).status, "learning_blocked");
  }
  assert.equal(f.table("appLearnedTools").length, 0);
  const readEvidence = f.seed("appLearningEvidence", { userId: f.user, appSlug: "app_test", kind: "endpoint", origin, url: `${origin}/api/items`,
    shapeJson: '{}', headerNames: [], expiresAt: Date.now() + 60_000 });
  assert.equal((await f.build(readEvidence)).status, "learning_blocked");
  assert.equal((await f.build(evidence[0].evidenceId, { responsePath: "data" })).status, "learning_blocked");
  const built = await f.build(evidence[0].evidenceId);
  assert.equal(f.rows.get(built.toolId)?.kind, "write");
  assert.ok(!f.rows.get(built.toolId)?.inputSchemaJson.includes("PRIVATE_"));
});

test("write verification is a local structural dry run with new arguments and no transport or approval", async () => {
  const f = fixture();
  const { toolId } = await f.prepared();
  const receipt = await f.tool("verify_app_tool", { toolId, args: intended });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.validation, "structural_only");
  assert.equal(receipt.executed, false);
  assert.equal(receipt.kind, "write");
  assert.deepEqual(receipt.preview.args.body, intended);
  assert.equal(receipt.preview.args.query.list, "PRIVATE_FIXED_TARGET");
  assert.ok(!JSON.stringify(receipt).includes("PRIVATE_CAPTURED_"));
  assert.ok(!JSON.stringify(receipt).includes("PRIVATE_SESSION_SECRET"));
  assert.equal(f.rows.get(toolId)?.status, "verified");
  assert.equal(JSON.parse(f.rows.get(toolId)!.verificationJson).executed, false);
  assert.equal(f.actions.length, 0);
  assert.equal(f.table("approvals").length, 0);
  assert.equal(f.table("appLearnedWrites").length, 0);
  assert.equal(f.scheduled.length, 0);
});

test("missing, extra, mistyped and credential-valued fields cannot pass a write dry run", async () => {
  const f = fixture();
  const { toolId } = await f.prepared();
  for (const args of [
    {}, { ...intended, title: undefined }, { ...intended, extra: "not observed" },
    { ...intended, metrics: { repetitions: "three" } }, { ...intended, metrics: { repetitions: 3, hidden: true } },
    { ...intended, labels: [4] }, { ...intended, title: "PRIVATE_SESSION_SECRET" },
  ]) assert.equal((await f.tool("verify_app_tool", { toolId, args })).status, "learning_blocked");
  assert.equal(f.rows.get(toolId)?.status, "draft");
  assert.equal(f.actions.length, 0);
});

test("publishing a write requires its structural receipt and only changes private tool metadata", async () => {
  const f = fixture();
  const { toolId } = await f.prepared();
  assert.equal((await f.tool("publish_app_tool", { toolId })).status, "learning_blocked");
  await f.tool("verify_app_tool", { toolId, args: intended });
  const published = await f.tool("publish_app_tool", { toolId });
  assert.deepEqual(published, { toolId, status: "published", kind: "write", private: true, requiresApproval: true });
  assert.equal(f.actions.length, 0);
  assert.equal(f.scheduled.length, 0);
  assert.equal(f.table("approvals").length, 0);
  assert.equal(f.table("appLearnedWrites").length, 0);
  assert.equal(f.table("recipes").length, 0);
});

test("calling a published write routes to a five-minute exact-action approval and never directly dispatches", async (t) => {
  const now = 5_000_000;
  t.mock.method(Date, "now", () => now);
  const f = fixture();
  const { toolId } = await f.prepared();
  await f.tool("verify_app_tool", { toolId, args: intended });
  await f.tool("publish_app_tool", { toolId });
  const args = { toolId, args: intended, requestId: "request_write_123" };
  const result = await f.tool("call_learned_tool", args);
  assert.equal(result.status, "approval_required");
  assert.equal(result.executed, false);
  assert.deepEqual(result.preview.args.body, intended);
  assert.deepEqual(result.preview.args.query, { list: "PRIVATE_FIXED_TARGET" });
  const approval = f.rows.get(result.approvalId)!;
  assert.equal(approval.status, "pending");
  assert.equal(approval.userId, f.user);
  assert.equal(approval.expiresAt, now + 5 * 60_000);
  assert.equal(approval.runState, undefined);
  const intent = f.rows.get(approval.learnedWriteId)!;
  assert.deepEqual(JSON.parse(intent.requestJson), { method: "POST", url: `${origin}/api/notes?list=PRIVATE_FIXED_TARGET`, body: JSON.stringify({ completed: true, labels: ["new label"], metrics: { repetitions: 3 }, title: "New explicit note" }) });
  assert.equal(intent.dispatchedAt, undefined);
  assert.ok(!intent.requestJson.includes("PRIVATE_CAPTURED_"));
  assert.equal(f.actions.length, 0);
  assert.deepEqual(f.scheduled, ["approvals:expire", "appLearningWrites:expireUnstarted"].map((name) => ({ name, args: { approvalId: result.approvalId, delay: 5 * 60_000 } })));
  assert.ok(f.mutations.some((call) => call.name === "appLearningWrites:request" && call.args.requestId === args.requestId));
  assert.deepEqual(await f.tool("call_learned_tool", args), result);
  assert.equal(f.table("approvals").length, 1);
  assert.equal(f.table("appLearnedWrites").length, 1);
  assert.ok(!f.tables.includes("approvalGrants"));
});

test("calling a learned write without a valid request ID cannot create an intent or approval", async () => {
  const f = fixture();
  const { toolId } = await f.prepared();
  await f.tool("verify_app_tool", { toolId, args: intended });
  await f.tool("publish_app_tool", { toolId });
  for (const requestId of [undefined, "short", "contains spaces", "x".repeat(129)]) {
    assert.equal((await f.tool("call_learned_tool", { toolId, args: intended, requestId })).status, "learning_blocked");
  }
  assert.equal(f.table("approvals").length, 0);
  assert.equal(f.table("appLearnedWrites").length, 0);
  assert.equal(f.actions.length, 0);
});

test("capture learning supports observed JSON write methods while excluding financial, security and foreign-origin operations", async () => {
  const f = fixture();
  const base = f.entries[0];
  f.entries.splice(0, f.entries.length, ...["POST", "PUT", "PATCH", "DELETE"].map((method) => ({ ...base, method })),
    ...["/api/payments", "/api/account/password", "/api/notes?token=PRIVATE_QUERY_SECRET"].map((path) => ({ ...base, url: origin + path })),
    { ...base, url: "https://foreign.other.test/api/notes" },
    { ...base, reqBody: '{"amount":100,"currency":"USD"}' },
    { ...base, reqHeaders: { "content-type": "application/x-www-form-urlencoded" }, reqBody: "title=private" });
  const result = await f.inspect();
  assert.deepEqual(result.evidence.map((evidence: any) => evidence.method).sort(), ["DELETE", "PATCH", "POST", "PUT"]);
  assert.ok(!JSON.stringify(result).includes("PRIVATE_"));
  assert.equal(f.actions.length, 0);
});
