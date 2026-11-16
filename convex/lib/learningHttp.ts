"use node";

import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { isIP } from "node:net";

export const MAX_SOURCE_BYTES = 256 * 1024;
export const MAX_WRITE_BYTES = 16 * 1024;
export type AppWriteMethod = "POST" | "PUT" | "PATCH" | "DELETE";
type AppWrite = { method: AppWriteMethod; headers: Record<string, string>; body?: string };
const DEADLINE_MS = 10_000;
type Address = { address: string; family: number };
// Supported by Node 24 net.connect; the installed HTTPS type omits this forwarded option.
export type ResearchRequestOptions = RequestOptions & { autoSelectFamily?: boolean };
export type ResearchResponse = { url: string; status: number; contentType: string; text: string };
// Injectable only through this Node helper, never an action/model argument.
export type ResearchTransport = {
  resolve(hostname: string): Promise<Address[]>;
  request(url: URL, options: ResearchRequestOptions, response: (value: IncomingMessage) => void): ClientRequest;
  timeoutMs?: number;
};
const transport: ResearchTransport = {
  resolve: (hostname) => dnsLookup(hostname, { all: true, verbatim: true }),
  request: httpsRequest,
};

// Conservative public-unicast policy. IPv6 transition/mapped ranges are refused
// wholesale, avoiding embedded IPv4 bypasses. Special-purpose/documentation
// ranges need not be reachable for app research, even where exceptions exist.
export function isPublicIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a! >= 224 ||
      (a === 100 && b! >= 64 && b! <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && ((b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99) || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (family !== 6 || address.includes("%") || address.includes(".")) return false;
  const sides = address.toLowerCase().split("::");
  const left = sides[0] ? sides[0].split(":") : [];
  const right = sides[1] ? sides[1].split(":") : [];
  const words = sides.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  const first = Number.parseInt(words[0]!, 16), second = Number.parseInt(words[1]!, 16);
  if (first < 0x2000 || first > 0x3fff) return false;
  if (first === 0x2001 && (second <= 0x01ff || second === 0x0db8)) return false;
  if (first === 0x2002 || (first === 0x3fff && second <= 0x0fff)) return false;
  return true;
}

function parsedUrl(raw: string): URL {
  if (!raw || raw.length > 4096 || /[\s\x00-\x1f\x7f\\{}<>]/.test(raw)) throw new Error("learning_invalid_url");
  let decoded = raw;
  for (let i = 0; i < 3; i++) {
    if (/[\x00-\x1f\x7f\\{}<>]|\$\{/.test(decoded)) throw new Error("learning_invalid_url");
    try { decoded = decodeURIComponent(decoded); } catch { if (i === 0) throw new Error("learning_invalid_url"); break; }
  }
  if (/[\x00-\x1f\x7f\\{}<>]/.test(decoded)) throw new Error("learning_invalid_url");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("learning_invalid_url"); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || url.hash) throw new Error("learning_invalid_url");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostname || hostname.endsWith(".") || /(^|\.)(localhost|local|internal|home|test|invalid|example|arpa)$/.test(hostname)) throw new Error("learning_invalid_url");
  if (isIP(hostname) && !isPublicIp(hostname)) throw new Error("learning_private_address");
  return url;
}

export function validateResearchUrl(raw: string, origin: string): URL {
  const allowed = parsedUrl(origin);
  if (allowed.pathname !== "/" || allowed.search) throw new Error("learning_invalid_origin");
  const url = parsedUrl(raw);
  if (url.origin !== allowed.origin) throw new Error("learning_origin_mismatch");
  return url;
}

export async function resolvePublicAddress(hostname: string, resolve = transport.resolve): Promise<Address> {
  const literal = hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(literal) ? [{ address: literal, family: isIP(literal) }] : await resolve(literal);
  if (!addresses.length || addresses.length > 32 || addresses.some((item) => !isPublicIp(item.address) || isIP(item.address) !== item.family)) throw new Error("learning_private_address");
  return addresses.find((item) => item.family === 4) ?? addresses[0]!;
}

export function pinnedLookup(pin: Address): NonNullable<RequestOptions["lookup"]> {
  if (!isPublicIp(pin.address) || isIP(pin.address) !== pin.family) throw new Error("learning_private_address");
  return (_hostname, options, callback) => {
    // Node can request all addresses even with a fixed family. Neither branch
    // calls DNS again, and neither can substitute an unvalidated address.
    if (typeof options === "object" && options.all) callback(null, [{ address: pin.address, family: pin.family }]);
    else callback(null, pin.address, pin.family);
  };
}

