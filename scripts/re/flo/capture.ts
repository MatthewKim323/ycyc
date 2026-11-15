// Local-only HAR inventory. Prints endpoint templates and JSON field types, never header/body values.
// npx tsx scripts/re/flo/capture.ts /private/path/user-owned-flo.har
import { readFileSync } from "node:fs";

type HarEntry = { request?: { method?: string; url?: string }; response?: { status?: number; content?: { text?: string; encoding?: string } } };
const hosts = new Set(["api.owhealth.com", "auth.flo.health"]);
const segments = new Set(["call", "v1", "v2", "web_app", "users", "sessions", "token", "consents", "user_profile_settings", "third_party", "oauth", "mfa", "challenge", "authorize", "userinfo", "cycles", "periods", "symptoms", "diary", "events", "profile"]);
const field = (key: string) => /^[a-zA-Z_][a-zA-Z_0-9]{0,63}$/.test(key) ? key : "<dynamic-key>";

function shape(value: unknown, depth = 0): unknown {
  if (value === null) return "null";
  if (depth >= 4) return Array.isArray(value) ? "array" : typeof value;
  if (Array.isArray(value)) return value.length ? [shape(value[0], depth + 1)] : [];
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 50).map(([key, child]) => [field(key), shape(child, depth + 1)]));
  return typeof value;
}

export function inventory(har: unknown): unknown[] {
  const entries = (har as { log?: { entries?: HarEntry[] } })?.log?.entries;
  if (!Array.isArray(entries)) throw new Error("Expected a HAR log.entries array");
  const out: unknown[] = [];
  for (const entry of entries) {
    let url: URL;
    try { url = new URL(entry.request?.url ?? ""); } catch { continue; }
    if (url.protocol !== "https:" || !hosts.has(url.hostname)) continue;
    // Never preserve query values, path IDs or arbitrary strings from account-specific routes.
    const path = url.pathname.split("/").map((part) => segments.has(part) ? part : part ? ":value" : "").join("/");
    let responseShape: unknown = "unavailable";
    try {
      const content = entry.response?.content;
      const text = content?.encoding === "base64" ? Buffer.from(content.text ?? "", "base64").toString("utf8") : content?.text ?? "";
      responseShape = shape(JSON.parse(text));
    } catch { /* binary/non-JSON body is not emitted */ }
    out.push({ method: /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(entry.request?.method ?? "") ? entry.request!.method : "OTHER", host: url.hostname, path, status: entry.response?.status, responseShape });
  }
  return out;
}

if (process.argv[1]?.endsWith("/capture.ts")) {
  try {
    if (!process.argv[2]) throw new Error("Provide a user-owned HAR path");
    console.log(JSON.stringify(inventory(JSON.parse(readFileSync(process.argv[2], "utf8"))), null, 2));
  } catch { console.error("Could not inventory Flo HAR; expected a readable user-owned HAR file"); process.exitCode = 1; }
}
