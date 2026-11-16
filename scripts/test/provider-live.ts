/// <reference types="node" />
// Real subscription E2E only: no fixture identities, API keys, or host credentials.
// npm exec --yes --package=tsx -- tsx scripts/test/provider-live.ts --provider claude --identity ../work/real-subscription-e2e.json --output ../work/provider-live-claude.json
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

type Provider = "claude" | "codex";
type Event = { seq: number; turnId: string; type: string; text?: string; name?: string; id?: string };
type TurnReport = {
  threadId: string; turnId: string; startedAt: number; subscribedAt?: number; firstSnapshotAt?: number;
  firstVisibleTextAt?: number; terminalAt?: number; status?: string; errorCode?: string;
  firstTextLatencyMs?: number; durationMs?: number;
  distinctTextUpdates: number; preterminalTextUpdates: number; textLength: number;
  eventCount: number; textEvents: number; toolStarts: number; toolEnds: number;
  cursorStart: number; cursorEnd: number; duplicateDeliveries: number;
  reconnects: number; reconnectCursor?: number; reconnectSnapshotAt?: number; reconnectCursorVerified?: boolean;
  replayVerified?: boolean; exactTextVerified?: boolean; answer?: string;
};
class ProbeFailure extends Error { constructor(readonly code: string) { super(code); } }
function ensure(condition: unknown, code: string): asserts condition { if (!condition) throw new ProbeFailure(code); }
const safeErrors = new Set(["runtime_unavailable", "provider_disconnected", "turn_expired", "output_limit", "provider_error", "tool_error", "turn_failed"]);

function options() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("usage: provider-live.ts --provider claude|codex [--identity ../work/real-subscription-e2e.json] [--output ../work/provider-live-<provider>.json]");
    process.exit(0);
  }
  const result: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    ensure(["--provider", "--identity", "--output"].includes(args[index]) && !!args[index + 1], "invalid_arguments");
    result[args[index]] = args[index + 1];
  }
  ensure(result["--provider"] === "claude" || result["--provider"] === "codex", "invalid_provider");
  const provider = result["--provider"] as Provider;
  return { provider, identity: resolve(result["--identity"] ?? "../work/real-subscription-e2e.json"),
    output: resolve(result["--output"] ?? `../work/provider-live-${provider}.json`) };
}

