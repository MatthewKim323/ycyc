// Per-app session fixups applied when a web session arrives, before verify.
import type { SessionBundle } from "../../src/lib/contract";

function jwtSub(token: string | undefined): string | undefined {
  if (!token || token.split(".").length !== 3) return undefined;
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as { sub?: unknown };
    return claims.sub === undefined || claims.sub === null ? undefined : String(claims.sub);
  } catch {
    return undefined;
  }
}

function findKey(bag: Record<string, string> | undefined, name: string): string | undefined {
  if (!bag) return undefined;
  const k = Object.keys(bag).find((x) => x.toLowerCase() === name.toLowerCase());
  return k === undefined ? undefined : bag[k];
}

const DERIVERS: Record<string, (s: SessionBundle) => SessionBundle> = {
  // The API bearer is the jwt_token cookie; the user id is its sub claim (or logged_out_uuid).
  duolingo: (s) => {
    const jwt = findKey(s.cookies, "jwt_token");
    const headers = { ...(s.headers ?? {}) };
    const storage = { ...(s.storage ?? {}) };
    if (jwt && !/^bearer\s+\S/i.test(findKey(headers, "authorization") ?? "")) {
      for (const k of Object.keys(headers)) if (k.toLowerCase() === "authorization") delete headers[k];
      headers.authorization = `Bearer ${jwt}`;
    }
    if (!storage.userId) {
      const bearer = (findKey(headers, "authorization") ?? "").replace(/^bearer\s+/i, "");
      const uid = jwtSub(bearer) ?? jwtSub(jwt) ?? findKey(s.cookies, "logged_out_uuid");
      if (uid) storage.userId = uid;
    }
    return { ...s, headers, storage };
  },
};

// Returns the fixed session, or null when nothing changed.
export function deriveSession(appSlug: string, session: SessionBundle): SessionBundle | null {
  const fn = DERIVERS[appSlug];
  if (!fn) return null;
  const next = fn(session);
  return JSON.stringify(next) === JSON.stringify(session) ? null : next;
}
