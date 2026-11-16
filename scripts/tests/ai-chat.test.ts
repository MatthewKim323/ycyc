/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { getFunctionName } from "convex/server";
import * as functions from "../../convex/aiChat";

const api = functions as unknown as { [Name in keyof typeof functions]: { _handler: (ctx: unknown, args: any) => Promise<any> } };
type Row = Record<string, any> & { _id: string; table: string };
const token = "private-user-a";

function fixture() {
  let sequence = 0;
  const records = new Map<string, Row>();
  const seed = (table: string, fields: Record<string, unknown>) => {
    const _id = `${table}-${++sequence}`;
    records.set(_id, { ...fields, _id, table, _creationTime: sequence });
    return _id;
  };
  const user = seed("users", { mcpToken: token });
  const otherUser = seed("users", { mcpToken: "private-user-b" });
  const provider = seed("aiProviderSessions", { userId: user, provider: "claude", status: "connected", attemptId: "epoch-a", credentialsCipher: "sealed-a", selected: true });
  const otherProvider = seed("aiProviderSessions", { userId: otherUser, provider: "claude", status: "connected", attemptId: "epoch-b", credentialsCipher: "sealed-b", selected: true });
  const scheduled: { delay: number; name: string; args: unknown }[] = [];
  const db = {
    query(table: string) {
      const predicates: ((row: Row) => boolean)[] = [];
      let keys: string[] = [];
      let direction = 1;
      const range = {
        eq(key: string, value: unknown) { predicates.push((row) => row[key] === value); return range; },
        gt(key: string, value: number) { predicates.push((row) => row[key] > value); return range; },
      };
      const selected = () => [...records.values()].filter((row) => row.table === table && predicates.every((fn) => fn(row)))
        .sort((a, b) => {
          for (const key of [...keys, "_creationTime"]) {
            if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * direction;
          }
          return 0;
        }).map((row) => structuredClone(row));
      const query = {
        withIndex(name: string, build: (q: typeof range) => unknown) {
          keys = ({ by_user_client: ["userId", "clientMessageId"], by_user_status: ["userId", "status"],
            by_thread_created: ["threadId", "createdAt"], by_thread_seq: ["threadId", "seq"],
            by_user_updated: ["userId", "updatedAt"] } as Record<string, string[]>)[name] ?? [];
          build(range); return query;
        },
        order(order: string) { direction = order === "desc" ? -1 : 1; return query; },
        take: async (count: number) => selected().slice(0, count),
        collect: async () => selected(),
        first: async () => selected()[0] ?? null,
        unique: async () => { const rows = selected(); assert.ok(rows.length <= 1); return rows[0] ?? null; },
      };
      return query;
    },
    get: async (id: string) => structuredClone(records.get(id) ?? null),
    insert: async (table: string, fields: Record<string, unknown>) => seed(table, fields),
    patch: async (id: string, fields: Record<string, unknown>) => {
      const row = records.get(id)!;
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) delete row[key]; else row[key] = structuredClone(value);
      }
    },
  };
  const ctx = { db, scheduler: { runAfter: async (delay: number, ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    scheduled.push({ delay, name: getFunctionName(ref), args }); return "scheduled";
  } } };
  const send = (args: Record<string, unknown> = {}) => api.sendMessage._handler(ctx, { token, message: "hello", clientMessageId: "message-a", ...args });
  const row = (id: string) => records.get(id)!;
  return { ctx, records, seed, user, otherUser, provider, otherProvider, scheduled, send, row };
}

test("sending persists a sticky provider/auth epoch and schedules one native run plus durable expiry", async () => {
  const f = fixture();
  const ids = await f.send();
  const turn = f.row(ids.turnId);
  assert.equal(turn.status, "queued");
  assert.equal(turn.providerSessionId, f.provider);
  assert.equal(turn.providerAttemptId, "epoch-a");
  assert.equal(f.row(ids.threadId).provider, "claude");
  assert.equal(f.row(ids.threadId).activeTurnId, ids.turnId);
  assert.deepEqual(f.scheduled, [
    { delay: 0, name: "aiChatActions:run", args: { turnId: ids.turnId } },
    { delay: 480_000, name: "aiChat:expire", args: { turnId: ids.turnId } },
  ]);
  assert.deepEqual(await f.send(), ids);
  assert.equal(f.scheduled.length, 2);
  await assert.rejects(f.send({ message: "different" }), /already used/);
  await assert.rejects(f.send({ provider: "codex" }), /already used/);
  await assert.rejects(f.send({ clientMessageId: "message-b" }), /current reply/);
  assert.equal(await api.claim._handler(f.ctx, { turnId: ids.turnId }) !== null, true);
  await assert.rejects(f.send({ clientMessageId: "message-b" }), /current reply/);
  await api.finish._handler(f.ctx, { turnId: ids.turnId, status: "completed" });
  await assert.rejects(f.send({ threadId: ids.threadId, clientMessageId: "message-b", provider: "codex" }), /keeps the AI/);
});

