import { v } from "convex/values";
import type { SessionBundle } from "../src/lib/contract";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { resolveApp } from "./lib/appResolver";
import { capturedHeaders, epoch, redactSessionEcho } from "./lib/learningPolicy";
import { writeArguments, writeEndpointUrl, writeMethod, writePreview } from "./lib/learnedWritePolicy";
import { publicToolData } from "./lib/publicToolData";

const INTENT_TTL = 5 * 60_000;
const RUN_TTL = 30_000;
const usable = (c: Doc<"connections"> | null) => c && ["live", "capturing"].includes(c.status) && c.sessionJson;
async function authenticated(ctx: QueryCtx, token: string) {
  const user = token.length >= 16 && token.length <= 256 ? await ctx.db.query("users").withIndex("by_mcpToken", (q) => q.eq("mcpToken", token)).unique() : null;
  if (!user) throw new Error("Authentication required");
  return user;
}

async function definition(ctx: QueryCtx, userId: Doc<"users">["_id"], toolId: string) {
  const id = ctx.db.normalizeId("appLearnedTools", toolId);
  const tool = id ? await ctx.db.get(id) : null;
  const evidence = tool ? await ctx.db.get(tool.evidenceId) : null;
  if (!tool || tool.userId !== userId || tool.kind !== "write" || tool.status !== "published" || !evidence || evidence.userId !== userId || evidence.kind !== "write_endpoint" || evidence.appSlug !== tool.appSlug || evidence.expiresAt <= Date.now() || !evidence.connectionId || !evidence.sessionEpoch || !evidence.requestSchemaJson) throw new Error("Published private write is unavailable");
  const conn = await ctx.db.get(evidence.connectionId);
  if (!usable(conn) || conn!.userId !== userId || conn!.appSlug !== tool.appSlug || await epoch(conn!.sessionJson!) !== evidence.sessionEpoch) throw new Error("App session changed");
  const session = JSON.parse(conn!.sessionJson!) as SessionBundle;
  return { tool, evidence, conn: conn!, session };
}

function rendered(e: Doc<"appLearningEvidence">, args: unknown, session: SessionBundle) {
  const values = writeArguments(e.requestSchemaJson!, args);
  if (JSON.stringify(redactSessionEcho(values, session)) !== JSON.stringify(values)) throw new Error("Credentials cannot be write arguments");
  const method = writeMethod(e.method);
  const url = writeEndpointUrl(e.url, e.origin);
  const body = e.bodyPresent === false ? undefined : JSON.stringify(values);
  const preview = writePreview(method, url, values);
  if (JSON.stringify(redactSessionEcho(preview, session)) !== JSON.stringify(preview)) throw new Error("Captured destination includes session material");
  return { values, request: { method, url, ...(body !== undefined ? { body } : {}) }, preview };
}

function outcome(a: Doc<"approvals">, intent: Doc<"appLearnedWrites">) {
  const receipt = parsedResult(a.resultJson);
  return { status: a.status === "pending" && a.expiresAt > Date.now() ? "approval_required" : a.status === "pending" ? "expired" : a.status,
    approvalId: a._id, preview: JSON.parse(intent.previewJson), executed: receipt?.status === "outcome_uncertain" ? null : receipt?.status === "succeeded",
    ...(a.resultJson ? { result: JSON.parse(a.resultJson) } : {}),
    detail: "Use this exact approval ID to check the result. Do not resubmit or generate a new request ID to retry this action." };
}

function parsedResult(json?: string): { status?: string } | null {
  try { const outer = JSON.parse(json ?? "null"); return typeof outer?.text === "string" ? JSON.parse(outer.text) : null; } catch { return null; }
}

