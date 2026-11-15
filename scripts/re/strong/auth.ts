// Strong auth: login (+ email-code MFA on a new device) and token refresh.
// Session state (tokens, deviceId, pending challenge) lives in ~/.ycyc/re-state/strong.json,
// outside the repo. Nothing here prints credentials, codes or tokens.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const BASE = "https://back.strong.app";
export const CLIENT_HEADERS: Record<string, string> = {
  "User-Agent": "Strong Android",
  Accept: "application/json",
  "Content-Type": "application/json",
  "x-client-build": "600013",
  "x-client-platform": "android",
};

export interface StrongState {
  deviceId: string;
  accessToken?: string;
  refreshToken?: string;
  userId?: string;
  expiresAt?: number;
  pending?: { challenge: string; redirectUrl: string; expiresAt?: string };
}

const DIR = join(homedir(), ".ycyc", "re-state");
const FILE = join(DIR, "strong.json");

export function loadState(): StrongState {
  try {
    return JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    return { deviceId: randomUUID() };
  }
}

export function saveState(s: StrongState): void {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
}

function expOf(jwt: string): number | undefined {
  try {
    const p = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    return typeof p.exp === "number" ? p.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

function adopt(s: StrongState, j: any): void {
  s.accessToken = j.accessToken;
  s.refreshToken = j.refreshToken;
  if (j.userId) s.userId = j.userId;
  s.expiresAt = expOf(j.accessToken) ?? Date.now() + (j.expiresIn ?? 1200) * 1000;
  delete s.pending;
}

export type LoginOutcome = "ok" | "mfa_required";

export async function login(s: StrongState, email: string, password: string): Promise<LoginOutcome> {
  const r = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: CLIENT_HEADERS,
    body: JSON.stringify({ usernameOrEmail: email, password, deviceId: s.deviceId }),
  });
  const text = await r.text();
  let j: any = null;
  try {
    j = JSON.parse(text);
  } catch {
    /* text error */
  }
  if (r.status === 200 && j?.accessToken) {
    adopt(s, j);
    saveState(s);
    return "ok";
  }
  if (r.status === 403 && j?.code === "MFA_REQUIRED") {
    s.pending = { challenge: j.challenge, redirectUrl: j.redirectUrl, expiresAt: j.expiresAt };
    saveState(s);
    return "mfa_required";
  }
  throw new Error(`login failed: HTTP ${r.status} ${j?.title ?? j?.code ?? text.slice(0, 60)}`);
}

// Completes the email-code challenge the way the app's webview does (ported from
// jerhinesmith/strong-mcp, MIT): GET the auth.strongapp.com form, POST the code, read the
// redeemed token from the client-side redirect, exchange it at /auth/mfa/verify.
export async function submitMfa(s: StrongState, code: string): Promise<void> {
  if (!s.pending) throw new Error("no pending MFA challenge; run login first");
  // The form only redirects to a non-http app scheme (https callbacks are refused).
  const CALLBACK = "strong://mfa";
  const formUrl = `${s.pending.redirectUrl}?redirectUrl=${encodeURIComponent(CALLBACK)}`;
  const formRes = await fetch(formUrl, { method: "GET" });
  const html = await formRes.text();
  const cookie = (formRes.headers as any)
    .getSetCookie()
    .map((c: string) => c.split(";")[0])
    .join("; ");
  const af = html.match(/name="__RequestVerificationToken"[^>]*\svalue="([^"]+)"/);
  if (!af) throw new Error("MFA: no antiforgery token on the code form");
  const body = new URLSearchParams({
    Code: code,
    ChallengeId: s.pending.challenge,
    RedirectUrl: CALLBACK,
    __RequestVerificationToken: af[1],
  });
  const sub = await fetch(formUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body: body.toString(),
    redirect: "manual",
  });
  const subHtml = await sub.text();
  const loc = sub.headers.get("location");
  const m =
    subHtml.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/) ??
    subHtml.match(/(strong:\/\/mfa[^"'<\s]*)/);
  const target = m?.[1] ?? loc;
  if (!target) {
    if (/too many attempts/i.test(subHtml)) throw new Error("MFA: too many attempts");
    const notice = subHtml.match(/notice-title">([^<]*)/)?.[1];
    const errs = [...subHtml.matchAll(/class="[^"]*(?:error|validation)[^"]*"[^>]*>([^<]{3,120})</g)].map((x) => x[1].trim());
    const hasScheme = subHtml.includes("strong://");
    throw new Error(`MFA: code rejected or expired (HTTP ${sub.status}; notice=${notice ?? "-"}; errors=${JSON.stringify(errs)}; scheme=${hasScheme})`);
  }
  const u = new URL(target.replace(/&amp;/g, "&"));
  const token = u.searchParams.get("token");
  const challenge = u.searchParams.get("challenge");
  if (!token || !challenge) throw new Error("MFA: redirect missing token/challenge");
  const v = await fetch(`${BASE}/auth/mfa/verify`, {
    method: "POST",
    headers: CLIENT_HEADERS,
    body: JSON.stringify({ token, challenge, deviceId: s.deviceId }),
  });
  const vj: any = await v.json().catch(() => null);
  if (v.status < 200 || v.status >= 300 || !vj?.accessToken) throw new Error(`MFA verify failed: HTTP ${v.status}`);
  if (!vj.userId) {
    try {
      const p = JSON.parse(Buffer.from(vj.accessToken.split(".")[1], "base64url").toString("utf8"));
      vj.userId = p["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"];
    } catch {
      /* keep */
    }
  }
  adopt(s, vj);
  saveState(s);
}

export async function refresh(s: StrongState): Promise<void> {
  if (!s.accessToken || !s.refreshToken) throw new Error("no tokens; login first");
  const r = await fetch(`${BASE}/auth/login/refresh`, {
    method: "POST",
    headers: CLIENT_HEADERS,
    body: JSON.stringify({ accessToken: s.accessToken, refreshToken: s.refreshToken, deviceId: s.deviceId }),
  });
  const j: any = await r.json().catch(() => null);
  if (r.status !== 200 || !j?.accessToken) throw new Error(`refresh failed: HTTP ${r.status}`);
  adopt(s, j);
  saveState(s);
}

export async function fresh(s: StrongState): Promise<StrongState> {
  if (s.accessToken && s.expiresAt && s.expiresAt - 60_000 > Date.now()) return s;
  await refresh(s);
  return s;
}
