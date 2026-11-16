import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import type { ClientRequest, IncomingMessage } from "node:http";
import { EXTERNAL_PLUGINS, externalPlugin, type ExternalPlugin } from "../../convex/lib/marketplaceCatalog";
import { remotePluginCall, remotePluginTools, type MarketplaceTransport } from "../../convex/lib/marketplaceClient";
import type { ResearchRequestOptions } from "../../convex/lib/learningHttp";

const deepwiki = externalPlugin("mcp:deepwiki")!, context7 = externalPlugin("mcp:context7")!, github = externalPlugin("mcp:github")!;
const schema = { type: "object", properties: { query: { type: "string" } } };
const tool = (name = "read_wiki_structure") => ({ name, description: "Reviewed read tool", inputSchema: schema });
type Call = { endpoint: string; headers: Record<string, string>; options: ResearchRequestOptions; payload: Record<string, any> };
type Reply = { status?: number; headers?: Record<string, string>; body?: unknown; chunks?: Buffer[]; sse?: boolean; holdOpen?: boolean; error?: boolean };
function fixture(final?: (call: Call) => Reply, session = "private-transport-session") {
  const calls: Call[] = [], responses: PassThrough[] = [];
  let resolutions = 0;
  const io: MarketplaceTransport = {
    timeoutMs: 500,
    resolve: async () => { resolutions++; return [{ address: "8.8.8.8", family: 4 }]; },
    request: (url, options, callback) => {
      const request = new PassThrough(); let data = "";
      request.on("data", (chunk: Buffer) => { data += chunk.toString("utf8"); });
      request.on("finish", () => {
        const call = { endpoint: url.href, headers: options.headers as Record<string, string>, options, payload: JSON.parse(data) };
        calls.push(call);
        const method = call.payload.method;
        const reply: Reply = method === "initialize" ? { headers: { "mcp-session-id": session }, body: { jsonrpc: "2.0", id: call.payload.id, result: { protocolVersion: "2025-06-18", capabilities: {} } } }
          : method === "notifications/initialized" ? { status: 202, chunks: [] }
          : final?.(call) ?? { body: { jsonrpc: "2.0", id: call.payload.id, result: { tools: [tool()] } } };
        if (reply.error) { request.emit("error", new Error("PRIVATE_TRANSPORT_DIAGNOSTIC")); return; }
        const response = Object.assign(new PassThrough(), { statusCode: reply.status ?? 200, headers: { "content-type": reply.sse ? "text/event-stream" : "application/json", ...reply.headers } });
        responses.push(response); callback(response as unknown as IncomingMessage);
        const raw = JSON.stringify(reply.body ?? { jsonrpc: "2.0", id: call.payload.id, result: {} });
        const chunks = reply.chunks ?? [Buffer.from(reply.sse ? `event: message\ndata: ${raw}\n\n` : raw)];
        for (const chunk of chunks) response.write(chunk);
        if (!reply.holdOpen) response.end();
      });
      return request as unknown as ClientRequest;
    },
  };
  return { io, calls, responses, get resolutions() { return resolutions; } };
}

test("reviewed catalog is fixed and read-only, with documented optional Context7 credentials", () => {
  assert.deepEqual(EXTERNAL_PLUGINS.map((entry) => entry.id), ["mcp:deepwiki", "mcp:context7", "mcp:github"]);
  assert.equal(context7.auth, "optional_api_key"); assert.equal(deepwiki.auth, "none"); assert.equal(github.auth, "api_key");
  assert.equal(github.headers?.["X-MCP-Readonly"], "true");
  for (const entry of EXTERNAL_PLUGINS) {
    assert.equal(new URL(entry.endpoint).protocol, "https:");
    assert.ok(Object.isFrozen(entry)); assert.ok(Object.isFrozen(entry.allowedTools));
    assert.ok(!entry.allowedTools.some((name) => /^(create|delete|update|push|write|merge|add)_/.test(name)));
  }
});

test("MCP initializes, sends accepted initialized notification and lists only reviewed tools", async () => {
  const f = fixture((call) => ({ body: { jsonrpc: "2.0", id: call.payload.id, result: { tools: [tool(), tool("delete_repository"), tool("read_wiki_structure"), tool("ask_wiki_question")] } } }));
  const tools = await remotePluginTools(deepwiki, undefined, f.io);
  assert.deepEqual(tools.map((entry) => entry.name), ["read_wiki_structure", "ask_wiki_question"]);
  assert.deepEqual(f.calls.map((call) => call.payload.method), ["initialize", "notifications/initialized", "tools/list"]);
  assert.equal(f.calls[1]!.payload.id, undefined);
  assert.equal(f.calls[0]!.headers["Mcp-Session-Id"], undefined);
  assert.equal(f.calls[1]!.headers["Mcp-Session-Id"], "private-transport-session");
  assert.equal(f.calls[2]!.headers["Mcp-Session-Id"], "private-transport-session");
  for (const call of f.calls) {
    assert.equal(call.endpoint, deepwiki.endpoint); assert.equal(call.options.method, "POST");
    assert.equal(call.options.agent, false); assert.equal(call.options.autoSelectFamily, false);
    assert.equal(call.options.rejectUnauthorized, undefined); assert.equal(typeof call.options.lookup, "function");
    assert.equal(call.headers.cookie, undefined); assert.equal(call.headers.authorization, undefined);
    assert.equal(call.headers["content-length"], String(Buffer.byteLength(JSON.stringify(call.payload))));
  }
});

