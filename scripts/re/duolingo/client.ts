/// <reference types="node" />
// Live Duolingo client driven by the recipe. Renders every request with the same renderRequest the
// backend uses, so a passing run means a passing recipe.
//
//   npx tsx scripts/re/duolingo/client.ts             # cloud path, every tool (all reads)
//   npx tsx scripts/re/duolingo/client.ts --device    # run the read tools inside a signed-in page (relay path)
//
// No write tool: the web app has no daily goal setting any more, and PATCH /users/{id} {"xpGoal"} returns
// 200 but leaves the goal unchanged (checked live on 2017-06-30 and 2023-05-23).
//
// Session: read from the Aside browser's signed-in duolingo.com tab, the way the in-app recorder does it:
// headers.authorization = "Bearer " + jwt_token cookie, storage.userId = the JWT sub claim. Held in memory
// only, never printed or written.

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
const DEVICE = flag("--device");
const RECIPE_PATH = opt("--recipe", join(__dirname, "../../../recipes/duolingo.json"));

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

// In-page snippet shared by mintSession and device(): reads the JWT cookie and its sub claim.
const READ_JWT = `
  const jwt = (document.cookie.match(/(?:^|; )jwt_token=([^;]+)/) || [])[1] || "";
  let sub = "";
  try { sub = String(JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub || ""); } catch (e) {}
`;

