import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { brotliCompressSync, gzipSync } from "node:zlib";
import type { ClientRequest, IncomingMessage } from "node:http";
import { extractResearchCandidates, inspectPublicSource, isPublicIp, MAX_SOURCE_BYTES, MAX_PUBLIC_SOURCE_BYTES, MAX_SOURCE_EXCERPT_BYTES, pinnedLookup, resolvePublicAddress, safePublicSourceFetch, safeResearchFetch, safeAppRequest, safeNativeArtifactFetch, safeNativePackageFetch, MAX_WRITE_BYTES, validateResearchUrl, type ResearchTransport, type ResearchRequestOptions, type AppWriteMethod } from "../../convex/lib/learningHttp";

const origin = "https://app.example.com";
type FixtureOptions = { status?: number; headers?: Record<string, string>; chunks?: Buffer[]; error?: boolean; stall?: boolean; stallBody?: boolean; abort?: boolean };
function fixture(options: FixtureOptions = {}) {
  let requests = 0, lookups = 0;
  let sent: ResearchRequestOptions | undefined;
  let requestedUrl: string | undefined;
  let body = "";
  const io: ResearchTransport = {
    resolve: async () => { lookups++; return [{ address: "8.8.8.8", family: 4 }]; },
    request: (url, config, callback) => {
      requests++; sent = config; requestedUrl = url.href;
      const request = new PassThrough();
      request.on("data", (chunk: Buffer) => { body += chunk.toString("utf8"); });
      request.on("finish", () => {
        if (options.error) { request.emit("error", new Error("private backend detail")); return; }
        if (options.stall) return;
        const response = Object.assign(new PassThrough(), { statusCode: options.status ?? 200, headers: { "content-type": "application/json; charset=utf-8", ...options.headers } });
        callback(response as unknown as IncomingMessage);
        for (const chunk of options.chunks ?? [Buffer.from('{"ok":true}')]) response.write(chunk);
        if (options.abort) { response.emit("aborted"); return; }
        if (!options.stallBody) response.end();
      });
      return request as unknown as ClientRequest;
    },
  };
  return { io, get requests() { return requests; }, get lookups() { return lookups; }, get sent() { return sent; }, get body() { return body; }, get requestedUrl() { return requestedUrl; } };
}

function lookupResult(lookup: ReturnType<typeof pinnedLookup>, all: boolean): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    lookup("app.example.com", { all }, (error, value, family) => error ? reject(error) : resolve([value, family]));
  });
}

test("URL validation enforces HTTPS and the exact canonical origin before network access", () => {
  assert.equal(validateResearchUrl(origin + "/docs?q=one%20two", origin).href, origin + "/docs?q=one%20two");
  assert.equal(validateResearchUrl(origin + ":443/docs", origin + "/").origin, origin);
  for (const url of ["http://app.example.com/api", "https://app.example.com:444/api", "https://other.example.com/api", "https://app.example.com.evil.com/api", "https://user:password@app.example.com/api", origin + "/api#token", origin + "/{{endpoint}}", origin + "/%7B%7Bendpoint%7D%7D", origin + "/%25257bvalue%25257d", origin + "/%0d%0aHost:evil", origin + "\\@other.example.com/api"]) {
    assert.throws(() => validateResearchUrl(url, origin), /learning_/);
  }
  assert.throws(() => validateResearchUrl(origin + "/api", origin + "/other"), /invalid_origin/);
  for (const url of ["https://127.0.0.1/", "https://2130706433/", "https://0x7f000001/", "https://[::ffff:7f00:1]/", "https://localhost/", "https://metadata.internal/"]) assert.throws(() => validateResearchUrl(url, new URL(url).origin), /learning_/);
});

test("public IP policy excludes private, reserved, mapped and transition address families", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "2001:4860:4860::8888"]) assert.equal(isPublicIp(ip), true, ip);
  for (const ip of ["0.0.0.0", "10.0.0.1", "100.64.0.1", "100.127.255.255", "127.1.2.3", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.0.1", "192.0.2.1", "192.88.99.1", "192.168.1.1", "198.18.0.1", "198.19.1.1", "198.51.100.2", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::", "::1", "::ffff:127.0.0.1", "::FFFF:7F00:1", "::ffff:8.8.8.8", "64:ff9b::a00:1", "fc00::1", "fd00:ec2::254", "fe80::1", "fe80::1%en0", "fec0::1", "ff02::1", "2001::1", "2001:20::1", "2001:db8::1", "2002:7f00:1::", "3fff:fff::1", "not an IP"]) assert.equal(isPublicIp(ip), false, ip);
});

