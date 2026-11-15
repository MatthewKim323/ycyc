/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { getFunctionName } from "convex/server";
import type { Id } from "../../convex/_generated/dataModel";
import * as providerFunctions from "../../convex/aiProviders";

// Convex retains _handler at runtime for local invocation but intentionally
// strips its internal declaration from the published package's public types.
// Keep this test-only bridge here; production handlers retain generated types.
const providers = providerFunctions as unknown as {
  [Name in keyof typeof providerFunctions]: {
    _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<any>;
  };
};

type Row = Record<string, unknown> & { _id: string };
const userA = "user-a" as Id<"users">;
const userB = "user-b" as Id<"users">;
const token = "private-capability-a";

function fixture() {
  const records = new Map<string, Row>([
    [userA, { _id: userA, table: "users", mcpToken: token }],
    [userB, { _id: userB, table: "users", mcpToken: "private-capability-b" }],
  ]);
  const scheduled: { delay: number; name: string; args: unknown }[] = [];
  let next = 0;
  const db = {
    query(table: string) {
      const filters: [string, unknown][] = [];
      const selected = () => Array.from(records.values())
        .filter((row) => row.table === table && filters.every(([key, value]) => row[key] === value))
        .map((row) => structuredClone(row));
      const range = { eq(key: string, value: unknown) { filters.push([key, value]); return range; } };
      return {
        withIndex(_name: string, build: (indexRange: typeof range) => unknown) {
          build(range);
          return {
            collect: async () => selected(),
            unique: async () => {
              const rows = selected();
              assert.ok(rows.length <= 1, "fixture must preserve unique provider rows");
              return rows[0] ?? null;
            },
          };
        },
      };
    },
    async get(id: string) { return structuredClone(records.get(id) ?? null); },
    async insert(table: string, data: Record<string, unknown>) {
      const id = `${table}-${++next}`;
      records.set(id, { ...structuredClone(data), _id: id, table });
      return id;
    },
    async patch(id: string, patch: Record<string, unknown>) {
      const row = records.get(id);
      assert.ok(row);
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete row[key];
        else row[key] = structuredClone(value);
      }
    },
  };
  const ctx = {
    db,
    scheduler: {
      async runAfter(delay: number, ref: Parameters<typeof getFunctionName>[0], args: unknown) {
        scheduled.push({ delay, name: getFunctionName(ref), args });
        return "scheduled";
      },
    },
  } as unknown as Parameters<typeof providers.startLogin._handler>[0];
  function seed(overrides: Record<string, unknown> = {}) {
    const id = `session-${++next}` as Id<"aiProviderSessions">;
    records.set(id, {
      _id: id, table: "aiProviderSessions", userId: userA, provider: "claude", status: "starting",
      attemptId: "attempt-a", loginExpiresAt: Date.now() + 480_000,
      selected: false, updatedAt: Date.now() - 10_000, ...overrides,
    });
    return id;
  }
  return { ctx, records, scheduled, seed, row: (id: string) => records.get(id)! };
}

test("public APIs require the exact user capability before reading or changing provider state", async () => {
  const { ctx, records, scheduled } = fixture();
  const id = "irrelevant" as Id<"aiProviderSessions">;
  await assert.rejects(providers.status._handler(ctx, { token: "unknown" }), /yuzu session/);
  await assert.rejects(providers.startLogin._handler(ctx, { token: "", provider: "claude" }), /yuzu session/);
  await assert.rejects(providers.select._handler(ctx, { token: "unknown", provider: "codex" }), /yuzu session/);
  await assert.rejects(providers.disconnect._handler(ctx, { token: "unknown", provider: "claude" }), /yuzu session/);
  await assert.rejects(providers.forToken._handler(ctx, { token: "unknown" }), /yuzu session/);
  assert.equal(records.size, 2);
  assert.equal(scheduled.length, 0);
  assert.equal(await providers.get._handler(ctx, { sessionId: id }), null);
});

