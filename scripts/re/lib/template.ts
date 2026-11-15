// RequestTemplate renderer and recipe tool runner. Pure TS, no Node-only imports, so the
// Convex executor can import it directly (`../scripts/re/lib/template`) and the scripts in
// scripts/re/* exercise exactly the same code path. A passing script means a passing recipe.
//
// Template language (urlTemplate, headers, bodyTemplate):
//   {{path}}            dot path into the render context: tool args first, then
//                       session.* (SessionBundle) and login.* (parsed loginRequest response)
//   {{path|fallback}}   fallback literal when the value is missing ("" allowed: {{x|}})
//   {{$uuid}}           fresh random UUID on every occurrence
//   {{$now}}            ISO timestamp; {{$nowMs}} epoch ms; {{$today}} YYYY-MM-DD (UTC)
//   {{#each list}}...{{/each}}
//                       repeats the block per item and joins the copies with ","
//                       (meant for JSON arrays). Inside, names resolve on the item first,
//                       {{this}} is the item, {{@index}} its position.
//   {{$page}}           current page when the tool sets "pages" (see ToolExtras)
// Encoding: in urlTemplate values are URI-encoded. In bodyTemplate a placeholder inside a
// JSON string literal is string-escaped; a bare placeholder becomes JSON (numbers, arrays,
// objects, booleans, null for missing). Headers get the raw string.

import type { Recipe, RecipeTool, RequestTemplate, SessionBundle } from "../../../src/lib/contract";

export type Ctx = Record<string, unknown>;

const MISSING = Symbol("missing");

