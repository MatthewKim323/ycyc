/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { capturedOperation, operationBody, operationEndpointUrl } from "../../convex/lib/capturedOperationPolicy";
import { writeEndpointUrl } from "../../convex/lib/learnedWritePolicy";

const origin = "https://app.acme.com";
const hash = async (query: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(query))), (b) => b.toString(16).padStart(2, "0")).join("");
const capture = (input: unknown) => capturedOperation(JSON.stringify(input));
const persisted = (sha256Hash = "a".repeat(64)) => ({ persistedQuery: { version: 1, sha256Hash } });
const query = "query Catalog($offset: Int!, $includeDetails: Boolean!) { items(offset: $offset) { ...Details } } fragment Details on Item { id name details @include(if: $includeDetails) { label } __typename }";

test("a parsed query with fragments yields read-only immutable protocol fields and no captured variables", async () => {
  const result = await capture({ query, operationName: "Catalog", variables: { offset: 731, includeDetails: true } });
  assert.equal(result.readOnly, true);
  assert.equal(result.operationName, "Catalog");
  assert.deepEqual(JSON.parse(result.requestEnvelopeJson), { query, operationName: "Catalog" });
  assert.ok(!result.requestSchemaJson.includes("731"));
  assert.ok(!result.requestEnvelopeJson.includes("731"));
  const fixed = result.requestEnvelopeJson;
  assert.deepEqual(JSON.parse(operationBody(fixed, { offset: 2, includeDetails: false }, result.requestSchemaJson)),
    { query, operationName: "Catalog", variables: { includeDetails: false, offset: 2 } });
  assert.equal(result.requestEnvelopeJson, fixed);
  const forgedSchema = JSON.stringify({ type: "object", properties: { wallet: { type: "string" } }, required: ["wallet"], additionalProperties: false });
  assert.throws(() => operationBody(fixed, { wallet: "new financial value" }, forgedSchema));
  for (const args of [{ offset: 2 }, { offset: "2", includeDetails: false }, { offset: 2, includeDetails: false, query: "mutation { erase }" }]) {
    assert.throws(() => operationBody(fixed, args, result.requestSchemaJson));
  }
});

test("full queries retain original bytes and must match any supplied persisted SHA256", async () => {
  const full = "query Catalog { items { id } }";
  const sha256Hash = await hash(full);
  const result = await capture({ query: full, extensions: persisted(sha256Hash.toUpperCase()) });
  assert.equal(result.readOnly, true);
  assert.equal(JSON.parse(result.requestEnvelopeJson).query, full);
  assert.equal(JSON.parse(result.requestEnvelopeJson).extensions.persistedQuery.sha256Hash, sha256Hash);
  await assert.rejects(capture({ query: full, extensions: persisted() }), /hash does not match/);
  await assert.rejects(capture({ query: full + " ", extensions: persisted(sha256Hash) }), /hash does not match/);
});

test("opaque hashes are never inferred to be reads from names or hashes and accept only new variable values", async () => {
  const result = await capture({ operationName: "ReadCatalog", variables: { itemId: "PRIVATE_CAPTURE_ID" }, extensions: persisted() });
  assert.equal(result.readOnly, false);
  assert.ok(!result.requestEnvelopeJson.includes("PRIVATE_CAPTURE_ID"));
  assert.ok(!result.requestSchemaJson.includes("PRIVATE_CAPTURE_ID"));
  assert.deepEqual(JSON.parse(operationBody(result.requestEnvelopeJson, { itemId: "NEW_EXPLICIT_ID" }, result.requestSchemaJson)),
    { operationName: "ReadCatalog", extensions: persisted(), variables: { itemId: "NEW_EXPLICIT_ID" } });
  const opaqueWrite = await capture({ operationName: "AddItem", extensions: persisted(), variables: { itemId: "CAPTURED" } });
  assert.equal(opaqueWrite.readOnly, false);
  const nameless = await capture({ extensions: persisted() });
  assert.equal(nameless.readOnly, false);
  assert.deepEqual(JSON.parse(operationBody(nameless.requestEnvelopeJson, {}, nameless.requestSchemaJson)), { extensions: persisted(), variables: {} });
});

test("mutations, subscriptions and ambiguous or malformed documents cannot become read operations", async () => {
  for (const query of ["mutation Change { rename }", "subscription Watch { items { id } }", "query A { items { id } } query B { items { name } }",
    "query A { items { id } } mutation Change { rename }", "query A { items { id } } query A { items { name } }", "type Item { id: ID }",
    "query Broken {", "query A { items { ...Missing } }", "query A { items { ...Loop } } fragment Loop on Item { ...Loop }"]) {
    await assert.rejects(capture({ query }));
  }
  const selected = await capture({ query: "query A { items { id } } query B { items { name } }", operationName: "B" });
  assert.equal(selected.readOnly, true);
  assert.equal(selected.operationName, "B");
  await assert.rejects(capture({ query: "query A { items { id } }", operationName: "B" }));
  await assert.rejects(capture({ query: "query A { items { id } } mutation Change { rename }", operationName: "A" }));
});