test("status returns both providers, omits secrets and other users, and hides durably expired challenges", async () => {
  const { ctx, seed } = fixture();
  assert.deepEqual(await providers.status._handler(ctx, { token }), [
    { provider: "claude", status: "disconnected", selected: false },
    { provider: "codex", status: "disconnected", selected: false },
  ]);
  seed({ status: "authorizing", loginUrl: "https://claude.ai/oauth/authorize?challenge=public", userCode: "DISPLAY-CODE",
    credentialsCipher: "sealed-credentials", codeCipher: "sealed-code", error: undefined });
  seed({ userId: userB, provider: "codex", status: "connected", selected: true, credentialsCipher: "other-user-secret" });
  const shown = await providers.status._handler(ctx, { token });
  assert.equal(shown[0]!.loginUrl, "https://claude.ai/oauth/authorize?challenge=public");
  assert.equal(shown[0]!.userCode, "DISPLAY-CODE");
  assert.equal(shown[1]!.status, "disconnected");
  const serialized = JSON.stringify(shown);
  for (const secret of ["sealed-credentials", "sealed-code", "other-user-secret", "userId", "credentialsCipher", "codeCipher"]) {
    assert.ok(!serialized.includes(secret));
  }
  const expired = fixture();
  const expiredId = expired.seed({ status: "authorizing", loginUrl: "https://claude.ai/", userCode: "EXPIRED", loginExpiresAt: Date.now() - 1 });
  await providers.expireLogin._handler(expired.ctx, { sessionId: expiredId, attemptId: "attempt-a" });
  const result = await providers.status._handler(expired.ctx, { token });
  assert.equal(result[0]!.status, "error");
  assert.equal(result[0]!.loginUrl, undefined);
  assert.equal(result[0]!.userCode, undefined);
  assert.match(result[0]!.error!, /expired/);
});

test("starting a login schedules user-bound native work and durable expiry once per live attempt", async () => {
  const f = fixture();
  const first = await providers.startLogin._handler(f.ctx, { token, provider: "codex" });
  const again = await providers.startLogin._handler(f.ctx, { token, provider: "codex" });
  assert.equal(first.attemptId.length, 48);
  assert.equal(again.attemptId, first.attemptId);
  assert.equal(f.scheduled.length, 2);
  assert.equal(f.scheduled[0]!.name, "providerActions:login");
  assert.equal(f.scheduled[0]!.delay, 0);
  assert.equal(f.scheduled[1]!.name, "aiProviders:expireLogin");
  assert.equal(f.scheduled[1]!.delay, 480_000);
  const row = await providers.forToken._handler(f.ctx, { token, provider: "codex" });
  assert.equal(row!.userId, userA);
  assert.equal(row!.status, "starting");
  assert.ok(row!.loginExpiresAt! > Date.now() + 470_000);
  const startingStatus = (await providers.status._handler(f.ctx, { token })).find((item: { provider: string }) => item.provider === "codex");
  assert.equal(startingStatus.status, "starting");
  assert.equal(startingStatus.loginExpiresAt, row!.loginExpiresAt);
  assert.deepEqual(f.scheduled[0]!.args, { sessionId: row!._id, attemptId: first.attemptId });
  assert.deepEqual(f.scheduled[1]!.args, f.scheduled[0]!.args);
});

