// Private evidence-driven tool learning. Native agents have no arbitrary fetch,
// code execution or credential access: all operations enter through this module.
import { v } from "convex/values";
import type { CaptureEntry, SessionBundle } from "../src/lib/contract";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, type ActionCtx, type QueryCtx } from "./_generated/server";
import { SITE_URL } from "./lib/env";
import { capturedHeaders, endpointUrl, epoch, parameterizedUrl, querySchema, redactSessionEcho, responseAt, safePath, valueShape } from "./lib/learningPolicy";
import { publicToolData } from "./lib/publicToolData";
import { capturedWriteSchema, writeArguments, writeEndpointUrl, writeMethod, writePreview } from "./lib/learnedWritePolicy";

const DAY = 86_400_000;
const safeName = (s: unknown) => typeof s === "string" && /^[a-z][a-z0-9_]{1,47}$/.test(s);
const sessionUsable = (conn: { status: string } | null) => !!conn && (conn.status === "live" || conn.status === "capturing");
async function owner(ctx: QueryCtx, token: string) {
  const user = token.length >= 16 && token.length <= 256 ? await ctx.db.query("users").withIndex("by_mcpToken", (q) => q.eq("mcpToken", token)).unique() : null;
  if (!user) throw new Error("Authentication required");
  return user;
}

export const context = internalQuery({
  args: { token: v.string(), app: v.optional(v.string()), toolId: v.optional(v.string()), evidenceId: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await owner(ctx, a.token);
    const toolId = a.toolId ? ctx.db.normalizeId("appLearnedTools", a.toolId) : null;
    const learned = toolId ? await ctx.db.get(toolId) : null;
    if (a.toolId && (!learned || learned.userId !== user._id)) throw new Error("Unknown private tool");
    const evidenceId = learned?.evidenceId ?? (a.evidenceId ? ctx.db.normalizeId("appLearningEvidence", a.evidenceId) : null);
    const evidence = evidenceId ? await ctx.db.get(evidenceId) : null;
    if ((a.evidenceId || learned) && (!evidence || evidence.userId !== user._id || (a.app && evidence.appSlug !== a.app))) throw new Error("Unknown private evidence");
    const appSlug = learned?.appSlug ?? evidence?.appSlug ?? a.app;
    const conn = appSlug ? await ctx.db.query("connections").withIndex("by_user_app", (q) => q.eq("userId", user._id).eq("appSlug", appSlug)).first() : null;
    return { userId: user._id, conn, learned, evidence };
  },
});

export const list = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await owner(ctx, token);
    const rows = await ctx.db.query("appLearnedTools").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").take(200);
    const result = [];
    for (const row of rows) {
      const e = await ctx.db.get(row.evidenceId);
      if (!e || e.expiresAt <= Date.now()) continue;
      result.push({ toolId: row._id, app: row.appSlug, name: row.name, title: row.title, kind: row.kind ?? "read", status: row.status, inputSchema: row.inputSchemaJson ? JSON.parse(row.inputSchemaJson) : { type: "object", properties: {}, additionalProperties: false } });
    }
    return result;
  },
});