test("sensitive and financial operation, field, alias, argument and variable names are rejected", async () => {
  for (const name of ["payment", "billing", "accessToken", "password", "authorization", "security", "cardNumber", "transferFunds", "checkout", "wallet", "createOrder", "session", "balance", "authenticationStatus", "authz", "grantPermission", "bankAccount", "currency"]) {
    await assert.rejects(capture({ query: `query ${name} { items { id } }` }), name);
    await assert.rejects(capture({ query: `query Catalog { safe: ${name} { id } }` }), name);
    await assert.rejects(capture({ query: `query Catalog { ${name}: items { id } }` }), name);
    await assert.rejects(capture({ query: `query Catalog($x: String) { items(${name}: $x) { id } }` }), name);
    await assert.rejects(capture({ extensions: persisted(), variables: { nested: { [name]: "PRIVATE" } } }), name);
  }
  await assert.rejects(capture({ query: "query Catalog { deleteitems { id } }" }));
  await assert.rejects(capture({ query: "query Catalog { __schema { types { name } } }" }));
  await assert.rejects(capture({ query: "query Catalog { items(mode: DELETE) { id } }" }));
  await assert.rejects(capture({ query: "query Catalog { items @run { id } }" }));
});

test("captured scalar literals, defaults, comments and unsupported envelope data are never retained", async () => {
  for (const query of ['query Catalog { items(id: "PRIVATE_ID") { id } }', 'query Catalog($id: ID = "PRIVATE_ID") { items(id: $id) { id } }',
    "query Catalog { items(limit: 731) { id } }", "query Catalog { items(active: true) { id } }", "query Catalog { items { id } } # PRIVATE_COMMENT"]) {
    await assert.rejects(capture({ query }));
  }
  const withEnum = await capture({ query: "query Catalog { items(kind: BOOK) { id } }" });
  assert.equal(withEnum.readOnly, true);
  assert.equal((await capture({ query: "query Catalog { items { createdAt updatedAt deletedAt } }" })).readOnly, true);
  for (const input of [null, [], {}, { query: "" }, { variables: {} }, { query, extra: "PRIVATE" }, { query, authorization: "PRIVATE" },
    { query, variables: [] }, { query, variables: null }, { query, extensions: { trace: "PRIVATE" } },
    { extensions: { persistedQuery: { version: 2, sha256Hash: "a".repeat(64) } } },
    { extensions: { persistedQuery: { version: 1, sha256Hash: "short" } } },
    { extensions: { persistedQuery: { version: 1, sha256Hash: "a".repeat(64), token: "PRIVATE" } } }]) await assert.rejects(capture(input));
});

test("budgets bound raw bodies, query syntax, variable shapes and newly supplied arguments", async () => {
  await assert.rejects(capture({ query: "query Catalog { items { id } }" + " ".repeat(8192) }));
  await assert.rejects(capture({ query: "query Catalog { items { id } }", variables: { name: "界".repeat(6000) } }));
  await assert.rejects(capture({ query: "query Catalog { " + Array(250).fill("items { id }").join(" ") + " }" }));
  await assert.rejects(capture({ query: "query Catalog { " + "items { ".repeat(25) + "id" + " }".repeat(25) + " }" }));
  await assert.rejects(capture({ extensions: persisted(), variables: { a: { b: { c: { d: { e: { f: 1 } } } } } } }));
  const result = await capture({ extensions: persisted(), variables: { label: "old" } });
  assert.throws(() => operationBody(result.requestEnvelopeJson, { label: "x".repeat(2049) }, result.requestSchemaJson));
  assert.throws(() => operationBody(JSON.stringify({ extensions: persisted(), variables: { label: "captured" } }), { label: "new" }, result.requestSchemaJson));
});

test("operation endpoints preserve same-origin HTTPS and public-domain constraints while allowing GraphQL routes", () => {
  for (const path of ["/graphql", "/api/graphql", "/query", "/pathfinder/v1/query?version=1"]) {
    assert.equal(operationEndpointUrl(origin + path, origin), origin + path);
  }
  // Existing write endpoints keep their GraphQL prohibition.
  assert.throws(() => writeEndpointUrl(origin + "/graphql", origin));
  for (const url of ["http://app.acme.com/graphql", "https://other.acme.com/graphql", "https://u:p@app.acme.com/graphql",
    origin + ":8443/graphql", origin + "/graphql#fragment", "https://localhost/graphql", "https://127.0.0.1/graphql",
    "https://[::1]/graphql", "https://app.internal/graphql", "https://app.invalid/graphql", "https://singlehost/graphql"]) {
    const endpointOrigin = url.startsWith(origin) || url.includes("other.acme") ? origin : (() => { try { return new URL(url).origin; } catch { return origin; } })();
    assert.throws(() => operationEndpointUrl(url, endpointOrigin), url);
  }
});

test("protected endpoint paths and credential or command query parameters survive encoding and case checks", () => {
  for (const path of ["/api/auth/graphql", "/billing/query", "/api/createOrder", "/security/query", "/graphql/transfer", "/graphql/execute",
    "/api/%62illing/query", "/api/%2562illing/query", "/api/%252562illing/query", "/api/%25252562illing/query"]) {
    assert.throws(() => operationEndpointUrl(origin + path, origin), path);
  }
  for (const key of ["token", "authorization", "password", "payment", "price", "action", "Query", "operation_name", "variables", "redirect", "url", "method"]) {
    assert.throws(() => operationEndpointUrl(`${origin}/graphql?${key}=PRIVATE`, origin), key);
  }
  assert.throws(() => operationEndpointUrl(origin + "/graphql?version=%2500", origin));
});


test("malformed captured input never appears in parser diagnostics", async () => {
  for (const raw of ["PRIVATE_CAPTURE_VALUE", JSON.stringify({ query: "query { items } PRIVATE_CAPTURE_VALUE" })]) {
    await assert.rejects(capturedOperation(raw), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes("PRIVATE_CAPTURE_VALUE"));
      return true;
    });
  }
});
