import { v } from "convex/values";

import { api } from "./_generated/api";
import { action } from "./_generated/server";
import { deeplinkBase } from "./lib/env";

function apiBase(): string {
  return process.env.WHOP_ENVIRONMENT === "production" ? "https://api.whop.com/api/v1" : "https://sandbox-api.whop.com/api/v1";
}

// Hosted Whop checkout for ycyc Pro. The POST /whop webhook reads metadata.ycyc_user_id to flip the plan.
export const createCheckout = action({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<{ url: string }> => {
    const apiKey = process.env.WHOP_API_KEY;
    const planId = process.env.WHOP_PRO_PLAN_ID;
    if (!apiKey || !planId) throw new Error("Whop is not configured");

    const user = await ctx.runQuery(api.users.get, { userId });
    if (!user) throw new Error("Unknown user");
    if (user.plan === "pro") throw new Error("Already on Pro");

    const res = await fetch(`${apiBase()}/checkout_configurations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        plan_id: planId,
        metadata: { ycyc_user_id: userId },
        redirect_url: `${deeplinkBase()}paywall`,
      }),
    });
    const body = (await res.json().catch(() => null)) as { purchase_url?: string; error?: { message?: string } } | null;
    if (!res.ok || !body?.purchase_url) {
      throw new Error(`Whop checkout failed (${res.status}): ${body?.error?.message ?? "no purchase_url"}`);
    }
    return { url: body.purchase_url };
  },
});
