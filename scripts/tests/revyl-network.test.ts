/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { RevylClient, normalizeRevylNetwork, parseRevylNetwork } from "../re/lib/revyl";
import { isApprovedNativeOrigin, validateNativeOriginPattern } from "../../convex/lib/nativeOrigins";

const sessionId = "session_fake_123";
const vendorUrl = "https://artifacts.vendor.com/capture.json.gz?signature=PRIVATE_SIGNED_ARTIFACT";
const origin = "https://api.acme.com";
const utf8 = (text: string) => new TextEncoder().encode(text).byteLength;
const requestBody = JSON.stringify({ name: "entry", quantity: 2 });
const responseBody = JSON.stringify({ items: [{ id: 1 }] });
const request = (overrides = {}) => ({ url: `${origin}/api/items`, method: "POST", status_code: 200, start_time_s: 1.5,
  request_headers: { "content-type": "application/json", authorization: "Bearer PRIVATE_AUTH_TOKEN" },
  response_headers: { "content-type": "application/json" }, request_body_preview: requestBody, request_body_size: utf8(requestBody), request_body_truncated: false,
  response_body_preview: responseBody, response_body_size: utf8(responseBody), response_body_truncated: false, ...overrides });
const capture = (requests = [request()]) => JSON.stringify({ requests, summary: { total_requests: requests.length } });
const config = { approvedOrigins: [origin], sessionHeaders: ["authorization", "cookie"], capturedAt: 1_700_000_000_000 };
const report = (overrides = {}) => ({ id: "report_fake", session_id: sessionId, started_at: "2026-11-15T00:00:00Z", network_requests_url: vendorUrl, ...overrides });
async function mockFetch<T>(handler: typeof fetch, fn: () => Promise<T>) {
  const previous = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await fn(); } finally { globalThis.fetch = previous; }
}

test("session report uses the canonical minimal endpoint and drops unrelated report secrets", async () => {
  await mockFetch(async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, `/api/v1/reports-v3/reports/by-session/${sessionId}/context`);
    assert.equal(url.search, "?include_steps=false&include_actions=false&include_llm_calls=false");
    assert.equal(new Headers(options?.headers).get("authorization"), "Bearer PRIVATE_REVYL_KEY");
    assert.equal(options?.redirect, "error");
    assert.ok(options?.signal);
    return Response.json(report({ launch_env_var_snapshot: [{ value: "PRIVATE_ENV" }], system_prompt: "PRIVATE_PROMPT" }));
  }, async () => {
    const value = await new RevylClient("PRIVATE_REVYL_KEY").getSessionReport(sessionId);
    assert.deepEqual(value, { id: "report_fake", sessionId, startedAt: "2026-11-15T00:00:00Z", networkRequestsUrl: vendorUrl, partial: false });
    assert.ok(!JSON.stringify(value).includes("PRIVATE_ENV"));
    assert.ok(!JSON.stringify(value).includes("PRIVATE_PROMPT"));
  });
});

test("an optional absent artifact needs no downloader; present artifact requires an injected headerless transport", async () => {
  await mockFetch(async () => Response.json(report({ network_requests_url: null })), async () => {
    assert.equal(await new RevylClient("key").getNetworkArtifact(sessionId), null);
  });
  await mockFetch(async () => Response.json(report()), async () => {
    await assert.rejects(new RevylClient("key").getNetworkArtifact(sessionId), /revyl_artifact_transport_required/);
    let calls = 0;
    const client = new RevylClient("PRIVATE_REVYL_KEY", undefined, { artifactText: async (...args) => {
      assert.equal(args.length, 2);
      const [url, signal] = args;
      calls++;
      assert.equal(url, vendorUrl);
      assert.equal(signal.aborted, false);
      return capture();
    } });
    const result = await client.getNetworkArtifact(sessionId);
    assert.equal(calls, 1);
    assert.equal(result?.requests.length, 1);
    assert.equal(result?.requests[0].request_headers?.authorization, "Bearer PRIVATE_AUTH_TOKEN");
    assert.equal(result?.requests[0].hasBodyPreview, true);
  });
});

