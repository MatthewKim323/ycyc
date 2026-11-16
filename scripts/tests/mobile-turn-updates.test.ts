/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { getFunctionName } from "convex/server";
import type { Id } from "../../convex/_generated/dataModel";
import { snapshotEvents, streamTurnUpdates } from "../../src/lib/agent/turn-updates";

type Event = { seq: number; turnId: Id<"aiTurns">; type: "text_delta"; text: string; createdAt: number };
const threadId = "thread-a" as Id<"aiThreads">;
const turnId = "turn-a" as Id<"aiTurns">;
const token = "private-mobile-capability";
const event = (seq: number, text: string): Event => ({ seq, turnId, type: "text_delta", text, createdAt: seq });
function fixture() {
  const events: Event[] = [];
  const watches: { name: string; args: any; value?: any; error?: Error; listeners: Set<() => void> }[] = [];
  const cancellations: unknown[] = [];
  const reads: number[] = [];
  const cursors: number[] = [];
  let queryFails = false, setupFails = false;
  const client = {
    watchQuery(ref: Parameters<typeof getFunctionName>[0], args: any) {
      if (setupFails) throw new Error(`PRIVATE_SETUP_ERROR ${token}`);
      const watch = { name: getFunctionName(ref), args, listeners: new Set<() => void>() } as typeof watches[number];
      watches.push(watch);
      return {
        localQueryResult() { if (watch.error) throw watch.error; return watch.value; },
        onUpdate(callback: () => void) { watch.listeners.add(callback); return () => { watch.listeners.delete(callback); }; },
      };
    },
    async query(_ref: unknown, args: { afterSeq: number; limit: number }) {
      if (queryFails) throw new Error(`PRIVATE_DRAIN_ERROR ${token}`);
      reads.push(args.afterSeq);
      const matching = events.filter((item) => item.seq > args.afterSeq);
      const page = matching.slice(0, args.limit);
      return { events: page, cursor: page.at(-1)?.seq ?? args.afterSeq, hasMore: matching.length > page.length };
    },
    async mutation(_ref: unknown, args: unknown) { cancellations.push(args); return { status: "cancelled" }; },
  } as unknown as Parameters<typeof streamTurnUpdates>[0]["client"];
  function publish(name: string, value?: unknown, error?: Error) {
    for (const watch of watches.filter((watch) => watch.name === name)) {
      watch.value = value; watch.error = error;
      for (const callback of [...watch.listeners]) callback();
    }
  }
  const controller = new AbortController();
  const stream = (cursor = 0) => streamTurnUpdates({ client, token, threadId, turnId, cursor, signal: controller.signal,
    chunk: (value) => value.type === "text_delta" ? { type: "text", delta: value.text ?? "" } : null,
    error: () => "That didn't go through. Try again.", saveCursor: (value) => cursors.push(value) });
  const emitEvents = () => {
    for (const watch of watches.filter((watch) => watch.name === "aiChat:events")) {
      const page = events.filter((item) => item.seq > watch.args.afterSeq).slice(0, 200);
      watch.value = { events: page, cursor: page.at(-1)?.seq ?? watch.args.afterSeq, hasMore: false };
      for (const callback of [...watch.listeners]) callback();
    }
  };
  const terminal = () => publish("aiChat:watchMessages", { cursor: events.at(-1)?.seq ?? 0,
    turns: [{ turnId, status: "completed", assistantText: events.map((item) => item.text).join("") }] });
  return { client, events, watches, publish, stream, emitEvents, terminal, cancellations, cursors, reads, controller,
    failDrain: () => { queryFails = true; }, failSetup: () => { setupFails = true; },
    listeners: () => watches.reduce((sum, watch) => sum + watch.listeners.size, 0) };
}
async function within<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("stream did not settle")), 1000); })]); }
  finally { if (timer) clearTimeout(timer); }
}