const PROHIBITED_HEADER = /^(?:host|connection|content-length|transfer-encoding|te|trailer|upgrade|keep-alive|proxy-.*|forwarded|x-forwarded-.*|via|accept-encoding|__proto__|constructor|prototype|x-http-method(?:-override)?|x-method-override|x-original-url|x-rewrite-url)$/i;
function requestHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { accept: "text/html, application/javascript, application/json, text/plain", "accept-encoding": "identity" };
  let bytes = 0;
  for (const [name, value] of Object.entries(extra ?? {})) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name) || PROHIBITED_HEADER.test(name) || typeof value !== "string" || /[\x00-\x1f\x7f]/.test(value)) throw new Error("learning_invalid_headers");
    bytes += Buffer.byteLength(name + value);
    if (bytes > 16_384 || Object.keys(headers).length > 40) throw new Error("learning_invalid_headers");
    headers[name.toLowerCase()] = value;
  }
  return headers;
}

function allowedContentType(value: string): boolean {
  return ["text/html", "text/plain", "text/javascript", "text/ecmascript", "application/javascript", "application/ecmascript", "application/x-javascript", "application/xhtml+xml", "application/json"].includes(value) || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(value);
}

// Public research remains GET-only. Headers can be supplied only by internal
// owner-scoped callers; they are never accepted by public research actions.
export async function safeResearchFetch(raw: string, origin: string, headers?: Record<string, string>, io: ResearchTransport = transport): Promise<ResearchResponse> {
  return pinnedRequest(validateResearchUrl(raw, origin), requestHeaders(headers), { method: "GET" }, io);
}

// This is only a transport, not an authorization boundary. The caller must first
// claim an exact, owner-scoped approval bound to immutable evidence and args.
// Preserve the approved JSON bytes, and never follow redirects or retry writes.
export async function safeAppRequest(raw: string, origin: string, input: AppWrite, io: ResearchTransport = transport): Promise<ResearchResponse> {
  const url = validateResearchUrl(raw, origin);
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(input.method)) throw new Error("learning_invalid_method");
  if (input.body !== undefined) {
    if (typeof input.body !== "string" || Buffer.byteLength(input.body) > MAX_WRITE_BYTES) throw new Error("learning_invalid_body");
    try { JSON.parse(input.body); } catch { throw new Error("learning_invalid_body"); }
  }
  const outgoing = requestHeaders(input.headers);
  outgoing.accept = "application/json";
  outgoing["content-type"] = "application/json";
  outgoing["content-length"] = String(Buffer.byteLength(input.body ?? ""));
  return pinnedRequest(url, outgoing, { method: input.method, body: input.body }, io);
}

function jsonContentType(value: string): boolean {
  return value === "application/json" || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(value);
}

// DNS is resolved once, all answers are checked, and the connection uses a
// pinned lookup with a fresh agent. TLS still checks the original hostname.
function pinnedRequest(url: URL, outgoing: Record<string, string>, input: { method: "GET" | AppWriteMethod; body?: string }, io: ResearchTransport): Promise<ResearchResponse> {
  const write = input.method !== "GET";
  return new Promise((resolve, reject) => {
    let settled = false;
    let dispatched = false;
    let request: ClientRequest | undefined;
    let response: IncomingMessage | undefined;
    const fail = (code: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      response?.destroy(); request?.destroy();
      // A write may already have committed when the reply is lost, malformed,
      // redirected or too large. Never claim that nothing changed or retry it.
      const uncertain = write && (dispatched || code === "learning_fetch_timeout" || code === "learning_fetch_failed");
      reject(new Error(uncertain ? "learning_write_outcome_uncertain" : code));
    };
    const timer = setTimeout(() => fail("learning_fetch_timeout"), Math.min(io.timeoutMs ?? DEADLINE_MS, DEADLINE_MS));
    resolvePublicAddress(url.hostname, io.resolve).then((pin) => {
      if (settled) return;
      dispatched = true;
      request = io.request(url, { method: input.method, agent: false, maxHeaderSize: 16_384, family: pin.family, autoSelectFamily: false, lookup: pinnedLookup(pin), headers: outgoing }, (incoming) => {
        response = incoming;
        if (settled) { incoming.destroy(); return; }
        const status = incoming.statusCode ?? 0;
        if (status >= 300 && status < 400) { fail("learning_redirect_rejected"); return; }
        const contentType = String(incoming.headers["content-type"] ?? "").split(";", 1)[0]!.trim().toLowerCase();
        if (!write && !allowedContentType(contentType)) { fail("learning_unsupported_content"); return; }
        // Request identity to avoid decompression bombs and ambiguous byte caps.
        if (incoming.headers["content-encoding"] && incoming.headers["content-encoding"] !== "identity") { fail("learning_unsupported_encoding"); return; }
        const length = incoming.headers["content-length"];
        if (length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > MAX_SOURCE_BYTES)) { fail("learning_source_too_large"); return; }
        const chunks: Buffer[] = [];
        let size = 0;
        incoming.on("data", (chunk: Buffer) => {
          if (settled) return;
          size += chunk.length;
          if (write && chunk.length && (status === 204 || !jsonContentType(contentType))) { fail("learning_expected_json"); return; }
          if (size > MAX_SOURCE_BYTES) { fail("learning_source_too_large"); return; }
          chunks.push(chunk);
        });
        incoming.on("end", () => {
          if (settled) return;
          let text: string;
          try { text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)); }
          catch { fail("learning_invalid_text"); return; }
          if (write && text) {
            try { JSON.parse(text); } catch { fail("learning_expected_json"); return; }
          }
          settled = true; clearTimeout(timer);
          resolve({ url: url.href, status, contentType, text });
        });
        incoming.on("error", () => fail("learning_fetch_failed"));
        incoming.on("aborted", () => fail("learning_fetch_failed"));
      });
      request.on("error", () => fail("learning_fetch_failed"));
      request.end(input.body);
    }).catch((error) => fail(error instanceof Error && error.message === "learning_private_address" && write ? "learning_private_address" : "learning_fetch_failed"));
  });
}

