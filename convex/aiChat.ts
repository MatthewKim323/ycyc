import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { aiEventTypeValidator, aiProviderValidator } from "./schema";

const TURN_TTL_MS = 8 * 60_000;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_EVENT_BYTES = 512 * 1024;
const turnArgs = { turnId: v.id("aiTurns") };
const run = makeFunctionReference<"action", { turnId: Id<"aiTurns"> }>("aiChatActions:run");
const expiration = makeFunctionReference<"mutation", { turnId: Id<"aiTurns"> }>("aiChat:expire");
type ReadCtx = Pick<QueryCtx, "db">;
type Turn = Doc<"aiTurns">;
const bytes = (text: string) => new TextEncoder().encode(text).length;
const pending = (turn: Turn) => turn.status === "queued" || turn.status === "running";
const errors = new Set(["runtime_unavailable", "provider_disconnected", "turn_expired", "output_limit", "provider_error", "tool_error", "turn_failed"]);
const safeError = (error?: string) => error && errors.has(error) ? error : "provider_error";

async function authenticate(ctx: ReadCtx, token: string) {
  if (!token || token.length > 256) throw new Error("Your yuzu session is unavailable. Reopen the app.");
  const user = await ctx.db.query("users").withIndex("by_mcpToken", (q) => q.eq("mcpToken", token)).unique();
  if (!user) throw new Error("Your yuzu session is unavailable. Reopen the app.");
  return user;
}

async function ownedThread(ctx: ReadCtx, id: Id<"aiThreads">, userId: Id<"users">) {
  const thread = await ctx.db.get(id);
  if (!thread || thread.userId !== userId) throw new Error("This yuzu chat is unavailable.");
  return thread;
}

async function authSession(ctx: ReadCtx, turn: Turn) {
  const session = await ctx.db.get(turn.providerSessionId);
  return session && session.userId === turn.userId && session.provider === turn.provider &&
    session.status === "connected" && session.attemptId === turn.providerAttemptId && session.credentialsCipher ? session : null;
}

async function terminal(ctx: MutationCtx, turn: Turn, status: "completed" | "error" | "cancelled", error?: string) {
  const now = Date.now();
  await ctx.db.patch(turn._id, { status, error, updatedAt: now, completedAt: now });
  const thread = await ctx.db.get(turn.threadId);
  if (thread?.activeTurnId === turn._id) await ctx.db.patch(thread._id, { activeTurnId: undefined, updatedAt: now });
}

function threadView(thread: Doc<"aiThreads">) {
  return { threadId: thread._id, provider: thread.provider, title: thread.title,
    ...(thread.activeTurnId ? { activeTurnId: thread.activeTurnId } : {}), createdAt: thread.createdAt, updatedAt: thread.updatedAt };
}

function turnView(turn: Turn) {
  return { turnId: turn._id, message: turn.message, assistantText: turn.assistantText, status: turn.status,
    ...(turn.error ? { error: turn.error } : {}), createdAt: turn.createdAt, updatedAt: turn.updatedAt,
    ...(turn.completedAt !== undefined ? { completedAt: turn.completedAt } : {}) };
}

function pageLimit(input: number | undefined, fallback: number, max: number) {
  if (input !== undefined && (!Number.isSafeInteger(input) || input < 1)) throw new Error("Invalid chat page size.");
  return Math.min(input ?? fallback, max);
}

export const sendMessage = mutation({
  args: { token: v.string(), threadId: v.optional(v.id("aiThreads")), provider: v.optional(aiProviderValidator), message: v.string(), clientMessageId: v.string() },
  handler: async (ctx, input) => {
    const user = await authenticate(ctx, input.token);
    if (!input.message.trim() || bytes(input.message) > 16 * 1024 || /\x00/.test(input.message)) throw new Error("Enter a message up to 16 KiB.");
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.clientMessageId)) throw new Error("Invalid client message ID.");
    let thread = input.threadId ? await ownedThread(ctx, input.threadId, user._id) : null;
    const duplicate = await ctx.db.query("aiTurns").withIndex("by_user_client", (q) => q.eq("userId", user._id).eq("clientMessageId", input.clientMessageId)).unique();
    if (duplicate) {
      if (duplicate.message !== input.message || (thread && thread._id !== duplicate.threadId) ||
        (input.provider && input.provider !== duplicate.provider)) throw new Error("This message ID was already used for another message.");
      return { threadId: duplicate.threadId, turnId: duplicate._id };
    }
    if (thread && input.provider && thread.provider !== input.provider) throw new Error("A chat keeps the AI subscription it started with.");
    const sessions = await ctx.db.query("aiProviderSessions").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    const requested = thread?.provider ?? input.provider;
    const session = sessions.find((row) => row.status === "connected" && row.credentialsCipher && row.attemptId &&
      (requested ? row.provider === requested : row.selected));
    if (!session?.attemptId) throw new Error("Connect and select an AI subscription first.");
    for (const status of ["queued", "running"] as const) {
      const active = await ctx.db.query("aiTurns").withIndex("by_user_status", (q) => q.eq("userId", user._id).eq("status", status)).first();
      if (active) {
        if (active.expiresAt > Date.now()) throw new Error("Wait for your current reply or cancel it first.");
        await terminal(ctx, active, "error", "turn_expired");
      }
    }
    const now = Date.now();
    if (!thread) {
      const id = await ctx.db.insert("aiThreads", { userId: user._id, provider: session.provider,
        title: input.message.trim().slice(0, 80), nextSeq: 1, createdAt: now, updatedAt: now });
      thread = (await ctx.db.get(id))!;
    }
    const turnId = await ctx.db.insert("aiTurns", {
      userId: user._id, threadId: thread._id, provider: session.provider,
      providerSessionId: session._id, providerAttemptId: session.attemptId,
      clientMessageId: input.clientMessageId, message: input.message, assistantText: "", status: "queued",
      eventCount: 0, eventBytes: 0, outputBytes: 0, createdAt: now, updatedAt: now, expiresAt: now + TURN_TTL_MS,
    });
    await ctx.db.patch(thread._id, { activeTurnId: turnId, updatedAt: now });
    await ctx.scheduler.runAfter(0, run, { turnId });
    await ctx.scheduler.runAfter(TURN_TTL_MS, expiration, { turnId });
    return { threadId: thread._id, turnId };
  },
});

