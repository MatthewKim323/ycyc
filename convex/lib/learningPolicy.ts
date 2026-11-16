// The agent selects immutable observations; it never supplies executable code,
// request headers, destinations, methods, bodies, or credentials.
import type { SessionBundle } from "../../src/lib/contract";

const PRIVATE = /token|secret|password|credential|cookie|authorization|api.?key|session|otp|code|signature/i;
const UNSAFE = /(?:^|[/_.-])(?:create|add|delete|remove|update|edit|save|set|send|submit|post|put|patch|destroy|logout|login|signout|signin|auth|oauth|register|unsubscribe|subscribe|purchase|pay|charge|checkout|execute|exec|run|command|action|track|event|reset|verify|confirm|accept|approve|revoke|refresh|export|import)(?:$|[/_.-])/i;
const READ = /^(?:get|list|search|lookup|query|read|me|profile|user|users|account|accounts|item|items|products|books|diary|history|summary|stats|status|config|settings|catalog|zones|prices|workouts|foods|entries|data)$/i;
const QUERY = /^(?:q|query|search|term|page|offset|limit|count|size|sort|order|filter|fields|include|expand|id|ids|date|from|to|start|end|lang|locale|format|category|type|version)$/i;

export function endpointUrl(raw: string, origin: string): string {
  if (raw.length > 2048 || /[{}\r\n\\]/.test(raw)) throw new Error("Unsupported endpoint");
  const url = new URL(raw, origin);
  if (url.protocol !== "https:" || url.origin !== origin || url.username || Boolean(url.password) || url.port || url.hash) throw new Error("Endpoint must stay on the app's HTTPS origin");
  let path = url.pathname;
  for (let i = 0; i < 3 && path.includes("%"); i++) path = decodeURIComponent(path);
  const segments = path.split("/").filter(Boolean);
  // Fail closed: a read-looking parent such as /users does not authorize an
  // unknown operation at /users/transfer. Only a known final read noun/verb,
  // optionally followed by numeric record IDs, is eligible for GET replay.
  while (segments.length && /^\d+$/.test(segments[segments.length - 1]!)) segments.pop();
  const operation = (segments.at(-1) ?? "").replace(/\.json$/i, "");
  if (/[?%#{}\\\r\n]/.test(path) || UNSAFE.test(path) || !READ.test(operation)) throw new Error("Endpoint is not a supported read operation");
  for (const [key, value] of url.searchParams) {
    if (!QUERY.test(key) || PRIVATE.test(key) || value.length > 256 || /[{}<>\r\n]/.test(value)) throw new Error("Unsupported endpoint parameters");
  }
  return url.href;
}

export function safePath(raw: string): string {
  const u = new URL(raw);
  return u.pathname.split("/").map((p) => {
    const decoded = decodeURIComponent(p);
    return !(READ.test(decoded.replace(/\.json$/i, "")) || /^(?:api|v\d+|dev|docs|developer|developers|reference|assets|static|scripts)$/i.test(decoded)) ? (p ? ":value" : "") : decoded;
  }).join("/");
}

export function querySchema(raw: string) {
  return { type: "object", properties: Object.fromEntries([...new Set(new URL(raw).searchParams.keys())].map((key) => [key, { type: ["string", "number", "boolean"], description: "Optional override of this observed query parameter." }])), additionalProperties: false };
}

export function parameterizedUrl(raw: string, origin: string, args: Record<string, unknown>): string {
  const url = new URL(endpointUrl(raw, origin));
  if (Object.keys(args).length > 20) throw new Error("Too many query parameters");
  for (const [key, value] of Object.entries(args)) {
    if (!url.searchParams.has(key) || !["string", "number", "boolean"].includes(typeof value) || (typeof value === "number" && !Number.isFinite(value)) || String(value).length > 256) throw new Error("Only observed primitive query parameters are supported");
    url.searchParams.set(key, String(value));
  }
  return endpointUrl(url.href, origin);
}

export function valueShape(value: unknown, depth = 0): unknown {
  if (depth > 4) return "nested";
  if (value === null) return "null";
  if (Array.isArray(value)) return { array: value.length ? valueShape(value[0], depth + 1) : "unknown" };
  if (typeof value !== "object") return typeof value;
  return Object.fromEntries(Object.entries(value as object).slice(0, 40)
    .filter(([key]) => /^[a-zA-Z_][a-zA-Z0-9_]{0,47}$/.test(key) && !PRIVATE.test(key) && !["__proto__", "constructor", "prototype"].includes(key))
    .map(([key, item]) => [key, valueShape(item, depth + 1)]));
}

export function responseAt(value: unknown, path: string): unknown {
  if (!/^(?:[A-Za-z_][A-Za-z0-9_]{0,47}(?:\.[A-Za-z_][A-Za-z0-9_]{0,47}){0,5})?$/.test(path)) throw new Error("Invalid response path");
  let result = value;
  for (const key of path ? path.split(".") : []) {
    if (PRIVATE.test(key) || ["__proto__", "constructor", "prototype"].includes(key) || !result || typeof result !== "object" || !Object.hasOwn(result, key)) throw new Error("Response path is unavailable");
    result = (result as Record<string, unknown>)[key];
  }
  return result;
}

export function capturedHeaders(names: string[], session: SessionBundle): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  for (const name of names) {
    const lower = name.toLowerCase();
    if (!/^(?:authorization|x-[a-z0-9-]{1,64}|[a-z0-9-]{1,40}-token)$/.test(lower)) continue;
    if (/forward|host|proxy|origin|referer|url/i.test(lower)) continue;
    const value = Object.entries(session.headers ?? {}).find(([key]) => key.toLowerCase() === lower)?.[1];
    if (value && value.length <= 8192 && !/[\r\n]/.test(value)) headers[lower] = value;
  }
  if (names.some((n) => n.toLowerCase() === "cookie")) {
    const cookie = Object.entries(session.cookies ?? {}).filter(([key, value]) => /^[!#$%&'*+.^_`|~a-zA-Z0-9-]+$/.test(key) && !/[;\r\n]/.test(value)).map(([key, value]) => `${key}=${value}`).join("; ");
    if (cookie.length <= 8192 && cookie) headers.cookie = cookie;
  }
  return headers;
}

export function redactSessionEcho(value: unknown, session?: SessionBundle): unknown {
  const headerValues = Object.values(session?.headers ?? {});
  const secrets = [...headerValues, ...headerValues.flatMap((v) => {
    const match = /^(?:Bearer|Basic|Token)\s+(.+)$/i.exec(v);
    return match ? [match[1]!] : [];
  }), ...Object.values(session?.cookies ?? {}), ...Object.values(session?.storage ?? {}), ...Object.values(session?.credentials ?? {})].filter((s) => typeof s === "string" && s.length > 0);
  const nestedSecrets = (item: unknown, depth: number): void => {
    if (depth > 6 || secrets.length > 1000) return;
    if (typeof item === "string" && item) {
      secrets.push(item);
      if (item.length <= 64 * 1024 && /^[\s]*[\[{]/.test(item)) {
        try { nestedSecrets(JSON.parse(item), depth + 1); } catch { /* Ordinary string. */ }
      }
    } else if (item && typeof item === "object") for (const child of Object.values(item).slice(0, 100)) nestedSecrets(child, depth + 1);
  };
  for (const value of Object.values(session?.storage ?? {})) nestedSecrets(value, 0);
  const visit = (item: unknown): unknown => {
    if (typeof item === "string") {
      if (secrets.includes(item)) return "[redacted]";
      if (item.length <= 256 * 1024 && /^[\s]*[\[{]/.test(item)) {
        try { return JSON.stringify(visit(JSON.parse(item))); } catch { /* Ordinary string. */ }
      }
      return secrets.filter((s) => s.length >= 6).reduce((text, secret) => text.split(secret).join("[redacted]"), item);
    }
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).filter(([key]) => !secrets.some((s) => key.includes(s))).map(([key, child]) => [key, visit(child)]));
    return item;
  };
  return visit(value);
}

export async function epoch(sessionJson: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sessionJson));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
