/// <reference types="node" />
// Live Cronometer client driven by the recipe. Renders every request with the same renderRequest the
// backend uses, so a passing run means a passing recipe.
//
//   npx tsx scripts/re/cronometer/client.ts                # device path, read tools only
//   npx tsx scripts/re/cronometer/client.ts --write        # also log 1 banana to Snacks today, confirm, delete, confirm
//   npx tsx scripts/re/cronometer/client.ts --cloud        # try the same reads from Node with no cookies (executor probe)
//   npx tsx scripts/re/cronometer/client.ts --query "greek yogurt"
//
// Session: matt's signed-in cronometer.com session in the Aside browser. Each run opens the web app,
// lets it authenticate (that mints the session nonce), reads the nonce, user id, GWT policy and
// permutation off the app's own GWT requests, closes the app tab, then runs the rendered requests from
// a static same-origin page (/about/), which is what the phone's hidden relay WebView does. Session
// values stay inside the page (device) or in memory (--cloud). Nothing is printed or written.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Recipe, RecipeTool, SessionBundle } from "../../../src/lib/contract";
import { renderRequest, todayIn, type RenderedRequest } from "../../../src/lib/compiler/render";

const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const opt = (f: string, d: string) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const WRITE = flag("--write");
const CLOUD = flag("--cloud");
const QUERY = opt("--query", "banana");
const RECIPE_PATH = opt("--recipe", join(__dirname, "../../../recipes/cronometer.json"));
// Not /login/: loading the login page while signed in kills the GWT session nonce (checked live).
const RELAY_URL = "https://cronometer.com/about/";

const recipe = JSON.parse(readFileSync(RECIPE_PATH, "utf8")) as Recipe;
const tool = (name: string): RecipeTool => {
  const t = recipe.tools.find((x) => x.name === name);
  if (!t || !t.request) throw new Error("recipe has no tool " + name);
  return t;
};

// Placeholders filled inside the page from the live app session.
const PH: SessionBundle = {
  storage: { nonce: "__NONCE__", user_id: "__UID__", gwt_policy: "__POLICY__", tz: "America/Los_Angeles", tz_offset_min: "__TZOFF__" },
  headers: { "x-gwt-permutation": "__PERM__" },
  capturedAt: 0,
};

const today = todayIn("America/Los_Angeles");
const [Y, M, D] = today.split("-").map(Number);
const dayArgs = { day: D, month: M, year: Y };

function aside(code: string): string {
  return execFileSync("aside", ["repl", code], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 150000 });
}

function between(out: string, tag: string): string | null {
  const m = new RegExp(tag + "_BEGIN([\\s\\S]*?)" + tag + "_END").exec(out);
  return m ? m[1] : null;
}

// In-page: open the app, hook XHR, nudge the diary so the app sends GWT calls, read the session values
// off those calls. Leaves them in window.__cr of the relay tab only. Prints nothing secret.
const MINT = `
async function crMint() {
  const app = await openTab("https://cronometer.com/#diary");
  await sleep(6000);
  const signedIn = await app.evaluate(() => !!document.querySelector('script[src*="cronometer.nocache.js"]'));
  if (!signedIn) { await closeTab(app); return { error: "not signed in to cronometer.com in Aside" }; }
  await app.evaluate(() => {
    window.__crS = {};
    const O = XMLHttpRequest.prototype, oOpen = O.open, oSend = O.send, oSet = O.setRequestHeader;
    O.open = function (m, u) { this.__u = String(u); return oOpen.apply(this, arguments); };
    O.setRequestHeader = function (k, v) { if (/x-gwt-permutation/i.test(k)) window.__crS.perm = String(v); return oSet.apply(this, arguments); };
    O.send = function (b) {
      const s = String(b || "");
      if (s.startsWith("7|0|")) { const p = s.split("|"); window.__crS.policy = p[4]; const n = /\\|([0-9a-f]{32})\\|/.exec(s); if (n) window.__crS.nonce = n[1]; }
      const u = /\\/api\\/v3\\/user\\/(\\d+)\\//.exec(this.__u || ""); if (u) window.__crS.uid = u[1];
      return oSend.apply(this, arguments);
    };
  });
  const nudge = (sel) => app.evaluate((s) => { const el = [...document.querySelectorAll(s)].find((e) => e.getBoundingClientRect().width > 0); if (el) ["mousedown", "mouseup", "click"].forEach((t) => el.dispatchEvent(new MouseEvent(t, { bubbles: true }))); return !!el; }, sel);
  await nudge("i.diary-date-previous"); await sleep(2500); await nudge("i.diary-date-next"); await sleep(3000);
  const s = await app.evaluate(() => Object.assign({}, window.__crS, { tzoff: String(-new Date().getTimezoneOffset()) }));
  await closeTab(app);
  if (!s.nonce || !s.uid || !s.policy || !s.perm) return { error: "could not read session values (" + Object.keys(s).join(",") + ")" };
  return s;
}
`;

