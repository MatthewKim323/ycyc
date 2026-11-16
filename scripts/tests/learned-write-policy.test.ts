/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { capturedWriteSchema, writeArguments, writeEndpointUrl, writeMethod, writePreview } from "../../convex/lib/learnedWritePolicy";

const origin = "https://app.acme.com";
const capture = { name: "CAPTURED_NAME", quantity: 17, enabled: true, optional: null,
  details: { note: "CAPTURED_NOTE" }, rows: [{ label: "CAPTURED_ROW_ONE", count: 13 }, { label: "CAPTURED_ROW_TWO", count: 19 }] };
const fresh = { name: "new name", quantity: 2, enabled: false, optional: null,
  details: { note: "new note" }, rows: [{ label: "new row", count: 4 }] };

test("captured JSON produces nested shapes and required fields, retaining none of the captured values", () => {
  const raw = capturedWriteSchema(JSON.stringify(capture));
  for (const captured of ["CAPTURED_NAME", "CAPTURED_NOTE", "CAPTURED_ROW_ONE", "CAPTURED_ROW_TWO", "17", "13", "19"]) assert.ok(!raw.includes(captured));
  const schema = JSON.parse(raw);
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, Object.keys(capture).sort());
  assert.equal(schema.properties.details.properties.note.type, "string");
  assert.equal(schema.properties.rows.type, "array");
  assert.equal(schema.properties.rows.items.properties.count.type, "number");
  assert.equal(schema.properties.optional.type, "null");
  for (const key of ["default", "const", "enum", "examples"]) assert.ok(!raw.includes(`"${key}"`));
  assert.deepEqual(writeArguments(raw, fresh), fresh);
});

test("every field and nested captured type is required; extra, missing or coerced values never fill from capture", () => {
  const schema = capturedWriteSchema(JSON.stringify(capture));
  for (const input of [undefined, {}, { ...fresh, extra: 1 }, { ...fresh, quantity: "2" }, { ...fresh, enabled: "false" },
    { ...fresh, optional: "null" }, { ...fresh, details: {} }, { ...fresh, details: { note: "new", hidden: true } },
    { ...fresh, rows: [{ label: "new" }] }, { ...fresh, rows: [{ label: "new", count: "4" }] },
    { ...fresh, rows: [{ label: "new", count: 4, extra: 1 }] }, { ...fresh, quantity: Infinity }, { ...fresh, quantity: NaN }]) {
    assert.throws(() => writeArguments(schema, input));
  }
  assert.deepEqual(writeArguments(schema, { ...fresh, rows: [] }), { ...fresh, rows: [] });
});

test("credentials, financial values and execution discriminators are rejected at every schema depth", () => {
  const forbidden = ["password", "accessToken", "credentials", "authorization", "cookie", "sessionId", "apiKey", "csrf", "otp", "signature",
    "card_number", "cvv", "cvc", "securityCode", "price", "currency", "fare", "paymentMethodId", "quoteId", "tip", "balance",
    "query", "mutation", "operationName", "operation", "sql", "command", "script", "code", "action", "method", "url", "uri", "host", "endpoint", "redirect", "callback"];
  for (const field of forbidden) {
    assert.throws(() => capturedWriteSchema(JSON.stringify({ [field]: "PRIVATE_CAPTURE_VALUE" })), field);
    assert.throws(() => capturedWriteSchema(JSON.stringify({ details: { [field]: "PRIVATE_CAPTURE_VALUE" } })), field);
    assert.throws(() => capturedWriteSchema(JSON.stringify({ rows: [{ [field]: "PRIVATE_CAPTURE_VALUE" }] })), field);
    const forged = JSON.stringify({ type: "object", properties: { [field]: { type: "string" } }, required: [field], additionalProperties: false });
    assert.throws(() => writeArguments(forged, { [field]: "new value" }), field);
  }
  for (const field of ["__proto__", "constructor", "prototype"]) assert.throws(() => capturedWriteSchema(`{"${field}":"PRIVATE_CAPTURE_VALUE"}`));
});

