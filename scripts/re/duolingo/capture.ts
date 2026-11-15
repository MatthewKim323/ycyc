/// <reference types="node" />
// Real-traffic capture of duolingo.com, using the same recorder the phone injects.
// Run: npx tsx scripts/re/duolingo/capture.ts
// Needs a signed-in duolingo.com session in the Aside browser. Opens its own tab, injects the recorder
// (src/lib/capture/recorder.ts) built from DUOLINGO_CAPTURE below, walks the sidebar with client-side
// navigation so the hooks survive, runs the recipe endpoints as probes, and writes a redacted capture to
// scripts/re/duolingo/captures/<date>.json. Raw session values never leave the browser: only names and
// value lengths are reported, and the user id, JWT and username are scrubbed in-page.
//
// DUOLINGO_CAPTURE is the config the in-app recorder needs (copy into src/lib/capture/apps.ts).

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { COMMON_DENYLIST, type AppCaptureConfig } from "../../../src/lib/capture/apps";
import { buildRecorderScript } from "../../../src/lib/capture/recorder";

export const DUOLINGO_CAPTURE: AppCaptureConfig = {
  slug: "duolingo",
  loginUrl: "https://www.duolingo.com/log-in",
  webOrigin: "https://www.duolingo.com",
  loggedIn: {
    // Signed out, /learn redirects client-side to "/" and there is no jwt_token cookie. The sidebar links
    // below render only for a signed-in user. Strongest signal: document.cookie has jwt_token (JS-readable).
    loggedOutPaths: ["/log-in", "/login", "/register", "/sign-up", "/signup", "/forgot_password", "/reset_password", "/logout"],
    domSelectors: ['a[href="/leaderboard"]', 'a[href="/quests"]'],
  },
  playbook: [
    { kind: "visit", path: "/learn", label: "Learn", dwellMs: 4500 },
    { kind: "visit", path: "/leaderboard", label: "Leaderboard", dwellMs: 3500 },
    { kind: "visit", path: "/quests", label: "Quests", dwellMs: 3000 },
  ],
  // No token mint: the API bearer is the jwt_token cookie itself (exp claim is in 2169).
  sessionProbes: [],
  sessionHeaders: ["authorization"],
  storageKeys: [],
  // jwt_token: the bearer. logged_out_uuid: equals the numeric user id once signed in (checked live).
  cookieNames: ["jwt_token", "logged_out_uuid", "logged_in"],
  apiHosts: ["duolingo.com"],
  apiPathHints: ["/2017-06-30/", "/2023-05-23/", "/v2/mistakes/", "/leaderboards/", "/users/"],
  denylist: [
    ...COMMON_DENYLIST,
    "/api/1/sync/batch",
    "zombie.duolingo.com",
    "excess.duolingo.com",
    "/2023-05-23/config",
    "/subscription-catalog",
    "/shop-items",
    "/family-plan",
    "/avatar-builder-config",
    "/built-avatar-states",
    "/messaging/",
    "/rocks/",
    "/friends/",
    "/kudos",
    "/reactions/",
    "/lottie/",
  ],
  relayPath: "/learn",
  sensitivePaths: ["/login", "/log-in", "/register", "/password", "/users/reset"],
};

const date = new Date().toLocaleDateString("en-CA");
const recorder = buildRecorderScript(DUOLINGO_CAPTURE, { flushMs: 300 });
const shim = "window.__ycycOut = window.__ycycOut || []; window.ReactNativeWebView = { postMessage: function (s) { window.__ycycOut.push(s); } };";

const navs = ["/leaderboard", "/quests", "/learn"];
// Recipe endpoints, run from the page through the hooked fetch. "{uid}" is filled in-page from the JWT
// sub claim; the bearer comes from the header the recorder captured off the site's own calls.
const AUTH = { authorization: "{{session.headers.authorization}}" };
const probes: { path: string; method?: "GET" | "POST"; body?: string; headers?: Record<string, string> }[] = [
  { path: "/2023-05-23/users/{uid}?fields=streak,streakData%7BcurrentStreak,longestStreak,previousStreak%7D,xpGoal,xpGoalMetToday,timezone,trackingProperties%7Bnum_item_streak_freeze%7D,shopItems%7Bid,quantity%7D", headers: AUTH },
  { path: "/2023-05-23/users/{uid}?fields=username,totalXp,xpGoal,xpGoalMetToday,weeklyXp,monthlyXp,streak,gems,hasPlus,currentCourseId,courses%7Bid,title,learningLanguage,fromLanguage,xp%7D,trackingProperties%7Bleaderboard_tier_name,leaderboard_league%7D", headers: AUTH },
  { path: "/2023-05-23/users/{uid}/xp_summaries?startDate=" + date + "&endDate=" + date + "&timezone=America%2FLos_Angeles", headers: AUTH },
  { path: "/2023-05-23/users/{uid}?fields=currentCourseId,currentCourse%7Bid,wordsLearned,numberOfWords,pathSectionsSummary%7Bindex,type,completedUnits,totalUnits,cefr%7D%7D", headers: AUTH },
  { path: "/2023-05-23/users/{uid}?fields=xpGains", headers: AUTH },
  { path: "https://duolingo-leaderboards-prod.duolingo.com/leaderboards/7d9f5dd1-8423-491a-91f2-2532052038ce/users/{uid}?get_reactions=true", headers: AUTH },
];

