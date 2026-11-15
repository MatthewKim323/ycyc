import { v } from "convex/values";
import type { CatalogApp, Recipe } from "../src/lib/contract";
import { query } from "./_generated/server";
import { CATALOG, catalogApp } from "./catalog";
import { bestRecipe } from "./lib/recipeStore";

type AppWithRecipe = CatalogApp & {
  recipeStatus?: Recipe["status"];
  recipeVersion?: number;
  toolCount: number;
};

export const list = query({
  args: {},
  handler: async (ctx): Promise<AppWithRecipe[]> => {
    const out: AppWithRecipe[] = [];
    for (const app of CATALOG) {
      const r = await bestRecipe(ctx, app.slug);
      out.push({
        ...app,
        recipeStatus: r?.status,
        recipeVersion: r?.version,
        toolCount: r?.tools.length ?? 0,
      });
    }
    return out;
  },
});

export const get = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }): Promise<AppWithRecipe | null> => {
    const app = catalogApp(slug);
    if (!app) return null;
    const r = await bestRecipe(ctx, slug);
    return {
      ...app,
      recipeStatus: r?.status,
      recipeVersion: r?.version,
      toolCount: r?.tools.length ?? 0,
    };
  },
});