export const watchMessages = query({
  args: { token: v.string(), threadId: v.id("aiThreads"), limit: v.optional(v.number()) },
  handler: async (ctx, input) => {
    const user = await authenticate(ctx, input.token);
    const thread = await ownedThread(ctx, input.threadId, user._id);
    const turns = await ctx.db.query("aiTurns").withIndex("by_thread_created", (q) => q.eq("threadId", thread._id))
      .order("desc").take(pageLimit(input.limit, 20, 50));
    let size = 0;
    const bounded = [];
    for (const turn of turns) {
      size += bytes(turn.message) + bytes(turn.assistantText);
      if (size > 1024 * 1024) break;
      bounded.push(turnView(turn));
    }
    // Text and cursor must come from the same transactional snapshot. A client
    // restoring text cannot advance to a later events cursor without losing
    // deltas generated between those reads.
    return { thread: threadView(thread), turns: bounded.reverse(), cursor: thread.nextSeq - 1 };
  },
});

export const threads = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await authenticate(ctx, token);
    const rows = await ctx.db.query("aiThreads").withIndex("by_user_updated", (q) => q.eq("userId", user._id)).order("desc").take(50);
    return rows.map(threadView);
  },
});

export const events = query({
  args: { token: v.string(), threadId: v.id("aiThreads"), afterSeq: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, input) => {
    const user = await authenticate(ctx, input.token);
    await ownedThread(ctx, input.threadId, user._id);
    const after = input.afterSeq ?? 0;
    if (!Number.isSafeInteger(after) || after < 0) throw new Error("Invalid stream cursor.");
    const limit = pageLimit(input.limit, 100, 200);
    const rows = await ctx.db.query("aiEvents").withIndex("by_thread_seq", (q) => q.eq("threadId", input.threadId).gt("seq", after)).take(limit + 1);
    const page = rows.slice(0, limit);
    return { events: page.map((row) => ({ seq: row.seq, turnId: row.turnId, type: row.type,
      ...(row.text !== undefined ? { text: row.text } : {}), ...(row.name ? { name: row.name } : {}), ...(row.id ? { id: row.id } : {}), createdAt: row.createdAt })),
      cursor: page.at(-1)?.seq ?? after, hasMore: rows.length > limit };
  },
});

export const cancelTurn = mutation({
  args: { token: v.string(), ...turnArgs },
  handler: async (ctx, { token, turnId }) => {
    const user = await authenticate(ctx, token);
    const turn = await ctx.db.get(turnId);
    if (!turn || turn.userId !== user._id) throw new Error("This yuzu reply is unavailable.");
    if (pending(turn)) {
      const expired = turn.expiresAt <= Date.now();
      await terminal(ctx, turn, expired ? "error" : "cancelled", expired ? "turn_expired" : undefined);
      return { status: expired ? "error" as const : "cancelled" as const };
    }
    return { status: turn.status };
  },
});

