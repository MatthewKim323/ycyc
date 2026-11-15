import { v } from "convex/values";
import type { Recipe } from "../src/lib/contract";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { CATALOG, CATALOG_TRACK_IDS } from "./catalog";
import { fromDiscovered, resolveApp, type ResolvedApp } from "./lib/appResolver";
import { bestRecipe } from "./lib/recipeStore";

type AppWithRecipe = ResolvedApp & {
  recipeStatus?: Recipe["status"];
  recipeVersion?: number;
  toolCount: number;
};

// Built-in apps, then apps added from search (marked discovered: true).
export const list = query({
  args: {},
  handler: async (ctx): Promise<AppWithRecipe[]> => {
    const out: AppWithRecipe[] = [];
    for (const app of CATALOG) {
      const r = await bestRecipe(ctx, app.slug);
      out.push({ ...app, recipeStatus: r?.status, recipeVersion: r?.version, toolCount: r?.tools.length ?? 0 });
    }
    const discovered = await ctx.db.query("discoveredApps").order("desc").take(100);
    for (const d of discovered) {
      const r = await bestRecipe(ctx, d.slug);
      out.push({ ...fromDiscovered(d), recipeStatus: r?.status, recipeVersion: r?.version, toolCount: r?.tools.length ?? 0 });
    }
    return out;
  },
});

export const get = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }): Promise<AppWithRecipe | null> => {
    const app = await resolveApp(ctx, slug);
    if (!app) return null;
    const r = await bestRecipe(ctx, slug);
    return { ...app, recipeStatus: r?.status, recipeVersion: r?.version, toolCount: r?.tools.length ?? 0 };
  },
});

// For actions (pipeline, MCP): the app behind a slug, built-in or discovered.
export const resolve = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }): Promise<ResolvedApp | null> => resolveApp(ctx, slug),
});

// ---- App Store search ("connect any app") ----

export type SearchStatus = "ready" | "learnable" | "phone_only";

export interface SearchItem {
  slug: string; // built-in slug, or app_<trackId>
  name: string;
  iconUrl?: string;
  developer?: string;
  genre?: string;
  webUrl?: string;
  bundleId?: string;
  trackId: number;
  status: SearchStatus;
}

type StoreApp = Omit<SearchItem, "slug" | "status">;

const CACHE_MS = 10 * 60_000;
// Shown for an empty query, after the ready apps.
const POPULAR_BUNDLE_IDS = [
  "com.strava.stravaride",
  "com.fitnow.loseit",
  "com.ouraring.oura",
  "com.whoop.iphone",
  "com.getsomeheadspace.headspace",
  "com.calm.calmapp",
  "com.goodreads.Goodreads",
  "com.todoist.ios",
  "notion.id",
  "com.spotify.client",
  "net.kortina.labs.Venmo",
  "com.ubercab.UberEats",
  "com.garmin.connect.mobile",
  "com.nike.nikeplus-gps",
  "com.yelp.yelpiphone",
  "com.fitbit.FitbitMobile",
];

// "Goodreads: Book Tracker & More" -> "Goodreads"
function shortName(full: string): string {
  const head = full.split(/\s*[:|\u2013\u2014]\s+|\s+-\s+/)[0].trim();
  return head.length >= 2 ? head : full.trim();
}

function toStoreApp(r: Record<string, any>): StoreApp | null {
  if (typeof r.trackId !== "number" || !r.trackName) return null;
  const webUrl =
    typeof r.sellerUrl === "string" && /^https?:\/\//.test(r.sellerUrl) ? r.sellerUrl.replace(/^http:/, "https:") : undefined;
  return {
    trackId: r.trackId,
    name: shortName(String(r.trackName)),
    iconUrl: r.artworkUrl512 ?? r.artworkUrl100 ?? undefined,
    developer: r.artistName ?? r.sellerName ?? undefined,
    genre: r.primaryGenreName ?? undefined,
    webUrl,
    bundleId: r.bundleId ?? undefined,
  };
}

async function itunes(url: string): Promise<StoreApp[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return [];
    const j = (await res.json()) as { results?: Record<string, any>[] };
    return (j.results ?? []).map(toStoreApp).filter((x): x is StoreApp => !!x);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export const cached = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }): Promise<string | null> => {
    const row = await ctx.db
      .query("searchCache")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    return row && Date.now() - row.at < CACHE_MS ? row.json : null;
  },
});

export const storeCache = internalMutation({
  args: { key: v.string(), json: v.string() },
  handler: async (ctx, { key, json }) => {
    const row = await ctx.db
      .query("searchCache")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (row) await ctx.db.patch(row._id, { json, at: Date.now() });
    else await ctx.db.insert("searchCache", { key, json, at: Date.now() });
  },
});

// Which store apps yuzu can already run: built-ins, plus discovered apps with a verified recipe.
export const readiness = internalQuery({
  args: { trackIds: v.array(v.number()) },
  handler: async (ctx, { trackIds }): Promise<Record<string, { slug: string; ready: boolean }>> => {
    const out: Record<string, { slug: string; ready: boolean }> = {};
    for (const id of trackIds) {
      const builtIn = CATALOG_TRACK_IDS[id];
      if (builtIn) {
        out[id] = { slug: builtIn, ready: true };
        continue;
      }
      const d = await ctx.db
        .query("discoveredApps")
        .withIndex("by_trackId", (q) => q.eq("trackId", id))
        .first();
      if (d) {
        const r = await bestRecipe(ctx, d.slug);
        out[id] = { slug: d.slug, ready: r?.status === "verified" };
      }
    }
    return out;
  },
});

