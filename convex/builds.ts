import { v } from "convex/values";
import type { BuildStep, BuildStepKey, BuildStepStatus } from "../src/lib/contract";
import { internalMutation, internalQuery, query } from "./_generated/server";

// Latest build for a connection, for the live build screen. Null before submitLogin.
export const forConnection = query({
  args: { connectionId: v.id("connections") },
  handler: async (ctx, { connectionId }) => {
    const build = await ctx.db
      .query("builds")
      .withIndex("by_connection", (q) => q.eq("connectionId", connectionId))
      .order("desc")
      .first();
    if (!build) return null;
    return {
      _id: build._id,
      status: build.status,
      steps: build.steps as BuildStep[],
      recipeVersion: build.recipeVersion,
      error: build.error,
      appSlug: build.appSlug,
      createdAt: build.createdAt,
      updatedAt: build.updatedAt,
    };
  },
});

export const get = internalQuery({
  args: { buildId: v.id("builds") },
  handler: async (ctx, { buildId }) => ctx.db.get(buildId),
});

export const step = internalMutation({
  args: {
    buildId: v.id("builds"),
    key: v.string(),
    status: v.string(),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, { buildId, key, status, detail }) => {
    const build = await ctx.db.get(buildId);
    if (!build) return;
    const now = Date.now();
    const steps = build.steps.map((s) =>
      s.key === (key as BuildStepKey)
        ? { ...s, status: status as BuildStepStatus, detail: detail ?? s.detail, at: now }
        : s,
    );
    await ctx.db.patch(buildId, { steps, updatedAt: now });
  },
});

export const finish = internalMutation({
  args: {
    buildId: v.id("builds"),
    status: v.union(v.literal("done"), v.literal("error")),
    error: v.optional(v.string()),
    recipeVersion: v.optional(v.number()),
  },
  handler: async (ctx, { buildId, status, error, recipeVersion }) => {
    const build = await ctx.db.get(buildId);
    if (!build) return;
    const now = Date.now();
    // Anything still pending or running after an error never ran.
    const steps =
      status === "error"
        ? build.steps.map((s) =>
            s.status === "pending" || s.status === "running"
              ? { ...s, status: s.status === "running" ? ("error" as const) : ("skipped" as const), at: now }
              : s,
          )
        : build.steps;
    await ctx.db.patch(buildId, { status, error, recipeVersion, steps, updatedAt: now });
  },
});