test("DNS rejects empty, mixed or invalid answers and pins both lookup signatures without another resolution", async () => {
  for (const addresses of [[], [{ address: "127.0.0.1", family: 4 }], [{ address: "8.8.8.8", family: 4 }, { address: "::ffff:7f00:1", family: 6 }], [{ address: "8.8.8.8", family: 6 }]]) {
    await assert.rejects(resolvePublicAddress("app.example.com", async () => addresses), /private_address/);
  }
  const chosen = await resolvePublicAddress("app.example.com", async () => [{ address: "2606:4700:4700::1111", family: 6 }, { address: "8.8.8.8", family: 4 }]);
  assert.deepEqual(chosen, { address: "8.8.8.8", family: 4 });
  const lookup = pinnedLookup(chosen);
  assert.deepEqual(await lookupResult(lookup, false), ["8.8.8.8", 4]);
  assert.deepEqual(await lookupResult(lookup, true), [[{ address: "8.8.8.8", family: 4 }], undefined]);
  assert.throws(() => pinnedLookup({ address: "::1", family: 6 }), /private_address/);
});

test("fetches a bounded body with a pinned fresh TLS connection and no ambient cookies or auth", async () => {
  const f = fixture({ chunks: [Buffer.from('{"message":"hé'), Buffer.from('llo"}')] });
  const result = await safeResearchFetch(origin + "/api", origin, undefined, f.io);
  assert.deepEqual(result, { url: origin + "/api", status: 200, contentType: "application/json", text: '{"message":"héllo"}' });
  assert.equal(f.requests, 1); assert.equal(f.lookups, 1);
  assert.equal(f.sent?.method, "GET"); assert.equal(f.sent?.agent, false); assert.equal(f.sent?.autoSelectFamily, false);
  assert.equal(f.sent?.rejectUnauthorized, undefined);
  assert.deepEqual(await lookupResult(f.sent!.lookup!, false), ["8.8.8.8", 4]);
  const headers = f.sent?.headers as Record<string, string>;
  assert.equal(headers.cookie, undefined); assert.equal(headers.authorization, undefined); assert.equal(headers["accept-encoding"], "identity");
});

test("does not send requests for private DNS, wrong origins, bad headers or after a DNS deadline", async () => {
  const f = fixture();
  await assert.rejects(safeResearchFetch(origin, origin, undefined, { ...f.io, resolve: async () => [{ address: "169.254.169.254", family: 4 }] }), /learning_fetch_failed/);
  await assert.rejects(safeResearchFetch("https://other.example.com/", origin, undefined, f.io), /origin_mismatch/);
  const badHeaders: Record<string, string>[] = [{ Host: "evil" }, { Connection: "keep-alive" }, { "Proxy-Authorization": "secret" }, { "Content-Length": "2" }, { "Transfer-Encoding": "chunked" }, { "X-Forwarded-Host": "evil" }, { authorization: "Bearer secret\r\nHost:evil" }];
  for (const headers of badHeaders) await assert.rejects(safeResearchFetch(origin, origin, headers, f.io), /invalid_headers/);
  await assert.rejects(safeResearchFetch(origin, origin, undefined, { ...f.io, timeoutMs: 5, resolve: async () => { await new Promise((resolve) => setTimeout(resolve, 20)); return [{ address: "8.8.8.8", family: 4 }]; } }), /fetch_timeout/);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(f.requests, 0);
});

test("server-built credential headers are allowed only on the approved connection", async () => {
  const f = fixture();
  await safeResearchFetch(origin + "/api/me", origin, { Authorization: "Bearer private-server-token", Cookie: "session=private", "x-app-client": "web" }, f.io);
  assert.deepEqual(f.sent?.headers, { accept: "text/html, application/javascript, application/json, text/plain", "accept-encoding": "identity", authorization: "Bearer private-server-token", cookie: "session=private", "x-app-client": "web" });
});

test("rejects redirects without following even same-origin locations, unsupported encodings and non-source types", async () => {
  for (const options of [{ status: 302, headers: { location: origin + "/next" } }, { status: 307, headers: { location: "http://169.254.169.254/" } }]) {
    const f = fixture(options);
    await assert.rejects(safeResearchFetch(origin, origin, undefined, f.io), /redirect_rejected/);
    assert.equal(f.requests, 1);
  }
  await assert.rejects(safeResearchFetch(origin, origin, undefined, fixture({ headers: { "content-type": "application/octet-stream" } }).io), /unsupported_content/);
  await assert.rejects(safeResearchFetch(origin, origin, undefined, fixture({ headers: { "content-encoding": "gzip" } }).io), /unsupported_encoding/);
});

