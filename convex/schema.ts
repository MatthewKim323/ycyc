import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Session material, captures, recipes and tool args are stored as JSON strings:
// they can carry keys Convex rejects as field names (JSON Schema "$schema", odd cookie names).

export const connectionStatus = v.union(
  v.literal("needs_login"),
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
  }).index("by_user_status", ["userId", "status"]),

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

  mcpSessions: defineTable({
    sessionId: v.string(),
    userId: v.id("users"),
    clientName: v.optional(v.string()),
    assistant: assistantValidator,
    protocolVersion: v.string(),
    createdAt: v.number(),
  }).index("by_sessionId", ["sessionId"]),
});
