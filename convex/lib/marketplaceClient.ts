"use node";

import { request as httpsRequest } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { pinnedLookup, resolvePublicAddress, validateResearchUrl, type ResearchTransport } from "./learningHttp";
import { externalPlugin, type ExternalPlugin } from "./marketplaceCatalog";

export type RemotePluginTool = { name: string; description: string; inputSchema: Record<string, unknown> };
export type RemotePluginResult = { content: { type: "text"; text: string }[]; isError: boolean };
export type MarketplaceTransport = { request: ResearchTransport["request"]; resolve?: ResearchTransport["resolve"]; timeoutMs?: number };
const DEFAULT_TRANSPORT: MarketplaceTransport = { request: httpsRequest };
const PROTOCOL = "2025-06-18";
// This client implements the handshake-based revisions. The newer 2026-07-28
// discovery/per-request negotiation is intentionally not claimed as supported.
const VERSIONS = new Set(["2025-03-26", PROTOCOL, "2025-11-25"]);
const MAX_RESPONSE = 512 * 1024;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function reviewed(entry: ExternalPlugin): ExternalPlugin {
  const trusted = externalPlugin(entry?.id);
  if (!trusted || entry.endpoint !== trusted.endpoint || entry.auth !== trusted.auth) throw new Error("marketplace_unreviewed_plugin");
  // Ignore caller-supplied headers/tool lists entirely: only this reviewed copy
  // can select a network destination, transport header or callable tool.
  return trusted;
}
function credentialFor(entry: ExternalPlugin, credential?: string): string | undefined {
  if (credential !== undefined && (typeof credential !== "string" || !/^[A-Za-z0-9._~+/=-]{1,8192}$/.test(credential))) throw new Error("marketplace_invalid_credential");
  if (entry.auth === "none" && credential !== undefined) throw new Error("marketplace_credential_not_supported");
  if (entry.auth === "api_key" && !credential) throw new Error("marketplace_credential_required");
  return credential;
}
function rpcResult(body: Record<string, unknown>): unknown {
  if (Object.hasOwn(body, "error")) {
    const code = record(body.error) ? body.error.code : undefined;
    throw new Error(code === -32602 ? "marketplace_invalid_arguments" : code === -32601 ? "marketplace_tool_unavailable" : "marketplace_remote_error");
  }
  return body.result;
}

