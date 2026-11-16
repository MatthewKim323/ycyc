/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import * as approvals from "../../convex/approvals";
import { pendingApprovals } from "../../convex/aiChatApprovals";
import { approveTool } from "../../convex/aiChatActions";

type Handler = { _handler: (ctx: any, args: any) => Promise<any> };
const decide = approvals.decide as unknown as Handler;
const pending = approvals.pending as unknown as Handler;
const chatPending = pendingApprovals as unknown as Handler;
const approve = approveTool as unknown as Handler;
const token = "private-owner-capability";
const otherToken = "private-other-capability";
function fixture() {
  let next = 0;
  const rows = new Map<string, any>();
  const seed = (table: string, fields: object) => {
    const id = `${table}-${++next}`; rows.set(id, { ...fields, _id: id, table, _creationTime: next }); return id;
  };
  const owner = seed("users", { mcpToken: token, clerkUserId: "clerk-owner" });
  const other = seed("users", { mcpToken: otherToken, clerkUserId: "clerk-other" });
  let subject: string | null = null;
  const scheduled: any[] = [], mutations: any[] = [];
  const db = {
    get: async (id: string) => structuredClone(rows.get(id) ?? null),
    insert: async (table: string, fields: object) => seed(table, fields),
    delete: async (id: string) => { rows.delete(id); },
    patch: async (id: string, fields: Record<string, unknown>) => {
      mutations.push({ id, fields });
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) delete rows.get(id)[key]; else rows.get(id)[key] = structuredClone(value);
      }
    },
    query(table: string) {
      const filters: [string, unknown][] = [];
      let direction = 1;
      const range = { eq(key: string, value: unknown) { filters.push([key, value]); return range; } };
      const selected = () => [...rows.values()].filter((row) => row.table === table && filters.every(([key, value]) => row[key] === value))
        .sort((a, b) => direction * (a._creationTime - b._creationTime)).map((row) => structuredClone(row));
      const q = { withIndex(_name: string, build: (value: typeof range) => unknown) { build(range); return q; },
        order(value: string) { direction = value === "desc" ? -1 : 1; return q; },
        collect: async () => selected(), take: async (limit: number) => selected().slice(0, limit),
        unique: async () => { const found = selected(); assert.ok(found.length <= 1); return found[0] ?? null; },
        first: async () => selected()[0] ?? null };
      return q;
    },
  };
  const ctx = { db, auth: { getUserIdentity: async () => subject ? { subject } : null }, scheduler: {
    runAfter: async (delay: number, ref: Parameters<typeof getFunctionName>[0], args: unknown) => { scheduled.push({ delay, name: getFunctionName(ref), args }); return "scheduled"; },
  } };
  const makeApproval = (learned = true, fields: object = {}) => {
    const intentId = learned ? seed("appLearnedWrites", { userId: owner, previewJson: JSON.stringify({ method: "POST", path: "/api/diary", args: { food: "rice", amount: 2 } }),
      requestJson: '{"url":"https://private.example/api/diary","body":"PRIVATE_RUNTIME_REQUEST"}', expiresAt: Date.now() + 60_000 }) : undefined;
    const id = seed("approvals", { userId: owner, appSlug: "cronometer", tool: "log_food", assistant: "claude", title: "Log food", summary: "Add rice",
      argsJson: '{"PRIVATE_RAW_ARGS":"not public"}', status: "pending", createdAt: Date.now(), expiresAt: Date.now() + 60_000,
      ...(intentId ? { learnedWriteId: intentId } : {}), ...fields });
    if (intentId) rows.get(intentId).approvalId = id;
    return { id, intentId: intentId! };
  };
  return { ctx, rows, owner, other, seed, scheduled, mutations, makeApproval, setSubject: (value: string | null) => { subject = value; },
    grants: () => [...rows.values()].filter((row) => row.table === "approvalGrants") };
}

