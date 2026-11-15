// Runs an approved write exactly once (claimRun), stores the result on the approval for
// check_approval, and updates its activity row. Scheduled by approvals.decide.
import { v } from "convex/values";
import type { Recipe } from "../src/lib/contract";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { executeTool } from "./executor";
import { isEmptyResult, receiptFrom } from "./lib/summaries";

export const run = internalAction({
  args: { approvalId: v.id("approvals") },
  handler: async (ctx, { approvalId }): Promise<void> => {
    if (!(await ctx.runMutation(internal.approvals.claimRun, { approvalId }))) return;
    const finish = (ok: boolean, text: string) => ctx.runMutation(internal.approvals.storeResult, { approvalId, ok, text });
    const a = await ctx.runQuery(internal.approvals.get, { approvalId });
    if (!a?.connectionId) return void (await finish(false, "The connection is gone. Nothing was changed."));
    const conn = await ctx.runQuery(internal.connections.get, { connectionId: a.connectionId });
    if (!conn || conn.status !== "live") return void (await finish(false, "The app is no longer connected. Nothing was changed."));
    const recipeJson = await ctx.runQuery(internal.recipes.at, { slug: conn.appSlug, version: conn.recipeVersion });
    const recipe = recipeJson ? (JSON.parse(recipeJson) as Recipe) : null;
    const tool = recipe?.tools.find((t) => t.name === a.tool);
    if (!recipe || !tool) return void (await finish(false, "That action is no longer available. Nothing was changed."));
    try {
      const res = await executeTool(ctx, { conn, recipe, tool, args: JSON.parse(a.argsJson) });
      // Empty write responses (Strong answers null) get a receipt built from the approval summary.
      await finish(res.ok, res.ok && isEmptyResult(res.text) ? receiptFrom(a.summary, a.appSlug) : res.text || "Failed.");
      if (res.ok) await ctx.scheduler.runAfter(0, internal.today.refresh, { userId: a.userId });
    } catch (e) {
      await finish(false, e instanceof Error ? e.message.slice(0, 300) : "Failed.");
    }
  },
});