export const saveEvidence = internalMutation({
  args: {
    token: v.string(), app: v.string(), origin: v.string(),
    observations: v.array(v.object({ kind: v.union(v.literal("source"), v.literal("endpoint"), v.literal("write_endpoint")), url: v.string(), shapeJson: v.string(), headerNames: v.array(v.string()), method: v.optional(v.string()), requestSchemaJson: v.optional(v.string()), bodyPresent: v.optional(v.boolean()) })),
    connectionId: v.optional(v.id("connections")), sessionEpoch: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const user = await owner(ctx, a.token);
    if (a.observations.length > 40) throw new Error("Observation limit");
    if (a.connectionId) {
      const conn = await ctx.db.get(a.connectionId);
      if (!conn || !sessionUsable(conn) || conn.userId !== user._id || conn.appSlug !== a.app || !conn.sessionJson || await epoch(conn.sessionJson) !== a.sessionEpoch) throw new Error("App session changed; inspect again");
    }
    const allPrior = await ctx.db.query("appLearningEvidence").withIndex("by_user_app", (q) => q.eq("userId", user._id).eq("appSlug", a.app)).order("desc").take(200);
    const prior = allPrior.filter((p) => p.expiresAt > Date.now());
    for (const p of allPrior) if (p.expiresAt <= Date.now()) await ctx.db.delete(p._id);
    const keys = new Map(prior.map((p) => [`${p.kind}|${p.method ?? ""}|${p.url}|${p.sessionEpoch ?? ""}|${p.requestSchemaJson ?? ""}|${p.bodyPresent ?? ""}`, p._id]));
    const out = [];
    for (const e of a.observations) {
      if (e.shapeJson.length > 12000 || e.headerNames.length > 40) throw new Error("Observation limit");
      const u = new URL(e.url);
      if (u.origin !== a.origin || u.protocol !== "https:" || u.username || Boolean(u.password) || u.port) throw new Error("Invalid observation origin");
      if (e.kind === "endpoint") endpointUrl(e.url, a.origin);
      if (e.kind === "write_endpoint") {
        if (!a.connectionId || !a.sessionEpoch || !e.requestSchemaJson || e.requestSchemaJson.length > 16384) throw new Error("Write evidence needs an owned capture and request schema");
        writeEndpointUrl(e.url, a.origin); writeMethod(e.method);
      }
      const key = `${e.kind}|${e.method ?? ""}|${e.url}|${a.sessionEpoch ?? ""}|${e.requestSchemaJson ?? ""}|${e.bodyPresent ?? ""}`;
      let id = keys.get(key);
      if (!id) {
        if (keys.size >= 200) throw new Error("Learning limit reached for this app");
        id = await ctx.db.insert("appLearningEvidence", {
          userId: user._id, appSlug: a.app, kind: e.kind, origin: a.origin, url: e.url,
          shapeJson: e.shapeJson, headerNames: e.headerNames,
          ...(e.kind === "write_endpoint" ? { method: e.method, requestSchemaJson: e.requestSchemaJson, bodyPresent: e.bodyPresent } : {}),
          ...(a.connectionId ? { connectionId: a.connectionId, sessionEpoch: a.sessionEpoch } : {}),
          createdAt: Date.now(), expiresAt: Date.now() + (e.kind === "source" ? DAY : 7 * DAY),
        });
        keys.set(key, id);
      }
      out.push({ evidenceId: id, kind: e.kind, path: safePath(e.url), responseShape: JSON.parse(e.shapeJson), ...(e.kind === "endpoint" ? { inputSchema: querySchema(e.url) } : {}), ...(e.kind === "write_endpoint" ? { method: e.method, requestSchema: JSON.parse(e.requestSchemaJson!) } : {}) });
    }
    return out;
  },
});