export const claim = internalMutation({
  args: turnArgs,
  handler: async (ctx, { turnId }) => {
    const turn = await ctx.db.get(turnId);
    if (!turn || turn.status !== "queued") return null;
    if (turn.expiresAt <= Date.now()) { await terminal(ctx, turn, "error", "turn_expired"); return null; }
    const session = await authSession(ctx, turn);
    const user = await ctx.db.get(turn.userId);
    if (!session || !user) { await terminal(ctx, turn, "error", "provider_disconnected"); return null; }
    const previous = await ctx.db.query("aiTurns").withIndex("by_thread_created", (q) => q.eq("threadId", turn.threadId)).order("desc").take(13);
    const history: { role: "user" | "assistant"; content: string }[] = [];
    let historyBytes = 0;
    for (const item of previous) {
      if (item._id === turn._id || item.status !== "completed") continue;
      const size = bytes(item.message) + bytes(item.assistantText);
      if (historyBytes + size > 64 * 1024) break;
      historyBytes += size;
      history.unshift({ role: "user", content: item.message }, { role: "assistant", content: item.assistantText });
    }
    // Native turns are ephemeral. Carry only approval identities/status across
    // turns so a follow-up can check the existing write instead of issuing it twice.
    const approvals: { id: string; appSlug: string; tool: string; status: string; hasResult: boolean }[] = [];
    for (const [status, limit] of [["pending", 5], ["approved", 3], ["denied", 2]] as const) {
      const rows = await ctx.db.query("approvals").withIndex("by_user_status", (q) => q.eq("userId", turn.userId).eq("status", status)).order("desc").take(limit);
      for (const row of rows) approvals.push({ id: row._id, appSlug: row.appSlug, tool: row.tool, status: row.status, hasResult: !!row.resultJson });
    }
    await ctx.db.patch(turn._id, { status: "running", startedAt: Date.now(), updatedAt: Date.now() });
    return { turnId: turn._id, threadId: turn.threadId, userId: turn.userId, provider: turn.provider,
      providerSessionId: session._id, providerAttemptId: turn.providerAttemptId, credentialsCipher: session.credentialsCipher!,
      token: user.mcpToken, message: turn.message, history, approvals, expiresAt: turn.expiresAt };
  },
});

export const active = internalQuery({
  args: turnArgs,
  handler: async (ctx, { turnId }) => {
    const turn = await ctx.db.get(turnId);
    return !!turn && turn.status === "running" && turn.expiresAt > Date.now() && !!(await authSession(ctx, turn));
  },
});

const eventValidator = v.object({ type: aiEventTypeValidator, text: v.optional(v.string()), name: v.optional(v.string()), id: v.optional(v.string()) });
export const append = internalMutation({
  args: { ...turnArgs, events: v.array(eventValidator) },
  handler: async (ctx, { turnId, events }) => {
    const turn = await ctx.db.get(turnId);
    const thread = turn ? await ctx.db.get(turn.threadId) : null;
    if (!turn || !thread || turn.status !== "running" || turn.expiresAt <= Date.now() || !(await authSession(ctx, turn))) return { ok: false, cursor: thread ? thread.nextSeq - 1 : 0 };
    if (events.length < 1 || events.length > 32) throw new Error("Invalid stream batch.");
    let output = "", eventBytes = 0;
    for (const event of events) {
      if ((event.text !== undefined && bytes(event.text) > 8192) ||
        [event.name, event.id].some((value) => value !== undefined && !/^[A-Za-z0-9_.:/-]{1,256}$/.test(value)) ||
        (event.type !== "text_delta" && event.text !== undefined) ||
        (event.type === "text_delta" && (event.text === undefined || event.name !== undefined || event.id !== undefined))) throw new Error("Invalid normalized stream event.");
      if (event.type === "text_delta") output += event.text;
      eventBytes += bytes(JSON.stringify(event));
    }
    const outputBytes = turn.outputBytes + bytes(output);
    if (outputBytes > MAX_OUTPUT_BYTES || turn.eventBytes + eventBytes > MAX_EVENT_BYTES || turn.eventCount + events.length > 2000) {
      await terminal(ctx, turn, "error", "output_limit");
      return { ok: false, cursor: thread.nextSeq - 1 };
    }
    const now = Date.now();
    let seq = thread.nextSeq;
    for (const event of events) await ctx.db.insert("aiEvents", { threadId: thread._id, turnId, seq: seq++, ...event, createdAt: now });
    await ctx.db.patch(turnId, { assistantText: turn.assistantText + output, outputBytes,
      eventBytes: turn.eventBytes + eventBytes, eventCount: turn.eventCount + events.length, updatedAt: now });
    await ctx.db.patch(thread._id, { nextSeq: seq, updatedAt: now });
    return { ok: true, cursor: seq - 1 };
  },
});

export const finish = internalMutation({
  args: { ...turnArgs, status: v.union(v.literal("completed"), v.literal("error")), error: v.optional(v.string()), credentialsCipher: v.optional(v.string()) },
  handler: async (ctx, input) => {
    const turn = await ctx.db.get(input.turnId);
    if (!turn || turn.status !== "running" || turn.expiresAt <= Date.now()) return false;
    const session = await authSession(ctx, turn);
    if (input.credentialsCipher !== undefined && (!input.credentialsCipher || input.credentialsCipher.length > 512_000)) throw new Error("Invalid sealed provider data.");
    if (session && input.credentialsCipher) await ctx.db.patch(session._id, { credentialsCipher: input.credentialsCipher, updatedAt: Date.now() });
    await terminal(ctx, turn, session ? input.status : "error", session ? (input.status === "error" ? safeError(input.error) : undefined) : "provider_disconnected");
    return true;
  },
});

export const expire = internalMutation({
  args: turnArgs,
  handler: async (ctx, { turnId }) => {
    const turn = await ctx.db.get(turnId);
    if (!turn || !pending(turn) || turn.expiresAt > Date.now()) return false;
    await terminal(ctx, turn, "error", "turn_expired");
    return true;
  },
});