test("learned decisions reject missing or foreign capabilities and identities before any state change", async () => {
  for (const decision of ["approve", "deny", "approve_hour"]) for (const status of ["pending", "approved"]) {
    const f = fixture();
    const { id } = f.makeApproval(true, { status });
    for (const supplied of [undefined, otherToken]) {
      await assert.rejects(decide._handler(f.ctx, { approvalId: id, decision, token: supplied }), /unavailable/);
      f.setSubject("clerk-other");
      await assert.rejects(decide._handler(f.ctx, { approvalId: id, decision, token: supplied }), /unavailable/);
      f.setSubject(null);
    }
    assert.equal(f.rows.get(id).status, status);
    assert.equal(f.mutations.length, 0);
    assert.equal(f.scheduled.length, 0);
    assert.equal(f.grants().length, 0);
  }
});

test("exact owner capability permits one-time approval and repeated decisions schedule only once", async () => {
  const f = fixture();
  const { id } = f.makeApproval();
  const args = { approvalId: id, decision: "approve", token };
  assert.deepEqual(await decide._handler(f.ctx, args), { status: "approved" });
  assert.deepEqual(await decide._handler(f.ctx, args), { status: "approved" });
  assert.deepEqual(f.scheduled, [{ delay: 0, name: "approvalRunner:run", args: { approvalId: id } }]);
  assert.equal(f.grants().length, 0);
});

test("verified Clerk ownership is accepted without a capability and foreign subjects remain rejected", async () => {
  const f = fixture(); const { id } = f.makeApproval();
  f.setSubject("clerk-owner");
  assert.deepEqual(await decide._handler(f.ctx, { approvalId: id, decision: "approve" }), { status: "approved" });
  assert.equal(f.scheduled.length, 1);
  assert.equal(f.grants().length, 0);
});

test("learned hour approvals fail before status patches, expiration updates, or grants", async () => {
  for (const status of ["pending", "approved"]) {
    const f = fixture(); const { id } = f.makeApproval(true, { status, expiresAt: Date.now() - 1 });
    await assert.rejects(decide._handler(f.ctx, { approvalId: id, decision: "approve_hour", token }), /one-time/);
    assert.equal(f.rows.get(id).status, status);
    assert.equal(f.mutations.length, 0); assert.equal(f.scheduled.length, 0); assert.equal(f.grants().length, 0);
  }
});

test("denied and expired learned approvals never schedule execution or grant access", async (t) => {
  const f = fixture(); const denied = f.makeApproval();
  assert.deepEqual(await decide._handler(f.ctx, { approvalId: denied.id, decision: "deny", token }), { status: "denied" });
  assert.deepEqual(await decide._handler(f.ctx, { approvalId: denied.id, decision: "approve", token }), { status: "denied" });
  const now = Date.now(); t.mock.method(Date, "now", () => now);
  const expired = f.makeApproval(true, { expiresAt: now });
  assert.deepEqual(await decide._handler(f.ctx, { approvalId: expired.id, decision: "approve", token }), { status: "expired" });
  assert.equal(f.scheduled.length, 0); assert.equal(f.grants().length, 0);
});

test("pending learned previews require owner authentication while legacy pending rows remain compatible", async () => {
  const f = fixture(); const learned = f.makeApproval(); const legacy = f.makeApproval(false);
  assert.deepEqual((await pending._handler(f.ctx, { userId: f.owner })).map((row: any) => row._id), [legacy.id]);
  assert.deepEqual((await pending._handler(f.ctx, { userId: f.owner, token: otherToken })).map((row: any) => row._id), [legacy.id]);
  const allowed = await pending._handler(f.ctx, { userId: f.owner, token });
  const row = allowed.find((value: any) => value._id === learned.id);
  assert.equal(row.oneTimeOnly, true);
  assert.deepEqual(row.requestPreview, { method: "POST", path: "/api/diary", args: { food: "rice", amount: 2 } });
  assert.deepEqual(row.args, { food: "rice", amount: 2 });
  assert.ok(!JSON.stringify(row).includes("PRIVATE_RAW_ARGS"));
  assert.ok(!JSON.stringify(row).includes("PRIVATE_RUNTIME_REQUEST"));
  f.setSubject("clerk-owner");
  assert.equal((await pending._handler(f.ctx, { userId: f.owner })).length, 2);
});

