// MCP over Streamable HTTP (JSON responses only, no SSE). One endpoint per user: POST /mcp/<token>.
import type { GenericActionCtx } from "convex/server";
import type { Assistant, Recipe, RecipeTool } from "../../src/lib/contract";
import { internal } from "../_generated/api";
import type { DataModel, Doc } from "../_generated/dataModel";
import { CATALOG, catalogApp, findApp } from "../catalog";
import { executeTool } from "../executor";
import { SITE_URL } from "./env";
import { extractNames, isEmptyResult, receiptFrom, summarizeCall } from "./summaries";

type Ctx = GenericActionCtx<DataModel>;

const SUPPORTED_VERSIONS = ["2025-03-26", "2025-06-18", "2025-11-25", "2026-07-28"];
const NEWEST_VERSION = SUPPORTED_VERSIONS[SUPPORTED_VERSIONS.length - 1];
const APPROVAL_WAIT_MS = 20_000;
const RUN_WAIT_MS = 25_000;
const POLL_MS = 500;
const SEP = "__";

const INSTRUCTIONS =
  `yuzu connects you to the user's consumer apps (${CATALOG.map((a) => a.name).join(", ")}). ` +
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

export function connectUrl(slug: string): string {
  // No token in the link: assistants print it into chats, and the handler does not need it.
  return `${SITE_URL}/connect/${slug}`;
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
      description: "List the apps yuzu can connect, which ones this user has connected, and the tools each one adds.",
      inputSchema: { type: "object", properties: {} },
      annotations: { title: "List apps", readOnlyHint: true, openWorldHint: false },
    },
    {
      name: "connect_app",
      title: "Connect an app",
      description:
        "Get a link that connects one of the user's apps to yuzu. The user opens it on their phone and signs in. " +
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
    {
      name: "check_approval",
      title: "Check an approval",
      description:
        "Check on a write that was waiting for the user's approval. Returns the result if it was approved and ran, or says it was denied or is still waiting.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "The approval id from the earlier reply" } },
        required: ["id"],
      },
      annotations: { title: "Check an approval", readOnlyHint: true, openWorldHint: false },
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
    const app = appInfo(mc, conn.appSlug);
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

// Built-in app, or one the user added from search.
function appInfo(mc: McpContext, slug: string): { slug: string; name: string; blurb: string } | undefined {
  const known = catalogApp(slug);
  if (known) return known;
  return mc.discovered.find((d) => d.slug === slug);
}

function listApps(mc: McpContext, token: string) {
  const extra = mc.discovered.filter((d, i, all) => all.findIndex((x) => x.slug === d.slug) === i);
  const apps = [...CATALOG, ...extra].map((a) => {
    const conn = mc.connections.find((c) => c.appSlug === a.slug);
    const live = mc.live.find((l) => l.conn.appSlug === a.slug);
    const status = live ? "connected" : conn?.status === "building" ? "connecting" : conn?.status === "error" ? "error" : "not connected";
    return {
      app: a.slug,
      name: a.name,
      status,
      can: a.blurb,
      ...(live ? { tools: live.recipe.tools.map((t) => `${a.slug}${SEP}${t.name}`) } : { connectUrl: connectUrl(a.slug) }),
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
  const url = connectUrl(app.slug);
  return textResult(`Open this link on your phone to connect ${app.name} in yuzu: ${url}`);
}

// Wait for the phone's decision, then (if approved) for approvalRunner to store the result.
async function waitForApproval(ctx: Ctx, approvalId: Doc<"approvals">["_id"]): Promise<Doc<"approvals"> | null> {
  const deadline = Date.now() + APPROVAL_WAIT_MS;
  let row: Doc<"approvals"> | null = null;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    row = await ctx.runQuery(internal.approvals.get, { approvalId });
    if (!row || row.status === "denied" || row.status === "expired") return row;
    if (row.status === "approved") break;
  }
  if (row?.status !== "approved") return row;
  // Approved: the run itself may take a while (device relay waits up to 20 s).
  const runDeadline = Date.now() + RUN_WAIT_MS;
  while (Date.now() < runDeadline) {
    if (row?.runState === "done") return row;
    await sleep(POLL_MS);
    row = await ctx.runQuery(internal.approvals.get, { approvalId });
  }
  return row;
}

function approvalOutcome(row: Doc<"approvals"> | null, id: string) {
  if (!row) return textResult("Unknown approval id.", true);
  if (row.status === "approved" && row.runState === "done" && row.resultJson) {
    const r = JSON.parse(row.resultJson) as { ok: boolean; text: string };
    return textResult(r.ok ? `Approved and done. Result: ${r.text}` : `Approved, but it failed: ${r.text}`, !r.ok);
  }
  if (row.status === "approved") return textResult(`Approved and running now. Call check_approval with id ${id} in a few seconds for the result.`);
  if (row.status === "denied") return textResult("The user denied this on their phone. Nothing was changed.", true);
  if (row.status === "expired" || row.expiresAt < Date.now()) {
    return textResult("Nobody approved this in time, so nothing was changed.", true);
  }
  return textResult(`Waiting for approval on the user's phone. Call check_approval with id ${id} in a bit.`);
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
  const app = appInfo(mc, slug);
  const entry = mc.live.find((l) => l.conn.appSlug === slug);
  if (!app) throw new RpcError(-32602, `Unknown tool: ${name}`);
  const pub = entry ? undefined : mc.publicRecipes.find((p) => p.appSlug === slug);
  const pubTool = pub?.recipe.tools.find((t) => t.name === toolName);
  if (pub && pubTool) {
    // No connection needed: run from the cloud without a session.
    const pseudo = { userId: mc.user._id, appSlug: slug, status: "live", createdAt: 0, updatedAt: 0 } as unknown as Doc<"connections">;
    const res = await executeTool(ctx, { conn: pseudo, recipe: pub.recipe, tool: pubTool, args });
    const summary = summarizeCall(slug, pubTool, args);
    if (res.ok) await rememberFrom(ctx, mc.user._id, slug, res.data);
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
      `${app.name} is not connected. Ask the user to open ${connectUrl(slug)} on their phone.`,
      true,
    );
  }
  const { conn, recipe } = entry;
  const tool = recipe.tools.find((t) => t.name === toolName);
  if (!tool) throw new RpcError(-32602, `Unknown tool: ${name}`);
  const names = tool.kind === "write" ? await ctx.runQuery(internal.mcpData.names, { userId: mc.user._id, appSlug: slug }) : {};
  const summary = summarizeCall(slug, tool, args, names);

  if (tool.kind === "write") {
    // "Approve for an hour" grant for this assistant + tool: run now, no prompt.
    const grant = await ctx.runQuery(internal.approvals.activeGrant, {
      userId: mc.user._id,
      assistant,
      appSlug: slug,
      tool: tool.name,
    });
    if (grant) {
      const res = await executeTool(ctx, { conn, recipe, tool, args });
      await ctx.runMutation(internal.activity.log, {
        userId: mc.user._id,
        appSlug: slug,
        assistant,
        tool: tool.name,
        kind: "write",
        summary,
        status: res.ok ? "ok" : "error",
        detail: res.ok ? "Approved for the hour" : res.text.slice(0, 300),
      });
      if (res.ok) await ctx.scheduler.runAfter(0, internal.today.refresh, { userId: mc.user._id });
      if (res.ok && isEmptyResult(res.text)) return textResult(receiptFrom(summary, slug));
      return textResult(res.text || "Failed.", !res.ok);
    }
    const approvalId = await ctx.runMutation(internal.approvals.create, {
      userId: mc.user._id,
      connectionId: conn._id,
      appSlug: slug,
      tool: tool.name,
      title: `${app.name}: ${tool.title}`,
      summary,
      argsJson: JSON.stringify(args ?? {}),
      assistant,
    });
    // Runs once in approvalRunner when the user approves, even after this call returns.
    return approvalOutcome(await waitForApproval(ctx, approvalId), approvalId);
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
  if (res.ok) await rememberFrom(ctx, mc.user._id, slug, res.data);
  return textResult(res.text || (res.ok ? "No data." : "Failed."), !res.ok);
}

// Remember food names / zone numbers from search results so later approvals read plainly.
async function rememberFrom(ctx: Ctx, userId: Doc<"users">["_id"], appSlug: string, data: unknown) {
  try {
    const found = extractNames(data);
    if (Object.keys(found).length) await ctx.runMutation(internal.mcpData.rememberNames, { userId, appSlug, json: JSON.stringify(found) });
  } catch (e) {
    console.error("rememberNames", e instanceof Error ? e.message : String(e));
  }
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
  if (!mc) throw new RpcError(-32001, "Unknown yuzu link. Copy your MCP URL from the yuzu app again.");

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
        serverInfo: { name: "yuzu", title: "yuzu", version: "0.1.0" },
        instructions: INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return listTools(mc);
    case "tools/call": {
      const toolName = String(params.name ?? "");
      try {
        return await (async () => {
          const name = String(params.name ?? "");
          const args = (params.arguments ?? {}) as Record<string, unknown>;
          const session = state.isNewSession ? null : await ctx.runQuery(internal.mcpData.session, { sessionId: state.sessionId });
          const assistant = session?.assistant ?? inferAssistant(undefined, req.headers.get("user-agent"));
          if (name === "list_apps") return listApps(mc, token);
          if (name === "check_approval") {
            const id = String(args.id ?? "");
            return approvalOutcome(await ctx.runQuery(internal.approvals.forUser, { id, userId: mc.user._id }), id);
          }
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
        })();
      } catch (e) {
        if (e instanceof RpcError) throw e;
        // Plain message to the assistant; details stay in the Convex logs.
        console.error("tools/call", toolName, e instanceof Error ? e.stack ?? e.message : String(e));
        return textResult(`Something went wrong running ${toolName}. Try again in a moment.`, true);
      }
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

