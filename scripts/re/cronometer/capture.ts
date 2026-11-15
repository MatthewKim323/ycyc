/// <reference types="node" />
// Real-traffic capture of cronometer.com, using the same recorder the phone injects.
// Run: npx tsx scripts/re/cronometer/capture.ts [search term]
// Needs a signed-in cronometer.com session in the Aside browser. Opens the web app (a GWT single-page
// app at https://cronometer.com/#diary), injects the recorder (src/lib/capture/recorder.ts) with a
// ReactNativeWebView shim, walks the playbook in-app (diary day back and forward, food search typed in
// the Add Food dialog, then closed without adding), and writes a scrubbed capture to
// scripts/re/cronometer/captures/<date>.json.
//
// Scrubbing happens inside the page before anything leaves it: the GWT session nonce (a lowercase
// 32-hex string inside every /cronometer/app request body) becomes <nonce> and the account id becomes
// <user_id>. Only key names and value lengths of session material are reported.
// Never writes to the diary: the recorder only watches, and the dialog is closed with Escape.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { COMMON_DENYLIST, type AppCaptureConfig } from "../../../src/lib/capture/apps";
import { buildRecorderScript } from "../../../src/lib/capture/recorder";

// Proposed capture config for apps.ts (the lead wires it in). Kept here so this script and the report agree.
export const CRONOMETER_CAPTURE: AppCaptureConfig = {
  slug: "cronometer",
  loginUrl: "https://cronometer.com/login/",
  webOrigin: "https://cronometer.com",
  loggedIn: {
    // Signed out, "/" is the marketing page; signed in, "/" serves the GWT app shell.
    loggedOutPaths: ["/login", "/signup", "/forgot", "/password"],
    domSelectors: ['script[src*="cronometer.nocache.js"]', "i.diary-date-previous"],
  },
  playbook: [
    { kind: "visit", path: "/#diary", label: "Diary", dwellMs: 6000 },
    { kind: "probe", path: "/api/v3/user/{{session.storage.user_id}}/targets", label: "Nutrient targets" },
    { kind: "probe", path: "/api/v3/user/{{session.storage.user_id}}/food-search/string?query=BANANA&maxResults=5&sources=All&categoryId=0&selectedTab=ALL&type=All", label: "Food search" },
  ],
  sessionProbes: [],
  sessionHeaders: ["x-gwt-permutation"],
  storageKeys: [],
  cookieNames: [],
  apiHosts: ["cronometer.com"],
  apiPathHints: ["/cronometer/app", "/api/v3/", "/export"],
  denylist: [...COMMON_DENYLIST, "zdassets.com", "zopim", "stripe.com", "/api/v3/stripe/", "firebase", "braze", "/cronometer/deferredjs/", ".cache.js", ".nocache.js"],
  // Must be a static page: loading /login/ while signed in kills the GWT nonce, and "/" reloads the
  // app, whose authenticate call rotates it.
  relayPath: "/about/",
  sensitivePaths: ["/login", "/signup", "/password", "/forgot"],
};

const search = process.argv[2] || "banana";
const date = new Date().toLocaleDateString("en-CA");
const recorder = buildRecorderScript(CRONOMETER_CAPTURE, { flushMs: 300 });
const shim = "window.__ycycOut = window.__ycycOut || []; window.ReactNativeWebView = { postMessage: function (s) { window.__ycycOut.push(s); } };";
// Reads the nonce and user id off the app's own requests so they can be scrubbed in-page.
const sniff = `(function(){ if (window.__crSniff) return; window.__crSniff = {}; var O = XMLHttpRequest.prototype, oo = O.open, os = O.send;
  O.open = function (m, u) { this.__cu = String(u); return oo.apply(this, arguments); };
  O.send = function (b) { var s = String(b || ""); var n = /\\|([0-9a-f]{32})\\|/.exec(s); if (n) window.__crSniff.nonce = n[1]; if (s.indexOf("7|0|") === 0) window.__crSniff.policy = s.split("|")[4];
    var u = /\\/api\\/v3\\/user\\/(\\d+)\\//.exec(this.__cu || ""); if (u) window.__crSniff.uid = u[1]; return os.apply(this, arguments); }; })();`;