test("all public reads and mutations require exact capabilities and enforce ID ownership", async () => {
  const f = fixture();
  const ids = await f.send();
  const foreign = { token: "private-user-b", ...ids };
  await assert.rejects(api.watchMessages._handler(f.ctx, foreign), /unavailable/);
  await assert.rejects(api.events._handler(f.ctx, foreign), /unavailable/);
  await assert.rejects(api.cancelTurn._handler(f.ctx, foreign), /unavailable/);
  await assert.rejects(f.send({ token: "private-user-b", threadId: ids.threadId }), /unavailable/);
  assert.deepEqual(await api.threads._handler(f.ctx, { token: "private-user-b" }), []);
  await assert.rejects(api.threads._handler(f.ctx, { token: "unknown" }), /yuzu session/);
  await assert.rejects(f.send({ token: "unknown" }), /yuzu session/);
  assert.equal(f.row(ids.turnId).status, "queued");
  const safe = JSON.stringify(await api.watchMessages._handler(f.ctx, { token, threadId: ids.threadId }));
  for (const privateField of ["credentialsCipher", "sealed-a", "providerSessionId", "providerAttemptId", "userId", token]) assert.ok(!safe.includes(privateField));
});

test("claim is single-use and stream reconnect returns monotonic normalized events without repeats", async () => {
  const f = fixture();
  const ids = await f.send();
  const claim = await api.claim._handler(f.ctx, { turnId: ids.turnId });
  assert.equal(claim.token, token);
  assert.equal(claim.credentialsCipher, "sealed-a");
  assert.deepEqual(claim.history, []);
  assert.equal(await api.claim._handler(f.ctx, { turnId: ids.turnId }), null);
  assert.equal(await api.active._handler(f.ctx, { turnId: ids.turnId }), true);
  assert.deepEqual(await api.append._handler(f.ctx, { turnId: ids.turnId, events: [
    { type: "text_delta", text: "hi " }, { type: "tool_start", name: "mcp__yuzu__food_search", id: "call_1" },
    { type: "tool_end", name: "mcp__yuzu__food_search", id: "call_1" }, { type: "text_delta", text: "there" },
  ] }), { ok: true, cursor: 4 });
  const first = await api.events._handler(f.ctx, { token, threadId: ids.threadId, limit: 2 });
  assert.deepEqual(first.events.map((event: { seq: number }) => event.seq), [1, 2]);
  assert.equal(first.cursor, 2); assert.equal(first.hasMore, true);
  const next = await api.events._handler(f.ctx, { token, threadId: ids.threadId, afterSeq: first.cursor, limit: 2 });
  assert.deepEqual(next.events.map((event: { seq: number }) => event.seq), [3, 4]);
  assert.equal(next.hasMore, false);
  const empty = await api.events._handler(f.ctx, { token, threadId: ids.threadId, afterSeq: next.cursor });
  assert.deepEqual(empty, { events: [], cursor: 4, hasMore: false });
  assert.equal(f.row(ids.turnId).assistantText, "hi there");
  await api.finish._handler(f.ctx, { turnId: ids.turnId, status: "completed", credentialsCipher: "refreshed-sealed" });
  assert.equal(f.row(f.provider).credentialsCipher, "refreshed-sealed");
  assert.equal(f.row(ids.threadId).activeTurnId, undefined);
  const nextTurn = await f.send({ threadId: ids.threadId, clientMessageId: "message-b", message: "continue" });
  const nextClaim = await api.claim._handler(f.ctx, { turnId: nextTurn.turnId });
  assert.deepEqual(nextClaim.history, [{ role: "user", content: "hello" }, { role: "assistant", content: "hi there" }]);
  await api.append._handler(f.ctx, { turnId: nextTurn.turnId, events: [{ type: "text_delta", text: "next" }] });
  assert.equal((await api.events._handler(f.ctx, { token, threadId: ids.threadId, afterSeq: 4 })).events[0].seq, 5);
});

