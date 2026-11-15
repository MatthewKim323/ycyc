// Renders a recipe RequestTemplate into a concrete request. Pure TS, no deps: used by the Convex
// executor, the device relay queue and scripts/re/mfp/client.ts, so a passing script means a passing
// recipe.
//
// Placeholders:
//   {{name}}                 tool argument (falls back to the inputSchema default)
//   {{session.headers.x}}    SessionBundle value (headers / cookies / storage)
//   {{today}}                YYYY-MM-DD in the user's time zone (session.storage.tz, else LA)
// In URLs, arguments are URI-encoded; a query pair whose placeholder has no value is dropped.
// In JSON bodies, a placeholder that is the whole JSON string ("{{x}}") becomes JSON.stringify(value),
// so numbers stay numbers; a bare {{x}} is inserted as a JSON value; inside a longer string it is escaped.

import type { RequestTemplate, SessionBundle } from "../contract";

export interface RenderedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface RenderOptions {
  timeZone?: string; // overrides session.storage.tz
  now?: number;
}

const PH = /\{\{\s*([a-zA-Z0-9_.\-]+)\s*\}\}/g;
const DEFAULT_TZ = "America/Los_Angeles";

export function todayIn(timeZone: string, now = Date.now()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

export function applyDefaults(schema: Record<string, unknown> | undefined, args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };
  const props = (schema && (schema as { properties?: Record<string, { default?: unknown }> }).properties) || {};
  for (const [k, p] of Object.entries(props)) {
    if ((out[k] === undefined || out[k] === null || out[k] === "") && p && p.default !== undefined) out[k] = p.default;
  }
  return out;
}

function sessionValue(session: SessionBundle | undefined, path: string): string | undefined {
  if (!session) return undefined;
  const [kind, ...rest] = path.split(".");
  const key = rest.join(".");
  const bag = (session as unknown as Record<string, Record<string, string> | undefined>)[kind];
  if (!bag || typeof bag !== "object") return undefined;
  const direct = bag[key];
  if (direct !== undefined) return direct;
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(bag)) if (k.toLowerCase() === lower) return v;
  return undefined;
}

function resolver(args: Record<string, unknown>, session: SessionBundle | undefined, opts: RenderOptions) {
  const tz = opts.timeZone || sessionValue(session, "storage.tz") || DEFAULT_TZ;
  const today = todayIn(tz, opts.now);
  return (name: string): unknown => {
    if (name === "today") return today;
    if (name.startsWith("session.")) return sessionValue(session, name.slice("session.".length));
    const v = args[name];
    if (v === "{{today}}" || v === "today") return today;
    return v;
  };
}

function asText(v: unknown): string {
  if (v === undefined || v === null) return "";
  return typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
}

export function renderUrl(tpl: string, resolve: (n: string) => unknown): string {
  const q = tpl.indexOf("?");
  const base = q >= 0 ? tpl.slice(0, q) : tpl;
  const query = q >= 0 ? tpl.slice(q + 1) : "";
  const path = base.replace(PH, (_, n: string) => encodeURIComponent(asText(resolve(n))));
  if (!query) return path;
  const pairs: string[] = [];
  for (const pair of query.split("&")) {
    if (!pair) continue;
    let missing = false;
    const rendered = pair.replace(PH, (_, n: string) => {
      const v = resolve(n);
      if (v === undefined || v === null || v === "") missing = true;
      return encodeURIComponent(asText(v));
    });
    if (!missing) pairs.push(rendered);
  }
  return pairs.length ? path + "?" + pairs.join("&") : path;
}

export function renderJsonBody(tpl: string, resolve: (n: string) => unknown): string {
  // Whole-string placeholders first: "{{x}}" -> JSON value of x (or null when missing).
  let out = tpl.replace(/"\{\{\s*([a-zA-Z0-9_.\-]+)\s*\}\}"/g, (_, n: string) => {
    const v = resolve(n);
    return v === undefined ? "null" : JSON.stringify(v);
  });
  // Remaining placeholders: inside a longer string -> escaped text; bare -> JSON value.
  out = out.replace(PH, (m: string, n: string, offset: number) => {
    const v = resolve(n);
    const inString = isInsideJsonString(out, offset);
    if (inString) return JSON.stringify(asText(v)).slice(1, -1);
    return v === undefined ? "null" : JSON.stringify(v);
  });
  return out;
}

function isInsideJsonString(s: string, idx: number): boolean {
  let inStr = false;
  for (let i = 0; i < idx; i++) {
    const c = s[i];
    if (c === "\\" && inStr) {
      i++;
      continue;
    }
    if (c === '"') inStr = !inStr;
  }
  return inStr;
}

export function renderText(tpl: string, resolve: (n: string) => unknown): string {
  return tpl.replace(PH, (_, n: string) => asText(resolve(n)));
}

export function renderRequest(
  tpl: RequestTemplate,
  args: Record<string, unknown>,
  session?: SessionBundle,
  opts: RenderOptions = {},
  inputSchema?: Record<string, unknown>,
): RenderedRequest {
  const full = applyDefaults(inputSchema, args);
  const resolve = resolver(full, session, opts);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(tpl.headers || {})) {
    const val = renderText(v, resolve);
    if (val !== "") headers[k] = val;
  }
  let body: string | undefined;
  if (tpl.bodyTemplate != null) {
    const t = tpl.bodyTemplate.trim();
    body = t.startsWith("{") || t.startsWith("[") ? renderJsonBody(tpl.bodyTemplate, resolve) : renderText(tpl.bodyTemplate, resolve);
  }
  return { method: tpl.method, url: renderUrl(tpl.urlTemplate, resolve), headers, body };
}

// Session keys a template reads ("headers.authorization", ...). Lets the executor check it has them.
export function sessionKeysUsed(tpl: RequestTemplate): string[] {
  const all = [tpl.urlTemplate, tpl.bodyTemplate || "", ...Object.values(tpl.headers || {})].join(" ");
  const keys = new Set<string>();
  for (const m of all.matchAll(PH)) if (m[1].startsWith("session.")) keys.add(m[1].slice("session.".length));
  return [...keys];
}

// Dot path into a parsed JSON value; "" returns the whole value. Supports numeric indexes ("items.0.id").
export function extractPath(value: unknown, path?: string): unknown {
  if (!path) return value;
  let cur: unknown = value;
  for (const part of path.split(".")) {
    if (cur == null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}
