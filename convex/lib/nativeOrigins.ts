import { parse as domainInfo } from "tldts";

// Registry entries are deployment-admin policy, never model-provided domains.
// Public DNS must still be checked/pinned by the transport on every connection.
function publicOrigin(raw: string): URL {
  if (typeof raw !== "string" || raw.length > 2048 || /[\s\x00-\x1f\x7f\\*{}<>]/.test(raw)) throw new Error("native_invalid_origin");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("native_invalid_origin"); }
  const info = domainInfo(url.hostname, { allowPrivateDomains: true });
  if (url.protocol !== "https:" || raw !== url.origin || url.username || url.password || url.port || url.hash || url.search ||
    url.hostname.length > 253 || url.hostname.endsWith(".") || info.isIp || !info.domain || !(info.isIcann || info.isPrivate) ||
    !url.hostname.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error("native_invalid_origin");
  return url;
}
function patternOrigin(pattern: string): { url: URL; wildcard: boolean } {
  const wildcard = typeof pattern === "string" && pattern.startsWith("https://*.");
  const url = publicOrigin(wildcard ? `https://${pattern.slice("https://*.".length)}` : pattern);
  // Private suffixes count: tenant.github.io is a registrable tenant boundary,
  // while github.io itself and api.company.com are not registrable bases.
  if (wildcard && domainInfo(url.hostname, { allowPrivateDomains: true }).domain !== url.hostname) throw new Error("native_invalid_origin_pattern");
  return { url, wildcard };
}
export function validateNativeOriginPattern(pattern: string): void {
  patternOrigin(pattern);
}
export function isApprovedNativeOrigin(origin: string, patterns: string[]): boolean {
  try {
    const actual = publicOrigin(origin);
    const allowed = patterns.map(patternOrigin);
    return allowed.some(({ url, wildcard }) => wildcard
      ? actual.hostname !== url.hostname && actual.hostname.endsWith(`.${url.hostname}`)
      : actual.origin === url.origin);
  } catch { return false; }
}