function mintSession(): SessionBundle {
  const out = aside(`
const st = await openTab("https://www.duolingo.com/robots.txt");
const tok = await st.evaluate(() => {
  ${READ_JWT}
  if (!jwt || !sub) return { error: "not signed in to duolingo.com (no jwt_token cookie)" };
  return { authorization: "Bearer " + jwt, userId: sub, tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
});
console.log("SESSION_BEGIN" + JSON.stringify(tok) + "SESSION_END");
await closeTab(st);
`);
  const raw = between(out, "SESSION");
  if (!raw) throw new Error("could not read session: " + out.slice(0, 300));
  const s = JSON.parse(raw);
  if (s.error) throw new Error(s.error);
  return { headers: { authorization: s.authorization }, storage: { userId: s.userId, tz: s.tz }, capturedAt: Date.now() };
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
let uidForScrub = "";
const scrub = (s: string) => (uidForScrub ? s.split(uidForScrub).join("<uid>") : s);

function show(name: string, req: RenderedRequest, r: CallResult, summary: string, okExtra = true) {
  const ok = r.status >= 200 && r.status < 300 && okExtra;
  if (!ok) failures++;
  console.log(`\n${ok ? "PASS" : "FAIL"} ${name}  ${req.method} ${scrub(req.url)}  -> ${r.status} in ${r.ms}ms`);
  console.log("  " + scrub(summary));
}

async function runTool(name: string, args: Record<string, unknown>, session: SessionBundle) {
  const t = tool(name);
  const req = renderRequest(t.request!, args, session, {}, t.inputSchema);
  const r = await cloudCall(req);
  return { t, req, r, data: r.json ? extractPath(r.json, t.extract) : undefined };
}

type Streak = { length: number; startDate: string; endDate: string; lastExtendedDate?: string } | null;
type User = {
  username?: string;
  totalXp?: number;
  xpGoal?: number;
  xpGoalMetToday?: boolean;
  weeklyXp?: number;
  monthlyXp?: number;
  streak?: number;
  gems?: number;
  hasPlus?: boolean;
  currentCourseId?: string;
  timezone?: string;
  streakData?: { currentStreak: Streak; longestStreak: Streak; previousStreak: Streak };
  shopItems?: { id: string; quantity?: number }[];
  trackingProperties?: { num_item_streak_freeze?: number; leaderboard_tier_name?: string; leaderboard_league?: number; num_sessions_completed?: number };
  courses?: { id: string; title: string; learningLanguage: string; fromLanguage: string; xp: number }[];
  currentCourse?: { id: string; xp: number; wordsLearned?: number; numberOfWords?: number; activePathSectionId?: string; pathSectionsSummary?: { id: string; index: number; type: string; completedUnits: number; totalUnits: number; cefr?: { level?: string } | null }[] };
};
type XpDay = { date: number; gainedXp: number; dailyGoalXp?: number; numSessions?: number; totalSessionTime?: number; streakExtended?: boolean; frozen?: boolean };
type Mistake = { prompt?: string; skillId?: string; timestamp?: number; challengeIdentifier?: { specificType?: string } };
type League = { tier?: number; active?: { cohort?: { rankings?: { display_name: string; score: number }[] } } | null; leaderboard?: { active_contest?: { contest_end?: string } }; stats?: { highest_league?: number } };

const LEAGUES = ["Bronze", "Silver", "Gold", "Sapphire", "Ruby", "Emerald", "Amethyst", "Pearl", "Obsidian", "Diamond"];

async function cloud() {
  console.log("reading session from the signed-in browser page (jwt_token cookie)...");
  const session = mintSession();
  uidForScrub = session.storage?.userId || "";
  console.log("session ok: headers [" + Object.keys(session.headers || {}).join(", ") + "], storage [" + Object.keys(session.storage || {}).join(", ") + "], tz " + session.storage?.tz);

  if (recipe.auth.check) {
    const req = renderRequest(recipe.auth.check, {}, session);
    const r = await cloudCall(req);
    show("auth.check", req, r, "status " + r.status);
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: session.storage?.tz || "America/Los_Angeles" }).format(new Date());

  const st = await runTool("get_streak", {}, session);
  const s = st.data as User | undefined;
  const cur = s?.streakData?.currentStreak;
  const freezes = s?.trackingProperties?.num_item_streak_freeze ?? s?.shopItems?.find((x) => x.id === "streak_freeze")?.quantity ?? 0;
  const doneToday = !!s?.xpGoalMetToday || cur?.lastExtendedDate === today;
  show("get_streak", st.req, st.r, s ? `streak ${s.streak} days (since ${cur?.startDate ?? "-"}), done today: ${doneToday} (xpGoalMetToday ${s.xpGoalMetToday}, lastExtended ${cur?.lastExtendedDate ?? "-"}), freezes left: ${freezes}, longest ${s.streakData?.longestStreak?.length ?? 0}` : trim(st.r.text), typeof s?.streak === "number");

  const pr = await runTool("get_profile_summary", {}, session);
  const p = pr.data as User | undefined;
  show("get_profile_summary", pr.req, pr.r, p ? `totalXp ${p.totalXp}, goal ${p.xpGoal} XP/day (met today: ${p.xpGoalMetToday}), weeklyXp ${p.weeklyXp}, monthlyXp ${p.monthlyXp}, gems ${p.gems}, super ${p.hasPlus}, league ${p.trackingProperties?.leaderboard_tier_name} (tier ${p.trackingProperties?.leaderboard_league}), current ${p.currentCourseId}, courses: ${(p.courses || []).map((c) => c.title + " " + c.xp + "xp").join(", ")}` : trim(pr.r.text), typeof p?.totalXp === "number");

  const xt = await runTool("get_xp_history", {}, session);
  const xs = (xt.data as XpDay[] | undefined) ?? [];
  show("get_xp_history (today)", xt.req, xt.r, `${xs.length} day(s): ` + xs.map((d) => `${new Date(d.date * 1000).toISOString().slice(0, 10)} ${d.gainedXp}xp, ${d.numSessions} sessions, ${d.totalSessionTime}s, streakExtended ${d.streakExtended}, frozen ${d.frozen}`).join(" | "), Array.isArray(xt.data));

  const weekStart = new Intl.DateTimeFormat("en-CA", { timeZone: session.storage?.tz || "America/Los_Angeles" }).format(new Date(Date.now() - 6 * 864e5));
  const xw = await runTool("get_xp_history", { start_date: weekStart }, session);
  const xws = (xw.data as XpDay[] | undefined) ?? [];
  show("get_xp_history (7 days)", xw.req, xw.r, `${xws.length} day(s) with activity, ${xws.reduce((a, d) => a + (d.gainedXp || 0), 0)} XP total`, Array.isArray(xw.data));

  const co = await runTool("get_courses", {}, session);
  const c = co.data as User | undefined;
  const secs = c?.currentCourse?.pathSectionsSummary || [];
  const curSec = secs.find((x) => x.type === "learning" && x.completedUnits < x.totalUnits);
  show("get_courses", co.req, co.r, c ? `courses: ${(c.courses || []).map((x) => `${x.id} (${x.title}, ${x.xp}xp)`).join(", ")}; active ${c.currentCourse?.id}: ${c.currentCourse?.wordsLearned ?? 0}/${c.currentCourse?.numberOfWords} words, ${secs.length} sections, current section ${curSec ? curSec.index + " (" + (curSec.cefr?.level ?? "-") + ") " + curSec.completedUnits + "/" + curSec.totalUnits + " units" : "-"}` : trim(co.r.text), Array.isArray(c?.courses));

  const courseId = c?.currentCourseId || p?.currentCourseId || "";
  const wk = await runTool("get_weak_words", { course_id: courseId }, session);
  const ms = (wk.data as Mistake[] | undefined) ?? [];
  show("get_weak_words", wk.req, wk.r, `${ms.length} mistakes in ${courseId}: ` + ms.slice(0, 6).map((m) => `"${m.prompt}" (${m.challengeIdentifier?.specificType})`).join(", "), Array.isArray(wk.data));

  const lg = await runTool("get_league", {}, session);
  const l = lg.data as League | undefined;
  const ranks = l?.active?.cohort?.rankings || [];
  show("get_league", lg.req, lg.r, l ? `tier ${l.tier} (${LEAGUES[l.tier ?? 0]}), in cohort: ${!!l.active}${ranks.length ? ", " + ranks.length + " competitors" : ""}, week ends ${l.leaderboard?.active_contest?.contest_end}, highest league ${l.stats?.highest_league}` : trim(lg.r.text), typeof l?.tier === "number");

  const rl = await runTool("get_recent_lessons", {}, session);
  const gains = (rl.data as { xp: number; skillId?: string; eventType?: string; time: number }[] | undefined) ?? [];
  show("get_recent_lessons", rl.req, rl.r, `${gains.length} events: ` + gains.slice(-5).map((g) => `${g.eventType} +${g.xp}xp skill ${g.skillId} at ${new Date(g.time * 1000).toISOString()}`).join(" | "), Array.isArray(rl.data));

  const skillId = gains.slice().reverse().find((g) => g.skillId)?.skillId || ms.find((m) => m.skillId)?.skillId || "";
  const lang = c?.courses?.find((x) => x.id === courseId);
  const sw = await runTool("get_skill_words", { skill_id: skillId, learning_language: lang?.learningLanguage, from_language: lang?.fromLanguage }, session);
  const words = sw.data as { learnedLexemes?: { text: string; translations: string[] }[]; pagination?: { totalLexemes: number } } | undefined;
  show("get_skill_words", sw.req, sw.r, `${words?.pagination?.totalLexemes ?? 0} words in skill ${skillId}: ` + (words?.learnedLexemes || []).slice(0, 8).map((w) => `${w.text} = ${w.translations.join("/")}`).join(", "), Array.isArray(words?.learnedLexemes) && (words?.learnedLexemes?.length ?? 0) > 0);
}

