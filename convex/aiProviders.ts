import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { aiProviderValidator } from "./schema";

const LOGIN_TTL_MS = 8 * 60_000;
const RETRY_MS = 5_000;
const providers = ["claude", "codex"] as const;
type Provider = typeof providers[number];
type Session = Doc<"aiProviderSessions">;

const login = makeFunctionReference<"action", { sessionId: Id<"aiProviderSessions">; attemptId: string }>("providerActions:login");
const expire = makeFunctionReference<"mutation", { sessionId: Id<"aiProviderSessions">; attemptId: string }>("aiProviders:expireLogin");
const sessionId = v.id("aiProviderSessions");
const attemptArgs = { sessionId, attemptId: v.string() };

async function authenticate(ctx: Pick<QueryCtx, "db">, token: string) {
  if (!token || token.length > 256) throw new Error("Your yuzu session is unavailable. Reopen the app.");
  const user = await ctx.db.query("users").withIndex("by_mcpToken", (q) => q.eq("mcpToken", token)).unique();
  if (!user) throw new Error("Your yuzu session is unavailable. Reopen the app.");
  return user;
}

function attemptLive(row: Session | null, attemptId: string): row is Session {
  return !!row && row.attemptId === attemptId &&
    (row.status === "starting" || row.status === "authorizing") &&
    (row.loginExpiresAt ?? 0) > Date.now();
}

function opaqueId() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function checkedCipher(cipher: string, limit: number) {
  if (!cipher || cipher.length > limit) throw new Error("Invalid sealed provider data.");
  return cipher;
}

function checkedLoginUrl(provider: Provider, input: string) {
  if (input.length > 8192) throw new Error("Invalid provider login URL.");
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Invalid provider login URL."); }
  const hosts = provider === "claude" ? ["claude.ai", "claude.com", "console.anthropic.com", "platform.claude.com"] : ["auth.openai.com", "openai.com", "chatgpt.com"];
  if (url.protocol !== "https:" || !hosts.includes(url.hostname) || url.username || url.password ||
    (url.port && url.port !== "443") || url.hash) throw new Error("Invalid provider login URL.");
  return url.toString();
}

const clearLogin = {
  loginUrl: undefined, userCode: undefined, loginExpiresAt: undefined,
  codeCipher: undefined,
};

export const status = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await authenticate(ctx, token);
    const rows = await ctx.db.query("aiProviderSessions").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    return providers.map((provider) => {
      const row = rows.find((item) => item.provider === provider);
      return {
        provider,
        status: row?.status ?? "disconnected" as const,
        selected: row?.selected === true && row.status === "connected",
        ...(row?.attemptId ? { attemptId: row.attemptId } : {}),
        ...(row && (row.status === "starting" || row.status === "authorizing") && row.loginExpiresAt ? {
          loginExpiresAt: row.loginExpiresAt,
        } : {}),
        ...(row?.status === "authorizing" ? {
          ...(row.loginUrl ? { loginUrl: row.loginUrl } : {}),
          ...(row.userCode ? { userCode: row.userCode } : {}),
        } : {}),
        ...(row?.error ? { error: row.error } : {}),
      };
    });
  },
});

export const startLogin = mutation({
  args: { token: v.string(), provider: aiProviderValidator },
  handler: async (ctx, { token, provider }) => {
    const user = await authenticate(ctx, token);
    const row = await ctx.db.query("aiProviderSessions")
      .withIndex("by_user_provider", (q) => q.eq("userId", user._id).eq("provider", provider)).unique();
    if (row?.status === "connected") return { attemptId: row.attemptId ?? "" };
    if (row?.attemptId && attemptLive(row, row.attemptId)) return { attemptId: row.attemptId };
    const now = Date.now();
    if (row && now - row.updatedAt < RETRY_MS) throw new Error("Please wait a few seconds before connecting again.");
    const attemptId = opaqueId();
    const update = {
      status: "starting" as const, attemptId, loginExpiresAt: now + LOGIN_TTL_MS,
      loginUrl: undefined, userCode: undefined, codeCipher: undefined, credentialsCipher: undefined,
      error: undefined, connectedAt: undefined,
      selected: false, updatedAt: now,
    };
    const id = row ? row._id : await ctx.db.insert("aiProviderSessions", {
      userId: user._id, provider, status: "starting", attemptId,
      loginExpiresAt: now + LOGIN_TTL_MS, selected: false, updatedAt: now,
    });
    if (row) await ctx.db.patch(id, update);
    await ctx.scheduler.runAfter(0, login, { sessionId: id, attemptId });
    // Persist expiry even if the native action crashes. A query's clock alone
    // cannot notify subscribers when a deadline passes.
    await ctx.scheduler.runAfter(LOGIN_TTL_MS, expire, { sessionId: id, attemptId });
    return { attemptId };
  },
});

