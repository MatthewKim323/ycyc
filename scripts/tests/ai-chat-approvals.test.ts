/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { getFunctionName } from "convex/server";
import { pendingApprovals, approvalResult } from "../../convex/aiChatApprovals";
import { approveTool } from "../../convex/aiChatActions";
import { decide } from "../../convex/approvals";

type Handler = { _handler: (ctx: any, args: any) => Promise<any> };
const pending = pendingApprovals as unknown as Handler;
const result = approvalResult as unknown as Handler;
const approve = approveTool as unknown as Handler;
const decideExisting = decide as unknown as Handler;
const token = "private-capability-user-a-123456";
const otherToken = "private-capability-user-b-987654";
function fixture() {
  const records = new Map<string, Record<string, any>>([
    ["user-a", { _id: "user-a", table: "users", mcpToken: token }],
    ["user-b", { _id: "user-b", table: "users", mcpToken: otherToken }],
  ]);
  const scheduled: unknown[] = [];
  const calls: { name: string; args: any }[] = [];
  let count = 0;
  const seed = (fields: Record<string, unknown> = {}) => {
    const id = `approval-${++count}`;
    records.set(id, { _id: id, table: "approvals", userId: "user-a", appSlug: "cronometer", tool: "log_food",
      title: "Log lunch", summary: "Add lunch", argsJson: JSON.stringify({ food: "rice", amount: 1 }),
      status: "pending", createdAt: Date.now() - count, expiresAt: Date.now() + 60_000, ...fields });
    return id;
  };
  const db = {
    get: async (id: string) => structuredClone(records.get(id) ?? null),
    patch: async (id: string, fields: Record<string, unknown>) => Object.assign(records.get(id)!, structuredClone(fields)),
    query(table: string) {
      const filters: [string, unknown][] = [];
      let desc = false;
      const range = { eq(key: string, value: unknown) { filters.push([key, value]); return range; } };
      const selected = () => [...records.values()].filter((row) => row.table === table && filters.every(([key, value]) => row[key] === value))
        .sort((a, b) => (a.createdAt - b.createdAt) * (desc ? -1 : 1)).map((row) => structuredClone(row));
      const query = {
        withIndex(_name: string, build: (q: typeof range) => unknown) { build(range); return query; },
        order(order: string) { desc = order === "desc"; return query; },
        take: async (limit: number) => selected().slice(0, limit),
        collect: async () => selected(),
        unique: async () => { const rows = selected(); assert.ok(rows.length <= 1); return rows[0] ?? null; },
      };
      return query;
    },
  };
  const mutationCtx = { db, scheduler: { runAfter: async (_delay: number, ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    scheduled.push({ name: getFunctionName(ref), args }); return "scheduled";
  } } };
  const actionCtx = {
    runQuery: async (ref: Parameters<typeof getFunctionName>[0], args: any) => {
      const name = getFunctionName(ref); calls.push({ name, args });
      if (name === "users:byToken") return [...records.values()].find((row) => row.table === "users" && row.mcpToken === args.token) ?? null;
      if (name === "approvals:get") return structuredClone(records.get(args.approvalId) ?? null);
      throw new Error(`Unexpected query ${name}`);
    },
    runMutation: async (ref: Parameters<typeof getFunctionName>[0], args: any) => {
      const name = getFunctionName(ref); calls.push({ name, args });
      assert.equal(name, "approvals:decide");
      return decideExisting._handler(mutationCtx, args);
    },
  };
  return { ctx: { db }, actionCtx, seed, records, calls, scheduled };
}

test("pending approvals are bounded and scoped to the exact authenticated user", async () => {
  const f = fixture();
  for (let index = 0; index < 60; index++) f.seed({ title: `mine-${index}` });
  f.seed({ userId: "user-b", title: "OTHER USER PRIVATE" });
  f.seed({ status: "approved", title: "already approved" });
  const rows = await pending._handler(f.ctx, { token });
  assert.equal(rows.length, 10);
  assert.ok(rows.every((row: { status: string }) => row.status === "pending"));
  const text = JSON.stringify(rows);
  assert.ok(!text.includes("OTHER USER PRIVATE"));
  assert.ok(!text.includes("already approved"));
  assert.ok(!text.includes("userId"));
  assert.deepEqual(rows[0].args, { food: "rice", amount: 1 });
  await assert.rejects(pending._handler(f.ctx, { token: "unknown" }), /yuzu session/);
  await assert.rejects(pending._handler(f.ctx, { token: "" }), /yuzu session/);
});

test("approval results reject a valid other-user capability before exposing receipts", async () => {
  const f = fixture();
  const approvalId = f.seed({ status: "approved", runState: "done", resultJson: JSON.stringify({ ok: true, text: "receipt only for a" }) });
  await assert.rejects(result._handler(f.ctx, { token: otherToken, approvalId }), /unavailable/);
  await assert.rejects(result._handler(f.ctx, { token: "unknown", approvalId }), /yuzu session/);
  await assert.rejects(result._handler(f.ctx, { token, approvalId: "missing" }), /unavailable/);
  const receipt = await result._handler(f.ctx, { token, approvalId });
  assert.equal(receipt.status, "approved");
  assert.equal(receipt.runState, "done");
  assert.deepEqual(receipt.result, { ok: true, text: "receipt only for a" });
});