test("untrusted report URLs, owner/session mismatch and unsafe report responses never reach the downloader", async () => {
  for (const url of ["http://artifacts.vendor.com/capture", "https://u:p@artifacts.vendor.com/capture", "https://127.0.0.1/capture", "https://[::1]/capture", "https://metadata.internal/capture", "https://localhost/capture", "https://artifacts.vendor.com:444/capture", "https://artifacts.vendor.com/capture#fragment"]) {
    await mockFetch(async () => Response.json(report({ network_requests_url: url })), async () => {
      let downloaded = false;
      const client = new RevylClient("key", undefined, { artifactText: async () => { downloaded = true; return capture(); } });
      await assert.rejects(client.getNetworkArtifact(sessionId), /revyl_invalid_artifact_url/);
      assert.equal(downloaded, false);
    });
  }
  for (const body of [report({ session_id: "someone_else" }), report({ network_requests_partial: "yes" }), { id: "" }]) {
    await mockFetch(async () => Response.json(body), async () => {
      await assert.rejects(new RevylClient("key").getSessionReport(sessionId), /revyl_invalid_report/);
    });
  }
});

test("deadlines cover hung report fetches, body reads and artifact transports even if they ignore cancellation", async () => {
  const hung = () => new Promise<never>(() => {});
  await mockFetch(hung, async () => {
    await assert.rejects(new RevylClient("key").getSessionReport(sessionId, { timeoutMs: 5 }), /revyl_network_timeout/);
  });
  let cancelled = false;
  await mockFetch(async () => new Response(new ReadableStream({ cancel: () => { cancelled = true; } })), async () => {
    await assert.rejects(new RevylClient("key").getSessionReport(sessionId, { timeoutMs: 5 }), /revyl_network_timeout/);
  });
  assert.equal(cancelled, true);
  await mockFetch(async () => Response.json(report()), async () => {
    let signal: AbortSignal | undefined;
    const client = new RevylClient("key", undefined, { artifactText: async (_url, value) => { signal = value; return hung(); } });
    await assert.rejects(client.getNetworkArtifact(sessionId, { timeoutMs: 5 }), /revyl_network_timeout/);
    assert.equal(signal?.aborted, true);
  });
});

test("reports and decoded artifacts have byte caps and bounded errors without raw server payloads", async () => {
  await mockFetch(async () => new Response("PRIVATE_BACKEND_ERROR", { status: 403 }), async () => {
    await assert.rejects(new RevylClient("PRIVATE_REVYL_KEY").getSessionReport(sessionId), /^Error: revyl_report_http_403$/);
  });
  await mockFetch(async () => new Response("x".repeat(256 * 1024 + 1)), async () => {
    await assert.rejects(new RevylClient("key").getSessionReport(sessionId), /revyl_report_too_large/);
  });
  await mockFetch(async () => Response.json(report()), async () => {
    const client = new RevylClient("key", undefined, { artifactText: async () => "😀".repeat(1024 * 1024 + 1) });
    await assert.rejects(client.getNetworkArtifact(sessionId), /revyl_network_too_large/);
    const failed = new RevylClient("key", undefined, { artifactText: async () => { throw new Error(vendorUrl); } });
    await assert.rejects(failed.getNetworkArtifact(sessionId), /^Error: revyl_artifact_unavailable$/);
  });
});

test("finalized artifact preserves preview and unknown truncation flags without inventing completeness", () => {
  const result = parseRevylNetwork(capture([request({ request_body_truncated: "unknown", response_body_truncated: true })]));
  assert.equal(result.requests[0].request_body_truncated, "unknown");
  assert.equal(result.requests[0].response_body_truncated, true);
  assert.equal(result.requests[0].hasBodyPreview, true);
  const normalized = normalizeRevylNetwork(result, config);
  assert.equal(normalized.entries[0].reqBody, undefined);
  assert.equal(normalized.entries[0].resBody, undefined);
  assert.deepEqual(normalized.previews[0], { id: "revyl-0", hasRequestBodyPreview: true, requestBodyTruncated: true, hasResponseBodyPreview: true, responseBodyTruncated: true });
});