export const select = mutation({
  args: { token: v.string(), provider: aiProviderValidator },
  handler: async (ctx, { token, provider }) => {
    const user = await authenticate(ctx, token);
    const rows = await ctx.db.query("aiProviderSessions").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    const chosen = rows.find((row) => row.provider === provider && row.status === "connected" && row.credentialsCipher);
    if (!chosen) throw new Error("Connect this AI subscription before selecting it.");
    const now = Date.now();
    for (const row of rows) if (row.selected !== (row._id === chosen._id)) {
      await ctx.db.patch(row._id, { selected: row._id === chosen._id, updatedAt: now });
    }
    return { provider };
  },
});

export const disconnect = mutation({
  args: { token: v.string(), provider: aiProviderValidator },
  handler: async (ctx, { token, provider }) => {
    const user = await authenticate(ctx, token);
    const row = await ctx.db.query("aiProviderSessions")
      .withIndex("by_user_provider", (q) => q.eq("userId", user._id).eq("provider", provider)).unique();
    if (row) await ctx.db.patch(row._id, {
      ...clearLogin, status: "disconnected", selected: false, attemptId: undefined,
      credentialsCipher: undefined,
      error: undefined, connectedAt: undefined, updatedAt: Date.now(),
    });
    return { provider, status: "disconnected" as const };
  },
});

export const forToken = internalQuery({
  args: { token: v.string(), provider: v.optional(aiProviderValidator) },
  handler: async (ctx, { token, provider }) => {
    const user = await authenticate(ctx, token);
    const rows = await ctx.db.query("aiProviderSessions").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    return provider ? rows.find((row) => row.provider === provider) ?? null :
      rows.find((row) => row.selected && row.status === "connected" && row.credentialsCipher) ?? null;
  },
});

export const get = internalQuery({
  args: { sessionId },
  handler: async (ctx, { sessionId }) => ctx.db.get(sessionId),
});

export const expireLogin = internalMutation({
  args: attemptArgs,
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.sessionId);
    const now = Date.now();
    if (!row || row.attemptId !== args.attemptId ||
      (row.status !== "starting" && row.status !== "authorizing") ||
      (row.loginExpiresAt ?? 0) > now) return false;
    await ctx.db.patch(row._id, {
      ...clearLogin, status: "error", credentialsCipher: undefined, selected: false,
      error: "Sign-in expired. Connect again to continue.", updatedAt: now,
    });
    return true;
  },
});

export const publishChallenge = internalMutation({
  args: { ...attemptArgs, loginUrl: v.string(), userCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.sessionId);
    if (!attemptLive(row, args.attemptId)) return false;
    if (args.userCode && args.userCode.length > 128) throw new Error("Invalid provider sign-in code.");
    await ctx.db.patch(row._id, {
      status: "authorizing", loginUrl: checkedLoginUrl(row.provider, args.loginUrl),
      userCode: args.userCode, updatedAt: Date.now(),
    });
    return true;
  },
});

export const storeCode = internalMutation({
  args: { ...attemptArgs, codeCipher: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.sessionId);
    if (!attemptLive(row, args.attemptId) || row.provider !== "claude" || row.status !== "authorizing" || row.codeCipher !== undefined) return false;
    await ctx.db.patch(row._id, { codeCipher: checkedCipher(args.codeCipher, 16_384), updatedAt: Date.now() });
    return true;
  },
});

export const takeCode = internalMutation({
  args: attemptArgs,
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.sessionId);
    if (!attemptLive(row, args.attemptId) || row.provider !== "claude" || !row.codeCipher) return null;
    // Empty is a consumed marker until this attempt completes or is replaced.
    // Clearing the field here would permit a replaying client to submit again.
    await ctx.db.patch(row._id, { codeCipher: "", updatedAt: Date.now() });
    return row.codeCipher;
  },
});

export const completeLogin = internalMutation({
  args: { ...attemptArgs, credentialsCipher: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.sessionId);
    if (!attemptLive(row, args.attemptId)) return false;
    const rows = await ctx.db.query("aiProviderSessions").withIndex("by_user", (q) => q.eq("userId", row.userId)).collect();
    const selected = !rows.some((item) => item._id !== row._id && item.selected && item.status === "connected");
    const now = Date.now();
    await ctx.db.patch(row._id, {
      ...clearLogin, status: "connected", credentialsCipher: checkedCipher(args.credentialsCipher, 512_000),
      selected, error: undefined, connectedAt: now, updatedAt: now,
    });
    return true;
  },
});

export const failLogin = internalMutation({
  args: { ...attemptArgs, error: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.sessionId);
    if (!attemptLive(row, args.attemptId)) return false;
    // Never persist raw provider errors: they can include URLs or credentials.
    // The runtime may select a useful, generic error code but no arbitrary text.
    const error = args.error === "runtime_unavailable" ? "The AI runtime is unavailable. Try connecting again." :
      args.error === "login_expired" ? "Sign-in expired. Connect again to continue." :
      "Couldn't connect this AI subscription. Try signing in again.";
    await ctx.db.patch(row._id, {
      ...clearLogin, status: "error", credentialsCipher: undefined, selected: false,
      error, updatedAt: Date.now(),
    });
    return true;
  },
});
