"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { extractResearchCandidates, safeResearchFetch } from "./lib/learningHttp";

const sourceArgs = { url: v.string(), origin: v.string() };

// Internal callers bind origin/URL to persisted app-owned evidence IDs. There is
// intentionally no public action, arbitrary request method, or public auth input.
export const fetchSource = internalAction({
  args: sourceArgs,
  handler: async (_ctx, { url, origin }) => safeResearchFetch(url, origin),
});

export const inspectSource = internalAction({
  args: sourceArgs,
  handler: async (_ctx, { url, origin }) => {
    const result = await safeResearchFetch(url, origin);
    return { url: result.url, status: result.status, contentType: result.contentType,
      ...extractResearchCandidates(result.text, result.url, origin) };
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
