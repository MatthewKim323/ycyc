// Backend-side tool flags layered over recipes, for things the recipe JSON can't say yet.
// Fields (also honored when a recipe sets them itself):
//   executor: "cloud"   run this tool from Convex even if the recipe's executor is device
//   public: true        works without the user's session: listed and callable before the app is connected
//   emptyOn: [...]      an error response that really means "none" (returned as `value`, default [])
import type { Executor, Recipe, RecipeTool } from "../../src/lib/contract";

export interface ToolFlags {
  executor?: Executor;
  public?: boolean;
  emptyOn?: { status: number; bodyContains?: string; value?: unknown }[];
}

export type FlaggedTool = RecipeTool & ToolFlags;

const OVERRIDES: Record<string, Record<string, ToolFlags>> = {
  parkmobile: {
    // Verified from plain Node with no session.
    find_zone: { executor: "cloud", public: true },
    find_zones_nearby: { executor: "cloud", public: true },
    get_zone_rates: { executor: "cloud", public: true },
    quote_parking: { executor: "cloud", public: true },
    // 404 {"...Vehicle not found"} when the account has no vehicles.
    get_vehicles: { emptyOn: [{ status: 404, bodyContains: "Vehicle not found", value: [] }] },
  },
};

export function applyOverrides(recipe: Recipe): Recipe {
  const o = OVERRIDES[recipe.appSlug];
  if (!o) return recipe;
  return { ...recipe, tools: recipe.tools.map((t) => (o[t.name] ? { ...o[t.name], ...t, ...o[t.name] } : t)) };
}

export function isPublicTool(t: RecipeTool): boolean {
  return (t as FlaggedTool).public === true && (t.kind === "read");
}
