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

export const aiProviderValidator = v.union(v.literal("claude"), v.literal("codex"));
export const aiProviderStatusValidator = v.union(
  v.literal("disconnected"), v.literal("starting"), v.literal("authorizing"),
  v.literal("connected"), v.literal("error"),
);
export const aiTurnStatusValidator = v.union(
  v.literal("queued"), v.literal("running"), v.literal("completed"),
  v.literal("error"), v.literal("cancelled"),
);
export const aiEventTypeValidator = v.union(v.literal("text_delta"), v.literal("tool_start"), v.literal("tool_end"));

export default defineSchema({
  // Immutable deployment-admin uploads: public Expo configuration and assets only.
  publicMobilePreviews: defineTable({
    snapshot: v.string(), iosManifestJson: v.string(), androidManifestJson: v.string(), createdAt: v.number(),
  }).index("by_snapshot", ["snapshot"]),

  // Explicit per-user marketplace grants. Uninstalled rows are tombstones so
  // stale connection completions cannot restore access after removal.
  pluginInstallations: defineTable({
    userId: v.id("users"), pluginId: v.string(), epoch: v.string(), version: v.string(),
    status: v.union(v.literal("installed"), v.literal("needs_connection"), v.literal("connecting"), v.literal("error"), v.literal("uninstalled")),
    credentialsCipher: v.optional(v.string()), toolsJson: v.optional(v.string()), errorCode: v.optional(v.string()),
    installedAt: v.number(), updatedAt: v.number(),
  }).index("by_user", ["userId"]).index("by_user_plugin", ["userId", "pluginId"]),

  // Agent learning is private, immutable evidence + versioned tools, never shared recipes.
  appLearningEvidence: defineTable({
    userId: v.id("users"), appSlug: v.string(),
    kind: v.union(v.literal("source"), v.literal("endpoint"), v.literal("write_endpoint")),
    origin: v.string(), url: v.string(),
    method: v.optional(v.string()), requestSchemaJson: v.optional(v.string()), bodyPresent: v.optional(v.boolean()),
    connectionId: v.optional(v.id("connections")), sessionEpoch: v.optional(v.string()),
    headerNames: v.array(v.string()), shapeJson: v.string(),
    createdAt: v.number(), expiresAt: v.number(),
  }).index("by_user_app", ["userId", "appSlug"]),

  appLearnedTools: defineTable({
    userId: v.id("users"), appSlug: v.string(), evidenceId: v.id("appLearningEvidence"),
    name: v.string(), title: v.string(), responsePath: v.string(), inputSchemaJson: v.optional(v.string()),
    kind: v.optional(v.union(v.literal("read"), v.literal("write"))),
    status: v.union(v.literal("draft"), v.literal("verified"), v.literal("published")),
    verifiedAt: v.optional(v.number()), verificationJson: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  // Exact user-approved learned requests. No copied session headers or original
  // capture values: requestJson holds only fixed destination/method + new args.
  appLearnedWrites: defineTable({
    userId: v.id("users"), toolId: v.id("appLearnedTools"), evidenceId: v.id("appLearningEvidence"),
    connectionId: v.id("connections"), sessionEpoch: v.string(),
    requestId: v.string(), requestHash: v.string(), argsJson: v.string(),
    requestJson: v.string(), previewJson: v.string(), approvalId: v.optional(v.id("approvals")),
    createdAt: v.number(), expiresAt: v.number(), dispatchedAt: v.optional(v.number()),
  }).index("by_user_request", ["userId", "requestId"])
    .index("by_user_hash", ["userId", "requestHash"]),

  users: defineTable({
    deviceId: v.string(),
    mcpToken: v.string(),
    plan: v.union(v.literal("free"), v.literal("pro")),
    createdAt: v.number(),
    relaySeenAt: v.optional(v.number()), // phone relay heartbeat (calls.heartbeat)
    // Google sign-in via Clerk (users.linkAccount). Connections follow the account across devices.
    clerkUserId: v.optional(v.string()),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  })
    .index("by_deviceId", ["deviceId"])
    .index("by_mcpToken", ["mcpToken"])
    .index("by_clerkUserId", ["clerkUserId"]),

  // Provider CLIs own their authentication. Persist only sealed credential/code
  // envelopes; public status queries deliberately omit these fields.
  aiProviderSessions: defineTable({
    userId: v.id("users"),
    provider: aiProviderValidator,
    status: aiProviderStatusValidator,
    attemptId: v.optional(v.string()),
    loginUrl: v.optional(v.string()),
    userCode: v.optional(v.string()),
    loginExpiresAt: v.optional(v.number()),
    credentialsCipher: v.optional(v.string()),
    codeCipher: v.optional(v.string()),
    selected: v.boolean(),
    error: v.optional(v.string()),
    updatedAt: v.number(),
    connectedAt: v.optional(v.number()),
  }).index("by_user_provider", ["userId", "provider"]).index("by_user", ["userId"]),

  aiThreads: defineTable({
    userId: v.id("users"), provider: aiProviderValidator, title: v.string(),
    activeTurnId: v.optional(v.id("aiTurns")), nextSeq: v.number(),
    createdAt: v.number(), updatedAt: v.number(),
  }).index("by_user_updated", ["userId", "updatedAt"]),

  aiTurns: defineTable({
    userId: v.id("users"), threadId: v.id("aiThreads"), provider: aiProviderValidator,
    providerSessionId: v.id("aiProviderSessions"), providerAttemptId: v.string(),
    clientMessageId: v.string(), message: v.string(), assistantText: v.string(),
    status: aiTurnStatusValidator, error: v.optional(v.string()),
    eventCount: v.number(), eventBytes: v.number(), outputBytes: v.number(),
    createdAt: v.number(), updatedAt: v.number(), expiresAt: v.number(),
    startedAt: v.optional(v.number()), completedAt: v.optional(v.number()),
  }).index("by_user_client", ["userId", "clientMessageId"])
    .index("by_user_status", ["userId", "status"])
    .index("by_thread_created", ["threadId", "createdAt"]),

  aiEvents: defineTable({
    threadId: v.id("aiThreads"), turnId: v.id("aiTurns"), seq: v.number(),
    type: aiEventTypeValidator, text: v.optional(v.string()),
    name: v.optional(v.string()), id: v.optional(v.string()), createdAt: v.number(),
  }).index("by_thread_seq", ["threadId", "seq"]),

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
    lastRefreshAt: v.optional(v.number()), // last successful session refresh (token, nonce, JWT)
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
    learnedWriteId: v.optional(v.id("appLearnedWrites")),
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

  // id -> label from recent search results (food names, zone numbers), for plain approval summaries.
  lookupNames: defineTable({
    userId: v.id("users"),
    appSlug: v.string(),
    json: v.string(), // Record<string, string>
    updatedAt: v.number(),
  }).index("by_user_app", ["userId", "appSlug"]),

  // Apps added from App Store search ("connect any app"). slug = app_<trackId>; route web.
  discoveredApps: defineTable({
    slug: v.string(),
    trackId: v.number(),
    bundleId: v.optional(v.string()),
    name: v.string(),
    developer: v.optional(v.string()),
    genre: v.optional(v.string()),
    iconUrl: v.optional(v.string()),
    webUrl: v.string(),
    loginUrl: v.string(),
    webOrigin: v.string(),
    blurb: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_trackId", ["trackId"]),

  // App Store search results, 10 minute cache per normalized query.
  searchCache: defineTable({
    key: v.string(),
    json: v.string(),
    at: v.number(),
  }).index("by_key", ["key"]),

  // "Ask for it" on phone-only apps, one per user per app.
  appRequests: defineTable({
    userId: v.id("users"),
    trackId: v.number(),
    name: v.string(),
    createdAt: v.number(),
  }).index("by_track", ["trackId", "userId"]),

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

  // Profile screen (convex/profile.ts). displayName wins over the Google name, which re-link overwrites.
  profiles: defineTable({
    userId: v.id("users"),
    displayName: v.optional(v.string()),
    avatarSeed: v.optional(v.string()),
    prefs: v.optional(
      v.object({
        approvalsDefault: v.optional(v.union(v.literal("ask"), v.literal("hour"))),
        weeklyRecap: v.optional(v.boolean()),
      }),
    ),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),
});
