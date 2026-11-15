// MCP over Streamable HTTP (JSON responses only, no SSE). One endpoint per user: POST /mcp/<token>.
import type { GenericActionCtx } from "convex/server";
import type { Assistant, Recipe, RecipeTool } from "../../src/lib/contract";
import { internal } from "../_generated/api";
import type { DataModel, Doc } from "../_generated/dataModel";
import { CATALOG, catalogApp, findApp } from "../catalog";
import { executeTool } from "../executor";
import { SITE_URL } from "./env";

type Ctx = GenericActionCtx<DataModel>;

const SUPPORTED_VERSIONS = ["2025-03-26", "2025-06-18", "2025-11-25", "2026-07-28"];
const NEWEST_VERSION = SUPPORTED_VERSIONS[SUPPORTED_VERSIONS.length - 1];
const APPROVAL_WAIT_MS = 20_000;
const POLL_MS = 500;
const SEP = "__";

const INSTRUCTIONS =
  `ycyc connects you to the user's consumer apps (${CATALOG.map((a) => a.name).join(", ")}). ` +
  "Call list_apps to see what is connected. If an app the user mentions is not connected, call connect_app " +
  "and give the user the link to open on their phone. Write actions ask the user to approve on their phone first.";

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

type JsonRpcId = string | number | null;
interface JsonRpcMessage {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

class RpcError extends Error {
  constructor(public code: number, message: string, public data?: unknown) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function randomId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function inferAssistant(clientName: string | undefined, userAgent: string | null): Assistant {
  const s = `${clientName ?? ""} ${userAgent ?? ""}`.toLowerCase();
  if (s.includes("openai") || s.includes("chatgpt")) return "chatgpt";
  if (s.includes("grok") || s.includes("xai")) return "grok";
  if (s.includes("muse")) return "muse";
  if (s.includes("keiki")) return "keiki";
  return "claude";
}

export function connectUrl(slug: string, token: string): string {
  return `${SITE_URL}/connect/${slug}?u=${token}`;
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...headers },
  });
}

function toolSchema(t: RecipeTool): Record<string, unknown> {
  const s = (t.inputSchema ?? {}) as Record<string, unknown>;
  return { ...s, type: "object", properties: (s.properties as object) ?? {} };
}

function argSummary(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  const vals = Object.values(args)
    .filter((v) => v !== undefined && v !== null && v !== "")
    .map((v) => (typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v)))
    .slice(0, 4);
  const s = vals.join(", ");
  return s.length > 90 ? s.slice(0, 87) + "..." : s;
}