test("live JSONL is detected structurally, drops unsupported previews and accepts only a torn final partial line", () => {
  const line = JSON.stringify(request());
  for (const partial of [true, false]) {
    const result = parseRevylNetwork(`${line}\n${line}\n`, partial);
    assert.equal(result.requests.length, 2);
    assert.equal(result.requests[0].hasBodyPreview, false);
    assert.equal(result.requests[0].request_headers, undefined);
    assert.equal(result.requests[0].request_body_preview, undefined);
  }
  assert.equal(parseRevylNetwork(`${line}\n{"url":`, true).requests.length, 1);
  assert.throws(() => parseRevylNetwork(`${line}\n{"url":`, false), /revyl_invalid_network_json/);
  assert.throws(() => parseRevylNetwork(`${line}\n{"url":\n${line}`, true), /revyl_invalid_network_json/);
  assert.equal(parseRevylNetwork(capture(), true).requests[0].hasBodyPreview, true);
});

test("malformed captures, excessive entries, invalid headers and oversized previews fail without echoing private values", () => {
  for (const text of ["PRIVATE_BAD_CAPTURE", '{"requests":{}}', capture([request({ method: "POST\nPRIVATE" })]),
    capture([request({ request_headers: { authorization: "PRIVATE\r\nINJECT" } })]), capture([request({ request_body_preview: "x".repeat(65_537) })]),
    JSON.stringify({ requests: Array(2001).fill(request()) }), capture([request({ status_code: -1 })])]) {
    assert.throws(() => parseRevylNetwork(text), (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^revyl_/);
      assert.ok(!error.message.includes("PRIVATE"));
      return true;
    });
  }
});

test("normalization separates exact-origin auth from redacted capture metadata and secret echoes", () => {
  const body = JSON.stringify({ access_token: "PRIVATE_BODY_TOKEN", nested: { text: "PRIVATE_AUTH_TOKEN" }, embedded: JSON.stringify({ password: "PRIVATE_PASSWORD", value: "PRIVATE_BODY_TOKEN" }) });
  const raw = parseRevylNetwork(capture([request({ url: `${origin}/api/items?access_token=PRIVATE_QUERY_TOKEN&limit=2`,
    request_headers: { authorization: "Bearer PRIVATE_AUTH_TOKEN", cookie: "session=PRIVATE_COOKIE; preference=dark", "x-secret": "PRIVATE_UNKNOWN_HEADER", "x-echo": "PRIVATE_AUTH_TOKEN" },
    response_headers: { "content-type": "application/json", "set-cookie": "refresh=PRIVATE_RESPONSE_COOKIE", "x-echo": "PRIVATE_BODY_TOKEN" },
    response_body_preview: body, response_body_size: utf8(body) }),
    request({ url: "https://evil.acme.com/api/items", request_headers: { authorization: "Bearer PRIVATE_OTHER_ORIGIN" } })]));
  const normalized = normalizeRevylNetwork(raw, config);
  assert.equal(normalized.entries.length, 1);
  assert.equal(normalized.session.headers?.authorization, "Bearer PRIVATE_AUTH_TOKEN");
  assert.equal(normalized.session.headers?.["x-secret"], undefined);
  assert.deepEqual(normalized.session.cookies, { session: "PRIVATE_COOKIE", preference: "dark" });
  assert.ok(!JSON.stringify(normalized.session).includes("PRIVATE_OTHER_ORIGIN"));
  const safe = JSON.stringify(normalized.entries);
  for (const secret of ["PRIVATE_AUTH_TOKEN", "PRIVATE_BODY_TOKEN", "PRIVATE_QUERY_TOKEN", "PRIVATE_COOKIE", "PRIVATE_PASSWORD", "PRIVATE_UNKNOWN_HEADER", "PRIVATE_RESPONSE_COOKIE"]) assert.ok(!safe.includes(secret), secret);
  assert.equal(normalized.entries[0].reqBody, requestBody);
  assert.equal(normalized.entries[0].ts, config.capturedAt + 1500);
  assert.equal(normalized.entries[0].reqHeaders.authorization, "<redacted:authorization>");
});

