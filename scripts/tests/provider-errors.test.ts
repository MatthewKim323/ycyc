import assert from "node:assert/strict";
import test from "node:test";
import { providerFailure, safeProviderFailure } from "../../convex/lib/providerErrors";
import { ProviderEvents } from "../../convex/lib/providerEvents";

const privateMarker = "PRIVATE_PROVIDER_TOKEN_AND_MESSAGE";

test("structured Codex variants classify usage, context, rate and transport failures without provider prose", () => {
  for (const [info, expected] of [
    ["usageLimitExceeded", "provider_usage_limit"], ["sessionBudgetExceeded", "provider_usage_limit"],
    ["contextWindowExceeded", "provider_context_limit"], ["rateLimitExceeded", "provider_rate_limited"],
    ["unauthorized", "provider_authentication_failed"], ["serverOverloaded", "provider_connection_failed"],
  ]) assert.equal(providerFailure({ codexErrorInfo: info, message: privateMarker }), expected);
  assert.equal(providerFailure({ codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: null } }, message: privateMarker }), "provider_connection_failed");
  assert.equal(providerFailure({ errorInfo: { usageLimitExceeded: {} }, message: privateMarker }), "provider_usage_limit");
});

test("known provider codes and messages distinguish account auth, quota, model access and invalid tool schema", () => {
  for (const [message, expected] of [
    ["refresh_token_reused", "provider_authentication_failed"], ["invalid_refresh_token", "provider_authentication_failed"],
    ["Your refresh token has already been used to generate a new access token.", "provider_authentication_failed"],
    ["invalid_grant", "provider_authentication_failed"], ["authentication_error", "provider_authentication_failed"],
    ["usage_limit_reached", "provider_usage_limit"], ["insufficient_quota", "provider_usage_limit"],
    ["model_not_found", "provider_model_unavailable"], ["unsupported_model", "provider_model_unavailable"],
    ["This model is not supported when using Codex with a ChatGPT account.", "provider_model_unavailable"],
    ["The selected model is not available to this account.", "provider_model_unavailable"],
    ["invalid_function_parameters", "provider_tool_schema_invalid"],
    ["Invalid schema for function 'some_tool': missing additionalProperties.", "provider_tool_schema_invalid"],
    ["context_length_exceeded", "provider_context_limit"], ["Maximum context length exceeded", "provider_context_limit"],
    ["rate_limit_exceeded", "provider_rate_limited"], ["Too many requests", "provider_rate_limited"],
    ["Access denied", "provider_access_denied"], ["ECONNRESET", "provider_connection_failed"],
  ]) {
    const result = providerFailure({ code: message, message: privateMarker });
    assert.equal(result, expected, message);
    assert.ok(!result.includes(privateMarker));
  }
});

test("HTTP status fallback is read from nested Codex transport variants and explicit causes take priority", () => {
  for (const [status, expected] of [[401, "provider_authentication_failed"], [402, "provider_usage_limit"], [403, "provider_access_denied"], [429, "provider_rate_limited"], [500, "provider_connection_failed"], [503, "provider_connection_failed"]] as const) {
    assert.equal(providerFailure({ error: { codexErrorInfo: { httpConnectionFailed: { httpStatusCode: status } }, message: privateMarker } }), expected);
  }
  assert.equal(providerFailure({ httpStatus: 429, code: "usage_limit_reached" }), "provider_usage_limit");
  assert.equal(providerFailure({ httpStatus: 403, message: "model is not supported with this ChatGPT account" }), "provider_model_unavailable");
  assert.equal(providerFailure({ statusCode: 400, code: "invalid_function_parameters" }), "provider_tool_schema_invalid");
  assert.equal(providerFailure({ status: 429, code: "refresh_token_reused" }), "provider_authentication_failed");
  assert.equal(providerFailure({ code: "429" }), "provider_rate_limited");
  assert.equal(providerFailure({ code: -32602, message: privateMarker }), "provider_turn_failed");
});

