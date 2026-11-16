import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import { disconnectConnection } from "./connections";
import { CATALOG } from "./catalog";
import { externalPlugin, EXTERNAL_PLUGINS } from "./lib/marketplaceCatalog";
import { SITE_URL } from "./lib/env";
import { epoch } from "./lib/learningPolicy";
import { recipeAt, bestRecipe } from "./lib/recipeStore";

export type MarketplaceItem = {
  id: string; kind: "yuzu" | "mcp"; source: "connector" | "learned" | "remote";
  name: string; description: string; publisher: string; category: string;
  visibility: "public" | "private"; auth: string; sourceUrl: string;
  state: "not_installed" | "needs_connection" | "connecting" | "installed" | "error";
  toolCount: number; readOnly: boolean; permissions: string[];
  connectUrl?: string; errorCode?: string;
};
const usable = (c: Doc<"connections"> | null) => !!c && ["live", "capturing"].includes(c.status) && !!c.sessionJson;
export async function marketplaceOwner(ctx: Pick<QueryCtx, "db">, token: string) {
  const user = token.length >= 16 && token.length <= 256 ? await ctx.db.query("users").withIndex("by_mcpToken", (q) => q.eq("mcpToken", token)).unique() : null;
  if (!user) throw new Error("Your Yuzu session is unavailable. Reopen the app.");
  return user;
}
export async function installationFor(ctx: Pick<QueryCtx, "db">, userId: Id<"users">, pluginId: string) {
  return ctx.db.query("pluginInstallations").withIndex("by_user_plugin", (q) => q.eq("userId", userId).eq("pluginId", pluginId)).unique();
}

async function catalog(ctx: QueryCtx, userId: Id<"users">): Promise<MarketplaceItem[]> {
  const rows = await ctx.db.query("pluginInstallations").withIndex("by_user", (q) => q.eq("userId", userId)).take(300);
  const installs = new Map(rows.map((r) => [r.pluginId, r]));
  const connections = await ctx.db.query("connections").withIndex("by_user", (q) => q.eq("userId", userId)).take(200);
  const items: MarketplaceItem[] = [];
  for (const app of CATALOG) {
    const id = `yuzu:${app.slug}`, installed = installs.get(id), conn = connections.find((c) => c.appSlug === app.slug);
    const recipe = await bestRecipe(ctx, app.slug);
    items.push({ id, kind: "yuzu", source: "connector", name: app.name, description: app.blurb, publisher: "Yuzu", category: app.category,
      visibility: "public", auth: "app_login", sourceUrl: app.loginUrl ?? "", toolCount: recipe?.tools.length ?? 0, readOnly: !recipe?.tools.some((t) => t.kind === "write"),
      state: installed?.status === "uninstalled" ? "not_installed" : conn?.status === "live" ? "installed" : conn || installed ? "needs_connection" : "not_installed",
      connectUrl: `${SITE_URL}/connect/${app.slug}`, permissions: ["Use your connected app account", "App writes retain their approval flow"] });
  }
  for (const p of EXTERNAL_PLUGINS) {
    const installed = installs.get(p.id);
    items.push({ id: p.id, kind: "mcp", source: "remote", name: p.name, description: p.description, publisher: p.publisher, category: p.category,
      visibility: "public", auth: p.auth, sourceUrl: p.docsUrl, state: !installed || installed.status === "uninstalled" ? "not_installed" : installed.status,
      toolCount: installed?.toolsJson ? JSON.parse(installed.toolsJson).length : p.allowedTools.length,
      readOnly: true, permissions: ["Read-only tools reviewed by Yuzu", `Queries you submit are sent to ${p.publisher}`, ...(p.auth !== "none" ? ["Use the credential you connect for this plugin only"] : [])], ...(installed?.errorCode ? { errorCode: installed.errorCode } : {}) });
  }
  const learned = await ctx.db.query("appLearnedTools").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").take(200);
  for (const tool of learned) {
    if (tool.status !== "published") continue;
    const e = await ctx.db.get(tool.evidenceId);
    if (!e || e.userId !== userId || e.expiresAt <= Date.now()) continue;
    const conn = e.connectionId ? connections.find((c) => c._id === e.connectionId) ?? null : null;
    const ready = !e.connectionId || usable(conn) && await epoch(conn!.sessionJson!) === e.sessionEpoch;
    const installed = installs.get(`learned:${tool._id}`);
    items.push({ id: `learned:${tool._id}`, kind: "yuzu", source: "learned", name: tool.title, description: `Your private ${tool.kind ?? "read"} tool for ${tool.appSlug}.`, publisher: "You", category: "private",
      visibility: "private", auth: e.connectionId ? "app_login" : "none", sourceUrl: e.origin, toolCount: 1, readOnly: tool.kind !== "write",
      state: installed?.status === "uninstalled" ? "not_installed" : ready ? "installed" : "needs_connection",
      permissions: ["Available only to your account", ...(tool.kind === "write" ? ["Every write requires one-time exact-action approval"] : ["Read the endpoint you verified"])],
      ...(e.connectionId ? { connectUrl: `${SITE_URL}/connect/${tool.appSlug}` } : {}) });
  }
  return items;
}

