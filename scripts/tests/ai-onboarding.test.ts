/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { state } from "../../convex/aiOnboarding";

const onboarding = state as unknown as { _handler: (ctx: unknown, args: { token: string }) => Promise<unknown> };
const token = "private-onboarding-capability-a";
type Row = Record<string, unknown> & { table: string };
function fixture() {
  const rows: Row[] = [
    { table: "users", _id: "user-a", mcpToken: token },
    { table: "users", _id: "user-b", mcpToken: "private-onboarding-capability-b" },
  ];
  const readTables: string[] = [];
  const ctx = { db: {
    query(table: string) {
      readTables.push(table);
      const filters: [string, unknown][] = [];
      const range = { eq(key: string, value: unknown) { filters.push([key, value]); return range; } };
      const selected = () => rows.filter((row) => row.table === table && filters.every(([key, value]) => row[key] === value));
      return { withIndex(_index: string, build: (q: typeof range) => unknown) {
        build(range);
        return { collect: async () => selected(), unique: async () => { const found = selected(); assert.ok(found.length <= 1); return found[0] ?? null; } };
      } };
    },
  } };
  const provider = (overrides: Record<string, unknown> = {}) => rows.push({ table: "aiProviderSessions", userId: "user-a", provider: "claude",
    status: "connected", selected: true, credentialsCipher: "sealed-private-credentials", ...overrides });
  const connection = (overrides: Record<string, unknown> = {}) => rows.push({ table: "connections", userId: "user-a", appSlug: "cronometer", status: "live", ...overrides });
  return { provider, connection, readTables, run: (capability = token) => onboarding._handler(ctx, { token: capability }) };
}

test("AI connection always comes before apps, including users who already have live apps", async () => {
  const f = fixture();
  f.connection();
  assert.deepEqual(await f.run(), { step: "connect_ai", provider: null, connectedApps: 0, ready: false });
  assert.ok(!f.readTables.includes("connections"), "app state must not bypass the subscription gate");
});

test("only an own selected, connected provider with sealed credentials passes the AI gate", async () => {
  for (const invalid of [
    { status: "disconnected" }, { status: "starting" }, { status: "authorizing" }, { status: "error" },
    { selected: false }, { credentialsCipher: undefined }, { credentialsCipher: "" }, { userId: "user-b" },
  ]) {
    const f = fixture();
    f.provider(invalid);
    f.connection();
    assert.deepEqual(await f.run(), { step: "connect_ai", provider: null, connectedApps: 0, ready: false });
  }
});

test("a connected AI subscription leads to connect_apps until at least one own app is live", async () => {
  const f = fixture();
  f.provider({ provider: "codex" });
  f.connection({ userId: "user-b" });
  for (const status of ["needs_login", "needs_code", "capturing", "building", "error"]) f.connection({ status });
  assert.deepEqual(await f.run(), { step: "connect_apps", provider: "codex", connectedApps: 0, ready: false });
  f.connection();
  assert.deepEqual(await f.run(), { step: "ready", provider: "codex", connectedApps: 1, ready: true });
  f.connection({ appSlug: "strong" });
  assert.deepEqual(await f.run(), { step: "ready", provider: "codex", connectedApps: 2, ready: true });
});

test("valid users' providers and apps remain isolated and onboarding exposes no sealed credentials", async () => {
  const f = fixture();
  f.provider({ userId: "user-b", provider: "codex" });
  f.connection({ userId: "user-b" });
  assert.deepEqual(await f.run(), { step: "connect_ai", provider: null, connectedApps: 0, ready: false });
  const other = await f.run("private-onboarding-capability-b");
  assert.deepEqual(other, { step: "ready", provider: "codex", connectedApps: 1, ready: true });
  for (const secret of ["credentialsCipher", "sealed-private-credentials", "userId", "private-onboarding"]) assert.ok(!JSON.stringify(other).includes(secret));
});

test("onboarding rejects missing, unknown, or oversized capabilities before reading private state", async () => {
  for (const invalid of ["", "unknown", "x".repeat(257)]) {
    const f = fixture();
    f.provider(); f.connection();
    await assert.rejects(f.run(invalid), /yuzu session/);
    assert.ok(!f.readTables.includes("aiProviderSessions"));
    assert.ok(!f.readTables.includes("connections"));
  }
});