async function cachedStore(ctx: { runQuery: any; runMutation: any }, key: string, url: string): Promise<StoreApp[]> {
  const hit: string | null = await ctx.runQuery(internal.apps.cached, { key });
  if (hit) return JSON.parse(hit) as StoreApp[];
  const items = await itunes(url);
  if (items.length) await ctx.runMutation(internal.apps.storeCache, { key, json: JSON.stringify(items) });
  return items;
}

// apps.search({ query }) -> SearchItem[]. Empty query: ready apps first, then popular apps.
export const search = action({
  args: { query: v.string() },
  handler: async (ctx, { query }): Promise<SearchItem[]> => {
    const q = query.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
    let items: StoreApp[];
    if (!q) {
      const ready = await cachedStore(
        ctx,
        "ready:v2",
        `https://itunes.apple.com/lookup?id=${Object.keys(CATALOG_TRACK_IDS).join(",")}&country=us`,
      );
      const popular = await cachedStore(
        ctx,
        "popular:v2",
        `https://itunes.apple.com/lookup?bundleId=${POPULAR_BUNDLE_IDS.join(",")}&country=us`,
      );
      items = [...ready, ...popular];
    } else {
      items = await cachedStore(
        ctx,
        `q2:${q}`,
        `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=software&country=us&limit=20`,
      );
    }
    const seen = new Set<number>();
    items = items.filter((i) => !seen.has(i.trackId) && seen.add(i.trackId));
    const ready = await ctx.runQuery(internal.apps.readiness, { trackIds: items.map((i) => i.trackId) });
    const out: SearchItem[] = items.map((i) => {
      const r = ready[i.trackId];
      const status: SearchStatus = r?.ready ? "ready" : i.webUrl ? "learnable" : "phone_only";
      return { ...i, slug: r?.slug ?? `app_${i.trackId}`, status };
    });
    // Ready apps first, keep store order otherwise.
    return [...out.filter((i) => i.status === "ready"), ...out.filter((i) => i.status !== "ready")];
  },
});

export const upsertDiscovered = internalMutation({
  args: {
    trackId: v.number(),
    bundleId: v.optional(v.string()),
    name: v.string(),
    developer: v.optional(v.string()),
    genre: v.optional(v.string()),
    iconUrl: v.optional(v.string()),
    webUrl: v.string(),
  },
  handler: async (ctx, a): Promise<string> => {
    const slug = `app_${a.trackId}`;
    let origin: string;
    try {
      origin = new URL(a.webUrl).origin;
    } catch {
      throw new Error("This app has no website yuzu can learn from.");
    }
    const now = Date.now();
    const blurb = a.genre && a.developer ? `${a.genre} app by ${a.developer}` : a.developer ? `By ${a.developer}` : "Learned from its website";
    const row = {
      slug,
      trackId: a.trackId,
      bundleId: a.bundleId,
      name: a.name,
      developer: a.developer,
      genre: a.genre,
      iconUrl: a.iconUrl,
      webUrl: a.webUrl,
      loginUrl: a.webUrl,
      webOrigin: origin,
      blurb,
      updatedAt: now,
    };
    const existing = await ctx.db
      .query("discoveredApps")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("discoveredApps", { ...row, createdAt: now });
    return slug;
  },
});

// apps.addCustom({ trackId }) -> { slug }. Built-in apps return their own slug.
export const addCustom = action({
  args: { trackId: v.number() },
  handler: async (ctx, { trackId }): Promise<{ slug: string; discovered: boolean }> => {
    const builtIn = CATALOG_TRACK_IDS[trackId];
    if (builtIn) return { slug: builtIn, discovered: false };
    const [item] = await cachedStore(ctx, `id2:${trackId}`, `https://itunes.apple.com/lookup?id=${trackId}&country=us`);
    if (!item) throw new Error("Couldn't find that app in the App Store.");
    if (!item.webUrl) throw new Error("This app has no website yuzu can learn from.");
    const slug: string = await ctx.runMutation(internal.apps.upsertDiscovered, {
      trackId: item.trackId,
      bundleId: item.bundleId,
      name: item.name,
      developer: item.developer,
      genre: item.genre,
      iconUrl: item.iconUrl,
      webUrl: item.webUrl,
    });
    return { slug, discovered: true };
  },
});

// "Ask for it" on phone-only apps. One request per user per app.
export const request = mutation({
  args: { userId: v.id("users"), trackId: v.number(), name: v.string() },
  handler: async (ctx, { userId, trackId, name }): Promise<{ count: number; requested: boolean }> => {
    const mine = await ctx.db
      .query("appRequests")
      .withIndex("by_track", (q) => q.eq("trackId", trackId).eq("userId", userId))
      .first();
    if (!mine) await ctx.db.insert("appRequests", { userId, trackId, name: name.slice(0, 120), createdAt: Date.now() });
    const all = await ctx.db
      .query("appRequests")
      .withIndex("by_track", (q) => q.eq("trackId", trackId))
      .collect();
    return { count: all.length, requested: true };
  },
});

export const requestCount = query({
  args: { trackId: v.number(), userId: v.optional(v.id("users")) },
  handler: async (ctx, { trackId, userId }): Promise<{ count: number; requested: boolean }> => {
    const all = await ctx.db
      .query("appRequests")
      .withIndex("by_track", (q) => q.eq("trackId", trackId))
      .collect();
    return { count: all.length, requested: !!userId && all.some((r) => r.userId === (userId as Id<"users">)) };
  },
});

// Demo cleanup: npx convex run apps:removeDiscovered '{"slug":"app_355833469"}'
export const removeDiscovered = internalMutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const row = await ctx.db
      .query("discoveredApps")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (row) await ctx.db.delete(row._id);
    return !!row;
  },
});
