// Resolve a slug to an app: the built-in catalog first, then apps added from App Store search.
import type { GenericDatabaseReader } from "convex/server";
import type { CatalogApp } from "../../src/lib/contract";
import type { DataModel, Doc } from "../_generated/dataModel";
import { catalogApp } from "../catalog";

export type ResolvedApp = CatalogApp & {
  discovered?: boolean; // added from search: the UI says "yuzu learns it"
  iconUrl?: string;
  trackId?: number;
  developer?: string;
};

export function fromDiscovered(d: Doc<"discoveredApps">): ResolvedApp {
  return {
    slug: d.slug,
    name: d.name,
    category: "other",
    route: "web",
    loginUrl: d.loginUrl,
    webOrigin: d.webOrigin,
    blurb: d.blurb,
    discovered: true,
    iconUrl: d.iconUrl,
    trackId: d.trackId,
    developer: d.developer,
  };
}

export async function resolveApp(ctx: { db: GenericDatabaseReader<DataModel> }, slug: string): Promise<ResolvedApp | null> {
  const known = catalogApp(slug);
  if (known) return known;
  if (!slug.startsWith("app_")) return null;
  const d = await ctx.db
    .query("discoveredApps")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .first();
  return d ? fromDiscovered(d) : null;
}