const SECRET_QUERY = /(?:token|password|secret|credential|authorization|api.?key|session|signature|^code$|^sig$|^key$|^otp$)/i;
function htmlAttribute(value: string): string {
  return value.replace(/&(?:amp|quot|apos|#(?:x[0-9a-f]+|\d+));/gi, (entity) => {
    if (/^&amp;/i.test(entity)) return "&";
    if (/^&quot;/i.test(entity)) return '"';
    if (/^&apos;/i.test(entity)) return "'";
    const code = entity.slice(2, -1);
    const number = code[0]?.toLowerCase() === "x" ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10);
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : "";
  });
}

// Candidates are untrusted evidence, never instructions or executable code.
// Resolve against the actual fetched URL (ignore HTML <base>), require the exact
// approved origin again, drop credential-like queries and bound every list.
export function extractResearchCandidates(text: string, baseUrl: string, origin: string): { sources: string[]; endpoints: string[] } {
  const base = validateResearchUrl(baseUrl, origin);
  const source = Buffer.from(text, "utf8").subarray(0, MAX_SOURCE_BYTES).toString("utf8");
  const sources = new Set<string>(), endpoints = new Set<string>();
  const add = (collection: Set<string>, candidate: string, docsOnly = false) => {
    if (collection.size >= 40 || candidate.length > 2048) return;
    try {
      const resolved = new URL(htmlAttribute(candidate).replace(/\\\//g, "/"), base);
      resolved.hash = ""; // Fragments are not fetched and may contain private data.
      const url = validateResearchUrl(resolved.href, origin);
      if ([...url.searchParams.keys()].some((key) => SECRET_QUERY.test(key))) return;
      if (docsOnly && !/\/(?:docs?|developers?|api|reference)(?:[\/_.-]|$)|\.json$/i.test(url.pathname)) return;
      collection.add(url.href);
    } catch { /* Unsafe/foreign/dynamic candidates are omitted, never fetched. */ }
  };
  for (const match of source.matchAll(/<(script|link|a)\b[^>]{0,4096}>/gi)) {
    const attribute = match[1]!.toLowerCase() === "script" ? "src" : "href";
    const value = new RegExp(`\\b${attribute}\\s*=\\s*(?:"([^"]{1,2048})"|'([^']{1,2048})'|([^\\s>]{1,2048}))`, "i").exec(match[0]);
    if (value) add(sources, value[1] ?? value[2] ?? value[3]!, match[1]!.toLowerCase() === "a");
  }
  const literals = source.replace(/\\\//g, "/");
  for (const match of literals.matchAll(/(["'`])((?:https:\/\/[^/\s"'`]{1,253})?\/(?:api(?:\/|\?|(?=["'`]))|v[1-9]\d?\/|graphql(?:\?|(?=["'`])))[^\s"'`]{0,1800})\1/g)) add(endpoints, match[2]!);
  for (const match of literals.matchAll(/(["'`])((?:https:\/\/[^/\s"'`]{1,253})?\/[^\s"'`?#]{0,1800}\.json(?:\?[^\s"'`]{0,1800})?)\1/gi)) add(endpoints, match[2]!);
  return { sources: [...sources], endpoints: [...endpoints] };
}