test("restored text and its atomic cursor cannot skip a later generation delta", async () => {
  const f = fixture();
  const ids = await f.send();
  await api.claim._handler(f.ctx, { turnId: ids.turnId });
  await api.append._handler(f.ctx, { turnId: ids.turnId, events: [{ type: "text_delta", text: "before " }] });
  const snapshot = await api.watchMessages._handler(f.ctx, { token, threadId: ids.threadId });
  assert.equal(snapshot.cursor, 1);
  assert.equal(snapshot.turns[0].assistantText, "before ");
  // Generation continues while mobile reconstructs cards/history.
  await api.append._handler(f.ctx, { turnId: ids.turnId, events: [{ type: "text_delta", text: "during restore" }] });
  const resumed = await api.events._handler(f.ctx, { token, threadId: ids.threadId, afterSeq: snapshot.cursor });
  const restored = snapshot.turns[0].assistantText + resumed.events.map((event: { text?: string }) => event.text ?? "").join("");
  const latest = await api.watchMessages._handler(f.ctx, { token, threadId: ids.threadId });
  assert.equal(restored, latest.turns[0].assistantText);
  assert.equal(latest.cursor, 2);
});

test("cancellation is idempotent and blocks late streaming, completion, and credential writes", async () => {
  const f = fixture();
  const ids = await f.send();
  await api.claim._handler(f.ctx, { turnId: ids.turnId });
  assert.deepEqual(await api.cancelTurn._handler(f.ctx, { token, turnId: ids.turnId }), { status: "cancelled" });
  assert.deepEqual(await api.cancelTurn._handler(f.ctx, { token, turnId: ids.turnId }), { status: "cancelled" });
  assert.equal(await api.active._handler(f.ctx, { turnId: ids.turnId }), false);
  assert.equal((await api.append._handler(f.ctx, { turnId: ids.turnId, events: [{ type: "text_delta", text: "late" }] })).ok, false);
  assert.equal(await api.finish._handler(f.ctx, { turnId: ids.turnId, status: "completed", credentialsCipher: "late-sealed" }), false);
  assert.equal(f.row(f.provider).credentialsCipher, "sealed-a");
  assert.equal(f.row(ids.turnId).assistantText, "");
  const next = await f.send({ threadId: ids.threadId, clientMessageId: "message-b" });
  assert.equal(f.row(next.turnId).status, "queued");
});

test("reconnecting provider invalidates the old turn without overwriting the new account credentials", async () => {
  const f = fixture();
  const ids = await f.send();
  await api.claim._handler(f.ctx, { turnId: ids.turnId });
  Object.assign(f.row(f.provider), { attemptId: "epoch-new", credentialsCipher: "new-account" });
  assert.equal(await api.active._handler(f.ctx, { turnId: ids.turnId }), false);
  assert.equal((await api.append._handler(f.ctx, { turnId: ids.turnId, events: [{ type: "text_delta", text: "stale" }] })).ok, false);
  assert.equal(await api.finish._handler(f.ctx, { turnId: ids.turnId, status: "completed", credentialsCipher: "old-account-refresh" }), true);
  assert.equal(f.row(ids.turnId).status, "error");
  assert.equal(f.row(ids.turnId).error, "provider_disconnected");
  assert.equal(f.row(f.provider).credentialsCipher, "new-account");
  assert.equal(f.row(ids.threadId).activeTurnId, undefined);
});

test("queued turns cannot claim disconnected subscriptions and failed history is excluded", async () => {
  const f = fixture();
  const ids = await f.send();
  f.row(f.provider).status = "disconnected";
  assert.equal(await api.claim._handler(f.ctx, { turnId: ids.turnId }), null);
  assert.equal(f.row(ids.turnId).error, "provider_disconnected");
  f.row(f.provider).status = "connected";
  const next = await f.send({ threadId: ids.threadId, clientMessageId: "message-b" });
  assert.deepEqual((await api.claim._handler(f.ctx, { turnId: next.turnId })).history, []);
  await api.finish._handler(f.ctx, { turnId: next.turnId, status: "error", error: "raw oauth secret https://private.invalid" });
  assert.equal(f.row(next.turnId).error, "provider_error");
});

