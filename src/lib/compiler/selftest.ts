// Compiler self-test on a synthetic MyFitnessPal-like capture. Run: npx tsx src/lib/compiler/selftest.ts
// Exits non-zero if a check fails. No network.

import type { CaptureEntry, CatalogApp, SessionBundle } from "../contract";
import { compileCapture } from "./compile";
import { renderRequest } from "./render";

const app: CatalogApp = {
  slug: "myfitnesspal",
  name: "MyFitnessPal",
  category: "nutrition",
  route: "web",
  loginUrl: "https://www.myfitnesspal.com/account/login",
  webOrigin: "https://www.myfitnesspal.com",
  blurb: "Log meals and read your diary",
};

const AUTH = { authorization: "<redacted:authorization>", "mfp-client-id": "<redacted:mfp-client-id>", "mfp-user-id": "<redacted:mfp-user-id>", accept: "application/json" };
const API = "https://api.myfitnesspal.com/v2";
const WWW = "https://www.myfitnesspal.com";
let n = 0;
const e = (method: string, url: string, extra: Partial<CaptureEntry> = {}): CaptureEntry => ({
  id: "t" + n++,
  ts: 1763240000000 + n * 1000,
  method,
  url,
  status: 200,
  reqHeaders: {},
  mime: "application/json; charset=utf-8",
  initiator: "fetch",
  pageUrl: WWW + "/food/diary",
  ...extra,
});

const capture: CaptureEntry[] = [
  e("GET", WWW + "/account/login", { initiator: "navigation", mime: "text/html", pageUrl: WWW + "/account/login" }),
  e("GET", WWW + "/food/diary", { initiator: "navigation", mime: "text/html" }),
  e("GET", "https://www.google-analytics.com/g/collect?v=2&tid=G-1", { status: 204 }),
  e("GET", WWW + "/_next/static/chunks/main.js", { mime: "application/javascript" }),
  e("GET", WWW + "/api/auth/session", { resBody: '{"user":{"name":"x"},"expires":"2026-12-15"}' }),
  e("GET", WWW + "/user/auth_token?refresh=true", { resBody: '{"token_type":"<redacted:token_type>","access_token":"<redacted:access_token>","expires_in":864000,"refresh_token":"<redacted:refresh_token>","user_id":"123"}' }),
  e("GET", API + "/diary?entry_date=2026-11-14&types=food_entry&fields%5B%5D=nutritional_contents&fields%5B%5D=food", { reqHeaders: AUTH, resBody: '{"items":[{"id":"aae416c9-43d6-44db-a385-f3c89abbe4cd","type":"food_entry","meal_name":"Snacks"}]}' }),
  e("GET", API + "/diary?entry_date=2026-11-15&types=food_entry&fields%5B%5D=nutritional_contents&fields%5B%5D=food", { reqHeaders: AUTH, resBody: '{"items":[]}' }),
  e("GET", API + "/nutrition?q=banana&max_items=5&fields%5B%5D=nutritional_contents&fields%5B%5D=serving_sizes", { reqHeaders: AUTH, resBody: '{"commonly_paired_foods":[],"items":[{"item":{"id":"90048150924533","version":"233815641308285","description":"Banana"}}]}' }),
  e("GET", API + "/nutrition?q=greek%20yogurt&max_items=5&fields%5B%5D=nutritional_contents&fields%5B%5D=serving_sizes", { reqHeaders: AUTH, resBody: '{"commonly_paired_foods":[],"items":[]}' }),
  e("GET", API + "/nutrient-goals?date=2026-11-15", { reqHeaders: AUTH, resBody: '{"items":[{"valid_from":"2026-11-15","default_goal":{"energy":{"value":3080,"unit":"calories"}}}]}' }),
  e("POST", API + "/diary", {
    status: 201,
    reqHeaders: { ...AUTH, "content-type": "application/json" },
    reqBody: '{"items":[{"type":"food_entry","date":"2026-11-15","meal_name":"Snacks","servings":1,"food":{"id":"90048150924533","version":"233815641308285"},"serving_size":{"value":1,"unit":"banana","nutrition_multiplier":1.26}}]}',
    resBody: '{"items":[{"id":"aae416c9-43d6-44db-a385-f3c89abbe4cd"}]}',
  }),
  e("DELETE", API + "/diary/aae416c9-43d6-44db-a385-f3c89abbe4cd", { status: 204, reqHeaders: AUTH, mime: "" }),
  e("GET", WWW + "/api/services/diary/read_diary?entry_date=2026-11-15", { reqHeaders: { accept: "application/json" }, resBody: "[]" }),
  e("GET", API + "/users/123?fields%5B%5D=account", { status: 500, reqHeaders: AUTH, resBody: '{"error":"x"}' }),
];