test("durable expiry clears a stalled login exactly at its deadline and rejects all late callbacks", async (t) => {
  const f = fixture();
  const deadline = 2_000_000;
  let now = deadline - 1;
  t.mock.method(Date, "now", () => now);
  const id = f.seed({ status: "authorizing", loginExpiresAt: deadline, loginUrl: "https://claude.ai/", userCode: "DISPLAY",
    codeCipher: "sealed-code", credentialsCipher: "stale-sealed", selected: true });
  const args = { sessionId: id, attemptId: "attempt-a" };
  const before = structuredClone(f.row(id));
  assert.equal(await providers.expireLogin._handler(f.ctx, args), false);
  assert.deepEqual(f.row(id), before, "an early job must not shorten the login window");
  now = deadline;
  assert.equal(await providers.expireLogin._handler(f.ctx, args), true);
  assert.equal(f.row(id).status, "error");
  assert.equal(f.row(id).selected, false);
  assert.equal(f.row(id).updatedAt, deadline);
  for (const key of ["loginUrl", "userCode", "loginExpiresAt", "codeCipher", "credentialsCipher"]) assert.equal(f.row(id)[key], undefined);
  const shown = (await providers.status._handler(f.ctx, { token }))[0];
  assert.equal(shown.status, "error");
  assert.match(shown.error, /expired/);
  assert.equal(await providers.publishChallenge._handler(f.ctx, { ...args, loginUrl: "https://claude.ai/" }), false);
  assert.equal(await providers.completeLogin._handler(f.ctx, { ...args, credentialsCipher: "late" }), false);
  assert.equal(await providers.storeCode._handler(f.ctx, { ...args, codeCipher: "late" }), false);
  assert.equal(await providers.takeCode._handler(f.ctx, args), null);
  assert.equal(await providers.expireLogin._handler(f.ctx, args), false, "expiry delivery is idempotent");
});

test("old expiry jobs cannot cancel a retry, successful login, or disconnected session", async (t) => {
  const f = fixture();
  let now = 2_000_000;
  t.mock.method(Date, "now", () => now);
  const id = f.seed({ loginExpiresAt: now - 1 });
  const oldArgs = { sessionId: id, attemptId: "attempt-a" };
  const next = await providers.startLogin._handler(f.ctx, { token, provider: "claude" });
  assert.equal(await providers.expireLogin._handler(f.ctx, oldArgs), false);
  assert.equal(f.row(id).attemptId, next.attemptId);
  const args = { sessionId: id, attemptId: next.attemptId };
  assert.equal(await providers.completeLogin._handler(f.ctx, { ...args, credentialsCipher: "connected-sealed" }), true);
  now += 480_000;
  const connected = structuredClone(f.row(id));
  assert.equal(await providers.expireLogin._handler(f.ctx, args), false);
  assert.deepEqual(f.row(id), connected);
  await providers.disconnect._handler(f.ctx, { token, provider: "claude" });
  const disconnected = structuredClone(f.row(id));
  assert.equal(await providers.expireLogin._handler(f.ctx, args), false);
  assert.deepEqual(f.row(id), disconnected);
  assert.equal(await providers.expireLogin._handler(f.ctx, { sessionId: "missing", attemptId: "absent" }), false);
});

test("retrying invalidates old attempts, clears stale data, and throttles rapid failures", async () => {
  const f = fixture();
  const id = f.seed({ status: "error", credentialsCipher: "obsolete", codeCipher: "obsolete-code" });
  const result = await providers.startLogin._handler(f.ctx, { token, provider: "claude" });
  assert.notEqual(result.attemptId, "attempt-a");
  assert.equal(f.row(id).credentialsCipher, undefined);
  assert.equal(f.row(id).codeCipher, undefined);
  assert.equal(await providers.publishChallenge._handler(f.ctx, { sessionId: id, attemptId: "attempt-a", loginUrl: "https://claude.ai/" }), false);
  const rapid = fixture();
  rapid.seed({ status: "error", updatedAt: Date.now() });
  await assert.rejects(providers.startLogin._handler(rapid.ctx, { token, provider: "claude" }), /wait a few seconds/);
  assert.equal(rapid.scheduled.length, 0);
});

test("valid capabilities keep another user's provider selection, login, and disconnect isolated", async () => {
  const f = fixture();
  const mine = f.seed({ status: "connected", credentialsCipher: "mine", selected: true });
  const theirs = f.seed({ userId: userB, status: "connected", credentialsCipher: "theirs", selected: true });
  const before = structuredClone(f.row(mine));
  const otherToken = "private-capability-b";
  assert.equal((await providers.forToken._handler(f.ctx, { token: otherToken }))!._id, theirs);
  await assert.rejects(providers.select._handler(f.ctx, { token: otherToken, provider: "codex" }), /Connect this AI subscription/);
  await providers.startLogin._handler(f.ctx, { token: otherToken, provider: "codex" });
  await providers.disconnect._handler(f.ctx, { token: otherToken, provider: "claude" });
  assert.deepEqual(f.row(mine), before);
  assert.equal(f.row(theirs).status, "disconnected");
  assert.equal((await providers.forToken._handler(f.ctx, { token, provider: "codex" })), null);
});