// Each POST has its own pinned connection/deadline; no redirects, proxy settings,
// cookies, ambient auth, retry, SSE GET channel or server-initiated tool handler.
async function post(entry: ExternalPlugin, headers: Record<string, string>, payload: Record<string, unknown>, io: MarketplaceTransport) {
  const endpoint = validateResearchUrl(entry.endpoint, new URL(entry.endpoint).origin);
  const data = JSON.stringify(payload);
  if (Buffer.byteLength(data) > 64 * 1024) throw new Error("marketplace_argument_limit");
  const wanted = payload.id;
  const notification = wanted === undefined;
  const timeout = payload.method === "tools/call" ? 45_000 : 20_000;
  return new Promise<{ body?: Record<string, unknown>; session?: string }>((resolve, reject) => {
    let settled = false, bytes = 0, request: ClientRequest | undefined, response: IncomingMessage | undefined;
    const finish = (value?: { body?: Record<string, unknown>; session?: string }, error?: string) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      response?.destroy(); request?.destroy();
      if (error) reject(new Error(error)); else resolve(value ?? {});
    };
    const timer = setTimeout(() => finish(undefined, "marketplace_timeout"), Math.min(io.timeoutMs ?? timeout, timeout));
    resolvePublicAddress(endpoint.hostname, io.resolve).then((pin) => {
      if (settled) return;
      request = io.request(endpoint, { method: "POST", agent: false, maxHeaderSize: 16_384, family: pin.family, autoSelectFamily: false, lookup: pinnedLookup(pin),
        headers: { ...headers, accept: "application/json, text/event-stream", "content-type": "application/json", "accept-encoding": "identity", "content-length": String(Buffer.byteLength(data)) } }, (incoming) => {
        response = incoming;
        if (settled) { incoming.destroy(); return; }
        const status = incoming.statusCode ?? 0;
        if (status >= 300 && status < 400) { finish(undefined, "marketplace_redirect_blocked"); return; }
        if (status === 401) { finish(undefined, headers.authorization ? "marketplace_authentication_failed" : "marketplace_credential_required"); return; }
        if (status === 403) { finish(undefined, "marketplace_access_denied"); return; }
        if (status === 429) { finish(undefined, "marketplace_rate_limited"); return; }
        if (status < 200 || status >= 300) { finish(undefined, status >= 500 ? "marketplace_remote_unavailable" : "marketplace_request_failed"); return; }
        const rawSession = incoming.headers["mcp-session-id"];
        if (rawSession !== undefined && (typeof rawSession !== "string" || !/^[\x21-\x7e]{1,256}$/.test(rawSession))) { finish(undefined, "marketplace_protocol_error"); return; }
        const session = typeof rawSession === "string" ? rawSession : undefined;
        if (notification && (status === 202 || status === 204)) { finish({ session }); return; }
        if (!notification && (status === 202 || status === 204)) { finish(undefined, "marketplace_protocol_error"); return; }
        const type = String(incoming.headers["content-type"] ?? "").split(";", 1)[0]!.trim().toLowerCase();
        const sse = type === "text/event-stream";
        if (!sse && type !== "application/json" && !(notification && !type)) { finish(undefined, "marketplace_unsupported_content"); return; }
        if (incoming.headers["content-encoding"] && incoming.headers["content-encoding"] !== "identity") { finish(undefined, "marketplace_unsupported_encoding"); return; }
        const length = incoming.headers["content-length"];
        if (length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > MAX_RESPONSE)) { finish(undefined, "marketplace_response_limit"); return; }
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let pending = "", eventData: string[] = [], skipLf = false;
        const message = (text: string) => {
          let body: unknown;
          try { body = JSON.parse(text); } catch { finish(undefined, "marketplace_protocol_error"); return; }
          if (record(body) && body.jsonrpc === "2.0" && body.id === wanted && (Object.hasOwn(body, "result") || Object.hasOwn(body, "error"))) finish({ body, session });
        };
        const lines = () => {
          if (skipLf && pending.length) { if (pending[0] === "\n") pending = pending.slice(1); skipLf = false; }
          let newline: number;
          while (!settled && (newline = pending.search(/[\r\n]/)) >= 0) {
            const line = pending.slice(0, newline);
            // Dispatch lone CR immediately, then consume a possible LF in the
            // next chunk without treating that LF as a second line ending.
            skipLf = pending[newline] === "\r" && newline === pending.length - 1;
            pending = pending.slice(newline + (pending[newline] === "\r" && pending[newline + 1] === "\n" ? 2 : 1));
            if (!line) { if (eventData.length) message(eventData.join("\n")); eventData = []; }
            else if (line.startsWith("data:")) eventData.push(line.slice(5).replace(/^ /, ""));
          }
        };
        incoming.on("data", (chunk: Buffer) => {
          if (settled) return;
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE) { finish(undefined, "marketplace_response_limit"); return; }
          try { pending += decoder.decode(chunk, { stream: true }); } catch { finish(undefined, "marketplace_protocol_error"); return; }
          if (sse) lines();
        });
        incoming.on("end", () => {
          if (settled) return;
          try { pending += decoder.decode(); } catch { finish(undefined, "marketplace_protocol_error"); return; }
          if (notification && !pending.trim()) { finish({ session }); return; }
          if (sse) { lines(); if (eventData.length) message(eventData.join("\n")); }
          else message(pending);
          if (!settled) finish(undefined, "marketplace_protocol_error");
        });
        incoming.on("error", () => finish(undefined, "marketplace_connection_failed"));
        incoming.on("aborted", () => finish(undefined, "marketplace_connection_failed"));
      });
      request.on("error", () => finish(undefined, "marketplace_connection_failed"));
      request.end(data);
    }).catch(() => finish(undefined, "marketplace_connection_failed"));
  });
}