test("durable expiry handles worker crashes at the deadline and permits the next turn", async (t) => {
  const f = fixture();
  let now = 100_000;
  t.mock.method(Date, "now", () => now);
  const ids = await f.send();
  const args = { turnId: ids.turnId };
  assert.equal(await api.expire._handler(f.ctx, args), false);
  await api.claim._handler(f.ctx, args);
  now += 480_000;
  assert.equal(await api.active._handler(f.ctx, args), false);
  assert.equal(await api.finish._handler(f.ctx, { ...args, status: "completed", credentialsCipher: "late" }), false);
  assert.equal(await api.expire._handler(f.ctx, args), true);
  assert.equal(await api.expire._handler(f.ctx, args), false);
  assert.equal(f.row(ids.turnId).error, "turn_expired");
  assert.equal(f.row(ids.threadId).activeTurnId, undefined);
  assert.equal(f.row(f.provider).credentialsCipher, "sealed-a");
  const next = await f.send({ clientMessageId: "message-b" });
  assert.equal(await api.expire._handler(f.ctx, args), false);
  assert.equal(f.row(next.threadId).activeTurnId, next.turnId);
});

test("new sends recover overdue queued turns even before the scheduler delivers expiry", async (t) => {
  const f = fixture();
  let now = 100_000;
  t.mock.method(Date, "now", () => now);
  const old = await f.send();
  now += 480_000;
  const next = await f.send({ clientMessageId: "message-b" });
  assert.equal(f.row(old.turnId).status, "error");
  assert.equal(f.row(old.turnId).error, "turn_expired");
  assert.equal(f.row(next.turnId).status, "queued");
});

test("invalid input and stream limits cannot create unbounded state or persist an oversized batch", async () => {
  const f = fixture();
  await assert.rejects(f.send({ message: " " }), /Enter a message/);
  await assert.rejects(f.send({ message: "💬".repeat(5000) }), /16 KiB/);
  await assert.rejects(f.send({ clientMessageId: "id\ninvalid" }), /Invalid client/);
  const ids = await f.send();
  await api.claim._handler(f.ctx, { turnId: ids.turnId });
  for (const events of [[], [{ type: "text_delta", text: "x".repeat(8193) }], [{ type: "text_delta", text: "ok", name: "forged" }], [{ type: "tool_start", name: "unsafe\nname" }], [{ type: "tool_end", name: "safe_tool", text: "raw private tool output" }]]) {
    await assert.rejects(api.append._handler(f.ctx, { turnId: ids.turnId, events }), /Invalid/);
  }
  assert.equal(f.row(ids.turnId).assistantText, "");
  assert.equal(f.row(ids.threadId).nextSeq, 1);
  f.row(ids.turnId).outputBytes = 256 * 1024;
  assert.equal((await api.append._handler(f.ctx, { turnId: ids.turnId, events: [{ type: "text_delta", text: "overflow" }] })).ok, false);
  assert.equal(f.row(ids.turnId).error, "output_limit");
  assert.equal(f.row(ids.threadId).nextSeq, 1);
  await assert.rejects(api.events._handler(f.ctx, { token, threadId: ids.threadId, afterSeq: -1 }), /cursor/);
  await assert.rejects(api.watchMessages._handler(f.ctx, { token, threadId: ids.threadId, limit: 1.5 }), /page size/);
});

test("provider selection changes affect new chats while existing chats stay with their provider", async () => {
  const f = fixture();
  const first = await f.send();
  await api.claim._handler(f.ctx, { turnId: first.turnId });
  await api.finish._handler(f.ctx, { turnId: first.turnId, status: "completed" });
  f.row(f.provider).selected = false;
  const codex = f.seed("aiProviderSessions", { userId: f.user, provider: "codex", status: "connected", selected: true, attemptId: "codex-epoch", credentialsCipher: "codex-sealed" });
  const continued = await f.send({ threadId: first.threadId, clientMessageId: "message-b" });
  assert.equal(f.row(continued.turnId).providerSessionId, f.provider);
  await api.cancelTurn._handler(f.ctx, { token, turnId: continued.turnId });
  const newChat = await f.send({ clientMessageId: "message-c" });
  assert.equal(f.row(newChat.turnId).providerSessionId, codex);
  assert.equal(f.row(newChat.threadId).provider, "codex");
  const otherChat = await f.send({ token: "private-user-b" });
  assert.notEqual(otherChat.threadId, first.threadId);
  assert.equal(f.row(otherChat.turnId).providerSessionId, f.otherProvider);
  await assert.rejects(f.send({ threadId: first.threadId, clientMessageId: "message-c" }), /already used/);
});

