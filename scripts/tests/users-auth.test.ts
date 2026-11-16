/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { get, linkAccount } from "../../convex/users";

type Handler = { _handler: (ctx: any, args: any) => Promise<any> };
const readUser = get as unknown as Handler;
const link = linkAccount as unknown as Handler;
type Row = Record<string, any> & { _id: string };
const token = "private-device-capability";
const signedIdentity = { subject: "clerk-a", issuer: "https://configured-clerk.example", tokenIdentifier: "issuer|clerk-a",
  email: "verified@example.test", name: "Verified Name", pictureUrl: "https://images.example.test/verified" };
function fixture(identity: Record<string, unknown> | null = signedIdentity) {
  const rows = new Map<string, Row>();
  const writes: { id: string; fields: unknown }[] = [];
  let next = 0, queries = 0;
  const seed = (fields: Record<string, unknown>) => {
    const id = `user-${++next}`;
    rows.set(id, { _id: id, plan: "free", mcpToken: token, createdAt: 1, ...fields });
    return id;
  };
  const db = {
    get: async (id: string) => structuredClone(rows.get(id) ?? null),
    query() {
      queries++;
      const predicates: [string, unknown][] = [];
      const range = { eq(key: string, value: unknown) { predicates.push([key, value]); return range; } };
      const selected = () => [...rows.values()].filter((row) => predicates.every(([key, value]) => row[key] === value));
      return { withIndex(_index: string, build: (q: typeof range) => unknown) {
        build(range);
        return {
          first: async () => structuredClone(selected()[0] ?? null),
          unique: async () => { const found = selected(); assert.ok(found.length <= 1); return structuredClone(found[0] ?? null); },
        };
      } };
    },
    patch: async (id: string, fields: Record<string, unknown>) => { writes.push({ id, fields }); Object.assign(rows.get(id)!, structuredClone(fields)); },
    insert: async (_table: string, fields: Record<string, unknown>) => { const id = seed(fields); writes.push({ id, fields }); return id; },
  };
  const ctx = { db, auth: { getUserIdentity: async () => identity } };
  return { ctx, rows, seed, writes, queries: () => queries };
}

test("public users.get exposes only billing identity and plan, never the MCP capability", async () => {
  const f = fixture();
  const userId = f.seed({ deviceId: "private-device", clerkUserId: "clerk-a", email: "private@example.test" });
  assert.deepEqual(await readUser._handler(f.ctx, { userId }), { userId, plan: "free" });
  assert.equal(await readUser._handler(f.ctx, { userId: "missing" }), null);
});

test("account linking rejects absent or mismatched Clerk identities before database access", async () => {
  for (const identity of [null, { ...signedIdentity, subject: "clerk-attacker" }, { ...signedIdentity, subject: "" }]) {
    const f = fixture(identity);
    f.seed({ deviceId: "target-device", clerkUserId: "clerk-a" });
    await assert.rejects(link._handler(f.ctx, { deviceId: "target-device", clerkUserId: "clerk-a", token }), /Sign in to sync/);
    assert.equal(f.queries(), 0);
    assert.equal(f.writes.length, 0);
  }
});

test("a valid Clerk user cannot claim or detach an existing device without its exact capability", async () => {
  for (const supplied of [undefined, "wrong-token", "x".repeat(257)]) {
    for (const existingAccount of [false, true]) {
      const f = fixture();
      f.seed({ deviceId: "target-device", ...(existingAccount ? { clerkUserId: "clerk-other" } : {}) });
      f.seed({ deviceId: "account-device", clerkUserId: "clerk-a", mcpToken: "private-account-capability" });
      const before = structuredClone([...f.rows]);
      await assert.rejects(link._handler(f.ctx, { deviceId: "target-device", clerkUserId: "clerk-a", token: supplied }), /device identity is unavailable/);
      assert.deepEqual([...f.rows], before);
      assert.equal(f.writes.length, 0);
    }
  }
});