test("SSE handles UTF-8 boundaries, comments, CRLF and multiline data, then closes on matching RPC response", async () => {
  const f = fixture((call) => {
    const unrelated = JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { private: "never returned" } });
    const result = JSON.stringify({ jsonrpc: "2.0", id: call.payload.id, result: { tools: [{ ...tool(), description: "héllo" }] } }, null, 2);
    const raw = `: keepalive\r\ndata: ${unrelated}\r\n\r\nevent: message\r\n${result.split("\n").map((line) => `data: ${line}\r\n`).join("")}\r\n`;
    return { sse: true, holdOpen: true, chunks: [...Buffer.from(raw)].map((byte) => Buffer.from([byte])) };
  });
  const tools = await remotePluginTools(deepwiki, undefined, f.io);
  assert.equal(tools[0]!.description, "héllo");
  assert.ok(f.responses.at(-1)!.destroyed, "matched SSE stream must not wait for server EOF");
});

test("SSE accepts lone CR line endings without waiting for server EOF", async () => {
  const f = fixture((call) => ({ sse: true, holdOpen: true, chunks: [...Buffer.from(`data: ${JSON.stringify({ jsonrpc: "2.0", id: call.payload.id, result: { tools: [tool()] } })}\r\r`)].map((byte) => Buffer.from([byte])) }));
  assert.equal((await remotePluginTools(deepwiki, undefined, f.io)).length, 1);
  assert.ok(f.responses.at(-1)!.destroyed);
});

test("session echoes are redacted in raw and JSON-escaped text", async () => {
  const session = 'private-"quoted"-\\session';
  const f = fixture((call) => ({ body: { jsonrpc: "2.0", id: call.payload.id, result: { content: [{ type: "text", text: `raw ${session} serialized ${JSON.stringify({ session })}` }] } } }), session);
  const result = await remotePluginCall(deepwiki, "read_wiki_structure", {}, undefined, f.io);
  assert.deepEqual(result, { content: [{ type: "text", text: 'raw [redacted] serialized {"session":"[redacted]"}' }], isError: false });
});

test("credentials are provider-scoped and fixed GitHub read headers cannot be replaced by caller metadata", async () => {
  const key = "github_fake_personal_key";
  const forged = { ...github, headers: { Cookie: "PRIVATE_YUZU_SESSION", Authorization: "Bearer WRONG", "X-MCP-Readonly": "false" }, allowedTools: ["delete_repository"] };
  const f = fixture((call) => ({ body: { jsonrpc: "2.0", id: call.payload.id, result: { tools: [tool("get_me")] } } }));
  await remotePluginTools(forged, key, f.io);
  for (const call of f.calls) {
    assert.equal(call.headers.authorization, `Bearer ${key}`); assert.equal(call.headers.cookie, undefined); assert.equal(call.headers.Cookie, undefined);
    assert.equal(call.headers["X-MCP-Readonly"], "true"); assert.equal(call.headers["X-MCP-Tools"], github.allowedTools.join(","));
  }
  const missing = fixture();
  await assert.rejects(remotePluginTools(github, undefined, missing.io), /marketplace_credential_required/);
  await assert.rejects(remotePluginTools(deepwiki, key, missing.io), /credential_not_supported/);
  await assert.rejects(remotePluginTools(context7, "private\r\nCookie: secret", missing.io), /invalid_credential/);
  assert.equal(missing.resolutions, 0); assert.equal(missing.calls.length, 0);
});

test("sessions and credentials are fresh across calls, users and providers", async () => {
  const a = fixture((call) => ({ body: { jsonrpc: "2.0", id: call.payload.id, result: { tools: [tool("get_me")] } } }), "first-user-session");
  const b = fixture((call) => ({ body: { jsonrpc: "2.0", id: call.payload.id, result: { tools: [tool("resolve-library-id")] } } }), "second-user-session");
  await Promise.all([remotePluginTools(github, "first_fake_key", a.io), remotePluginTools(context7, "second_fake_key", b.io)]);
  assert.equal(a.calls[0]!.headers["Mcp-Session-Id"], undefined); assert.equal(b.calls[0]!.headers["Mcp-Session-Id"], undefined);
  assert.equal(a.calls[2]!.headers["Mcp-Session-Id"], "first-user-session"); assert.equal(b.calls[2]!.headers["Mcp-Session-Id"], "second-user-session");
  assert.ok(!JSON.stringify(a.calls).includes("second_fake_key")); assert.ok(!JSON.stringify(b.calls).includes("first_fake_key"));
});

