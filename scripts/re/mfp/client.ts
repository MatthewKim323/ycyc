/// <reference types="node" />
// Live MyFitnessPal client driven by the recipe. Renders every request with the same renderRequest the
// backend uses, so a passing run means a passing recipe.
//
//   npx tsx scripts/re/mfp/client.ts                 # cloud path, read tools only
//   npx tsx scripts/re/mfp/client.ts --write         # also log 1 banana to Snacks, confirm, delete, confirm
//   npx tsx scripts/re/mfp/client.ts --device        # run the read tools inside a signed-in page (relay path)
//   npx tsx scripts/re/mfp/client.ts --query "greek yogurt"
//
// Session: minted through the Aside browser's signed-in myfitnesspal.com tab (GET /user/auth_token in the
// page, exactly what auth.refresh does on the phone). Held in memory only, never printed or written.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Recipe, RecipeTool, SessionBundle } from "../../../src/lib/contract";
import { extractPath, renderRequest, type RenderedRequest } from "../../../src/lib/compiler/render";

const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const opt = (f: string, d: string) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const WRITE = flag("--write");
const DEVICE = flag("--device");
const QUERY = opt("--query", "banana");
const RECIPE_PATH = opt("--recipe", join(__dirname, "../../../recipes/myfitnesspal.json"));

const recipe = JSON.parse(readFileSync(RECIPE_PATH, "utf8")) as Recipe;
const tool = (name: string): RecipeTool => {
  const t = recipe.tools.find((x) => x.name === name);
  if (!t || !t.request) throw new Error("recipe has no tool " + name);
  return t;
};

function aside(code: string): string {
  return execFileSync("aside", ["repl", code], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 150000 });
}

function between(out: string, tag: string): string | null {
  const m = new RegExp(tag + "_BEGIN([\\s\\S]*?)" + tag + "_END").exec(out);
  return m ? m[1] : null;
}

// Runs auth.refresh inside the signed-in page and returns a SessionBundle (memory only).
function mintSession(): SessionBundle {
  const refresh = recipe.auth.refresh;
  if (!refresh) throw new Error("recipe has no auth.refresh");
  const url = renderRequest(refresh, {}, undefined).url;
  const out = aside(`
const st = await openTab("https://www.myfitnesspal.com/api/auth/session");
const tok = await st.evaluate(async (u) => {
  const r = await fetch(u, { credentials: "include", headers: { accept: "application/json" } });
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("json")) return { error: "not signed in (" + r.status + " " + ct + ")" };
  const j = await r.json();
  return { authorization: (j.token_type || "Bearer") + " " + j.access_token, userId: String(j.user_id), expiresIn: j.expires_in, tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
}, ${JSON.stringify(url)});
console.log("SESSION_BEGIN" + JSON.stringify(tok) + "SESSION_END");
await closeTab(st);
`);
  const raw = between(out, "SESSION");
  if (!raw) throw new Error("could not mint session: " + out.slice(0, 300));
  const s = JSON.parse(raw);
  if (s.error) throw new Error(s.error);
  return {
    headers: { authorization: s.authorization.replace(/^bearer /i, "Bearer "), "mfp-user-id": s.userId },
    storage: { tz: s.tz, expires_in: String(s.expiresIn) },
    capturedAt: Date.now(),
  };
}

interface CallResult {
  status: number;
  json: unknown;
  text: string;
  ms: number;
}

async function cloudCall(req: RenderedRequest): Promise<CallResult> {
  const t0 = Date.now();
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, json, text, ms: Date.now() - t0 };
}

const trim = (v: unknown, n = 420) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > n ? s.slice(0, n) + "..." : s;
};