export const request = internalMutation({
  args: { token: v.string(), toolId: v.string(), argsJson: v.string(), requestId: v.string() },
  handler: async (ctx, a) => {
    const user = await authenticated(ctx, a.token);
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(a.requestId) || a.argsJson.length > 16384) throw new Error("Provide a stable requestId for this one logical action");
    const state = await definition(ctx, user._id, a.toolId);
    const { values, request: req, preview } = rendered(state.evidence, JSON.parse(a.argsJson), state.session);
    const visiblePreview = { ...publicToolData({ method: preview.method, path: preview.path }, user.mcpToken), args: publicToolData(preview.args, user.mcpToken) };
    if (JSON.stringify(visiblePreview) !== JSON.stringify(preview)) throw new Error("Write cannot be reviewed completely in one approval");
    const requestJson = JSON.stringify(req);
    const requestHash = await epoch(`${state.tool._id}:${requestJson}`);
    const prior = await ctx.db.query("appLearnedWrites").withIndex("by_user_request", (q) => q.eq("userId", user._id).eq("requestId", a.requestId)).unique();
    if (prior) {
      if (prior.requestHash !== requestHash || prior.toolId !== state.tool._id) throw new Error("This requestId belongs to another exact action");
      const approval = prior.approvalId ? await ctx.db.get(prior.approvalId) : null;
      if (!approval || approval.learnedWriteId !== prior._id || approval.userId !== user._id) throw new Error("Approval unavailable");
      return outcome(approval, prior);
    }
    // Repeated model calls with a fresh ID still resolve to the existing pending,
    // running or uncertain action. A recent confirmed result is reused too.
    const same = await ctx.db.query("appLearnedWrites").withIndex("by_user_hash", (q) => q.eq("userId", user._id).eq("requestHash", requestHash)).order("desc").take(20);
    for (const intent of same) {
      const approval = intent.approvalId ? await ctx.db.get(intent.approvalId) : null;
      if (!approval || approval.userId !== user._id || approval.learnedWriteId !== intent._id) continue;
      const uncertain = parsedResult(approval.resultJson)?.status === "outcome_uncertain";
      if ((approval.status === "pending" && approval.expiresAt > Date.now()) ||
        (approval.status === "approved" && (approval.runState !== "done" || uncertain || Date.now() - intent.createdAt < INTENT_TTL))) return outcome(approval, intent);
    }
    const now = Date.now();
    const expiresAt = Math.min(now + INTENT_TTL, state.evidence.expiresAt);
    const intentId = await ctx.db.insert("appLearnedWrites", { userId: user._id, toolId: state.tool._id, evidenceId: state.evidence._id, connectionId: state.conn._id, sessionEpoch: state.evidence.sessionEpoch!, requestId: a.requestId, requestHash,
      argsJson: JSON.stringify(values), requestJson, previewJson: JSON.stringify(preview), createdAt: now, expiresAt });
    const app = await resolveApp(ctx, state.tool.appSlug);
    const title = `${state.tool.title} in ${app?.name ?? state.tool.appSlug}`;
    const approvalId = await ctx.db.insert("approvals", { userId: user._id, connectionId: state.conn._id, learnedWriteId: intentId, appSlug: state.tool.appSlug, tool: state.tool.name,
      title: state.tool.title, summary: title, argsJson: JSON.stringify(values), assistant: "ycyc", warning: "Changes your app. Approves this exact action once.", status: "pending", createdAt: now, expiresAt });
    const activityId = await ctx.db.insert("activity", { userId: user._id, appSlug: state.tool.appSlug, assistant: "ycyc", tool: state.tool.name, kind: "write", summary: title, status: "pending_approval", approvalId, at: now });
    await ctx.db.patch(approvalId, { activityId });
    await ctx.db.patch(intentId, { approvalId });
    await ctx.scheduler.runAfter(expiresAt - now, internal.approvals.expire, { approvalId });
    await ctx.scheduler.runAfter(expiresAt - now, internal.appLearningWrites.expireUnstarted, { approvalId });
    return outcome((await ctx.db.get(approvalId))!, (await ctx.db.get(intentId))!);
  },
});

// Atomic second gate immediately before transport dispatch. claimRun alone is
// insufficient: this gate also pins the immutable tool/request/session and
// protects against accidental direct internal runner invocation.
export const claimExecution = internalMutation({
  args: { approvalId: v.id("approvals") },
  handler: async (ctx, { approvalId }) => {
    const a = await ctx.db.get(approvalId);
    const intent = a?.learnedWriteId ? await ctx.db.get(a.learnedWriteId) : null;
    if (!a || !intent || intent.approvalId !== a._id || a.userId !== intent.userId || a.connectionId !== intent.connectionId || a.status !== "approved" || a.runState !== "running" || intent.dispatchedAt) return null;
    if (intent.expiresAt <= Date.now() || a.expiresAt <= Date.now()) throw new Error("Approved action expired before dispatch");
    const state = await definition(ctx, intent.userId, intent.toolId);
    if (state.evidence._id !== intent.evidenceId || state.conn._id !== intent.connectionId || state.evidence.sessionEpoch !== intent.sessionEpoch || state.tool.name !== a.tool || state.tool.appSlug !== a.appSlug) throw new Error("Approved tool changed");
    const request = rendered(state.evidence, JSON.parse(intent.argsJson), state.session).request;
    if (JSON.stringify(request) !== intent.requestJson || await epoch(`${state.tool._id}:${intent.requestJson}`) !== intent.requestHash || a.argsJson !== intent.argsJson) throw new Error("Approved arguments changed");
    const headers = capturedHeaders(state.evidence.headerNames.filter((name) => !/idempotency|request-id|nonce|timestamp/i.test(name)), state.session);
    await ctx.db.patch(intent._id, { dispatchedAt: Date.now() });
    await ctx.scheduler.runAfter(RUN_TTL, internal.appLearningWrites.expireRun, { approvalId });
    return { ...request, origin: state.evidence.origin, headersJson: JSON.stringify(headers), sessionJson: JSON.stringify(state.session), capability: (await ctx.db.get(intent.userId))!.mcpToken };
  },
});

