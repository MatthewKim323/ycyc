/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCheckout } from "../../convex/whop";

test("previously published clients cannot create a new checkout after Pro is retired", async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  let accountReads = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error("unexpected payment request"); };
  try {
    const handler = createCheckout as unknown as { _handler: (ctx: unknown, args: { userId: string }) => Promise<unknown> };
    const ctx = { runQuery: async () => { accountReads++; throw new Error("unexpected account read"); } };
    await assert.rejects(handler._handler(ctx, { userId: "legacy-user" }), /Checkout is no longer available/);
    assert.equal(networkCalls, 0);
    assert.equal(accountReads, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
