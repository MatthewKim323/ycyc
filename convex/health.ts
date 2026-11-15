// Health monitor: a cron runs every live connection's auth.check; every tool call and check feeds
// per-recipe health, and 3 consecutive non-auth failures mark that recipe version "broken".
import { v } from "convex/values";
import type { Recipe } from "../src/lib/contract";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { CATALOG, catalogApp } from "./catalog";
import { classifyResult, executeRequest, keepAliveRefresh, recordHealth, signedOutText } from "./executor";
import { bestRecipe, handRecipeFor, recipeAt, stripSource } from "./lib/recipeStore";

const RELAY_RECENT_MS = 10 * 60_000;
const BROKEN_AFTER = 3;

async function relayAnsweredSince(ctx: { db: any }, userId: Id<"users">, since: number): Promise<boolean> {
  const last = await ctx.db
    .query("calls")
    .withIndex("by_user_status", (q: any) => q.eq("userId", userId).eq("status", "done"))
    .order("desc")
    .first();
  return !!last && (last.completedAt ?? last.createdAt) > since;
}

// Phone relay reachable now: a heartbeat in the last 60 s, or a call answered in the last 10 min.
export const relayOnline = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<boolean> => {
    const user = await ctx.db.get(userId);
    // Phones that send heartbeats are judged by them alone; older builds fall back to recent answers.
    if (user?.relaySeenAt) return Date.now() - user.relaySeenAt < 60_000;
    return relayAnsweredSince(ctx, userId, Date.now() - RELAY_RECENT_MS);
  },
});

export const markRefreshed = internalMutation({
  args: { connectionId: v.id("connections") },
  handler: async (ctx, { connectionId }) => {
    const conn = await ctx.db.get(connectionId);
    if (conn) await ctx.db.patch(connectionId, { lastRefreshAt: Date.now() });
  },
});

export const relayRecent = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<boolean> => relayAnsweredSince(ctx, userId, Date.now() - RELAY_RECENT_MS),
});

export const record = internalMutation({
  args: {
    appSlug: v.string(),
    version: v.number(),
    outcome: v.union(v.literal("ok"), v.literal("auth"), v.literal("fail")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { appSlug, version, outcome, error }) => {
    const now = Date.now();
    const row = await ctx.db
      .query("recipeHealth")
      .withIndex("by_app_version", (q) => q.eq("appSlug", appSlug).eq("version", version))
      .first();
    const cur = row ?? {
      appSlug,
      version,
      consecutiveFailures: 0,
      okCount: 0,
      failCount: 0,
      authFailCount: 0,
      updatedAt: now,
    };
    const next = { ...cur, updatedAt: now } as Omit<Doc<"recipeHealth">, "_id" | "_creationTime">;
    if (outcome === "ok") {
      next.consecutiveFailures = 0;
      next.okCount = cur.okCount + 1;
      next.lastOkAt = now;
    } else if (outcome === "auth") {
      next.authFailCount = cur.authFailCount + 1; // the user's session, not the recipe
    } else {
      next.consecutiveFailures = cur.consecutiveFailures + 1;
      next.failCount = cur.failCount + 1;
      next.lastFailAt = now;
      next.lastError = error;
    }
    if (row) await ctx.db.patch(row._id, next);
    else await ctx.db.insert("recipeHealth", next);

    const recipeDoc = await ctx.db
      .query("recipes")
      .withIndex("by_app", (q) => q.eq("appSlug", appSlug).eq("version", version))
      .first();
    if (outcome === "ok" && recipeDoc?.status === "broken") {
      const r = JSON.parse(recipeDoc.json) as Recipe;
      await ctx.db.patch(recipeDoc._id, { status: "verified", json: JSON.stringify({ ...r, status: "verified" }), updatedAt: now });
    }
    if (outcome === "fail" && next.consecutiveFailures >= BROKEN_AFTER) {
      if (recipeDoc && recipeDoc.status !== "broken") {
        const r = JSON.parse(recipeDoc.json) as Recipe;
        await ctx.db.patch(recipeDoc._id, { status: "broken", json: JSON.stringify({ ...r, status: "broken" }), updatedAt: now });
      } else if (!recipeDoc) {
        // Bundle-only hand recipe: store a broken copy so it stops being reused.
        const hand = handRecipeFor(appSlug);
        if (hand && hand.version === version) {
          const broken = { ...hand, status: "broken" as const };
          await ctx.db.insert("recipes", {
            appSlug,
            version,
            status: "broken",
            compiler: hand.provenance.compiler,
            json: JSON.stringify(broken),
            toolCount: hand.tools.length,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }
  },
});

export const liveConnections = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ conn: Doc<"connections">; recipeJson: string; relayRecent: boolean }[]> => {
    const since = Date.now() - RELAY_RECENT_MS;
    const conns = (await ctx.db.query("connections").collect()).filter((c) => c.status === "live");
    const out: { conn: Doc<"connections">; recipeJson: string; relayRecent: boolean }[] = [];
    for (const conn of conns.slice(0, 200)) {
      const r = stripSource(await recipeAt(ctx, conn.appSlug, conn.recipeVersion));
      if (!r) continue;
      const user = await ctx.db.get(conn.userId);
      const online = user?.relaySeenAt ? Date.now() - user.relaySeenAt < 60_000 : await relayAnsweredSince(ctx, conn.userId, since);
      out.push({ conn, recipeJson: JSON.stringify(r), relayRecent: online });
    }
    return out;
  },
});

export const markHealthy = internalMutation({
  args: { connectionId: v.id("connections") },
  handler: async (ctx, { connectionId }) => {
    const conn = await ctx.db.get(connectionId);
    if (conn && conn.status === "live") await ctx.db.patch(connectionId, { lastHealthyAt: Date.now() });
  },
});

const STRONG_REFRESH_LEAD_MS = 5 * 60_000;
const BEARER_REMINT_MS = 7 * 24 * 60 * 60_000;

function jwtExpMs(token: unknown): number | undefined {
  if (typeof token !== "string" || token.split(".").length !== 3) return undefined;
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const exp = (JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))) as { exp?: number }).exp;
    return typeof exp === "number" ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