async function finish(ctx: MutationCtx, a: Doc<"approvals">, ok: boolean, result: unknown) {
  if (a.runState === "done") return;
  const text = JSON.stringify(result);
  await ctx.db.patch(a._id, { runState: "done", resultJson: JSON.stringify({ ok, text }) });
  if (a.activityId) await ctx.db.patch(a.activityId, { status: ok ? "ok" : "error", detail: ok ? undefined : "Check the action receipt before retrying." });
}

export const finishRun = internalMutation({
  args: { approvalId: v.id("approvals"), ok: v.boolean(), resultJson: v.string() },
  handler: async (ctx, { approvalId, ok, resultJson }) => {
    const a = await ctx.db.get(approvalId);
    if (!a?.learnedWriteId || a.status !== "approved" || a.runState !== "running" || resultJson.length > 48000) return;
    await finish(ctx, a, ok, JSON.parse(resultJson));
  },
});

export const expireRun = internalMutation({
  args: { approvalId: v.id("approvals") },
  handler: async (ctx, { approvalId }) => {
    const a = await ctx.db.get(approvalId);
    if (!a?.learnedWriteId || a.status !== "approved" || a.runState !== "running") return;
    const intent = await ctx.db.get(a.learnedWriteId);
    if (!intent?.dispatchedAt || Date.now() < intent.dispatchedAt + RUN_TTL) return;
    await finish(ctx, a, false, { status: "outcome_uncertain", detail: "The write may have reached the app. Check its state; do not retry this action automatically." });
  },
});

// Covers an action crash/delay after claimRun but before claimExecution. The
// dispatch marker and its watchdog are committed together, so no marker proves
// this particular approved request never entered the write transport.
export const expireUnstarted = internalMutation({
  args: { approvalId: v.id("approvals") },
  handler: async (ctx, { approvalId }) => {
    const a = await ctx.db.get(approvalId);
    if (!a?.learnedWriteId || a.status !== "approved" || a.runState === "done") return;
    const intent = await ctx.db.get(a.learnedWriteId);
    if (!intent || intent.dispatchedAt || intent.expiresAt > Date.now()) return;
    await finish(ctx, a, false, { status: "blocked", detail: "This action expired before dispatch. No app request was sent." });
  },
});

export const runApproved = internalAction({
  args: { approvalId: v.id("approvals") },
  handler: async (ctx, { approvalId }) => {
    let dispatched = false;
    try {
      const claim = await ctx.runMutation(internal.appLearningWrites.claimExecution, { approvalId });
      if (!claim) return;
      dispatched = true;
      const response = await ctx.runAction(internal.learningResearch.writeEndpoint, { url: claim.url, origin: claim.origin, method: claim.method, headersJson: claim.headersJson, ...(claim.body !== undefined ? { bodyJson: claim.body } : {}) });
      const raw: unknown = response.text ? JSON.parse(response.text) : null;
      const data = publicToolData(redactSessionEcho(raw, JSON.parse(claim.sessionJson) as SessionBundle), claim.capability);
      const rejected = raw && typeof raw === "object" && (Object.hasOwn(raw, "ok") && (raw as { ok: unknown }).ok === false || Object.hasOwn(raw, "success") && (raw as { success: unknown }).success === false);
      const ok = response.status >= 200 && response.status < 300 && !rejected;
      const uncertain = response.status >= 500;
      await ctx.runMutation(internal.appLearningWrites.finishRun, { approvalId, ok, resultJson: JSON.stringify({ status: ok ? "succeeded" : uncertain ? "outcome_uncertain" : "rejected", httpStatus: response.status, data,
        detail: ok ? "The app accepted this approved request. Report only the state confirmed by its response." : "Check the app before retrying; this request will not be sent again automatically." }) });
    } catch {
      await ctx.runMutation(internal.appLearningWrites.finishRun, { approvalId, ok: false, resultJson: JSON.stringify({ status: dispatched ? "outcome_uncertain" : "blocked", detail: dispatched ? "The request may have reached the app. Check its state; do not retry automatically." : "The approved action was blocked before dispatch because its session, evidence or arguments changed." }) });
    }
  },
});
