/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { getFunctionName } from "convex/server";
import { handleMcpPost } from "../../convex/lib/mcp";
import { claudeTurnArguments } from "../../convex/lib/providerTurn";
import { SITE_URL } from "../../convex/lib/env";

const token = "private-learning-capability-a";
const operations = ["search_apps", "investigate_app", "inspect_app_capture", "build_app_tool", "verify_app_tool", "publish_app_tool", "call_learned_tool"];
type Call = { name: string; args: Record<string, any> };

function fixture() {
  const actions: Call[] = [], mutations: Call[] = [], queries: Call[] = [];
  const raw = {
    user: { _id: "user-a" }, connections: [], live: [] as { conn: Record<string, unknown>; recipeJson: string }[], publicRecipes: [],
    discovered: [{ slug: "app_123", name: "Test Notes", blurb: "Private notes" }],
  };
  const learned = [{ toolId: "learned-a", app: "app_123", name: "read_notes", title: "Read notes", status: "published" }];
  const ctx = {
    runQuery: async (ref: Parameters<typeof getFunctionName>[0], args: Record<string, any>) => {
      const name = getFunctionName(ref);
      queries.push({ name, args });
      if (name === "mcpData:context") return args.token === token ? raw : null;
      if (name === "appLearning:list") { assert.deepEqual(args, { token }); return learned; }
      if (name === "mcpData:names") return {};
      if (name === "approvals:activeGrant") return null;
      if (name === "approvals:get") return { status: "denied" };
      throw new Error(`Unexpected query ${name}`);
    },
    runAction: async (ref: Parameters<typeof getFunctionName>[0], args: Record<string, any>) => {
      actions.push({ name: getFunctionName(ref), args });
      return JSON.stringify({ ok: true, evidenceId: "evidence-a" });
    },
    runMutation: async (ref: Parameters<typeof getFunctionName>[0], args: Record<string, any>) => {
      const name = getFunctionName(ref);
      assert.ok(["activity:log", "approvals:create", "mcpData:saveSession"].includes(name), `Unexpected mutation ${name}`);
      mutations.push({ name, args });
      return "approval-a";
    },
  };
  const send = async (method: string, params: Record<string, unknown> = {}, capability = token) => {
    const response = await handleMcpPost(ctx as unknown as Parameters<typeof handleMcpPost>[0], new Request(`${SITE_URL}/mcp/${capability}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }));
    return { status: response.status, message: await response.json() as any };
  };
  const call = (name: string, args: unknown = {}, capability = token) => send("tools/call", { name, arguments: args }, capability);
  const addLive = (kind: "read" | "write" = "write") => raw.live.push({
    conn: { _id: "connection-a", userId: "user-a", appSlug: "app_123" },
    recipeJson: JSON.stringify({ tools: [{ name: "update_notes", title: "Update notes", description: "Update a note", kind,
      inputSchema: { type: "object", properties: { note: { type: "string" } }, required: ["note"] },
      request: { method: "POST", urlTemplate: "https://notes.example.test/private", headers: { authorization: "private-authorization-marker" } },
    }] }),
  });
  return { raw, learned, actions, mutations, queries, send, call, addLive };
}

test("MCP registers the bounded private learning workflow and stable generic callers", async () => {
  const f = fixture();
  const { message } = await f.send("tools/list");
  for (const name of [...operations, "call_app_tool"]) {
    const matching = message.result.tools.filter((tool: any) => tool.name === name);
    assert.equal(matching.length, 1);
    assert.equal(matching[0].inputSchema.additionalProperties, false);
  }
  const built = message.result.tools.find((tool: any) => tool.name === "build_app_tool");
  assert.ok(built.inputSchema.required.includes("evidenceId"));
  assert.equal(built.annotations.readOnlyHint, false);
  assert.match(built.description, /read-only/);
  const initialized = await f.send("initialize", { protocolVersion: "2025-03-26" });
  assert.match(initialized.message.result.instructions, /verify_app_tool and publish_app_tool/);
  assert.match(initialized.message.result.instructions, /pause until they do/);
});

test("every learning operation forwards the URL capability and fixed operation without trusting argument overrides", async () => {
  const f = fixture();
  for (const operation of operations) {
    const args = { app: "app_123", token: "foreign-capability", operation: "different_operation" };
    await f.call(operation, args);
    assert.deepEqual(f.actions.at(-1), { name: "appLearning:tool", args: { token, operation, argsJson: JSON.stringify(args) } });
  }
  const before = f.actions.length;
  const denied = await f.call("inspect_app_capture", { app: "app_123" }, "unknown-capability");
  assert.equal(denied.status, 404);
  assert.equal(f.actions.length, before);
});

test("list_apps discovers private tool IDs and newly connected tool schemas without leaking request credentials", async () => {
  const f = fixture();
  await f.send("tools/list");
  f.addLive(); // The connection appears after the client has cached its tools/list.
  const { message } = await f.call("list_apps");
  const value = JSON.parse(message.result.content[0].text);
  assert.deepEqual(value.learnedTools, f.learned);
  assert.ok(f.queries.some((query) => query.name === "appLearning:list" && query.args.token === token));
  const app = value.apps.find((item: any) => item.app === "app_123");
  assert.deepEqual(app.tools, ["app_123__update_notes"]);
  assert.equal(app.toolDefinitions[0].name, "update_notes");
  assert.deepEqual(app.toolDefinitions[0].inputSchema.required, ["note"]);
  for (const privateValue of ["private-authorization-marker", "urlTemplate", "sessionJson"]) assert.ok(!JSON.stringify(value).includes(privateValue));
});

test("connect_app accepts a discovered app's name and slug", async () => {
  const f = fixture();
  for (const app of ["Test Notes", "app_123"]) {
    const { message } = await f.call("connect_app", { app });
    assert.match(message.result.content[0].text, /connect\/app_123/);
    assert.ok(!message.result.isError);
  }
  const unknown = await f.call("connect_app", { app: "Unknown Notes" });
  assert.equal(unknown.message.result.isError, true);
  assert.match(unknown.message.result.content[0].text, /search_apps/);
});

test("generic existing write calls preserve the owning connection's phone approval path", async () => {
  const f = fixture();
  f.addLive();
  const { message } = await f.call("call_app_tool", { app: "app_123", tool: "update_notes", args: { note: "hello" } });
  assert.match(message.result.content[0].text, /denied/);
  assert.equal(message.result.isError, true);
  const approval = f.mutations.find((mutation) => mutation.name === "approvals:create");
  assert.ok(approval);
  assert.equal(approval.args.userId, "user-a");
  assert.equal(approval.args.connectionId, "connection-a");
  assert.equal(approval.args.tool, "update_notes");
  assert.deepEqual(JSON.parse(approval.args.argsJson), { note: "hello" });
  assert.equal(f.actions.length, 0, "a denied write must never execute or route through learning");
});

test("invalid learning and generic arguments fail before backend dispatch", async () => {
  const f = fixture();
  for (const args of [[], "hello", 12]) assert.equal((await f.call("search_apps", args)).message.error.code, -32602);
  assert.equal((await f.call("search_apps", { query: "x".repeat(17_000) })).message.error.code, -32602);
  for (const args of [
    { app: "app_123", tool: "update_notes__other", args: {} },
    { app: "app_123", tool: "update_notes", args: [] },
    { app: "app_123", tool: "update_notes" },
    { app: "x".repeat(121), tool: "update_notes", args: {} },
  ]) assert.equal((await f.call("call_app_tool", args)).message.error.code, -32602);
  assert.equal(f.actions.length, 0);
  assert.equal(f.mutations.length, 0);
});

test("Claude allows a complete learning chain while keeping native tools disabled", () => {
  const args = claudeTurnArguments(`${SITE_URL}/mcp/${token}`);
  assert.equal(args[args.indexOf("--max-turns") + 1], "16");
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.equal(args[args.indexOf("--allowedTools") + 1], "mcp__yuzu__*");
  assert.ok(args.includes("--strict-mcp-config"));
});
