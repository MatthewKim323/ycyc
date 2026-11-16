/// <reference types="node" />
// Backend end-to-end test over the real MCP endpoint, with matt's live app sessions from the Aside browser.
//
//   npx tsx scripts/test/e2e.ts                       # everything (5 apps, reads + writes + approvals)
//   npx tsx scripts/test/e2e.ts --only mfp,duolingo   # subset (mfp strong duolingo cronometer parkmobile)
//   npx tsx scripts/test/e2e.ts --no-writes           # protocol + connect + reads only
//   npx tsx scripts/test/e2e.ts --keep                # leave the test connections connected
//
// What it does: makes a throwaway user (users.ensure with deviceId e2e-<ts>), runs MCP protocol checks,
// connects each app WITHOUT the phone (SessionBundle minted from the signed-in Aside tabs, the way the
// scripts/re/<app> agents do it), emulates the phone's DeviceRelay for device-executor apps (polls
// calls.queued, runs each request inside a signed-in Aside page with credentials, calls.complete), calls
// every read tool over MCP tools/call, runs one write per app through the approval flow (approve, deny,
// approve twice, approve_hour grant, late approval + check_approval), cleans up and disconnects.
//
// Secrets: sessions live in memory only. Every line printed goes through scrub(). Nothing is written to
// disk except Strong's rotated tokens, written back to ~/.ycyc/re-state/strong.json (where they already
// live) so the RE scripts keep working after the backend rotates them.
// ParkMobile: reads only. start_parking / extend_parking are refused by the client below.

import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const execFileP = promisify(execFile);
const api = anyApi as any;
const ROOT = join(__dirname, "..", "..");

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const opt = (f: string, d: string) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const ALIASES: Record<string, string> = { mfp: "myfitnesspal", myfitnesspal: "myfitnesspal", strong: "strong", duolingo: "duolingo", duo: "duolingo", cronometer: "cronometer", crono: "cronometer", parkmobile: "parkmobile", pm: "parkmobile" };
const ALL_APPS = ["myfitnesspal", "strong", "duolingo", "cronometer", "parkmobile"];
const APPS = opt("--only", "").trim() ? opt("--only", "").split(",").map((s) => ALIASES[s.trim().toLowerCase()]).filter(Boolean) : ALL_APPS;
const WRITES = !flag("--no-writes");
const KEEP = flag("--keep");
const TZ = "America/Los_Angeles";

