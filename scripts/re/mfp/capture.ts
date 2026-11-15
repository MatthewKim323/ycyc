/// <reference types="node" />
// Real-traffic capture of myfitnesspal.com, using the same recorder the phone injects.
// Run: npx tsx scripts/re/mfp/capture.ts [search term]
// Needs a signed-in myfitnesspal.com session in the Aside browser. Opens its own tab, injects the
// recorder (src/lib/capture/recorder.ts) with a ReactNativeWebView shim, walks the playbook with
// client-side navigation so the hooks survive, and writes a redacted capture to
// scripts/re/mfp/captures/<date>.json. Raw session values never leave the browser: only header
// names and value lengths are reported.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { captureConfigFor } from "../../../src/lib/capture/apps";
import { buildRecorderScript } from "../../../src/lib/capture/recorder";

const search = process.argv[2] || "banana";
const date = new Date().toLocaleDateString("en-CA");
const cfg = captureConfigFor("myfitnesspal");
const recorder = buildRecorderScript(cfg, { flushMs: 300 });
const shim = "window.__ycycOut = window.__ycycOut || []; window.ReactNativeWebView = { postMessage: function (s) { window.__ycycOut.push(s); } };";

const pages = ["/food/diary?date=" + date, "/account/my-goals", "/food/search?search=" + encodeURIComponent(search)];
// Probe steps come straight from the phone playbook (apps.ts), plus a few extra BFF routes.
const probes: { path: string; headers?: Record<string, string> }[] = [
  ...cfg.playbook.flatMap((st) => (st.kind === "probe" ? [{ path: st.path.replace(/\{\{today\}\}/g, date), headers: st.headers }] : [])),
  { path: "/api/services/diary/read_diary?entry_date=" + date },
  { path: "/api/services/diary/read_day?date=" + date },
  { path: "/api/services/nutrient-goals?date=" + date },
];

const code = `
const REC = ${JSON.stringify(shim + recorder)};
const PAGES = ${JSON.stringify(pages)};
const PROBES = ${JSON.stringify(probes)};
const capAll = [];
const sessionShape = {};
const pageLog = [];
async function capPull(t) {
  const raw = await t.evaluate(() => { try { window.__ycyc && window.__ycyc.flush(); window.__ycyc && window.__ycyc.postSession(); } catch (e) {} const o = (window.__ycycOut || []).splice(0); return o; }).catch(() => []);
  for (const s of raw) {
    let m; try { m = JSON.parse(s); } catch (e) { continue; }
    if (m.t === "cap") capAll.push(...m.entries);
    else if (m.t === "session") {
      for (const kind of ["headers", "cookies", "storage"]) for (const [k, v] of Object.entries(m[kind] || {})) sessionShape[kind + "." + k] = "len " + String(v).length;
    } else if (m.t === "page") pageLog.push({ url: m.url, loggedIn: m.loggedIn, signal: m.signal });
  }
}
async function capInject(t) {
  await t.evaluate((rec) => { if (!window.__ycyc) { (0, eval)(rec); } return !!window.__ycyc; }, REC);
}
const capTab = await openTab("https://www.myfitnesspal.com/food/diary");
await sleep(2500);
await capInject(capTab);
const hasRouter = await capTab.evaluate(() => !!(window.next && window.next.router && window.next.router.push));
console.log("next router:", hasRouter);
for (const p of PAGES) {
  await capPull(capTab);
  if (hasRouter) {
    await capTab.evaluate((u) => window.next.router.push(u), p).catch((e) => console.log("push failed", String(e).slice(0, 80)));
  } else {
    await capTab.goto("https://www.myfitnesspal.com" + p, { waitUntil: "domcontentloaded" });
  }
  await sleep(6000);
  const still = await capTab.evaluate(() => !!window.__ycyc).catch(() => false);
  if (!still) { await capInject(capTab); await sleep(2500); }
  await capPull(capTab);
  console.log("page", p, "hooks survived:", still, "entries:", capAll.length);
}
await capTab.evaluate(() => window.__ycyc.runSessionProbes());
await sleep(3000);
let pi = 0;
for (const pr of PROBES) { await capTab.evaluate(([id, u, h]) => window.__ycyc.probe(id, u, "GET", null, h), ["p" + (pi++), pr.path, pr.headers || null]); await sleep(400); }
await sleep(4000);
await capPull(capTab);
await capTab.evaluate(() => window.__ycyc.checkLogin());
await sleep(1500);
await capPull(capTab);
const capOut = { capturedAt: Date.now(), date: ${JSON.stringify(date)}, pages: PAGES, probes: PROBES, sessionShape, pageLog, entries: capAll };
console.log("CAPTURE_JSON_BEGIN" + JSON.stringify(capOut) + "CAPTURE_JSON_END");
console.log("session keys:", JSON.stringify(sessionShape));
console.log(capAll.map((e) => e.method + " " + e.status + " " + e.initiator + " " + e.url.slice(0, 150)).join("\\n"));
await closeTab(capTab);
`;

const out = execFileSync("aside", ["repl", code], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 150000 });
const m = /CAPTURE_JSON_BEGIN([\s\S]*?)CAPTURE_JSON_END/.exec(out);
console.log(out.replace(/CAPTURE_JSON_BEGIN[\s\S]*?CAPTURE_JSON_END/, "<capture json>"));
if (m) {
  const dir = join(__dirname, "captures");
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, date + ".json");
  // Scrub account identifiers (user ids show up in token responses, profile rows and cookie names).
  let text = JSON.stringify(JSON.parse(m[1]), null, 1);
  const ids = new Set<string>();
  for (const mm of text.matchAll(/\\?"(?:user_id|userId)\\?":\\?"?(\d{6,})/g)) ids.add(mm[1]);
  for (const mm of text.matchAll(/_website_(\d{6,})/g)) ids.add(mm[1]);
  for (const id of ids) text = text.split(id).join("<user_id>");
  writeFileSync(dest, text);
  console.log("saved", dest);
}
