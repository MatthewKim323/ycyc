// Captured GraphQL definitions are immutable protocol data. Variables are never
// retained: each call supplies fresh arguments matching the observed shape.
import { Kind, getOperationAST, parse, visit, type DocumentNode, type FragmentDefinitionNode } from "graphql";
import { parse as domainInfo } from "tldts";
import { capturedWriteSchema, writeArguments } from "./learnedWritePolicy";

const MAX_BODY = 16 * 1024;
const MAX_QUERY = 8 * 1024;
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const LITERALS = new Set<string>([Kind.STRING, Kind.INT, Kind.FLOAT, Kind.BOOLEAN, Kind.NULL]);
const IDENTIFIER = /^[_A-Za-z][_0-9A-Za-z]{0,127}$/;
const PRIVATE = /token|secret|password|credential|cookie|authorization|api.?key|session|otp|signature|csrf|cvv|cvc|__proto__|constructor|prototype/i;
const EXECUTION = /(?:^|_)(?:create|add|delete|remove|update|edit|save|set|send|submit|post|put|patch|destroy|subscribe|unsubscribe|reset|verify|confirm|accept|approve|revoke|refresh|exec|execute|command|run|eval|action|dispatch|batch|sql|mutation)(?:$|_)/i;
const SENSITIVE = /(?:^|_)(?:auth|authentication|authenticate|authz|oauth|login|logout|signin|signout|security|permission|permissions|grant|role|roles|billing|payment|payments|card|cards|charge|charges|checkout|transfer|transfers|transaction|transactions|purchase|purchases|order|orders|ride|rides|booking|bookings|subscription|subscriptions|currency|price|fare|quote|tip|balance|credit|debit|bank|wallet)(?:$|_)/i;
const SENSITIVE_PREFIX = /^(?:auth(?!or)|oauth|login|logout|signin|signout|security|billing|payment|card|charge|checkout|transfer|transaction|purchase|bank|wallet|balance|currency|price|fare|quote|credit|debit)/i;
const EXECUTION_PREFIX = /^(?:create(?!d)|delete(?!d)|update(?!d)|remove(?!d)|execute)/i;
const normalized = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[-./]/g, "_").toLowerCase();
function safeName(value: string, rejectExecution = true) {
  const name = normalized(value);
  const compact = name.replace(/_/g, "");
  if (!IDENTIFIER.test(value) || PRIVATE.test(value) || SENSITIVE.test(name) || SENSITIVE_PREFIX.test(compact) ||
    (rejectExecution && (EXECUTION.test(name) || EXECUTION_PREFIX.test(compact))) ||
    (value.startsWith("__") && value !== "__typename")) throw new Error("Sensitive or executable operations require a reviewed connector");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an operation object");
  return value as Record<string, unknown>;
}
function keysOnly(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("Unsupported operation envelope fields");
}

function checkVariableNames(value: unknown) {
  if (Array.isArray(value)) { value.forEach(checkVariableNames); return; }
  if (value && typeof value === "object") for (const [name, child] of Object.entries(value)) { safeName(name, false); checkVariableNames(child); }
}

type Envelope = { query?: string; operationName?: string; extensions?: { persistedQuery: { version: 1; sha256Hash: string } } };
function envelope(raw: string, withVariables: boolean): { fixed: Envelope; variables: Record<string, unknown> } {
  if (!raw || bytes(raw) > MAX_BODY) throw new Error("Operation body too large");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("Invalid operation JSON"); }
  const input = object(parsed);
  keysOnly(input, ["query", "operationName", "extensions", ...(withVariables ? ["variables"] : [])]);
  const fixed: Envelope = {};
  if (input.query !== undefined) {
    if (typeof input.query !== "string" || !input.query.trim() || bytes(input.query) > MAX_QUERY || input.query.includes("#")) throw new Error("Unsupported operation query");
    fixed.query = input.query;
  }
  if (input.operationName !== undefined) {
    if (typeof input.operationName !== "string") throw new Error("Invalid operation name");
    safeName(input.operationName, false);
    fixed.operationName = input.operationName;
  }
  if (input.extensions !== undefined) {
    const ext = object(input.extensions);
    keysOnly(ext, ["persistedQuery"]);
    const persisted = object(ext.persistedQuery);
    keysOnly(persisted, ["version", "sha256Hash"]);
    if (persisted.version !== 1 || typeof persisted.sha256Hash !== "string" || !/^[0-9a-f]{64}$/i.test(persisted.sha256Hash)) throw new Error("Invalid persisted operation hash");
    fixed.extensions = { persistedQuery: { version: 1, sha256Hash: persisted.sha256Hash.toLowerCase() } };
  }
  if (!fixed.query && !fixed.extensions) throw new Error("A query or persisted operation hash is required");
  return { fixed, variables: input.variables === undefined ? {} : object(input.variables) };
}