test("forged endpoints, unknown plugins and write names fail before DNS or credential transport", async () => {
  const f = fixture();
  for (const endpoint of ["https://127.0.0.1/mcp", "https://[::ffff:7f00:1]/mcp", "http://mcp.deepwiki.com/mcp", "https://evil.example.com/mcp"]) await assert.rejects(remotePluginTools({ ...deepwiki, endpoint }, undefined, f.io), /unreviewed_plugin/);
  await assert.rejects(remotePluginTools({ ...deepwiki, id: "mcp:unknown" } as unknown as ExternalPlugin, undefined, f.io), /unreviewed_plugin/);
  await assert.rejects(remotePluginCall(github, "create_issue", {}, "fake_key", f.io), /tool_not_allowed/);
  await assert.rejects(remotePluginCall({ ...github, allowedTools: ["delete_repository"] }, "delete_repository", {}, "fake_key", f.io), /tool_not_allowed/);
  assert.equal(f.resolutions, 0); assert.equal(f.calls.length, 0);
  await assert.rejects(remotePluginTools(deepwiki, undefined, { ...f.io, resolve: async () => [{ address: "169.254.169.254", family: 4 }] }), /connection_failed/);
  assert.equal(f.calls.length, 0);
});

test("redirects and HTTP errors are static, never followed and never expose error bodies", async () => {
  for (const [status, expected] of [[302, "redirect_blocked"], [401, "authentication_failed"], [403, "access_denied"], [429, "rate_limited"], [503, "remote_unavailable"]] as const) {
    const f = fixture(() => ({ status, headers: { location: "http://169.254.169.254/private" }, body: { error: "PRIVATE_RESPONSE" } }));
    await assert.rejects(remotePluginTools(github, "fake_key", f.io), new RegExp(`^Error: marketplace_${expected}$`));
    assert.equal(f.calls.length, 3, "no redirect or automatic retry after the failing tools/list");
  }
  const f = fixture(() => ({ status: 401 }));
  await assert.rejects(remotePluginTools(context7, undefined, f.io), /credential_required/);
});

test("tool calls return only text and isError, redact auth/session echoes, and never fetch resource URLs", async () => {
  const f = fixture((call) => ({ sse: true, body: { jsonrpc: "2.0", id: call.payload.id, result: { isError: true, privateMetadata: "not returned", structuredContent: { private: "not returned" }, content: [
    { type: "text", text: "error fake_key private-transport-session" }, { type: "image", data: "private image" },
    { type: "resource_link", uri: "http://169.254.169.254/private" }, { type: "resource", resource: { text: "private resource" } },
  ] } } }));
  const result = await remotePluginCall(github, "get_me", { detail: "read" }, "fake_key", f.io);
  assert.deepEqual(result, { content: [{ type: "text", text: "error [redacted] [redacted]" }], isError: true });
  assert.deepEqual(f.calls.at(-1)!.payload.params, { name: "get_me", arguments: { detail: "read" } });
  assert.equal(f.calls.length, 3);
});

test("tool schema and argument bounds fail safely, and metadata cannot echo transport secrets", async () => {
  const huge = fixture((call) => ({ body: { jsonrpc: "2.0", id: call.payload.id, result: { tools: [{ ...tool(), inputSchema: { type: "object", description: "x".repeat(32769) } }] } } }));
  await assert.rejects(remotePluginTools(deepwiki, undefined, huge.io), /schema_limit/);
  const privateSchema = fixture((call) => ({ body: { jsonrpc: "2.0", id: call.payload.id, result: { tools: [{ ...tool("get_me"), description: "fake_key" }] } } }));
  await assert.rejects(remotePluginTools(github, "fake_key", privateSchema.io), /private_response/);
  const f = fixture();
  await assert.rejects(remotePluginCall(deepwiki, "read_wiki_structure", { value: "x".repeat(32769) }, undefined, f.io), /argument_limit/);
  assert.equal(f.calls.length, 0); assert.equal(f.resolutions, 0);
});

test("response caps, protocol mismatches, RPC errors and stalled SSE fail with bounded static codes", async () => {
  const replies: { reply: Reply; error: string }[] = [
    { reply: { headers: { "content-length": "524289" } }, error: "response_limit" },
    { reply: { chunks: [Buffer.alloc(524289)] }, error: "response_limit" },
    { reply: { chunks: [Buffer.from([0xff])] }, error: "protocol_error" },
    { reply: { body: { jsonrpc: "2.0", id: 999, result: {} } }, error: "protocol_error" },
    { reply: { body: { jsonrpc: "2.0", id: 2, error: { code: -32602, message: "PRIVATE_ARGUMENT_ERROR" } } }, error: "invalid_arguments" },
    { reply: { headers: { "content-encoding": "gzip" } }, error: "unsupported_encoding" },
  ];
  for (const { reply, error } of replies) {
    const f = fixture(() => reply);
    await assert.rejects(remotePluginTools(deepwiki, undefined, f.io), new RegExp(`^Error: marketplace_${error}$`));
  }
  const stalled = fixture(() => ({ sse: true, holdOpen: true, chunks: [Buffer.from(": keepalive\n\n")] }));
  await assert.rejects(remotePluginTools(deepwiki, undefined, { ...stalled.io, timeoutMs: 5 }), /marketplace_timeout/);
  assert.ok(stalled.responses.at(-1)!.destroyed);
});
