// Shared types for the app (src/), the backend (convex/) and the connector compiler (src/lib/compiler).
// Owner: lead. Change only by agreement; add fields rather than renaming them.

export type AppSlug = "myfitnesspal" | "strong" | "flo" | (string & {});

// How a connector reaches the app.
//  web        : user signs into the app's website inside our in-app browser; we capture its private API.
//  cloudPhone : phone-only app (Strong, Flo). A Revyl cloud phone runs the real app for discovery/fallback;
//               once the API is mapped, calls go direct.
//  official   : documented API (not used for the three demo apps).
export type RouteKind = "web" | "cloudPhone" | "official";

// Where a compiled tool call runs.
//  device : inside a hidden WebView on the user's phone (user's cookies, IP, fingerprint). Phone must be open.
//  cloud  : from a Convex action with the user's stored session (bearer token / headers / cookies).
//  phone  : a Revyl cloud phone performs the action through the app UI (slow, last resort).
export type Executor = "device" | "cloud" | "phone";

export type ConnectionStatus = "needs_login" | "capturing" | "building" | "live" | "error";

export type BuildStepKey = "signin" | "capture" | "map" | "generate" | "verify" | "publish";
export type BuildStepStatus = "pending" | "running" | "done" | "error" | "skipped";

export interface BuildStep {
  key: BuildStepKey;
  label: string; // short, user facing: "Signed in", "Watching requests", "Mapping endpoints", ...
  status: BuildStepStatus;
  detail?: string; // e.g. "14 endpoints found"
  at?: number;
}

export interface CatalogApp {
  slug: AppSlug;
  name: string;
  category: "nutrition" | "training" | "cycle" | "other";
  route: RouteKind;
  loginUrl?: string; // web route: where the in-app browser starts
  webOrigin?: string; // web route: origin whose traffic we record
  androidPackage?: string; // cloudPhone route
  revylAppId?: string; // cloudPhone route: Revyl app container id
  blurb: string; // one line: what your assistant can do once connected
}

// One recorded request/response, HAR-lite. Recorder truncates bodies and redacts secrets client side
// before upload; raw auth values travel only in SessionBundle.
export interface CaptureEntry {
  id: string;
  ts: number;
  method: string;
  url: string;
  status?: number;
  reqHeaders: Record<string, string>; // auth-bearing headers replaced with "<redacted:name>"
  reqBody?: string; // <= 8 KB
  resHeaders?: Record<string, string>;
  resBody?: string; // <= 16 KB, JSON preferred
  mime?: string;
  initiator: "fetch" | "xhr" | "navigation" | "revyl";
  pageUrl?: string;
}

// The user's private session material. Never shared across users, never put into a recipe.
export interface SessionBundle {
  cookies?: Record<string, string>; // name -> value (only what JS or a native cookie read could see)
  headers?: Record<string, string>; // e.g. { authorization: "Bearer ..." , "mfp-client-id": "..." }
  storage?: Record<string, string>; // selected localStorage keys
  credentials?: { username: string; password: string }; // only for apps whose API login we call directly (Strong, Flo)
  capturedAt: number;
}

export interface RequestTemplate {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  urlTemplate: string; // "https://api.myfitnesspal.com/v2/diary?entry_date={{date}}"
  headers?: Record<string, string>; // may reference session: "Bearer {{session.headers.authorization}}"
  bodyTemplate?: string; // JSON string with {{arg}} placeholders
}

export interface RecipeTool {
  name: string; // snake_case, unique within the app: "log_food", "get_diary"
  title: string; // "Log food"
  description: string; // for the model
  kind: "read" | "write";
  inputSchema: Record<string, unknown>; // JSON Schema object
  request?: RequestTemplate; // absent for executor "phone"
  extract?: string; // dot path into the JSON response, e.g. "items" ; empty = whole body
  phoneInstruction?: string; // executor "phone": plain-English step template for Revyl, with {{args}}
  sample?: { args: Record<string, unknown>; ok: boolean; at: number };
}

// A recipe is the reproducible, shared result of reverse engineering one app.
// Learned once (from one user's capture), reused for every user who connects that app.
export interface Recipe {
  appSlug: AppSlug;
  version: number;
  status: "draft" | "verified" | "broken";
  executor: Executor;
  baseUrl?: string;
  auth: {
    type: "cookie" | "bearer" | "header" | "login_api" | "none";
    sessionKeys: string[]; // which SessionBundle keys the tools need, e.g. ["headers.authorization"]
    refresh?: RequestTemplate; // how to mint a fresh token from the session (e.g. MFP /user/auth_token)
    loginRequest?: RequestTemplate; // login_api: exchange credentials for a token
    check?: RequestTemplate; // cheap call that proves the session works
  };
  tools: RecipeTool[];
  playbook: string[]; // ordered steps that reproduce the capture (pages to visit / actions to take)
  provenance: { compiler: "heuristic" | "llm" | "hand"; compiledAt: number; captureCount: number; notes?: string };
}

export type Assistant = "claude" | "chatgpt" | "grok" | "muse" | "keiki" | "ycyc";

export interface ActivityItem {
  appSlug: AppSlug;
  assistant: Assistant;
  tool: string;
  kind: "read" | "write";
  summary: string; // "Logged 2 eggs and toast to breakfast"
  status: "ok" | "error" | "pending_approval" | "denied";
  at: number;
}