test("claiming an owned anonymous device preserves its capability and trusts signed profile claims only", async () => {
  const f = fixture();
  const userId = f.seed({ deviceId: "my-device" });
  const res = await link._handler(f.ctx, { deviceId: "my-device", clerkUserId: "clerk-a", token,
    email: "forged@example.test", name: "Forged Name", imageUrl: "https://forged.example.test/avatar" });
  assert.equal(res.userId, userId);
  assert.ok(res.mcpUrl.endsWith(`/mcp/${token}`));
  assert.equal(f.rows.get(userId)!.clerkUserId, "clerk-a");
  assert.equal(f.rows.get(userId)!.email, signedIdentity.email);
  assert.equal(f.rows.get(userId)!.name, signedIdentity.name);
  assert.equal(f.rows.get(userId)!.imageUrl, signedIdentity.pictureUrl);
  assert.ok(!JSON.stringify([...f.rows]).includes("forged"));
});

test("verified linking reaches only its own account and detaches only the capability-proven device", async () => {
  const f = fixture();
  const anonymous = f.seed({ deviceId: "my-device" });
  const account = f.seed({ deviceId: "old-account-device", clerkUserId: "clerk-a", mcpToken: "account-a-capability", plan: "pro" });
  const other = f.seed({ deviceId: "other-device", clerkUserId: "clerk-b", mcpToken: "other-account-capability" });
  const beforeOther = structuredClone(f.rows.get(other));
  const res = await link._handler(f.ctx, { deviceId: "my-device", clerkUserId: "clerk-a", token });
  assert.deepEqual(res, { userId: account, mcpUrl: res.mcpUrl, plan: "pro" });
  assert.ok(res.mcpUrl.endsWith("/mcp/account-a-capability"));
  assert.match(f.rows.get(anonymous)!.deviceId, /^my-device#detached:/);
  assert.equal(f.rows.get(account)!.deviceId, "my-device");
  assert.deepEqual(f.rows.get(other), beforeOther);
});

test("a verified new device can restore its account without claiming an existing device row", async () => {
  const f = fixture();
  const account = f.seed({ deviceId: "old-device", clerkUserId: "clerk-a", mcpToken: "own-account-capability" });
  const res = await link._handler(f.ctx, { deviceId: "brand-new-device", clerkUserId: "clerk-a" });
  assert.equal(res.userId, account);
  assert.equal(f.rows.get(account)!.deviceId, "brand-new-device");
  assert.ok(res.mcpUrl.endsWith("/mcp/own-account-capability"));
});

test("a new verified account is created from the signed subject without trusting profile arguments", async () => {
  const f = fixture({ subject: "clerk-a", issuer: signedIdentity.issuer, tokenIdentifier: "issuer|clerk-a" });
  const res = await link._handler(f.ctx, { deviceId: "new-device", clerkUserId: "clerk-a", email: "forged@example.test", name: "Forged" });
  const row = f.rows.get(res.userId)!;
  assert.equal(row.clerkUserId, "clerk-a");
  assert.equal(row.email, undefined);
  assert.equal(row.name, undefined);
  assert.match(row.mcpToken, /^[a-f0-9]{48}$/);
});

test("missing profile claims preserve existing trusted values rather than replacing them with client input", async () => {
  const f = fixture({ subject: "clerk-a", issuer: signedIdentity.issuer, tokenIdentifier: "issuer|clerk-a" });
  const userId = f.seed({ deviceId: "my-device", clerkUserId: "clerk-a", email: "previous@example.test", name: "Previous" });
  await link._handler(f.ctx, { deviceId: "my-device", clerkUserId: "clerk-a", token, email: "forged@example.test", name: "Forged" });
  assert.equal(f.rows.get(userId)!.email, "previous@example.test");
  assert.equal(f.rows.get(userId)!.name, "Previous");
});
