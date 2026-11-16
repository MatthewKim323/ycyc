import { v } from "convex/values";

import { action } from "./_generated/server";

// Keep the old endpoint non-operational for previously published app versions.
// Historical plan records and payment webhooks remain intact.
export const createCheckout = action({
  args: { userId: v.id("users") },
  handler: async (): Promise<{ url: string }> => {
    throw new Error("Checkout is no longer available.");
  },
});
