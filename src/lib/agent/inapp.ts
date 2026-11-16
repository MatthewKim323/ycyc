import { useConvex, useQueries } from "convex/react";
import type { ConvexReactClient } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import * as Crypto from "expo-crypto";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { verbForTool } from "@/components/app-copy";
import { api, type Id } from "@/hooks/convex";
import { store } from "@/hooks/storage";
import { useUser } from "@/hooks/user";

import {
  notifyProvidersChanged,
  registerProvider,
  type AgentChunk,
  type AgentMessage,
  type AgentPart,
  type AgentProvider,
  type AgentRestore,
} from "./provider";
import { snapshotEvents, streamTurnUpdates, TERMINAL } from "./turn-updates";

// In-app providers: the person's own Claude or ChatGPT plan, running on yuzu's backend.
// See docs/AI_LOGIN_API.md and docs/AI_STREAMING_API.md. The capability token is never logged.

export type PlanId = "claude" | "codex";
export type ProviderStatus = FunctionReturnType<typeof api.aiProviders.status>[number];
type Turn = FunctionReturnType<typeof api.aiChat.watchMessages>["turns"][number];
type ChatEvent = FunctionReturnType<typeof api.aiChat.events>["events"][number];

export const PLAN_NAME: Record<PlanId, string> = { claude: "Claude", codex: "ChatGPT" };
export const PLAN_PROVIDER_ID: Record<PlanId, string> = { claude: "claude-plan", codex: "chatgpt-plan" };

// ---------- Bridge: Convex client + token + live status, shared with non-React code ----------

type Bridge = { client: ConvexReactClient | null; token: string | null; status: ProviderStatus[] | null };
const bridge: Bridge = { client: null, token: null, status: null };
let connectedKey = "";

/** The capability at the end of the person's MCP link. */
export function tokenFrom(mcpUrl: string | null): string | null {
  if (!mcpUrl) return null;
  const last = mcpUrl.split("?")[0]?.split("/").filter(Boolean).pop();
  return last && last.length <= 256 ? last : null;
}

export function planStatus(plan: PlanId): ProviderStatus | undefined {
  return bridge.status?.find((s) => s.provider === plan);
}

function isPlanConnected(plan: PlanId) {
  return planStatus(plan)?.status === "connected";
}

/**
 * Keeps the bridge current: subscribes to aiProviders.status (without throwing if the token is
 * unknown) and re-renders pickers when a plan connects or disconnects. Mount where in-app chat
 * or the login sheet can appear.
 */
export function useAiPlans() {
  const client = useConvex();
  const { mcpUrl } = useUser();
  const token = tokenFrom(mcpUrl);
  const queries = useMemo(
    () => (token ? { status: { query: api.aiProviders.status, args: { token } } } : ({} as Record<string, never>)),
    [token],
  );
  const result = useQueries(queries) as { status?: ProviderStatus[] | Error };
  const raw = result.status;
  const status = raw instanceof Error ? null : (raw ?? null);
  const failed = raw instanceof Error;

  useEffect(() => {
    bridge.client = client;
    bridge.token = token;
    bridge.status = status;
    const key = (status ?? [])
      .filter((s) => s.status === "connected")
      .map((s) => `${s.provider}${s.selected ? "*" : ""}`)
      .join(",");
    if (key !== connectedKey) {
      connectedKey = key;
      notifyProvidersChanged();
    }
  }, [client, token, status]);

  return { token, status, failed, loading: !!token && raw === undefined };
}

// ---------- Login sheet request: connect() opens it, the sheet resolves it ----------

type LoginRequest = { plan: PlanId; resolve: (connected: boolean) => void } | null;
let request: LoginRequest = null;
const requestListeners = new Set<() => void>();
const setRequest = (r: LoginRequest) => {
  request = r;
  requestListeners.forEach((l) => l());
};

/** Opens the login sheet for a plan. Resolves true once it's connected, false if dismissed. */
export function openLogin(plan: PlanId): Promise<boolean> {
  request?.resolve(false);
  return new Promise((resolve) => setRequest({ plan, resolve }));
}

export function closeLogin(connected: boolean) {
  const r = request;
  setRequest(null);
  r?.resolve(connected);
}

export function useLoginRequest(): LoginRequest {
  return useSyncExternalStore(
    (l) => {
      requestListeners.add(l);
      return () => requestListeners.delete(l);
    },
    () => request,
    () => request,
  );
}

// ---------- Threads ----------