test("restore uses the atomic text cursor even when card queries see newer text", async () => {
  const f = fixture();
  const snapshot = { assistantText: "before", cursor: 1 };
  f.events.push(event(1, "before"), event(2, "after")); // Generation advances after the snapshot.
  const cards = await snapshotEvents(f.client, token, threadId, snapshot.cursor);
  assert.deepEqual(cards.map((item) => item.seq), [1]);
  const iterator = f.stream(snapshot.cursor);
  const first = iterator.next();
  f.emitEvents();
  const chunk = await within(first);
  assert.deepEqual(chunk.value, { type: "text", delta: "after" });
  assert.equal(snapshot.assistantText + (chunk.value?.type === "text" ? chunk.value.delta : ""), "beforeafter");
  const done = iterator.next(); f.terminal();
  assert.equal((await within(done)).done, true);
  assert.deepEqual(f.cursors, [2]);
  assert.equal(f.listeners(), 0);
  assert.equal(f.cancellations.length, 0);
});

test("snapshot cards stop at their cursor and empty snapshots never read later events", async () => {
  const f = fixture();
  f.events.push(event(1, "old"), event(2, "new"));
  assert.deepEqual(await snapshotEvents(f.client, token, threadId, 0), []);
  assert.equal(f.reads.length, 0);
  assert.deepEqual((await snapshotEvents(f.client, token, threadId, 1)).map((item) => item.seq), [1]);
});

test("query subscription errors yield one safe error, finish promptly, and release both watchers", async () => {
  for (const name of ["aiChat:events", "aiChat:watchMessages"]) {
    const f = fixture();
    const iterator = f.stream();
    const first = iterator.next();
    f.publish(name, undefined, new Error(`PRIVATE_QUERY_ERROR ${token}`));
    const chunk = await within(first);
    assert.deepEqual(chunk.value, { type: "error", message: "That didn't go through. Try again." });
    assert.ok(!JSON.stringify(chunk).includes(token));
    assert.equal((await within(iterator.next())).done, true);
    assert.equal(f.listeners(), 0);
    assert.equal(f.cancellations.length, 1);
    assert.deepEqual(f.cursors, [0]);
  }
});

test("terminal drain failures surface a safe error instead of silently completing a truncated reply", async () => {
  const f = fixture();
  const iterator = f.stream();
  const first = iterator.next();
  f.failDrain(); f.terminal();
  assert.deepEqual((await within(first)).value, { type: "error", message: "That didn't go through. Try again." });
  assert.equal((await within(iterator.next())).done, true);
  assert.equal(f.listeners(), 0);
  assert.equal(f.cancellations.length, 1);
});

test("watcher setup failures and pre-aborted streams cleanly stop without exposing private errors", async () => {
  const failed = fixture(); failed.failSetup();
  const iterator = failed.stream();
  assert.deepEqual((await within(iterator.next())).value, { type: "error", message: "That didn't go through. Try again." });
  assert.equal((await within(iterator.next())).done, true);
  assert.equal(failed.listeners(), 0);
  const stopped = fixture(); stopped.controller.abort();
  assert.equal((await within(stopped.stream().next())).done, true);
  assert.equal(stopped.watches.length, 0);
  assert.equal(stopped.cancellations.length, 1);
});

test("terminal replay drains unseen events, dedupes already shown text, and saves the final cursor", async () => {
  const f = fixture();
  const iterator = f.stream();
  const first = iterator.next();
  f.events.push(event(1, "one")); f.emitEvents();
  assert.deepEqual((await within(first)).value, { type: "text", delta: "one" });
  const second = iterator.next();
  f.emitEvents(); // The same subscription snapshot must not append text twice.
  f.events.push(event(2, "two")); f.terminal();
  assert.deepEqual((await within(second)).value, { type: "text", delta: "two" });
  assert.equal((await within(iterator.next())).done, true);
  assert.deepEqual(f.cursors, [2]);
  assert.equal(f.listeners(), 0);
});
