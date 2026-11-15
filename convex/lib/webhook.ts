// Standard Webhooks signature check (used by Whop):
//   signed content = `${webhook-id}.${webhook-timestamp}.${body}`, HMAC-SHA256, base64,
//   header `webhook-signature: v1,<sig> [v1,<sig2> ...]`.
// Whop's docs don't pin the key bytes for manual checks, so the key is tried as the base64-decoded
// secret (prefix stripped) and as the raw secret text, with and without its prefix.

const TOLERANCE_S = 5 * 60;

function b64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function bytesToB64(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

async function hmac(key: Uint8Array, content: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToB64(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(content)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function verifyStandardWebhook(secret: string, headers: Headers, body: string): Promise<boolean> {
  const id = headers.get("webhook-id") ?? headers.get("svix-id");
  const ts = headers.get("webhook-timestamp") ?? headers.get("svix-timestamp");
  const sigHeader = headers.get("webhook-signature") ?? headers.get("svix-signature");
  if (!id || !ts || !sigHeader) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > TOLERANCE_S) return false;

  const content = `${id}.${ts}.${body}`;
  const keys: Uint8Array[] = [];
  // Whop issues `ws_` secrets; Standard Webhooks libraries use `whsec_`.
  const stripped = secret.replace(/^(whsec_|ws_)/, "");
  const decoded = b64ToBytes(stripped);
  if (decoded && decoded.length > 0) keys.push(decoded);
  keys.push(new TextEncoder().encode(secret));
  if (stripped !== secret) keys.push(new TextEncoder().encode(stripped));

  const sigs = sigHeader
    .split(" ")
    .map((s) => s.split(","))
    .filter(([ver, sig]) => ver === "v1" && !!sig)
    .map(([, sig]) => sig);
  for (const key of keys) {
    const expected = await hmac(key, content);
    if (sigs.some((s) => safeEqual(s, expected))) return true;
  }
  return false;
}
