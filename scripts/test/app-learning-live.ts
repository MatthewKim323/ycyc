/// <reference types="node" />
// Real public API verification through the deployed MCP endpoint; no fixtures.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

async function main() {
  const identityPath = process.argv[2];
  const outputPath = process.argv[3];
  assert.ok(identityPath && outputPath, "usage: app-learning-live.ts <private identity.json> <report.json>");
  const identity = JSON.parse(await readFile(identityPath, "utf8")) as { url: string; token: string };
  const site = new URL(identity.url).origin.replace(/\.convex\.cloud$/, ".convex.site");
  const client = new ConvexHttpClient(identity.url, { logger: false });
  let id = 0;
  async function tool(name: string, args: object, token = identity.token): Promise<any> {
    const response = await fetch(`${site}/mcp/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }) });
    assert.equal(response.status, 200, "MCP request failed");
    const message = await response.json();
    assert.ok(!message.error && !message.result?.isError, "MCP tool failed");
    return JSON.parse(message.result.content[0].text);
  }
  const report: Record<string, unknown> = { ok: false, startedAt: new Date().toISOString(), deployment: new URL(identity.url).hostname, target: "Open Library public Search API", realNetwork: true };
  const search = await tool("search_apps", { query: "Open Library" });
  assert.ok(Array.isArray(search) && search.length > 0, "real App Store search returned no results");
  report.appStoreResults = search.length;
  const app = "https://openlibrary.org/dev/docs/api/search";
  const research = await tool("investigate_app", { app });
  assert.equal(research.status, "researched");
  const evidence = research.evidence.find((e: any) => e.kind === "endpoint" && e.path === "/search.json" && e.inputSchema?.properties?.q && e.inputSchema.properties.limit && e.inputSchema.properties.fields);
  assert.ok(evidence, "real documentation did not expose a supported bounded search endpoint");
  report.evidenceObserved = research.evidence.length;
  report.queryParameters = Object.keys(evidence.inputSchema.properties);
  const draft = await tool("build_app_tool", { app, evidenceId: evidence.evidenceId, name: `book_search_${randomUUID().slice(0, 8)}`, title: "Search public books", responsePath: "docs" });
  assert.equal(draft.status, "draft");
  const premature = await tool("publish_app_tool", { toolId: draft.toolId });
  assert.equal(premature.status, "learning_blocked");
  report.unverifiedPublishBlocked = true;
  const verification = await tool("verify_app_tool", { toolId: draft.toolId, args: { q: "tolkien", limit: 1, fields: "key,title,author_name" } });
  assert.equal(verification.ok, true);
  assert.equal(verification.status, 200);
  assert.ok(!JSON.stringify(verification).includes("Tolkien"), "verification must return schema without response values");
  const published = await tool("publish_app_tool", { toolId: draft.toolId });
  assert.equal(published.status, "published");
  assert.equal(published.private, true);
  const read = await tool("call_learned_tool", { toolId: draft.toolId, args: { q: "pride and prejudice", limit: 1, fields: "key,title,author_name" } });
  assert.equal(read.ok, true);
  assert.ok(Array.isArray(read.data) && read.data.length === 1 && typeof read.data[0].title === "string", "real book data unavailable");
  const listed = await tool("list_apps", {});
  assert.ok(listed.learnedTools.some((t: any) => t.toolId === draft.toolId && t.status === "published"));
  const other = await client.mutation(api.users.ensure, { deviceId: `learning-isolation-${randomUUID()}` });
  const otherToken = other.mcpUrl.split("/").pop()!;
  const denied = await tool("call_learned_tool", { toolId: draft.toolId }, otherToken);
  assert.equal(denied.status, "learning_blocked");
  assert.ok(!JSON.stringify(denied).includes(read.data[0].title));
  const otherList = await tool("list_apps", {}, otherToken);
  assert.ok(!otherList.learnedTools.some((t: any) => t.toolId === draft.toolId));
  Object.assign(report, { ok: true, status: "published", private: true, realVerificationStatus: verification.status, queryOverrideVerified: true,
    firstBook: read.data[0], crossUserReadBlocked: true, crossUserListingHidden: true, toolId: draft.toolId, completedAt: new Date().toISOString() });
  const serialized = JSON.stringify(report, null, 2) + "\n";
  assert.ok(!serialized.includes(identity.token) && !serialized.includes(otherToken));
  await writeFile(outputPath, serialized, { mode: 0o600 });
  console.log(JSON.stringify({ ok: true, realApi: "Open Library", stages: "research → draft → real verify → publish → parameterized read", crossUserIsolation: true }));
}
main().catch(() => { console.error("real app-learning check failed; no private diagnostics printed"); process.exitCode = 1; });