test("enforces declared and streamed byte caps, valid UTF-8, network failures and the total response deadline", async () => {
  await assert.rejects(safeResearchFetch(origin, origin, undefined, fixture({ headers: { "content-length": String(MAX_SOURCE_BYTES + 1) } }).io), /source_too_large/);
  await assert.rejects(safeResearchFetch(origin, origin, undefined, fixture({ chunks: [Buffer.alloc(MAX_SOURCE_BYTES), Buffer.from("x")] }).io), /source_too_large/);
  await assert.rejects(safeResearchFetch(origin, origin, undefined, fixture({ chunks: [Buffer.from([0xff])] }).io), /invalid_text/);
  await assert.rejects(safeResearchFetch(origin, origin, undefined, fixture({ error: true }).io), /^Error: learning_fetch_failed$/);
  await assert.rejects(safeResearchFetch(origin, origin, undefined, { ...fixture({ stall: true }).io, timeoutMs: 5 }), /fetch_timeout/);
  await assert.rejects(safeResearchFetch(origin, origin, undefined, { ...fixture({ stallBody: true }).io, timeoutMs: 5 }), /fetch_timeout/);
  await assert.rejects(safeResearchFetch(origin, origin, undefined, fixture({ abort: true }).io), /fetch_failed/);
});

test("extractor finds linked public scripts and same-origin API evidence without evaluating text or leaking secret queries", () => {
  const text = `<base href="https://evil.example/"><script src="/assets/main.js?v=2&amp;lang=en"></script><link rel="modulepreload" href="./lazy.js"><script src="https://evil.example/x.js"></script><script src="/secret.js?api_key=private"></script><script src="/%7B%7Bdynamic%7D%7D"></script><script>throw new Error('must never run'); const a='/api/me'; const b="https://app.example.com/api/items"; const c='/api/keys?token=private'; const d='/api/{{dynamic}}'; const e='https://evil.example/api/me'; const f="\\/api\\/escaped";</script>`;
  assert.deepEqual(extractResearchCandidates(text, origin + "/docs/index", origin), {
    sources: [origin + "/assets/main.js?v=2&lang=en", origin + "/docs/lazy.js"],
    endpoints: [origin + "/api/me", origin + "/api/items", origin + "/api/escaped"],
  });
});

test("extractor bounds source text and deduplicates/caps candidate lists", () => {
  const text = Array.from({ length: 100 }, (_, index) => `<script src="/source${index}.js"></script> const x${index}='/api/item${index}';`).join("");
  const result = extractResearchCandidates(text, origin, origin);
  assert.equal(result.sources.length, 40); assert.equal(result.endpoints.length, 40);
  assert.deepEqual(extractResearchCandidates(" ".repeat(MAX_PUBLIC_SOURCE_BYTES) + "'/api/late'", origin, origin), { sources: [], endpoints: [] });
});

test("linked CDN modules are discovery only; app endpoint origin and credential URL restrictions stay strict", () => {
  const cdn = "https://static.example.com";
  const source = `<script src="${cdn}/main.js"></script><script src="https://127.0.0.1/private.js"></script><script src="https://user:password@static.example.com/secret.js"></script><script src="${cdn}/auth.js?access_token=private"></script><script src="${cdn}/file.wasm"></script>
    import Thing from "./chunks/a.mjs"; export { Thing } from "https://other.example.com/b.js";
    import("./chunks/c.js"); require("./chunks/d.js"); importScripts("./chunks/e.js");
    const arbitraryString = "https://not-linked.example.com/no.js";
    const dynamic = import("./chunk-" + token + ".js");
    const endpoint = "https://app.example.com/api/items"; const foreignEndpoint = "https://other.example.com/api/private";
    const relativeEndpoint = "/api/on-the-cdn";`;
  assert.deepEqual(extractResearchCandidates(source, cdn + "/assets/root.mjs", cdn, origin), {
    sources: [cdn + "/main.js", cdn + "/assets/chunks/a.mjs", "https://other.example.com/b.js", cdn + "/assets/chunks/c.js", cdn + "/assets/chunks/d.js", cdn + "/assets/chunks/e.js"],
    endpoints: [origin + "/api/items"],
  });
});

test("public sources allow larger code bundles without expanding authenticated app responses or carrying credentials", async () => {
  const body = Buffer.alloc(MAX_SOURCE_BYTES + 1, " ");
  const f = fixture({ headers: { "content-type": "application/javascript", "content-length": String(body.length) }, chunks: [body] });
  const result = await safePublicSourceFetch("https://static.example.com/main.js", "https://static.example.com", f.io);
  assert.equal(Buffer.byteLength(result.text), body.length);
  assert.equal(f.requests, 1); assert.equal(f.lookups, 1);
  assert.deepEqual(f.sent?.headers, { accept: "text/html, application/javascript, application/json, text/plain", "accept-encoding": "identity" });
  assert.deepEqual(await lookupResult(f.sent!.lookup!, false), ["8.8.8.8", 4]);
  await assert.rejects(safeResearchFetch(origin, origin, { authorization: "Bearer server-only" }, fixture({ chunks: [body] }).io), /source_too_large/);
  for (const options of [
    { headers: { "content-length": String(MAX_PUBLIC_SOURCE_BYTES + 1) } },
    { chunks: [Buffer.alloc(MAX_PUBLIC_SOURCE_BYTES), Buffer.from("x")] },
  ]) await assert.rejects(safePublicSourceFetch(origin, origin, fixture(options).io), /source_too_large/);
});

