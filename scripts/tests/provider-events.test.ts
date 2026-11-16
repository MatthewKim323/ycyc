import { test } from "node:test";
import assert from "node:assert/strict";
import { ProviderEvents } from "../../convex/lib/providerEvents";

const init = { type: "system", subtype: "init", tools: ["mcp__yuzu__list_apps"], mcp_servers: [{ name: "yuzu", status: "connected" }], apiKeySource: "never stream metadata" };
const result = { type: "result", subtype: "success", is_error: false, result: "hello" };
const delta = (text: string) => ({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
const feed = (parser: ProviderEvents, ...values: unknown[]) => parser.push(new TextEncoder().encode(values.map((value) => JSON.stringify(value)).join("\n") + "\n"));

test("Claude streams only visible text, handles UTF-8/JSON chunk boundaries and suppresses duplicate final text", () => {
  const parser = new ProviderEvents("claude");
  const bytes = new TextEncoder().encode([init, delta("héllo"), { type: "assistant", message: { content: [{ type: "text", text: "héllo" }] } }, { ...result, result: "héllo" }].map((value) => JSON.stringify(value)).join("\n"));
  const events = [];
  for (const byte of bytes) events.push(...parser.push(Uint8Array.of(byte)));
  events.push(...parser.finish());
  assert.deepEqual(events, [{ type: "text_delta", text: "héllo" }]);
});

test("Claude discards reasoning, credentials, tool arguments/results and non-main conversation text", () => {
  const parser = new ProviderEvents("claude");
  const events = feed(parser, init,
    { type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "private reasoning" } } },
    { type: "stream_event", parent_tool_use_id: "subagent", event: { type: "content_block_delta", delta: { type: "text_delta", text: "private subagent" } } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "tool-1", name: "mcp__yuzu__list_apps", input: { password: "private argument" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "private response token" }] } }, result);
  events.push(...parser.finish());
  assert.deepEqual(events, [
    { type: "tool_start", id: "tool-1", name: "mcp__yuzu__list_apps" },
    { type: "tool_end", id: "tool-1", name: "mcp__yuzu__list_apps" },
    { type: "text_delta", text: "hello" },
  ]);
  assert.ok(!JSON.stringify(events).includes("private"));
});

test("Claude rejects unexpected built-ins, servers, missing manifest and failed terminal results", () => {
  for (const value of [
    { ...init, tools: ["Bash"] }, { ...init, mcp_servers: [{ name: "other" }] },
  ]) assert.throws(() => feed(new ProviderEvents("claude"), value), /provider_disallowed_tool/);
  assert.throws(() => feed(new ProviderEvents("claude"), delta("hello")), /manifest_missing/);
  const parser = new ProviderEvents("claude");
  feed(parser, init);
  assert.throws(() => feed(parser, { ...result, subtype: "error_max_turns", result: "secret provider detail" }), /provider_turn_failed/);
  const unsafe = new ProviderEvents("claude");
  feed(unsafe, init);
  assert.throws(() => feed(unsafe, { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Read" }] } }), /provider_disallowed_tool/);
});

test("parser requires terminal success and bounds malformed/oversized output", () => {
  const incomplete = new ProviderEvents("claude");
  feed(incomplete, init, delta("partial"));
  assert.throws(() => incomplete.finish(), /incomplete/);
  assert.throws(() => new ProviderEvents("claude").push(new TextEncoder().encode("not-json\n")), /invalid_event/);
  assert.throws(() => new ProviderEvents("claude").push(new Uint8Array(2_000_001)), /output_limit/);
  const long = new ProviderEvents("claude");
  feed(long, init);
  assert.throws(() => feed(long, delta("x".repeat(80_001))), /output_limit/);
});

test("Codex normalizes MCP lifecycle while dropping reasoning and metadata", () => {
  const parser = new ProviderEvents("codex");
  const events = feed(parser,
    { method: "thread/started", params: { thread: { id: "private thread" } } },
    { method: "item/completed", params: { item: { id: "r1", type: "reasoning", text: "private reasoning" } } },
    { method: "item/started", params: { item: { id: "t1", type: "mcpToolCall", server: "yuzu", tool: "list_apps", arguments: { secret: "private" } } } },
    { method: "item/completed", params: { item: { id: "t1", type: "mcpToolCall", server: "yuzu", tool: "list_apps", result: { token: "private" } } } },
    { method: "turn/completed", params: { turn: { status: "completed", error: null } } });
  assert.deepEqual(events, [
    { type: "tool_start", id: "t1", name: "mcp__yuzu__list_apps" }, { type: "tool_end", id: "t1", name: "mcp__yuzu__list_apps" },
  ]);
  assert.deepEqual(parser.finish(), []);
});

test("Codex rejects filesystem/shell/web/other-server events and sanitizes provider errors", () => {
  for (const type of ["commandExecution", "fileChange", "webSearch", "collabAgentToolCall"]) {
    assert.throws(() => feed(new ProviderEvents("codex"), { method: "item/started", params: { item: { id: "t1", type, text: "private" } } }), /provider_disallowed_tool/);
  }
  assert.throws(() => feed(new ProviderEvents("codex"), { method: "item/started", params: { item: { id: "t1", type: "mcpToolCall", server: "other", tool: "read" } } }), /provider_disallowed_tool/);
  assert.throws(() => feed(new ProviderEvents("codex"), { method: "error", params: { error: { message: "secret raw exception" } } }), /^Error: provider_turn_failed$/);
});

test("Codex app-server emits deltas before completion, deduplicates full items and hides MCP resources", () => {
  const parser = new ProviderEvents("codex");
  const notice = (method: string, params: unknown) => ({ method, params });
  assert.deepEqual(feed(parser, notice("item/started", { item: { type: "agentMessage", id: "a1", text: "" } }), notice("item/agentMessage/delta", { itemId: "a1", delta: "partial " })), [{ type: "text_delta", text: "partial " }]);
  assert.equal(parser.completed, false);
  assert.deepEqual(feed(parser, notice("item/agentMessage/delta", { itemId: "a1", delta: "reply" }), notice("item/completed", { item: { type: "agentMessage", id: "a1", text: "partial reply" } }), notice("item/completed", { item: { type: "functionCallOutput", id: "r1", name: "read_mcp_resource", namespace: "functions", output: "private resource" } }), notice("turn/completed", { turn: { status: "completed", error: null } })), [{ type: "text_delta", text: "reply" }]);
  assert.equal(parser.completed, true);
  assert.deepEqual(parser.finish(), []);
  assert.throws(() => feed(new ProviderEvents("codex"), notice("turn/completed", { turn: { status: "failed", error: { message: "private" } } })), /provider_turn_failed/);
  assert.throws(() => feed(new ProviderEvents("codex"), notice("item/started", { item: { type: "commandExecution", id: "x" } })), /provider_disallowed_tool/);
  assert.throws(() => feed(new ProviderEvents("codex"), notice("item/completed", { item: { type: "functionCallOutput", id: "r1", name: "read_file" } })), /provider_disallowed_tool/);
});