const threadKey = (plan: PlanId) => `yuzu.aiThread.${plan}`;
const threads: Partial<Record<PlanId, string | null>> = {};

// "new" marks a deliberate New chat, so restore doesn't fall back to the latest server thread.
const NEW = "new";

async function savedThread(plan: PlanId): Promise<string | null> {
  if (threads[plan] === undefined) threads[plan] = (await store.get(threadKey(plan)).catch(() => null)) || null;
  return threads[plan] ?? null;
}

async function threadFor(plan: PlanId): Promise<string | null> {
  const saved = await savedThread(plan);
  return saved === NEW ? null : saved;
}

function rememberThread(plan: PlanId, id: string | null) {
  threads[plan] = id;
  store.set(threadKey(plan), id ?? "").catch(() => {});
}

// ---------- Event mapping ----------

const TOOL_PREFIX = "mcp__yuzu__";

/** "mcp__yuzu__myfitnesspal__log_food" -> { slug, tool }. yuzu's own tools return null. */
function parseTool(name: string | undefined): { slug: string; tool: string } | null {
  if (!name?.startsWith(TOOL_PREFIX)) return null;
  const [slug, tool] = name.slice(TOOL_PREFIX.length).split("__");
  return slug && tool ? { slug, tool } : null;
}

function actionChunk(e: ChatEvent): AgentChunk | null {
  if (e.type === "text_delta") return e.text ? { type: "text", delta: e.text } : null;
  const parsed = parseTool(e.name);
  if (!parsed || !e.id) return null;
  return {
    type: "action",
    id: e.id,
    appSlug: parsed.slug,
    tool: parsed.tool,
    at: e.createdAt,
    title: verbForTool(parsed.slug, parsed.tool) ?? "",
    status: e.type === "tool_start" ? "running" : "ok",
  };
}

const ERROR_COPY: Record<string, (name: string) => string> = {
  runtime_unavailable: () => "Your AI couldn't start right now. Try again in a minute.",
  provider_disconnected: (n) => `Your ${n} plan got signed out. Reconnect it from the assistant menu.`,
  usage_limit: (n) => `Your ${n} plan has reached its usage limit. Check its reset time or choose another connected plan.`,
  turn_expired: () => "That took too long. Try again.",
  output_limit: () => "That reply got too long. Try a shorter ask.",
  provider_error: (n) => `${n} had a problem answering. Try again.`,
  tool_error: () => "One of your apps didn't respond. Try again.",
  turn_failed: () => "That didn't go through. Try again.",
};

export function errorCopy(code: string | undefined, plan: PlanId): string {
  return (ERROR_COPY[code ?? ""] ?? ERROR_COPY.turn_failed)(PLAN_NAME[plan]);
}

// Last consumed seq per thread, so a follow-up turn doesn't re-read the whole thread.
const cursors = new Map<string, number>();

function streamTurn(o: {
  client: ConvexReactClient; token: string; plan: PlanId;
  threadId: Id<"aiThreads">; turnId: Id<"aiTurns">; cursor: number; signal: AbortSignal;
}) {
  return streamTurnUpdates({ ...o, chunk: actionChunk, error: (code) => errorCopy(code, o.plan),
    saveCursor: (cursor) => cursors.set(o.threadId, Math.max(cursors.get(o.threadId) ?? 0, cursor)) });
}

// ---------- Restore ----------

function partsFor(turn: Turn, actions: AgentPart[], plan: PlanId): AgentPart[] {
  const parts: AgentPart[] = [...actions];
  if (turn.assistantText) parts.push({ type: "text", text: turn.assistantText });
  if (turn.status === "error") parts.push({ type: "error", text: errorCopy(turn.error, plan) });
  return parts;
}