function uuid(): string {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let cur: any = obj;
  for (const part of path.split(".")) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function resolve(expr: string, scopes: Ctx[]): unknown {
  const name = expr.trim();
  if (name === "$uuid") return uuid();
  if (name === "$now") return new Date().toISOString();
  if (name === "$nowMs") return Date.now();
  if (name === "$today") return new Date().toISOString().slice(0, 10);
  for (const scope of scopes) {
    if (name === "this" && "this" in scope) return scope.this;
    const v = getPath(scope, name);
    if (v !== undefined) return v;
  }
  return MISSING;
}

function lookup(raw: string, scopes: Ctx[]): unknown {
  const bar = raw.indexOf("|");
  const expr = bar >= 0 ? raw.slice(0, bar) : raw;
  const v = resolve(expr, scopes);
  if (v === MISSING || v === null || v === "") {
    if (bar >= 0) {
      const fb = raw.slice(bar + 1);
      if (fb.startsWith("$")) return resolve(fb, scopes);
      const n = Number(fb);
      return fb !== "" && !Number.isNaN(n) ? n : fb;
    }
    return v === MISSING ? undefined : v;
  }
  return v;
}

// Expand {{#each}} blocks (supports nesting) before scalar substitution.
function expandEach(tpl: string, scopes: Ctx[]): string {
  const open = /\{\{#each\s+([^}]+)\}\}/;
  let out = "";
  let rest = tpl;
  for (;;) {
    const m = open.exec(rest);
    if (!m) return out + rest;
    out += rest.slice(0, m.index);
    let depth = 1;
    let i = m.index + m[0].length;
    const bodyStart = i;
    while (depth > 0) {
      const nextOpen = rest.indexOf("{{#each", i);
      const nextClose = rest.indexOf("{{/each}}", i);
      if (nextClose < 0) throw new Error("template: unclosed {{#each}}");
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth++;
        i = nextOpen + 7;
      } else {
        depth--;
        i = nextClose + 9;
      }
    }
    const body = rest.slice(bodyStart, i - 9);
    const list = lookup(m[1], scopes);
    const items = Array.isArray(list) ? list : [];
    out += items
      .map((item, idx) => {
        const itemScope: Ctx =
          item && typeof item === "object" && !Array.isArray(item)
            ? { ...(item as Ctx), this: item, "@index": idx }
            : { this: item, "@index": idx };
        return expandEach(body, [itemScope, ...scopes]).replace(/\{\{@index\}\}/g, String(idx))
          // resolve item-scoped names now so outer scopes cannot shadow them later
          .replace(/\{\{(?![#/$])([^}]+)\}\}/g, (whole, expr: string) => {
            const name = expr.split("|")[0].trim();
            const head = name === "this" ? "this" : name.split(".")[0];
            return head in itemScope
              ? `{{=${encodeURIComponent(JSON.stringify(lookup(expr, [itemScope]) ?? null))}}}`
              : whole;
          });
      })
      .join(",");
    rest = rest.slice(i);
  }
}

type Mode = "url" | "header" | "json";

function encodeValue(v: unknown, mode: Mode, inString: boolean): string {
  if (mode === "json") {
    if (inString) return v === undefined || v === null ? "" : JSON.stringify(String(v)).slice(1, -1);
    return v === undefined ? "null" : JSON.stringify(v);
  }
  const s = v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return mode === "url" ? encodeURIComponent(s) : s;
}

export function renderString(tpl: string, ctx: Ctx, mode: Mode): string {
  const scopes = [ctx];
  const expanded = expandEach(tpl, scopes);
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < expanded.length; i++) {
    if (expanded.startsWith("{{", i)) {
      const end = expanded.indexOf("}}", i + 2);
      if (end < 0) throw new Error("template: unclosed {{");
      const expr = expanded.slice(i + 2, end);
      // {{=json}} is a value pre-resolved inside an {{#each}} block
      const v = expr.startsWith("=") ? JSON.parse(decodeURIComponent(expr.slice(1))) : lookup(expr, scopes);
      out += encodeValue(v, mode, inString);
      i = end + 1;
      continue;
    }
    const ch = expanded[i];
    if (mode === "json") {
      if (escaped) escaped = false;
      else if (ch === "\\" && inString) escaped = true;
      else if (ch === '"') inString = !inString;
    }
    out += ch;
  }
  return out;
}

export interface RenderedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export function renderRequest(t: RequestTemplate, ctx: Ctx, baseUrl?: string): RenderedRequest {
  let url = renderString(t.urlTemplate, ctx, "url");
  if (!/^https?:\/\//.test(url) && baseUrl) url = baseUrl.replace(/\/$/, "") + "/" + url.replace(/^\//, "");
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(t.headers ?? {})) headers[k] = renderString(v, ctx, "header");
  const body = t.bodyTemplate ? renderString(t.bodyTemplate, ctx, "json") : undefined;
  if (body !== undefined) JSON.parse(body); // fail fast on a broken template, before any network call
  return { method: t.method, url, headers, body };
}

export interface HttpResult {
  status: number;
  body: unknown; // parsed JSON when possible, else text
  url: string;
}

export async function send(req: RenderedRequest, fetchImpl: typeof fetch = fetch): Promise<HttpResult> {
  const res = await fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  return { status: res.status, body, url: req.url };
}

// Holds the login_api result between calls. Callers persist `login` per user if they want.
export interface RunState {
  login?: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  status: number;
  data: unknown; // extracted value
  raw?: unknown;
  error?: string;
}

function baseCtx(session: SessionBundle, state: RunState, args: Record<string, unknown>): Ctx {
  return { ...args, args, session, login: state.login ?? {} };
}

function jwtClaims(token: unknown): Record<string, unknown> | null {
  if (typeof token !== "string" || token.split(".").length !== 3) return null;
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return null;
  }
}

// Fills login.userId from the access token when the auth response does not carry it
// (Strong's refresh response, for example).
function normalizeLogin(login: Record<string, unknown>): Record<string, unknown> {
  if (!login.userId) {
    const c = jwtClaims(login.accessToken);
    const id = c?.sub ?? c?.userId ?? c?.["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"];
    if (id) login.userId = id;
  }
  return login;
}

function tokenExpired(login: Record<string, unknown>): boolean {
  const exp = jwtClaims(login.accessToken)?.exp;
  return typeof exp === "number" && exp * 1000 - 60_000 < Date.now();
}

async function authCall(t: RequestTemplate, recipe: Recipe, session: SessionBundle, state: RunState, fetchImpl: typeof fetch) {
  const res = await send(renderRequest(t, baseCtx(session, state, {}), recipe.baseUrl), fetchImpl);
  if (res.status < 200 || res.status >= 300 || !res.body || typeof res.body !== "object") {
    const b = res.body as any;
    const hint = b && typeof b === "object" && b.code === "MFA_REQUIRED" ? " MFA_REQUIRED (account needs an emailed code)" : "";
    throw new Error(`auth failed: HTTP ${res.status}${hint}`);
  }
  state.login = normalizeLogin({ ...(state.login ?? {}), ...(res.body as Record<string, unknown>) });
}

// Session resolution for login_api recipes:
//  1. reuse state.login, else seed it from session.storage {accessToken, refreshToken, userId}
//  2. refresh when the access token is expired (or force) and auth.refresh exists
//  3. otherwise call auth.loginRequest with session.credentials
// Refresh rotates tokens: callers must persist state.login back into session.storage.
export async function ensureLogin(
  recipe: Recipe,
  session: SessionBundle,
  state: RunState,
  fetchImpl: typeof fetch = fetch,
  force = false,
): Promise<void> {
  if (recipe.auth.type !== "login_api") return;
  const st = session.storage ?? {};
  if (!state.login && st.accessToken) {
    state.login = normalizeLogin({ accessToken: st.accessToken, refreshToken: st.refreshToken, userId: st.userId });
  }
  if (state.login && !force && !tokenExpired(state.login)) return;
  if (state.login?.refreshToken && recipe.auth.refresh) {
    try {
      await authCall(recipe.auth.refresh, recipe, session, state, fetchImpl);
      return;
    } catch (e) {
      if (!recipe.auth.loginRequest || !session.credentials) throw e;
    }
  }
  if (!recipe.auth.loginRequest) throw new Error("no way to authenticate: session has no tokens and recipe has no loginRequest");
  state.login = undefined;
  await authCall(recipe.auth.loginRequest, recipe, session, state, fetchImpl);
}

// Optional fields a recipe tool may carry beyond contract.ts (other executors ignore them and
// still get a correct, just larger, first page).
export interface ToolExtras {
  pages?: number; // loop {{$page}} = 1..pages, concatenating extracted arrays (stops on an empty page)
  filterContains?: string; // template; keep array items whose JSON contains it (case-insensitive)
  maxItems?: number | string; // template; cap the array after filtering
  compact?: boolean; // HAL compaction: _links -> <rel>Id, _embedded merged up, empty fields dropped
}

const lastSeg = (href: unknown) => (typeof href === "string" ? href.split("?")[0].split("/").filter(Boolean).pop() : undefined);

// Nested entity ids (cells, sets) are dropped; top-level item ids are kept so tools can chain.
export function compactHal(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) return v.map((x) => compactHal(x, depth));
  if (!v || typeof v !== "object") return v;
  const src = v as Record<string, any>;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(src)) {
    if (k === "_links") {
      for (const [rel, link] of Object.entries(x ?? {})) {
        if (rel === "self" || rel === "user" || rel === "next" || rel === "last") continue;
        if (Array.isArray(link)) out[`${rel}Ids`] = link.map((l: any) => lastSeg(l?.href));
        else if (link && typeof link === "object") out[`${rel}Id`] = lastSeg((link as any).href);
      }
      continue;
    }
    if (k === "_embedded") {
      for (const [ek, ev] of Object.entries(x ?? {})) out[ek] = compactHal(ev, depth + 1);
      continue;
    }
    if (x === null || x === undefined || x === "" || x === false) continue;
    if (k === "id" && depth >= 1) continue;
    if (Array.isArray(x) && x.length === 0) continue;
    if (x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).length === 0) continue;
    out[k] = compactHal(x, depth + 1);
  }
  return out;
}