export const build = internalMutation({
  args: { token: v.string(), app: v.string(), evidenceId: v.string(), name: v.string(), title: v.string(), responsePath: v.string(), kind: v.optional(v.union(v.literal("read"), v.literal("write"))) },
  handler: async (ctx, a) => {
    const user = await owner(ctx, a.token);
    if (!safeName(a.name) || !/^[\p{L}\p{N} ,:()'_-]{2,80}$/u.test(a.title)) throw new Error("Use a short tool name and title");
    // Validate syntax and sensitive keys even if the response does not exist yet.
    const path = a.responsePath;
    if (!/^(?:[A-Za-z_][A-Za-z0-9_]{0,47}(?:\.[A-Za-z_][A-Za-z0-9_]{0,47}){0,5})?$/.test(path) || /token|secret|password|credential|cookie|authorization|__proto__|constructor|prototype/i.test(path)) throw new Error("Invalid response path");
    const id = ctx.db.normalizeId("appLearningEvidence", a.evidenceId);
    const e = id ? await ctx.db.get(id) : null;
    const kind = a.kind ?? "read";
    if (!e || e.userId !== user._id || e.appSlug !== a.app || e.kind !== (kind === "write" ? "write_endpoint" : "endpoint") || e.expiresAt <= Date.now()) throw new Error("Choose current endpoint evidence from this app");
    if (kind === "write") {
      if (!e.connectionId || !e.sessionEpoch || !e.requestSchemaJson || a.responsePath) throw new Error("Writes need an owned captured schema and no responsePath");
      writeEndpointUrl(e.url, e.origin); writeMethod(e.method);
    } else endpointUrl(e.url, e.origin);
    const allPrior = await ctx.db.query("appLearnedTools").withIndex("by_user", (q) => q.eq("userId", user._id)).take(200);
    const prior = [];
    for (const tool of allPrior) {
      const evidence = await ctx.db.get(tool.evidenceId);
      if (!evidence || evidence.expiresAt <= Date.now()) await ctx.db.delete(tool._id);
      else prior.push(tool);
    }
    const duplicate = prior.find((p) => p.evidenceId === e._id && p.name === a.name && p.title === a.title && p.responsePath === path);
    if (duplicate) return { toolId: duplicate._id, status: duplicate.status };
    if (prior.length >= 200) throw new Error("Private tool limit reached");
    const toolId = await ctx.db.insert("appLearnedTools", { userId: user._id, appSlug: a.app, evidenceId: e._id, name: a.name, title: a.title, responsePath: path, kind, inputSchemaJson: kind === "write" ? e.requestSchemaJson : JSON.stringify(querySchema(e.url)), status: "draft", createdAt: Date.now() });
    return { toolId, status: "draft" };
  },
});

export const recordVerification = internalMutation({
  args: { token: v.string(), toolId: v.id("appLearnedTools"), epoch: v.optional(v.string()), receiptJson: v.string() },
  handler: async (ctx, a) => {
    const user = await owner(ctx, a.token);
    const t = await ctx.db.get(a.toolId);
    const e = t ? await ctx.db.get(t.evidenceId) : null;
    if (!t || !e || t.userId !== user._id || e.userId !== user._id || e.expiresAt <= Date.now()) throw new Error("Private tool expired");
    if (e.connectionId) {
      const c = await ctx.db.get(e.connectionId);
      if (!c || !sessionUsable(c) || c.userId !== user._id || !c.sessionJson || await epoch(c.sessionJson) !== a.epoch || a.epoch !== e.sessionEpoch) throw new Error("App session changed during verification");
    }
    if (a.receiptJson.length > 12000) throw new Error("Receipt limit");
    await ctx.db.patch(t._id, { status: t.status === "published" ? "published" : "verified", verifiedAt: Date.now(), verificationJson: a.receiptJson });
  },
});

export const publish = internalMutation({
  args: { token: v.string(), toolId: v.string() },
  handler: async (ctx, a) => {
    const user = await owner(ctx, a.token);
    const id = ctx.db.normalizeId("appLearnedTools", a.toolId);
    const t = id ? await ctx.db.get(id) : null;
    const e = t ? await ctx.db.get(t.evidenceId) : null;
    if (!t || !e || t.userId !== user._id || e.userId !== user._id) throw new Error("Unknown private tool");
    if (e.expiresAt <= Date.now() || !t.verifiedAt || Date.now() - t.verifiedAt > 10 * 60_000 || !t.verificationJson || t.status === "draft") throw new Error("Verify this exact tool before publishing");
    if (e.connectionId) {
      const c = await ctx.db.get(e.connectionId);
      if (!c || !sessionUsable(c) || c.userId !== user._id || !c.sessionJson || await epoch(c.sessionJson) !== e.sessionEpoch) throw new Error("App session changed; inspect again");
    }
    await ctx.db.patch(t._id, { status: "published" });
    return { toolId: t._id, status: "published", kind: t.kind ?? "read", private: true, ...(t.kind === "write" ? { requiresApproval: true } : {}) };
  },
});

type Observation = { kind: "source" | "endpoint" | "write_endpoint"; url: string; shapeJson: string; headerNames: string[]; method?: string; requestSchemaJson?: string; bodyPresent?: boolean };
async function inspectCapture(ctx: ActionCtx, token: string, app: string) {
  const state = await ctx.runQuery(internal.appLearning.context, { token, app });
  const resolved = await ctx.runQuery(internal.apps.resolve, { slug: app });
  const conn = state.conn;
  if (!resolved?.webOrigin || !conn?.sessionJson || !sessionUsable(conn)) return { status: "needs_login", connectUrl: `${SITE_URL}/connect/${app}`, detail: "Open the app, sign in and browse the screens needed for this task, then inspect again." };
  const entries: CaptureEntry[] = await ctx.runQuery(internal.connections.captureEntries, { connectionId: conn._id });
  const observations: Observation[] = [];
  for (const e of entries.slice(-300)) {
    if (observations.length >= 40) break;
    if (!e.status || e.status < 200 || e.status >= 300) continue;
    try {
      if (["POST", "PUT", "PATCH", "DELETE"].includes(e.method)) {
        const mime = Object.entries(e.reqHeaders ?? {}).find(([name]) => name.toLowerCase() === "content-type")?.[1];
        if (e.reqBody && !/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i.test(mime ?? "")) continue;
        observations.push({ kind: "write_endpoint", url: writeEndpointUrl(e.url, resolved.webOrigin), method: writeMethod(e.method), requestSchemaJson: capturedWriteSchema(e.reqBody), bodyPresent: !!e.reqBody?.trim(),
          shapeJson: e.resBody ? JSON.stringify(valueShape(JSON.parse(e.resBody))) : '"empty response"', headerNames: Object.keys(e.reqHeaders ?? {}).slice(0, 40) });
        continue;
      }
      if (e.method !== "GET" || !e.resBody) continue;
      const url = endpointUrl(e.url, resolved.webOrigin);
      const body: unknown = JSON.parse(e.resBody);
      if (!body || typeof body !== "object") continue;
      observations.push({ kind: "endpoint", url, shapeJson: JSON.stringify(valueShape(body)), headerNames: Object.keys(e.reqHeaders ?? {}).slice(0, 40) });
    } catch { /* Unsupported/foreign/security/financial operations are omitted. */ }
  }
  const evidence = await ctx.runMutation(internal.appLearning.saveEvidence, { token, app, origin: resolved.webOrigin, connectionId: conn._id, sessionEpoch: await epoch(conn.sessionJson), observations });
  return { app, status: evidence.length ? "evidence_ready" : "needs_capture", evidence, detail: evidence.length ? "Only schemas and endpoint identifiers are shown. Build a matching read or write tool from an evidenceId. Write verification is a local structural dry run; every actual write needs exact-action approval." : "No supported same-origin JSON reads/writes observed. Browse the relevant screen and capture again. Cross-origin APIs, payments and login exchanges need a reviewed connector." };
}

async function readTool(ctx: ActionCtx, token: string, toolId: string, verify: boolean, args: Record<string, unknown> = {}) {
  const state = await ctx.runQuery(internal.appLearning.context, { token, toolId });
  const t = state.learned!;
  const e = state.evidence!;
  const write = t.kind === "write";
  if (e.kind !== (write ? "write_endpoint" : "endpoint") || e.expiresAt <= Date.now()) throw new Error("Evidence expired; investigate again");
  if (!verify && t.status !== "published") throw new Error("Verify and publish this tool before use");
  let headers: Record<string, string> = { accept: "application/json" };
  let session: SessionBundle | undefined;
  if (e.connectionId) {
    if (!state.conn || !sessionUsable(state.conn) || state.conn._id !== e.connectionId || !state.conn.sessionJson || await epoch(state.conn.sessionJson) !== e.sessionEpoch) throw new Error("App session changed; inspect the capture again");
    session = JSON.parse(state.conn.sessionJson) as SessionBundle;
    headers = capturedHeaders(e.headerNames, session);
  }
  if (write) {
    if (!verify || !e.requestSchemaJson || !e.connectionId) throw new Error("Writes must enter the approval path");
    const validated = writeArguments(e.requestSchemaJson, args);
    if (JSON.stringify(redactSessionEcho(validated, session)) !== JSON.stringify(validated)) throw new Error("Session material cannot be an action argument");
    const preview = writePreview(writeMethod(e.method), writeEndpointUrl(e.url, e.origin), validated);
    const receipt = { ok: true, kind: "write", validation: "structural_only", executed: false, toolId: t._id, checkedAt: Date.now() };
    await ctx.runMutation(internal.appLearning.recordVerification, { token, toolId: t._id, epoch: e.sessionEpoch, receiptJson: JSON.stringify(receipt) });
    return { ...receipt, preview, detail: "Dry run only: method, captured schema and new arguments are valid. No app request was sent and live success is unproven. Publishing enables approval requests, never automatic execution." };
  }
  const res: { status: number; text: string } = await ctx.runAction(internal.learningResearch.readEndpoint, { url: parameterizedUrl(e.url, e.origin, args), origin: e.origin, headersJson: JSON.stringify(headers) });
  if (res.status < 200 || res.status >= 300) return { ok: false, status: res.status, detail: res.status === 401 || res.status === 403 ? "Sign in to the app again." : "Read endpoint did not pass verification." };
  const body: unknown = JSON.parse(res.text);
  const selected = responseAt(body, t.responsePath);
  if (selected === undefined || selected === null || typeof selected !== "object") throw new Error("Expected a JSON object or array at the selected path");
  // Re-read after the network operation; disconnect/re-login revokes the old
  // snapshot before either publishing a receipt or exposing a response.
  const fresh = await ctx.runQuery(internal.appLearning.context, { token, toolId });
  if (!fresh.evidence || fresh.evidence.expiresAt <= Date.now()) throw new Error("Evidence expired during read");
  if (e.connectionId && (!fresh.conn?.sessionJson || !sessionUsable(fresh.conn) || fresh.conn._id !== e.connectionId || await epoch(fresh.conn.sessionJson) !== e.sessionEpoch)) throw new Error("App session changed during read");
  const receipt = { ok: true, toolId: t._id, kind: "read", status: res.status, responseShape: valueShape(selected), checkedAt: Date.now() };
  if (verify) {
    await ctx.runMutation(internal.appLearning.recordVerification, { token, toolId: t._id, epoch: e.sessionEpoch, receiptJson: JSON.stringify(receipt) });
    return { ...receipt, detail: "Real endpoint responded; no response values are included in verification. Publish this immutable tool to enable reads." };
  }
  // Only actual user-requested reads expose bounded app data. Never expose
  // session material if an app echoes one of its credentials in a response.
  return { ok: true, toolId: t._id, data: publicToolData(redactSessionEcho(selected, session), token) };
}

async function investigate(ctx: ActionCtx, token: string, app: string, sourceId?: string) {
  if (/^app_\d{1,12}$/.test(app)) await ctx.runAction(internal.apps.addCustomForLearning, { trackId: Number(app.slice(4)) });
  let website: URL | undefined;
  if (app.startsWith("https://")) {
    website = new URL(app);
    if (website.username || Boolean(website.password) || website.port || website.search || website.hash || /[{}\\\r\n]/.test(app)) throw new Error("Use a public HTTPS website without credentials or query parameters");
  }
  const resolved = website ? { webOrigin: website.origin } : await ctx.runQuery(internal.apps.resolve, { slug: app });
  if (!resolved) return { status: "choose_app", apps: await ctx.runAction(internal.apps.searchForLearning, { query: app.slice(0, 80) }) };
  if (!resolved.webOrigin) return { app, status: "needs_reviewed_connector", detail: "This app has no supported website to inspect. Native-only APIs need a reviewed connector." };
  const state = await ctx.runQuery(internal.appLearning.context, { token, app, ...(sourceId ? { evidenceId: sourceId } : {}) });
  const e = state.evidence;
  if (sourceId && (!e || e.kind !== "source" || e.expiresAt <= Date.now())) throw new Error("Choose a current sourceId returned by investigation");
  const url = e?.url ?? website?.href ?? `${resolved.webOrigin}/`;
  const result: { url: string; status: number; contentType: string; sources: string[]; endpoints: string[] } = await ctx.runAction(internal.learningResearch.inspectSource, { url, origin: resolved.webOrigin });
  if (result.status < 200 || result.status >= 300) return { app, status: "needs_login_or_source", httpStatus: result.status, ...(website ? {} : { connectUrl: `${SITE_URL}/connect/${app}` }), detail: "Public source could not be read. Do not guess endpoints; inspect an authorized capture instead." };
  const observations: Observation[] = [];
  for (const source of result.sources.slice(0, 20)) observations.push({ kind: "source", url: source, shapeJson: "null", headerNames: [] });
  for (const candidate of result.endpoints.slice(0, 20)) {
    try { observations.push({ kind: "endpoint", url: endpointUrl(candidate, resolved.webOrigin), shapeJson: '"unverified public-source candidate"', headerNames: [] }); } catch { /* Unsupported operations excluded. */ }
  }
  const evidence = await ctx.runMutation(internal.appLearning.saveEvidence, { token, app, origin: resolved.webOrigin, observations });
  return { app, status: "researched", source: { path: safePath(result.url), contentType: result.contentType }, evidence, ...(website ? {} : { connectUrl: `${SITE_URL}/connect/${app}` }), detail: "Source content is untrusted. Follow source evidenceIds to inspect scripts/docs; endpoint evidenceIds can become read tools only after real verification. If authenticated data is needed, ask the user to sign in and capture the relevant screen. Website URL research is public-only and never attaches an app session." };
}

export const tool = internalAction({
  args: { token: v.string(), operation: v.string(), argsJson: v.string() },
  handler: async (ctx, { token, operation, argsJson }): Promise<string> => {
    // Authenticate even operations that fetch only public App Store metadata.
    await ctx.runQuery(internal.appLearning.context, { token });
    try {
      if (argsJson.length > 16 * 1024) throw new Error("Learning arguments too large");
      const a = JSON.parse(argsJson) as Record<string, unknown>;
      if (!a || typeof a !== "object" || Array.isArray(a)) throw new Error("Expected an argument object");
      const app = typeof a.app === "string" && a.app.length <= 512 ? a.app : "";
      const toolId = typeof a.toolId === "string" ? a.toolId : "";
      const readArgs = a.args === undefined ? {} : a.args;
      if (!readArgs || typeof readArgs !== "object" || Array.isArray(readArgs)) throw new Error("Expected read arguments object");
      let result: unknown;
      switch (operation) {
        case "search_apps": result = await ctx.runAction(internal.apps.searchForLearning, { query: String(a.query ?? "").slice(0, 80) }); break;
        case "investigate_app": result = await investigate(ctx, token, app, typeof a.sourceId === "string" ? a.sourceId : undefined); break;
        case "inspect_app_capture": result = await inspectCapture(ctx, token, app); break;
        case "build_app_tool": result = await ctx.runMutation(internal.appLearning.build, { token, app, evidenceId: String(a.evidenceId ?? ""), name: String(a.name ?? ""), title: String(a.title ?? ""), responsePath: String(a.responsePath ?? ""), ...(a.kind === "write" ? { kind: "write" as const } : {}) }); break;
        case "verify_app_tool": result = await readTool(ctx, token, toolId, true, readArgs as Record<string, unknown>); break;
        case "publish_app_tool": result = await ctx.runMutation(internal.appLearning.publish, { token, toolId }); break;
        case "call_learned_tool": {
          const state = await ctx.runQuery(internal.appLearning.context, { token, toolId });
          result = state.learned?.kind === "write" ? await ctx.runMutation(internal.appLearningWrites.request, { token, toolId, argsJson: JSON.stringify(readArgs), requestId: String(a.requestId ?? "") }) : await readTool(ctx, token, toolId, false, readArgs as Record<string, unknown>);
          break;
        }
        default: throw new Error("Unknown learning operation");
      }
      // Inspection results are constructed metadata, never raw captures/source
      // text. Actual read values were already scrubbed/bounded in readTool.
      // Preserve complete schemas rather than truncating individual fields.
      const output = JSON.stringify(result).split(token).join("[redacted]");
      if (new TextEncoder().encode(output).byteLength > 48 * 1024) throw new Error("Learning result too large");
      return output;
    } catch {
      // Never relay fetch errors or request URLs: they may contain private IDs.
      return JSON.stringify({ ok: false, status: "learning_blocked", detail: "This step could not be completed safely. Use current evidence from the selected app; sign in/capture again if its session changed. Unsupported endpoints need a reviewed connector. No tool was published by this failed step." });
    }
  },
});