test("truncated, missing-flag, byte-mismatched, auth and non-JSON previews never become complete request bodies", () => {
  for (const overrides of [{ request_body_truncated: true }, { request_body_truncated: undefined }, { request_body_truncated: null },
    { request_body_size: utf8(requestBody) + 1 }, { request_body_size: undefined }, { is_auth: true },
    { request_body_preview: "PRIVATE_FORM=password", request_body_size: utf8("PRIVATE_FORM=password") }]) {
    const value = normalizeRevylNetwork(parseRevylNetwork(capture([request(overrides)])), config);
    assert.equal(value.entries[0].reqBody, undefined);
  }
  const value = normalizeRevylNetwork(parseRevylNetwork(capture([request({ request_body_preview: '{"name":"é"}', request_body_size: '{"name":"é"}'.length })])), config);
  assert.equal(value.entries[0].reqBody, undefined);
});


test("embedded JSON credentials and unharvested cookie values cannot echo into safe metadata", () => {
  const response = JSON.stringify({ nested: JSON.stringify({ credentials: { value: "PRIVATE_EMBEDDED" } }),
    ordinary: "PRIVATE_EMBEDDED PRIVATE_UNHARVESTED_COOKIE PRIVATE_SET_COOKIE" });
  const result = normalizeRevylNetwork(parseRevylNetwork(capture([request({ request_headers: { cookie: "sid=PRIVATE_UNHARVESTED_COOKIE" },
    response_headers: { "set-cookie": "sid=PRIVATE_SET_COOKIE; Path=/; HttpOnly" }, response_body_preview: response, response_body_size: utf8(response) })])),
    { ...config, sessionHeaders: [] });
  assert.deepEqual(result.session.headers, {});
  assert.deepEqual(result.session.cookies, {});
  for (const secret of ["PRIVATE_EMBEDDED", "PRIVATE_UNHARVESTED_COOKIE", "PRIVATE_SET_COOKIE"]) assert.ok(!JSON.stringify(result.entries).includes(secret));
  const login = normalizeRevylNetwork(parseRevylNetwork(capture([request({ url: `${origin}/account/login` })])), config);
  assert.equal(login.entries[0].reqBody, undefined);
  assert.equal(login.entries[0].resBody, undefined);
});

test("redaction work is bounded and fails closed rather than retaining deep or excessive private fields", () => {
  let nested: unknown = { password: "PRIVATE_DEEP" };
  for (let index = 0; index < 11; index++) nested = { nested };
  const cases = [JSON.stringify(nested), JSON.stringify(Array.from({ length: 257 }, (_, index) => ({ token: `PRIVATE_${index}` })))];
  for (const body of cases) {
    assert.throws(() => normalizeRevylNetwork(parseRevylNetwork(capture([request({ request_body_preview: body, request_body_size: utf8(body) })])), config), /revyl_network_redaction_limit/);
  }
});


test("different approved origins cannot silently overwrite flat session credentials; same-origin refresh remains usable", () => {
  const second = request({ url: "https://www.acme.com/api/items", request_headers: { authorization: "Bearer PRIVATE_OTHER_TOKEN" } });
  const origins = { ...config, approvedOrigins: [origin, "https://www.acme.com"] };
  assert.throws(() => normalizeRevylNetwork(parseRevylNetwork(capture([request(), second])), origins), /revyl_conflicting_capture_auth/);
  const refresh = request({ request_headers: { authorization: "Bearer PRIVATE_NEW_TOKEN" } });
  const updated = normalizeRevylNetwork(parseRevylNetwork(capture([request(), refresh])), config);
  assert.equal(updated.session.headers?.authorization, "Bearer PRIVATE_NEW_TOKEN");
  assert.ok(!JSON.stringify(updated.entries).includes("PRIVATE_NEW_TOKEN"));
  assert.ok(!JSON.stringify(updated.entries).includes("PRIVATE_AUTH_TOKEN"));
});