export const list = query({
  args: { token: v.string(), query: v.optional(v.string()), kind: v.optional(v.union(v.literal("yuzu"), v.literal("mcp"))) },
  handler: async (ctx, a) => {
    const user = await marketplaceOwner(ctx, a.token);
    const text = (a.query ?? "").trim().toLowerCase().slice(0, 100);
    return (await catalog(ctx, user._id)).filter((p) => (!a.kind || p.kind === a.kind) && (!text || `${p.name} ${p.description} ${p.publisher} ${p.category}`.toLowerCase().includes(text)));
  },
});
export const get = query({
  args: { token: v.string(), pluginId: v.string() },
  handler: async (ctx, a) => { const user = await marketplaceOwner(ctx, a.token); return (await catalog(ctx, user._id)).find((p) => p.id === a.pluginId) ?? null; },
});
export const installed = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => { const user = await marketplaceOwner(ctx, token); return (await catalog(ctx, user._id)).filter((p) => p.state !== "not_installed"); },
});

export const context = internalQuery({
  args: { token: v.string(), pluginId: v.string() },
  handler: async (ctx, a) => {
    const user = await marketplaceOwner(ctx, a.token);
    const listing = (await catalog(ctx, user._id)).find((p) => p.id === a.pluginId);
    if (!listing) throw new Error("This plugin is unavailable.");
    const installation = await installationFor(ctx, user._id, a.pluginId);
    const conn = listing.source === "connector" ? await ctx.db.query("connections").withIndex("by_user_app", (q) => q.eq("userId", user._id).eq("appSlug", a.pluginId.slice(5))).first() : null;
    return { userId: user._id, listing, installation, connectionId: conn?._id };
  },
});

export const begin = internalMutation({
  args: { token: v.string(), pluginId: v.string(), mode: v.union(v.literal("install"), v.literal("connect"), v.literal("refresh")) },
  handler: async (ctx, a) => {
    const user = await marketplaceOwner(ctx, a.token);
    const listing = (await catalog(ctx, user._id)).find((p) => p.id === a.pluginId);
    if (!listing) throw new Error("This plugin is unavailable.");
    const previous = await installationFor(ctx, user._id, a.pluginId);
    if (a.mode === "install" && listing.source === "remote" && previous?.status === "connecting" && previous.updatedAt > Date.now() - 120_000) return { reused: true, userId: user._id, epoch: previous.epoch, status: previous.status, credentialsCipher: previous.credentialsCipher };
    if (a.mode === "install" && previous?.status === "installed" && (listing.source === "remote" || listing.state === "installed")) return { reused: true, userId: user._id, epoch: previous.epoch, status: previous.status, credentialsCipher: previous.credentialsCipher };
    const now = Date.now(), installationEpoch = crypto.randomUUID();
    let status: Doc<"pluginInstallations">["status"];
    if (listing.source === "remote") {
      const p = externalPlugin(a.pluginId)!;
      status = p.auth === "api_key" && a.mode !== "connect" && !previous?.credentialsCipher ? "needs_connection" : "connecting";
    } else if (listing.source === "connector") {
      if (a.mode === "connect") throw new Error("Use this app's existing sign-in flow.");
      const slug = a.pluginId.slice(5);
      let conn = await ctx.db.query("connections").withIndex("by_user_app", (q) => q.eq("userId", user._id).eq("appSlug", slug)).first();
      if (!conn) {
        const connectionId = await ctx.db.insert("connections", { userId: user._id, appSlug: slug, status: "needs_login", createdAt: now, updatedAt: now });
        conn = await ctx.db.get(connectionId);
      }
      status = conn?.status === "live" ? "installed" : "needs_connection";
    } else {
      if (a.mode === "connect") throw new Error("Use this tool's app sign-in flow.");
      if (listing.state === "needs_connection") throw new Error("Reconnect the app before enabling this tool.");
      status = "installed";
    }
    const fields = { userId: user._id, pluginId: a.pluginId, epoch: installationEpoch, status, version: "1", installedAt: previous?.installedAt ?? now, updatedAt: now,
      credentialsCipher: listing.source === "remote" && a.mode !== "connect" ? previous?.credentialsCipher : undefined, toolsJson: undefined, errorCode: undefined };
    if (previous) await ctx.db.patch(previous._id, fields); else await ctx.db.insert("pluginInstallations", fields);
    return { reused: false, userId: user._id, epoch: installationEpoch, status, credentialsCipher: fields.credentialsCipher };
  },
});

