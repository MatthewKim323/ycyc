// Loads KEY=VALUE pairs from the repo's .env.local into a map without printing anything.
// Secrets stay in memory; callers must never log the returned values.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  const path = join(__dirname, "..", "..", "..", ".env.local");
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    text = "";
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  const merged: Record<string, string> = { ...out, ...(process.env as Record<string, string>) };
  if (!merged.REVYL_API_KEY) {
    try {
      const c = JSON.parse(readFileSync(join(homedir(), ".revyl", "credentials.json"), "utf8"));
      if (c.api_key) merged.REVYL_API_KEY = c.api_key;
    } catch {
      /* not logged in */
    }
  }
  return merged;
}

export function need(env: Record<string, string>, ...keys: string[]): void {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) throw new Error(`missing env: ${missing.join(", ")} (set them in .env.local)`);
}

// Print helper that scrubs anything that looks like a token or a known secret value.
export function scrub(s: string, secrets: string[]): string {
  let out = s;
  for (const v of secrets) if (v && v.length >= 4) out = out.split(v).join("<redacted>");
  return out.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "<jwt>");
}