// Sessions and credentials are scoped to one invocation, never cached globally,
// persisted, returned to the model, or shared with another install/user/provider.
async function client(entry: ExternalPlugin, credential: string | undefined, io: MarketplaceTransport) {
  const trusted = reviewed(entry), key = credentialFor(trusted, credential);
  let session: string | undefined, protocol = PROTOCOL, id = 0;
  const rpc = async (method: string, params?: unknown, notification = false) => {
    const response = await post(trusted, { ...trusted.headers, ...(key ? { authorization: `Bearer ${key}` } : {}), "MCP-Protocol-Version": protocol,
      ...(session ? { "Mcp-Session-Id": session } : {}) }, { jsonrpc: "2.0", ...(!notification ? { id: ++id } : {}), method, ...(params !== undefined ? { params } : {}) }, io);
    if (response.session) {
      if (session && session !== response.session) throw new Error("marketplace_protocol_error");
      session = response.session;
    }
    return response.body ? rpcResult(response.body) : undefined;
  };
  const init = await rpc("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "yuzu-marketplace", version: "1.0.0" } });
  if (!record(init) || typeof init.protocolVersion !== "string" || !VERSIONS.has(init.protocolVersion)) throw new Error("marketplace_protocol_error");
  protocol = init.protocolVersion;
  await rpc("notifications/initialized", undefined, true);
  const secrets = [key, session].filter((secret): secret is string => !!secret);
  const clean = (text: string) => secrets.reduce((value, secret) => {
    // Servers may echo a header inside serialized JSON text; redact both the
    // raw value and its escaped representation before returning model content.
    return value.split(JSON.stringify(secret).slice(1, -1)).join("[redacted]").split(secret).join("[redacted]");
  }, text);
  const privateMetadata = (text: string) => [key, session].some((secret) => secret && text.includes(JSON.stringify(secret).slice(1, -1)));
  return { trusted, rpc, clean, privateMetadata };
}

export async function remotePluginTools(entry: ExternalPlugin, credential?: string, io: MarketplaceTransport = DEFAULT_TRANSPORT): Promise<RemotePluginTool[]> {
  const connection = await client(entry, credential, io);
  const result = await connection.rpc("tools/list", {});
  if (!record(result) || !Array.isArray(result.tools)) throw new Error("marketplace_protocol_error");
  const tools: RemotePluginTool[] = [], seen = new Set<string>();
  for (const tool of result.tools) {
    if (!record(tool) || typeof tool.name !== "string" || !connection.trusted.allowedTools.includes(tool.name) || seen.has(tool.name)) continue;
    if (!record(tool.inputSchema) || tool.inputSchema.type !== "object") continue;
    const schema = JSON.stringify(tool.inputSchema);
    if (Buffer.byteLength(schema) > 32 * 1024) throw new Error("marketplace_schema_limit");
    const description = typeof tool.description === "string" ? tool.description.slice(0, 4096) : "";
    if (connection.privateMetadata(schema) || connection.privateMetadata(JSON.stringify(description))) throw new Error("marketplace_private_response");
    tools.push({ name: tool.name, description, inputSchema: tool.inputSchema }); seen.add(tool.name);
    if (tools.length >= 30) break;
  }
  return tools;
}

export async function remotePluginCall(entry: ExternalPlugin, tool: string, args: Record<string, unknown>, credential?: string, io: MarketplaceTransport = DEFAULT_TRANSPORT): Promise<RemotePluginResult> {
  const trusted = reviewed(entry);
  if (!trusted.allowedTools.includes(tool)) throw new Error("marketplace_tool_not_allowed");
  if (!record(args)) throw new Error("marketplace_invalid_arguments");
  let encoded: string;
  try { encoded = JSON.stringify(args); } catch { throw new Error("marketplace_invalid_arguments"); }
  if (Buffer.byteLength(encoded) > 32 * 1024) throw new Error("marketplace_argument_limit");
  const connection = await client(trusted, credential, io);
  const result = await connection.rpc("tools/call", { name: tool, arguments: args });
  if (!record(result) || !Array.isArray(result.content)) throw new Error("marketplace_protocol_error");
  const content = result.content.filter((block): block is Record<string, unknown> => record(block) && block.type === "text" && typeof block.text === "string")
    .slice(0, 32).map((block) => ({ type: "text" as const, text: connection.clean(block.text as string) }));
  return { content, isError: result.isError === true };
}