// Device path: the same rendered requests, executed inside the signed-in duolingo.com page the way
// DeviceRelay does it on the phone. Cookies are omitted (bearer header only), so this also proves the
// templates need nothing beyond the SessionBundle. Session placeholders are filled in-page.
async function device() {
  const ph: SessionBundle = { headers: { authorization: "__S_AUTH__" }, storage: { userId: "__S_UID__", tz: "America/Los_Angeles" }, capturedAt: 0 };
  const calls = [
    { name: "get_streak", args: {} },
    { name: "get_profile_summary", args: {} },
    { name: "get_xp_history", args: {} },
    { name: "get_courses", args: {} },
    { name: "get_league", args: {} },
    { name: "get_recent_lessons", args: {} },
  ].map((c) => {
    const t = tool(c.name);
    return { name: c.name, extract: t.extract, req: renderRequest(t.request!, c.args, ph, {}, t.inputSchema) };
  });
  const out = aside(`
const dt = await openTab("https://www.duolingo.com/robots.txt");
const res = await dt.evaluate(async (calls) => {
  ${READ_JWT}
  const fill = (s) => s.split("__S_AUTH__").join("Bearer " + jwt).split("__S_UID__").join(sub);
  const scrub = (s) => s.split(sub).join("<uid>").split(jwt).join("<jwt>");
  const out = [];
  for (const c of calls) {
    const h = {}; for (const [k, v] of Object.entries(c.req.headers)) h[k] = fill(v);
    const t0 = Date.now();
    try {
      const r = await fetch(fill(c.req.url), { method: c.req.method, headers: h, body: c.req.body, credentials: "omit" });
      const text = await r.text();
      out.push({ name: c.name, status: r.status, ms: Date.now() - t0, text: scrub(text.slice(0, 600)) });
    } catch (e) { out.push({ name: c.name, status: 0, ms: Date.now() - t0, text: String(e) }); }
  }
  return out;
}, ${JSON.stringify(calls)});
console.log("DEVICE_BEGIN" + JSON.stringify(res) + "DEVICE_END");
await closeTab(dt);
`);
  const raw = between(out, "DEVICE");
  if (!raw) throw new Error("device run failed: " + out.slice(0, 300));
  const results = JSON.parse(raw) as { name: string; status: number; ms: number; text: string }[];
  for (const r of results) {
    const c = calls.find((x) => x.name === r.name)!;
    show(r.name + " (device)", c.req, { status: r.status, ms: r.ms, text: r.text, json: null }, trim(r.text, 300));
  }
}

(async () => {
  try {
    if (DEVICE) await device();
    else await cloud();
  } catch (e) {
    failures++;
    console.error("ERROR", e instanceof Error ? scrub(e.message) : e);
  }
  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
})();