test("public source inspection retains DNS pinning, redirect rejection, deadlines and private URL refusal", async () => {
  const f = fixture();
  await assert.rejects(safePublicSourceFetch("https://static.example.com/main.js?token=private", "https://static.example.com", f.io), /private_source_url/);
  await assert.rejects(safePublicSourceFetch("https://user:password@static.example.com/main.js", "https://static.example.com", f.io), /invalid_url/);
  await assert.rejects(safePublicSourceFetch("https://other.example.com/main.js", origin, f.io), /origin_mismatch/);
  for (const addresses of [[{ address: "169.254.169.254", family: 4 }], [{ address: "8.8.8.8", family: 4 }, { address: "::ffff:7f00:1", family: 6 }]]) {
    await assert.rejects(safePublicSourceFetch(origin, origin, { ...f.io, resolve: async () => addresses }), /fetch_failed/);
  }
  await assert.rejects(safePublicSourceFetch(origin, origin, { ...f.io, timeoutMs: 5, resolve: async () => { await new Promise((resolve) => setTimeout(resolve, 20)); return [{ address: "8.8.8.8", family: 4 }]; } }), /fetch_timeout/);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(f.requests, 0);
  const redirected = fixture({ status: 302, headers: { location: "http://169.254.169.254/metadata" } });
  await assert.rejects(safePublicSourceFetch(origin, origin, redirected.io), /redirect_rejected/);
  assert.equal(redirected.requests, 1);
  await assert.rejects(safePublicSourceFetch(origin, origin, fixture({ headers: { "content-encoding": "deflate" } }).io), /unsupported_encoding/);
});

test("only public sources decode CDN gzip/br with independent wire and decoded caps", async () => {
  const text = "query ReadItems { items } " + " ".repeat(MAX_SOURCE_BYTES);
  for (const [encoding, compress] of [["gzip", gzipSync], ["br", brotliCompressSync]] as const) {
    const compressed = compress(Buffer.from(text));
    const options = { headers: { "content-encoding": encoding, "content-length": String(compressed.length) }, chunks: [compressed] };
    assert.equal((await safePublicSourceFetch(origin, origin, fixture(options).io)).text, text);
    await assert.rejects(safeResearchFetch(origin, origin, { authorization: "Bearer private" }, fixture(options).io), /unsupported_encoding/);
    const bomb = compress(Buffer.alloc(MAX_PUBLIC_SOURCE_BYTES + 1, "x"));
    const f = fixture({ headers: { "content-encoding": encoding }, chunks: [bomb] });
    await assert.rejects(safePublicSourceFetch(origin, origin, f.io), /source_too_large/);
    assert.equal(f.requests, 1);
    await assert.rejects(safePublicSourceFetch(origin, origin, fixture({ headers: { "content-encoding": encoding }, chunks: [compressed.subarray(0, Math.floor(compressed.length / 2))] }).io), /invalid_encoding/);
    await assert.rejects(safePublicSourceFetch(origin, origin, fixture({ headers: { "content-encoding": encoding, "content-length": String(MAX_PUBLIC_SOURCE_BYTES + 1) }, chunks: [compressed] }).io), /source_too_large/);
    await assert.rejects(safePublicSourceFetch(origin, origin, { ...fixture({ headers: { "content-encoding": encoding }, chunks: [compressed], stallBody: true }).io, timeoutMs: 5 }), /fetch_timeout/);
  }
});