const code = `
const REC = ${JSON.stringify(shim + sniff + recorder)};
const SEARCH = ${JSON.stringify(search)};
const capAll = [];
const sessionShape = {};
const pageLog = [];
async function capPull(t) {
  const raw = await t.evaluate(() => {
    try { window.__ycyc && window.__ycyc.flush(); } catch (e) {}
    const S = window.__crSniff || {};
    const scrub = (s) => { let o = String(s); if (S.nonce) o = o.split(S.nonce).join("<nonce>"); if (S.uid) o = o.split(S.uid).join("<user_id>"); return o.replace(/\\b[0-9a-f]{32}\\b/g, "<nonce>"); };
    return (window.__ycycOut || []).splice(0).map(scrub);
  }).catch(() => []);
  for (const s of raw) {
    let m; try { m = JSON.parse(s); } catch (e) { continue; }
    if (m.t === "cap") capAll.push(...m.entries);
    else if (m.t === "session") { for (const kind of ["headers", "cookies", "storage"]) for (const [k, v] of Object.entries(m[kind] || {})) sessionShape[kind + "." + k] = "len " + String(v).length; }
    else if (m.t === "page") pageLog.push({ url: m.url, loggedIn: m.loggedIn, signal: m.signal });
  }
}
const nudge = (t, sel) => t.evaluate((s) => { const el = [...document.querySelectorAll(s)].find((e) => e.getBoundingClientRect().width > 0); if (el) ["mousedown", "mouseup", "click"].forEach((ty) => el.dispatchEvent(new MouseEvent(ty, { bubbles: true }))); return !!el; }, sel);
const capTab = await openTab("https://cronometer.com/#diary");
await sleep(6000);
const signedIn = await capTab.evaluate(() => !!document.querySelector('script[src*="cronometer.nocache.js"]'));
console.log("signed in:", signedIn);
if (signedIn) {
  await capTab.evaluate((rec) => { if (!window.__ycyc) { (0, eval)(rec); } return !!window.__ycyc; }, REC);
  console.log("diary back:", await nudge(capTab, "i.diary-date-previous")); await sleep(3000);
  console.log("diary forward:", await nudge(capTab, "i.diary-date-next")); await sleep(3000);
  await capPull(capTab);
  const snapA = await snapshot(capTab, { interactive: true });
  const foodRef = (/button "Log a serving to your diary" \\[ref=(e\\d+)\\]/.exec(snapA.tree) || [])[1];
  if (foodRef) {
    await capTab.locator(foodRef).click();
    await sleep(2000);
    const box = capTab.locator('input[placeholder*="earch"]').first();
    await box.click();
    await box.pressSequentially(SEARCH, { delay: 60 });
    await capTab.keyboard.press("Enter");
    await sleep(3500);
    await capTab.keyboard.press("Escape");
    await sleep(800);
  }
  await capPull(capTab);
  const sess = await capTab.evaluate(() => { const S = window.__crSniff || {}; return { nonce: S.nonce ? "len " + S.nonce.length : null, uid: S.uid ? "len " + S.uid.length : null, policy: S.policy || null }; });
  sessionShape["storage.nonce"] = sess.nonce; sessionShape["storage.user_id"] = sess.uid; sessionShape["storage.gwt_policy"] = sess.policy;
  await capTab.evaluate(() => { try { window.__ycyc.checkLogin(); } catch (e) {} });
  await sleep(1200);
  await capPull(capTab);
}
const capOut = { capturedAt: Date.now(), date: ${JSON.stringify(date)}, sessionShape, pageLog, entries: capAll };
console.log("CAPTURE_JSON_BEGIN" + JSON.stringify(capOut) + "CAPTURE_JSON_END");
console.log("session keys:", JSON.stringify(sessionShape));
console.log(capAll.map((e) => e.method + " " + e.status + " " + e.initiator + " " + e.url.slice(0, 120) + (e.reqBody && e.reqBody.startsWith("7|0|") ? " " + e.reqBody.split("|")[6] : "")).join("\\n"));
await closeTab(capTab);
`;

const out = execFileSync("aside", ["repl", code], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 150000 });
const m = /CAPTURE_JSON_BEGIN([\s\S]*?)CAPTURE_JSON_END/.exec(out);
console.log(out.replace(/CAPTURE_JSON_BEGIN[\s\S]*?CAPTURE_JSON_END/, "<capture json>").split("\n").filter((l) => !/is available|aside update/.test(l)).join("\n"));
if (m) {
  const dir = join(__dirname, "captures");
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, date + ".json");
  // Second pass: anything that still looks like a nonce or a long token.
  const text = JSON.stringify(JSON.parse(m[1]), null, 1).replace(/\b[0-9a-f]{32}\b/g, "<nonce>");
  writeFileSync(dest, text);
  console.log("saved", dest);
}