const session: SessionBundle = {
  headers: { authorization: "Bearer test-token", "mfp-client-id": "mfp-main-js", "mfp-user-id": "123" },
  cookies: { "anon-device-id": "d" },
  storage: { tz: "America/Los_Angeles" },
  capturedAt: 1763240000000,
};

const recipe = compileCapture(app, capture, session, { now: 1763240000000 });

console.log("executor:", recipe.executor, "| auth:", recipe.auth.type, "| sessionKeys:", recipe.auth.sessionKeys.join(", "));
console.log("refresh:", recipe.auth.refresh?.method, recipe.auth.refresh?.urlTemplate);
console.log("check:  ", recipe.auth.check?.method, recipe.auth.check?.urlTemplate);
console.log("tools:");
for (const t of recipe.tools) {
  const props = Object.keys((t.inputSchema as { properties: object }).properties).join(", ");
  console.log(`  ${t.kind === "read" ? "R" : "W"} ${t.name.padEnd(18)} ${t.request?.method.padEnd(6)} ${t.request?.urlTemplate}`);
  console.log(`      args: ${props || "(none)"}${t.extract ? "  extract: " + t.extract : ""}`);
  if (t.request?.bodyTemplate) console.log(`      body: ${t.request.bodyTemplate}`);
}
console.log("playbook:", recipe.playbook.join(" -> "));
console.log("notes:", recipe.provenance.notes);

const checks: [string, boolean][] = [];
const tool = (name: string) => recipe.tools.find((t) => t.name === name);
checks.push(["executor is cloud (bearer captured)", recipe.executor === "cloud"]);
checks.push(["auth type bearer", recipe.auth.type === "bearer"]);
checks.push(["refresh is /user/auth_token", !!recipe.auth.refresh?.urlTemplate.includes("/user/auth_token")]);
checks.push(["noise and static dropped", !recipe.tools.some((t) => /google|_next/.test(t.request?.urlTemplate || ""))]);
checks.push(["failed call (500) dropped", !recipe.tools.some((t) => /\/users\//.test(t.request?.urlTemplate || ""))]);
checks.push(["get_diary with date default today", !!tool("get_diary") && (tool("get_diary")!.inputSchema as { properties: Record<string, { default?: string }> }).properties.date?.default === "{{today}}"]);
checks.push(["search_food requires query", !!(tool("search_food")?.inputSchema as { required?: string[] } | undefined)?.required?.includes("query")]);
checks.push(["get_goals present", !!tool("get_goals")]);
checks.push(["log_food is a write with a body", tool("log_food")?.kind === "write" && !!tool("log_food")?.request?.bodyTemplate]);
checks.push(["delete_food_entry has {{entry_id}}", !!tool("delete_food_entry")?.request?.urlTemplate.includes("{{entry_id}}")]);
checks.push(["auth headers reference session", !!tool("get_diary")?.request?.headers?.authorization?.includes("{{session.headers.authorization}}")]);
checks.push(["no raw secret in recipe", !JSON.stringify(recipe).includes("test-token")]);

// Render round trip with the shared renderer.
const diary = tool("get_diary");
if (diary?.request) {
  const r = renderRequest(diary.request, {}, session, { now: Date.UTC(2026, 10, 16, 1, 0) }, diary.inputSchema);
  console.log("render get_diary:", r.url, "| auth:", r.headers.authorization);
  checks.push(["render: today in LA (UTC is already the 16th)", r.url.includes("entry_date=2026-11-15")]);
  checks.push(["render: session header filled", r.headers.authorization === "Bearer test-token"]);
}
const log = tool("log_food");
if (log?.request) {
  const args: Record<string, unknown> = {};
  for (const [k, p] of Object.entries((log.inputSchema as { properties: Record<string, { type: string }> }).properties)) {
    args[k] = p.type === "string" ? (k.includes("date") ? "2026-11-15" : "x-" + k) : 2;
  }
  const r = renderRequest(log.request, args, session, {}, log.inputSchema);
  let parsed = false;
  try {
    JSON.parse(r.body || "");
    parsed = true;
  } catch {}
  console.log("render log_food body:", r.body);
  checks.push(["render: log_food body is valid JSON", parsed]);
}

let failed = 0;
console.log("\nchecks:");
for (const [name, ok] of checks) {
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`);
}
console.log(failed ? `\n${failed} FAILED` : "\nALL OK");
if (failed) throw new Error(failed + " self-test checks failed");
