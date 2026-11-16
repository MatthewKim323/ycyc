/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { captureConfigFor } from "../../src/lib/capture/apps";
import { buildRecorderScript, type RecorderMessage } from "../../src/lib/capture/recorder";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function drain() {
  // Drain actual promises without running the recorder's polling/debounce timers.
  for (let i = 0; i < 3; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

function fixture(fetch: (input: string, init?: RequestInit) => Promise<Response>, empty = false) {
  const config = captureConfigFor("myfitnesspal");
  const messages: RecorderMessage[] = [];
  let timer = 0;
  const window = {
    fetch,
    location: { href: config.webOrigin + "/food/diary", pathname: "/food/diary" },
    ReactNativeWebView: { postMessage: (data: string) => messages.push(JSON.parse(data)) },
    addEventListener() {},
    history: { pushState() {}, replaceState() {} },
    navigator: {},
  };
  const context = {
    window,
    document: { cookie: "", title: "Diary", readyState: "loading", addEventListener() {} },
    URL, URLSearchParams, Headers, Request, Response, Promise, Date, Intl, ArrayBuffer,
    setTimeout: () => ++timer,
    clearTimeout() {},
    setInterval: () => ++timer,
    clearInterval() {},
  };
  runInNewContext(buildRecorderScript({ ...config, sessionProbes: empty ? [] : config.sessionProbes }), context);
  const bridge = (window as typeof window & { __yuzu: {
    runSessionProbes: (id: string) => unknown;
    session: { headers: Record<string, string>; storage: Record<string, string> };
  } }).__yuzu;
  assert.equal(typeof bridge?.runSessionProbes, "function", "real recorder should initialize");
  return { bridge, messages, acknowledgments: () => messages.filter((message) => message.t === "probe") };
}

const accessToken = "private-mfp-probe-access-token";
const tokenBody = { access_token: accessToken, user_id: "mfp-user-42", expires_in: 3600 };

function assertSafeAcknowledgment(message: RecorderMessage, id: string, ok: boolean) {
  assert.equal(message.t, "probe");
  assert.deepEqual(Object.keys(message).sort(), ["__yuzu", "id", "ok", "status", "t"]);
  if (message.t !== "probe") throw new Error("expected probe acknowledgment");
  assert.equal(message.id, id);
  assert.equal(message.ok, ok);
  assert.equal(typeof message.status, "number");
  assert.ok(!JSON.stringify(message).includes(accessToken));
}

test("session probes acknowledge only after delayed token fields are saved and posted", async () => {
  const network = deferred<Response>();
  const body = deferred<typeof tokenBody>();
  const calls: { input: string; init?: RequestInit }[] = [];
  const f = fixture((input, init) => { calls.push({ input, init }); return network.promise; });
  f.bridge.runSessionProbes("session-before-navigation");
  await drain();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, "/user/auth_token?refresh=true");
  assert.equal(calls[0].init?.credentials, "include");
  assert.equal(f.acknowledgments().length, 0, "navigation must wait for the network response");

  const response = new Response(JSON.stringify(tokenBody), { status: 200, headers: { "content-type": "application/json" } });
  Object.defineProperty(response, "json", { value: () => body.promise });
  network.resolve(response);
  await drain();
  assert.equal(f.acknowledgments().length, 0, "HTTP headers alone must not release navigation");
  assert.equal(f.bridge.session.headers.authorization, undefined);

  body.resolve(tokenBody);
  await drain();
  const acknowledgments = f.acknowledgments();
  assert.equal(acknowledgments.length, 1);
  assertSafeAcknowledgment(acknowledgments[0], "session-before-navigation", true);
  assert.equal(f.bridge.session.headers.authorization, "Bearer " + accessToken);
  assert.equal(f.bridge.session.headers["mfp-user-id"], tokenBody.user_id);
  const sessionIndex = f.messages.findIndex((message) => message.t === "session" && message.headers.authorization === "Bearer " + accessToken);
  assert.ok(sessionIndex >= 0, "raw session must be handed to native before capture can navigate");
  assert.ok(sessionIndex < f.messages.indexOf(acknowledgments[0]));
  for (const message of f.messages.filter((message) => message.t !== "session")) {
    assert.ok(!JSON.stringify(message).includes(accessToken), "tokens belong only in private session messages");
  }
});

test("network failure completes with one unsuccessful, secret-free acknowledgment", async () => {
  const f = fixture(async () => { throw new Error("network unavailable " + accessToken); });
  f.bridge.runSessionProbes("network-failed");
  await drain();
  assert.equal(f.acknowledgments().length, 1);
  assertSafeAcknowledgment(f.acknowledgments()[0], "network-failed", false);
  assert.equal(f.acknowledgments()[0].status, 0);
  assert.equal(f.bridge.session.headers.authorization, undefined);
});

test("HTTP failure and successful responses without token fields do not report a saved session", async () => {
  for (const [status, body] of [[401, { error: "sign in required" }], [200, {}]] as const) {
    const f = fixture(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
    f.bridge.runSessionProbes("no-session-" + status);
    await drain();
    assert.equal(f.acknowledgments().length, 1);
    assertSafeAcknowledgment(f.acknowledgments()[0], "no-session-" + status, false);
    assert.equal(f.bridge.session.headers.authorization, undefined);
  }
});

test("apps without session probes acknowledge clean completion without a request", async () => {
  let requests = 0;
  const f = fixture(async () => { requests++; throw new Error("unexpected fetch"); }, true);
  f.bridge.runSessionProbes("no-probes");
  await drain();
  assert.equal(requests, 0);
  assert.equal(f.acknowledgments().length, 1);
  assertSafeAcknowledgment(f.acknowledgments()[0], "no-probes", true);
});
