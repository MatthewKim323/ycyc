// Live challenge/cancellation smoke test; never authorizes an account or calls a model.
// npm exec --yes --package=tsx -- tsx --env-file=.env.local scripts/test/provider-login.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

async function main() {
  const url = process.env.EXPO_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("Set EXPO_PUBLIC_CONVEX_URL to the test deployment.");
  const client = new ConvexHttpClient(url);
  const identity = await client.mutation(api.users.ensure, { deviceId: `provider-smoke-${randomUUID()}` });
  const token = new URL(identity.mcpUrl).pathname.split("/").pop()!;
  const providers = ["claude", "codex"] as const;
  try {
    await assert.rejects(client.query(api.aiProviders.status, { token: "invalid-provider-smoke-token" }));
    console.log("PASS invalid capability rejected");
    for (const provider of providers) {
      const args = { token, provider };
      const started = await client.mutation(api.aiProviders.startLogin, args);
      assert.deepEqual(await client.mutation(api.aiProviders.startLogin, args), started);
    }
    console.log("PASS duplicate starts reuse their attempt");
    const observed = new Set<string>();
    const deadline = Date.now() + 180_000;
    while (observed.size < providers.length && Date.now() < deadline) {
      const rows = await client.query(api.aiProviders.status, { token });
      assert.equal(rows.length, 2);
      for (const row of rows) {
        for (const key of Object.keys(row)) assert.ok([
          "provider", "status", "selected", "attemptId", "loginUrl", "userCode", "loginExpiresAt", "error",
        ].includes(key), "Unexpected public field");
        assert.notEqual(row.status, "error", `${row.provider}: ${row.error}`);
        if (row.status !== "authorizing" || observed.has(row.provider)) continue;
        assert.ok(row.loginUrl && row.attemptId && row.loginExpiresAt && row.loginExpiresAt > Date.now());
        const link = new URL(row.loginUrl);
        assert.equal(link.protocol, "https:");
        if (row.provider === "claude") {
          assert.ok(["claude.com", "claude.ai", "console.anthropic.com", "platform.claude.com"].includes(link.hostname));
          assert.equal(link.searchParams.get("code"), "true");
          assert.equal(row.userCode, undefined);
        } else {
          assert.ok(["auth.openai.com", "chatgpt.com", "openai.com"].includes(link.hostname));
          assert.match(row.userCode ?? "", /^[A-Z0-9]{4}-[A-Z0-9]{4,5}$/);
        }
        observed.add(row.provider);
        console.log(`PASS ${row.provider} native official login challenge (URL/code omitted)`);
      }
      if (observed.size < providers.length) await delay(3000);
    }
    assert.equal(observed.size, providers.length, "Timed out waiting for native challenges");
    const pending = await client.query(api.aiProviders.status, { token });
    for (const provider of providers) await client.mutation(api.aiProviders.disconnect, { token, provider });
    const claude = pending.find((row) => row.provider === "claude")!;
    assert.deepEqual(await client.action(api.providerActions.submitCode, {
      token, provider: "claude", attemptId: claude.attemptId!, code: "stale-test-code",
    }), { ok: false });
    await delay(3000); // Allow child cancellation/late challenge delivery to race.
    const cancelled = await client.query(api.aiProviders.status, { token });
    assert.ok(cancelled.every((row) => row.status === "disconnected" && !row.loginUrl && !row.userCode));
    console.log("PASS disconnect cancels both attempts and rejects stale Claude code");
    console.log("No account authorized; credential persistence and inference were not exercised.");
  } finally {
    for (const provider of providers) await client.mutation(api.aiProviders.disconnect, { token, provider });
  }
}

main().catch(() => {
  // Do not print SDK exceptions: request arguments can include the capability.
  console.error("Provider login smoke test failed; inspect safe backend status/diagnostics.");
  process.exitCode = 1;
});
