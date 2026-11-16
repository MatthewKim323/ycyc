// Diagnostics only: never return provider prose, request data, URLs or tokens.
const NEW_CODES = [
  "provider_usage_limit", "provider_model_unavailable", "provider_authentication_failed", "provider_rate_limited",
  "provider_access_denied", "provider_connection_failed", "provider_context_limit", "provider_tool_schema_invalid", "provider_retryable_error",
];
const SAFE_CODES = new Set([...NEW_CODES,
  "provider_turn_failed", "provider_protocol_failed", "provider_invalid_event", "provider_disallowed_tool",
  "provider_cancelled", "provider_callback_timeout", "provider_output_limit", "provider_timeout", "provider_spawn_failed",
  "provider_stream_failed", "provider_turn_incomplete", "provider_tool_manifest_missing", "provider_tool_isolation_unavailable",
  "provider_prompt_limit", "provider_invalid_mcp", "provider_unsupported", "provider_login_failed", "provider_storage_not_configured",
  "invalid_provider_credentials", "invalid_provider_envelope",
]);
const VARIANTS = ["contextWindowExceeded", "sessionBudgetExceeded", "usageLimitExceeded", "rateLimitExceeded", "unauthorized", "serverOverloaded", "httpConnectionFailed", "responseStreamConnectionFailed", "responseStreamDisconnected", "responseTooManyFailedAttempts"];
const CHILDREN = ["codexErrorInfo", "errorInfo", "error", "params", "turn", "data", "cause", ...VARIANTS];

// Read only known own data fields; do not execute getters or enumerate arbitrary
// prompt/response objects. The entire diagnostic sample is capped at 2 KiB text.
function field(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}
function known(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_CODES.has(value) ? value : undefined;
}

export function providerFailure(value: unknown, fallback = "provider_turn_failed"): string {
  const otherwise = known(fallback) ?? "provider_turn_failed";
  try {
    let remaining = 2048, nodes = 0, retryable = false;
    const text: string[] = [], statuses = new Set<number>(), seen = new Set<object>();
    const add = (value: unknown) => {
      if (typeof value !== "string" || !remaining) return;
      let part = "", used = 0;
      for (const character of value.slice(0, remaining)) {
        const point = character.codePointAt(0)!;
        const bytes = point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
        if (used + bytes + 1 > remaining) break;
        part += character; used += bytes;
      }
      if (part) { text.push(part); remaining -= used + 1; }
    };
    const visit = (item: unknown, depth: number) => {
      if (depth > 5 || ++nodes > 32) return;
      if (typeof item === "string") { add(item); return; }
      if (!item || typeof item !== "object" || Array.isArray(item) || seen.has(item)) return;
      seen.add(item);
      if (field(item, "willRetry") === true) retryable = true;
      for (const name of ["httpStatusCode", "httpStatus", "statusCode", "status", "code"]) {
        const value = field(item, name);
        if ((typeof value === "number" && Number.isInteger(value) || typeof value === "string" && /^[45]\d{2}$/.test(value)) && Number(value) >= 400 && Number(value) <= 599) statuses.add(Number(value));
      }
      for (const name of ["code", "type", "errorCode"]) add(field(item, name));
      for (const name of CHILDREN) {
        const child = field(item, name);
        if (child !== undefined) { if (VARIANTS.includes(name)) add(name); visit(child, depth + 1); }
      }
      add(field(item, "message"));
    };
    visit(value, 0);
    if (retryable) return "provider_retryable_error";
    const sample = text.join(" ").replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
    if (/refresh[ _-]?token[ _-]?(?:reused|expired|revoked|invalid)|refresh[ _-]?token.{0,50}already.{0,15}used|invalid[ _-]?refresh|invalid_grant|authentication[ _-]?(?:failed|error)|invalid[ _-]?(?:api[ _-]?)?(?:key|token)|not[ _-]?logged[ _-]?in|unauthorized|expired.{0,20}token/.test(sample)) return "provider_authentication_failed";
    if (/usage[ _-]?limit|insufficient[ _-]?quota|quota.{0,40}(?:exceeded|exhausted)|session[ _-]?budget[ _-]?exceeded|(?:credits?|budget).{0,40}(?:exhausted|exceeded|depleted)/.test(sample)) return "provider_usage_limit";
    if (/context[ _-]?(?:window[ _-]?)?(?:exceeded|limit|length)|maximum[ _-]?context|too[ _-]?many[ _-]?tokens|prompt[ _-]?too[ _-]?long/.test(sample)) return "provider_context_limit";
    if (/model[ _-]?(?:not[ _-]?(?:found|supported)|unavailable)|unsupported[ _-]?model|model.{0,80}(?:not supported|not available|do not have access|does not exist)|not supported.{0,100}(?:chatgpt|account)/.test(sample)) return "provider_model_unavailable";
    if (/invalid[ _-]?(?:function|tool)[ _-]?(?:parameters|schema)|invalid[ _-]?schema.{0,60}(?:function|tool)|(?:tool|function).{0,50}(?:invalid|unsupported).{0,20}(?:schema|parameters)/.test(sample)) return "provider_tool_schema_invalid";
    if (/rate[ _-]?limit|too[ _-]?many[ _-]?requests/.test(sample)) return "provider_rate_limited";
    if (/access[ _-]?denied|permission[ _-]?denied|forbidden/.test(sample)) return "provider_access_denied";
    if (statuses.has(401)) return "provider_authentication_failed";
    if (statuses.has(402)) return "provider_usage_limit";
    if (statuses.has(403)) return "provider_access_denied";
    if (statuses.has(429)) return "provider_rate_limited";
    if (statuses.has(408) || [...statuses].some((status) => status >= 500)) return "provider_connection_failed";
    if (/connection[ _-]?failed|stream[ _-]?(?:disconnected|connection[ _-]?failed)|too[ _-]?many[ _-]?failed[ _-]?attempts|server[ _-]?overloaded|econnreset|econnrefused|enotfound|etimedout|network[ _-]?error|tls|ssl|certificate/.test(sample)) return "provider_connection_failed";
    return otherwise;
  } catch { return otherwise; }
}

export function safeProviderFailure(error: unknown): string {
  try {
    const direct = known(error) ?? (error && typeof error === "object" ? known(field(error, "message")) : undefined);
    return direct ?? providerFailure(error);
  } catch { return "provider_turn_failed"; }
}
