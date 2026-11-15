/// <reference types="node" />
// Real-traffic capture of app.parkmobile.io, using the same recorder the phone injects.
// Run: npx tsx scripts/re/parkmobile/capture.ts
// Needs a signed-in app.parkmobile.io session in the Aside browser. Opens its own tab, injects the
// recorder (src/lib/capture/recorder.ts) with a ReactNativeWebView shim, walks the playbook with
// Next.js client-side navigation so the hooks survive, runs the read probes, and writes a scrubbed
// capture to scripts/re/parkmobile/captures/<date>.json (gitignored). Raw session values never leave
// the browser: only cookie names and value lengths are reported. Reads only: nothing here starts,
// extends or stops parking.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { COMMON_DENYLIST, type AppCaptureConfig } from "../../../src/lib/capture/apps";
import { buildRecorderScript } from "../../../src/lib/capture/recorder";

const PM_HEADERS = { SourceAppKey: "ParkmobileWeb" };

// Capture config for the lead to drop into src/lib/capture/apps.ts (CAPTURE_APPS.parkmobile).
export const PARKMOBILE_CAPTURE: AppCaptureConfig = {
  slug: "parkmobile",
  loginUrl: "https://app.parkmobile.io/login",
  webOrigin: "https://app.parkmobile.io",
  loggedIn: {
    // Next.js BFF: 200 { userProfile, userId, ... } when signed in, 401 {"message":"Unauthorized"} when not.
    probe: { path: "/api/user", truthyPath: "userProfile" },
    loggedOutPaths: ["/login", "/register", "/magic-link-sent", "/global/login"],
  },
  playbook: [
    { kind: "visit", path: "/account/zones/active", label: "Active parking", dwellMs: 4000 },
    { kind: "visit", path: "/account/zones/history", label: "Parking history", dwellMs: 4000 },
    { kind: "visit", path: "/account/settings", label: "Vehicles and payment", dwellMs: 4000 },
    { kind: "probe", path: "/api/proxy/parkmobileapi/account/vehicles", label: "Vehicles", headers: PM_HEADERS },
    { kind: "probe", path: "/api/payment-methods", label: "Payment methods", headers: PM_HEADERS },
    { kind: "probe", path: "/api/proxy/parkmobileapi/v2/parking/active", label: "Active sessions", headers: PM_HEADERS },
    { kind: "probe", path: "/api/proxy/parkmobileapi/v2/parking/history?parkingActionType=OnDemand", label: "History", headers: PM_HEADERS },
    { kind: "probe", path: "/api/proxy/parkmobileapi/zones/51103", label: "Zone lookup", headers: PM_HEADERS },
    { kind: "probe", path: "/api/zones/71451103", label: "Zone rules", headers: PM_HEADERS },
  ],
  // The session JWT is an HttpOnly cookie (JWT) on app.parkmobile.io; there is no JS-readable bearer to mint.
  sessionProbes: [],
  sessionHeaders: ["x-xsrf-token", "authorization", "cookie"],
  storageKeys: [],
  // XSRF-TOKEN: double-submit CSRF header for non-GET calls. IS_LOGGED_IN: JS-visible signed-in flag.
  // REFRESH_TOKEN is JS-visible too and the recorder's cookie regex picks it up; device execution does not need it.
  cookieNames: ["XSRF-TOKEN", "IS_LOGGED_IN"],
  apiHosts: ["app.parkmobile.io"],
  apiPathHints: ["/api/"],
  denylist: [
    ...COMMON_DENYLIST,
    "launchdarkly",
    "maps.googleapis.com",
    "maps.gstatic.com",
    "res.cloudinary.com",
    "typekit",
    "fonts.googleapis.com",
    "/api/web-auth/",
    "/api/user/flags",
    "/api/refresh",
    "/api/logout",
  ],
  relayPath: "/account/zones/active",
  sensitivePaths: [
    "/api/login",
    "/api/register",
    "/api/refresh",
    "/api/global/login",
    "/api/global/user",
    "/api/cybersource",
    "/api/payment-methods/card",
    "/api/payment-methods/digital",
    "/api/proxy/parkmobileapi/account/paymentmethod",
    "/api/orders/payment",
    "login_token",
  ],
};

// Account details that show up in response bodies. Replaced before anything is written to disk.
const PII_KEY = /^(email|mobile|phone|phoneNumber|firstName|lastName|userName|userId|parkingUserId|ssoId|currentPassword|newPassword|vehicleLpn|lpn|licensePlate|plate|nickname|nickName|vin|maskedCardNumber|cardNumber|creditCardLastFourDigits|cardExpDate|expiryMonth|expiryYear|zipCode|postalCode|address|street|name)$/i;

function scrubJson(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrubJson);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out[k] = PII_KEY.test(k) && x != null && typeof x !== "object" && typeof x !== "boolean" ? "<scrubbed>" : scrubJson(x);
    }
    return out;
  }
  return v;
}

function scrubBody(s: unknown): unknown {
  if (typeof s !== "string" || !s) return s;
  try {
    return JSON.stringify(scrubJson(JSON.parse(s)));
  } catch {
    return s.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "<email>");
  }
}

