/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { getFunctionName } from "convex/server";
import { run } from "../../convex/pipeline";
import type { Recipe } from "../../src/lib/contract";

const pipeline = run as unknown as { _handler: (ctx: unknown, args: { buildId: string }) => Promise<void> };
type Call = { name: string; args: Record<string, any> };

function fixture(best: Recipe | null = null, empty = false) {
  const sessionJson = JSON.stringify({ capturedAt: 123, headers: { authorization: "private-session-marker" } });
  const conn = { _id: "connection-a", userId: "user-a", appSlug: "app_123", status: "building", sessionJson };
  const build = { _id: "build-a", connectionId: conn._id, appSlug: conn.appSlug, status: "running" };
  const entries = empty ? [] : [{ id: "capture-a", ts: 123, method: "GET", url: "https://notes.example.test/api/notes",
    status: 200, initiator: "fetch", reqHeaders: { authorization: "<redacted:authorization>" }, resBody: '{"notes":[]}' }];
  const originalEntries = JSON.stringify(entries);
  const mutations: Call[] = [], queries: Call[] = [], scheduled: Call[] = [];
  const ctx = {
    runQuery: async (ref: Parameters<typeof getFunctionName>[0], args: Record<string, any>) => {
      const name = getFunctionName(ref);
      queries.push({ name, args });
      if (name === "builds:get") return build;
      if (name === "connections:get") return conn;
      if (name === "apps:resolve") return { slug: conn.appSlug, name: "Test Notes", route: "web", discovered: true };
      if (name === "connections:captureEntries") return entries;
      if (name === "recipes:best") return best ? JSON.stringify(best) : null;
      throw new Error(`Unexpected query ${name}`);
    },
    runMutation: async (ref: Parameters<typeof getFunctionName>[0], args: Record<string, any>) => {
      const name = getFunctionName(ref);
      mutations.push({ name, args });
      if (name === "builds:finish") build.status = args.status;
      else if (name === "connections:setStatus") conn.status = args.status;
      else if (!["builds:step", "activity:log"].includes(name)) throw new Error(`Unexpected mutation ${name}`);
    },
    runAction: async () => { throw new Error("No app request should run for these fixtures"); },
    scheduler: { runAfter: async (_delay: number, ref: Parameters<typeof getFunctionName>[0], args: Record<string, any>) => {
      scheduled.push({ name: getFunctionName(ref), args });
    } },
  };
  return { conn, build, entries, originalEntries, sessionJson, mutations, queries, scheduled, run: () => pipeline._handler(ctx, { buildId: build._id }) };
}

function recipe(status: Recipe["status"]): Recipe {
  return { appSlug: "app_123", version: 3, status, executor: "cloud", auth: { type: "cookie", sessionKeys: [] }, tools: [], playbook: [],
    provenance: { compiler: "hand", compiledAt: 1, captureCount: 0 } };
}

test("unknown web captures finish as private learning handoffs without shared recipe writes or execution", async () => {
  for (const best of [null, recipe("draft"), recipe("broken")]) {
    const f = fixture(best);
    await f.run();
    assert.equal(f.build.status, "done");
    assert.equal(f.conn.status, "capturing");
    assert.equal(f.conn.sessionJson, f.sessionJson);
    assert.equal(JSON.stringify(f.entries), f.originalEntries);
    assert.ok(!f.mutations.some((call) => call.name.startsWith("recipes:")));
    assert.ok(!f.mutations.some((call) => call.name === "activity:log"));
    assert.equal(f.scheduled.length, 0);
    assert.ok(!f.queries.some((call) => call.name === "recipes:latestVersion"));
    const steps = f.mutations.filter((call) => call.name === "builds:step");
    assert.ok(steps.some((call) => call.args.key === "capture" && call.args.status === "done"));
    for (const key of ["map", "generate", "verify", "publish"]) assert.ok(steps.some((call) => call.args.key === key && call.args.status === "skipped"));
    assert.deepEqual(f.mutations.find((call) => call.name === "builds:finish")?.args, { buildId: "build-a", status: "done" });
  }
});

test("an empty unknown capture remains available for agent research without claiming tools are live", async () => {
  const f = fixture(null, true);
  await f.run();
  assert.equal(f.conn.status, "capturing");
  assert.equal(f.build.status, "done");
  assert.ok(!f.mutations.some((call) => call.name.startsWith("recipes:")));
  assert.ok(!f.mutations.some((call) => call.name === "connections:setStatus" && call.args.status === "live"));
});

test("an existing verified recipe keeps its established publish path", async () => {
  const f = fixture(recipe("verified"));
  await f.run();
  assert.equal(f.conn.status, "live");
  assert.equal(f.build.status, "done");
  assert.ok(f.mutations.some((call) => call.name === "connections:setStatus" && call.args.recipeVersion === 3));
  assert.ok(f.mutations.some((call) => call.name === "activity:log"));
  assert.deepEqual(f.scheduled, [{ name: "today:refresh", args: { userId: "user-a" } }]);
});
