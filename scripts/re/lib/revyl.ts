// Minimal Revyl REST client (cloud Android/iOS devices driven by plain-English steps).
// Mapped from the open-source CLI (github.com/RevylAI/revyl-cli: internal/api/client.go,
// internal/mcp/device_session.go). Pure fetch, no Node imports: used by convex/revyl.ts and
// by scripts/re/revyl-smoke.ts.
//
// Flow: GET build -> POST start_device -> poll worker-connection -> poll proxy health ->
//       POST device-proxy/<run>/launch -> POST device-proxy/<run>/execute_step (instruction |
//       extract), poll step_status/<id> when accepted -> POST device/sessions/<id>/stop.

import type { CaptureEntry, SessionBundle } from "../../../src/lib/contract";
import { parse as domainInfo } from "tldts";
import { isApprovedNativeOrigin, validateNativeOriginPattern } from "../../../convex/lib/nativeOrigins";

export const REVYL_API = "https://backend.revyl.ai";
export const REVYL_APP = "https://app.revyl.ai";

export interface RevylSession {
  sessionId: string;
  workflowRunId: string;
  viewerUrl: string;
  packageName?: string;
}

export interface StepResult {
  ok: boolean;
  text: string; // extract: extracted information; instruction: agent's description of what it did
  raw?: unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RevylClient {
  constructor(
    private apiKey: string,
    private base = REVYL_API,
    private options: { artifactText?: (url: string, signal: AbortSignal) => Promise<string> } = {},
  ) {
    if (!apiKey) throw new Error("REVYL_API_KEY is not set");
  }

  private async req(method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<{ status: number; json: any; text: string }> {
    return networkDeadline(timeoutMs, async (signal) => {
      let res: Response;
      try {
        res = await fetch(this.base + path, {
          method, signal, redirect: "error",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "X-Revyl-Client": "cli",
            "User-Agent": "revyl-cli/0.2.12", // backend answers 426 to unknown client versions
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch { throw new Error("revyl_request_failed"); }
      let text: string;
      try { text = await boundedResponseText(res, 4 * 1024 * 1024, signal); }
      catch { throw new Error("revyl_invalid_response"); }
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* Non-JSON is never included in error messages. */ }
      return { status: res.status, json, text };
    }, 180_000, "revyl_request_timeout");
  }

  private proxy(run: string, action: string, body?: unknown, timeoutMs?: number) {
    const get = /^(screenshot|health|device_info|step_status|install_status|hierarchy|logs|requests)/.test(action);
    return this.req(get ? "GET" : "POST", `/api/v1/execution/device-proxy/${run}/${action}`, get ? undefined : body ?? {}, timeoutMs);
  }

  async getBuild(buildId: string, timeoutMs = 15_000): Promise<{ appId: string; downloadUrl: string; packageName?: string }> {
    const r = await this.req("GET", `/api/v1/apps/builds/${encodeURIComponent(buildId)}?include_download_url=true`, undefined, timeoutMs);
    if (r.status !== 200 || !r.json?.download_url) throw new Error(`revyl build lookup failed: HTTP ${r.status}`);
    return { appId: r.json.app_id, downloadUrl: r.json.download_url, packageName: r.json.package_name };
  }

  // Private capture material: never return these report URLs or raw requests to a model.
  async getSessionReport(sessionId: string, opts: { timeoutMs?: number } = {}): Promise<RevylSessionReport> {
    return networkDeadline(opts.timeoutMs, (signal) => this.sessionReport(sessionId, signal));
  }

  private async sessionReport(sessionId: string, signal: AbortSignal): Promise<RevylSessionReport> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) throw new Error("revyl_invalid_session");
    const path = `/api/v1/reports-v3/reports/by-session/${encodeURIComponent(sessionId)}/context?include_steps=false&include_actions=false&include_llm_calls=false`;
    let res: Response;
    try {
      res = await fetch(this.base + path, { method: "GET", redirect: "error", signal, headers: {
        Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json",
        "X-Revyl-Client": "cli", "User-Agent": "revyl-cli/0.2.12",
      } });
    } catch { throw new Error("revyl_report_unavailable"); }
    if (res.status !== 200) { await res.body?.cancel().catch(() => {}); throw new Error(`revyl_report_http_${res.status}`); }
    const raw = parseNetworkJson(await boundedResponseText(res, 256 * 1024, signal));
    if (!object(raw) || typeof raw.id !== "string" || !raw.id || raw.id.length > 128 ||
      (raw.session_id != null && raw.session_id !== sessionId) ||
      (raw.network_requests_url != null && typeof raw.network_requests_url !== "string") ||
      (raw.network_requests_partial != null && typeof raw.network_requests_partial !== "boolean")) throw new Error("revyl_invalid_report");
    const url = raw.network_requests_url ? artifactUrl(raw.network_requests_url) : undefined;
    const startedAt = typeof raw.started_at === "string" && Number.isFinite(Date.parse(raw.started_at)) ? raw.started_at : undefined;
    return { id: raw.id, sessionId, ...(startedAt ? { startedAt } : {}), ...(url ? { networkRequestsUrl: url } : {}), partial: raw.network_requests_partial === true };
  }

  async getNetworkArtifact(sessionId: string, opts: { timeoutMs?: number } = {}): Promise<RevylNetworkArtifact | null> {
    return networkDeadline(opts.timeoutMs, async (signal) => {
      const report = await this.sessionReport(sessionId, signal);
      if (!report.networkRequestsUrl) return null;
      if (!this.options.artifactText) throw new Error("revyl_artifact_transport_required");
      // The injected Node transport must pin public DNS, reject redirects, send no
      // auth headers, and bound both compressed and decoded bytes while gunzipping.
      let text: string;
      try { text = await this.options.artifactText(report.networkRequestsUrl, signal); }
      catch { throw new Error("revyl_artifact_unavailable"); }
      if (typeof text !== "string" || utf8(text) > MAX_NETWORK_BYTES) throw new Error("revyl_network_too_large");
      return parseRevylNetwork(text, report.partial);
    });
  }

  // Starts an Android device with the build installed and waits until the device is connected.
  async start(opts: { buildId: string; platform?: "android" | "ios"; idleTimeoutSeconds?: number; readyTimeoutMs?: number; onAllocated?: (session: RevylSession) => Promise<void> }): Promise<RevylSession> {
    const b = await this.getBuild(opts.buildId);
    const r = await this.req("POST", "/api/v1/execution/start_device", {
      platform: opts.platform ?? "android",
      app_id: b.appId,
      build_id: opts.buildId,
      app_url: b.downloadUrl,
      app_package: b.packageName,
      is_simulation: true, // "simulation" = ad hoc session without a saved test (CLI does the same)
      idle_timeout_seconds: opts.idleTimeoutSeconds ?? 300,
    }, 15_000);
    if (r.status >= 300 || r.json?.error) throw new Error(`revyl start_device failed: HTTP ${r.status}`);
    const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
    const run = r.json?.workflow_run_id, sid = r.json?.session_id;
    if (!validId(sid)) {
      if (validId(run)) await this.req("POST", `/api/v1/execution/device/status/cancel/${run}`, {}).catch(() => {});
      throw new Error("revyl_allocation_missing_session");
    }
    if (!validId(run)) {
      await this.stop({ sessionId: sid, workflowRunId: "" }).catch(() => {});
      throw new Error("revyl_allocation_missing_workflow");
    }
    const session: RevylSession = { sessionId: sid, workflowRunId: run, viewerUrl: `${REVYL_APP}/sessions/${sid}`, packageName: b.packageName };

    const deadline = Date.now() + (opts.readyTimeoutMs ?? 150_000);
    try {
      if (opts.onAllocated) await opts.onAllocated(session);
      // 1. worker assigned
      for (;;) {
        const w = await this.req("GET", `/api/v1/execution/streaming/worker-connection/${run}`);
        if (w.json?.worker_ws_url) break;
        const st = String(w.json?.status ?? "").toLowerCase();
        if (st === "failed" || st === "cancelled" || st === "error") throw new Error(`revyl worker ${st}`);
        if (Date.now() > deadline) throw new Error("revyl worker not ready in time");
        await sleep(2000);
      }
      // 2. device connected
      for (;;) {
        const h = await this.proxy(run, "health");
        if (h.status === 200 && (h.json?.device_connected || h.json?.status === "ready" || h.json?.status === "healthy")) break;
        if (Date.now() > deadline) throw new Error("revyl device not connected in time");
        await sleep(2000);
      }
    } catch (e) {
      await this.stop(session).catch(() => {});
      throw e;
    }
    return session;
  }

  async launch(s: RevylSession, bundleId?: string): Promise<void> {
    const r = await this.proxy(s.workflowRunId, "launch", bundleId ? { bundle_id: bundleId } : {});
    if (r.status >= 300) throw new Error(`revyl launch failed: HTTP ${r.status}`);
  }

  async step(s: RevylSession, stepType: "instruction" | "extract" | "validation", description: string, timeoutMs = 180_000): Promise<StepResult> {
    const r = await this.proxy(s.workflowRunId, "execute_step", {
      step_type: stepType,
      step_description: description,
      session_id: s.sessionId,
      workflow_run_id: s.workflowRunId,
    }, timeoutMs);
    if (r.status >= 300) return { ok: false, text: `revyl step failed: HTTP ${r.status}` };
    let result = r.json;
    if (result?.status === "accepted" && result?.step_id) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        await sleep(1000);
        const p = await this.proxy(s.workflowRunId, `step_status/${result.step_id}`);
        const st = p.json?.status;
        if (st === "completed" || st === "failed") {
          try { result = typeof p.json.result === "string" ? JSON.parse(p.json.result) : p.json.result; }
          catch { throw new Error("revyl_invalid_step_result"); }
          break;
        }
        if (Date.now() > deadline) return { ok: false, text: "revyl step timed out" };
      }
    }
    const out = result?.step_output ?? {};
    const text =
      stepType === "extract"
        ? String(out?.extracted_data?.information ?? out?.extracted_data ?? "")
        : String(out?.agent_description ?? out?.action_history?.slice?.(-1)?.[0] ?? "");
    return { ok: !!result?.success, text, raw: result };
  }