test("retryable error notifications are labeled separately without changing their behavior", () => {
  assert.equal(providerFailure({ willRetry: true, error: { message: privateMarker } }), "provider_retryable_error");
  assert.equal(providerFailure({ params: { willRetry: true, error: { codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 503 } } } } }), "provider_retryable_error");
  assert.equal(providerFailure({ willRetry: false, error: { code: "usage_limit_reached" } }), "provider_usage_limit");
  assert.equal(providerFailure({ willRetry: "true", message: privateMarker }), "provider_turn_failed");
});

test("diagnostic sampling ignores arbitrary prompts, limits text and cycles, and does not invoke getters", () => {
  assert.equal(providerFailure({ prompt: { code: "usage_limit_reached", message: privateMarker }, messages: [{ code: "model_not_found" }] }), "provider_turn_failed");
  assert.equal(providerFailure({ message: "x".repeat(4096) + " usage_limit_reached " + privateMarker }), "provider_turn_failed");
  assert.equal(providerFailure({ message: "é".repeat(1500) + " usage_limit_reached" }), "provider_turn_failed");
  assert.equal(providerFailure({ code: "usage_limit_reached", message: "x".repeat(100_000) }), "provider_usage_limit");
  let invoked = false;
  const tricky = Object.defineProperty({}, "message", { get() { invoked = true; throw new Error(privateMarker); } });
  assert.equal(providerFailure(tricky), "provider_turn_failed"); assert.equal(invoked, false);
  const cyclic: { cause?: unknown; message: string } = { message: "rate_limit_exceeded" }; cyclic.cause = cyclic;
  assert.equal(providerFailure(cyclic), "provider_rate_limited");
  assert.equal(providerFailure(new Proxy({}, { getOwnPropertyDescriptor() { throw new Error(privateMarker); } })), "provider_turn_failed");
});

test("safeProviderFailure preserves only explicitly known codes and never returns arbitrary messages or fallbacks", () => {
  for (const code of ["provider_protocol_failed", "provider_turn_failed", "provider_invalid_event", "provider_disallowed_tool", "provider_timeout", "provider_output_limit", "provider_retryable_error", "provider_storage_not_configured", "invalid_provider_envelope"]) {
    assert.equal(safeProviderFailure(new Error(code)), code);
    assert.equal(safeProviderFailure(code), code);
  }
  assert.equal(safeProviderFailure(new Error(`usage_limit_reached ${privateMarker}`)), "provider_usage_limit");
  assert.equal(safeProviderFailure(new Error(privateMarker)), "provider_turn_failed");
  assert.equal(safeProviderFailure("provider_arbitrary_secret_code"), "provider_turn_failed");
  assert.equal(providerFailure(privateMarker, "provider_protocol_failed"), "provider_protocol_failed");
  assert.equal(providerFailure(privateMarker, privateMarker), "provider_turn_failed");
  for (const value of [null, undefined, 401, [], { message: privateMarker }, new Error(privateMarker)]) assert.ok(!safeProviderFailure(value).includes(privateMarker));
});


test("Codex parser reports quota safely before emitting any provider error data", () => {
  for (const params of [
    { error: { codexErrorInfo: "usageLimitExceeded", message: privateMarker }, willRetry: false },
    { codexErrorInfo: "usageLimitExceeded", message: privateMarker },
  ]) {
    const parser = new ProviderEvents("codex");
    const events: unknown[] = [];
    const line = new TextEncoder().encode(JSON.stringify({ method: "error", params }) + "\n");
    assert.throws(() => events.push(...parser.push(line)), (error: unknown) => {
      assert.equal(String(error), "Error: provider_usage_limit");
      assert.ok(!String(error).includes(privateMarker));
      return true;
    });
    assert.deepEqual(events, []);
  }
  assert.throws(() => new ProviderEvents("codex").push(new TextEncoder().encode(JSON.stringify({ method: "error", params: { error: { message: privateMarker } } }) + "\n")), /^Error: provider_turn_failed$/);
});