function main() {
  const date = new Date().toLocaleDateString("en-CA");
  const cfg = PARKMOBILE_CAPTURE;
  const recorder = buildRecorderScript(cfg, { flushMs: 300 });
  const shim = "window.__ycycOut = window.__ycycOut || []; window.ReactNativeWebView = { postMessage: function (s) { window.__ycycOut.push(s); } };";
  const pages = cfg.playbook.flatMap((st) => (st.kind === "visit" ? [st.path] : []));
  const probes = cfg.playbook.flatMap((st) => (st.kind === "probe" ? [{ path: st.path, headers: st.headers }] : []));

  const code = `
const REC = ${JSON.stringify(shim + recorder)};
const PAGES = ${JSON.stringify(pages)};
const PROBES = ${JSON.stringify(probes)};
const pmCap = [];
const pmShape = {};
const pmPages = [];
async function pmPull(t) {
  const raw = await t.evaluate(() => { try { window.__ycyc && window.__ycyc.flush(); window.__ycyc && window.__ycyc.postSession(); } catch (e) {} return (window.__ycycOut || []).splice(0); }).catch(() => []);
  for (const s of raw) {
    let m; try { m = JSON.parse(s); } catch (e) { continue; }
    if (m.t === "cap") pmCap.push(...m.entries);
    else if (m.t === "session") {
      for (const kind of ["headers", "cookies", "storage"]) for (const [k, v] of Object.entries(m[kind] || {})) pmShape[kind + "." + k] = "len " + String(v).length;
    } else if (m.t === "page") pmPages.push({ url: m.url, loggedIn: m.loggedIn, signal: m.signal });
  }
}
async function pmInject(t) {
  await t.evaluate((rec) => { if (!window.__ycyc) { (0, eval)(rec); } return !!window.__ycyc; }, REC);
}
const pmTab = await openTab("https://app.parkmobile.io/search");
await sleep(2500);
await pmInject(pmTab);
const signedIn = await pmTab.evaluate(async () => (await fetch("/api/user", { headers: { accept: "application/json" } })).status);
console.log("signed in probe:", signedIn);
const pmRouter = await pmTab.evaluate(() => !!(window.next && window.next.router && window.next.router.push));
console.log("next router:", pmRouter);
for (const p of PAGES) {
  await pmPull(pmTab);
  if (pmRouter) await pmTab.evaluate((u) => window.next.router.push(u), p).catch((e) => console.log("push failed", String(e).slice(0, 80)));
  else await pmTab.goto("https://app.parkmobile.io" + p, { waitUntil: "domcontentloaded" });
  await sleep(5000);
  const still = await pmTab.evaluate(() => !!window.__ycyc).catch(() => false);
  if (!still) { await pmInject(pmTab); await sleep(2000); }
  await pmPull(pmTab);
  console.log("page", p, "hooks survived:", still, "entries:", pmCap.length);
}
let pmI = 0;
for (const pr of PROBES) { await pmTab.evaluate(([id, u, h]) => window.__ycyc.probe(id, u, "GET", null, h), ["p" + (pmI++), pr.path, pr.headers || null]); await sleep(500); }
await sleep(3500);
await pmPull(pmTab);
await pmTab.evaluate(() => window.__ycyc.checkLogin());
await sleep(1500);
await pmPull(pmTab);
const pmOut = { capturedAt: Date.now(), date: ${JSON.stringify(date)}, pages: PAGES, probes: PROBES, sessionShape: pmShape, pageLog: pmPages, entries: pmCap };
console.log("CAPTURE_JSON_BEGIN" + JSON.stringify(pmOut) + "CAPTURE_JSON_END");
console.log("session keys:", JSON.stringify(pmShape));
console.log(pmCap.map((e) => e.method + " " + e.status + " " + e.initiator + " " + e.url.replace(/login_token=[^&]+/, "login_token=<redacted>").slice(0, 150)).join("\\n"));
await closeTab(pmTab);
`;

  const out = execFileSync("aside", ["repl", code], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 150000 });
  const m = /CAPTURE_JSON_BEGIN([\s\S]*?)CAPTURE_JSON_END/.exec(out);
  console.log(out.replace(/CAPTURE_JSON_BEGIN[\s\S]*?CAPTURE_JSON_END/, "<capture json>"));
  if (!m) {
    console.error("no capture returned");
    process.exit(1);
  }
  const cap = JSON.parse(m[1]) as { entries: { url: string; reqBody?: string; resBody?: string }[] };
  for (const e of cap.entries) {
    e.url = e.url.replace(/login_token=[^&]+/, "login_token=<redacted>");
    e.reqBody = scrubBody(e.reqBody) as string | undefined;
    e.resBody = scrubBody(e.resBody) as string | undefined;
  }
  const dir = join(__dirname, "captures");
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, date + ".json");
  writeFileSync(dest, JSON.stringify(cap, null, 1));
  console.log("saved", dest, "(" + cap.entries.length + " entries)");
}

if (require.main === module) main();