let failures = 0;
function show(name: string, req: RenderedRequest, r: CallResult, extract?: string, summary?: string) {
  const ok = r.status >= 200 && r.status < 300;
  if (!ok) failures++;
  const redactedUrl = req.url.replace(/(access_token|token)=[^&]+/g, "$1=<redacted>");
  console.log(`\n${ok ? "PASS" : "FAIL"} ${name}  ${req.method} ${redactedUrl}  -> ${r.status} in ${r.ms}ms`);
  if (summary) console.log("  " + summary);
  else console.log("  " + trim(extract !== undefined && r.json ? extractPath(r.json, extract) : r.json ?? r.text));
}

async function runTool(name: string, args: Record<string, unknown>, session: SessionBundle) {
  const t = tool(name);
  const req = renderRequest(t.request!, args, session, {}, t.inputSchema);
  const r = await cloudCall(req);
  return { t, req, r, data: r.json ? extractPath(r.json, t.extract) : undefined };
}

type FoodItem = { item: { id: string; version: string; description: string; brand_name?: string; nutritional_contents?: { energy?: { value: number } }; serving_sizes: { value: number; unit: string; nutrition_multiplier: number }[] } };
type DiaryItem = { id: string; meal_name?: string; servings?: number; food?: { description?: string }; nutritional_contents?: { energy?: { value: number } } };

async function cloud() {
  console.log("minting session in the signed-in browser page (auth.refresh)...");
  const session = mintSession();
  console.log("session ok: headers [" + Object.keys(session.headers || {}).join(", ") + "], tz " + session.storage?.tz);

  if (recipe.auth.check) {
    const req = renderRequest(recipe.auth.check, {}, session);
    const r = await cloudCall(req);
    show("auth.check", req, r, undefined, "status " + r.status);
  }

  const goals = await runTool("get_goals", {}, session);
  const g = goals.data as { default_goal?: { energy?: { value: number }; protein?: number; carbohydrates?: number; fat?: number }; daily_goals?: unknown[] } | undefined;
  const dg = g?.default_goal;
  show("get_goals", goals.req, goals.r, undefined, dg ? `default goal ${dg.energy?.value} kcal, protein ${dg.protein}g, carbs ${dg.carbohydrates}g, fat ${dg.fat}g; ${g?.daily_goals?.length ?? 0} daily goals` : trim(goals.data));

  const search = await runTool("search_food", { query: QUERY, limit: 5 }, session);
  const items = (search.data as FoodItem[] | undefined) ?? [];
  show("search_food", search.req, search.r, undefined, items.map((x) => `${x.item.description}${x.item.brand_name ? " (" + x.item.brand_name + ")" : ""} ${x.item.nutritional_contents?.energy?.value ?? "?"}kcal id=${x.item.id}`).join(" | ") || trim(search.r.json));

  const before = await runTool("get_diary", {}, session);
  const beforeItems = (before.data as DiaryItem[] | undefined) ?? [];
  show("get_diary", before.req, before.r, undefined, `${beforeItems.length} entries today: ` + beforeItems.map((e) => `${e.meal_name}: ${e.food?.description} x${e.servings}`).join(" | "));

  if (!WRITE) return;
  const food = items[0]?.item;
  if (!food) {
    failures++;
    console.log("FAIL no search result to log");
    return;
  }
  const serving = food.serving_sizes.find((s) => s.unit === QUERY) ?? food.serving_sizes[0];
  const logArgs = {
    food_id: food.id,
    food_version: food.version,
    meal: "Snacks",
    servings: 1,
    serving_value: serving.value,
    serving_unit: serving.unit,
    serving_multiplier: serving.nutrition_multiplier,
  };
  const logged = await runTool("log_food", logArgs, session);
  const entry = logged.data as DiaryItem | undefined;
  show("log_food", logged.req, logged.r, undefined, entry?.id ? `logged "${food.description}" 1 ${serving.unit} to Snacks, entry id ${entry.id}` : trim(logged.r.json ?? logged.r.text));
  if (!entry?.id) return;

  const after = await runTool("get_diary", {}, session);
  const afterItems = (after.data as DiaryItem[] | undefined) ?? [];
  const found = afterItems.find((e) => e.id === entry.id);
  if (!found) failures++;
  show("get_diary (confirm)", after.req, after.r, undefined, found ? `entry ${entry.id} present: ${found.meal_name}: ${found.food?.description} ${found.nutritional_contents?.energy?.value ?? "?"}kcal` : "entry NOT found after logging");

  const del = await runTool("delete_food_entry", { entry_id: entry.id }, session);
  show("delete_food_entry", del.req, del.r, undefined, `status ${del.r.status} ${trim(del.r.text, 120)}`);

  const final = await runTool("get_diary", {}, session);
  const finalItems = (final.data as DiaryItem[] | undefined) ?? [];
  const gone = !finalItems.some((e) => e.id === entry.id);
  if (!gone) failures++;
  show("get_diary (cleanup)", final.req, final.r, undefined, gone ? `cleanup ok: entry gone, ${finalItems.length} entries today (was ${beforeItems.length})` : "entry STILL present after delete");
}

