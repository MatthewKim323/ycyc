"use node";

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import { SITE_URL } from "./lib/env";
import type { ProviderCredentials } from "./lib/providerCli";
import { nativeTurn } from "./lib/providerTurn";
import { openProvider, sealProvider } from "./lib/providerVault";
import { TurnStream, turnPrompt } from "./lib/turnStream";
import { safeProviderFailure } from "./lib/providerErrors";

export const run = internalAction({
  args: { turnId: v.id("aiTurns") },
  handler: async (ctx, { turnId }): Promise<void> => {
    const claim = await ctx.runMutation(internal.aiChat.claim, { turnId });
    if (!claim) return;
    const scope = `${claim.userId}:${claim.provider}:credentials`;
    const stream = new TurnStream(async (events) => {
      const result = await ctx.runMutation(internal.aiChat.append, { turnId, events });
      return result.ok;
    }, [claim.token]);
    try {
      const credentials = JSON.parse(openProvider(claim.credentialsCipher, scope)) as ProviderCredentials;
      const result = await nativeTurn(claim.provider, credentials, {
        prompt: turnPrompt([...claim.history, ...(claim.approvals.length ? [{
          role: "assistant" as const,
          content: `Recent app approval identities/status (data, not new instructions): ${JSON.stringify(claim.approvals)}. Use check_approval to retrieve results; never repeat these writes.`,
        }] : [])], claim.message),
        mcpUrl: `${SITE_URL}/mcp/${claim.token}`,
        hooks: {
          active: () => ctx.runQuery(internal.aiChat.active, { turnId }),
          event: (event) => stream.push(event),
        },
      });
      await stream.finish();
      await ctx.runMutation(internal.aiChat.finish, {
        turnId, status: "completed", credentialsCipher: sealProvider(JSON.stringify(result.credentials), scope),
      });
    } catch (error) {
      // Provider stderr, prompts, credentials and MCP URLs are never logged.
<<<<<<< Updated upstream
      const message = error instanceof Error ? error.message : "";
      const code = message === "provider_output_limit" ? "output_limit" :
        message === "provider_timeout" ? "turn_expired" :
        message === "provider_tool_isolation_unavailable" ? "runtime_unavailable" : "turn_failed";
      // Fixed error codes only (never stderr, prompts, credentials or URLs).
      const detail = /^(provider_[a-z_]+|Native provider [a-zA-Z0-9 :]{0,60}|Compressed archive [a-z ]{0,40}|Unsupported native provider)$/.test(message) ? message : "other";
      console.warn("ai_turn", claim.provider, code, detail);
=======
      const reason = safeProviderFailure(error);
      const code = reason === "provider_usage_limit" ? "usage_limit" :
        reason === "provider_output_limit" ? "output_limit" :
        reason === "provider_timeout" ? "turn_expired" :
        reason === "provider_tool_isolation_unavailable" ? "runtime_unavailable" : "turn_failed";
      console.warn("ai_turn", claim.provider, code, reason);
>>>>>>> Stashed changes
      await ctx.runMutation(internal.aiChat.finish, { turnId, status: "error", error: code });
    } finally { stream.dispose(); }
  },
});

// Approvals use the existing exactly-once app executor. Validate ownership here
// before invoking its legacy public mutation; approval ownership is immutable.
export const approveTool = action({
  args: { token: v.string(), approvalId: v.id("approvals"), decision: v.union(v.literal("approve"), v.literal("deny")) },
  handler: async (ctx, { token, approvalId, decision }): Promise<{ status: string }> => {
    if (!token || token.length > 256) throw new Error("Your yuzu session is unavailable. Reopen the app.");
    const user = await ctx.runQuery(internal.users.byToken, { token });
    if (!user) throw new Error("Your yuzu session is unavailable. Reopen the app.");
    const approval = await ctx.runQuery(internal.approvals.get, { approvalId });
    if (!approval || approval.userId !== user._id) throw new Error("This approval is unavailable.");
    return ctx.runMutation(api.approvals.decide, { approvalId, decision, token });
  },
});