  async stop(s: Pick<RevylSession, "sessionId" | "workflowRunId">): Promise<void> {
    try {
      const primary = await this.req("POST", `/api/v1/execution/device/sessions/${encodeURIComponent(s.sessionId)}/stop`, {});
      if (primary.status >= 200 && primary.status < 300) return;
    } catch { /* A failed primary request still permits the cleanup fallback. */ }
    if (s.workflowRunId) {
      try {
        const fallback = await this.req("POST", `/api/v1/execution/device/status/cancel/${encodeURIComponent(s.workflowRunId)}`, {});
        if (fallback.status >= 200 && fallback.status < 300) return;
      } catch { /* Leave the durable session ID available for another cleanup attempt. */ }
    }
    throw new Error("revyl_stop_failed");
  }

}

// One phone tool call end to end: boot, launch, act, read, always stop.
export async function runPhoneTask(
  client: RevylClient,
  opts: { buildId: string; instruction?: string; extract?: string; keepAlive?: boolean },
): Promise<{ ok: boolean; text: string; viewerUrl: string; sessionId: string; steps: StepResult[] }> {
  const s = await client.start({ buildId: opts.buildId });
  const steps: StepResult[] = [];
  try {
    await client.launch(s).catch(() => {});
    if (opts.instruction) steps.push(await client.step(s, "instruction", opts.instruction));
    if (opts.extract && steps.every((x) => x.ok)) steps.push(await client.step(s, "extract", opts.extract));
    const last = steps[steps.length - 1];
    return { ok: steps.length > 0 && steps.every((x) => x.ok), text: last?.text ?? "", viewerUrl: s.viewerUrl, sessionId: s.sessionId, steps };
  } finally {
    if (!opts.keepAlive) await client.stop(s).catch(() => {});
  }
}