const buildId = "build_fake";
const allocated = { sessionId: "allocated_session", workflowRunId: "allocated_run", viewerUrl: "https://app.revyl.ai/sessions/allocated_session", packageName: "com.acme.app" };
const allocationResponse = () => Response.json({ session_id: allocated.sessionId, workflow_run_id: allocated.workflowRunId });
const buildResponse = () => Response.json({ app_id: "app_fake", download_url: "https://artifacts.vendor.com/app.apk", package_name: "com.acme.app" });
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("allocation is durably acknowledged before any readiness request and start waits for that acknowledgement", async () => {
  const phases: string[] = [];
  let release: () => void = () => { throw new Error("callback not started"); };
  const saved = new Promise<void>((resolve) => { release = resolve; });
  await mockFetch(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.includes("/apps/builds/")) return buildResponse();
    if (path.endsWith("/start_device")) { phases.push("allocated"); return allocationResponse(); }
    if (path.includes("/worker-connection/")) { phases.push("worker"); return Response.json({ worker_ws_url: "wss://worker.vendor.com" }); }
    if (path.endsWith("/health")) { phases.push("health"); return Response.json({ device_connected: true }); }
    throw new Error("unexpected endpoint");
  }, async () => {
    const pending = new RevylClient("key").start({ buildId, onAllocated: async (value) => {
      assert.deepEqual(value, allocated);
      phases.push("persisting");
      await saved;
      phases.push("persisted");
    } });
    await flush();
    assert.deepEqual(phases, ["allocated", "persisting"]);
    release();
    assert.deepEqual(await pending, allocated);
    assert.deepEqual(phases, ["allocated", "persisting", "persisted", "worker", "health"]);
  });
});

test("a failed allocation persistence callback stops the exact allocated session before propagating failure", async () => {
  const paths: string[] = [];
  await mockFetch(async (input) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    if (path.includes("/apps/builds/")) return buildResponse();
    if (path.endsWith("/start_device")) return allocationResponse();
    if (path === `/api/v1/execution/device/sessions/${allocated.sessionId}/stop`) return Response.json({});
    throw new Error("readiness must never begin");
  }, async () => {
    await assert.rejects(new RevylClient("key").start({ buildId, onAllocated: async () => { throw new Error("lease_expired"); } }), /lease_expired/);
    assert.equal(paths.filter((path) => path.endsWith("/stop")).length, 1);
    assert.equal(paths.some((path) => path.includes("worker-connection")), false);
  });
});

test("readiness API hangs time out after the allocation is saved and always attempt session cleanup", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const phases: string[] = [];
  let readinessSignal: AbortSignal | undefined;
  await mockFetch(async (input, options) => {
    const path = new URL(String(input)).pathname;
    if (path.includes("/apps/builds/")) return buildResponse();
    if (path.endsWith("/start_device")) return allocationResponse();
    if (path.includes("/worker-connection/")) { phases.push("worker"); readinessSignal = options?.signal ?? undefined; return new Promise<never>(() => {}); }
    if (path.endsWith("/stop")) { phases.push("stopped"); return Response.json({}); }
    throw new Error("unexpected endpoint");
  }, async () => {
    const pending = new RevylClient("key").start({ buildId, onAllocated: async () => { phases.push("persisted"); } });
    await flush();
    assert.deepEqual(phases, ["persisted", "worker"]);
    const rejected = assert.rejects(pending, /revyl_request_timeout/);
    context.mock.timers.tick(30_000);
    await rejected;
    assert.equal(readinessSignal?.aborted, true);
    assert.deepEqual(phases, ["persisted", "worker", "stopped"]);
  });
});

test("allocation and generic API deadlines bound both fetch and response body work without retrying side effects", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let allocations = 0;
  let allocationSignal: AbortSignal | undefined;
  await mockFetch(async (input, options) => {
    if (new URL(String(input)).pathname.includes("/apps/builds/")) return buildResponse();
    allocations++;
    allocationSignal = options?.signal ?? undefined;
    return new Promise<never>(() => {});
  }, async () => {
    let acknowledged = false;
    const pending = new RevylClient("key").start({ buildId, onAllocated: async () => { acknowledged = true; } });
    await flush();
    const rejected = assert.rejects(pending, /revyl_request_timeout/);
    context.mock.timers.tick(15_000);
    await rejected;
    assert.equal(acknowledged, false);
    assert.equal(allocations, 1);
    assert.equal(allocationSignal?.aborted, true);
  });
  let cancelled = false;
  await mockFetch(async () => new Response(new ReadableStream({ cancel: () => { cancelled = true; } })), async () => {
    const pending = new RevylClient("key").launch(allocated);
    await flush();
    const rejected = assert.rejects(pending, /revyl_request_timeout/);
    context.mock.timers.tick(30_000);
    await rejected;
    assert.equal(cancelled, true);
  });
});

