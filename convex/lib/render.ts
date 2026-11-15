// Template rendering for RequestTemplate placeholders.
//   {{arg}} or {{args.arg}}          tool arguments (dot paths allowed)
//   {{session.headers.x}}            SessionBundle headers (case-insensitive)
//   {{session.cookies.x}}            SessionBundle cookies
//   {{session.storage.x.y}}          SessionBundle storage (JSON string values are walked into)
//   {{session.credentials.username}} login_api credentials
//   {{login.x}}                      JSON from the recipe's loginRequest/refresh response (cached per connection)
//   {{baseUrl}} {{today}} {{now}}    built-ins
import type { RecipeTool, SessionBundle } from "../../src/lib/contract";

export interface RenderScope {
  args: Record<string, unknown>;
  session: SessionBundle;
  login?: unknown;
  baseUrl?: string;
}

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;
const UNDEF = "__ycyc_undefined__";

// YYYY-MM-DD in the user's zone (session.storage.tz, same rule as src/lib/compiler/render.ts), else LA.
export function todayPT(timeZone?: string): string {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  try {
    return fmt(timeZone || "America/Los_Angeles");
  } catch {
    return fmt("America/Los_Angeles");
  }
}

function tzOf(session: SessionBundle | undefined): string | undefined {
  const st = session?.storage ?? {};
  return st.tz ?? st.timeZone ?? undefined;
}

function walk(value: unknown, parts: string[]): unknown {
  let cur: unknown = value;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (cur === undefined || cur === null) return undefined;
    if (typeof cur === "string") {
      try {
        cur = JSON.parse(cur);
      } catch {
        return undefined;
      }
    }
    if (typeof cur !== "object" || cur === null) return undefined;
    const obj = cur as Record<string, unknown>;
    if (p in obj) {
      cur = obj[p];
      continue;
    }
    // Header names are case-insensitive.
    const lower = p.toLowerCase();
    const key = Object.keys(obj).find((k) => k.toLowerCase() === lower);
    cur = key === undefined ? undefined : obj[key];
  }
  return cur;
}

export function lookup(name: string, scope: RenderScope): unknown {
  const parts = name.split(".").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;
  const [head, ...rest] = parts;
  switch (head) {
    case "session":
      return walk(scope.session, rest);
    case "login":
      return rest.length === 0 ? scope.login : walk(scope.login, rest);
    case "args":
      return walk(scope.args, rest);
    case "baseUrl":
      return scope.baseUrl;
    case "today":
      return rest.length === 0 && !("today" in scope.args) ? todayPT(tzOf(scope.session)) : walk(scope.args, parts);
    case "now":
      return rest.length === 0 && !("now" in scope.args) ? Date.now() : walk(scope.args, parts);
    default:
      return walk(scope.args, parts);
  }
}

function asText(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

export function renderUrl(tpl: string, scope: RenderScope): string {
  let out = tpl.replace(PLACEHOLDER, (_m, name: string) => {
    const v = lookup(name, scope);
    if (name.trim() === "baseUrl") return asText(v).replace(/\/$/, "");
    return encodeURIComponent(asText(v));
  });
  if (out.startsWith("/") && scope.baseUrl) out = scope.baseUrl.replace(/\/$/, "") + out;
  // Drop query params whose placeholder rendered empty (optional args not given).
  const q = out.indexOf("?");
  if (q >= 0) {
    const kept = out
      .slice(q + 1)
      .split("&")
      .filter((kv) => kv && !/=$/.test(kv));
    out = out.slice(0, q) + (kept.length ? "?" + kept.join("&") : "");
  }
  return out;
}

export function renderHeader(tpl: string, scope: RenderScope): string {
  return tpl.replace(PLACEHOLDER, (_m, name: string) => asText(lookup(name, scope)));
}

function stripUndef(v: unknown): unknown {
  if (Array.isArray(v)) return v.filter((x) => x !== UNDEF).map(stripUndef);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (x === UNDEF) continue;
      out[k] = stripUndef(x);
    }
    return out;
  }
  return v;
}