test("source excerpts expose bounded untrusted query windows and metadata without executing source text", () => {
  const hash = "a".repeat(64);
  const code = "é".repeat(3000) + `; query ReadItems($limit:Int){ items } mutation DeleteItem { deleteItem } subscription Changes { changes } const proof={sha256Hash:"${hash}"}; throw new Error('never execute');`;
  const initial = inspectPublicSource(code, origin + "/main.js", origin);
  assert.ok(Buffer.byteLength(initial.excerpt.text) <= MAX_SOURCE_EXCERPT_BYTES);
  assert.equal(initial.excerpt.startByte, 0); assert.equal(initial.excerpt.matched, false);
  const result = inspectPublicSource(code, origin + "/main.js", origin, "READITEMS");
  assert.equal(result.excerpt.untrusted, true); assert.equal(result.excerpt.matched, true);
  assert.ok(result.excerpt.startByte > 0); assert.ok(result.excerpt.text.includes("query ReadItems"));
  assert.ok(!result.excerpt.text.includes("�"));
  assert.ok(Buffer.byteLength(result.excerpt.text) <= MAX_SOURCE_EXCERPT_BYTES);
  assert.equal(result.excerpt.endByte - result.excerpt.startByte, Buffer.byteLength(result.excerpt.text));
  assert.equal(result.excerpt.totalBytes, Buffer.byteLength(code));
  assert.deepEqual(result.operations.map(({ kind, name }) => ({ kind, name })), [{ kind: "query", name: "ReadItems" }, { kind: "mutation", name: "DeleteItem" }, { kind: "subscription", name: "Changes" }]);
  assert.deepEqual(result.persistedQueryHashes, [hash]);
  for (const query of ["x".repeat(81), "private\nheader", "null\0byte"]) assert.throws(() => inspectPublicSource(code, origin, origin, query), /invalid_source_query/);
  const missing = inspectPublicSource(code, origin, origin, "no-match");
  assert.equal(missing.excerpt.matched, false); assert.equal(missing.excerpt.startByte, 0);
  const many = inspectPublicSource(Array.from({ length: 100 }, (_, i) => `query Q${i}{items}; {sha256Hash:"${i.toString(16).padStart(64, "0")}"}`).join(""), origin, origin);
  assert.equal(many.operations.length, 40); assert.equal(many.persistedQueryHashes.length, 40);
});

test("extractor discovers same-origin documentation anchors and literal JSON API paths", () => {
  const text = `<a href="/docs/start#intro">Docs</a><a href="/developer/reference">Developer</a><a href="/api/reference">API</a><a href="/reference">Reference</a><a href="/openapi.json">Spec</a><a href="/account">Account</a><a href="https://evil.example/docs">Foreign docs</a><a href="/docs?token=private">Secret</a><script>const a='/search.json?q=books'; const b="https://app.example.com/data/status.json"; const c='/credentials.json?api_key=private'; const d='https://evil.example/search.json';</script>`;
  assert.deepEqual(extractResearchCandidates(text, origin, origin), {
    sources: [origin + "/docs/start", origin + "/developer/reference", origin + "/api/reference", origin + "/reference", origin + "/openapi.json"],
    endpoints: [origin + "/api/reference", origin + "/openapi.json", origin + "/search.json?q=books", origin + "/data/status.json"],
  });
});


test("writes send each approved JSON method once with exact bytes and server-computed headers", async () => {
  const body = '{"name":"héllo"}';
  for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
    const f = fixture();
    const result = await safeAppRequest(origin + "/api/items", origin, { method, headers: { Authorization: "Bearer server-built", "Content-Type": "text/plain", Accept: "text/html" }, body }, f.io);
    assert.equal(result.status, 200);
    assert.equal(f.requests, 1); assert.equal(f.lookups, 1);
    assert.equal(f.sent?.method, method); assert.equal(f.sent?.agent, false);
    assert.equal(f.sent?.autoSelectFamily, false);
    assert.deepEqual(await lookupResult(f.sent!.lookup!, false), ["8.8.8.8", 4]);
    assert.equal(f.body, body);
    const headers = f.sent?.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer server-built");
    assert.equal(headers.accept, "application/json"); assert.equal(headers["content-type"], "application/json");
    assert.equal(headers["content-length"], String(Buffer.byteLength(body)));
    assert.equal(headers["accept-encoding"], "identity");
  }
});

test("write validation refuses unsafe methods, bodies, origins and header overrides before DNS or HTTP", async () => {
  const f = fixture();
  for (const method of ["GET", "HEAD", "CONNECT", "post"]) await assert.rejects(safeAppRequest(origin, origin, { method: method as AppWriteMethod, headers: {} }, f.io), /invalid_method/);
  for (const body of ["not JSON private-secret", JSON.stringify("é".repeat(MAX_WRITE_BYTES / 2))]) await assert.rejects(safeAppRequest(origin, origin, { method: "POST", headers: {}, body }, f.io), /^Error: learning_invalid_body$/);
  await assert.rejects(safeAppRequest("https://evil.example.com/api", origin, { method: "POST", headers: {}, body: "{}" }, f.io), /origin_mismatch/);
  const badHeaders: Record<string, string>[] = [{ "Content-Length": "2" }, { "Transfer-Encoding": "chunked" }, { Host: "evil.example" }, { "Proxy-Authorization": "private" }, { "Proxy-Connection": "keep-alive" }, { "X-HTTP-Method-Override": "GET" }, { "X-Method-Override": "GET" }, { "X-Original-URL": "/admin" }, { "X-Forwarded-Host": "evil.example" }, { Authorization: "private\r\nHost:evil.example" }];
  for (const headers of badHeaders) await assert.rejects(safeAppRequest(origin, origin, { method: "PATCH", headers, body: "{}" }, f.io), /invalid_headers/);
  assert.equal(f.requests, 0); assert.equal(f.lookups, 0);
});