test("event-count and serialized-byte caps terminate atomically without inserting excess events", async () => {
  for (const exhausted of [{ eventCount: 2000 }, { eventBytes: 512 * 1024 }]) {
    const f = fixture();
    const ids = await f.send();
    await api.claim._handler(f.ctx, { turnId: ids.turnId });
    Object.assign(f.row(ids.turnId), exhausted);
    assert.deepEqual(await api.append._handler(f.ctx, { turnId: ids.turnId, events: [{ type: "tool_start", name: "safe_tool" }] }), { ok: false, cursor: 0 });
    assert.equal(f.row(ids.turnId).status, "error");
    assert.equal(f.row(ids.turnId).error, "output_limit");
    assert.equal(f.row(ids.threadId).activeTurnId, undefined);
    assert.equal([...f.records.values()].filter((row) => row.table === "aiEvents").length, 0);
  }
});

test("history and public message pages stay bounded and omit older whole turns", async () => {
  const f = fixture();
  const ids = await f.send();
  const current = f.row(ids.turnId);
  for (let index = 0; index < 60; index++) {
    f.seed("aiTurns", { ...structuredClone(current),
      threadId: ids.threadId, createdAt: current.createdAt - 60 + index, status: "completed",
      message: `previous-${index}`, assistantText: "x".repeat(32 * 1024) });
  }
  const claim = await api.claim._handler(f.ctx, { turnId: ids.turnId });
  assert.equal(claim.history.length, 2, "two 32 KiB replies plus their inputs exceed the history byte cap");
  assert.equal(claim.history[0].content, "previous-59");
  const page = await api.watchMessages._handler(f.ctx, { token, threadId: ids.threadId, limit: 500 });
  assert.ok(page.turns.length < 50, "the byte cap applies even when the requested row cap is large");
  assert.equal(page.turns.at(-1).turnId, ids.turnId);
  assert.ok(page.turns.reduce((sum: number, turn: { message: string; assistantText: string }) => sum + Buffer.byteLength(turn.message) + Buffer.byteLength(turn.assistantText), 0) <= 1024 * 1024);
});

test("claim carries only bounded own approval identities and statuses, never private arguments or results", async () => {
  const f = fixture();
  const ids = await f.send();
  const expected: { id: string; appSlug: string; tool: string; status: string; hasResult: boolean }[] = [];
  for (const [status, limit] of [["pending", 5], ["approved", 3], ["denied", 2]] as const) {
    const own: typeof expected = [];
    for (let index = 0; index < 8; index++) {
      const hasResult = index % 2 === 0;
      const id = f.seed("approvals", { userId: f.user, status, appSlug: "cronometer", tool: `log_food_${index}`,
        argsJson: JSON.stringify({ credentialsCipher: "PRIVATE_ARGUMENT_CIPHER", food: "PRIVATE_FOOD_ARGUMENT" }),
        resultJson: hasResult ? JSON.stringify({ ok: true, text: "PRIVATE_RESULT_RECEIPT" }) : undefined,
        title: "PRIVATE_TITLE", summary: "PRIVATE_SUMMARY", connectionId: "PRIVATE_CONNECTION", runState: hasResult ? "done" : undefined });
      own.push({ id, appSlug: "cronometer", tool: `log_food_${index}`, status, hasResult });
    }
    expected.push(...own.slice(-limit).reverse());
    // Newer foreign rows must not displace the owner's recent approvals.
    for (let index = 0; index < 8; index++) f.seed("approvals", { userId: f.otherUser, status, appSlug: "PRIVATE_OTHER_APP",
      tool: "PRIVATE_OTHER_TOOL", resultJson: "PRIVATE_OTHER_RESULT" });
  }
  f.seed("approvals", { userId: f.user, status: "expired", appSlug: "PRIVATE_EXPIRED_APP", tool: "PRIVATE_EXPIRED_TOOL" });
  const claim = await api.claim._handler(f.ctx, { turnId: ids.turnId });
  assert.deepEqual(claim.approvals, expected);
  assert.equal(claim.approvals.length, 10);
  for (const item of claim.approvals) assert.deepEqual(Object.keys(item).sort(), ["appSlug", "hasResult", "id", "status", "tool"]);
  const serialized = JSON.stringify(claim.approvals);
  assert.ok(!serialized.includes("PRIVATE_"));
  for (const privateKey of ["argsJson", "resultJson", "userId", "connectionId", "runState", "summary", "title", "credentialsCipher"]) assert.ok(!serialized.includes(privateKey));
});