function envUrl(): string {
  if (process.env.CONVEX_URL) return process.env.CONVEX_URL;
  const m = /^EXPO_PUBLIC_CONVEX_URL=(.+)$/m.exec(readFileSync(join(ROOT, ".env.local"), "utf8"));
  if (!m) throw new Error("EXPO_PUBLIC_CONVEX_URL missing from .env.local");
  return m[1].trim().replace(/^["']|["']$/g, "");
}
const CONVEX_URL = envUrl();
const convex = new ConvexHttpClient(CONVEX_URL);

// ---------- scrubbed output ----------
const SECRETS = new Set<string>();
const secret = <T extends string | undefined>(v: T): T => {
  if (v && v.length >= 6) SECRETS.add(v);
  return v;
};
function scrub(s: string): string {
  let out = s;
  for (const v of [...SECRETS].sort((a, b) => b.length - a.length)) out = out.split(v).join("<redacted>");
  return out
    .replace(/\/mcp\/[^/\s"']+/g, "/mcp/<token>")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "<jwt>")
    .replace(/\b(bearer)\s+[A-Za-z0-9._~+/=-]{16,}/gi, "$1 <redacted>")
    .replace(/\b[0-9a-f]{40,}\b/g, "<hex>");
}
const log = (...a: unknown[]) => console.log(scrub(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")));
const short = (s: string, n = 220) => {
  const t = s.replace(/\s+/g, " ");
  return t.length > n ? t.slice(0, n) + "..." : t;
};

type Verdict = "PASS" | "FAIL" | "SKIP";
const results: { group: string; check: string; verdict: Verdict; detail: string }[] = [];
function record(group: string, check: string, ok: boolean | "skip", detail = "") {
  const verdict: Verdict = ok === "skip" ? "SKIP" : ok ? "PASS" : "FAIL";
  results.push({ group, check, verdict, detail: scrub(short(detail, 300)) });
  log(`${verdict.padEnd(4)} [${group}] ${check}${detail ? "  " + short(detail, 300) : ""}`);
}
const leftovers: string[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const [TY, TM, TD] = today.split("-").map(Number);

function tryJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

// ---------- Aside ----------
async function aside(code: string, timeoutMs = 140_000): Promise<string> {
  const { stdout } = await execFileP("aside", ["repl", code], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs });
  return stdout;
}
function between(out: string, tag: string): string | null {
  const m = new RegExp(tag + "_BEGIN([\\s\\S]*?)" + tag + "_END").exec(out);
  return m ? m[1] : null;
}

// ---------- MCP client ----------
interface RpcReply {
  status: number;
  headers: Headers;
  text: string;
  json: any;
}
class Mcp {
  sessionId?: string;
  protocolVersion = "2025-06-18";
  private n = 0;
  constructor(public url: string) {}
  async post(body: unknown, opts: { url?: string; raw?: string; session?: boolean } = {}): Promise<RpcReply> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": this.protocolVersion,
      "user-agent": "yuzu-e2e/1.0",
    };
    if (this.sessionId && opts.session !== false) headers["mcp-session-id"] = this.sessionId;
    const res = await fetch(opts.url ?? this.url, { method: "POST", headers, body: opts.raw ?? JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, json: tryJson(text) };
  }
  async rpc(method: string, params?: unknown): Promise<any> {
    const r = await this.post({ jsonrpc: "2.0", id: ++this.n, method, ...(params !== undefined ? { params } : {}) });
    if (!r.json) throw new Error(`${method}: HTTP ${r.status} ${short(r.text, 200)}`);
    if (r.json.error) throw new Error(`${method}: ${r.json.error.code} ${r.json.error.message}`);
    return r.json.result;
  }
  async init(clientName = "yuzu-e2e"): Promise<any> {
    const r = await this.post(
      { jsonrpc: "2.0", id: ++this.n, method: "initialize", params: { protocolVersion: this.protocolVersion, capabilities: {}, clientInfo: { name: clientName, version: "1.0" } } },
      { session: false },
    );
    this.sessionId = r.headers.get("mcp-session-id") ?? undefined;
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
    return r.json?.result;
  }
  async call(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean; ms: number }> {
    if (/^parkmobile__(start_parking|extend_parking)$/.test(name)) throw new Error("refusing to call a ParkMobile write (charges money)");
    const t0 = Date.now();
    const result = await this.rpc("tools/call", { name, arguments: args });
    const text = (result?.content ?? []).map((c: any) => c.text ?? "").join("\n");
    return { text, isError: !!result?.isError, ms: Date.now() - t0 };
  }
}

// ---------- device relay emulation ----------
const RELAY_PAGES: Record<string, string> = {
  cronometer: "https://cronometer.com/about/",
  parkmobile: "https://app.parkmobile.io/account/zones/active",
  myfitnesspal: "https://www.myfitnesspal.com/account/my-goals",
  duolingo: "https://www.duolingo.com/learn",
};
class Relay {
  private running = false;
  private seen = new Set<string>();
  handled: { app: string; tool: string; status: number; ms: number }[] = [];
  errors: string[] = [];
  private loop?: Promise<void>;
  constructor(private userId: string) {}
  start() {
    this.running = true;
    this.loop = this.run();
  }
  async stop() {
    this.running = false;
    await this.loop;
  }
  private async run() {
    while (this.running) {
      try {
        const queued = (await convex.query(api.calls.queued, { userId: this.userId })) as any[];
        const fresh = queued.filter((c) => !this.seen.has(c._id));
        if (fresh.length) {
          fresh.forEach((c) => this.seen.add(c._id));
          const byPage = new Map<string, any[]>();
          for (const c of fresh) {
            const page = RELAY_PAGES[c.appSlug] ?? new URL(c.request.url).origin + "/";
            byPage.set(page, [...(byPage.get(page) ?? []), c]);
          }
          await Promise.all([...byPage.entries()].map(([page, calls]) => this.exec(page, calls)));
        }
      } catch (e) {
        this.errors.push(String(e).slice(0, 200));
      }
      await sleep(400);
    }
  }
  // Same semantics as src/lib/capture/relay.ts: same-origin calls carry cookies, others omit them.
  private async exec(page: string, calls: any[]) {
    const reqs = calls.map((c) => ({ id: c._id, ...c.request }));
    const t0 = Date.now();
    let out = "";
    try {
      out = await aside(
        `
const rlTab = await openTab(${JSON.stringify(page)});
const rlRes = await rlTab.evaluate(async (reqs) => {
  const res = [];
  for (const q of reqs) {
    let same = false; try { same = new URL(q.url, location.href).origin === location.origin; } catch (e) {}
    const init = { method: q.method || "GET", headers: q.headers || {}, credentials: same ? "include" : "omit", redirect: "follow" };
    if (q.body != null && init.method !== "GET" && init.method !== "HEAD") init.body = q.body;
    try { const r = await fetch(q.url, init); const t = await r.text(); res.push({ id: q.id, status: r.status, body: t.slice(0, 200000) }); }
    catch (e) { res.push({ id: q.id, status: 0, body: JSON.stringify({ error: String(e) }) }); }
  }
  return res;
}, ${JSON.stringify(reqs)});
console.log("RELAY_BEGIN" + JSON.stringify(rlRes) + "RELAY_END");
await closeTab(rlTab);
`,
        60_000,
      );
    } catch (e) {
      this.errors.push("aside: " + String(e).slice(0, 200));
    }
    const raw = between(out, "RELAY");
    const parsed: { id: string; status: number; body: string }[] = raw ? JSON.parse(raw) : [];
    for (const c of calls) {
      const r = parsed.find((p) => p.id === c._id) ?? { status: 0, body: JSON.stringify({ error: "relay failed" }) };
      try {
        await convex.mutation(api.calls.complete, { callId: c._id, response: { status: r.status, body: r.body } });
      } catch (e) {
        this.errors.push("complete: " + String(e).slice(0, 200));
      }
      this.handled.push({ app: c.appSlug, tool: c.tool, status: r.status, ms: Date.now() - t0 });
    }
  }
}

// ---------- session minting (memory only) ----------
type Session = Record<string, any>;

async function mintMfp(): Promise<Session> {
  const recipe = JSON.parse(readFileSync(join(ROOT, "recipes/myfitnesspal.json"), "utf8"));
  const out = await aside(`
const mfTab = await openTab("https://www.myfitnesspal.com/api/auth/session");
const mfTok = await mfTab.evaluate(async (u) => {
  const r = await fetch(u, { credentials: "include", headers: { accept: "application/json" } });
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("json")) return { error: "not signed in (" + r.status + ")" };
  const j = await r.json();
  return { authorization: (j.token_type || "Bearer") + " " + j.access_token, userId: String(j.user_id), expiresIn: j.expires_in };
}, ${JSON.stringify(recipe.auth.refresh.urlTemplate)});
console.log("S_BEGIN" + JSON.stringify(mfTok) + "S_END");
await closeTab(mfTab);
`);
  const s = tryJson(between(out, "S") ?? "") ?? { error: "no output" };
  if (s.error) throw new Error("MFP: " + s.error);
  secret(s.authorization);
  secret(s.authorization.replace(/^\S+\s+/, ""));
  return {
    headers: { authorization: s.authorization.replace(/^bearer /i, "Bearer "), "mfp-user-id": s.userId },
    storage: { tz: TZ },
    capturedAt: Date.now(),
    _note: `token expires in ${s.expiresIn}s`,
  };
}

async function mintDuolingo(): Promise<Session> {
  const out = await aside(`
const duTab = await openTab("https://www.duolingo.com/robots.txt");
const duTok = await duTab.evaluate(() => {
  const jwt = (document.cookie.match(/(?:^|; )jwt_token=([^;]+)/) || [])[1] || "";
  let sub = ""; try { sub = String(JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub || ""); } catch (e) {}
  if (!jwt || !sub) return { error: "not signed in (no jwt_token cookie)" };
  return { jwt, sub };
});
console.log("S_BEGIN" + JSON.stringify(duTok) + "S_END");
await closeTab(duTab);
`);
  const s = tryJson(between(out, "S") ?? "") ?? { error: "no output" };
  if (s.error) throw new Error("Duolingo: " + s.error);
  secret(s.jwt);
  return { headers: { authorization: "Bearer " + s.jwt }, storage: { userId: s.sub, tz: TZ }, capturedAt: Date.now() };
}

async function mintParkmobile(): Promise<Session> {
  const out = await aside(`
const pmTab = await openTab(${JSON.stringify(RELAY_PAGES.parkmobile)});
const pmTok = await pmTab.evaluate(async () => {
  const xsrf = decodeURIComponent((document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]+)/) || [])[1] || "");
  let user = 0; try { user = (await fetch("/api/user", { credentials: "include", headers: { accept: "application/json" } })).status; } catch (e) {}
  return { xsrf, user };
});
console.log("S_BEGIN" + JSON.stringify(pmTok) + "S_END");
await closeTab(pmTab);
`);
  const s = tryJson(between(out, "S") ?? "") ?? { error: "no output" };
  if (s.error) throw new Error("ParkMobile: " + s.error);
  if (s.user !== 200) throw new Error(`ParkMobile: /api/user answered ${s.user} in the Aside tab (signed out?)`);
  secret(s.xsrf);
  return { cookies: s.xsrf ? { "XSRF-TOKEN": s.xsrf } : {}, storage: { tz: TZ, signedIn: "1" }, capturedAt: Date.now() };
}

// Same as scripts/re/cronometer/client.ts MINT: open the app, sniff nonce/uid/policy/permutation off its GWT calls.
async function mintCronometer(): Promise<Session> {
  const out = await aside(`
const crApp = await openTab("https://cronometer.com/#diary");
await sleep(6000);
const crSignedIn = await crApp.evaluate(() => !!document.querySelector('script[src*="cronometer.nocache.js"]'));
let crS = { error: "not signed in to cronometer.com in Aside" };
if (crSignedIn) {
  await crApp.evaluate(() => {
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
  const nudge = (sel) => crApp.evaluate((s) => { const el = [...document.querySelectorAll(s)].find((e) => e.getBoundingClientRect().width > 0); if (el) ["mousedown", "mouseup", "click"].forEach((t) => el.dispatchEvent(new MouseEvent(t, { bubbles: true }))); return !!el; }, sel);
  await nudge("i.diary-date-previous"); await sleep(2500); await nudge("i.diary-date-next"); await sleep(3000);
  crS = await crApp.evaluate(() => Object.assign({}, window.__crS, { tzoff: String(-new Date().getTimezoneOffset()) }));
  if (!crS.nonce || !crS.uid || !crS.policy || !crS.perm) crS = { error: "could not read session values (" + Object.keys(crS).join(",") + ")" };
}
await closeTab(crApp);
console.log("S_BEGIN" + JSON.stringify(crS) + "S_END");
`);
  const s = tryJson(between(out, "S") ?? "") ?? { error: "no output" };
  if (s.error) throw new Error("Cronometer: " + s.error);
  secret(s.nonce);
  return {
    storage: { nonce: s.nonce, user_id: s.uid, gwt_policy: s.policy, tz: TZ, tz_offset_min: s.tzoff },
    headers: { "x-gwt-permutation": s.perm },
    capturedAt: Date.now(),
  };
}

const STRONG_STATE = join(homedir(), ".ycyc", "re-state", "strong.json");
function mintStrong(): Session {
  const st = JSON.parse(readFileSync(STRONG_STATE, "utf8"));
  if (!st.accessToken || !st.refreshToken) throw new Error("Strong: no tokens in ~/.ycyc/re-state/strong.json");
  secret(st.accessToken);
  secret(st.refreshToken);
  return {
    storage: { accessToken: st.accessToken, refreshToken: st.refreshToken, userId: st.userId, deviceId: st.deviceId },
    capturedAt: Date.now(),
  };
}

// Internal connection doc (holds rotated Strong tokens). Read via the CLI, kept in memory.
async function connectionDoc(connectionId: string): Promise<any> {
  const { stdout } = await execFileP("npx", ["convex", "run", "connections:get", JSON.stringify({ connectionId })], { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 60_000 });
  const start = stdout.indexOf("{");
  return start >= 0 ? JSON.parse(stdout.slice(start)) : null;
}
async function convexRun(fn: string, args: unknown): Promise<string> {
  const { stdout } = await execFileP("npx", ["convex", "run", fn, JSON.stringify(args)], { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 90_000 });
  return stdout;
}

// ---------- approvals ----------
async function pendingIds(userId: string): Promise<Set<string>> {
  const rows = (await convex.query(api.approvals.pending, { userId })) as any[];
  return new Set(rows.map((r) => r._id));
}
async function waitNewApproval(userId: string, tool: string, before: Set<string>, timeoutMs = 15_000): Promise<any | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const rows = (await convex.query(api.approvals.pending, { userId })) as any[];
    const row = rows.find((r) => r.tool === tool && !before.has(r._id));
    if (row) return row;
    await sleep(300);
  }
  return null;
}
type Decision = "approve" | "approve_hour" | "deny";
async function decide(approvalId: string, decision: Decision): Promise<any> {
  return convex.mutation(api.approvals.decide, { approvalId, decision });
}

// Write over MCP with a decision made "on the phone". Returns the MCP reply and the approval row.
async function write(
  mcp: Mcp,
  userId: string,
  name: string,
  args: Record<string, unknown>,
  decision: Decision | "late" | "expect-no-prompt",
): Promise<{ text: string; isError: boolean; approval: any | null; late?: { firstText: string; checkText: string } }> {
  const tool = name.split("__")[1];
  const before = await pendingIds(userId);
  const callP = mcp.call(name, args);
  if (decision === "expect-no-prompt") {
    const r = await callP;
    const after = (await convex.query(api.approvals.pending, { userId })) as any[];
    const extra = after.find((a) => a.tool === tool && !before.has(a._id)) ?? null;
    if (extra) await decide(extra._id, "deny");
    return { ...r, approval: extra };
  }
  const approval = await waitNewApproval(userId, tool, before);
  if (!approval) {
    const r = await callP;
    return { ...r, approval: null };
  }
  if (decision === "late") {
    const first = await callP; // the MCP call gives up after ~20 s
    await decide(approval._id, "approve");
    const end = Date.now() + 45_000;
    let check = { text: "", isError: false, ms: 0 };
    while (Date.now() < end) {
      check = await mcp.call("check_approval", { id: approval._id });
      if (!/Waiting|running now/i.test(check.text)) break;
      await sleep(1500);
    }
    return { text: check.text, isError: check.isError, approval, late: { firstText: first.text, checkText: check.text } };
  }
  await decide(approval._id, decision);
  const r = await callP;
  return { ...r, approval };
}

const resultBody = (text: string) => text.replace(/^Approved and done\. Result:\s*/, "");

// ---------- connect ----------
async function connect(userId: string, slug: string, session: Session): Promise<{ connectionId: string; build: any }> {
  const { _note, ...bundle } = session;
  const connectionId = (await convex.mutation(api.connections.start, { userId, appSlug: slug })) as string;
  await convex.mutation(api.connections.submitLogin, { connectionId, session: bundle, capture: [] });
  const end = Date.now() + 120_000;
  let build: any = null;
  while (Date.now() < end) {
    build = await convex.query(api.builds.forConnection, { connectionId });
    if (build && (build.status === "done" || build.status === "error")) break;
    await sleep(1000);
  }
  return { connectionId, build };
}

// ---------- per-app read suites ----------
interface Ctx {
  mcp: Mcp;
  userId: string;
  conns: Record<string, string>;
}

async function read(c: Ctx, group: string, name: string, args: Record<string, unknown>, check: (text: string, j: any) => [boolean, string]) {
  try {
    const r = await c.mcp.call(name, args);
    const j = tryJson(r.text);
    const [ok, detail] = r.isError ? [false, "isError: " + r.text] : check(r.text, j);
    const cut = /\[truncated \d+ chars\]/.exec(r.text);
    record(group, `${name.split("__")[1]} (${r.ms} ms)`, ok, `${detail}${cut ? ` [reply cut at 8 KB, ${cut[0].slice(11, -1)} dropped]` : ""}`);
    if (!ok) log(`    reply (${r.text.length} chars): ${short(r.text, 300)}`);
    return { ...r, json: j };
  } catch (e) {
    record(group, name.split("__")[1], false, String(e));
    return { text: "", isError: true, ms: 0, json: undefined };
  }
}
const arr = (j: any) => (Array.isArray(j) ? j : []);
// Item count that survives the executor's 8 KB cut (the JSON no longer parses then).
const n = (t: string, j: any, key: string) => (Array.isArray(j) ? j.length : t.split(`"${key}":`).length - 1);

async function readsMfp(c: Ctx) {
  const g = "MFP read";
  await read(c, g, "myfitnesspal__get_goals", {}, (t, j) => [!!j && /energy|calorie/i.test(t), j?.default_goal?.energy ? `default goal ${j.default_goal.energy.value} kcal` : short(t, 120)]);
  const s = await read(c, g, "myfitnesspal__search_food", { query: "banana", limit: 5 }, (t, j) => [n(t, j, "description") > 0 && /banana/i.test(t), `${n(t, j, "description")} results: ${arr(j).slice(0, 3).map((x: any) => x.item?.description).join(" | ")}`]);
  await read(c, g, "myfitnesspal__get_diary", {}, (t, j) => [Array.isArray(j) || /\[truncated/.test(t), Array.isArray(j) ? `${j.length} entries today` : "diary text truncated at 8 KB"]);
  return s.json;
}

async function readsStrong(c: Ctx) {
  const g = "Strong read";
  await read(c, g, "strong__get_recent_workouts", { limit: 2 }, (t, j) => [Array.isArray(j), `${arr(j).length} workouts: ${arr(j).map((l: any) => JSON.stringify(l.name)).join(" | ")}`]);
  const ex = await read(c, g, "strong__search_exercises", { query: "bench" }, (t, j) => [n(t, j, "cellTypeConfigs") > 0 || /"id":"[0-9a-f-]{36}"/.test(t), `${n(t, j, "cellTypeConfigs")} exercises: ${arr(j).slice(0, 3).map((m: any) => JSON.stringify(m.name)).join(" | ")}`]);
  const list = arr(ex.json);
  const exId = list[0]?.id ?? (/"id":"([0-9a-f-]{36})"/.exec(ex.text) ?? [])[1];
  if (exId) await read(c, g, "strong__get_exercise_history", { exerciseId: exId, limit: 2 }, (t, j) => [Array.isArray(j), `${arr(j).length} logs`]);
  else record(g, "get_exercise_history", false, "no exercise id from search_exercises");
  return list;
}

async function readsDuolingo(c: Ctx) {
  const g = "Duolingo read";
  await read(c, g, "duolingo__get_streak", {}, (t, j) => [j && typeof j.streak === "number", `streak ${j?.streak}`]);
  const prof = await read(c, g, "duolingo__get_profile_summary", {}, (t, j) => [!!j && (j.totalXp !== undefined || j.username !== undefined), `totalXp ${j?.totalXp}, course ${j?.currentCourseId}`]);
  await read(c, g, "duolingo__get_xp_history", {}, (t, j) => [Array.isArray(j), `${arr(j).length} day summaries`]);
  const courses = await read(c, g, "duolingo__get_courses", {}, (t, j) => [!!j && Array.isArray(j.courses), `${arr(j?.courses).length} courses, current ${j?.currentCourseId}`]);
  const courseId = courses.json?.currentCourseId ?? prof.json?.currentCourseId;
  if (courseId) await read(c, g, "duolingo__get_weak_words", { course_id: courseId }, (t, j) => [Array.isArray(j) || (!!j && typeof j === "object"), Array.isArray(j) ? `${j.length} weak words` : short(t, 100)]);
  else record(g, "get_weak_words", false, "no course id");
  await read(c, g, "duolingo__get_league", {}, (t, j) => [(!!j && typeof j === "object") || /tier|cohort|ranking/i.test(t), j ? short(Object.keys(j).join(","), 100) : short(t, 100)]);
  const lessons = await read(c, g, "duolingo__get_recent_lessons", {}, (t, j) => [Array.isArray(j), `${arr(j).length} xp gains`]);
  const cur = arr(courses.json?.courses).find((x: any) => x.id === courseId) ?? arr(courses.json?.courses)[0];
  const skillId = arr(lessons.json).map((x: any) => x.skillId).find((x: any) => typeof x === "string" && /^[0-9a-f]{32}$/.test(x)) ?? "4f2884e0b049495c83ea7e7bf323e956";
  await read(c, g, "duolingo__get_skill_words", { skill_id: skillId, learning_language: cur?.learningLanguage ?? "ko", from_language: cur?.fromLanguage ?? "en", limit: 10 }, (t, j) => [!!j, short(t, 120)]);
}

const gwtOk = (t: string) => t.startsWith("//OK");
async function readsCronometer(c: Ctx) {
  const g = "Cronometer read";
  await read(c, g, "cronometer__get_targets", {}, (t, j) => [!!j && typeof j === "object", `${Object.keys(j ?? {}).length} target keys`]);
  const s = await read(c, g, "cronometer__search_food", { query: "banana", limit: 5 }, (t, j) => [/banana/i.test(t), short(t, 140)]);
  const day = { day: TD, month: TM, year: TY };
  await read(c, g, "cronometer__get_diary", day, (t) => [gwtOk(t), `${t.length} chars //OK`]);
  await read(c, g, "cronometer__get_daily_nutrition", day, (t) => [gwtOk(t), `${t.length} chars`]);
  return s;
}

async function readsParkmobile(c: Ctx) {
  const g = "ParkMobile read";
  // Counts only: this output can hold plates and card digits.
  await read(c, g, "parkmobile__get_active_sessions", {}, (t, j) => [j !== undefined, `${arr(j).length} active`]);
  await read(c, g, "parkmobile__get_parking_history", {}, (t, j) => [j !== undefined, `${arr(j).length} past sessions`]);
  await read(c, g, "parkmobile__get_vehicles", {}, (t, j) => [Array.isArray(j), `${arr(j).length} vehicles`]);
  await read(c, g, "parkmobile__get_payment_methods", {}, (t, j) => [j !== undefined, `${arr(j).length} payment methods`]);
  const z = await read(c, g, "parkmobile__find_zone", { zone_number: "51103" }, (t, j) => [arr(j).length > 0, `${arr(j).length} zones: ${arr(j).slice(0, 2).map((x: any) => `${x.internalZoneCode} ${x.locationName}`).join(" | ")}`]);
  const zone = arr(z.json)[0];
  const gp = zone?.gpsPoints?.[0];
  const lat = gp?.latitude ?? 33.781733, lng = gp?.longitude ?? -84.380253;
  await read(c, g, "parkmobile__find_zones_nearby", { north: lat + 0.004, south: lat - 0.004, east: lng + 0.005, west: lng - 0.005 }, (t, j) => [Array.isArray(j) || n(t, j, "internalZoneCode") > 0, `${n(t, j, "internalZoneCode")} zones nearby`]);
  if (zone) {
    const rates = await read(c, g, "parkmobile__get_zone_rates", { internal_zone_code: zone.internalZoneCode }, (t, j) => [!!j, short(t, 100)]);
    const tb = rates.json?.parkInfo?.timeBlocks?.[0];
    if (tb) await read(c, g, "parkmobile__quote_parking", { internal_zone_code: zone.internalZoneCode, time_block_id: tb.timeblockId, minutes: 60 }, (t, j) => [!!j, j?.parkingPrice !== undefined || j?.totalPrice !== undefined ? `quote ok` : short(t, 100)]);
    else record(g, "quote_parking", "skip", "zone has no time blocks right now");
  }
}

// ---------- write suites ----------
function mfpFood(searchJson: any) {
  const items = arr(searchJson);
  const pick = items.find((x: any) => /^banana/i.test(x.item?.description ?? "") && x.item?.serving_sizes?.length) ?? items.find((x: any) => x.item?.serving_sizes?.length);
  if (!pick) return { food_id: "90048150924533", food_version: "233815641308285", serving_value: 1, serving_unit: "banana", serving_multiplier: 1.26 };
  const ss = pick.item.serving_sizes[0];
  return { food_id: String(pick.item.id), food_version: String(pick.item.version), serving_value: ss.value, serving_unit: ss.unit, serving_multiplier: ss.nutrition_multiplier };
}
const count = (hay: string, needle: string) => (needle ? hay.split(needle).length - 1 : 0);

async function writesMfp(c: Ctx, searchJson: any) {
  const g = "MFP write";
  const food = mfpFood(searchJson);
  // Pick a diary date whose text isn't truncated, so presence checks are real.
  let date = today;
  let dTxt = (await c.mcp.call("myfitnesspal__get_diary", { date })).text;
  if (/\[truncated/.test(dTxt)) {
    date = "2024-01-07";
    dTxt = (await c.mcp.call("myfitnesspal__get_diary", { date })).text;
    log(`  (today's diary is over 8 KB, using ${date} for MFP write checks)`);
  }
  const diary = async () => (await c.mcp.call("myfitnesspal__get_diary", { date })).text;
  const base = count(dTxt, `"${food.food_id}"`);
  const args = { ...food, meal: "Snacks", servings: 1, date };
  const created: string[] = [];
  const entryId = (t: string) => (/"id":"([0-9a-f-]{36})"/.exec(t) ?? [])[1];

  // deny: nothing changes
  const den = await write(c.mcp, c.userId, "myfitnesspal__log_food", args, "deny");
  record(g, "deny -> nothing logged", den.isError && /denied/i.test(den.text) && count(await diary(), `"${food.food_id}"`) === base, short(den.text, 100));

  // approve, then approve again: runs once
  const a1 = await write(c.mcp, c.userId, "myfitnesspal__log_food", args, "approve");
  const id1 = entryId(resultBody(a1.text));
  if (id1) created.push(id1);
  record(g, "log banana to Snacks (approve)", !a1.isError && !!id1 && /Approved and done/.test(a1.text), `entry ${id1 ?? "?"}: ${short(a1.text, 120)}`);
  record(g, "approval sheet row has title/summary/args", !!a1.approval?.title && !!a1.approval?.summary && a1.approval?.args?.food_id === food.food_id, `${a1.approval?.title} | ${a1.approval?.summary}`);
  if (a1.approval) {
    const mid = await diary();
    const c1 = count(mid, `"${food.food_id}"`);
    record(g, "get_diary shows the banana", !!id1 && mid.includes(id1), id1 ? `entry ${id1} ${mid.includes(id1) ? "present" : "missing"}` : "no id");
    const again = await decide(a1.approval._id, "approve");
    await convexRun("approvalRunner:run", { approvalId: a1.approval._id }).catch((e) => log("  approvalRunner rerun:", String(e).slice(0, 120)));
    await sleep(2000);
    const c2 = count(await diary(), `"${food.food_id}"`);
    record(g, "approve twice + rerun runner -> runs once", again?.status === "approved" && c1 > base && c2 === c1, `second decide -> ${JSON.stringify(again)}; food refs in diary ${base} -> ${c1} -> ${c2}`);
  }

  // approve_hour: the next log_food runs without a prompt
  const a2 = await write(c.mcp, c.userId, "myfitnesspal__log_food", args, "approve_hour");
  const id2 = entryId(resultBody(a2.text));
  if (id2) created.push(id2);
  record(g, "log #2 (approve_hour)", !a2.isError && !!id2, `entry ${id2 ?? "?"}`);
  const a3 = await write(c.mcp, c.userId, "myfitnesspal__log_food", args, "expect-no-prompt");
  const id3 = entryId(a3.text);
  if (id3) created.push(id3);
  record(g, "log #3 runs with no prompt (grant)", !a3.isError && !a3.approval && !!id3, a3.approval ? "an approval was created" : `entry ${id3 ?? "?"}`);

  // delete each (first approve, delete grant not shared with log_food)
  for (const id of [...created]) {
    const d = await write(c.mcp, c.userId, "myfitnesspal__delete_food_entry", { entry_id: id }, "approve");
    const okDel = !d.isError;
    if (okDel) created.splice(created.indexOf(id), 1);
    record(g, `delete entry ${id.slice(0, 8)} (approve)`, okDel, `${d.approval?.warning ? "warning: " + d.approval.warning + ". " : ""}${short(d.text, 100)}`);
  }
  const fin = await diary();
  const gone = [id1, id2, id3].filter(Boolean).every((id) => !fin.includes(id!));
  record(g, "get_diary: test entries gone", gone && count(fin, `"${food.food_id}"`) === base, `food count back to ${count(fin, `"${food.food_id}"`)} (was ${base})`);
  for (const id of created) leftovers.push(`MyFitnessPal diary entry ${id} (${date}, Snacks, banana)`);
}

async function writesCronometer(c: Ctx, search: { text: string }) {
  const g = "Cronometer write";
  // search_food JSON: first banana hit with id + measureId
  const j = tryJson(search.text);
  const foods: any[] = Array.isArray(j) ? j : arr(j?.foods ?? j?.results ?? j?.items);
  const hit = foods.find((f) => /^banana, fresh$/i.test(f.name ?? "")) ?? foods.find((f) => /banana/i.test(f.name ?? "")) ?? foods[0];
  const food_id = hit?.id ?? 450856;
  const measure_id = hit?.measureId ?? 998940;
  let day = { day: TD, month: TM, year: TY };
  let dTxt = (await c.mcp.call("cronometer__get_diary", day)).text;
  if (/\[truncated/.test(dTxt)) {
    day = { day: 7, month: 1, year: 2024 };
    dTxt = (await c.mcp.call("cronometer__get_diary", day)).text;
    log("  (today's Cronometer diary is over 8 KB, using 2024-01-07)");
  }
  const SID = /\/\/OK\[[^"]*"([^"]+)"/;
  // late approval: let the 20 s MCP wait lapse, approve, then check_approval returns the result
  const lg = await write(c.mcp, c.userId, "cronometer__log_food", { food_id, measure_id, amount: 1, meal: 262145, ...day }, "late");
  const sid = (SID.exec(resultBody(lg.text)) ?? [])[1];
  record(g, "MCP call returns 'waiting' with an id after 20 s", !!lg.late && /check_approval/i.test(lg.late.firstText) && lg.late.firstText.includes(lg.approval?._id ?? "--"), short(lg.late?.firstText ?? lg.text, 140));
  record(g, "late approve -> check_approval returns result (log banana)", !!sid && /Approved and done/.test(lg.text), sid ? `serving ${sid}` : short(lg.text, 160));
  if (!sid) return;
  const cf = (await c.mcp.call("cronometer__get_diary", day)).text;
  record(g, "get_diary shows the banana", cf.includes(`"${sid}"`), `serving ${sid} ${cf.includes(`"${sid}"`) ? "present" : "missing"}`);
  const del = await write(c.mcp, c.userId, "cronometer__delete_diary_entry", { serving_id: sid }, "approve");
  record(g, "delete it (approve)", !del.isError && gwtOk(resultBody(del.text)), `${del.approval?.warning ? "warning: " + del.approval.warning + ". " : ""}${short(del.text, 100)}`);
  const fin = (await c.mcp.call("cronometer__get_diary", day)).text;
  const gone = !fin.includes(`"${sid}"`);
  record(g, "get_diary: banana gone", gone, gone ? "clean" : "still present");
  if (!gone) leftovers.push(`Cronometer serving ${sid} (${day.year}-${day.month}-${day.day}, Snacks, banana)`);
}

async function strongDelete(connectionId: string, logId: string): Promise<{ status: number; detail: string }> {
  const doc = await connectionDoc(connectionId);
  const login = tryJson(doc?.authCacheJson ?? "") ?? {};
  if (!login.accessToken || !login.userId) return { status: 0, detail: "no login on the connection" };
  secret(login.accessToken);
  secret(login.refreshToken);
  const A: Record<string, string> = { "User-Agent": "Strong Android", Accept: "application/json", "Content-Type": "application/json", "x-client-build": "600013", "x-client-platform": "android", Authorization: `Bearer ${login.accessToken}` };
  const r = await fetch(`https://back.strong.app/api/users/${login.userId}/logs/${logId}`, { headers: A });
  if (r.status !== 200) return { status: r.status, detail: "fetch log failed" };
  const lg: any = await r.json();
  const now = new Date().toISOString();
  lg.isHidden = true;
  lg.lastChanged = now;
  for (const grp of lg._embedded?.cellSetGroup ?? []) {
    grp.isHidden = true;
    for (const cs of grp.cellSets ?? []) {
      cs.isHidden = true;
      for (const cell of cs.cells ?? []) cell.isHidden = true;
    }
  }
  const env = { id: login.userId, strongAnalytics: false, _embedded: { template: [], log: [lg], measurement: [], widget: [], tag: [], folder: [], metric: [], measuredValue: [] } };
  const p = await fetch(`https://back.strong.app/api/users/${login.userId}`, { method: "PUT", headers: A, body: JSON.stringify(env) });
  return { status: p.status, detail: "soft delete (isHidden)" };
}

async function writesStrong(c: Ctx, exercises: any[]) {
  const g = "Strong write";
  const bench = exercises.find((m) => /bench press/i.test(JSON.stringify(m.name))) ?? exercises[0];
  const wct = (bench?.cellTypeConfigs ?? []).map((x: any) => x.cellType).find((x: string) => /WEIGHT/.test(x ?? "")) ?? "BARBELL_WEIGHT";
  const exerciseId = bench?.id ?? "6b6456e0-3725-4a0a-8306-1bd555f4e5b5";
  const w = await write(c.mcp, c.userId, "strong__log_workout", { name: "ycyc test", exercises: [{ exerciseId, weightCellType: wct, sets: [{ weightKg: 20, reps: 5 }] }] }, "approve");
  record(g, "log workout 'ycyc test' (approve)", !w.isError && /Approved and done/.test(w.text), short(w.text, 140));
  // The log's id comes right before its name in the compacted HAL, so this also works on a cut reply.
  const findLog = (t: string): string | undefined => {
    const hit = arr(tryJson(t)).find((l) => JSON.stringify(l.name ?? "").includes("ycyc test") && !l.isHidden);
    if (hit) return hit.id;
    const at = t.indexOf("ycyc test");
    if (at < 0) return undefined;
    const ids = [...t.slice(0, at).matchAll(/"id":"([0-9a-f-]{36})"/g)];
    return ids.length ? ids[ids.length - 1][1] : undefined;
  };
  const recent = await c.mcp.call("strong__get_recent_workouts", { limit: 2 });
  const logId = findLog(recent.text);
  record(g, "get_recent_workouts shows it", !!logId, logId ? `log ${logId}` : short(recent.text, 120));
  if (!logId) {
    leftovers.push(`Strong: possibly a "ycyc test" workout (not found in recent workouts to clean up)`);
    return;
  }
  const del = await strongDelete(c.conns.strong, logId);
  const afterTxt = (await c.mcp.call("strong__get_recent_workouts", { limit: 2 })).text;
  const at = afterTxt.indexOf(logId);
  const still = at >= 0;
  const hidden = still && /"isHidden":true/.test(afterTxt.slice(at, at + 400));
  const clean = del.status >= 200 && del.status < 300 && (!still || hidden);
  record(g, "cleanup: workout hidden (same soft delete as scripts/re/strong)", clean, `${del.detail} -> ${del.status}; ${still ? (hidden ? "returned with isHidden" : "still visible") : "no longer listed"}`);
  if (!clean) leftovers.push(`Strong workout log ${logId} ("ycyc test")`);
}

// Strong rotates refresh tokens: write the backend's latest pair back where the RE scripts keep them.
async function strongWriteBack(connectionId: string) {
  try {
    const doc = await connectionDoc(connectionId);
    const login = tryJson(doc?.authCacheJson ?? "") ?? {};
    secret(login.accessToken);
    secret(login.refreshToken);
    const st = JSON.parse(readFileSync(STRONG_STATE, "utf8"));
    if (login.accessToken && login.refreshToken && login.refreshToken !== st.refreshToken) {
      st.accessToken = login.accessToken;
      st.refreshToken = login.refreshToken;
      if (login.userId) st.userId = login.userId;
      try {
        st.expiresAt = JSON.parse(Buffer.from(login.accessToken.split(".")[1], "base64url").toString("utf8")).exp * 1000;
      } catch {}
      writeFileSync(STRONG_STATE, JSON.stringify(st, null, 2), { mode: 0o600 });
      log("  Strong tokens rotated by the backend: wrote the new pair back to ~/.ycyc/re-state/strong.json");
    } else log("  Strong tokens unchanged");
  } catch (e) {
    log("  Strong write-back failed:", String(e).slice(0, 160));
  }
}

// ---------- main ----------
async function main() {
  log(`yuzu e2e  ${new Date().toISOString()}  apps: ${APPS.join(", ")}  writes: ${WRITES}`);
  const ts = Date.now();
  // --device-id <id> seeds an existing yuzu account (e.g. the demo phone) instead of a throwaway user.
  const deviceId = opt("--device-id", "") || `e2e-${ts}`;
  const user = (await convex.mutation(api.users.ensure, { deviceId })) as { userId: string; mcpUrl: string };
  secret(user.mcpUrl.split("/mcp/")[1]);
  record("setup", "users.ensure -> fresh user + MCP URL", !!user.userId && /\/mcp\/.+/.test(user.mcpUrl), `user ${user.userId}`);
  const mcp = new Mcp(user.mcpUrl);

  // ---- protocol ----
  const P = "MCP protocol";
  const init = await mcp.post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "yuzu-e2e", version: "1.0" } } }, { session: false });
  mcp.sessionId = init.headers.get("mcp-session-id") ?? undefined;
  const ir = init.json?.result;
  record(P, "initialize", init.status === 200 && ir?.protocolVersion === "2025-06-18" && !!ir?.serverInfo?.name && !!ir?.capabilities?.tools && !!mcp.sessionId, `${ir?.serverInfo?.name} ${ir?.serverInfo?.version}, proto ${ir?.protocolVersion}, session id ${mcp.sessionId ? "set" : "missing"}`);
  const initOld = await new Mcp(user.mcpUrl).post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01", capabilities: {}, clientInfo: { name: "x" } } });
  record(P, "initialize with unknown version -> server's newest", !!initOld.json?.result?.protocolVersion && initOld.json.result.protocolVersion !== "1999-01-01", initOld.json?.result?.protocolVersion);
  const note = await mcp.post({ jsonrpc: "2.0", method: "notifications/initialized" });
  record(P, "notifications/initialized -> 202, no body", note.status === 202 && note.text === "", `HTTP ${note.status}`);
  const ping = await mcp.post({ jsonrpc: "2.0", id: 2, method: "ping" });
  record(P, "ping", ping.status === 200 && JSON.stringify(ping.json?.result) === "{}", short(ping.text, 80));
  const tl = await mcp.rpc("tools/list");
  const names: string[] = (tl?.tools ?? []).map((t: any) => t.name);
  const need = ["list_apps", "connect_app", "check_approval", "parkmobile__find_zone", "parkmobile__find_zones_nearby", "parkmobile__get_zone_rates", "parkmobile__quote_parking"];
  record(P, "tools/list (core + sessionless ParkMobile zone tools)", need.every((n) => names.includes(n)) && !names.includes("parkmobile__start_parking"), `${names.length} tools: ${names.join(", ")}`);
  record(P, "tools/list schemas are objects", (tl?.tools ?? []).every((t: any) => t.inputSchema?.type === "object"), "");
  const unk = await mcp.post({ jsonrpc: "2.0", id: 3, method: "does/not/exist" });
  record(P, "unknown method -> -32601", unk.json?.error?.code === -32601, short(unk.text, 120));
  const bad = await mcp.post({ jsonrpc: "2.0", id: 4, method: "ping" }, { url: user.mcpUrl.replace(/\/mcp\/.+$/, "/mcp/not-a-real-token") });
  record(P, "bad token -> 404 + -32001", bad.status === 404 && bad.json?.error?.code === -32001, `HTTP ${bad.status} ${short(bad.text, 120)}`);
  const parse = await mcp.post(null, { raw: "{not json" });
  record(P, "malformed JSON -> -32700", parse.json?.error?.code === -32700, `HTTP ${parse.status}`);
  const batch = await mcp.post([{ jsonrpc: "2.0", id: 10, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 11, method: "tools/list" }]);
  record(P, "batch request", Array.isArray(batch.json) && batch.json.length === 2 && batch.json[0].id === 10 && batch.json[1].id === 11, `${Array.isArray(batch.json) ? batch.json.length : "?"} responses`);
  const unkTool = await mcp.post({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope", arguments: {} } });
  record(P, "unknown tool -> -32602", unkTool.json?.error?.code === -32602, short(unkTool.text, 100));
  const la = await mcp.call("list_apps");
  const apps = tryJson(la.text)?.apps ?? [];
  record(P, "tools/call list_apps (nothing connected)", apps.length >= 5 && apps.every((a: any) => a.status === "not connected" && a.connectUrl), `${apps.map((a: any) => `${a.app}:${a.status}`).join(", ")}`);
  const ca = await mcp.call("connect_app", { app: "MyFitnessPal" });
  record(P, "connect_app gives a link without the token", /\/connect\/myfitnesspal/.test(ca.text) && !SECRETS.has(ca.text) && !ca.text.includes(user.mcpUrl.split("/mcp/")[1]), short(ca.text, 120));
  const caBad = await mcp.call("connect_app", { app: "myspace" });
  record(P, "connect_app unknown app -> isError", caBad.isError, short(caBad.text, 100));
  const chk = await mcp.call("check_approval", { id: "bogus" });
  record(P, "check_approval bogus id -> isError", chk.isError && /unknown/i.test(chk.text), short(chk.text, 80));
  const pz = await mcp.call("parkmobile__find_zone", { zone_number: "51103" });
  record(P, "sessionless parkmobile__find_zone before connecting", !pz.isError && arr(tryJson(pz.text)).length > 0, `${arr(tryJson(pz.text)).length} zones (${pz.ms} ms)`);
  const notConn = await mcp.call("myfitnesspal__get_diary", {});
  record(P, "tool for unconnected app -> isError + connect link", notConn.isError && /not connected/i.test(notConn.text), short(notConn.text, 100));

  // ---- sessions + connect ----
  const sessions: Record<string, Session> = {};
  const minters: Record<string, () => Promise<Session> | Session> = { myfitnesspal: mintMfp, duolingo: mintDuolingo, parkmobile: mintParkmobile, cronometer: mintCronometer, strong: mintStrong };
  for (const slug of APPS) {
    const t0 = Date.now();
    try {
      sessions[slug] = await minters[slug]();
      const s = sessions[slug];
      const shape = ["headers", "cookies", "storage"].map((k) => (s[k] ? `${k}[${Object.keys(s[k]).join(",")}]` : "")).filter(Boolean).join(" ");
      record("session", `${slug}: SessionBundle from live session`, true, `${shape} ${s._note ?? ""} (${Date.now() - t0} ms)`);
    } catch (e) {
      record("session", `${slug}: SessionBundle from live session`, false, String(e));
    }
  }

  const relay = new Relay(user.userId);
  relay.start();
  const ctx: Ctx = { mcp, userId: user.userId, conns: {} };
  try {
    await Promise.all(
      Object.entries(sessions).map(async ([slug, sess]) => {
        const t0 = Date.now();
        try {
          const { connectionId, build } = await connect(user.userId, slug, sess);
          ctx.conns[slug] = connectionId;
          const steps = (build?.steps ?? []).map((s: any) => `${s.key}:${s.status}`).join(" ");
          const verify = (build?.steps ?? []).find((s: any) => s.key === "verify");
          record("connect", `${slug}: start + submitLogin -> live`, build?.status === "done", `${build?.status ?? "timeout"} in ${Math.round((Date.now() - t0) / 1000)} s. ${steps}. verify: ${verify?.detail ?? ""}${build?.error ? ". error: " + build.error : ""}`);
        } catch (e) {
          record("connect", `${slug}: start + submitLogin -> live`, false, String(e));
        }
      }),
    );
    const mine = (await convex.query(api.connections.mine, { userId: user.userId })) as any[];
    record("connect", "connections.mine: all live, no session material leaked", mine.every((m) => m.status === "live" && m.sessionJson === undefined && m.authCacheJson === undefined), mine.map((m) => `${m.appSlug}:${m.status}(${m.toolCount} tools)`).join(", "));

    // fresh MCP session now that apps are live
    await mcp.init();
    const tl2 = await mcp.rpc("tools/list");
    const names2: string[] = (tl2?.tools ?? []).map((t: any) => t.name);
    const liveSlugs = mine.filter((m) => m.status === "live").map((m) => m.appSlug);
    record(P, "tools/list after connect has every live app's tools", liveSlugs.every((s) => names2.some((n) => n.startsWith(s + "__"))), `${names2.length} tools`);
    const writesAnnotated = (tl2?.tools ?? []).filter((t: any) => /log_food|delete_|log_workout|start_parking/.test(t.name)).every((t: any) => t.annotations?.readOnlyHint === false && /approve/i.test(t.description));
    record(P, "write tools say they need approval (readOnlyHint false)", writesAnnotated, "");
    const la2 = tryJson((await mcp.call("list_apps")).text)?.apps ?? [];
    record(P, "list_apps shows connected apps", liveSlugs.every((s) => la2.find((a: any) => a.app === s)?.status === "connected"), la2.map((a: any) => `${a.app}:${a.status}`).join(", "));

    // ---- reads ----
    const live = (s: string) => liveSlugs.includes(s);
    const mfpSearch = live("myfitnesspal") ? await readsMfp(ctx) : undefined;
    const strongEx = live("strong") ? await readsStrong(ctx) : [];
    if (live("duolingo")) await readsDuolingo(ctx);
    const cronoSearch = live("cronometer") ? await readsCronometer(ctx) : undefined;
    if (live("parkmobile")) await readsParkmobile(ctx);

    // ---- writes ----
    if (WRITES) {
      if (live("myfitnesspal")) await writesMfp(ctx, mfpSearch).catch((e) => record("MFP write", "suite", false, String(e)));
      if (live("cronometer") && cronoSearch) await writesCronometer(ctx, cronoSearch).catch((e) => record("Cronometer write", "suite", false, String(e)));
      if (live("strong")) await writesStrong(ctx, strongEx).catch((e) => record("Strong write", "suite", false, String(e)));
    }

    // activity log reflects what happened
    const feed = (await convex.query(api.activity.feed, { userId: user.userId, limit: 100 })) as any[];
    record("activity", "activity.feed logged MCP calls", feed.length > 10, `${feed.length} rows; writes: ${feed.filter((f) => f.kind === "write").length}`);
  } finally {
    await relay.stop();
    record("relay", "device relay emulation", relay.errors.length === 0, `${relay.handled.length} calls relayed (${[...new Set(relay.handled.map((h) => h.app))].join(", ")}); statuses ${[...new Set(relay.handled.map((h) => h.status))].join(",")}${relay.errors.length ? "; errors: " + relay.errors.slice(0, 3).join(" | ") : ""}`);
    if (ctx.conns.strong) await strongWriteBack(ctx.conns.strong);
    if (!KEEP) {
      for (const [slug, id] of Object.entries(ctx.conns)) {
        try {
          await convex.mutation(api.connections.disconnect, { connectionId: id });
        } catch (e) {
          leftovers.push(`connection ${slug} ${id} (disconnect failed: ${String(e).slice(0, 80)})`);
        }
      }
      const rest = (await convex.query(api.connections.mine, { userId: user.userId })) as any[];
      record("cleanup", "disconnected all test connections", rest.length === 0, `${rest.length} left`);
      const after = await mcp.call("list_apps");
      record("cleanup", "list_apps after disconnect: nothing connected", (tryJson(after.text)?.apps ?? []).every((a: any) => a.status === "not connected"), "");
    }
  }

  // ---- report ----
  const pass = results.filter((r) => r.verdict === "PASS").length;
  const fail = results.filter((r) => r.verdict === "FAIL").length;
  console.log("\n| group | check | result | detail |\n|---|---|---|---|");
  for (const r of results) console.log(scrub(`| ${r.group} | ${r.check} | ${r.verdict} | ${r.detail.replace(/\|/g, "/")} |`));
  console.log(`\n${pass} passed, ${fail} failed, ${results.length - pass - fail} skipped. test user ${user.userId} (deviceId e2e-${ts})`);
  console.log(leftovers.length ? "LEFTOVERS (clean up by hand):\n  " + leftovers.join("\n  ") : "Cleanup: no test data left in the apps.");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(scrub("FATAL " + (e instanceof Error ? e.stack ?? e.message : String(e))));
  if (leftovers.length) console.error("LEFTOVERS:\n  " + leftovers.join("\n  "));
  process.exit(2);
});