test("writes preserve network guards and reject private/mapped DNS answers before sending", async () => {
  for (const address of [{ address: "10.0.0.1", family: 4 }, { address: "::ffff:7f00:1", family: 6 }]) {
    const f = fixture();
    await assert.rejects(safeAppRequest(origin, origin, { method: "POST", headers: {}, body: "{}" }, { ...f.io, resolve: async () => [address] }), /learning_private_address/);
    assert.equal(f.requests, 0);
  }
});

test("write response loss, redirects and rejected responses have uncertain outcomes and are never retried", async () => {
  const failures: FixtureOptions[] = [
    { error: true }, { abort: true }, { stall: true }, { stallBody: true },
    { status: 307, headers: { location: origin + "/next" } },
    { headers: { "content-type": "text/html" }, chunks: [Buffer.from("private response")] },
    { chunks: [Buffer.from("not JSON private response")] },
    { headers: { "content-encoding": "gzip" } },
    { headers: { "content-length": String(MAX_SOURCE_BYTES + 1) } },
    { chunks: [Buffer.alloc(MAX_SOURCE_BYTES + 1)] },
    { chunks: [Buffer.from([0xff])] },
  ];
  for (const options of failures) {
    const f = fixture(options);
    await assert.rejects(safeAppRequest(origin, origin, { method: "PUT", headers: {}, body: "{}" }, { ...f.io, timeoutMs: 5 }), /^Error: learning_write_outcome_uncertain$/);
    assert.equal(f.requests, 1); assert.equal(f.lookups, 1);
  }
});

test("write deadlines include DNS without a late request, and request construction failures never retry", async () => {
  const f = fixture();
  await assert.rejects(safeAppRequest(origin, origin, { method: "POST", headers: {}, body: "{}" }, { ...f.io, timeoutMs: 5, resolve: async () => { await new Promise((resolve) => setTimeout(resolve, 20)); return [{ address: "8.8.8.8", family: 4 }]; } }), /learning_write_outcome_uncertain/);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(f.requests, 0);
  let attempts = 0;
  await assert.rejects(safeAppRequest(origin, origin, { method: "POST", headers: {}, body: "{}" }, { ...f.io, request: () => { attempts++; throw new Error("private transport detail"); } }), /^Error: learning_write_outcome_uncertain$/);
  assert.equal(attempts, 1);
});

test("writes accept empty/204 replies and return explicit JSON error statuses without retrying", async () => {
  for (const status of [200, 204]) {
    const f = fixture({ status, headers: { "content-type": "" }, chunks: [] });
    assert.deepEqual(await safeAppRequest(origin, origin, { method: "DELETE", headers: {} }, f.io), { url: origin + "/", status, contentType: "", text: "" });
    assert.equal((f.sent?.headers as Record<string, string>)["content-length"], "0");
    assert.equal(f.body, ""); assert.equal(f.requests, 1);
  }
  const f = fixture({ status: 422, headers: { "content-type": "application/problem+json" }, chunks: [Buffer.from('{"error":"rejected"}')] });
  const result = await safeAppRequest(origin, origin, { method: "POST", headers: {}, body: "{}" }, f.io);
  assert.equal(result.status, 422); assert.equal(f.requests, 1);
});


test("write request byte limit accepts the exact boundary and never coerces malformed JSON", async () => {
  const body = JSON.stringify({ x: "a".repeat(MAX_WRITE_BYTES - JSON.stringify({ x: "" }).length) });
  assert.equal(Buffer.byteLength(body), MAX_WRITE_BYTES);
  const f = fixture();
  await safeAppRequest(origin, origin, { method: "POST", headers: {}, body }, f.io);
  assert.equal(f.body, body); assert.equal(f.requests, 1);
  await assert.rejects(safeAppRequest(origin, origin, { method: "POST", headers: {}, body: body + " " }, f.io), /learning_invalid_body/);
  assert.equal(f.requests, 1);
});


const nativeSignedUrl = "https://vendor-artifacts.example.com/private/network.json?X-Amz-Credential=FAKE_VENDOR_CREDENTIAL%2Fdate%2Fregion&X-Amz-Signature=FAKE_VENDOR_SIGNATURE&X-Amz-Security-Token=FAKE_VENDOR_SESSION";

