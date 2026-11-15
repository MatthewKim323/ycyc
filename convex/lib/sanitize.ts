// Convex values reject object keys that start with "$" or contain non-ASCII characters
// (JSON Schema "$schema", "$ref"). Use before returning parsed JSON from a query.
export function sanitizeForConvex<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => sanitizeForConvex(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!k || k.startsWith("$") || k.length > 1024 || !/^[\x20-\x7e]+$/.test(k)) continue;
      if (v === undefined) continue;
      out[k] = sanitizeForConvex(v);
    }
    return out as T;
  }
  return value;
}
