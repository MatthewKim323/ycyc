// Smoke test for the Revyl REST path used by convex/revyl.ts. Boots the Strong build, taps
// "Log in", extracts the screen text, always stops the device. ~1 to 2 device minutes.
//   npx tsx scripts/re/revyl-smoke.ts [buildId]
import { loadEnv, need } from "./lib/env";
import { RevylClient, runPhoneTask } from "./lib/revyl";

(async () => {
  const env = loadEnv();
  need(env, "REVYL_API_KEY");
  const client = new RevylClient(env.REVYL_API_KEY);
  const buildId = process.argv[2] ?? "7305e6d8-dec7-4875-af81-d2df944f5df1";
  const t0 = Date.now();
  const r = await runPhoneTask(client, {
    buildId,
    instruction: "Tap the Log in button",
    extract: "List every visible text field label and button label on the screen",
  });
  console.log(JSON.stringify({ ok: r.ok, text: r.text, viewerUrl: r.viewerUrl, steps: r.steps.map((s) => ({ ok: s.ok, text: s.text })), seconds: Math.round((Date.now() - t0) / 1000) }, null, 1));
})().catch((e) => {
  console.error("error:", String(e?.message ?? e));
  process.exit(1);
});