test("native storage downloads allow provider-signed query bytes with fresh pinned TLS and no ambient authorization", async () => {
  for (const download of [safeNativeArtifactFetch, safeNativePackageFetch]) {
    const f = fixture({ headers: { "content-type": "application/octet-stream" }, chunks: [Buffer.from('{"requests":[]}')] });
    await download(nativeSignedUrl, f.io);
    assert.equal(f.requestedUrl, nativeSignedUrl);
    assert.equal(f.requests, 1); assert.equal(f.lookups, 1);
    assert.equal(f.sent?.method, "GET"); assert.equal(f.sent?.agent, false);
    assert.equal(f.sent?.autoSelectFamily, false); assert.equal(f.sent?.rejectUnauthorized, undefined);
    assert.deepEqual(await lookupResult(f.sent!.lookup!, false), ["8.8.8.8", 4]);
    assert.deepEqual(f.sent?.headers, { accept: "text/html, application/javascript, application/json, text/plain", "accept-encoding": "identity" });
    assert.equal(f.body, "");
  }
  const publicSource = fixture();
  await assert.rejects(safePublicSourceFetch(nativeSignedUrl, new URL(nativeSignedUrl).origin, publicSource.io), /private_source_url/);
  assert.equal(publicSource.requests, 0);
});

test("native artifacts decode both gzip storage objects and HTTP gzip without changing the exact JSON bytes", async () => {
  const text = '{"requests":[{"url":"https://api.example.com/items","note":"héllo 😀"}]}';
  const encoded = gzipSync(Buffer.from(text));
  const gzipCases: { url: string; headers: Record<string, string> }[] = [
    { url: nativeSignedUrl.replace("network.json?", "network.json.gz?"), headers: { "content-type": "application/octet-stream" } },
    { url: nativeSignedUrl, headers: { "content-type": "application/gzip" } },
    { url: nativeSignedUrl, headers: { "content-type": "application/x-gzip" } },
    { url: nativeSignedUrl, headers: { "content-type": "application/json", "content-encoding": "gzip" } },
  ];
  for (const options of gzipCases) {
    const f = fixture({ headers: { ...options.headers, "content-length": String(encoded.length) }, chunks: [encoded.subarray(0, 7), encoded.subarray(7)] });
    const result = await safeNativeArtifactFetch(options.url, f.io);
    assert.equal(result.text, text);
    assert.equal(Buffer.byteLength(result.text), Buffer.byteLength(text));
    assert.equal(result.status, 200);
    assert.equal(f.requests, 1);
  }
});

test("native artifact compressed and decoded byte budgets fail closed, including corrupt gzip and invalid UTF8", async () => {
  const compressedBomb = gzipSync(Buffer.alloc(MAX_PUBLIC_SOURCE_BYTES + 1, "x"));
  const gzipHeaders = { "content-type": "application/gzip" };
  await assert.rejects(safeNativeArtifactFetch(nativeSignedUrl, fixture({ headers: gzipHeaders, chunks: [compressedBomb] }).io), /source_too_large/);
  await assert.rejects(safeNativeArtifactFetch(nativeSignedUrl, fixture({ headers: { ...gzipHeaders, "content-length": String(MAX_PUBLIC_SOURCE_BYTES + 1) }, chunks: [] }).io), /source_too_large/);
  await assert.rejects(safeNativeArtifactFetch(nativeSignedUrl, fixture({ headers: gzipHeaders, chunks: [Buffer.alloc(MAX_PUBLIC_SOURCE_BYTES + 1)] }).io), /source_too_large/);
  const encoded = gzipSync(Buffer.from('{"requests":[]}'));
  await assert.rejects(safeNativeArtifactFetch(nativeSignedUrl, fixture({ headers: gzipHeaders, chunks: [encoded.subarray(0, encoded.length - 4)] }).io), /invalid_encoding/);
  await assert.rejects(safeNativeArtifactFetch(nativeSignedUrl, fixture({ headers: gzipHeaders, chunks: [gzipSync(Buffer.from([0xff, 0xfe]))] }).io), /invalid_text/);
  await assert.rejects(safeNativeArtifactFetch(nativeSignedUrl, fixture({ headers: { "content-encoding": "deflate" } }).io), /unsupported_encoding/);
});