test("chat pending approvals expose one-time previews with private values redacted", async () => {
  const f = fixture(); const { intentId } = f.makeApproval();
  f.rows.get(intentId).previewJson = JSON.stringify({ method: "POST", path: "/api/diary", args: { food: "rice", nested: { password: "PRIVATE_PASSWORD" }, note: token } });
  const rows = await chatPending._handler(f.ctx, { token });
  assert.equal(rows[0].oneTimeOnly, true);
  assert.equal(rows[0].requestPreview.args.food, "rice");
  for (const privateValue of [token, "PRIVATE_PASSWORD", "PRIVATE_RUNTIME_REQUEST", "PRIVATE_RAW_ARGS"]) assert.ok(!JSON.stringify(rows).includes(privateValue));
  assert.deepEqual(await chatPending._handler(f.ctx, { token: otherToken }), []);
});

test("a complete valid large preview is preserved in both approval query surfaces", async () => {
  const f = fixture(); const { intentId } = f.makeApproval();
  const preview = { method: "POST", path: "/api/items", args: { body: { first: "a".repeat(1800), second: "b".repeat(1800) } } };
  f.rows.get(intentId).previewJson = JSON.stringify(preview);
  const chat = await chatPending._handler(f.ctx, { token });
  const sheet = await pending._handler(f.ctx, { userId: f.owner, token });
  assert.deepEqual(chat[0].requestPreview, preview);
  assert.deepEqual(chat[0].args, preview.args);
  assert.deepEqual(sheet[0].requestPreview, preview);
});

test("preview ownership and exact approval binding cannot be substituted", async () => {
  for (const invalid of ["foreign-owner", "wrong-approval", "missing-intent", "expired-intent", "bad-url", "bad-json"]) {
    const f = fixture(); const { id, intentId } = f.makeApproval();
    const intent = f.rows.get(intentId);
    if (invalid === "foreign-owner") intent.userId = f.other;
    if (invalid === "wrong-approval") intent.approvalId = "other-approval";
    if (invalid === "missing-intent") f.rows.delete(intentId);
    if (invalid === "expired-intent") intent.expiresAt = Date.now() - 1;
    if (invalid === "bad-url") intent.previewJson = '{"method":"POST","path":"https://private.example/?token=PRIVATE","args":{}}';
    if (invalid === "bad-json") intent.previewJson = "PRIVATE_MALFORMED_JSON";
    await assert.rejects(decide._handler(f.ctx, { approvalId: id, decision: "approve", token }), /request is unavailable/);
    const rows = await pending._handler(f.ctx, { userId: f.owner, token });
    assert.equal(rows[0].requestPreview, null);
    assert.deepEqual(rows[0].args, {});
    assert.equal(f.rows.get(id).status, "pending"); assert.equal(f.scheduled.length, 0);
    assert.deepEqual(await decide._handler(f.ctx, { approvalId: id, decision: "deny", token }), { status: "denied" });
  }
});

test("approveTool passes the owner capability into the guarded decision mutation", async () => {
  const f = fixture(); const { id } = f.makeApproval();
  const delegated: any[] = [];
  const ctx = {
    runQuery: async (ref: Parameters<typeof getFunctionName>[0], args: any) => {
      const name = getFunctionName(ref);
      if (name === "users:byToken") return [...f.rows.values()].find((row) => row.table === "users" && row.mcpToken === args.token) ?? null;
      if (name === "approvals:get") return f.ctx.db.get(args.approvalId);
      throw new Error("Unexpected query");
    },
    runMutation: async (ref: Parameters<typeof getFunctionName>[0], args: any) => {
      assert.equal(getFunctionName(ref), "approvals:decide"); delegated.push(args); return decide._handler(f.ctx, args);
    },
  };
  assert.deepEqual(await approve._handler(ctx, { token, approvalId: id, decision: "approve" }), { status: "approved" });
  assert.deepEqual(delegated, [{ approvalId: id, decision: "approve", token }]);
  assert.equal(f.scheduled.length, 1);
});

test("legacy hour approvals still create their existing grant and schedule once", async () => {
  const f = fixture(); const { id } = f.makeApproval(false);
  assert.deepEqual(await decide._handler(f.ctx, { approvalId: id, decision: "approve_hour" }), { status: "approved" });
  assert.equal(f.grants().length, 1); assert.equal(f.scheduled.length, 1);
  assert.deepEqual(await decide._handler(f.ctx, { approvalId: id, decision: "approve_hour" }), { status: "approved" });
  assert.equal(f.grants().length, 1); assert.equal(f.scheduled.length, 1);
});