const code = `
const REC = ${JSON.stringify(shim + recorder)};
const NAVS = ${JSON.stringify(navs)};
const PROBES = ${JSON.stringify(probes)};
const capAll = [];
const sessionShape = {};
const pageLog = [];
async function capPull(t) {
  const raw = await t.evaluate(() => { try { window.__ycyc && window.__ycyc.flush(); window.__ycyc && window.__ycyc.postSession(); } catch (e) {} return (window.__ycycOut || []).splice(0); }).catch(() => []);
  for (const s of raw) {
    let m; try { m = JSON.parse(s); } catch (e) { continue; }
    if (m.t === "cap") capAll.push(...m.entries);
    else if (m.t === "session") {
      for (const kind of ["headers", "cookies", "storage"]) for (const [k, v] of Object.entries(m[kind] || {})) sessionShape[kind + "." + k] = "len " + String(v).length;
    } else if (m.t === "page") pageLog.push({ url: m.url, loggedIn: m.loggedIn, signal: m.signal });
  }
}
const capTab = await openTab("https://www.duolingo.com/learn");
await sleep(3000);
const signedIn = await capTab.evaluate(() => ({ path: location.pathname, jwt: /(?:^|; )jwt_token=/.test(document.cookie), nav: !!document.querySelector('a[href="/leaderboard"]') }));
console.log("signed in:", JSON.stringify(signedIn));
if (!signedIn.jwt) {
  console.log("NOT_SIGNED_IN need matt to log into duolingo.com in Aside");
} else {
  await capTab.evaluate((rec) => { if (!window.__ycyc) { (0, eval)(rec); } return !!window.__ycyc; }, REC);
  for (const p of NAVS) {
    await capPull(capTab);
    const how = await capTab.evaluate((h) => { const a = document.querySelector('a[href="' + h + '"]'); if (a) { a.click(); return "click"; } return "missing"; }, p);
    await sleep(4000);
    const still = await capTab.evaluate(() => !!window.__ycyc).catch(() => false);
    await capPull(capTab);
    console.log("nav", p, how, "hooks survived:", still, "entries:", capAll.length);
  }
  const uidLen = await capTab.evaluate((probes) => {
    const jwt = (document.cookie.match(/(?:^|; )jwt_token=([^;]+)/) || [])[1] || "";
    let uid = ""; try { uid = String(JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub || ""); } catch (e) {}
    probes.forEach((pr, i) => window.__ycyc.probe("p" + i, pr.path.split("{uid}").join(uid), pr.method || "GET", pr.body || null, pr.headers || null));
    return uid.length;
  }, PROBES);
  console.log("probes sent, uid digits:", uidLen);
  await sleep(5000);
  await capPull(capTab);
  await capTab.evaluate(() => window.__ycyc.checkLogin());
  await sleep(1500);
  await capPull(capTab);
  // Scrub in-page: user id, JWT and username never leave the browser.
  const scrubbed = await capTab.evaluate((txt) => {
    const jwt = (document.cookie.match(/(?:^|; )jwt_token=([^;]+)/) || [])[1] || "";
    let uid = ""; try { uid = String(JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub || ""); } catch (e) {}
    let out = txt;
    if (jwt) out = out.split(jwt).join("<jwt>");
    if (uid) out = out.split(uid).join("<user_id>");
    const un = (out.match(/\\\\?"username\\\\?":\\\\?"([^"\\\\]+)/) || [])[1];
    if (un && un.length > 2) out = out.split(un).join("<username>");
    return out;
  }, JSON.stringify({ capturedAt: Date.now(), date: ${JSON.stringify(date)}, navs: NAVS, probes: PROBES, sessionShape, pageLog, entries: capAll }));
  console.log("CAPTURE_JSON_BEGIN" + scrubbed + "CAPTURE_JSON_END");
  console.log("session keys:", JSON.stringify(sessionShape));
  console.log(capAll.map((e) => e.method + " " + e.status + " " + e.initiator + " " + e.url.replace(/\\d{9,}/g, "<n>").slice(0, 150)).join("\\n"));
}
await closeTab(capTab);
`;

const out = execFileSync("aside", ["repl", code], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 150000 });
const m = /CAPTURE_JSON_BEGIN([\s\S]*?)CAPTURE_JSON_END/.exec(out);
console.log(out.replace(/CAPTURE_JSON_BEGIN[\s\S]*?CAPTURE_JSON_END/, "<capture json>"));
if (m) {
  const dir = join(__dirname, "captures");
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, date + ".json");
  writeFileSync(dest, JSON.stringify(JSON.parse(m[1]), null, 1));
  console.log("saved", dest);
} else if (/NOT_SIGNED_IN/.test(out)) {
  process.exitCode = 2;
}
