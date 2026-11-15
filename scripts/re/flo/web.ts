// npx tsx scripts/re/flo/web.ts profile
// FLO_EMAIL/FLO_PASSWORD env only: npx tsx scripts/re/flo/web.ts login --session-file /private/path/flo-session.json
// FLO_SESSION_TOKEN env or --session-file is used for profile. No credentials/tokens are printed.
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getProfile, login } from "./client";

async function main() {
  const [command = "help", ...args] = process.argv.slice(2);
  const fileIndex = args.indexOf("--session-file");
  const path = fileIndex >= 0 && args[fileIndex + 1] ? resolve(args[fileIndex + 1]) : undefined;
  if (command === "help") {
    console.log("commands: login --session-file <new private file>, profile [--session-file <file>]\nlogin needs FLO_EMAIL/FLO_PASSWORD; profile accepts FLO_SESSION_TOKEN. unverified web profile only; no health writes.");
    return;
  }
  if (command === "login") {
    if (!path) throw new Error("Choose a new private --session-file (never a tracked file)");
    const token = await login(process.env.FLO_EMAIL ?? "", process.env.FLO_PASSWORD ?? "", process.env.FLO_VISITOR_ID ?? randomUUID());
    // Exclusive creation prevents overwriting an existing file or following a symlink.
    writeFileSync(path, JSON.stringify({ token, capturedAt: Date.now() }) + "\n", { mode: 0o600, flag: "wx" });
    console.log("session saved privately; authenticated profile has not been verified");
  } else if (command === "profile") {
    const stored = path ? JSON.parse(readFileSync(path, "utf8")) as { token?: unknown } : {};
    const token = process.env.FLO_SESSION_TOKEN ?? (typeof stored.token === "string" ? stored.token : "");
    console.log(JSON.stringify(await getProfile(token), null, 2));
  } else throw new Error("Unknown command; use help");
}

main().catch((error: unknown) => {
  // Only known errors are printed. Network errors may include account-specific URLs.
  const message = error instanceof Error ? error.message : "Flo request failed";
  const safe = /^(Flo |A valid FLO_|FLO_EMAIL|Unrecognized Flo|Choose a new private|Unknown command)/.test(message);
  console.error(safe ? message : "Flo command failed; check the private file and network connection");
  process.exitCode = 1;
});
