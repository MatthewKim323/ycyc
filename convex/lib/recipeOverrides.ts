// Backend-side tool flags layered over recipes, for things the recipe JSON can't say yet.
// Fields (also honored when a recipe sets them itself):
//   executor: "cloud"   run this tool from Convex even if the recipe's executor is device
//   public: true        works without the user's session: listed and callable before the app is connected
//   emptyOn: [...]      an error response that really means "none" (returned as `value`, default [])
import type { Executor, Recipe, RecipeTool, RequestTemplate } from "../../src/lib/contract";

export interface ToolFlags {
  executor?: Executor;
  public?: boolean;
  emptyOn?: { status: number; bodyContains?: string; value?: unknown }[];
}

export type FlaggedTool = RecipeTool & ToolFlags;

const OVERRIDES: Record<string, Record<string, ToolFlags>> = {
  parkmobile: {
    // Verified from plain Node with no session.
    find_zone: { executor: "cloud", public: true },
    find_zones_nearby: { executor: "cloud", public: true },
    get_zone_rates: { executor: "cloud", public: true },
    quote_parking: { executor: "cloud", public: true },
    // 404 {"...Vehicle not found"} when the account has no vehicles.
    get_vehicles: { emptyOn: [{ status: 404, bodyContains: "Vehicle not found", value: [] }] },
  },
};

// Recipe-level auth extras for device apps whose session the phone's WebView keeps alive:
//   refresh + refreshVia "relay"  mint a fresh session inside the relay page (cookies rotate together)
//   refreshPick                   session key -> regex (group 1) read from the refresh response
//   deadBody                      a 200 body that means "signed out" (GWT apps)
//   keepAlive                     cheap call the health cron runs to keep the session warm
export interface AuthFlags {
  refreshVia?: "relay";
  refreshPick?: Record<string, string>;
  deadBody?: string;
  keepAlive?: RequestTemplate;
}

const GWT_HEADERS = {
  "content-type": "text/x-gwt-rpc; charset=utf-8",
  "x-gwt-module-base": "https://cronometer.com/cronometer/",
  "x-gwt-permutation": "{{session.headers.x-gwt-permutation}}",
};

const AUTH_OVERRIDES: Record<string, Partial<Recipe["auth"]> & AuthFlags> = {
  cronometer: {
    // GWT authenticate(Integer tzOffsetMinutes): returns a fresh nonce, the only lowercase 32-hex string.
    refresh: {
      method: "POST",
      urlTemplate: "https://cronometer.com/cronometer/app",
      headers: GWT_HEADERS,
      bodyTemplate:
        "7|0|5|https://cronometer.com/cronometer/|{{session.storage.gwt_policy}}|com.cronometer.shared.rpc.CronometerService|authenticate|java.lang.Integer/3438268394|1|2|3|4|1|5|5|{{tz_offset}}|",
    },
    refreshVia: "relay",
    refreshPick: { "storage.nonce": '"([0-9a-f]{32})"' },
    deadBody: "NotLoggedInException",
    // warmCaches(nonce): cheapest GWT call that proves the nonce is alive.
    keepAlive: {
      method: "POST",
      urlTemplate: "https://cronometer.com/cronometer/app",
      headers: GWT_HEADERS,
      bodyTemplate:
        "7|0|6|https://cronometer.com/cronometer/|{{session.storage.gwt_policy}}|com.cronometer.shared.rpc.CronometerService|warmCaches|java.lang.String/2004016611|{{session.storage.nonce}}|1|2|3|4|1|5|6|",
    },
  },
  parkmobile: {
    // Rotates the JWT and REFRESH_TOKEN cookies inside the page, so the phone session stays in sync.
    refresh: {
      method: "POST",
      urlTemplate: "https://app.parkmobile.io/api/refresh",
      headers: {
        SourceAppKey: "ParkmobileWeb",
        "X-XSRF-TOKEN": "{{session.cookies.XSRF-TOKEN}}",
        accept: "application/json",
        "content-type": "application/json",
      },
      bodyTemplate: "{}",
    },
    refreshVia: "relay",
  },
};

export function applyOverrides(recipe: Recipe): Recipe {
  const o = OVERRIDES[recipe.appSlug];
  const a = AUTH_OVERRIDES[recipe.appSlug];
  const tools = o ? recipe.tools.map((t) => (o[t.name] ? { ...o[t.name], ...t, ...o[t.name] } : t)) : recipe.tools;
  const auth = a ? ({ ...a, ...recipe.auth, ...(recipe.auth.refresh ? {} : { refresh: a.refresh }) } as Recipe["auth"]) : recipe.auth;
  return o || a ? { ...recipe, tools, auth } : recipe;
}

export function authFlags(recipe: Recipe): AuthFlags {
  return recipe.auth as Recipe["auth"] & AuthFlags;
}

export function isPublicTool(t: RecipeTool): boolean {
  return (t as FlaggedTool).public === true && (t.kind === "read");
}