// Runs steps inside the relay page. A step may fill a placeholder from an earlier step's response.
const RUN = `
async function crRun(sess, steps) {
  const relay = await openTab(${JSON.stringify(RELAY_URL)});
  const res = await relay.evaluate(async ([sess, steps]) => {
    const fills = { __NONCE__: sess.nonce, __UID__: sess.uid, __POLICY__: sess.policy, __PERM__: sess.perm, __TZOFF__: sess.tzoff };
    const fill = (s) => s == null ? s : Object.entries(fills).reduce((a, [k, v]) => a.split(k).join(v), s);
    const scrub = (t) => String(t).split(sess.nonce).join("<nonce>").split(sess.uid).join("<uid>");
    const out = [];
    for (const st of steps) {
      if (st.fillFrom) {
        const src = out.find((o) => o.name === st.fillFrom.step);
        const m = src && new RegExp(st.fillFrom.regex).exec(src.raw || "");
        if (!m) { out.push({ name: st.name, status: 0, ms: 0, text: "no value for " + st.fillFrom.key }); continue; }
        fills[st.fillFrom.key] = m[1];
      }
      const h = {}; for (const [k, v] of Object.entries(st.req.headers || {})) h[k] = fill(v);
      const t0 = Date.now();
      try {
        const r = await fetch(fill(st.req.url), { method: st.req.method, headers: h, body: st.req.method === "GET" ? undefined : fill(st.req.body), credentials: "include" });
        const text = await r.text();
        out.push({ name: st.name, status: r.status, ms: Date.now() - t0, raw: text, text: scrub(text).slice(0, 30000) });
      } catch (e) { out.push({ name: st.name, status: 0, ms: Date.now() - t0, text: String(e) }); }
    }
    return out.map((o) => ({ name: o.name, status: o.status, ms: o.ms, text: o.text }));
  }, [sess, steps]);
  await closeTab(relay);
  return res;
}
`;

interface Step {
  name: string;
  req: RenderedRequest;
  fillFrom?: { step: string; regex: string; key: string };
}
interface StepResult {
  name: string;
  status: number;
  ms: number;
  text: string;
}

function device(steps: Step[]): StepResult[] {
  const out = aside(`${MINT}${RUN}
const crSess = await crMint();
if (crSess.error) { console.log("RUN_BEGIN" + JSON.stringify({ error: crSess.error }) + "RUN_END"); }
else { const crRes = await crRun(crSess, ${JSON.stringify(steps)}); console.log("RUN_BEGIN" + JSON.stringify(crRes) + "RUN_END"); }
`);
  const raw = between(out, "RUN");
  if (!raw) throw new Error("device run failed: " + out.slice(0, 400));
  const parsed = JSON.parse(raw);
  if (parsed.error) throw new Error(parsed.error);
  return parsed as StepResult[];
}

const render = (name: string, args: Record<string, unknown>, session: SessionBundle = PH): RenderedRequest => {
  const t = tool(name);
  return renderRequest(t.request!, args, session, {}, t.inputSchema);
};

