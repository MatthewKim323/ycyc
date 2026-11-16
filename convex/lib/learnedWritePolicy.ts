// Captured write definitions contain shapes, never reusable captured payloads.
// Every body value comes from new explicit arguments and exact-action approval.

export type WriteMethod = "POST" | "PUT" | "PATCH" | "DELETE";
type Shape = { type: "string" | "number" | "boolean" | "null" | "array" | "object"; properties?: Record<string, Shape>; items?: Shape; required?: string[]; additionalProperties?: false };
const PRIVATE_KEY = /token|secret|password|credential|cookie|authorization|api.?key|session|otp|signature|csrf|cvv|cvc|card.?number|security.?code|__proto__|constructor|prototype/i;
const EXECUTION_KEY = /^(?:query|mutation|operationName|operation|sql|command|script|code|action|method|url|uri|host|endpoint|redirect|callback)$/i;
const executionKey = (key: string) => EXECUTION_KEY.test(key.replace(/[_-]/g, ""));
const PROTECTED_PATH = /(?:^|[/_.-])(?:auth|oauth|login|logout|signin|signout|session|password|security|billing|payment|card|charge|checkout|transfer|transaction|purchase|buy|order|ride|request|booking|graphql|gql|rpc|exec|execute|command|run|eval|action|dispatch|batch|operation|query|sql|mutation)s?(?:$|[/_.-])/i;
const MONEY_KEY = /^(?:currency|price|fare|quote|quote_?id|tip|payment_?method_?id|payment|charge|purchase|card|balance)$/i;
const MAX_BODY = 16 * 1024;
const bytes = (s: string) => new TextEncoder().encode(s).byteLength;

export function writeEndpointUrl(raw: string, origin: string): string {
  if (raw.length > 2048 || /[{}\r\n\\]/.test(raw)) throw new Error("Unsupported write endpoint");
  const u = new URL(raw);
  if (u.protocol !== "https:" || u.origin !== origin || u.username || Boolean(u.password) || u.port || u.hash) throw new Error("Write must stay on its captured HTTPS origin");
  let path = u.pathname;
  for (let n = 0; n < 3 && path.includes("%"); n++) path = decodeURIComponent(path);
  const classifiedPath = path.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  if (/[?%#{}\\\r\n]/.test(path) || PROTECTED_PATH.test(classifiedPath)) throw new Error("Payments and account-security actions require a reviewed connector");
  for (const [key, value] of u.searchParams) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,47}$/.test(key) || PRIVATE_KEY.test(key) || MONEY_KEY.test(key) || value.length > 256) throw new Error("Unsupported write query");
    if (executionKey(key)) throw new Error("Unsupported write query");
  }
  return u.href;
}

export function writeMethod(raw: unknown): WriteMethod {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(String(raw))) throw new Error("Unsupported write method");
  return raw as WriteMethod;
}

// A bounded JSON subset supports nested task/workout/diary records without
// accepting code, schema references, new fields, file uploads or form posts.
export function capturedWriteSchema(rawBody?: string): string {
  if (!rawBody?.trim()) return JSON.stringify({ type: "object", properties: {}, required: [], additionalProperties: false });
  if (bytes(rawBody) > MAX_BODY) throw new Error("Write body too large");
  const body: unknown = JSON.parse(rawBody);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Expected JSON object body");
  let nodes = 0;
  function shape(value: unknown, depth: number): Shape {
    if (++nodes > 150 || depth > 5) throw new Error("Write schema too complex");
    if (value === null) return { type: "null" };
    if (typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return { type: typeof value as "string" | "number" | "boolean" };
    if (Array.isArray(value)) {
      if (!value.length || value.length > 30) throw new Error("Capture a nonempty bounded array to learn its shape");
      const schemas = value.map((v) => shape(v, depth + 1));
      const first = JSON.stringify(schemas[0]);
      if (schemas.some((s) => JSON.stringify(s) !== first)) throw new Error("Mixed array shapes require a reviewed connector");
      return { type: "array", items: schemas[0] };
    }
    if (!value || typeof value !== "object") throw new Error("Unsupported JSON value");
    const entries = Object.entries(value);
    if (entries.length > 20) throw new Error("Too many write fields");
    const properties: Record<string, Shape> = {};
    for (const [key, child] of entries.sort(([a], [b]) => a.localeCompare(b))) {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,47}$/.test(key) || PRIVATE_KEY.test(key) || MONEY_KEY.test(key) || executionKey(key)) throw new Error("Sensitive, executable or financial body fields require a reviewed connector");
      properties[key] = shape(child, depth + 1);
    }
    return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
  }
  return JSON.stringify(shape(body, 0));
}

export function writeArguments(schemaJson: string, args: unknown): Record<string, unknown> {
  if (schemaJson.length > MAX_BODY) throw new Error("Write schema too large");
  const schema = JSON.parse(schemaJson) as Shape;
  let nodes = 0;
  function check(s: Shape, value: unknown, depth: number): unknown {
    if (++nodes > 300 || depth > 5 || !s || typeof s !== "object") throw new Error("Write arguments too complex");
    switch (s.type) {
      case "null": if (value === null) return null; break;
      case "string": if (typeof value === "string" && value.length <= 2048 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) return value; break;
      case "number": if (typeof value === "number" && Number.isFinite(value)) return value; break;
      case "boolean": if (typeof value === "boolean") return value; break;
      case "array": if (Array.isArray(value) && value.length <= 30 && s.items) return value.map((v) => check(s.items!, v, depth + 1)); break;
      case "object": {
        if (!value || typeof value !== "object" || Array.isArray(value) || !s.properties || Object.keys(value).length > 20) break;
        const keys = Object.keys(s.properties);
        if (keys.length > 20 || Object.keys(value).some((key) => !Object.hasOwn(s.properties!, key)) || keys.some((key) => !Object.hasOwn(value, key))) break;
        return Object.fromEntries(keys.sort().map((key) => {
          if (PRIVATE_KEY.test(key) || MONEY_KEY.test(key) || executionKey(key)) throw new Error("Unsupported write field");
          return [key, check(s.properties![key]!, (value as Record<string, unknown>)[key], depth + 1)];
        }));
      }
    }
    throw new Error("Provide every observed field with its captured type; extra fields are not allowed");
  }
  const result = check(schema, args, 0);
  if (!result || typeof result !== "object" || Array.isArray(result) || bytes(JSON.stringify(result)) > MAX_BODY) throw new Error("Invalid write arguments");
  return result as Record<string, unknown>;
}

export function writePreview(method: WriteMethod, url: string, args: Record<string, unknown>) {
  // Approval sees the complete new body AND fixed query target. Authorization,
  // captured payload values and arbitrary model prose are never displayed.
  const u = new URL(url);
  const preview = { method, path: u.pathname, args: { ...(u.search ? { query: Object.fromEntries(u.searchParams) } : {}), body: args } };
  if (bytes(JSON.stringify(preview)) > 4096) throw new Error("Write is too large to review in one approval");
  return preview;
}

