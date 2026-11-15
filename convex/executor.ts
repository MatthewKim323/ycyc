import { makeFunctionReference, type GenericActionCtx } from "convex/server";
import { v } from "convex/values";
import type { Executor, Recipe, RecipeTool, RequestTemplate, SessionBundle } from "../src/lib/contract";
import { internal } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { catalogApp, displayName } from "./catalog";
import {
  extractPath,
  fitToolText,
  prepareArgs,
  renderBody,
  renderHeader,
  renderUrl,
  truncateText,
  usesLogin,
  type RenderScope,
} from "./lib/render";
import * as tmpl from "./lib/templateShim";
import type { FlaggedTool, ToolFlags } from "./lib/recipeOverrides";

type Ctx = GenericActionCtx<DataModel>;

export interface ExecResult {
  ok: boolean;
  status?: number;
  text: string; // already extracted and truncated, ready for the model
  data?: unknown;
}

const FETCH_TIMEOUT_MS = 15_000;
const DEVICE_WAIT_MS = 20_000;
const POLL_MS = 500;
const LOGIN_TTL_MS = 45 * 60_000;
const DEFAULT_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

// The phone RE agent owns convex/revyl.ts. Referenced by name so this file deploys without it.
// Expected: revyl:runTool({ appSlug, tool, instruction, args, revylAppId?, androidPackage? })
//   -> { ok: boolean, text?: string, data?: unknown } (a plain string is accepted too)
const revylRunTool = makeFunctionReference<"action">("revyl:runTool");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseSession(conn: Doc<"connections">): SessionBundle {
  try {
    return conn.sessionJson ? (JSON.parse(conn.sessionJson) as SessionBundle) : { capturedAt: 0 };
  } catch {
    return { capturedAt: 0 };
  }
}

interface BuiltRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const n = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === n);
}

function buildRequest(recipe: Recipe, tpl: RequestTemplate, scope: RenderScope, forDevice: boolean): BuiltRequest {
  const headers: Record<string, string> = {};
  for (const [k, raw] of Object.entries(tpl.headers ?? {})) {
    const val = renderHeader(raw, scope).trim();
    if (!val || /^(bearer|basic|token)$/i.test(val)) continue;
    headers[k] = val;
  }
  // Session headers the recipe says it needs, when the template didn't spell them out.
  for (const key of recipe.auth?.sessionKeys ?? []) {
    const [bucket, ...rest] = key.split(".");
    const name = rest.join(".");
    if (bucket === "headers" && name && !hasHeader(headers, name)) {
      const val = Object.entries(scope.session.headers ?? {}).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
      if (val) headers[name] = val;
    }
  }
  // The device WebView already holds the site's cookies; the cloud needs them spelled out.
  if (!forDevice && !hasHeader(headers, "cookie")) {
    const wantsCookies =
      recipe.auth?.type === "cookie" || (recipe.auth?.sessionKeys ?? []).some((k) => k.startsWith("cookies"));
    const cookies = scope.session.cookies ?? {};
    if (wantsCookies && Object.keys(cookies).length > 0) {
      headers["cookie"] = Object.entries(cookies)
        .map(([k, val]) => `${k}=${val}`)
        .join("; ");
    }
  }
  if (!hasHeader(headers, "accept")) headers["accept"] = "application/json, text/plain, */*";
  const tplContentType = Object.entries(tpl.headers ?? {}).find(([k]) => k.toLowerCase() === "content-type")?.[1];
  const body = tpl.bodyTemplate ? renderBody(tpl.bodyTemplate, scope, tplContentType) : undefined;
  if (body && !hasHeader(headers, "content-type")) {
    headers["content-type"] = body.trim().startsWith("{") || body.trim().startsWith("[") ? "application/json" : "application/x-www-form-urlencoded";
  }
  if (!forDevice && !hasHeader(headers, "user-agent")) headers["user-agent"] = DEFAULT_UA;
  return {
    method: (tpl.method ?? "GET").toUpperCase(),
    url: renderUrl(tpl.urlTemplate, scope),
    headers,
    body: tpl.method === "GET" || tpl.method === "DELETE" ? (body && body !== "{}" ? body : undefined) : body,
  };
}

