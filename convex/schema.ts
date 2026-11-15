import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Session material, captures, recipes and tool args are stored as JSON strings:
// they can carry keys Convex rejects as field names (JSON Schema "$schema", odd cookie names).

export const connectionStatus = v.union(
  v.literal("needs_login"),
  v.literal("needs_code"),
  v.literal("capturing"),
  v.literal("building"),
  v.literal("live"),
  v.literal("error"),
);

export const buildStepValidator = v.object({
  key: v.union(
    v.literal("signin"),
    v.literal("capture"),
    v.literal("map"),
    v.literal("generate"),
    v.literal("verify"),
    v.literal("publish"),
  ),
  label: v.string(),
  status: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("done"),
    v.literal("error"),
    v.literal("skipped"),
  ),
  detail: v.optional(v.string()),
  at: v.optional(v.number()),
});

export const assistantValidator = v.union(
  v.literal("claude"),
  v.literal("chatgpt"),
  v.literal("grok"),
  v.literal("muse"),
  v.literal("keiki"),
  v.literal("ycyc"),
);

export const requestValidator = v.object({
  method: v.string(),
  url: v.string(),
  headers: v.record(v.string(), v.string()),
  body: v.optional(v.string()),
});

export default defineSchema({
  users: defineTable({
    deviceId: v.string(),
    mcpToken: v.string(),
    plan: v.union(v.literal("free"), v.literal("pro")),
    createdAt: v.number(),
  })
    .index("by_deviceId", ["deviceId"])
    .index("by_mcpToken", ["mcpToken"]),

  connections: defineTable({
    userId: v.id("users"),
    appSlug: v.string(),
    status: connectionStatus,
    sessionJson: v.optional(v.string()), // SessionBundle, private to this user
    recipeVersion: v.optional(v.number()),
    error: v.optional(v.string()),
    authCacheJson: v.optional(v.string()), // login/refresh response, reused by the executor
    authCacheAt: v.optional(v.number()),
    // MFA in progress: the app's challenge (no credentials), when it started, what to show the user.
    pendingJson: v.optional(v.string()),
    pendingAt: v.optional(v.number()),
    codePrompt: v.optional(v.string()),
    lastHealthyAt: v.optional(v.number()), // last passing auth.check from the health cron
    createdAt: v.number(),
    updatedAt: v.number(),
    liveAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_app", ["userId", "appSlug"]),

  builds: defineTable({
    connectionId: v.id("connections"),
    userId: v.id("users"),
    appSlug: v.string(),
    status: v.union(v.literal("running"), v.literal("done"), v.literal("error")),
    steps: v.array(buildStepValidator),
    recipeVersion: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_connection", ["connectionId"]),

  recipes: defineTable({
    appSlug: v.string(),
    version: v.number(),
    status: v.union(v.literal("draft"), v.literal("verified"), v.literal("broken")),
    compiler: v.string(), // provenance.compiler: heuristic | llm | hand
    json: v.string(), // full Recipe
    toolCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_app", ["appSlug", "version"]),

  captures: defineTable({
    connectionId: v.id("connections"),
    appSlug: v.string(),
    chunk: v.number(),
    count: v.number(),
    bytes: v.number(),
    entriesJson: v.string(), // CaptureEntry[], newest ~300 across all chunks
    createdAt: v.number(),
  }).index("by_connection", ["connectionId", "chunk"]),

  activity: defineTable({
    userId: v.id("users"),
    appSlug: v.string(),
    assistant: assistantValidator,
    tool: v.string(),
    kind: v.union(v.literal("read"), v.literal("write")),
    summary: v.string(),
    status: v.union(
      v.literal("ok"),
      v.literal("error"),
      v.literal("pending_approval"),
      v.literal("denied"),
    ),
    at: v.number(),
    approvalId: v.optional(v.id("approvals")),
    detail: v.optional(v.string()),
  }).index("by_user_at", ["userId", "at"]),

  approvals: defineTable({
    userId: v.id("users"),
    connectionId: v.optional(v.id("connections")),
    appSlug: v.string(),
    tool: v.string(),
    title: v.string(),
    summary: v.string(),
    argsJson: v.string(),
    assistant: assistantValidator,
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("denied"),
      v.literal("expired"),
    ),
    createdAt: v.number(),
    expiresAt: v.number(),
    decidedAt: v.optional(v.number()),
    warning: v.optional(v.string()), // "Charges your card", "Removes it from Cronometer"
    activityId: v.optional(v.id("activity")),
    // Run exactly once after approval, whoever gets there first; result kept for check_approval.
    runState: v.optional(v.union(v.literal("running"), v.literal("done"))),
    resultJson: v.optional(v.string()), // { ok, text }
  }).index("by_user_status", ["userId", "status"]),

  // "Approve for an hour": later matching writes skip the phone prompt until expiresAt.
  approvalGrants: defineTable({
    userId: v.id("users"),
    assistant: assistantValidator,
    appSlug: v.string(),
    tool: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  }).index("by_scope", ["userId", "appSlug", "tool"]),

  // Device relay queue: executor "device" calls run in a hidden WebView on the user's phone.
  calls: defineTable({
    userId: v.id("users"),
    connectionId: v.optional(v.id("connections")),
    appSlug: v.string(),
    tool: v.string(),
    request: requestValidator,
    status: v.union(
      v.literal("queued"),
      v.literal("done"),
      v.literal("expired"),
    ),
    response: v.optional(v.object({ status: v.number(), body: v.string() })),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_user_status", ["userId", "status"]),

  // Per recipe version, across all users: drives "broken" after repeated non-auth failures.
  recipeHealth: defineTable({
    appSlug: v.string(),
    version: v.number(),
    lastOkAt: v.optional(v.number()),
    lastFailAt: v.optional(v.number()),
    consecutiveFailures: v.number(),
    okCount: v.number(),
    failCount: v.number(),
    authFailCount: v.number(),
    lastError: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_app_version", ["appSlug", "version"]),

  // Latest live metrics for the Today screen (needs tool calls, so an action fills it).
  todaySummaries: defineTable({
    userId: v.id("users"),
    date: v.string(), // YYYY-MM-DD in the user's zone
    fuel: v.optional(v.object({ value: v.number(), goal: v.number() })),
    protein: v.optional(v.object({ value: v.number(), goal: v.number() })),
    training: v.optional(v.object({ value: v.number(), goal: v.number() })),
    errors: v.optional(v.array(v.string())),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  mcpSessions: defineTable({
    sessionId: v.string(),
    userId: v.id("users"),
    clientName: v.optional(v.string()),
    assistant: assistantValidator,
    protocolVersion: v.string(),
    createdAt: v.number(),
  }).index("by_sessionId", ["sessionId"]),
});
