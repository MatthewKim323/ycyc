// Tool payloads are untrusted and can contain auth material. UI cards only need
// bounded, redacted values; the approval executor retains the private original.
export function publicToolData<T>(input: T, capability: string): T {
  let remaining = 32 * 1024;
  const text = (value: string) => {
    const clean = capability ? value.split(capability).join("[redacted]") : value;
    const limit = Math.max(0, Math.min(8192, Math.floor(remaining / 6)));
    const result = clean.slice(0, limit);
    remaining -= result.length * 6;
    return result;
  };
  const visit = (value: unknown, depth: number): unknown => {
    if (remaining <= 0 || depth > 10) return "[truncated]";
    remaining -= 16; // Primitive and container punctuation/serialization overhead.
    if (typeof value === "string") {
      // Receipts often embed a JSON response in {ok,text}. Sanitize that data
      // before treating it as prose, so nested token fields stay private.
      if (value.length < 128 * 1024 && /^[\s]*[\[{]/.test(value)) {
        try { return text(JSON.stringify(visit(JSON.parse(value), depth + 1))); } catch { /* Plain text below. */ }
      }
      const clean = value.replace(/("(?:[a-z0-9_-]*token|[a-z0-9_-]*secret|password|authorization|cookie|credentialsCipher)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[redacted]"');
      return text(clean);
    }
    if (value === null || typeof value === "boolean" || typeof value === "number") return value;
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      for (const item of value.slice(0, 100)) {
        if (remaining < 32) break;
        result.push(visit(item, depth + 1));
      }
      return result;
    }
    if (value && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value).slice(0, 100)) {
        if (item === undefined) continue;
        if (!key || key.startsWith("$") || key.length > 256 || !/^[\x20-\x7e]+$/.test(key)) continue;
        if (capability && key.includes(capability)) continue;
        if (remaining < key.length * 6 + 32) break;
        remaining -= key.length * 6 + 16;
        const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
        const privateKey = /token$|secret|password|credential|cookie|authorization|apikey|cipher/.test(normalized);
        result[key] = privateKey ? "[redacted]" : visit(item, depth + 1);
      }
      return result;
    }
    return null;
  };
  return visit(input, 0) as T;
}