// Mapped from RevylAI/revyl-cli 65d787fb: internal/api/generated.go,
// internal/runinspect/{network,live}.go. Live JSONL has no body/header previews.
export interface RevylSessionReport {
  id: string;
  sessionId: string;
  startedAt?: string;
  networkRequestsUrl?: string; // Presigned/private; internal use only.
  partial: boolean;
}
export interface RevylNetworkRequest {
  url: string;
  method: string;
  status_code?: number;
  start_time_s?: number;
  request_body_size?: number;
  response_body_size?: number;
  request_headers?: Record<string, string>;
  response_headers?: Record<string, string>;
  request_body_preview?: string;
  response_body_preview?: string;
  request_body_truncated?: unknown;
  response_body_truncated?: unknown;
  hasBodyPreview: boolean;
  is_auth?: boolean;
}
export interface RevylNetworkArtifact { requests: RevylNetworkRequest[]; partial: boolean }
export interface RevylPreviewState {
  id: string;
  hasRequestBodyPreview: boolean;
  requestBodyTruncated: boolean;
  hasResponseBodyPreview: boolean;
  responseBodyTruncated: boolean;
}
const MAX_NETWORK_BYTES = 4 * 1024 * 1024;
const MAX_NETWORK_REQUESTS = 2000;
const SECRET = /authorization|cookie|token|secret|password|credential|api.?key|session|csrf|signature|otp|^code$|^state$/i;
const UNSAFE_KEY = /^(?:__proto__|prototype|constructor)$/i;
const utf8 = (value: string) => new TextEncoder().encode(value).byteLength;
function object(value: unknown): value is Record<string, any> { return !!value && typeof value === "object" && !Array.isArray(value); }
function parseNetworkJson(text: string): unknown {
  try { return JSON.parse(text); } catch { throw new Error("revyl_invalid_network_json"); }
}
async function networkDeadline<T>(timeoutMs: number | undefined, fn: (signal: AbortSignal) => Promise<T>, maxMs = 30_000, timeoutCode = "revyl_network_timeout"): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([fn(controller.signal), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error(timeoutCode)); }, Math.max(1, Math.min(timeoutMs ?? 15_000, maxMs)));
    })]);
  } finally { if (timer) clearTimeout(timer); controller.abort(); }
}
async function boundedResponseText(response: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) { await response.body?.cancel().catch(() => {}); throw new Error("revyl_report_too_large"); }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("revyl_report_too_large");
      chunks.push(value);
    }
    const combined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(combined);
  } catch { await reader.cancel().catch(() => {}); throw new Error(size > maxBytes ? "revyl_report_too_large" : "revyl_invalid_report"); }
  finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}