test("public args and result redact nested private fields and exact capabilities while retaining useful data", async () => {
  const f = fixture();
  const privateData = { food: "rice", credentialsCipher: "SECRET_CIPHER", access_token: "SECRET_ACCESS",
    nested: { authorization: "SECRET_AUTH", cookie: "SECRET_COOKIE", password: "SECRET_PASSWORD", safe: "receipt" },
    list: [{ refreshToken: "SECRET_REFRESH", amount: 1 }], url: `https://example.test/mcp/${token}`,
    "$schema": "invalid Convex key" };
  const approvalId = f.seed({ argsJson: JSON.stringify(privateData), resultJson: JSON.stringify({ ok: true, text: "receipt", details: privateData }) });
  const args = await pending._handler(f.ctx, { token });
  const receipt = await result._handler(f.ctx, { token, approvalId });
  for (const exposed of [args, receipt]) {
    const serialized = JSON.stringify(exposed);
    for (const secret of ["SECRET_CIPHER", "SECRET_ACCESS", "SECRET_AUTH", "SECRET_COOKIE", "SECRET_PASSWORD", "SECRET_REFRESH", token, "$schema"]) {
      assert.ok(!serialized.includes(secret), `public tool data leaked ${secret}`);
    }
    assert.match(serialized, /rice|receipt/);
  }
});

test("JSON serialized tool output inside a receipt's text is redacted too", async () => {
  const f = fixture();
  const approvalId = f.seed({ resultJson: JSON.stringify({ ok: true,
    text: JSON.stringify({ item: "logged lunch", nested: { access_token: "SECRET_INSIDE_JSON_TEXT" }, url: `/mcp/${token}` }) }) });
  const receipt = await result._handler(f.ctx, { token, approvalId });
  const text = JSON.stringify(receipt);
  assert.ok(!text.includes("SECRET_INSIDE_JSON_TEXT"));
  assert.ok(!text.includes(token));
  assert.match(text, /logged lunch/);
});

test("approveTool authenticates owner before invoking the existing decision mutation, which schedules exactly once", async () => {
  const f = fixture();
  const approvalId = f.seed();
  const args = { token, approvalId, decision: "approve" };
  assert.deepEqual(await approve._handler(f.actionCtx, args), { status: "approved" });
  assert.deepEqual(f.calls, [
    { name: "users:byToken", args: { token } },
    { name: "approvals:get", args: { approvalId } },
    { name: "approvals:decide", args: { approvalId, decision: "approve" } },
  ]);
  assert.deepEqual(f.scheduled, [{ name: "approvalRunner:run", args: { approvalId } }]);
  assert.deepEqual(await approve._handler(f.actionCtx, args), { status: "approved" });
  assert.equal(f.scheduled.length, 1, "the existing decision mutation remains the only scheduling authority");
});

test("approveTool never delegates a foreign, missing, or unauthenticated approval", async () => {
  for (const failure of ["other-user", "missing", "unknown-token", "empty-token"]) {
    const f = fixture();
    const approvalId = f.seed();
    await assert.rejects(approve._handler(f.actionCtx, {
      token: failure === "other-user" ? otherToken : failure === "unknown-token" ? "unknown" : failure === "empty-token" ? "" : token,
      approvalId: failure === "missing" ? "missing" : approvalId, decision: "approve",
    }), /unavailable|yuzu session/);
    assert.ok(!f.calls.some((call) => call.name === "approvals:decide"));
    assert.equal(f.scheduled.length, 0);
    assert.equal(f.records.get(approvalId)!.status, "pending");
  }
});

test("deny and expired decisions also use the existing executor guard without scheduling a write", async () => {
  const f = fixture();
  const denied = f.seed();
  assert.deepEqual(await approve._handler(f.actionCtx, { token, approvalId: denied, decision: "deny" }), { status: "denied" });
  const expired = f.seed({ expiresAt: Date.now() - 1 });
  assert.deepEqual(await approve._handler(f.actionCtx, { token, approvalId: expired, decision: "approve" }), { status: "expired" });
  assert.equal(f.scheduled.length, 0);
});

test("public tool data redacts a capability even when untrusted JSON uses it as an object key", async () => {
  const f = fixture();
  const approvalId = f.seed({ argsJson: JSON.stringify({ [token]: "visible value" }),
    resultJson: JSON.stringify({ ok: true, details: { [`https://example.test/mcp/${token}`]: "receipt" } }) });
  assert.ok(!JSON.stringify(await pending._handler(f.ctx, { token })).includes(token));
  assert.ok(!JSON.stringify(await result._handler(f.ctx, { token, approvalId })).includes(token));
});

test("public tool data budgets include numeric arrays and object keys, not only string values", async () => {
  const f = fixture();
  const numeric = Array.from({ length: 100 }, () => Array.from({ length: 100 }, () => 1234567890));
  const wideKeys = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`field_${index}_${"x".repeat(200)}`, index]));
  const approvalId = f.seed({ argsJson: JSON.stringify({ numeric, wideKeys }),
    resultJson: JSON.stringify({ ok: true, details: { numeric, wideKeys } }) });
  for (const data of [(await pending._handler(f.ctx, { token }))[0], await result._handler(f.ctx, { token, approvalId })]) {
    assert.ok(Buffer.byteLength(JSON.stringify(data), "utf8") <= 40 * 1024, "public card exceeds the bounded payload budget");
  }
});