// Cron, every 10 minutes: keep every live session warm so a call at any hour works, and mark a
// connection signed out only on a real rejection after a refresh attempt (never when offline).
export const checkAll = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ checked: number; ok: number; refreshed: number; signedOut: number; skipped: number }> => {
    const items = await ctx.runQuery(internal.health.liveConnections, {});
    const tally = { checked: 0, ok: 0, refreshed: 0, signedOut: 0, skipped: 0 };
    for (const { conn, recipeJson, relayRecent } of items) {
      const recipe = JSON.parse(recipeJson) as Recipe;
      const flags = recipe.auth as Recipe["auth"] & { keepAlive?: Recipe["auth"]["check"]; refreshVia?: string };
      const template = flags.keepAlive ?? recipe.auth?.check;
      const executor = recipe.executor ?? "cloud";
      if (!template || executor === "phone" || (executor === "device" && !relayRecent)) {
        tally.skipped++;
        continue;
      }
      tally.checked++;
      let forceRefresh = false;
      if (recipe.auth.type === "login_api") {
        // Strong: rotate the token pair when the access token has under 5 minutes left.
        let login: { accessToken?: unknown } = {};
        try {
          login = conn.authCacheJson ? JSON.parse(conn.authCacheJson) : {};
        } catch {
          login = {};
        }
        const exp = jwtExpMs(login.accessToken);
        forceRefresh = exp !== undefined && exp - Date.now() < STRONG_REFRESH_LEAD_MS;
      } else if (recipe.auth.refresh && flags.refreshVia !== "relay" && relayRecent) {
        // MFP: re-mint the bearer through the phone once it is a week old.
        let capturedAt = 0;
        try {
          capturedAt = (JSON.parse(conn.sessionJson ?? "{}") as { capturedAt?: number }).capturedAt ?? 0;
        } catch {
          capturedAt = 0;
        }
        const minted = conn.lastRefreshAt ?? capturedAt;
        if (Date.now() - minted > BEARER_REMINT_MS && (await keepAliveRefresh(ctx, conn, recipe)) === "ok") tally.refreshed++;
      }
      const fresh = (await ctx.runQuery(internal.connections.get, { connectionId: conn._id })) ?? conn;
      // executeRequest tries one refresh on rejection (relay, bearer re-mint or token rotation).
      const res = await executeRequest(ctx, {
        conn: fresh,
        recipe,
        template,
        args: {},
        toolName: flags.keepAlive ? "keep_alive" : "health_check",
        forceRefresh,
      });
      if (forceRefresh && res.ok) tally.refreshed++;
      await recordHealth(ctx, recipe, res);
      const outcome = classifyResult(res);
      if (outcome === "ok") {
        tally.ok++;
        await ctx.runMutation(internal.health.markHealthy, { connectionId: conn._id });
      } else if (outcome === "auth") {
        tally.signedOut++;
        await ctx.runMutation(internal.connections.setStatus, {
          connectionId: conn._id,
          status: "error",
          error: signedOutText(conn.appSlug),
        });
      }
      // transient (network, phone offline, 5xx): leave the connection alone.
    }
    return tally;
  },
});

// Debugging: npx convex run health:report
export const report = internalQuery({
  args: {},
  handler: async (ctx) => {
    const conns = await ctx.db.query("connections").collect();
    const health = await ctx.db.query("recipeHealth").collect();
    const out = [];
    for (const app of CATALOG) {
      const mine = conns.filter((c) => c.appSlug === app.slug);
      const best = await bestRecipe(ctx, app.slug);
      const lastHealthy = Math.max(0, ...mine.map((c) => c.lastHealthyAt ?? 0));
      out.push({
        app: app.slug,
        name: catalogApp(app.slug)?.name,
        live: mine.filter((c) => c.status === "live").length,
        errored: mine.filter((c) => c.status === "error").length,
        lastHealthyAt: lastHealthy || null,
        recipe: best ? { version: best.version, status: best.status, compiler: best.provenance?.compiler } : null,
        versions: health
          .filter((h) => h.appSlug === app.slug)
          .map((h) => ({
            version: h.version,
            lastOkAt: h.lastOkAt ?? null,
            lastFailAt: h.lastFailAt ?? null,
            consecutiveFailures: h.consecutiveFailures,
            okCount: h.okCount,
            failCount: h.failCount,
            authFailCount: h.authFailCount,
            lastError: h.lastError ?? null,
          })),
      });
    }
    return out;
  },
});

// Demo/test reset: forget health history for an app. npx convex run health:resetApp '{"slug":"duolingo"}'
export const resetApp = internalMutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const rows = await ctx.db
      .query("recipeHealth")
      .withIndex("by_app_version", (q) => q.eq("appSlug", slug))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
    return rows.length;
  },
});