function artifactUrl(raw: string): string {
  if (!raw || raw.length > 8192 || /[\s\x00-\x1f\x7f\\{}<>]/.test(raw)) throw new Error("revyl_invalid_artifact_url");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("revyl_invalid_artifact_url"); }
  const info = domainInfo(url.hostname, { allowPrivateDomains: true });
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || url.hostname.endsWith(".") ||
    info.isIp || !info.domain || !(info.isIcann || info.isPrivate) || !url.hostname.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) throw new Error("revyl_invalid_artifact_url");
  return url.href;
}
function headerMap(raw: unknown): Record<string, string> | undefined {
  if (raw == null) return undefined;
  if (!object(raw) || Object.keys(raw).length > 100) throw new Error("revyl_invalid_network_headers");
  const result: Record<string, string> = Object.create(null);
  let size = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(key) || UNSAFE_KEY.test(key) || typeof value !== "string" || /[\r\n\x00]/.test(value)) throw new Error("revyl_invalid_network_headers");
    size += utf8(key + value);
    if (size > 32_768) throw new Error("revyl_invalid_network_headers");
    result[key.toLowerCase()] = value;
  }
  return result;
}
function networkRequest(raw: unknown, live: boolean): RevylNetworkRequest {
  if (!object(raw) || typeof raw.url !== "string" || raw.url.length > 8192 || typeof raw.method !== "string" || !/^[A-Z]{1,16}$/.test(raw.method)) throw new Error("revyl_invalid_network_request");
  const result: RevylNetworkRequest = { url: raw.url, method: raw.method, hasBodyPreview: false };
  for (const key of ["status_code", "start_time_s", "request_body_size", "response_body_size"] as const) {
    const value = raw[key];
    if (value != null) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (key !== "start_time_s" && !Number.isSafeInteger(value)) || (key === "status_code" && value > 599)) throw new Error("revyl_invalid_network_request");
      result[key] = value;
    }
  }
  if (raw.is_auth != null && typeof raw.is_auth !== "boolean") throw new Error("revyl_invalid_network_request");
  if (raw.is_auth != null) result.is_auth = raw.is_auth;
  if (!live) {
    result.request_headers = headerMap(raw.request_headers);
    result.response_headers = headerMap(raw.response_headers);
    for (const side of ["request", "response"] as const) {
      const preview = raw[`${side}_body_preview`];
      if (preview != null && (typeof preview !== "string" || utf8(preview) > 65_536)) throw new Error("revyl_invalid_network_preview");
      if (typeof preview === "string") result[`${side}_body_preview`] = preview;
      // Unknown/non-boolean flags are preserved, never interpreted as false.
      if (Object.hasOwn(raw, `${side}_body_truncated`)) result[`${side}_body_truncated`] = raw[`${side}_body_truncated`];
    }
    result.hasBodyPreview = typeof result.request_body_preview === "string" || typeof result.response_body_preview === "string";
  }
  return result;
}
export function parseRevylNetwork(text: string, partial = false): RevylNetworkArtifact {
  if (typeof text !== "string" || utf8(text) > MAX_NETWORK_BYTES) throw new Error("revyl_network_too_large");
  if (!text.trim()) return { requests: [], partial };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { /* A live object may be JSONL. */ }
  if (object(parsed) && Object.hasOwn(parsed, "requests")) {
    if (!Array.isArray(parsed.requests) || parsed.requests.length > MAX_NETWORK_REQUESTS) throw new Error("revyl_invalid_network_capture");
    return { requests: parsed.requests.map((item) => networkRequest(item, false)), partial };
  }
  const lines = text.trim().split(/\r?\n/);
  if (lines.length > MAX_NETWORK_REQUESTS) throw new Error("revyl_network_too_large");
  const requests: RevylNetworkRequest[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line.trim()) continue;
    let value: unknown;
    try { value = JSON.parse(line); } catch {
      // Only an explicitly partial live artifact may have a torn final record.
      if (partial && index === lines.length - 1 && !text.endsWith("\n")) break;
      throw new Error("revyl_invalid_network_json");
    }
    requests.push(networkRequest(value, true));
  }
  return { requests, partial };
}