test("allocation errors expose status only and never raw provider credentials or transport errors", async () => {
  await mockFetch(async (input) => new URL(String(input)).pathname.includes("/apps/builds/") ? buildResponse() :
    Response.json({ error: { message: "PRIVATE_VENDOR_AUTH", secret: "PRIVATE_SESSION_TOKEN" } }, { status: 403 }), async () => {
    await assert.rejects(new RevylClient("PRIVATE_REVYL_KEY").start({ buildId }), /^Error: revyl start_device failed: HTTP 403$/);
  });
  await mockFetch(async () => { throw new Error("PRIVATE_TRANSPORT_AUTH"); }, async () => {
    await assert.rejects(new RevylClient("PRIVATE_REVYL_KEY").getBuild(buildId), /^Error: revyl_request_failed$/);
  });
});

test("older synchronous execute_step results can take longer than the normal request deadline without resubmission", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let resolve: (response: Response) => void = () => { throw new Error("not dispatched"); };
  let calls = 0;
  await mockFetch(async () => { calls++; return new Promise<Response>((done) => { resolve = done; }); }, async () => {
    let completed = false;
    const pending = new RevylClient("key").step(allocated, "instruction", "read the visible page").finally(() => { completed = true; });
    await flush();
    context.mock.timers.tick(30_001);
    await flush();
    assert.equal(completed, false);
    resolve(Response.json({ success: true, step_output: { agent_description: "visible page read" } }));
    assert.equal((await pending).ok, true);
    assert.equal(calls, 1);
  });
});


test("missing allocated IDs never create fake sessions or viewer URLs and clean up whichever real ID is known", async () => {
  for (const missing of ["session", "workflow"] as const) {
    const paths: string[] = [];
    await mockFetch(async (input) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      if (path.includes("/apps/builds/")) return buildResponse();
      if (path.endsWith("/start_device")) return Response.json(missing === "session" ? { workflow_run_id: allocated.workflowRunId } : { session_id: allocated.sessionId });
      return Response.json({});
    }, async () => {
      let acknowledged = false;
      await assert.rejects(new RevylClient("key").start({ buildId, onAllocated: async () => { acknowledged = true; } }),
        missing === "session" ? /revyl_allocation_missing_session/ : /revyl_allocation_missing_workflow/);
      assert.equal(acknowledged, false);
      assert.equal(paths.some((path) => path.includes("worker-connection")), false);
      const cleanup = missing === "session" ? `/api/v1/execution/device/status/cancel/${allocated.workflowRunId}` : `/api/v1/execution/device/sessions/${allocated.sessionId}/stop`;
      assert.equal(paths.filter((path) => path === cleanup).length, 1);
      assert.equal(paths.filter((path) => path.endsWith("/start_device")).length, 1);
    });
  }
});

test("step HTTP failures expose no raw provider error body", async () => {
  await mockFetch(async () => Response.json({ detail: "PRIVATE_ERROR_TOKEN" }, { status: 403 }), async () => {
    assert.deepEqual(await new RevylClient("key").step(allocated, "instruction", "read the visible page"),
      { ok: false, text: "revyl step failed: HTTP 403" });
  });
});


test("stop accepts only a successful primary acknowledgement and avoids unnecessary fallback", async () => {
  const paths: string[] = [];
  await mockFetch(async (input) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    assert.equal(path, `/api/v1/execution/device/sessions/${allocated.sessionId}/stop`);
    return new Response(null, { status: 204 });
  }, async () => {
    await new RevylClient("key").stop(allocated);
    assert.equal(paths.length, 1);
  });
});