export const complete = internalMutation({
  args: { token: v.string(), pluginId: v.string(), epoch: v.string(), toolsJson: v.string(), credentialsCipher: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await marketplaceOwner(ctx, a.token);
    const row = await installationFor(ctx, user._id, a.pluginId);
    if (!row || row.status !== "connecting" || row.epoch !== a.epoch) return false;
    if (!externalPlugin(a.pluginId) || a.toolsJson.length > 128 * 1024 || (a.credentialsCipher?.length ?? 0) > 16000) throw new Error("Plugin metadata limit exceeded.");
    const tools: unknown = JSON.parse(a.toolsJson);
    if (!Array.isArray(tools) || tools.length === 0 || tools.length > 30) throw new Error("No reviewed tools were discovered.");
    await ctx.db.patch(row._id, { status: "installed", toolsJson: a.toolsJson, credentialsCipher: a.credentialsCipher, errorCode: undefined, updatedAt: Date.now() });
    return true;
  },
});
export const fail = internalMutation({
  args: { token: v.string(), pluginId: v.string(), epoch: v.string(), code: v.string() },
  handler: async (ctx, a) => {
    const user = await marketplaceOwner(ctx, a.token); const row = await installationFor(ctx, user._id, a.pluginId);
    if (!row || row.status === "uninstalled" || row.epoch !== a.epoch) return false;
    const code = ["authentication_required", "rate_limited", "unavailable", "invalid_response"].includes(a.code) ? a.code : "unavailable";
    await ctx.db.patch(row._id, { status: code === "authentication_required" ? "needs_connection" : "error", errorCode: code, ...(code === "authentication_required" ? { credentialsCipher: undefined } : {}), updatedAt: Date.now() });
    return true;
  },
});

export const nativeTools = internalQuery({
  args: { token: v.string(), pluginId: v.string() },
  handler: async (ctx, a) => {
    const user = await marketplaceOwner(ctx, a.token);
    const listing = (await catalog(ctx, user._id)).find((p) => p.id === a.pluginId);
    if (!listing || listing.state !== "installed" || listing.source === "remote") throw new Error("Connect this plugin before using its tools.");
    if (listing.source === "learned") {
      const id = ctx.db.normalizeId("appLearnedTools", a.pluginId.slice(8)); const tool = id ? await ctx.db.get(id) : null;
      if (!tool || tool.userId !== user._id || tool.status !== "published") throw new Error("This private tool is unavailable.");
      return [{ name: tool.name, description: tool.title, inputSchemaJson: tool.inputSchemaJson ?? '{"type":"object","properties":{}}', kind: tool.kind ?? "read", toolId: tool._id }];
    }
    const slug = a.pluginId.slice(5);
    const conn = await ctx.db.query("connections").withIndex("by_user_app", (q) => q.eq("userId", user._id).eq("appSlug", slug)).first();
    if (!conn || conn.status !== "live") throw new Error("Reconnect this app.");
    const recipe = await recipeAt(ctx, slug, conn.recipeVersion);
    return recipe?.tools.map((t) => ({ name: t.name, description: t.description, inputSchemaJson: JSON.stringify(t.inputSchema), kind: t.kind })) ?? [];
  },
});

export const deactivate = internalMutation({
  args: { token: v.string(), pluginId: v.string() },
  handler: async (ctx, a) => {
    const user = await marketplaceOwner(ctx, a.token);
    const row = await installationFor(ctx, user._id, a.pluginId), now = Date.now();
    const listing = (await catalog(ctx, user._id)).find((p) => p.id === a.pluginId);
    // An owned install remains revocable after its private evidence expires.
    const source = listing?.source ?? (row && a.pluginId.startsWith("learned:") ? "learned" : null);
    if (!source) throw new Error("This plugin is unavailable.");
    const fields = { userId: user._id, pluginId: a.pluginId, epoch: crypto.randomUUID(), status: "uninstalled" as const, version: "1", installedAt: row?.installedAt ?? now, updatedAt: now, credentialsCipher: undefined, toolsJson: undefined, errorCode: undefined };
    if (row) await ctx.db.patch(row._id, fields); else await ctx.db.insert("pluginInstallations", fields);
    let connectionId: Id<"connections"> | undefined;
    if (source === "connector") {
      const slug = a.pluginId.slice(5);
      const conn = await ctx.db.query("connections").withIndex("by_user_app", (q) => q.eq("userId", user._id).eq("appSlug", slug)).first();
      connectionId = conn?._id;
      for (const grant of await ctx.db.query("approvalGrants").withIndex("by_scope", (q) => q.eq("userId", user._id).eq("appSlug", slug)).collect()) await ctx.db.delete(grant._id);
      for (const call of await ctx.db.query("calls").withIndex("by_user_status", (q) => q.eq("userId", user._id)).collect()) if (call.appSlug === slug && call.status === "queued") await ctx.db.patch(call._id, { status: "expired" });
    }
    if (source === "learned") {
      const pending = await ctx.db.query("approvals").withIndex("by_user_status", (q) => q.eq("userId", user._id).eq("status", "pending")).collect();
      for (const approval of pending) {
        const intent = approval.learnedWriteId ? await ctx.db.get(approval.learnedWriteId) : null;
        if (intent && `learned:${intent.toolId}` === a.pluginId) {
          await ctx.db.patch(approval._id, { status: "denied", decidedAt: now });
          if (approval.activityId) await ctx.db.patch(approval.activityId, { status: "denied", detail: "Plugin removed" });
        }
      }
    }
    if (connectionId) await disconnectConnection(ctx, connectionId);
    return { connectionId };
  },
});
