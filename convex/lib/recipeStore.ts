import type { Recipe } from "../../src/lib/contract";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { HAND_RECIPES } from "./handRecipes";

export type StoredRecipe = Recipe & { _source: "db" | "bundle" };

export function handRecipeFor(slug: string): Recipe | undefined {
  const all = HAND_RECIPES.filter((r) => r.appSlug === slug);
  all.sort((a, b) => (b.version ?? 1) - (a.version ?? 1));
  const r = all[0];
  if (!r) return undefined;
  return normalizeRecipe(r, "hand");
}

// Fill defaults so hand-written JSON with a few missing fields still runs.
export function normalizeRecipe(input: Recipe, compiler?: Recipe["provenance"]["compiler"]): Recipe {
  const r = input as Partial<Recipe> & {
    appSlug: string;
    auth?: Partial<Recipe["auth"]>;
    provenance?: Partial<Recipe["provenance"]>;
  };
  return {
    ...(r as Recipe),
    version: r.version ?? 1,
    status: r.status ?? "draft",
    executor: r.executor ?? "cloud",
    auth: { type: "none", sessionKeys: [], ...(r.auth ?? {}) } as Recipe["auth"],
    tools: (r.tools ?? []).map((t) => ({
      ...t,
      kind: t.kind ?? "read",
      title: t.title ?? t.name,
      description: t.description ?? t.title ?? t.name,
      inputSchema: t.inputSchema ?? { type: "object", properties: {} },
    })),
    playbook: r.playbook ?? [],
    provenance: {
      compiledAt: Date.now(),
      captureCount: 0,
      ...(r.provenance ?? {}),
      compiler: r.provenance?.compiler ?? compiler ?? "hand",
    },
  };
}

export function parseRecipeDoc(doc: Doc<"recipes">): Recipe {
  const r = JSON.parse(doc.json) as Recipe;
  // Table columns are the source of truth for status/version.
  return { ...r, status: doc.status, version: doc.version };
}

function score(r: Recipe): number {
  let s = r.version ?? 0;
  if (r.status === "verified") s += 1_000_000;
  if (r.status === "broken") s -= 2_000_000;
  if (r.provenance?.compiler === "hand") s += 100_000;
  return s;
}

// Every known recipe for an app: DB versions plus bundled hand recipes not yet seeded.
export async function allRecipes(ctx: QueryCtx, slug: string): Promise<StoredRecipe[]> {
  const docs = await ctx.db
    .query("recipes")
    .withIndex("by_app", (q) => q.eq("appSlug", slug))
    .collect();
  const out: StoredRecipe[] = docs.map((d) => ({ ...parseRecipeDoc(d), _source: "db" as const }));
  const hand = handRecipeFor(slug);
  if (hand && !out.some((r) => r.version === hand.version && r.provenance?.compiler === "hand")) {
    out.push({ ...hand, _source: "bundle" });
  }
  return out;
}

// Verified beats draft, hand beats compiled, newer beats older. Broken only as a last resort.
export async function bestRecipe(ctx: QueryCtx, slug: string): Promise<StoredRecipe | null> {
  const all = await allRecipes(ctx, slug);
  if (all.length === 0) return null;
  all.sort((a, b) => score(b) - score(a));
  return all[0];
}

export async function recipeAt(
  ctx: QueryCtx,
  slug: string,
  version: number | undefined,
): Promise<StoredRecipe | null> {
  if (version === undefined) return bestRecipe(ctx, slug);
  const all = await allRecipes(ctx, slug);
  return all.find((r) => r.version === version) ?? (await bestRecipe(ctx, slug));
}

export function stripSource(r: StoredRecipe | null): Recipe | null {
  if (!r) return null;
  const { _source, ...rest } = r;
  return rest;
}