async function main() {
  const config = options();
  const report = { ok: false, provider: config.provider, backendURL: "", startedAt: new Date().toISOString(), phase: "identity", errorCode: undefined as string | undefined,
    turns: [] as TurnReport[], completedAt: undefined as string | undefined };
  let token = "";
  const safeText = (value: string) => value.split(token || "\u0000").join("[redacted]").replace(/https?:\/\/\S+/g, "[url]").slice(0, 16_000);
  const save = async () => {
    await mkdir(dirname(config.output), { recursive: true });
    await writeFile(config.output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  };
  let http: ConvexHttpClient | undefined;
  const clients = new Set<ConvexClient>();
  const client = () => { const value = new ConvexClient(report.backendURL, { logger: false }); clients.add(value); return value; };
  const close = async (value: ConvexClient) => { await value.close(); clients.delete(value); };
  try {
    const identity = JSON.parse(await readFile(config.identity, "utf8")) as { token?: unknown; url?: unknown; userId?: unknown };
    ensure(typeof identity.token === "string" && identity.token.length >= 16 && identity.token.length <= 256 &&
      typeof identity.url === "string" && typeof identity.userId === "string", "invalid_identity");
    token = identity.token;
    const url = new URL(identity.url);
    ensure(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/", "invalid_backend_url");
    report.backendURL = url.origin;
    http = new ConvexHttpClient(report.backendURL, { logger: false });
    report.phase = "connected_status";
    const status = await http.query(api.aiProviders.status, { token });
    ensure(status.some((row) => row.provider === config.provider && row.status === "connected"), "subscription_not_connected");
    await save();

    async function turn(message: string, threadId?: Id<"aiThreads">, startCursor = 0, reconnect = false) {
      report.phase = threadId ? "tool_followup" : "stream_generation";
      const startedAt = Date.now();
      const ids = await http!.mutation(api.aiChat.sendMessage, { token, provider: config.provider, ...(threadId ? { threadId } : {}), message,
        clientMessageId: `real-e2e-${randomUUID()}` });
      const item: TurnReport = { ...ids, startedAt, distinctTextUpdates: 0, preterminalTextUpdates: 0, textLength: 0,
        eventCount: 0, textEvents: 0, toolStarts: 0, toolEnds: 0, cursorStart: startCursor, cursorEnd: startCursor,
        duplicateDeliveries: 0, reconnects: 0 };
      report.turns.push(item);
      const seen = new Map<number, Event>();
      const distinct = new Set<string>();
      let cursor = startCursor, closed = false, eventEpoch = 0, terminalText = "";
      let messageUnsubscribe: (() => void) | undefined, eventUnsubscribe: (() => void) | undefined;
      let eventsClient = client();
      const messagesClient = client();
      let eventWork = Promise.resolve();
      let resolveTerminal!: () => void, rejectFailure!: (reason: ProbeFailure) => void, resolveReconnected!: () => void;
      const terminal = new Promise<void>((resolve) => { resolveTerminal = resolve; });
      const failure = new Promise<never>((_resolve, reject) => { rejectFailure = reject; });
      const reconnected = new Promise<void>((resolve) => { resolveReconnected = resolve; });
      const wait = <T,>(value: Promise<T>) => Promise.race([value, failure]);
      const fail = (code: string) => rejectFailure(new ProbeFailure(code));
      const timer = setTimeout(() => fail("turn_timeout"), 510_000);
      const accept = (events: Event[], after: number, replay = false) => {
        let previous = after;
        for (const event of events) {
          ensure(Number.isSafeInteger(event.seq) && event.seq > previous, "event_sequence_not_monotonic");
          previous = event.seq;
          ensure(event.turnId === ids.turnId, "unexpected_turn_event");
          const old = seen.get(event.seq);
          if (old) {
            ensure(JSON.stringify(old) === JSON.stringify(event), "event_sequence_changed");
            if (!replay) item.duplicateDeliveries++;
            continue;
          }
          ensure(event.seq === cursor + 1, "event_sequence_gap");
          seen.set(event.seq, event); cursor = event.seq;
        }
        item.cursorEnd = cursor;
      };
      const subscribe = (after: number) => {
        if (closed) return;
        const epoch = ++eventEpoch;
        eventUnsubscribe = eventsClient.onUpdate(api.aiChat.events, { token, threadId: ids.threadId, afterSeq: after, limit: 200 }, (page) => {
          if (closed || epoch !== eventEpoch) return;
          try {
            if (item.reconnects === 1 && item.reconnectSnapshotAt === undefined) {
              ensure(after === item.reconnectCursor && page.events.every((event) => event.seq > after), "reconnect_cursor_invalid");
              item.reconnectSnapshotAt = Date.now(); item.reconnectCursorVerified = true;
              resolveReconnected();
            }
            accept(page.events, after);
            if (page.events.length) {
              ensure(page.cursor === page.events.at(-1)!.seq, "event_cursor_mismatch");
              eventUnsubscribe?.();
              eventEpoch++;
              eventWork = eventWork.then(async () => {
                if (closed) return;
                if (reconnect && item.reconnects === 0) {
                  item.reconnectCursor = cursor;
                  await close(eventsClient);
                  if (closed) return;
                  eventsClient = client(); item.reconnects++;
                }
                subscribe(cursor);
              }).catch(() => fail("event_reconnect_failed"));
            }
          } catch { fail("event_stream_invalid"); }
        }, () => fail("event_subscription_failed"));
      };
      try {
        item.subscribedAt = Date.now();
        messageUnsubscribe = messagesClient.onUpdate(api.aiChat.watchMessages, { token, threadId: ids.threadId, limit: 20 }, (value) => {
          const now = Date.now();
          item.firstSnapshotAt ??= now;
          const row = value.turns.find((entry) => entry.turnId === ids.turnId);
          if (!row) return;
          item.status = row.status;
          if (row.assistantText && !distinct.has(row.assistantText)) {
            distinct.add(row.assistantText); item.firstVisibleTextAt ??= now;
            if (row.status === "queued" || row.status === "running") item.preterminalTextUpdates++;
          }
          item.distinctTextUpdates = distinct.size;
          item.textLength = row.assistantText.length;
          if (["completed", "error", "cancelled"].includes(row.status)) {
            terminalText = row.assistantText;
            item.terminalAt = now; item.answer = safeText(row.assistantText);
            item.errorCode = row.error && safeErrors.has(row.error) ? row.error : undefined;
            resolveTerminal();
          }
        }, () => fail("message_subscription_failed"));
        subscribe(startCursor);
        await wait(terminal);
        await wait(eventWork);
        if (reconnect) await wait(reconnected);
        // Replay the durable stream through HTTP after the WebSocket observations.
        // Compare immutable sequence identities and verify reconnect has no gaps.
        let replayCursor = startCursor;
        while (true) {
          const page = await wait(http!.query(api.aiChat.events, { token, threadId: ids.threadId, afterSeq: replayCursor, limit: 200 }));
          accept(page.events, replayCursor, true);
          ensure(page.cursor >= replayCursor, "replay_cursor_regressed");
          replayCursor = page.cursor;
          if (!page.hasMore) break;
        }
        item.replayVerified = replayCursor === cursor;
        const values = [...seen.values()];
        item.eventCount = values.length;
        item.textEvents = values.filter((event) => event.type === "text_delta").length;
        item.toolStarts = values.filter((event) => event.type === "tool_start" && event.name?.endsWith("list_apps")).length;
        item.toolEnds = values.filter((event) => event.type === "tool_end" && event.name?.endsWith("list_apps")).length;
        await save();
        ensure(item.status === "completed", item.errorCode ?? "turn_not_completed");
        ensure(item.textLength > 0 && item.answer, "empty_assistant_answer");
        ensure(item.replayVerified, "replay_incomplete");
        const text = values.filter((event) => event.type === "text_delta").map((event) => event.text ?? "").join("");
        ensure(text === terminalText, "stream_final_text_mismatch");
        item.exactTextVerified = true;
        if (reconnect) {
          ensure(item.firstVisibleTextAt !== undefined && item.terminalAt !== undefined && item.firstVisibleTextAt < item.terminalAt && item.preterminalTextUpdates > 0, "no_text_visible_before_terminal");
          ensure(item.distinctTextUpdates > 1, "only_one_distinct_text_update");
          ensure(item.reconnects === 1 && item.reconnectCursor !== undefined && item.reconnectCursorVerified, "event_reconnect_not_exercised");
        } else {
          ensure(item.toolStarts === 1 && item.toolEnds === 1, "list_apps_tool_pair_missing_or_repeated");
        }
        return { threadId: ids.threadId, cursor };
      } finally {
        item.durationMs = (item.terminalAt ?? Date.now()) - startedAt;
        if (item.firstVisibleTextAt !== undefined) item.firstTextLatencyMs = item.firstVisibleTextAt - startedAt;
        const values = [...seen.values()];
        item.eventCount = values.length;
        item.textEvents = values.filter((event) => event.type === "text_delta").length;
        item.toolStarts = values.filter((event) => event.type === "tool_start" && event.name?.endsWith("list_apps")).length;
        item.toolEnds = values.filter((event) => event.type === "tool_end" && event.name?.endsWith("list_apps")).length;
        closed = true; clearTimeout(timer); messageUnsubscribe?.(); eventUnsubscribe?.();
        await Promise.allSettled([close(messagesClient), close(eventsClient)]);
      }
    }

    const first = await turn("Write exactly 24 numbered short lines about calm morning routines. Use about eight words per line. Do not call tools or change any app data.", undefined, 0, true);
    await save();
    await turn("Call list_apps once, then tell how many apps are connected. Do not change any app data.", first.threadId, first.cursor);
    report.phase = "complete"; report.ok = true;
  } catch (error) {
    report.errorCode = error instanceof ProbeFailure ? error.code : "public_api_or_transport_failed";
  } finally {
    report.completedAt = new Date().toISOString();
    await Promise.allSettled([...clients].map(close));
    await save();
  }
  console.log(JSON.stringify({ ok: report.ok, provider: config.provider, phase: report.phase, errorCode: report.errorCode, reportPath: config.output }));
  if (!report.ok) process.exitCode = 1;
}

main().catch(() => {
  // Never expose SDK exceptions, request args, identity contents, or raw URLs.
  console.error(JSON.stringify({ ok: false, errorCode: "runner_setup_or_report_failed" }));
  process.exitCode = 1;
});