test("login challenges must belong to the live attempt and an exact official HTTPS provider host", async () => {
  const f = fixture();
  const id = f.seed();
  for (const loginUrl of ["http://claude.ai/", "https://claude.ai.evil.invalid/", "https://evil.invalid/claude.ai", "https://user:pass@claude.ai/", "https://claude.ai:8443/", "https://claude.ai/#token", "https://auth.openai.com/"]) {
    await assert.rejects(providers.publishChallenge._handler(f.ctx, { sessionId: id, attemptId: "attempt-a", loginUrl }), /Invalid provider login URL/);
  }
  assert.equal(await providers.publishChallenge._handler(f.ctx, { sessionId: id, attemptId: "stale", loginUrl: "https://claude.ai/" }), false);
  assert.equal(await providers.publishChallenge._handler(f.ctx, { sessionId: id, attemptId: "attempt-a", loginUrl: "https://claude.ai/oauth/authorize?challenge=ok" }), true);
  assert.equal(await providers.publishChallenge._handler(f.ctx, { sessionId: id, attemptId: "attempt-a", loginUrl: "https://platform.claude.com/oauth/authorize?code=true" }), true);
  assert.equal(f.row(id).status, "authorizing");
  const codex = f.seed({ provider: "codex" });
  assert.equal(await providers.publishChallenge._handler(f.ctx, { sessionId: codex, attemptId: "attempt-a", loginUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-EFGH" }), true);
  assert.equal(f.row(codex).userCode, "ABCD-EFGH");
  const expired = f.seed({ provider: "codex", loginExpiresAt: Date.now() - 1 });
  assert.equal(await providers.publishChallenge._handler(f.ctx, { sessionId: expired, attemptId: "attempt-a", loginUrl: "https://auth.openai.com/" }), false);
});

test("only Claude accepts one sealed callback code and consumes it once per attempt", async () => {
  const f = fixture();
  const id = f.seed({ status: "authorizing" });
  assert.equal(await providers.storeCode._handler(f.ctx, { sessionId: id, attemptId: "wrong", codeCipher: "sealed-auth-code" }), false);
  assert.equal(await providers.storeCode._handler(f.ctx, { sessionId: id, attemptId: "attempt-a", codeCipher: "sealed-auth-code" }), true);
  assert.equal(await providers.storeCode._handler(f.ctx, { sessionId: id, attemptId: "attempt-a", codeCipher: "overwrite" }), false);
  assert.equal(await providers.takeCode._handler(f.ctx, { sessionId: id, attemptId: "attempt-a" }), "sealed-auth-code");
  assert.equal(await providers.takeCode._handler(f.ctx, { sessionId: id, attemptId: "attempt-a" }), null);
  assert.equal(await providers.storeCode._handler(f.ctx, { sessionId: id, attemptId: "attempt-a", codeCipher: "replayed" }), false);
  const codex = f.seed({ provider: "codex", status: "authorizing" });
  assert.equal(await providers.storeCode._handler(f.ctx, { sessionId: codex, attemptId: "attempt-a", codeCipher: "not-supported" }), false);
  assert.equal(await providers.takeCode._handler(f.ctx, { sessionId: codex, attemptId: "attempt-a" }), null);
});

test("login completion selects the first connected provider and atomically allows switching", async () => {
  const f = fixture();
  const claude = f.seed();
  const codex = f.seed({ provider: "codex" });
  assert.equal(await providers.completeLogin._handler(f.ctx, { sessionId: claude, attemptId: "attempt-a", credentialsCipher: "claude-sealed" }), true);
  assert.equal(f.row(claude).selected, true);
  assert.equal(await providers.completeLogin._handler(f.ctx, { sessionId: codex, attemptId: "attempt-a", credentialsCipher: "codex-sealed" }), true);
  assert.equal(f.row(codex).selected, false);
  assert.equal((await providers.forToken._handler(f.ctx, { token }))!._id, claude);
  await providers.select._handler(f.ctx, { token, provider: "codex" });
  assert.equal(f.row(claude).selected, false);
  assert.equal(f.row(codex).selected, true);
  assert.equal((await providers.forToken._handler(f.ctx, { token }))!._id, codex);
  assert.equal((await providers.forToken._handler(f.ctx, { token, provider: "claude" }))!._id, claude);
  assert.equal((await providers.status._handler(f.ctx, { token })).filter((row: { selected: boolean }) => row.selected).length, 1);
  assert.deepEqual(await providers.startLogin._handler(f.ctx, { token, provider: "codex" }), { attemptId: "attempt-a" });
  assert.equal(f.scheduled.length, 0, "already connected providers must not create another login process");
  const unknown = fixture();
  await assert.rejects(providers.select._handler(unknown.ctx, { token, provider: "codex" }), /Connect this AI subscription/);
});

test("disconnect wipes private state and invalidates late login completion without touching another user", async () => {
  const f = fixture();
  const id = f.seed({ status: "connected", selected: true, credentialsCipher: "sealed", codeCipher: "sealed-code", loginUrl: "https://claude.ai/", userCode: "code" });
  const other = f.seed({ userId: userB, status: "connected", selected: true, credentialsCipher: "other-private" });
  await providers.disconnect._handler(f.ctx, { token, provider: "claude" });
  const row = f.row(id);
  assert.equal(row.status, "disconnected");
  assert.equal(row.selected, false);
  for (const key of ["credentialsCipher", "codeCipher", "loginUrl", "userCode", "attemptId"]) assert.equal(row[key], undefined);
  assert.equal(f.row(other).credentialsCipher, "other-private");
  assert.equal(await providers.completeLogin._handler(f.ctx, { sessionId: id, attemptId: "attempt-a", credentialsCipher: "late" }), false);
  assert.equal(await providers.takeCode._handler(f.ctx, { sessionId: id, attemptId: "attempt-a" }), null);
});

test("login failure never stores raw provider details and only applies to its current live attempt", async () => {
  const f = fixture();
  const id = f.seed({ status: "authorizing", loginUrl: "https://claude.ai/", codeCipher: "sealed-code" });
  assert.equal(await providers.failLogin._handler(f.ctx, { sessionId: id, attemptId: "stale", error: "secret-token" }), false);
  assert.equal(await providers.failLogin._handler(f.ctx, { sessionId: id, attemptId: "attempt-a", error: "secret-token https://private.invalid" }), true);
  assert.equal(f.row(id).status, "error");
  assert.equal(f.row(id).codeCipher, undefined);
  assert.ok(!JSON.stringify(await providers.status._handler(f.ctx, { token })).includes("secret-token"));
  assert.equal(await providers.completeLogin._handler(f.ctx, { sessionId: id, attemptId: "attempt-a", credentialsCipher: "late" }), false);
});

test("expired attempts cannot publish credentials or codes and empty sealed data never marks connected", async () => {
  const f = fixture();
  const expired = f.seed({ status: "authorizing", loginExpiresAt: Date.now() - 1 });
  assert.equal(await providers.completeLogin._handler(f.ctx, { sessionId: expired, attemptId: "attempt-a", credentialsCipher: "late-sealed" }), false);
  assert.equal(await providers.storeCode._handler(f.ctx, { sessionId: expired, attemptId: "attempt-a", codeCipher: "late-code" }), false);
  const live = f.seed({ provider: "codex" });
  await assert.rejects(providers.completeLogin._handler(f.ctx, { sessionId: live, attemptId: "attempt-a", credentialsCipher: "" }), /Invalid sealed provider data/);
  assert.equal(f.row(live).status, "starting");
  assert.equal(f.row(live).credentialsCipher, undefined);
});
