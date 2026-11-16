"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { inspectPublicSource, safeAppRequest, safePublicSourceFetch, safeResearchFetch } from "./lib/learningHttp";
import { capturedOperation, operationEndpointUrl } from "./lib/capturedOperationPolicy";

const sourceArgs = { url: v.string(), origin: v.string() };

// Internal callers bind origin/URL to persisted app-owned evidence IDs. There is
// intentionally no public action, arbitrary request method, or public auth input.
export const fetchSource = internalAction({
  args: sourceArgs,
  handler: async (_ctx, { url, origin }) => safeResearchFetch(url, origin),
});

export const inspectSource = internalAction({
  args: { ...sourceArgs, query: v.optional(v.string()), appOrigin: v.optional(v.string()) },
  handler: async (_ctx, { url, origin, query, appOrigin }) => {
    if (query !== undefined && (query.length > 80 || /[\x00-\x1f\x7f]/.test(query))) throw new Error("learning_invalid_source_query");
    const result = await safePublicSourceFetch(url, origin);
    return { url: result.url, status: result.status, contentType: result.contentType,
      ...inspectPublicSource(result.text, result.url, origin, query, appOrigin) };
  },
});

export const readEndpoint = internalAction({
  args: { ...sourceArgs, headersJson: v.string() },
  handler: async (_ctx, { url, origin, headersJson }) => {
    if (Buffer.byteLength(headersJson) > 16_384) throw new Error("learning_invalid_headers");
    let headers: unknown;
    try { headers = JSON.parse(headersJson); } catch { throw new Error("learning_invalid_headers"); }
    if (!headers || typeof headers !== "object" || Array.isArray(headers) || Object.values(headers).some((value) => typeof value !== "string")) throw new Error("learning_invalid_headers");
    const result = await safeResearchFetch(url, origin, { ...(headers as Record<string, string>), accept: "application/json" });
    if (result.contentType !== "application/json" && !/^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(result.contentType)) throw new Error("learning_expected_json");
    return result;
  },
});

// Only captured full GraphQL query documents qualify. Persisted hashes without
// a query document are opaque and must enter the exact-action approval runner.
export const readOperation = internalAction({
  args: { ...sourceArgs, headersJson: v.string(), bodyJson: v.string() },
  handler: async (_ctx, { url, origin, headersJson, bodyJson }) => {
    const operation = await capturedOperation(bodyJson);
    if (!operation.readOnly || Buffer.byteLength(headersJson) > 16_384) throw new Error("learning_operation_needs_approval");
    const headers: unknown = JSON.parse(headersJson);
    if (!headers || typeof headers !== "object" || Array.isArray(headers) || Object.values(headers).some(value => typeof value !== "string")) throw new Error("learning_invalid_headers");
    return safeAppRequest(operationEndpointUrl(url, origin), origin, { method: "POST", headers: { ...(headers as Record<string, string>), accept: "application/json", "content-type": "application/json" }, body: bodyJson });
  },
});

// Only the server's exactly-once approval runner may invoke this transport.
// Method, destination, body and credentials are built from the frozen approved
// action; none of them are exposed as a public HTTP/MCP request surface here.
export const writeEndpoint = internalAction({
  args: { ...sourceArgs, method: v.union(v.literal("POST"), v.literal("PUT"), v.literal("PATCH"), v.literal("DELETE")), headersJson: v.string(), bodyJson: v.optional(v.string()) },
  handler: async (_ctx, { url, origin, method, headersJson, bodyJson }) => {
    if (Buffer.byteLength(headersJson) > 16_384) throw new Error("learning_invalid_headers");
    let headers: unknown;
    try { headers = JSON.parse(headersJson); } catch { throw new Error("learning_invalid_headers"); }
    if (!headers || typeof headers !== "object" || Array.isArray(headers) || Object.values(headers).some((value) => typeof value !== "string")) throw new Error("learning_invalid_headers");
    return safeAppRequest(url, origin, { method, headers: headers as Record<string, string>, body: bodyJson });
  },
});
