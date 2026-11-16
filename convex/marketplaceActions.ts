"use node";

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action, type ActionCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MarketplaceItem } from "./marketplace";
import { externalPlugin } from "./lib/marketplaceCatalog";
import { remotePluginCall, remotePluginTools, type RemotePluginTool } from "./lib/marketplaceClient";
import { openProvider, sealProvider } from "./lib/providerVault";
import { publicToolData } from "./lib/publicToolData";
import { callUserAppTool } from "./lib/mcp";

const pluginArgs = { token: v.string(), pluginId: v.string() };
function codeFor(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/marketplace_(credential_required|authentication_failed|access_denied)/.test(message)) return "authentication_required";
  if (message === "marketplace_rate_limited") return "rate_limited";
  if (/marketplace_(protocol_error|unsupported_content|unsupported_encoding|response_limit|schema_limit|private_response)/.test(message)) return "invalid_response";
  return "unavailable";
}
function failure(code: string) {
  const messages: Record<string, string> = { authentication_required: "Connect a valid credential for this integration.", rate_limited: "The integration is rate limited. Try again later.", invalid_response: "The integration returned unsupported data.", unavailable: "This integration could not complete the request.", invalid_arguments: "Provide arguments matching this installed tool's schema.", not_installed: "Install and connect this integration before using its tools.", revoked: "This integration was changed or removed during the request." };
  return { ok: false as const, error: { code, message: messages[code] ?? messages.unavailable } };
}
type Failure = ReturnType<typeof failure>;
type PluginTool = { name: string; description: string; inputSchemaJson: string; kind: "read" | "write"; toolId?: string };
type ToolResponse = Failure | { ok: true; pluginId: string; tools: PluginTool[] };
type CallResponse = Failure | { ok?: boolean; pluginId: string; tool: string; result: unknown };
function argumentsFor(args: unknown, token: string, credential?: string): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("marketplace_invalid_arguments");
  const text = JSON.stringify(args);
  if (Buffer.byteLength(text) > 32 * 1024 || text.includes(token) || (credential && text.includes(credential))) throw new Error("marketplace_invalid_arguments");
  let nodes = 0;
  const walk = (value: unknown, depth: number) => {
    if (++nodes > 1000 || depth > 8) throw new Error("marketplace_invalid_arguments");
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("marketplace_invalid_arguments");
    if (value && typeof value === "object") {
      const entries = Object.entries(value);
      if (entries.length > 100) throw new Error("marketplace_invalid_arguments");
      for (const [key, child] of entries) {
        if (["__proto__", "prototype", "constructor"].includes(key) || key.startsWith("$")) throw new Error("marketplace_invalid_arguments");
        walk(child, depth + 1);
      }
    }
  };
  walk(args, 0);
  return args as Record<string, unknown>;
}
type Context = { userId: Id<"users">; listing: MarketplaceItem; installation: Doc<"pluginInstallations"> | null; connectionId?: Id<"connections"> };
const load = (ctx: ActionCtx, token: string, pluginId: string): Promise<Context> => ctx.runQuery(internal.marketplace.context, { token, pluginId });
function credential(state: Context) {
  const cipher = state.installation?.credentialsCipher;
  return cipher ? openProvider(cipher, `${state.userId}:marketplace:${state.listing.id}`) : undefined;
}
async function active(ctx: ActionCtx, token: string, pluginId: string, epoch?: string) {
  const current = await load(ctx, token, pluginId);
  if (current.listing.state !== "installed") return false;
  return epoch === undefined ? !current.installation || current.installation.status === "installed" : current.installation?.epoch === epoch && current.installation.status === "installed";
}
function metadata(tools: RemotePluginTool[]) {
  return tools.map((t) => ({ name: t.name, description: t.description, inputSchemaJson: JSON.stringify(t.inputSchema), kind: "read" as const }));
}

async function enable(ctx: ActionCtx, token: string, pluginId: string, mode: "install" | "connect" | "refresh", apiKey?: string): Promise<{ ok: boolean; plugin?: MarketplaceItem | null; error?: { code: string; message: string } }> {
  const current = await load(ctx, token, pluginId);
  const external = externalPlugin(pluginId);
  if (mode === "connect" && (!external || external.auth === "none")) return failure("invalid_arguments");
  if (apiKey !== undefined && (!/^[A-Za-z0-9._~+/=-]{16,4096}$/.test(apiKey) || apiKey.includes(token))) return failure("invalid_arguments");
  const start = await ctx.runMutation(internal.marketplace.begin, { token, pluginId, mode });
  if (start.reused || start.status !== "connecting" || !external) return { ok: true as const, plugin: await ctx.runQuery(api.marketplace.get, { token, pluginId }) };
  try {
    const key = apiKey ?? (start.credentialsCipher ? openProvider(start.credentialsCipher, `${current.userId}:marketplace:${pluginId}`) : undefined);
    const tools = metadata(await remotePluginTools(external, key));
    const saved = await ctx.runMutation(internal.marketplace.complete, { token, pluginId, epoch: start.epoch, toolsJson: JSON.stringify(tools), ...(key ? { credentialsCipher: sealProvider(key, `${current.userId}:marketplace:${pluginId}`) } : {}) });
    if (!saved) return failure("revoked");
    return { ok: true as const, plugin: await ctx.runQuery(api.marketplace.get, { token, pluginId }) };
  } catch (error) {
    const code = codeFor(error);
    await ctx.runMutation(internal.marketplace.fail, { token, pluginId, epoch: start.epoch, code });
    return { ...failure(code), plugin: await ctx.runQuery(api.marketplace.get, { token, pluginId }) };
  }
}