async function restoreThread(plan: PlanId, signal: AbortSignal): Promise<AgentRestore | null> {
  const { client, token } = bridge;
  if (!client || !token) return null;
  const saved = await savedThread(plan);
  if (saved === NEW) return null;
  let threadId = saved;
  if (!threadId) {
    const list = await client.query(api.aiChat.threads, { token }).catch(() => null);
    threadId = list?.find((t) => t.provider === plan)?.threadId ?? null;
    if (threadId) rememberThread(plan, threadId);
  }
  if (!threadId) return null;
  const id = threadId as Id<"aiThreads">;
  let view: FunctionReturnType<typeof api.aiChat.watchMessages>;
  try {
    view = await client.query(api.aiChat.watchMessages, { token, threadId: id, limit: 20 });
  } catch {
    rememberThread(plan, null);
    return null;
  }
  if (view.thread.provider !== plan || view.turns.length === 0) return null;

  // Rebuild app cards from tool events; text comes from assistantText.
  const cards = new Map<string, Map<string, AgentPart>>();
  const cursor = view.cursor;
  try {
    for (const e of await snapshotEvents(client, token, id, cursor)) {
      if (e.type === "text_delta") continue;
      const chunk = actionChunk(e);
      if (!chunk || chunk.type !== "action") continue;
      const forTurn = cards.get(e.turnId) ?? new Map<string, AgentPart>();
      forTurn.set(chunk.id, chunk);
      cards.set(e.turnId, forTurn);
    }
  } catch {
    // Cards are a nicety; resume still starts at the atomic text snapshot cursor.
  }

  const messages: AgentMessage[] = [];
  for (const t of view.turns) {
    messages.push({ id: `u-${t.turnId}`, role: "user", parts: [{ type: "text", text: t.message }] });
    messages.push({
      id: `a-${t.turnId}`,
      role: "assistant",
      parts: partsFor(t, [...(cards.get(t.turnId)?.values() ?? [])], plan),
    });
  }

  const lastTurn = view.turns[view.turns.length - 1];
  const live = lastTurn && !TERMINAL.has(lastTurn.status);
  if (!live) cursors.set(id, cursor);
  return {
    messages,
    resume: live
      ? streamTurn({ client, token, plan, threadId: id, turnId: lastTurn.turnId, cursor, signal })
      : undefined,
  };
}

// ---------- Providers ----------

function plan(id: PlanId): AgentProvider {
  return {
    id: PLAN_PROVIDER_ID[id],
    name: PLAN_NAME[id],
    kind: "inapp",
    isConnected: () => isPlanConnected(id),
    connect: async () => {
      const ok = await openLogin(id);
      notifyProvidersChanged();
      if (!ok) throw new Error("dismissed");
    },
    send: async (text, ctx) => {
      const { client, token } = bridge;
      if (!client || !token) throw new Error("not ready");
      const existing = await threadFor(id);
      const clientMessageId = Crypto.randomUUID();
      const args = {
        token,
        message: text,
        clientMessageId,
        ...(existing ? { threadId: existing as Id<"aiThreads"> } : { provider: id }),
      };
      // One retry on a transport failure, with the same clientMessageId.
      let sent: { threadId: Id<"aiThreads">; turnId: Id<"aiTurns"> };
      try {
        sent = await client.mutation(api.aiChat.sendMessage, args);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (/already used|keeps the AI|unavailable/i.test(msg) && existing) {
          // The saved thread is gone or belongs to another plan: start fresh.
          rememberThread(id, null);
          sent = await client.mutation(api.aiChat.sendMessage, {
            token,
            message: text,
            clientMessageId: Crypto.randomUUID(),
            provider: id,
          });
        } else if (/wait for your current reply|connect and select|enter a message/i.test(msg)) {
          throw e;
        } else {
          sent = await client.mutation(api.aiChat.sendMessage, args);
        }
      }
      rememberThread(id, sent.threadId);
      // Everything before this turn is already on screen; start where the last reply ended.
      const cursor = existing === sent.threadId ? (cursors.get(sent.threadId) ?? 0) : 0;
      return {
        type: "stream",
        chunks: streamTurn({
          client,
          token,
          plan: id,
          threadId: sent.threadId,
          turnId: sent.turnId,
          cursor,
          signal: ctx.signal,
        }),
      };
    },
    restore: (signal) => restoreThread(id, signal),
    resetThread: () => rememberThread(id, NEW),
  };
}

export const claudePlan = plan("claude");
export const chatgptPlan = plan("codex");
export const PLAN_PROVIDERS = [claudePlan, chatgptPlan];

let registered = false;
export function registerPlans() {
  if (registered) return;
  registered = true;
  PLAN_PROVIDERS.forEach(registerProvider);
}

export function planForProvider(p: AgentProvider | null | undefined): PlanId | null {
  if (!p) return null;
  return p.id === PLAN_PROVIDER_ID.claude ? "claude" : p.id === PLAN_PROVIDER_ID.codex ? "codex" : null;
}

/** Tell the backend which plan new chats use. Quiet on failure. */
export function selectPlan(id: PlanId) {
  const { client, token } = bridge;
  if (!client || !token || !isPlanConnected(id)) return;
  client.mutation(api.aiProviders.select, { token, provider: id }).catch(() => {});
}

export function bridgeReady() {
  return { client: bridge.client, token: bridge.token };
}
