import { v } from "convex/values";
import type { Recipe } from "../src/lib/contract";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { HAND_RECIPES } from "./lib/handRecipes";
import { bestRecipe, normalizeRecipe, recipeAt, stripSource } from "./lib/recipeStore";
import { sanitizeForConvex } from "./lib/sanitize";

export const forApp = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }): Promise<Recipe | null> => {
    return sanitizeForConvex(stripSource(await bestRecipe(ctx, slug)));
  },
});

// Internal reads return the Recipe as a JSON string (inputSchema may hold "$" keys). Parse in the action.
export const best = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }): Promise<string | null> => {
    const r = stripSource(await bestRecipe(ctx, slug));
    return r ? JSON.stringify(r) : null;
  },
});

export const at = internalQuery({
  args: { slug: v.string(), version: v.optional(v.number()) },
  handler: async (ctx, { slug, version }): Promise<string | null> => {
    const r = stripSource(await recipeAt(ctx, slug, version));
    return r ? JSON.stringify(r) : null;
  },
});

export const latestVersion = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const last = await ctx.db
      .query("recipes")
      .withIndex("by_app", (q) => q.eq("appSlug", slug))
      .order("desc")
      .first();
    return last?.version ?? 0;
  },
});

// Insert or replace one recipe version. Returns the stored version.
export const save = internalMutation({
  args: { json: v.string() },
  handler: async (ctx, { json }) => {
    const recipe = normalizeRecipe(JSON.parse(json) as Recipe);
    const now = Date.now();
    const existing = await ctx.db
      .query("recipes")
      .withIndex("by_app", (q) => q.eq("appSlug", recipe.appSlug).eq("version", recipe.version))
      .first();
    const row = {
      appSlug: recipe.appSlug,
      version: recipe.version,
      status: recipe.status,
      compiler: recipe.provenance.compiler,
      json: JSON.stringify(recipe),
      toolCount: recipe.tools.length,
      updatedAt: now,
    };
    if (existing) {
      // Never downgrade a verified recipe back to draft when re-seeding the same version.
      const status = existing.status === "verified" && row.status === "draft" ? "verified" : row.status;
      await ctx.db.patch(existing._id, { ...row, status });
    } else {
      await ctx.db.insert("recipes", { ...row, createdAt: now });
    }
    return recipe.version;
  },
});

export const setStatus = internalMutation({
  args: {
    slug: v.string(),
    version: v.number(),
    status: v.union(v.literal("draft"), v.literal("verified"), v.literal("broken")),
  },
  handler: async (ctx, { slug, version, status }) => {
    const doc = await ctx.db
      .query("recipes")
      .withIndex("by_app", (q) => q.eq("appSlug", slug).eq("version", version))
      .first();
    if (!doc) return;
    const recipe = JSON.parse(doc.json) as Recipe;
    recipe.status = status;
    await ctx.db.patch(doc._id, { status, json: JSON.stringify(recipe), updatedAt: Date.now() });
  },
});

// Seed every bundled hand recipe into the table: npx convex run recipes:syncHand
export const syncHand = internalMutation({
  args: {},
  handler: async (ctx) => {
    const out: string[] = [];
    for (const raw of HAND_RECIPES) {
      const recipe = normalizeRecipe(raw, "hand");
      const existing = await ctx.db
        .query("recipes")
        .withIndex("by_app", (q) => q.eq("appSlug", recipe.appSlug).eq("version", recipe.version))
        .first();
      const now = Date.now();
      const row = {
        appSlug: recipe.appSlug,
        version: recipe.version,
        compiler: "hand",
        json: JSON.stringify(recipe),
        toolCount: recipe.tools.length,
        updatedAt: now,
      };
      if (existing) {
        await ctx.db.patch(existing._id, {
          ...row,
          status: existing.status === "verified" ? "verified" : recipe.status,
        });
      } else {
        await ctx.db.insert("recipes", { ...row, status: recipe.status, createdAt: now });
      }
      out.push(`${recipe.appSlug} v${recipe.version}`);
    }
    return out;
  },
});

// Demo reset: drop every stored version for an app. npx convex run recipes:reset '{"slug":"myfitnesspal"}'
export const reset = internalMutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const docs = await ctx.db
      .query("recipes")
      .withIndex("by_app", (q) => q.eq("appSlug", slug))
      .collect();
    for (const d of docs) await ctx.db.delete(d._id);
    return docs.length;
  },
});
