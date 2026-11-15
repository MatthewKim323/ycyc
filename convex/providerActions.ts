"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import { nativeLogin } from "./lib/providerCli";
import { openProvider, sealProvider } from "./lib/providerVault";

const scope = (owner: string, provider: string) => `${owner}:${provider}:credentials`;

export const login = internalAction({
  args: { sessionId: v.id("aiProviderSessions"), attemptId: v.string() },
  handler: async (ctx, { sessionId, attemptId }): Promise<void> => {
    const row = await ctx.runQuery(internal.aiProviders.get, { sessionId });
    if (!row || row.attemptId !== attemptId) return;
    const active = async () => {
      const state = await ctx.runQuery(internal.aiProviders.get, { sessionId });
      return !!state && state.attemptId === attemptId &&
        (state.status === "starting" || state.status === "authorizing") && (state.loginExpiresAt ?? 0) > Date.now();
    };
    try {
      sealProvider("configuration check", "configuration");
      const credentials = await nativeLogin(row.provider, {
        active,
        challenge: async (challenge) => {
          await ctx.runMutation(internal.aiProviders.publishChallenge, { sessionId, attemptId, ...challenge });
        },
        takeCode: async () => {
          const cipher = await ctx.runMutation(internal.aiProviders.takeCode, { sessionId, attemptId });
          return cipher ? openProvider(cipher, `${row.userId}:${row.provider}:code:${attemptId}`) : null;
        },
      });
      if (!(await active())) return;
      await ctx.runMutation(internal.aiProviders.completeLogin, {
        sessionId, attemptId, credentialsCipher: sealProvider(JSON.stringify(credentials), scope(row.userId, row.provider)),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const diagnostic = /^(provider_[a-z_]+|provider_login_exit_[0-9]+_[a-z]+)$/.test(message) ? message : "runtime_failure";
      console.warn("provider_login", row.provider, diagnostic);
      await ctx.runMutation(internal.aiProviders.failLogin, { sessionId, attemptId, error: "runtime_unavailable" });
    }
  },
});

export const submitCode = action({
  args: { token: v.string(), provider: v.literal("claude"), attemptId: v.string(), code: v.string() },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, input): Promise<{ ok: boolean }> => {
    const row = await ctx.runQuery(internal.aiProviders.forToken, { token: input.token, provider: input.provider });
    const code = input.code.trim();
    if (!row || row.attemptId !== input.attemptId || row.status !== "authorizing" ||
      (row.loginExpiresAt ?? 0) <= Date.now() || !code || Buffer.byteLength(code, "utf8") > 4096 || /[\r\n\x00]/.test(code)) return { ok: false };
    const codeCipher = sealProvider(code, `${row.userId}:${row.provider}:code:${input.attemptId}`);
    const ok = await ctx.runMutation(internal.aiProviders.storeCode, { sessionId: row._id, attemptId: input.attemptId, codeCipher });
    return { ok };
  },
});