test("tool stream events reject raw text atomically while accepting normalized metadata up to 256 characters", async () => {
  const f = fixture();
  const ids = await f.send();
  await api.claim._handler(f.ctx, { turnId: ids.turnId });
  for (const type of ["tool_start", "tool_end"]) {
    await assert.rejects(api.append._handler(f.ctx, { turnId: ids.turnId, events: [
      { type: "text_delta", text: "must not partially persist" },
      { type, name: "safe_tool", id: "call_1", text: "PRIVATE_RAW_ARGUMENT_OR_RESULT" },
    ] }), /Invalid normalized stream event/);
    assert.equal(f.row(ids.turnId).assistantText, "");
    assert.equal(f.row(ids.threadId).nextSeq, 1);
    assert.equal(f.row(ids.turnId).eventCount, 0);
  }
  const metadata = "a".repeat(256);
  assert.deepEqual(await api.append._handler(f.ctx, { turnId: ids.turnId, events: [
    { type: "tool_start", name: metadata, id: metadata }, { type: "tool_end", name: metadata, id: metadata },
  ] }), { ok: true, cursor: 2 });
  for (const field of ["name", "id"]) await assert.rejects(api.append._handler(f.ctx, { turnId: ids.turnId,
    events: [{ type: "tool_start", [field]: metadata + "a" }] }), /Invalid normalized stream event/);
  const page = await api.events._handler(f.ctx, { token, threadId: ids.threadId });
  assert.equal(page.events.length, 2);
  assert.ok(page.events.every((event: { name: string; id: string; text?: string }) => event.name === metadata && event.id === metadata && event.text === undefined));
});

test("a subscription usage limit reaches the client without disconnecting or exposing provider details", async () => {
  const f = fixture();
  const ids = await f.send();
  await api.claim._handler(f.ctx, { turnId: ids.turnId });
  await api.finish._handler(f.ctx, { turnId: ids.turnId, status: "error", error: "usage_limit" });
  const view = await api.watchMessages._handler(f.ctx, { token, threadId: ids.threadId });
  assert.equal(view.turns[0].error, "usage_limit");
  assert.equal(f.row(f.provider).status, "connected");
  assert.equal(f.row(f.provider).credentialsCipher, "sealed-a");
  assert.equal(f.row(ids.threadId).activeTurnId, undefined);
});

function learningConnection(f: ReturnType<typeof fixture>, extra: Record<string, unknown> = {}) {
  const connectionId = f.seed("connections", { userId: f.user, appSlug: "myfitnesspal", status: "capturing",
    sessionJson: JSON.stringify({ headers: { authorization: "Bearer private-app-session" }, capturedAt: 123 }), ...extra });
  f.seed("captures", { connectionId, appSlug: extra.appSlug ?? "myfitnesspal", chunk: 0, count: 1,
    entriesJson: JSON.stringify([{ url: "https://example.test/api/items", resBody: "private-capture-content" }]) });
  return connectionId;
}

test("learnApp queues one real selected-provider turn per captured session, with no private values in its prompt", async () => {
  const f = fixture();
  const connectionId = learningConnection(f, { appSlug: "custom_calendar" });
  const first = await api.learnApp._handler(f.ctx, { token, connectionId });
  assert.equal(first.provider, "claude");
  const turn = f.row(first.turnId);
  assert.equal(turn.providerSessionId, f.provider);
  assert.equal(turn.providerAttemptId, "epoch-a");
  assert.equal(turn.status, "queued");
  assert.equal(f.row(connectionId).status, "capturing", "kickoff must not fake successful publication");
  assert.match(turn.message, /custom_calendar/);
  for (const tool of ["inspect_app_capture", "investigate_app", "build_app_tool", "verify_app_tool", "publish_app_tool"]) assert.ok(turn.message.includes(tool));
  assert.match(turn.message, /approval/);
  for (const secret of [token, "private-app-session", "private-capture-content", "sealed-a", "myfitnesspal", "Spotify"]) assert.ok(!turn.message.includes(secret));
  assert.deepEqual(f.scheduled, [
    { delay: 0, name: "aiChatActions:run", args: { turnId: first.turnId } },
    { delay: 480_000, name: "aiChat:expire", args: { turnId: first.turnId } },
  ]);
  assert.deepEqual(await api.learnApp._handler(f.ctx, { token, connectionId }), first);
  assert.equal(f.scheduled.length, 2);
  f.row(f.provider).selected = false;
  f.seed("aiProviderSessions", { userId: f.user, provider: "codex", selected: true, status: "connected", attemptId: "codex-new", credentialsCipher: "sealed-codex" });
  assert.deepEqual(await api.learnApp._handler(f.ctx, { token, connectionId }), first, "retry retains the original turn/provider");
  assert.equal(await api.claim._handler(f.ctx, { turnId: first.turnId }) !== null, true);
  assert.equal(await api.claim._handler(f.ctx, { turnId: first.turnId }), null);
});