// The deployment registry approves exact origins or first-party namespaces.
// Only actually observed traffic can be normalized; no inferred API requests,
// body credentials, or third-party cookie harvesting.
export function normalizeRevylNetwork(artifact: RevylNetworkArtifact, opts: {
  approvedOrigins: string[]; sessionHeaders: string[]; capturedAt: number;
}): { entries: CaptureEntry[]; session: SessionBundle; previews: RevylPreviewState[] } {
  if (!Number.isFinite(opts.capturedAt) || opts.capturedAt <= 0 || opts.approvedOrigins.length > 20 || opts.sessionHeaders.length > 40 || artifact.requests.length > MAX_NETWORK_REQUESTS) throw new Error("revyl_invalid_capture_config");
  for (const pattern of opts.approvedOrigins) validateNativeOriginPattern(pattern);
  const names = new Set(opts.sessionHeaders.map((name) => name.toLowerCase()));
  if ([...names].some((name) => !/^[a-z0-9-]{1,128}$/.test(name) || UNSAFE_KEY.test(name) || /host|forward|proxy|origin|referer|url/.test(name))) throw new Error("revyl_invalid_capture_config");
  const accepted = artifact.requests.flatMap((request, index) => {
    let url: URL;
    try { url = new URL(request.url); } catch { return []; }
    if (!isApprovedNativeOrigin(url.origin, opts.approvedOrigins) || url.username || url.password || url.hash || url.protocol !== "https:") return [];
    return [{ request, url, id: `revyl-${index}` }];
  });
  const session: SessionBundle = { capturedAt: opts.capturedAt, headers: {}, cookies: {} };
  // SessionBundle is flat. Until credentials are stored per origin, accepting
  // multiple credential-bearing origins would replay a rotated token or a
  // different origin's cookies against the wrong host.
  let credentialOrigin: string | undefined;
  const assign = (kind: "headers" | "cookies", key: string, value: string, origin: string) => {
    if (credentialOrigin && credentialOrigin !== origin) throw new Error("revyl_conflicting_capture_auth");
    credentialOrigin = origin;
    session[kind]![key] = value;
  };
  const secrets = new Set<string>();
  let secretBytes = 0, inspected = 0;
  const remember = (value: string) => {
    for (const item of [value, /^(?:Bearer|Basic|Token)\s+(.+)$/i.exec(value)?.[1]]) {
      if (!item || secrets.has(item)) continue;
      secretBytes += utf8(item);
      if (secrets.size >= 256 || secretBytes > 128 * 1024) throw new Error("revyl_network_redaction_limit");
      secrets.add(item);
    }
  };
  const gather = (value: unknown, depth = 0, privateBranch = false): void => {
    if (++inspected > 20_000 || depth > 10) throw new Error("revyl_network_redaction_limit");
    if (typeof value === "string") {
      if (privateBranch) remember(value);
      if (/^\s*[\[{]/.test(value)) {
        let nested: unknown;
        try { nested = JSON.parse(value); } catch { return; }
        gather(nested, depth + 1, privateBranch);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) gather(item, depth + 1, privateBranch);
    } else if (object(value)) for (const [key, item] of Object.entries(value)) gather(item, depth + 1, privateBranch || SECRET.test(key));
  };
  for (const { request, url } of accepted) {
    for (const [key, value] of url.searchParams) if (SECRET.test(key)) remember(value);
    for (const headers of [request.request_headers, request.response_headers]) for (const [name, value] of Object.entries(headers ?? {})) {
      if (SECRET.test(name) || names.has(name)) remember(value);
      if (name === "cookie" || name === "set-cookie") {
        const pairs = name === "cookie" ? value.split(";") : [value.split(";", 1)[0]!];
        for (const pair of pairs) { const split = pair.indexOf("="); if (split > 0) remember(pair.slice(split + 1).trim()); }
      }
    }
    for (const body of [request.request_body_preview, request.response_body_preview]) if (body) {
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { continue; }
      gather(parsed);
    }
    for (const [name, value] of Object.entries(request.request_headers ?? {})) {
      if (!names.has(name) || utf8(value) > 8192) continue;
      if (name === "cookie") {
        for (const pair of value.split(";")) {
          const split = pair.indexOf("=");
          const key = pair.slice(0, split).trim(), item = pair.slice(split + 1).trim();
          if (split <= 0 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(key) || UNSAFE_KEY.test(key) || /[;\r\n\x00]/.test(item)) continue;
          assign("cookies", key, item, url.origin); remember(item);
        }
      } else assign("headers", name, value, url.origin);
    }
  }
  const echoes = [...secrets].sort((a, b) => b.length - a.length);
  const cleanText = (raw: string): string => {
    let text = raw;
    for (const secret of echoes) {
      if (text === secret) return "<redacted>";
      text = text.split(secret).join("<redacted>").split(encodeURIComponent(secret)).join("<redacted>");
    }
    return text;
  };
  const cleanJson = (raw: unknown, depth = 0): unknown => {
    if (depth > 10) return "<truncated>";
    if (typeof raw === "string") {
      if (/^\s*[\[{]/.test(raw)) { try { return JSON.stringify(cleanJson(JSON.parse(raw), depth + 1)); } catch { /* Ordinary text. */ } }
      return cleanText(raw);
    }
    if (Array.isArray(raw)) return raw.slice(0, 100).map((value) => cleanJson(value, depth + 1));
    if (object(raw)) return Object.fromEntries(Object.entries(raw).slice(0, 100).filter(([key]) => !UNSAFE_KEY.test(key)).map(([key, value]) => [cleanText(key), SECRET.test(key) ? "<redacted>" : cleanJson(value, depth + 1)]));
    return raw;
  };
  const cleanHeaders = (raw?: Record<string, string>) => Object.fromEntries(Object.entries(raw ?? {}).map(([key, value]) => [key, SECRET.test(key) || names.has(key) ? `<redacted:${key}>` : cleanText(value)]));
  const complete = (request: RevylNetworkRequest, side: "request" | "response") => {
    const preview = request[`${side}_body_preview`];
    return typeof preview === "string" && request[`${side}_body_truncated`] === false && request[`${side}_body_size`] === utf8(preview);
  };
  const body = (request: RevylNetworkRequest, side: "request" | "response", limit: number): string | undefined => {
    const preview = request[`${side}_body_preview`];
    if (!complete(request, side) || preview === undefined || utf8(preview) > limit || request.is_auth || /auth|login|signin|password|credential|token|session/i.test(new URL(request.url).pathname)) return undefined;
    try {
      const value = JSON.parse(preview);
      if (!object(value) && !Array.isArray(value)) return undefined;
      const clean = JSON.stringify(cleanJson(value));
      return utf8(clean) <= limit ? clean : undefined;
    } catch { return undefined; }
  };
  const entries: CaptureEntry[] = [], previews: RevylPreviewState[] = [];
  for (const { request, url, id } of accepted) {
    for (const key of [...url.searchParams.keys()]) if (SECRET.test(key)) url.searchParams.set(key, "<redacted>");
    const cleanUrl = cleanText(url.href);
    entries.push({ id, ts: opts.capturedAt + (request.start_time_s ?? 0) * 1000, method: request.method, url: cleanUrl,
      status: request.status_code, reqHeaders: cleanHeaders(request.request_headers), resHeaders: cleanHeaders(request.response_headers),
      reqBody: body(request, "request", 8192), resBody: body(request, "response", 16_384),
      mime: request.response_headers?.["content-type"] ? cleanText(request.response_headers["content-type"].split(";", 1)[0]!) : undefined, initiator: "revyl" });
    previews.push({ id, hasRequestBodyPreview: typeof request.request_body_preview === "string", requestBodyTruncated: !complete(request, "request"),
      hasResponseBodyPreview: typeof request.response_body_preview === "string", responseBodyTruncated: !complete(request, "response") });
  }
  return { entries, session, previews };
}
