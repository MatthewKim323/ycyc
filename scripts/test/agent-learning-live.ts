/// <reference types="node" />
// A real hosted subscription agent must execute every learning stage itself.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

async function main() {
  const [identityPath, outputPath, provider = "claude"] = process.argv.slice(2);
  assert.ok(identityPath && outputPath && (provider === "claude" || provider === "codex"));
  const identity = JSON.parse(await readFile(identityPath, "utf8")) as { url: string; token: string };
  const http = new ConvexHttpClient(identity.url, { logger: false });
  const live = new ConvexClient(identity.url, { logger: false });
  let startedAt = Date.now();
  let turnId: Id<"aiTurns"> | undefined;
  try {
    let name = `agent_books_${randomUUID().slice(0, 8)}`;
    const resume = process.argv[5] === "resume";
    const prior = resume ? (await http.query(api.aiChat.threads, { token: identity.token })).find((t) => t.provider === provider) : undefined;
    const priorView = prior ? await http.query(api.aiChat.watchMessages, { token: identity.token, threadId: prior.threadId }) : undefined;
    const priorTurn = priorView?.turns.find((t) => t.message.startsWith("Test the complete Yuzu learning workflow yourself"));
    if (resume) assert.ok(prior && priorTurn, "no matching real run to resume");
    if (priorTurn) { startedAt = priorTurn.createdAt; name = /named (agent_books_[a-f0-9]+)/.exec(priorTurn.message)?.[1] ?? ""; }
    const ids = prior && priorTurn ? { threadId: prior.threadId, turnId: priorTurn.turnId } : await http.mutation(api.aiChat.sendMessage, { token: identity.token, provider, clientMessageId: `learning-agent-${randomUUID()}`,
      message: `Test the complete Yuzu learning workflow yourself using real tools. Research this public HTTPS website: https://openlibrary.org/dev/docs/api/search . Create a NEW private read tool named ${name}, title Search public books, responsePath docs. Do not reuse an existing learned tool. Use investigate_app to obtain observed endpoint evidence for search.json with observed q, limit and fields parameters. Build the tool, verify it with args {q: "tolkien", limit: 1, fields: "key,title,author_name"}, publish it, then call it with args {q: "pride and prejudice", limit: 1, fields: "key,title,author_name"}. All five stages must actually run in this turn. End with the first real book title and say whether learning completed. Public reads only: no login, private account data or writes. Do not invent URLs or claim a step succeeded if its tool failed.` });
    turnId = ids.turnId;
    const terminal = await new Promise<{ status: string; text: string; completedAt: number }>((resolve, reject) => {
      const timer = setTimeout(() => { unsubscribe(); reject(new Error("agent_check_timeout")); }, 290_000);
      const unsubscribe = live.onUpdate(api.aiChat.watchMessages, { token: identity.token, threadId: ids.threadId }, (view) => {
        const turn = view.turns.find((row) => row.turnId === ids.turnId);
        if (turn && !["queued", "running"].includes(turn.status)) {
          clearTimeout(timer); unsubscribe(); resolve({ status: turn.status, text: turn.assistantText, completedAt: turn.completedAt ?? Date.now() });
        }
      }, () => { clearTimeout(timer); unsubscribe(); reject(new Error("agent_subscription_failed")); });
    });
    let cursor = 0;
    const tools: string[] = [];
    while (true) {
      const page = await http.query(api.aiChat.events, { token: identity.token, threadId: ids.threadId, afterSeq: cursor, limit: 200 });
      for (const event of page.events) {
        cursor = event.seq;
        if (event.type === "tool_start" && event.name) tools.push(event.name);
      }
      if (!page.hasMore) break;
    }
    const required = ["investigate_app", "build_app_tool", "verify_app_tool", "publish_app_tool", "call_learned_tool"];
    const stages = Object.fromEntries(required.map((stage) => [stage, tools.some((name) => name.endsWith(stage))]));
    const site = new URL(identity.url).origin.replace(/\.convex\.cloud$/, ".convex.site");
    const listingResponse = await fetch(`${site}/mcp/${identity.token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_apps", arguments: {} } }) });
    const listing = await listingResponse.json();
    const learned = JSON.parse(listing.result.content[0].text).learnedTools.find((t: { name: string }) => t.name === name);
    const nativeToolPublished = learned?.status === "published";
    const passed = terminal.status === "completed" && Object.values(stages).every(Boolean) && nativeToolPublished && /pride|prejudice/i.test(terminal.text);
    const report = { ok: passed, provider, realHostedAgent: true, realPublicApi: "Open Library", startedAt: new Date(startedAt).toISOString(), completedAt: new Date(terminal.completedAt).toISOString(), checkedAt: new Date().toISOString(), durationMs: terminal.completedAt - startedAt, status: terminal.status, stages, nativeToolPublished, tools, answer: terminal.text.split(identity.token).join("[redacted]"), threadId: ids.threadId, turnId: ids.turnId };
    await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify({ ok: passed, provider, status: terminal.status, stages, durationMs: report.durationMs }));
    assert.ok(passed, "agent did not complete the real learning workflow");
  } catch {
    if (turnId) await http.mutation(api.aiChat.cancelTurn, { token: identity.token, turnId }).catch(() => {});
    throw new Error("agent_learning_check_failed");
  } finally { await live.close(); }
}
main().catch(() => { console.error("real hosted agent learning check failed; see the safe report if written"); process.exitCode = 1; });