test("learnApp rejects foreign capabilities, missing sessions/captures and unusable connections without scheduling", async () => {
  const f = fixture();
  const connectionId = learningConnection(f);
  await assert.rejects(api.learnApp._handler(f.ctx, { token: "unknown", connectionId }), /yuzu session/);
  await assert.rejects(api.learnApp._handler(f.ctx, { token: "private-user-b", connectionId }), /connection is unavailable/);
  await assert.rejects(api.learnApp._handler(f.ctx, { token, connectionId: "missing" }), /connection is unavailable/);
  for (const sessionJson of [undefined, "", "{}", "null", "[]", "invalid-json"]) {
    f.row(connectionId).sessionJson = sessionJson;
    await assert.rejects(api.learnApp._handler(f.ctx, { token, connectionId }), /current app capture/);
  }
  f.row(connectionId).sessionJson = JSON.stringify({ capturedAt: 123 });
  for (const status of ["needs_login", "needs_code", "building", "live", "error"]) {
    f.row(connectionId).status = status;
    await assert.rejects(api.learnApp._handler(f.ctx, { token, connectionId }), /current app capture/);
  }
  f.row(connectionId).status = "capturing";
  const capture = [...f.records.values()].find((row) => row.table === "captures")!;
  capture.count = 0;
  await assert.rejects(api.learnApp._handler(f.ctx, { token, connectionId }), /current app capture/);
  capture.count = 1; capture.appSlug = "other_app";
  await assert.rejects(api.learnApp._handler(f.ctx, { token, connectionId }), /current app capture/);
  f.records.delete(capture._id);
  await assert.rejects(api.learnApp._handler(f.ctx, { token, connectionId }), /current app capture/);
  assert.equal(f.scheduled.length, 0);
});

test("learnApp follows normal per-user concurrency and fresh-session idempotency boundaries", async () => {
  const f = fixture();
  const connectionId = learningConnection(f);
  const active = await f.send();
  await assert.rejects(api.learnApp._handler(f.ctx, { token, connectionId }), /current reply/);
  assert.equal(f.scheduled.length, 2);
  await api.cancelTurn._handler(f.ctx, { token, turnId: active.turnId });
  f.row(f.provider).selected = false;
  await assert.rejects(api.learnApp._handler(f.ctx, { token, connectionId }), /select an AI subscription/);
  f.row(f.provider).selected = true;
  const first = await api.learnApp._handler(f.ctx, { token, connectionId });
  await api.claim._handler(f.ctx, { turnId: first.turnId });
  await api.finish._handler(f.ctx, { turnId: first.turnId, status: "completed" });
  const repeated = await api.learnApp._handler(f.ctx, { token, connectionId });
  assert.deepEqual(repeated, first);
  f.row(connectionId).sessionJson = JSON.stringify({ headers: { authorization: "Bearer renewed-private-session" }, capturedAt: 456 });
  const renewed = await api.learnApp._handler(f.ctx, { token, connectionId });
  assert.notEqual(renewed.turnId, first.turnId);
  assert.equal(f.scheduled.length, 6);
  const ownSecond = learningConnection(f, { appSlug: "other_calendar" });
  await assert.rejects(api.learnApp._handler(f.ctx, { token, connectionId: ownSecond }), /current reply/);
  const foreignConnection = learningConnection(f, { userId: f.otherUser });
  const foreign = await api.learnApp._handler(f.ctx, { token: "private-user-b", connectionId: foreignConnection });
  assert.equal(f.row(foreign.turnId).providerSessionId, f.otherProvider);
});