test("native artifact and package reads reject private or mixed DNS, redirects and unsafe URLs without forwarding a request", async () => {
  for (const download of [safeNativeArtifactFetch, safeNativePackageFetch]) {
    for (const addresses of [[{ address: "127.0.0.1", family: 4 }], [{ address: "169.254.169.254", family: 4 }],
      [{ address: "8.8.8.8", family: 4 }, { address: "::ffff:7f00:1", family: 6 }]]) {
      const f = fixture();
      await assert.rejects(download(nativeSignedUrl, { ...f.io, resolve: async () => addresses }), /^Error: learning_fetch_failed$/);
      assert.equal(f.requests, 0);
    }
    for (const url of ["http://vendor-artifacts.example.com/object", "https://user:FAKE_PASSWORD@vendor-artifacts.example.com/object", "https://127.0.0.1/object", "https://[::1]/object", "https://metadata.internal/object", "https://vendor-artifacts.example.com:8443/object"]) {
      const f = fixture();
      await assert.rejects(download(url, f.io), /learning_/);
      assert.equal(f.requests, 0); assert.equal(f.lookups, 0);
    }
    for (const location of ["http://169.254.169.254/metadata", "https://vendor-artifacts.example.com/next"]) {
      const f = fixture({ status: 302, headers: { location } });
      await assert.rejects(download(nativeSignedUrl, f.io), /^Error: learning_redirect_rejected$/);
      assert.equal(f.requests, 1); assert.equal(f.lookups, 1);
    }
  }
});

test("native package bytes survive invalid UTF8, NULs and chunk boundaries without decoding or decompression", async () => {
  const bytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xfe, 0x80]), Buffer.from(Array.from({ length: 256 }, (_, index) => index))]);
  for (const contentType of ["application/vnd.android.package-archive", "application/octet-stream", "application/zip", "binary/octet-stream"]) {
    const f = fixture({ headers: { "content-type": contentType, "content-length": String(bytes.length) }, chunks: [bytes.subarray(0, 3), bytes.subarray(3, 11), bytes.subarray(11)] });
    const result = await safeNativePackageFetch(nativeSignedUrl, f.io);
    assert.ok(result instanceof Uint8Array);
    assert.equal(result.byteLength, bytes.byteLength);
    assert.deepEqual(Buffer.from(result), bytes);
    assert.equal(f.requests, 1);
  }
  const compressed = gzipSync(bytes);
  await assert.rejects(safeNativePackageFetch(nativeSignedUrl, fixture({ headers: { "content-type": "application/octet-stream", "content-encoding": "gzip" }, chunks: [compressed] }).io), /unsupported_encoding/);
});

test("native packages enforce the 200MiB declared and streamed limit before allocating a combined body", async () => {
  const limit = 200 * 1024 * 1024;
  const declared = fixture({ headers: { "content-type": "application/octet-stream", "content-length": String(limit + 1) }, chunks: [] });
  await assert.rejects(safeNativePackageFetch(nativeSignedUrl, declared.io), /^Error: learning_source_too_large$/);
  assert.equal(declared.requests, 1);
  // Reuse one MiB of memory: the fixture feeds 201 distinct chunk events, so the
  // stream counter must reject before Buffer.concat could allocate >200MiB.
  const chunk = Buffer.alloc(1024 * 1024);
  const streamed = fixture({ headers: { "content-type": "application/octet-stream" }, chunks: Array(201).fill(chunk) });
  await assert.rejects(safeNativePackageFetch(nativeSignedUrl, streamed.io), /^Error: learning_source_too_large$/);
  assert.equal(streamed.requests, 1);
  for (const contentLength of ["-1", "private", "1.5"]) await assert.rejects(safeNativePackageFetch(nativeSignedUrl, fixture({ headers: { "content-type": "application/octet-stream", "content-length": contentLength }, chunks: [] }).io), /source_too_large/);
});

test("native downloads bound DNS and body stalls, preserve static errors and never retry partial transfers", async () => {
  for (const download of [safeNativeArtifactFetch, safeNativePackageFetch]) {
    const delayed = fixture();
    await assert.rejects(download(nativeSignedUrl, { ...delayed.io, timeoutMs: 5, resolve: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20)); return [{ address: "8.8.8.8", family: 4 }];
    } }), /^Error: learning_fetch_timeout$/);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(delayed.requests, 0);
    for (const options of [{ stall: true }, { stallBody: true }, { error: true }, { abort: true }]) {
      const f = fixture({ ...options, headers: { "content-type": "application/octet-stream" } });
      await assert.rejects(download(nativeSignedUrl, { ...f.io, timeoutMs: 5 }), /^Error: learning_fetch_(?:timeout|failed)$/);
      assert.equal(f.requests, 1);
    }
  }
  const rejected = fixture({ status: 403, chunks: [Buffer.from("FAKE_PRIVATE_PROVIDER_ERROR")] });
  await assert.rejects(safeNativePackageFetch(nativeSignedUrl, rejected.io), /^Error: native_package_download_failed$/);
  assert.equal(rejected.requests, 1);
});