// Body rendering picks its mode from the request's content-type (or, without one, the template's
// shape), like src/lib/compiler/render.ts:
//   JSON                  JSON-aware substitution (renderJsonBody below)
//   form-urlencoded       values URI-encoded, literal text untouched
//   anything else         plain text (GWT-RPC "|{{session.storage.nonce}}|" stays unquoted)
export function renderBody(tpl: string, scope: RenderScope, contentType?: string): string {
  const ct = (contentType ?? "").toLowerCase();
  const looksJson = /^\s*[{[]/.test(tpl);
  if (ct.includes("json") || (!ct && looksJson)) return renderJsonBody(tpl, scope);
  if (ct.includes("x-www-form-urlencoded")) {
    return tpl.replace(PLACEHOLDER, (_m, name: string) => encodeURIComponent(asText(lookup(name, scope))));
  }
  return tpl.replace(PLACEHOLDER, (_m, name: string) => asText(lookup(name, scope)));
}

// JSON-aware: "{{x}}" as a whole JSON string becomes the JSON value of x (numbers stay numbers),
// a placeholder inside a longer string is escaped text, a bare placeholder is the JSON value.
function renderJsonBody(tpl: string, scope: RenderScope): string {
  let out = tpl.replace(/"\{\{\s*([^{}]+?)\s*\}\}"/g, (_m, name: string) => {
    const v = lookup(name, scope);
    if (v === undefined) return JSON.stringify(UNDEF);
    return JSON.stringify(v);
  });
  out = out.replace(PLACEHOLDER, (m, name: string, offset: number) => {
    const v = lookup(name, scope);
    // Inside a JSON string if an odd number of unescaped quotes precede it.
    const before = out.slice(0, offset);
    const quotes = (before.match(/(?<!\\)"/g) ?? []).length;
    if (quotes % 2 === 1) return JSON.stringify(asText(v)).slice(1, -1);
    return v === undefined ? "null" : JSON.stringify(v);
  });
  try {
    return JSON.stringify(stripUndef(JSON.parse(out)));
  } catch {
    // Not JSON (form body or plain text): leave as rendered, undefined markers become empty.
    return out.split(JSON.stringify(UNDEF)).join('""');
  }
}

// Apply inputSchema defaults and light coercion, default a missing "date" arg to today.
export function prepareArgs(
  tool: RecipeTool,
  raw: Record<string, unknown> | undefined,
  session?: SessionBundle,
): Record<string, unknown> {
  const args: Record<string, unknown> = { ...(raw ?? {}) };
  const today = todayPT(tzOf(session));
  const props = ((tool.inputSchema as { properties?: Record<string, { type?: string; default?: unknown }> })
    ?.properties ?? {}) as Record<string, { type?: string; default?: unknown }>;
  // Split-date tools (Cronometer day/month/year): a missing date means today.
  const blank = (x: unknown) => x === undefined || x === null || x === "";
  if ("day" in props && "month" in props && "year" in props && blank(args.day) && blank(args.month) && blank(args.year)) {
    const [y, m, d] = today.split("-").map(Number);
    args.year = y;
    args.month = m;
    args.day = d;
  }
  for (const [name, schema] of Object.entries(props)) {
    const missing = blank;
    if (missing(args[name]) && schema?.default !== undefined) args[name] = schema.default;
    if (missing(args[name]) && (name === "date" || name === "entry_date")) args[name] = today;
    // "{{today}}" / "today" defaults and values mean the user's current date.
    if (args[name] === "{{today}}" || (args[name] === "today" && /date/i.test(name))) args[name] = today;
    const v = args[name];
    if (typeof v === "string" && (schema?.type === "number" || schema?.type === "integer") && v.trim() !== "" && !isNaN(Number(v))) {
      args[name] = Number(v);
    }
    if (typeof v === "string" && schema?.type === "boolean" && (v === "true" || v === "false")) {
      args[name] = v === "true";
    }
  }
  return args;
}

export function extractPath(data: unknown, path: string | undefined): unknown {
  if (!path || !path.trim()) return data;
  return walk(data, path.split(".").filter(Boolean));
}

export const MAX_TOOL_TEXT = 8 * 1024;

export function truncateText(text: string, max = MAX_TOOL_TEXT): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n...[truncated ${text.length - max} chars]`;
}

// A list over the cap keeps whole items (still valid JSON) instead of being cut mid-object.
export function fitToolText(value: unknown, text: string, max = MAX_TOOL_TEXT): string {
  if (text.length <= max || !Array.isArray(value) || value.length < 2) return truncateText(text, max);
  const note = (k: number) => `\n[showing ${k} of ${value.length} items]`;
  let size = 2;
  let k = 0;
  for (const item of value) {
    const s = (JSON.stringify(item) ?? "null").length + (k ? 1 : 0);
    if (size + s + note(k + 1).length > max) break;
    size += s;
    k++;
  }
  return k === 0 ? truncateText(text, max) : JSON.stringify(value.slice(0, k)) + note(k);
}

export function usesLogin(...templates: (string | undefined)[]): boolean {
  return templates.some((t) => !!t && /\{\{\s*login[.}\s]/.test(t));
}