export async function runTool(
  recipe: Recipe,
  toolName: string,
  args: Record<string, unknown>,
  session: SessionBundle,
  state: RunState = {},
  fetchImpl: typeof fetch = fetch,
): Promise<ToolResult> {
  const tool = recipe.tools.find((t) => t.name === toolName) as (RecipeTool & ToolExtras) | undefined;
  if (!tool) return { ok: false, status: 0, data: null, error: `unknown tool ${toolName}` };
  if (!tool.request) return { ok: false, status: 0, data: null, error: `tool ${toolName} runs on the phone executor` };
  await ensureLogin(recipe, session, state, fetchImpl);

  const call = async (page: number) => {
    const ctx = { ...baseCtx(session, state, args), $page: page };
    let res = await send(renderRequest(tool.request!, ctx, recipe.baseUrl), fetchImpl);
    if (res.status === 401 && recipe.auth.type === "login_api") {
      await ensureLogin(recipe, session, state, fetchImpl, true);
      res = await send(renderRequest(tool.request!, { ...baseCtx(session, state, args), $page: page }, recipe.baseUrl), fetchImpl);
    }
    return res;
  };

  const pages = Math.max(1, Math.min(tool.pages ?? 1, 20));
  let data: unknown = null;
  let last: HttpResult | null = null;
  for (let p = 1; p <= pages; p++) {
    const res = await call(p);
    last = res;
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, status: res.status, data: null, raw: res.body, error: `HTTP ${res.status}` };
    }
    const part = getPath(res.body, tool.extract ?? "");
    if (pages === 1) {
      data = part;
      break;
    }
    const arr = Array.isArray(part) ? part : [];
    data = [...((data as unknown[]) ?? []), ...arr];
    if (arr.length === 0) break;
  }

  const ctx = baseCtx(session, state, args);
  if (tool.filterContains && Array.isArray(data)) {
    const needle = renderString(tool.filterContains, ctx, "header").toLowerCase();
    if (needle) data = (data as unknown[]).filter((x) => JSON.stringify(x).toLowerCase().includes(needle));
  }
  if (tool.maxItems !== undefined && Array.isArray(data)) {
    const n = Number(typeof tool.maxItems === "string" ? renderString(tool.maxItems, ctx, "header") : tool.maxItems);
    if (Number.isFinite(n) && n > 0) data = (data as unknown[]).slice(0, n);
  }
  if (tool.compact) data = compactHal(data);
  return { ok: true, status: last?.status ?? 200, data, raw: pages === 1 ? last?.body : undefined };
}
