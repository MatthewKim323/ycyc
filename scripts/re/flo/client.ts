// Public web-account endpoints, not the mobile cycle/diary API. Authenticated flow is unverified.
export const FLO_API = "https://api.owhealth.com/call/v1/web_app";

export type FloProfile = { lastPeriodStartDate?: string; usagePurpose?: number; pregnancyDueDate?: string };

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

// Accept both candidate envelopes until a user-owned successful capture fixes the schema.
// Never return the raw account: it may contain identity, birth date, consents or tokens.
export function profileSummary(body: unknown): FloProfile {
  const root = object(body);
  const user = object(root?.user) ?? root;
  const profile = object(user?.profile);
  if (!profile) throw new Error("Unrecognized Flo response: missing profile; authenticated capture required");
  const out: FloProfile = {};
  for (const [wire, local] of [["last_period_start_date", "lastPeriodStartDate"], ["pregnancy_due_date", "pregnancyDueDate"]] as const) {
    const value = profile[wire] ?? profile[local];
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T[\d:.+Z-]+)?$/.test(value)) out[local] = value;
  }
  const purpose = profile.usage_purpose ?? profile.usagePurpose;
  if (typeof purpose === "number" && Number.isFinite(purpose)) out.usagePurpose = purpose;
  return out;
}

async function request(path: string, init: RequestInit, fetchImpl: typeof fetch): Promise<unknown> {
  const res = await fetchImpl(`${FLO_API}${path}`, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) });
  // Do not echo server bodies/URLs: failures can include health data or credentials.
  if (!res.ok) throw new Error(`Flo HTTP ${res.status}; login/challenge must be completed through Flo if required`);
  try { return await res.json(); } catch { throw new Error("Flo returned non-JSON data"); }
}

export async function login(email: string, password: string, visitorId: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!email || !password || !visitorId) throw new Error("FLO_EMAIL, FLO_PASSWORD and a visitor id are required");
  const data = object(await request("/sessions", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-Visitor-Id": visitorId },
    body: JSON.stringify({ username: email, password }),
  }, fetchImpl));
  const token = object(data?.session)?.token;
  if (typeof token !== "string" || !token) throw new Error("Flo login response has no session.token; capture required");
  return token;
}

export async function getProfile(token: string, fetchImpl: typeof fetch = fetch): Promise<FloProfile> {
  if (!token || /[\r\n]/.test(token)) throw new Error("A valid FLO_SESSION_TOKEN is required");
  return profileSummary(await request("/users?ensure_pii=true", {
    method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  }, fetchImpl));
}