test("schemas reject non-JSON bodies, mixed arrays, oversized collections and excessive nesting", () => {
  for (const raw of ["not-json", "null", "[]", "true", JSON.stringify({ rows: [] }), JSON.stringify({ rows: [1, "two"] }),
    JSON.stringify({ rows: [{ a: 1 }, { b: 1 }] }), JSON.stringify({ rows: Array(31).fill(1) }), JSON.stringify({ text: "x".repeat(16_384) }),
    JSON.stringify(Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`field_${index}`, index]))),
    JSON.stringify({ a: { b: { c: { d: { e: { f: 1 } } } } } })]) assert.throws(() => capturedWriteSchema(raw));
  const empty = capturedWriteSchema(undefined);
  assert.deepEqual(writeArguments(empty, {}), {});
  assert.throws(() => writeArguments(empty, { uncaptured: "value" }));
  const strings = capturedWriteSchema('{"note":"old"}');
  assert.throws(() => writeArguments(strings, { note: "x".repeat(2049) }));
  assert.throws(() => writeArguments(strings, { note: "hidden\u0000value" }));
  const array = capturedWriteSchema('{"rows":[1]}');
  assert.throws(() => writeArguments(array, { rows: Array(31).fill(2) }));
});

test("write destination and method are fixed to the captured HTTPS origin and supported verbs", () => {
  const target = `${origin}/api/diary/123?entry_id=456`;
  assert.equal(writeEndpointUrl(target, origin), target);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal(writeMethod(method), method);
  for (const method of [undefined, null, "GET", "HEAD", "OPTIONS", "TRACE", "post", "POST "]) assert.throws(() => writeMethod(method));
  for (const target of ["http://app.acme.com/api/diary", "https://other.acme.com/api/diary", "https://u:p@app.acme.com/api/diary",
    `${origin}:8443/api/diary`, `${origin}/api/diary#fragment`, `${origin}/api/{{destination}}`, `${origin}/api/diary\\other`]) {
    assert.throws(() => writeEndpointUrl(target, origin), target);
  }
});

test("financial/security/GraphQL/command routes remain blocked through repeated URL encoding", () => {
  for (const path of ["/api/billing", "/api/payments/123", "/api/auth", "/api/session", "/api/orders", "/api/rides",
    "/api/transfer", "/graphql", "/api/gql", "/api/rpc", "/api/execute", "/api/command", "/api/run", "/api/eval",
    "/api/%62illing", "/api/%2562illing", "/api/%252562illing", "/api/%25252562illing"]) {
    assert.throws(() => writeEndpointUrl(origin + path, origin), path);
  }
});

test("query parameters cannot select credentials, financial operations, commands or a new endpoint", () => {
  for (const key of ["token", "password", "session", "authorization", "price", "currency", "payment", "method", "action", "command", "url", "redirect", "callback",
    "query", "operationName", "sql", "script", "host", "uri", "endpoint"]) {
    assert.throws(() => writeEndpointUrl(`${origin}/api/diary?${key}=PRIVATE_QUERY_VALUE`, origin), key);
  }
});

test("one-time preview includes the full fixed query and new body, within an actual 4 KiB UTF-8 budget", () => {
  const args = { name: "new entry", details: { note: "新しい".repeat(30) }, enabled: false, rows: [{ count: 2 }] };
  const preview = writePreview("PATCH", `${origin}/api/diary/123?entry_id=456&date=2026-11-15`, args);
  assert.deepEqual(preview, { method: "PATCH", path: "/api/diary/123", args: { query: { entry_id: "456", date: "2026-11-15" }, body: args } });
  assert.ok(Buffer.byteLength(JSON.stringify(preview), "utf8") <= 4096);
  assert.ok(!JSON.stringify(preview).includes(origin));
  assert.throws(() => writePreview("POST", `${origin}/api/diary`, { first: "a".repeat(2048), second: "b".repeat(2048) }));
  assert.throws(() => writePreview("POST", `${origin}/api/diary`, { note: "界".repeat(1400) }));
  const exactlyReviewable = { first: "a".repeat(1800), second: "b".repeat(1800) };
  assert.deepEqual(writePreview("POST", `${origin}/api/diary`, exactlyReviewable).args.body, exactlyReviewable);
});

test("camel-case financial and account-security action paths cannot bypass protected-route classification", () => {
  for (const path of ["/api/createOrder", "/api/startRide", "/api/updatePayment", "/api/createBooking", "/api/changePassword"]) {
    assert.throws(() => writeEndpointUrl(origin + path, origin), path);
  }
});