test("stop succeeds when workflow cancellation acknowledges cleanup after HTTP or transport failure", async () => {
  for (const primary of ["http", "transport"] as const) {
    const paths: string[] = [];
    await mockFetch(async (input) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      if (path.endsWith("/stop")) {
        if (primary === "transport") throw new Error("PRIVATE_TRANSPORT_ERROR");
        return Response.json({ detail: "PRIVATE_PROVIDER_ERROR" }, { status: 500 });
      }
      assert.equal(path, `/api/v1/execution/device/status/cancel/${allocated.workflowRunId}`);
      return Response.json({ acknowledged: true });
    }, async () => {
      await new RevylClient("key").stop(allocated);
      assert.equal(paths.length, 2);
    });
  }
});

test("failed stop and cancel never resolve or allow a caller to confirm cleanup, including HTTP404", async () => {
  for (const statuses of [[500, 500], [403, 404], [404, 404], [200, 200]] as const) {
    let calls = 0, confirmed = false;
    await mockFetch(async () => {
      const index = calls++;
      if (statuses[0] === 200) throw new Error("PRIVATE_TRANSPORT_ERROR");
      return Response.json({ detail: "PRIVATE_STOP_ERROR" }, { status: statuses[index]! });
    }, async () => {
      const pending = new RevylClient("key").stop(allocated).then(() => { confirmed = true; });
      await assert.rejects(pending, /^Error: revyl_stop_failed$/);
      assert.equal(confirmed, false);
      assert.equal(calls, 2);
    });
  }
  await mockFetch(async () => Response.json({}, { status: 404 }), async () => {
    await assert.rejects(new RevylClient("key").stop({ sessionId: allocated.sessionId, workflowRunId: "" }), /^Error: revyl_stop_failed$/);
  });
});

test("hung cleanup endpoints retain thirty-second request deadlines and report failure after both attempts", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const signals: AbortSignal[] = [];
  await mockFetch(async (_input, options) => {
    signals.push(options!.signal!);
    return new Promise<never>(() => {});
  }, async () => {
    const rejected = assert.rejects(new RevylClient("key").stop(allocated), /^Error: revyl_stop_failed$/);
    await flush();
    assert.equal(signals.length, 1);
    context.mock.timers.tick(30_000);
    await flush();
    assert.equal(signals[0].aborted, true);
    assert.equal(signals.length, 2);
    context.mock.timers.tick(30_000);
    await rejected;
    assert.equal(signals[1].aborted, true);
  });
});


test("native registry patterns accept exact origins and first-party registrable namespaces, including private tenants", () => {
  for (const pattern of ["https://api.company.com", "https://*.company.com", "https://*.company.co.uk", "https://*.tenant.github.io", "https://*.tenant.vercel.app"]) assert.doesNotThrow(() => validateNativeOriginPattern(pattern));
  for (const pattern of ["https://*.com", "https://*.co.uk", "https://*.github.io", "https://*.vercel.app", "https://*.api.company.com", "https://*.www.company.com",
    "https://*company.com", "https://api.*.company.com", "https://*.*.company.com", "https://*.company.com/", "https://*.company.com:443", "https://*.company.com:8443",
    "https://u:p@*.company.com", "http://*.company.com", "https://*.127.0.0.1", "https://127.0.0.1", "https://[::1]", "https://localhost", "https://metadata.internal",
    "https://api.company.com/", "https://api.company.com:443", "https://api.company.com?query=x", "https://api.company.com#hash", "https://api.company.com/path",
    "https://api.company.com.", "https://API.company.com", "https://api.company.com\\private", "https://@api.company.com"]) assert.throws(() => validateNativeOriginPattern(pattern), pattern);
});