function textResult(text: string, isError = false) {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

type McpContext = NonNullable<Awaited<ReturnType<typeof loadContext>>>;

async function loadContext(ctx: Ctx, token: string) {
  const raw = await ctx.runQuery(internal.mcpData.context, { token });
  if (!raw) return null;
  return {
    ...raw,
    live: raw.live.map((l) => ({ conn: l.conn, recipe: JSON.parse(l.recipeJson) as Recipe })),
    publicRecipes: raw.publicRecipes.map((p) => ({ appSlug: p.appSlug, recipe: JSON.parse(p.recipeJson) as Recipe })),
  };
}

function listTools(mc: McpContext) {
  const tools: Record<string, unknown>[] = [
    {
      name: "list_apps",
      title: "List apps",
      description: "List the apps ycyc can connect, which ones this user has connected, and the tools each one adds.",
      inputSchema: { type: "object", properties: {} },
      annotations: { title: "List apps", readOnlyHint: true, openWorldHint: false },
    },
    {
      name: "connect_app",
      title: "Connect an app",
      description:
        "Get a link that connects one of the user's apps to ycyc. The user opens it on their phone and signs in. " +
        `Apps: ${CATALOG.map((a) => a.slug).join(", ")}.`,
      inputSchema: {
        type: "object",
        properties: {
          app: { type: "string", description: `App to connect: ${CATALOG.map((a) => a.slug).join(", ")}` },
        },
        required: ["app"],
      },
      annotations: { title: "Connect an app", readOnlyHint: true, openWorldHint: false },
    },
  ];
  // Sessionless tools work before the app is connected.
  for (const { appSlug, recipe } of mc.publicRecipes) {
    const app = catalogApp(appSlug);
    for (const t of recipe.tools) {
      tools.push({
        name: `${appSlug}${SEP}${t.name}`,
        title: `${app?.name ?? appSlug}: ${t.title}`,
        description: t.description,
        inputSchema: toolSchema(t),
        annotations: { title: `${app?.name ?? appSlug}: ${t.title}`, readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      });
    }
  }
  for (const { conn, recipe } of mc.live) {
    const app = catalogApp(conn.appSlug);
    for (const t of recipe.tools) {
      tools.push({
        name: `${conn.appSlug}${SEP}${t.name}`,
        title: `${app?.name ?? conn.appSlug}: ${t.title}`,
        description: t.description + (t.kind === "write" ? " The user approves this on their phone before it runs." : ""),
        inputSchema: toolSchema(t),
        annotations: {
          title: `${app?.name ?? conn.appSlug}: ${t.title}`,
          readOnlyHint: t.kind === "read",
          destructiveHint: false,
          openWorldHint: true,
        },
      });
    }
  }
  return { tools };
}

function listApps(mc: McpContext, token: string) {
  const apps = CATALOG.map((a) => {
    const conn = mc.connections.find((c) => c.appSlug === a.slug);
    const live = mc.live.find((l) => l.conn.appSlug === a.slug);
    const status = live ? "connected" : conn?.status === "building" ? "connecting" : conn?.status === "error" ? "error" : "not connected";
    return {
      app: a.slug,
      name: a.name,
      status,
      can: a.blurb,
      ...(live ? { tools: live.recipe.tools.map((t) => `${a.slug}${SEP}${t.name}`) } : { connectUrl: connectUrl(a.slug, token) }),
      ...(conn?.status === "error" && conn.error ? { error: conn.error } : {}),
    };
  });
  return textResult(JSON.stringify({ apps }, null, 1));
}

function connectApp(mc: McpContext, token: string, args: Record<string, unknown>) {
  const query = String(args.app ?? "");
  const app = findApp(query);
  if (!app) {
    return textResult(`Unknown app "${query}". Available: ${CATALOG.map((a) => a.slug).join(", ")}.`, true);
  }
  const live = mc.live.find((l) => l.conn.appSlug === app.slug);
  if (live) {
    return textResult(
      `${app.name} is already connected. Tools: ${live.recipe.tools.map((t) => `${app.slug}${SEP}${t.name}`).join(", ")}.`,
    );
  }
  const url = connectUrl(app.slug, token);
  return textResult(`Open this link on your phone to connect ${app.name} in ycyc: ${url}`);
}

async function waitForApproval(ctx: Ctx, approvalId: Doc<"approvals">["_id"]): Promise<"approved" | "denied" | "expired"> {
  const deadline = Date.now() + APPROVAL_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const a = await ctx.runQuery(internal.approvals.get, { approvalId });
    if (!a) return "denied";
    if (a.status === "approved" || a.status === "denied" || a.status === "expired") return a.status;
  }
  const final = await ctx.runMutation(internal.approvals.expire, { approvalId });
  return final === "approved" ? "approved" : final === "denied" ? "denied" : "expired";
}

async function callAppTool(
  ctx: Ctx,
  mc: McpContext,
  token: string,
  assistant: Assistant,
  name: string,
  args: Record<string, unknown>,
) {
  const [slug, toolName] = name.split(SEP);
  const app = catalogApp(slug);
  const entry = mc.live.find((l) => l.conn.appSlug === slug);
  if (!app) throw new RpcError(-32602, `Unknown tool: ${name}`);
  const pub = entry ? undefined : mc.publicRecipes.find((p) => p.appSlug === slug);
  const pubTool = pub?.recipe.tools.find((t) => t.name === toolName);
  if (pub && pubTool) {
    // No connection needed: run from the cloud without a session.
    const pseudo = { userId: mc.user._id, appSlug: slug, status: "live", createdAt: 0, updatedAt: 0 } as unknown as Doc<"connections">;
    const res = await executeTool(ctx, { conn: pseudo, recipe: pub.recipe, tool: pubTool, args });
    const summary = argSummary(args) ? `${pubTool.title}: ${argSummary(args)}` : pubTool.title;
    await ctx.runMutation(internal.activity.log, {
      userId: mc.user._id,
      appSlug: slug,
      assistant,
      tool: pubTool.name,
      kind: "read",
      summary,
      status: res.ok ? "ok" : "error",
      detail: res.ok ? undefined : res.text.slice(0, 300),
    });
    return textResult(res.text || (res.ok ? "No data." : "Failed."), !res.ok);
  }
  if (!entry) {
    return textResult(
      `${app.name} is not connected. Ask the user to open ${connectUrl(slug, token)} on their phone.`,
      true,
    );
  }
  const { conn, recipe } = entry;
  const tool = recipe.tools.find((t) => t.name === toolName);
  if (!tool) throw new RpcError(-32602, `Unknown tool: ${name}`);
  const summary = argSummary(args) ? `${tool.title}: ${argSummary(args)}` : tool.title;

  if (tool.kind === "write") {
    const approvalId = await ctx.runMutation(internal.approvals.create, {
      userId: mc.user._id,
      connectionId: conn._id,
      appSlug: slug,
      tool: tool.name,
      title: `${app.name}: ${tool.title}`,
      summary,
      argsJson: JSON.stringify(args ?? {}),
      assistant,
      ttlMs: APPROVAL_WAIT_MS + 5_000,
    });
    const activityId = await ctx.runMutation(internal.activity.log, {
      userId: mc.user._id,
      appSlug: slug,
      assistant,
      tool: tool.name,
      kind: "write",
      summary,
      status: "pending_approval",
      approvalId,
    });
    const decision = await waitForApproval(ctx, approvalId);
    if (decision !== "approved") {
      await ctx.runMutation(internal.activity.update, {
        activityId,
        status: "denied",
        detail: decision === "expired" ? "No answer on phone" : "Denied on phone",
      });
      return textResult(
        decision === "expired"
          ? `The user did not approve this on their phone within ${APPROVAL_WAIT_MS / 1000} seconds, so nothing was changed. Ask them to open ycyc and try again.`
          : "The user denied this on their phone. Nothing was changed.",
        true,
      );
    }
    const res = await executeTool(ctx, { conn, recipe, tool, args });
    await ctx.runMutation(internal.activity.update, {
      activityId,
      status: res.ok ? "ok" : "error",
      detail: res.ok ? undefined : res.text.slice(0, 300),
    });
    if (res.ok) await ctx.scheduler.runAfter(0, internal.today.refresh, { userId: mc.user._id });
    return textResult(res.text || (res.ok ? "Done." : "Failed."), !res.ok);
  }

  const res = await executeTool(ctx, { conn, recipe, tool, args });
  await ctx.runMutation(internal.activity.log, {
    userId: mc.user._id,
    appSlug: slug,
    assistant,
    tool: tool.name,
    kind: "read",
    summary,
    status: res.ok ? "ok" : "error",
    detail: res.ok ? undefined : res.text.slice(0, 300),
  });
  return textResult(res.text || (res.ok ? "No data." : "Failed."), !res.ok);
}

async function handleMessage(
  ctx: Ctx,
  req: Request,
  token: string,
  msg: JsonRpcMessage,
  state: { sessionId: string; isNewSession: boolean; mc: McpContext | null | undefined },
): Promise<unknown | undefined> {
  const isNotification = msg.id === undefined || msg.id === null;
  if (!msg.method) return undefined; // a response or junk from the client: nothing to answer
  if (isNotification) return undefined;

  const mc = state.mc ?? (state.mc = await loadContext(ctx, token));
  if (!mc) throw new RpcError(-32001, "Unknown ycyc link. Copy your MCP URL from the ycyc app again.");

  const params = (msg.params ?? {}) as Record<string, unknown>;
  switch (msg.method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = SUPPORTED_VERSIONS.includes(requested) ? requested : NEWEST_VERSION;
      const clientInfo = (params.clientInfo ?? {}) as { name?: string; version?: string };
      await ctx.runMutation(internal.mcpData.saveSession, {
        sessionId: state.sessionId,
        userId: mc.user._id,
        clientName: clientInfo.name?.slice(0, 120),
        assistant: inferAssistant(clientInfo.name, req.headers.get("user-agent")),
        protocolVersion,
      });
      return {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "ycyc", title: "ycyc", version: "0.1.0" },
        instructions: INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return listTools(mc);
    case "tools/call": {
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const session = state.isNewSession ? null : await ctx.runQuery(internal.mcpData.session, { sessionId: state.sessionId });
      const assistant = session?.assistant ?? inferAssistant(undefined, req.headers.get("user-agent"));
      if (name === "list_apps") return listApps(mc, token);
      if (name === "connect_app") {
        const out = connectApp(mc, token, args);
        const app = findApp(String(args.app ?? ""));
        await ctx.runMutation(internal.activity.log, {
          userId: mc.user._id,
          appSlug: app?.slug ?? "ycyc",
          assistant,
          tool: "connect_app",
          kind: "read",
          summary: app ? `Asked to connect ${app.name}` : `Asked to connect "${String(args.app ?? "")}"`,
          status: out.isError ? "error" : "ok",
        });
        return out;
      }
      if (!name.includes(SEP)) throw new RpcError(-32602, `Unknown tool: ${name}`);
      return await callAppTool(ctx, mc, token, assistant, name, args);
    }
    case "resources/list":
      return { resources: [] };
    case "resources/templates/list":
      return { resourceTemplates: [] };
    case "prompts/list":
      return { prompts: [] };
    case "logging/setLevel":
      return {};
    default:
      throw new RpcError(-32601, `Method not found: ${msg.method}`);
  }
}

export async function handleMcpPost(ctx: Ctx, req: Request): Promise<Response> {
  const path = new URL(req.url).pathname;
  const token = decodeURIComponent(path.slice("/mcp/".length).split("/")[0] ?? "");
  const incomingSession = req.headers.get("mcp-session-id");
  const state = {
    sessionId: incomingSession || randomId(),
    isNewSession: !incomingSession,
    mc: undefined as McpContext | null | undefined,
  };
  const baseHeaders = { "Mcp-Session-Id": state.sessionId };

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400, baseHeaders);
  }

  const messages = Array.isArray(payload) ? (payload as JsonRpcMessage[]) : [payload as JsonRpcMessage];
  // initialize always starts a fresh session id.
  if (messages.some((m) => m && m.method === "initialize")) {
    state.sessionId = randomId();
    state.isNewSession = true;
    baseHeaders["Mcp-Session-Id"] = state.sessionId;
  }

  const responses: unknown[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object" || (msg.jsonrpc !== undefined && msg.jsonrpc !== "2.0")) {
      responses.push({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
      continue;
    }
    try {
      const result = await handleMessage(ctx, req, token, msg, state);
      if (result !== undefined) responses.push({ jsonrpc: "2.0", id: msg.id, result });
    } catch (e) {
      const err =
        e instanceof RpcError
          ? { code: e.code, message: e.message, ...(e.data !== undefined ? { data: e.data } : {}) }
          : { code: -32603, message: e instanceof Error ? e.message : "Internal error" };
      if (e instanceof RpcError && e.code === -32001) {
        return json({ jsonrpc: "2.0", id: msg.id ?? null, error: err }, 404, baseHeaders);
      }
      if (!(e instanceof RpcError)) console.error("mcp", msg.method, e);
      responses.push({ jsonrpc: "2.0", id: msg.id ?? null, error: err });
    }
  }

  if (responses.length === 0) {
    return new Response(null, { status: 202, headers: { ...CORS_HEADERS, ...baseHeaders } });
  }
  return json(Array.isArray(payload) ? responses : responses[0], 200, baseHeaders);
}

