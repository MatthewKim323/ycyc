// Usage:
//   npx tsx scripts/re/strong/login.ts            log in with STRONG_EMAIL/STRONG_PASSWORD (.env.local)
//   STRONG_MFA_CODE=123456 npx tsx scripts/re/strong/login.ts
//                                                  submit the emailed code for the pending challenge
// If no challenge is pending and a code is given, it logs in first and tries the code on the
// fresh challenge (works when Strong reuses the active challenge).
import { loadEnv, need } from "../lib/env";
import { loadState, login, submitMfa } from "./auth";

(async () => {
  const env = loadEnv();
  need(env, "STRONG_EMAIL", "STRONG_PASSWORD");
  const s = loadState();
  const code = env.STRONG_MFA_CODE;
  if (code) {
    if (!s.pending) {
      const o = await login(s, env.STRONG_EMAIL, env.STRONG_PASSWORD);
      if (o === "ok") return console.log("logged in without MFA (device trusted)");
    }
    await submitMfa(s, code);
    return console.log("MFA ok, tokens saved to ~/.ycyc/re-state/strong.json (userId present:", !!s.userId, ")");
  }
  const o = await login(s, env.STRONG_EMAIL, env.STRONG_PASSWORD);
  console.log(o === "ok" ? "logged in, tokens saved" : "MFA_REQUIRED: a code was emailed; rerun with STRONG_MFA_CODE=<code>");
})().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