test("wildcard origin matching is label-bounded and excludes the registrable base and other private tenants", () => {
  assert.equal(isApprovedNativeOrigin("https://api.company.com", ["https://*.company.com"]), true);
  assert.equal(isApprovedNativeOrigin("https://region.api.company.com", ["https://*.company.com"]), true);
  assert.equal(isApprovedNativeOrigin("https://api.company.co.uk", ["https://*.company.co.uk"]), true);
  assert.equal(isApprovedNativeOrigin("https://api.tenant.github.io", ["https://*.tenant.github.io"]), true);
  assert.equal(isApprovedNativeOrigin("https://company.com", ["https://*.company.com"]), false);
  assert.equal(isApprovedNativeOrigin("https://company.com", ["https://*.company.com", "https://company.com"]), true);
  for (const origin of ["https://evilcompany.com", "https://company.com.evil.com", "https://api.company.org", "https://api.othercompany.co.uk", "https://other.github.io",
    "https://api.other.github.io", "https://tenant.github.io", "http://api.company.com", "https://u:p@api.company.com", "https://@api.company.com", "https://api.company.com:443",
    "https://api.company.com:8443", "https://api.company.com/", "https://api.company.com?x=1", "https://api.company.com#x", "https://api.company.com/path", "https://127.0.0.1"]) {
    assert.equal(isApprovedNativeOrigin(origin, ["https://*.company.com", "https://*.tenant.github.io"]), false, origin);
  }
  assert.equal(isApprovedNativeOrigin("https://api.company.com", ["https://*.com"]), false);
  assert.equal(isApprovedNativeOrigin("https://api.company.com", ["https://api.company.com", "https://*.com"]), false);
  assert.equal(isApprovedNativeOrigin("https://other.company.com", ["https://api.company.com"]), false);
});

test("reviewed native namespaces normalize observed regional API hosts without admitting lookalikes or base origins", () => {
  const regional = ["https://guc-spclient.spotify.com", "https://gew1-spclient.spotify.com", "https://dealer.spotify.com"];
  const denied = ["https://spotify.com", "https://guc-spclient.spotify.com.attacker.com", "https://attacker-spotify.com", "https://accounts.unrelated.com", "http://guc-spclient.spotify.com", "https://guc-spclient.spotify.com:8443", "https://user:pass@guc-spclient.spotify.com", "https://127.0.0.1"];
  const artifact = parseRevylNetwork(capture([...regional, ...denied].map((host) => request({ url: `${host}/api/items`, request_headers: {} }))));
  const normalized = normalizeRevylNetwork(artifact, { ...config, approvedOrigins: ["https://*.spotify.com"] });
  assert.deepEqual(normalized.entries.map((value) => new URL(value.url).origin), regional);
  assert.equal(normalized.session.headers?.authorization, undefined);
  assert.ok(!JSON.stringify(normalized.entries).includes("PRIVATE_AUTH_TOKEN"));
  assert.throws(() => normalizeRevylNetwork(artifact, { ...config, approvedOrigins: ["https://*.com"] }));
});

test("namespace matching keeps the existing cross-origin credential-conflict guard", () => {
  const artifact = parseRevylNetwork(capture([request({ url: "https://guc-spclient.spotify.com/api/items" }),
    request({ url: "https://gew1-spclient.spotify.com/api/items", request_headers: { authorization: "Bearer PRIVATE_OTHER_REGION" } })]));
  assert.throws(() => normalizeRevylNetwork(artifact, { ...config, approvedOrigins: ["https://*.spotify.com"] }), /revyl_conflicting_capture_auth/);
});

test("shared cross-origin tokens cannot later rotate into another origin's flat session", () => {
  const artifact = parseRevylNetwork(capture([
    request(),
    request({ url: "https://www.acme.com/api/items" }),
    request({ url: "https://www.acme.com/api/items", request_headers: { authorization: "Bearer PRIVATE_ROTATED" } }),
  ]));
  assert.throws(() => normalizeRevylNetwork(artifact, { ...config, approvedOrigins: [origin, "https://www.acme.com"] }), /revyl_conflicting_capture_auth/);
});

test("different cookie names and different header names cannot combine credentials across origins", () => {
  for (const [first, second] of [
    [{ cookie: "sid=PRIVATE_A" }, { cookie: "other=PRIVATE_B" }],
    [{ authorization: "Bearer PRIVATE_A" }, { "client-token": "PRIVATE_B" }],
  ]) {
    const artifact = parseRevylNetwork(capture([request({ request_headers: first }), request({ url: "https://www.acme.com/api/items", request_headers: second })]));
    assert.throws(() => normalizeRevylNetwork(artifact, { ...config, approvedOrigins: [origin, "https://www.acme.com"], sessionHeaders: ["cookie", "authorization", "client-token"] }), /revyl_conflicting_capture_auth/);
  }
});