export const install = action({ args: pluginArgs, handler: (ctx, a) => enable(ctx, a.token, a.pluginId, "install") });
export const connect = action({ args: { ...pluginArgs, apiKey: v.string() }, handler: (ctx, a) => enable(ctx, a.token, a.pluginId, "connect", a.apiKey) });
export const refresh = action({ args: pluginArgs, handler: (ctx, a) => enable(ctx, a.token, a.pluginId, "refresh") });

export const uninstall = action({
  args: pluginArgs,
  handler: async (ctx, a) => {
    await ctx.runMutation(internal.marketplace.deactivate, a);
    return { ok: true as const, pluginId: a.pluginId, state: "not_installed" as const };
  },
});

export const tools = action({
  args: pluginArgs,
  handler: async (ctx, a): Promise<ToolResponse> => {
    const state = await load(ctx, a.token, a.pluginId);
    if (state.listing.state !== "installed") return failure("not_installed");
    if (state.listing.source !== "remote") return { ok: true, pluginId: a.pluginId, tools: await ctx.runQuery(internal.marketplace.nativeTools, a) };
    if (!state.installation?.toolsJson) return failure("not_installed");
    return { ok: true, pluginId: a.pluginId, tools: JSON.parse(state.installation.toolsJson) as { name: string; description: string; inputSchemaJson: string; kind: "read" }[] };
  },
});

export const call = action({
  args: { ...pluginArgs, tool: v.string(), args: v.any(), requestId: v.optional(v.string()) },
  handler: async (ctx, a): Promise<CallResponse> => {
    const state = await load(ctx, a.token, a.pluginId);
    if (state.listing.state !== "installed") return failure("not_installed");
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(a.tool)) return failure("invalid_arguments");
    let key: string | undefined;
    try {
      if (state.listing.source === "remote") key = credential(state);
      const args = argumentsFor(a.args, a.token, key);
      if (state.listing.source === "connector") {
        const result = await callUserAppTool(ctx, a.token, a.pluginId.slice(5), a.tool, args);
        if (!(await active(ctx, a.token, a.pluginId, state.installation?.epoch))) return failure("revoked");
        return { ok: !result.isError, pluginId: a.pluginId, tool: a.tool, result: publicToolData(result, a.token) };
      }
      if (state.listing.source === "learned") {
        const allowed = await ctx.runQuery(internal.marketplace.nativeTools, { token: a.token, pluginId: a.pluginId });
        if (!allowed.some((t) => t.name === a.tool)) return failure("invalid_arguments");
        const output = await ctx.runAction(internal.appLearning.tool, { token: a.token, operation: "call_learned_tool", argsJson: JSON.stringify({ toolId: a.pluginId.slice(8), args, ...(a.requestId ? { requestId: a.requestId } : {}) }) });
        if (!(await active(ctx, a.token, a.pluginId, state.installation?.epoch))) return failure("revoked");
        return { pluginId: a.pluginId, tool: a.tool, result: JSON.parse(output) };
      }
      const entry = externalPlugin(a.pluginId)!;
      const cached = state.installation?.toolsJson ? JSON.parse(state.installation.toolsJson) as { name: string }[] : [];
      if (!entry.allowedTools.includes(a.tool) || !cached.some((t) => t.name === a.tool)) return failure("invalid_arguments");
      // No native provider credentials, app cookies or Yuzu capability ever
      // enter this call. Only this plugin's explicitly connected key is used.
      const result = await remotePluginCall(entry, a.tool, args, key);
      if (!(await active(ctx, a.token, a.pluginId, state.installation?.epoch))) return failure("revoked");
      return { ok: !result.isError, pluginId: a.pluginId, tool: a.tool, result: publicToolData(result, a.token) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "marketplace_invalid_arguments" || message === "marketplace_tool_not_allowed") return failure("invalid_arguments");
      const code = codeFor(error);
      if (code === "authentication_required" && state.installation) await ctx.runMutation(internal.marketplace.fail, { token: a.token, pluginId: a.pluginId, epoch: state.installation.epoch, code });
      return failure(code);
    }
  },
});