async function cloudFetch(req: BuiltRequest): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      signal: controller.signal,
      redirect: "follow",
    });
    const body = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((val, key) => {
      headers[key] = val;
    });
    return { status: res.status, body, headers };
  } finally {
    clearTimeout(timer);
  }
}

async function deviceFetch(
  ctx: Ctx,
  opts: { userId: Id<"users">; connectionId?: Id<"connections">; appSlug: string; tool: string; req: BuiltRequest },
): Promise<{ status: number; body: string } | null> {
  const callId = await ctx.runMutation(internal.calls.enqueue, {
    userId: opts.userId,
    connectionId: opts.connectionId,
    appSlug: opts.appSlug,
    tool: opts.tool,
    request: opts.req,
  });
  const deadline = Date.now() + DEVICE_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const call = await ctx.runQuery(internal.calls.get, { callId });
    if (call?.status === "done" && call.response) return call.response;
    if (!call || call.status === "expired") return null;
  }
  await ctx.runMutation(internal.calls.expire, { callId });
  return null;
}

function parseBody(body: string): unknown {
  const t = body.trim();
  if (!t) return undefined;
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return JSON.parse(t);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function toText(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

// Mint (or reuse) the login/refresh response for templates that reference {{login.*}}.
async function ensureLogin(
  ctx: Ctx,
  conn: Doc<"connections">,
  recipe: Recipe,
  scope: RenderScope,
  force: boolean,
): Promise<unknown> {
  if (!force && conn.authCacheJson && conn.authCacheAt && Date.now() - conn.authCacheAt < LOGIN_TTL_MS) {
    try {
      return JSON.parse(conn.authCacheJson);
    } catch {
      // fall through and log in again
    }
  }
  const tpl = recipe.auth.type === "login_api" ? recipe.auth.loginRequest ?? recipe.auth.refresh : recipe.auth.refresh ?? recipe.auth.loginRequest;
  if (!tpl) return undefined;
  const req = buildRequest(recipe, tpl, { ...scope, login: undefined }, false);
  const res = await cloudFetch(req);
  if (res.status >= 400) {
    throw new Error(`Sign-in to ${displayName(recipe.appSlug)} failed (${res.status})`);
  }
  const parsed = parseBody(res.body);
  const login = { ...(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { value: parsed ?? res.body }), _headers: res.headers };
  await ctx.runMutation(internal.connections.saveAuthCache, { connectionId: conn._id, json: JSON.stringify(login) });
  return login;
}

function needsLogin(recipe: Recipe, tpl: RequestTemplate): boolean {
  if (recipe.auth?.type === "login_api") return true;
  return usesLogin(tpl.urlTemplate, tpl.bodyTemplate, ...Object.values(tpl.headers ?? {}));
}

// ---- Phone RE template engine (scripts/re/lib/template.ts) ----
// Recipes written for it (login_api token rotation, {{x|fallback}}, {{$uuid}}, {{#each}}, paging
// extras) run through it so a passing scripts/re run means a passing recipe here.

const TEMPLATE_SYNTAX = /\{\{[^}]*(\||#each|\$)[^}]*\}\}/;

export function isTemplated(recipe: Recipe): boolean {
  if (!tmpl.HAS_TEMPLATE) return false;
  if (recipe.auth?.type === "login_api") return true;
  if (recipe.tools.some((t) => ["pages", "filterContains", "maxItems", "compact"].some((k) => k in t))) return true;
  return TEMPLATE_SYNTAX.test(JSON.stringify({ auth: recipe.auth, tools: recipe.tools.map((t) => t.request) }));
}

const timeoutFetch: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(input, { ...(init ?? {}), signal: controller.signal }).finally(() => clearTimeout(timer));
};

// One plain line, never a stack trace or a Convex "Uncaught Error:" prefix.
export function errText(e: unknown): string {
  const raw = e instanceof Error ? (e.name === "AbortError" ? "Request timed out" : e.message) : String(e);
  const line = raw.split("\n")[0].replace(/^(Uncaught )?(\w*Error): /, "").trim();
  return /aborted|AbortError/i.test(line) ? "Request timed out" : line.slice(0, 300) || "Request failed";
}

async function executeTemplated(
  ctx: Ctx,
  opts: { conn: Doc<"connections">; recipe: Recipe; args: Record<string, unknown>; tool?: RecipeTool; template?: RequestTemplate; extract?: string },
): Promise<ExecResult> {
  const { conn, recipe } = opts;
  const session = parseSession(conn);
  let cached: Record<string, unknown> | undefined;
  try {
    cached = conn.authCacheJson ? JSON.parse(conn.authCacheJson) : undefined;
  } catch {
    cached = undefined;
  }
  const state: tmpl.RunState = { login: cached };
  const before = JSON.stringify(state.login ?? null);
  const persist = async () => {
    const after = JSON.stringify(state.login ?? null);
    if (after !== before && state.login) {
      await ctx.runMutation(internal.connections.saveAuthCache, { connectionId: conn._id, json: after });
    }
  };
  try {
    if (opts.tool) {
      const r = (await tmpl.runTool(recipe, opts.tool.name, opts.args, session, state, timeoutFetch)) as {
        ok: boolean;
        status: number;
        data: unknown;
        raw?: unknown;
        error?: string;
      };
      await persist();
      if (!r.ok) {
        const raw = r.raw === undefined ? "" : typeof r.raw === "string" ? r.raw : JSON.stringify(r.raw);
        return { ok: false, status: r.status || undefined, text: truncateText(`${r.error ?? "Failed"} ${raw}`.trim(), 1500) };
      }
      return { ok: true, status: r.status, text: fitToolText(r.data, toText(r.data, "Done.")), data: r.data };
    }
    // A bare RequestTemplate (auth.check during verify).
    await tmpl.ensureLogin(recipe, session, state, timeoutFetch);
    const ctxFor = () => ({ ...opts.args, args: opts.args, session, login: state.login ?? {}, $page: 1 });
    let res = await tmpl.send(tmpl.renderRequest(opts.template!, ctxFor(), recipe.baseUrl), timeoutFetch);
    if (res.status === 401 && recipe.auth.type === "login_api") {
      await tmpl.ensureLogin(recipe, session, state, timeoutFetch, true);
      res = await tmpl.send(tmpl.renderRequest(opts.template!, ctxFor(), recipe.baseUrl), timeoutFetch);
    }
    await persist();
    const ok = res.status >= 200 && res.status < 300;
    const data = extractPath(res.body, opts.extract);
    return {
      ok,
      status: res.status,
      text: truncateText(ok ? toText(data, "Done.") : `HTTP ${res.status}: ${toText(res.body, "")}`, ok ? undefined : 1500),
      data,
    };
  } catch (e) {
    await persist().catch(() => undefined);
    return { ok: false, text: errText(e) };
  }
}

// login_api recipes (Strong) run through the phone RE agent's verified runner in convex/revyl.ts
// (scripts/re/lib/template.ts runTool: token refresh, {{#each}}, paging, compact). The rotated
// login comes back and is stored on the connection. No password login happens here.
async function executeViaRecipeRunner(
  ctx: Ctx,
  opts: { conn: Doc<"connections">; recipe: Recipe; toolName: string; args: Record<string, unknown>; template?: RequestTemplate },
): Promise<ExecResult> {
  const { conn } = opts;
  let recipe = opts.recipe;
  let toolName = opts.toolName;
  if (opts.template) {
    // A bare RequestTemplate (auth.check): wrap it as a throwaway read tool.
    toolName = "__auth_check";
    recipe = {
      ...recipe,
      tools: [
        ...recipe.tools,
        { name: toolName, title: "Auth check", description: "", kind: "read", inputSchema: { type: "object", properties: {} }, request: opts.template },
      ],
    };
  }
  const sessionJson = conn.sessionJson ?? JSON.stringify({ capturedAt: 0 });
  let r: { ok: boolean; status: number; data: unknown; error: string | null; login: string | null };
  try {
    r = await ctx.runAction(internal.revyl.runRecipeTool, {
      recipeJson: JSON.stringify(recipe),
      tool: toolName,
      args: opts.args,
      sessionJson: JSON.stringify(withoutCreds(sessionJson)),
      loginJson: conn.authCacheJson,
    });
  } catch (e) {
    return { ok: false, text: errText(e).slice(0, 300) };
  }
  if (r.login && r.login !== conn.authCacheJson) {
    await ctx.runMutation(internal.connections.saveAuthCache, { connectionId: conn._id, json: r.login });
  }
  if (!r.ok) {
    const err = r.error ?? "Failed";
    const friendly = /no way to authenticate|auth failed/i.test(err)
      ? `${displayName(conn.appSlug)} session expired. Reconnect it in yuzu.`
      : err;
    return { ok: false, status: r.status || undefined, text: truncateText(friendly, 1500) };
  }
  return { ok: true, status: r.status, text: fitToolText(r.data, toText(r.data, "Done.")), data: r.data };
}

// Executor runs never see the password (it is stripped after sign-in anyway).
function withoutCreds(sessionJson: string): SessionBundle {
  try {
    const { credentials, ...rest } = JSON.parse(sessionJson) as SessionBundle;
    return rest as SessionBundle;
  } catch {
    return { capturedAt: 0 };
  }
}

// MFP-style refresh for bearer recipes: mint a fresh token from the site session, store it on the
// connection's session (headers.authorization, and the user id header when returned).
async function refreshBearer(
  ctx: Ctx,
  conn: Doc<"connections">,
  recipe: Recipe,
  scope: RenderScope,
  executor: Executor,
): Promise<boolean> {
  const tpl = recipe.auth.refresh;
  if (!tpl) return false;
  const req = buildRequest({ ...recipe, auth: { ...recipe.auth, type: "cookie" } }, tpl, scope, executor === "device");
  let res =
    executor === "device"
      ? await deviceFetch(ctx, { userId: conn.userId, connectionId: conn._id, appSlug: conn.appSlug, tool: "auth_refresh", req })
      : await cloudFetch(req).catch(() => null);
  // The site's HttpOnly session cookies live in the phone's WebView: if the cloud can't refresh and
  // the phone relay answered recently, refresh from there.
  if ((!res || res.status >= 400) && executor !== "device" && conn.sessionJson && conn._id) {
    if (await ctx.runQuery(internal.health.relayRecent, { userId: conn.userId })) {
      const devReq = buildRequest({ ...recipe, auth: { ...recipe.auth, type: "cookie" } }, tpl, scope, true);
      res = await deviceFetch(ctx, { userId: conn.userId, connectionId: conn._id, appSlug: conn.appSlug, tool: "auth_refresh", req: devReq });
    }
  }
  if (!res || res.status >= 400) return false;
  const body = parseBody(res.body) as Record<string, unknown> | undefined;
  const token = body?.access_token ?? body?.accessToken ?? body?.token;
  if (typeof token !== "string" || !token) return false;
  const tokenType = typeof body?.token_type === "string" ? body.token_type : "Bearer";
  const headers = { ...(scope.session.headers ?? {}) };
  const authKey = Object.keys(headers).find((k) => k.toLowerCase() === "authorization") ?? "authorization";
  headers[authKey] = `${tokenType.charAt(0).toUpperCase()}${tokenType.slice(1)} ${token}`;
  const uid = body?.user_id ?? body?.userId;
  if (uid !== undefined && uid !== null) {
    const uidKey = Object.keys(headers).find((k) => k.toLowerCase() === "mfp-user-id");
    if (uidKey || recipe.appSlug === "myfitnesspal") headers[uidKey ?? "mfp-user-id"] = String(uid);
  }
  scope.session = { ...scope.session, headers };
  await ctx.runMutation(internal.connections.updateSession, { connectionId: conn._id, json: JSON.stringify(scope.session) });
  return true;
}

// MFP answers a stale bearer with 400 "Invalid token", not 401.
export function isAuthFailure(res: { status?: number; body?: string; text?: string }): boolean {
  if (res.status === 401 || res.status === 403) return true;
  const body = res.body ?? res.text ?? "";
  return res.status === 400 && /invalid[ _]token|token (is )?expired|unauthori[sz]ed/i.test(body);
}

// Run one RequestTemplate for a connection with its private session.
export async function executeRequest(
  ctx: Ctx,
  opts: {
    conn: Doc<"connections">;
    recipe: Recipe;
    template: RequestTemplate;
    args: Record<string, unknown>;
    toolName: string;
    executor?: Executor;
    extract?: string;
    emptyOn?: ToolFlags["emptyOn"];
  },
): Promise<ExecResult> {
  const { conn, recipe, template } = opts;
  const executor = opts.executor ?? recipe.executor ?? "cloud";
  if (executor !== "device" && recipe.auth?.type === "login_api") {
    return executeViaRecipeRunner(ctx, { conn, recipe, toolName: opts.toolName, args: opts.args, template });
  }
  if (executor !== "device" && isTemplated(recipe)) {
    return executeTemplated(ctx, { conn, recipe, args: opts.args, template, extract: opts.extract });
  }
  const session = parseSession(conn);
  const scope: RenderScope = { args: opts.args, session, baseUrl: recipe.baseUrl };
  const loginNeeded = needsLogin(recipe, template);

  const attempt = async (forceLogin: boolean) => {
    if (loginNeeded) scope.login = await ensureLogin(ctx, conn, recipe, scope, forceLogin);
    const req = buildRequest(recipe, template, scope, executor === "device");
    if (executor === "device") {
      const res = await deviceFetch(ctx, {
        userId: conn.userId,
        connectionId: conn._id,
        appSlug: conn.appSlug,
        tool: opts.toolName,
        req,
      });
      if (!res) return null;
      return res;
    }
    return await cloudFetch(req);
  };

  let res: { status: number; body: string } | null;
  try {
    res = await attempt(false);
    if (res && (res.status === 401 || res.status === 403) && loginNeeded) {
      res = await attempt(true);
    } else if (res && isAuthFailure(res) && recipe.auth?.refresh && recipe.auth.type !== "login_api") {
      if (await refreshBearer(ctx, conn, recipe, scope, executor)) res = await attempt(false);
    }
  } catch (e) {
    return { ok: false, text: errText(e) };
  }
  // Bot wall on Convex's IPs (Duolingo answers 403 with a blockScript page): retry from the phone,
  // which has the user's own IP and cookies. Needs a real connection (not a public, sessionless call).
  if (res && executor === "cloud" && res.status === 403 && /blockScript/i.test(res.body) && conn.sessionJson) {
    const dev = await deviceFetch(ctx, {
      userId: conn.userId,
      connectionId: conn._id,
      appSlug: conn.appSlug,
      tool: opts.toolName,
      req: buildRequest(recipe, template, scope, true),
    });
    if (dev) res = dev;
  }
  if (!res) {
    return { ok: false, text: "Phone did not answer. Open yuzu on your phone and try again." };
  }
  const empty = (opts.emptyOn ?? []).find(
    (e) => e.status === res!.status && (!e.bodyContains || res!.body.includes(e.bodyContains)),
  );
  if (empty) {
    const value = empty.value === undefined ? [] : empty.value;
    return { ok: true, status: res.status, text: JSON.stringify(value), data: value };
  }
  const parsed = parseBody(res.body);
  const extracted = parsed !== undefined ? extractPath(parsed, opts.extract) : undefined;
  const ok = res.status >= 200 && res.status < 300;
  const text = ok
    ? fitToolText(extracted, toText(extracted, res.body))
    : truncateText(`HTTP ${res.status}: ${truncateText(res.body, 1500)}`);
  return { ok, status: res.status, text, data: extracted };
}

async function executePhone(
  ctx: Ctx,
  opts: { recipe: Recipe; tool: RecipeTool; args: Record<string, unknown> },
): Promise<ExecResult> {
  const app = catalogApp(opts.recipe.appSlug);
  const instruction = (opts.tool.phoneInstruction ?? `${opts.tool.title}: {{args}}`).replace(
    /\{\{\s*([^{}]+?)\s*\}\}/g,
    (_m, name: string) => {
      if (name === "args") return JSON.stringify(opts.args);
      const val = opts.args[name.trim()];
      return val === undefined ? "" : typeof val === "string" ? val : JSON.stringify(val);
    },
  );
  try {
    const out = (await ctx.runAction(revylRunTool, {
      appSlug: opts.recipe.appSlug,
      tool: opts.tool.name,
      instruction,
      args: opts.args,
      revylAppId: app?.revylAppId,
      androidPackage: app?.androidPackage,
    })) as unknown;
    if (typeof out === "string") return { ok: true, text: truncateText(out) };
    const o = (out ?? {}) as { ok?: boolean; text?: string; data?: unknown };
    return {
      ok: o.ok !== false,
      text: truncateText(o.text ?? toText(o.data, "Done.")),
      data: o.data,
    };
  } catch (e) {
    return { ok: false, text: `Cloud phone unavailable: ${errText(e)}` };
  }
}

// Run one recipe tool for a connection.
// ---- outcome handling shared by tool calls and health checks ----

export type Outcome = "ok" | "auth" | "fail" | "transient";

export function classifyResult(res: ExecResult): Outcome {
  // GWT apps answer 200 with an //EX NotLoggedIn exception body.
  if (res.ok && !/^\/\/EX/.test(res.text)) return "ok";
  if (isAuthFailure({ status: res.status, text: res.text }) || /NotLoggedIn|signed you out|session expired|no way to authenticate|auth failed/i.test(res.text)) {
    return "auth";
  }
  if (res.ok) return "fail";
  if (res.status === undefined || res.status === 0 || res.status === 502 || res.status === 503 || res.status === 504 || res.status === 429) {
    return "transient"; // network, timeout, phone offline, gateway, rate limit: not the recipe's fault
  }
  return "fail";
}

function retryable(res: ExecResult): boolean {
  if (res.ok) return false;
  if (res.status === 502 || res.status === 503 || res.status === 504) return true;
  return (res.status === undefined || res.status === 0) && /timed out|fetch failed|network|ECONN|ETIMEDOUT|EAI_AGAIN|socket|terminated|reset/i.test(res.text);
}

export function signedOutText(appSlug: string): string {
  return `${displayName(appSlug)} signed you out. Reconnect it in yuzu.`;
}

// Per recipe version health; never lets bookkeeping break a call.
export async function recordHealth(ctx: Ctx, recipe: Recipe, res: ExecResult): Promise<void> {
  const outcome = classifyResult(res);
  if (outcome === "transient") return;
  try {
    await ctx.runMutation(internal.health.record, {
      appSlug: recipe.appSlug,
      version: recipe.version,
      outcome,
      error: outcome === "fail" ? res.text.slice(0, 200) : undefined,
    });
  } catch (e) {
    console.error("health.record", errText(e));
  }
}

// Run one recipe tool for a connection: one retry for reads on network/5xx gateway errors (never for
// writes), plain signed-out copy, recipe health recorded.
export async function executeTool(
  ctx: Ctx,
  opts: { conn: Doc<"connections">; recipe: Recipe; tool: RecipeTool; args: Record<string, unknown> | undefined },
): Promise<ExecResult> {
  let res = await executeToolOnce(ctx, opts);
  if (opts.tool.kind === "read" && retryable(res)) {
    await sleep(400);
    res = await executeToolOnce(ctx, opts);
  }
  await recordHealth(ctx, opts.recipe, res);
  if (classifyResult(res) === "auth") return { ok: false, status: res.status, text: signedOutText(opts.recipe.appSlug) };
  return res;
}

async function executeToolOnce(
  ctx: Ctx,
  opts: { conn: Doc<"connections">; recipe: Recipe; tool: RecipeTool; args: Record<string, unknown> | undefined },
): Promise<ExecResult> {
  const args = prepareArgs(opts.tool, opts.args, parseSession(opts.conn));
  const toolExecutor = (opts.tool as RecipeTool & { executor?: Executor }).executor;
  const executor: Executor = toolExecutor ?? (opts.tool.request ? opts.recipe.executor ?? "cloud" : "phone");
  if (executor === "phone" || !opts.tool.request) {
    return executePhone(ctx, { recipe: opts.recipe, tool: opts.tool, args });
  }
  if (executor === "cloud" && opts.recipe.auth?.type === "login_api") {
    return executeViaRecipeRunner(ctx, { conn: opts.conn, recipe: opts.recipe, toolName: opts.tool.name, args });
  }
  if (executor === "cloud" && isTemplated(opts.recipe)) {
    return executeTemplated(ctx, { conn: opts.conn, recipe: opts.recipe, args, tool: opts.tool });
  }
  return executeRequest(ctx, {
    conn: opts.conn,
    recipe: opts.recipe,
    template: opts.tool.request,
    args,
    toolName: opts.tool.name,
    executor,
    extract: opts.tool.extract,
    emptyOn: (opts.tool as FlaggedTool).emptyOn,
  });
}

// For testing from the CLI: npx convex run executor:callTool '{"connectionId":"...","tool":"get_diary","args":{}}'
export const callTool = internalAction({
  args: { connectionId: v.id("connections"), tool: v.string(), args: v.optional(v.any()) },
  handler: async (ctx, { connectionId, tool, args }): Promise<ExecResult> => {
    const conn = await ctx.runQuery(internal.connections.get, { connectionId });
    if (!conn) return { ok: false, text: "Unknown connection" };
    const recipeJson = await ctx.runQuery(internal.recipes.at, { slug: conn.appSlug, version: conn.recipeVersion });
    if (!recipeJson) return { ok: false, text: "No recipe" };
    const recipe = JSON.parse(recipeJson) as Recipe;
    const t = recipe.tools.find((x) => x.name === tool);
    if (!t) return { ok: false, text: `No tool ${tool}. Tools: ${recipe.tools.map((x) => x.name).join(", ")}` };
    const res = await executeTool(ctx, { conn, recipe, tool: t, args });
    return { ok: res.ok, status: res.status, text: res.text };
  },
});

// Render a tool's request without sending it (auth headers masked). For debugging recipes:
// npx convex run executor:dryRun '{"slug":"strong","tool":"get_recent_workouts","args":{}}'
export const dryRun = internalAction({
  args: { slug: v.string(), tool: v.string(), args: v.optional(v.any()), session: v.optional(v.any()) },
  handler: async (ctx, { slug, tool, args, session }) => {
    const recipeJson = await ctx.runQuery(internal.recipes.best, { slug });
    if (!recipeJson) return { error: "No recipe" };
    const recipe = JSON.parse(recipeJson) as Recipe;
    const t = recipe.tools.find((x) => x.name === tool);
    if (!t?.request) return { error: `No request tool ${tool}`, tools: recipe.tools.map((x) => x.name) };
    const sess: SessionBundle = session ?? { capturedAt: 0, headers: { authorization: "Bearer TEST" }, storage: {} };
    const a = prepareArgs(t, args, sess);
    const templated = isTemplated(recipe);
    const req = templated
      ? (tmpl.renderRequest(t.request, { ...a, args: a, session: sess, login: { accessToken: "TEST", userId: "USER" }, $page: 1 }, recipe.baseUrl) as BuiltRequest)
      : buildRequest(recipe, t.request, { args: a, session: sess, baseUrl: recipe.baseUrl }, recipe.executor === "device");
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, val]) => [k, /authorization|cookie|token/i.test(k) ? `<${val.length} chars>` : val]),
    );
    return { templated, executor: recipe.executor, method: req.method, url: req.url, headers, body: req.body };
  },
});