const trim = (s: string, n = 400) => (s.length > n ? s.slice(0, n) + "..." : s);
let failures = 0;
function show(r: StepResult, req: RenderedRequest | undefined, summary: string, pass = true) {
  const ok = r.status >= 200 && r.status < 300 && pass;
  if (!ok) failures++;
  const url = req ? req.url.replace(/\/user\/[^/]+\//, "/user/<uid>/") : "";
  const method = req ? req.body?.split("|")[6] ?? "" : "";
  console.log(`\n${ok ? "PASS" : "FAIL"} ${r.name}  ${req?.method ?? ""} ${url}${method && req?.body?.startsWith("7|0|") ? " (" + method + ")" : ""}  -> ${r.status} in ${r.ms}ms`);
  console.log("  " + summary);
}

const gwtOk = (t: string) => t.startsWith("//OK");

type Hit = { name: string; id: number; measureId: number; measureDisplayName: string; source: string };

function reads() {
  const steps: Step[] = [
    { name: "auth.check", req: renderRequest(recipe.auth.check!, {}, PH) },
    { name: "search_food", req: render("search_food", { query: QUERY, limit: 5 }) },
    { name: "get_targets", req: render("get_targets", {}) },
    { name: "get_diary", req: render("get_diary", dayArgs) },
    { name: "get_daily_nutrition", req: render("get_daily_nutrition", dayArgs) },
  ];
  const res = device(steps);
  const by = (n: string) => res.find((r) => r.name === n)!;
  const reqOf = (n: string) => steps.find((s) => s.name === n)!.req;

  const chk = by("auth.check");
  show(chk, reqOf("auth.check"), "status " + chk.status);

  const sr = by("search_food");
  let hits: Hit[] = [];
  try {
    hits = JSON.parse(sr.text);
  } catch {}
  show(sr, reqOf("search_food"), hits.map((h) => `${h.name} [${h.source}] id=${h.id} measureId=${h.measureId} "${h.measureDisplayName}"`).join(" | ") || trim(sr.text), hits.length > 0);

  const tg = by("get_targets");
  let targets: { id: number; min: number | null; max: number | null }[] = [];
  try {
    targets = JSON.parse(tg.text);
  } catch {}
  const pick = [208, 203, 205, 204, 291, 304, 303, 324, 307];
  show(tg, reqOf("get_targets"), `${targets.length} targets; ` + pick.map((id) => { const t = targets.find((x) => x.id === id); return `${id}: ${t ? (t.min ?? "-") + ".." + (t.max ?? "-") : "?"}`; }).join(", "), targets.length > 0);

  const dy = by("get_diary");
  show(dy, reqOf("get_diary"), trim(dy.text, 500), gwtOk(dy.text));

  const nu = by("get_daily_nutrition");
  show(nu, reqOf("get_daily_nutrition"), trim(nu.text, 700), gwtOk(nu.text));
  return hits;
}

function writeTest(hits: Hit[]) {
  const food = hits.find((h) => /^banana, fresh$/i.test(h.name)) ?? hits[0];
  if (!food) {
    failures++;
    console.log("FAIL no search result to log");
    return;
  }
  const logArgs = { food_id: food.id, measure_id: food.measureId, amount: 1, meal: 262145, ...dayArgs };
  // A serving id is the first quoted string in the updateDiary //OK response.
  const SID = '//OK\\[[^"]*"([^"]+)"';
  const steps: Step[] = [
    { name: "get_diary (before)", req: render("get_diary", dayArgs) },
    { name: "log_food", req: render("log_food", logArgs) },
    { name: "get_diary (confirm)", req: render("get_diary", dayArgs) },
    { name: "get_daily_nutrition (after log)", req: render("get_daily_nutrition", dayArgs) },
    { name: "delete_diary_entry", req: render("delete_diary_entry", { serving_id: "__SID__" }), fillFrom: { step: "log_food", regex: SID, key: "__SID__" } },
    { name: "get_diary (cleanup)", req: render("get_diary", dayArgs) },
  ];
  const res = device(steps);
  const by = (n: string) => res.find((r) => r.name === n)!;
  const reqOf = (n: string) => steps.find((s) => s.name === n)!.req;

  const before = by("get_diary (before)");
  show(before, reqOf("get_diary (before)"), trim(before.text, 300), gwtOk(before.text));
  const lg = by("log_food");
  const sid = (new RegExp(SID).exec(lg.text) || [])[1];
  show(lg, reqOf("log_food"), sid ? `logged 1 x "${food.measureDisplayName}" of ${food.name} to Snacks ${today}, serving id ${sid}. ${trim(lg.text, 300)}` : trim(lg.text, 500), gwtOk(lg.text) && !!sid);
  if (!sid) return;
  const cf = by("get_diary (confirm)");
  const present = cf.text.includes(`"${sid}"`);
  show(cf, reqOf("get_diary (confirm)"), present ? `serving ${sid} present. ${trim(cf.text, 400)}` : "serving NOT found after logging: " + trim(cf.text, 300), present);
  const nu = by("get_daily_nutrition (after log)");
  show(nu, reqOf("get_daily_nutrition (after log)"), trim(nu.text, 700), gwtOk(nu.text));
  const del = by("delete_diary_entry");
  show(del, reqOf("delete_diary_entry"), trim(del.text, 200), gwtOk(del.text));
  const fin = by("get_diary (cleanup)");
  const gone = !fin.text.includes(`"${sid}"`);
  show(fin, reqOf("get_diary (cleanup)"), gone ? `cleanup ok: serving ${sid} gone. ${trim(fin.text, 300)}` : "serving STILL present after delete", gone);
}

// Executor probe: same reads from Node, no cookies. Session values held in memory only.
async function cloud() {
  const out = aside(`${MINT}
const crS2 = await crMint();
console.log("SESSION_BEGIN" + JSON.stringify(crS2) + "SESSION_END");
`);
  const raw = between(out, "SESSION");
  if (!raw) throw new Error("mint failed: " + out.slice(0, 300));
  const s = JSON.parse(raw);
  if (s.error) throw new Error(s.error);
  const session: SessionBundle = { storage: { nonce: s.nonce, user_id: s.uid, gwt_policy: s.policy, tz: "America/Los_Angeles" }, headers: { "x-gwt-permutation": s.perm }, capturedAt: Date.now() };
  for (const [name, args] of [["get_diary", dayArgs], ["get_targets", {}], ["search_food", { query: QUERY, limit: 3 }]] as const) {
    const req = render(name, args as Record<string, unknown>, session);
    const t0 = Date.now();
    const r = await fetch(req.url, { method: req.method, headers: req.headers, body: req.method === "GET" ? undefined : req.body });
    const text = (await r.text()).split(s.nonce).join("<nonce>").split(s.uid).join("<uid>");
    console.log(`cloud ${name}: ${r.status} in ${Date.now() - t0}ms  ${trim(text.replace(/\s+/g, " "), 160)}`);
  }
}

(async () => {
  try {
    if (CLOUD) await cloud();
    else {
      const hits = reads();
      if (WRITE) writeTest(hits);
    }
  } catch (e) {
    failures++;
    console.error("ERROR", e instanceof Error ? e.message : e);
  }
  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
})();