function queryOperation(query: string, operationName?: string): string | undefined {
  let document: DocumentNode;
  try { document = parse(query, { noLocation: true, maxTokens: 2000 }); } catch { throw new Error("Invalid captured query operation"); }
  const operations = document.definitions.filter((definition) => definition.kind === Kind.OPERATION_DEFINITION);
  const fragments = new Map<string, FragmentDefinitionNode>();
  const operationNames = new Set<string>();
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      if (fragments.has(definition.name.value)) throw new Error("Duplicate operation fragment");
      fragments.set(definition.name.value, definition);
    } else if (definition.kind === Kind.OPERATION_DEFINITION) {
      if (definition.operation !== "query") throw new Error("Only read query operations are supported");
      if (definition.name && operationNames.has(definition.name.value)) throw new Error("Duplicate operation name");
      if (definition.name) operationNames.add(definition.name.value);
    } else throw new Error("Only operations and fragments are supported");
  }
  if (!operations.length || (operations.length > 1 && (!operationName || operations.some((operation) => !operation.name)))) throw new Error("Select one unambiguous query operation");
  const selected = getOperationAST(document, operationName);
  if (!selected) throw new Error("Select one unambiguous query operation");
  let nodes = 0;
  visit(document, { enter(node, _key, _parent, _path, ancestors) {
    if (++nodes > 500 || ancestors.length > 40) throw new Error("Operation is too complex");
    if (node.kind === Kind.NAME || node.kind === Kind.ENUM) safeName(node.value);
    if (LITERALS.has(node.kind)) throw new Error("Operation values must be supplied as variables");
    if (node.kind === Kind.VARIABLE_DEFINITION && node.defaultValue) throw new Error("Operation defaults may contain captured values");
    if (node.kind === Kind.DIRECTIVE && !["skip", "include"].includes(node.name.value)) throw new Error("Unsupported operation directive");
  } });
  // Fragment expansion must be finite and bounded, including references hidden
  // in definitions that are not selected by this particular request.
  let expanded = 0;
  function checkFragments(node: DocumentNode | FragmentDefinitionNode, path: Set<string>) {
    if (path.size > 20 || ++expanded > 500) throw new Error("Operation fragments are too complex");
    visit(node, { FragmentSpread(spread) {
      const name = spread.name.value;
      const fragment = fragments.get(name);
      if (!fragment || path.has(name)) throw new Error("Invalid operation fragment reference");
      checkFragments(fragment, new Set([...path, name]));
    } });
  }
  checkFragments(document, new Set());
  return selected.name?.value;
}

export async function capturedOperation(rawBody: string): Promise<{
  requestEnvelopeJson: string; requestSchemaJson: string; readOnly: boolean; operationName?: string;
}> {
  const { fixed, variables } = envelope(rawBody, true);
  const operationName = fixed.query ? queryOperation(fixed.query, fixed.operationName) : fixed.operationName;
  const requestSchemaJson = capturedWriteSchema(JSON.stringify(variables));
  checkVariableNames(variables);
  if (fixed.query && fixed.extensions) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fixed.query));
    const actual = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (actual !== fixed.extensions.persistedQuery.sha256Hash) throw new Error("Persisted hash does not match the captured query");
  }
  return { requestEnvelopeJson: JSON.stringify(fixed), requestSchemaJson, readOnly: !!fixed.query,
    ...(operationName ? { operationName } : {}) };
}

export function operationEndpointUrl(raw: string, origin: string): string {
  if (!raw || raw.length > 2048 || origin.length > 2048 || /[\s\x00-\x1f\x7f\\{}<>]/.test(raw + origin)) throw new Error("Invalid operation endpoint");
  let base: URL, url: URL;
  try { base = new URL(origin); url = new URL(raw); } catch { throw new Error("Invalid operation endpoint"); }
  const info = domainInfo(url.hostname, { allowPrivateDomains: true });
  if (base.protocol !== "https:" || base.pathname !== "/" || base.search || base.hash || base.username || base.password || base.port ||
    url.protocol !== "https:" || url.origin !== base.origin || url.username || url.password || url.port || url.hash ||
    url.hostname.endsWith(".") || info.isIp || !info.domain || !(info.isIcann || info.isPrivate) ||
    !url.hostname.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) throw new Error("Operation must stay on its captured public HTTPS origin");
  let path = url.pathname;
  for (let n = 0; n < 3 && path.includes("%"); n++) path = decodeURIComponent(path);
  if (/[?%#{}\\\x00-\x20\x7f]/.test(path) || (SENSITIVE.test(normalized(path)) || EXECUTION.test(normalized(path))) || PRIVATE.test(path) ||
    path.split("/").some((segment) => SENSITIVE_PREFIX.test(normalized(segment).replace(/_/g, "")) || EXECUTION_PREFIX.test(normalized(segment).replace(/_/g, "")))) throw new Error("Protected operation endpoint");
  for (const [key, value] of url.searchParams) {
    safeName(key);
    if (["query", "operation", "operationname", "variables", "extensions", "url", "uri", "host", "endpoint", "redirect", "callback", "method", "script", "code"].includes(normalized(key).replace(/_/g, "")) ||
      value.length > 256 || /[%{}<>\x00-\x1f\x7f]/.test(value)) throw new Error("Unsupported operation endpoint query");
  }
  return url.href;
}

export function operationBody(envelopeJson: string, args: unknown, schemaJson: string): string {
  // The envelope comes from immutable owner-scoped evidence, never tool args.
  // Recheck its structure and query semantics, then attach only fresh variables.
  const { fixed } = envelope(envelopeJson, false);
  if (fixed.query) queryOperation(fixed.query, fixed.operationName);
  const variables = writeArguments(schemaJson, args);
  checkVariableNames(variables);
  const body = JSON.stringify({ ...fixed, variables });
  if (bytes(body) > MAX_BODY) throw new Error("Operation body too large");
  return body;
}