// Device path: the same rendered requests, executed inside the signed-in page the way DeviceRelay does it
// on the phone (cookies for same-origin calls, bearer header only for the API host). Session placeholders are filled in-page from auth.refresh.
async function device() {
  const ph: SessionBundle = { headers: { authorization: "__S_AUTH__", "mfp-user-id": "__S_UID__" }, storage: { tz: "America/Los_Angeles" }, capturedAt: 0 };
  const calls = [
    { name: "get_goals", args: {} },
    { name: "search_food", args: { query: QUERY, limit: 3 } },
    { name: "get_diary", args: {} },
  ].map((c) => {
    const t = tool(c.name);
    return { name: c.name, extract: t.extract, req: renderRequest(t.request!, c.args, ph, {}, t.inputSchema) };
  });
  const refreshUrl = renderRequest(recipe.auth.refresh!, {}, undefined).url;
  const out = aside(`
const dt = await openTab("https://www.myfitnesspal.com/account/my-goals");
const res = await dt.evaluate(async ([calls, refreshUrl]) => {
  const tok = await fetch(refreshUrl, { credentials: "include", headers: { accept: "application/json" } }).then((r) => r.json());
  const fill = (s) => s.replace("__S_AUTH__", (tok.token_type || "Bearer") + " " + tok.access_token).replace("__S_UID__", String(tok.user_id));
  const out = [];
  for (const c of calls) {
    const h = {}; for (const [k, v] of Object.entries(c.req.headers)) h[k] = fill(v);
    const t0 = Date.now();
    try {
      const same = new URL(c.req.url, location.href).origin === location.origin;
      const r = await fetch(c.req.url, { method: c.req.method, headers: h, body: c.req.body, credentials: same ? "include" : "omit" });
      const text = await r.text();
      out.push({ name: c.name, status: r.status, ms: Date.now() - t0, text: text.slice(0, 3000) });
    } catch (e) { out.push({ name: c.name, status: 0, ms: Date.now() - t0, text: String(e) }); }
  }
  return out;
}, [${JSON.stringify(calls)}, ${JSON.stringify(refreshUrl)}]);
console.log("DEVICE_BEGIN" + JSON.stringify(res) + "DEVICE_END");
await closeTab(dt);
`);
  const raw = between(out, "DEVICE");
  if (!raw) throw new Error("device run failed: " + out.slice(0, 300));
  const results = JSON.parse(raw) as { name: string; status: number; ms: number; text: string }[];
  for (const r of results) {
    const c = calls.find((x) => x.name === r.name)!;
    let json: unknown = null;
    try {
      json = JSON.parse(r.text);
    } catch {}
    show(r.name + " (device)", c.req, { status: r.status, ms: r.ms, text: r.text, json }, c.extract);
  }
}

(async () => {
  try {
    if (DEVICE) await device();
    else await cloud();
  } catch (e) {
    failures++;
    console.error("ERROR", e instanceof Error ? e.message : e);
  }
  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
})();
