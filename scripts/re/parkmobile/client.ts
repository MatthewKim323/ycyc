/// <reference types="node" />
// Live ParkMobile client driven by the recipe. Renders every request with the same renderRequest the
// backend uses, so a passing run means a passing recipe.
//
//   npx tsx scripts/re/parkmobile/client.ts                 # device path: every read tool inside the signed-in page
//   npx tsx scripts/re/parkmobile/client.ts --cloud         # cloud path: plain Node fetch, no session (public tools pass, account tools 401)
//   npx tsx scripts/re/parkmobile/client.ts --zone 51103    # zone number used for the zone chain (default 51103, Atlanta)
//   npx tsx scripts/re/parkmobile/client.ts --stamp         # on success, write sample {args, ok, at} into the recipe
//
// MONEY RULE: start_parking and extend_parking are rendered (to prove the template) but never sent.
// Session: the signed-in app.parkmobile.io tab in the Aside browser holds the HttpOnly JWT cookie; this
// script never reads, prints or writes it. Output masks plates, card numbers and account details.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Recipe, RecipeTool, SessionBundle } from "../../../src/lib/contract";
import { extractPath, renderRequest, type RenderedRequest } from "../../../src/lib/compiler/render";

const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const opt = (f: string, d: string) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const CLOUD = flag("--cloud");
const STAMP = flag("--stamp");
const ZONE = opt("--zone", "51103");
const RECIPE_PATH = opt("--recipe", join(__dirname, "../../../recipes/parkmobile.json"));
const NEVER_SEND = new Set(["start_parking", "extend_parking"]);
const ACCOUNT_TOOLS = new Set(["get_active_sessions", "get_parking_history", "get_vehicles", "get_payment_methods"]);

const recipe = JSON.parse(readFileSync(RECIPE_PATH, "utf8")) as Recipe;
const tool = (name: string): RecipeTool => {
  const t = recipe.tools.find((x) => x.name === name);
  if (!t || !t.request) throw new Error("recipe has no tool " + name);
  return t;
};

// Reads need no session values. The XSRF placeholder only exists so write templates render.
const session: SessionBundle = { cookies: { "XSRF-TOKEN": "<xsrf>" }, storage: { tz: "America/Los_Angeles" }, capturedAt: Date.now() };

interface Call {
  name: string;
  args: Record<string, unknown>;
  req: RenderedRequest;
}
interface Result {
  name: string;
  status: number;
  ms: number;
  text: string;
  json: unknown;
}

function render(name: string, args: Record<string, unknown>): Call {
  if (NEVER_SEND.has(name)) throw new Error(name + " charges money and is never sent");
  const t = tool(name);
  return { name, args, req: renderRequest(t.request!, args, session, {}, t.inputSchema) };
}

function between(out: string, tag: string): string | null {
  const m = new RegExp(tag + "_BEGIN([\\s\\S]*?)" + tag + "_END").exec(out);
  return m ? m[1] : null;
}

// Device path: the rendered requests run inside the signed-in page the way DeviceRelay runs them on the
// phone (same-origin, cookies included). The page is the recipe's relay path.
function runDevice(calls: Call[]): Result[] {
  for (const c of calls) if (c.req.method !== "GET") throw new Error("device runner only sends GET reads: " + c.name);
  const out = execFileSync(
    "aside",
    [
      "repl",
      `
const dvTab = await openTab("https://app.parkmobile.io/account/zones/active");
const dvRes = await dvTab.evaluate(async (calls) => {
  const out = [];
  for (const c of calls) {
    const t0 = Date.now();
    try {
      const r = await fetch(c.req.url, { method: c.req.method, headers: c.req.headers, credentials: "include" });
      const text = await r.text();
      out.push({ name: c.name, status: r.status, ms: Date.now() - t0, text: text.slice(0, 60000) });
    } catch (e) { out.push({ name: c.name, status: 0, ms: Date.now() - t0, text: String(e) }); }
  }
  return out;
}, ${JSON.stringify(calls)});
console.log("DEVICE_BEGIN" + JSON.stringify(dvRes) + "DEVICE_END");
await closeTab(dvTab);
`,
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 150000 },
  );
  const raw = between(out, "DEVICE");
  if (!raw) throw new Error("device run failed: " + out.slice(0, 300));
  return (JSON.parse(raw) as Omit<Result, "json">[]).map((r) => ({ ...r, json: parse(r.text) }));
}

async function runCloud(calls: Call[]): Promise<Result[]> {
  const out: Result[] = [];
  for (const c of calls) {
    const t0 = Date.now();
    const res = await fetch(c.req.url, { method: c.req.method, headers: c.req.headers });
    const text = await res.text();
    out.push({ name: c.name, status: res.status, ms: Date.now() - t0, text, json: parse(text) });
  }
  return out;
}

const run = (calls: Call[]) => (CLOUD ? runCloud(calls) : Promise.resolve(runDevice(calls)));

function parse(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

// Masking for anything printed: plates and card numbers keep their last 2/4 characters, account details go.
const DROP = /^(email|mobile|phone|phoneNumber|firstName|lastName|userName|userId|ssoId|currentPassword|newPassword|vin|nickname|nickName|zipCode|cardExpDate|expiryMonth|expiryYear)$/i;
function mask(v: unknown, key = ""): unknown {
  if (Array.isArray(v)) return v.map((x) => mask(x));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = mask(x, k);
    return out;
  }
  if (v == null || typeof v === "boolean" || typeof v === "number") return DROP.test(key) && v != null ? "<hidden>" : v;
  const s = String(v);
  if (DROP.test(key)) return "<hidden>";
  if (/lpn|plate/i.test(key)) return s.length > 2 ? "*".repeat(s.length - 2) + s.slice(-2) : "**";
  if (/card(number)?$|maskedCard|lastFour/i.test(key)) return "****" + s.replace(/\D/g, "").slice(-4);
  return s;
}

const trim = (v: unknown, n = 600) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > n ? s.slice(0, n) + "..." : s;
};

let failures = 0;
const passed: { name: string; args: Record<string, unknown> }[] = [];
function report(c: Call, r: Result, summary: string, ok = r.status >= 200 && r.status < 300) {
  if (ok) passed.push({ name: c.name, args: c.args });
  else failures++;
  const u = new URL(c.req.url);
  console.log(`\n${ok ? "PASS" : "FAIL"} ${c.name}  ${c.req.method} ${u.pathname}${u.search}  -> ${r.status} in ${r.ms}ms`);
  console.log("  " + summary);
}

type Zone = { internalZoneCode: string; signageCode: string; locationName: string; type?: string; supplierName?: string; distanceMiles?: number | null; gpsPoints?: { latitude: number; longitude: number }[]; zoneInfo?: { latitude?: number; longitude?: number } };
type TimeBlock = { timeblockId: number; name: string; minimumValue: number; maximumValue: number; incrementValue: number; timeBlockUnit: string };
type ZoneDetail = Zone & { parkInfo?: { isParkingAllowed: boolean; parkingNotAllowedReason: string | null; timeBlocks: TimeBlock[]; maxParkingTime?: { totalMinutes: number }; maxStopTimeLocal?: string; paymentOptions?: Record<string, unknown> } };
type Session = { zone?: { signageCode?: string; locationName?: string }; startLocal?: string; stopLocal?: string; priceDetail?: { parkingPrice?: number; billingType?: string }; timeZoneStandardName?: string };

const sessionLine = (s: Session) =>
  `zone ${s.zone?.signageCode ?? "?"} ${s.zone?.locationName ?? ""}, ${s.startLocal ?? "?"} -> ${s.stopLocal ?? "?"} ${s.timeZoneStandardName ?? ""}, $${s.priceDetail?.parkingPrice ?? "?"} ${s.priceDetail?.billingType ?? ""}`.trim();

async function main() {
  console.log(`${CLOUD ? "cloud (plain Node fetch, no session)" : "device (signed-in Aside page)"} run of recipes/parkmobile.json\n`);

  // 1. Session check + account reads + zone lookup (independent calls, one browser pass).
  const check = { name: "auth.check", args: {}, req: renderRequest(recipe.auth.check!, {}, session) };
  const first = [
    check,
    render("get_active_sessions", {}),
    render("get_parking_history", {}),
    render("get_vehicles", {}),
    render("get_payment_methods", {}),
    render("find_zone", { zone_number: ZONE }),
  ];
  const r1 = await run(first);
  const byName = (rs: Result[], n: string) => rs.find((x) => x.name === n)!;
  const callOf = (cs: Call[], n: string) => cs.find((x) => x.name === n)!;

  const rc = byName(r1, "auth.check");
  if (CLOUD) {
    console.log(`\nINFO auth.check without a session -> ${rc.status} (expected 401)`);
  } else {
    const prof = (rc.json as { userProfile?: { accountType?: string }; hasBillingMethod?: boolean } | null) ?? {};
    report(check, rc, rc.status === 200 ? `signed in, accountType ${prof.userProfile?.accountType ?? "?"}, hasBillingMethod ${prof.hasBillingMethod}` : trim(rc.text, 200));
  }

  for (const name of ["get_active_sessions", "get_parking_history", "get_vehicles", "get_payment_methods"]) {
    const c = callOf(first, name);
    const r = byName(r1, name);
    const t = tool(name);
    if (CLOUD) {
      console.log(`\nINFO ${name} without a session -> ${r.status} (expected 401; account tools need the device session)`);
      continue;
    }
    const data = r.json != null ? extractPath(r.json, t.extract) : undefined;
    if (name === "get_vehicles" && r.status === 404 && /Vehicle not found/i.test(r.text)) {
      report(c, r, "account has no vehicles yet (404 \"Vehicle not found\", the site's own empty answer)", true);
      continue;
    }
    if (name === "get_active_sessions" || name === "get_parking_history") {
      const list = (Array.isArray(data) ? data : []) as Session[];
      const meta = r.json as { count?: number; totalPages?: number } | null;
      report(c, r, `${list.length} sessions (count ${meta?.count ?? "?"}, totalPages ${meta?.totalPages ?? "?"})${list.length ? ": " + list.slice(0, 5).map(sessionLine).join(" | ") : ""}`);
      continue;
    }
    const list = Array.isArray(data) ? data : [];
    report(c, r, `${list.length} ${name === "get_vehicles" ? "vehicles" : "payment methods"}${list.length ? ": " + trim(mask(list), 500) : ""}`);
  }

  const zf = byName(r1, "find_zone");
  const zones = ((zf.json != null ? extractPath(zf.json, tool("find_zone").extract) : []) as Zone[]) ?? [];
  report(callOf(first, "find_zone"), zf, `${zones.length} zones for sign ${ZONE}: ` + zones.map((z) => `${z.internalZoneCode} (${z.locationName}, ${z.type})`).join(" | "));
  const zone = zones[0];
  if (!zone) {
    failures++;
    console.log("FAIL no zone to continue the chain");
    return;
  }

  // 2. Nearby zones around the first match + that zone's rules.
  const gp = zone.gpsPoints?.[0];
  const lat = gp?.latitude ?? 33.7817;
  const lng = gp?.longitude ?? -84.3803;
  const box = { north: +(lat + 0.004).toFixed(6), south: +(lat - 0.004).toFixed(6), east: +(lng + 0.005).toFixed(6), west: +(lng - 0.005).toFixed(6) };
  const second = [render("find_zones_nearby", box), render("get_zone_rates", { internal_zone_code: zone.internalZoneCode })];
  const r2 = await run(second);
  const near = byName(r2, "find_zones_nearby");
  const nearList = ((near.json != null ? extractPath(near.json, tool("find_zones_nearby").extract) : []) as Zone[]) ?? [];
  report(callOf(second, "find_zones_nearby"), near, `${nearList.length} zones in box around ${lat.toFixed(4)},${lng.toFixed(4)}: ` + nearList.slice(0, 6).map((z) => `${z.signageCode} ${z.type} ${z.distanceMiles != null ? z.distanceMiles.toFixed(2) + "mi" : ""}`).join(" | "));

  const zr = byName(r2, "get_zone_rates");
  const detail = (zr.json != null ? extractPath(zr.json, tool("get_zone_rates").extract) : undefined) as ZoneDetail | undefined;
  const pi = detail?.parkInfo;
  const tb = pi?.timeBlocks?.[0];
  report(
    callOf(second, "get_zone_rates"),
    zr,
    pi
      ? `allowed ${pi.isParkingAllowed}${pi.parkingNotAllowedReason ? " (" + pi.parkingNotAllowedReason + ")" : ""}, max ${pi.maxParkingTime?.totalMinutes ?? "?"} min, latest stop ${pi.maxStopTimeLocal ?? "?"}; time blocks: ` +
          (pi.timeBlocks ?? []).map((b) => `${b.timeblockId} "${b.name}" ${b.minimumValue}-${b.maximumValue} ${b.timeBlockUnit} step ${b.incrementValue}`).join(" | ")
      : trim(zr.text, 300),
  );

  // 3. Price check (no purchase).
  if (!tb) {
    console.log("\nINFO zone has no time blocks right now (parking not sold at this hour?), skipping quote_parking");
  } else {
    const minutes = Math.max(tb.minimumValue, Math.min(60, tb.maximumValue));
    const third = [render("quote_parking", { internal_zone_code: zone.internalZoneCode, time_block_id: tb.timeblockId, minutes })];
    const r3 = await run(third);
    const q = r3[0];
    const qj = q.json as { price?: { parkingPrice: number; serviceFee: number; totalPrice: number }[]; currency?: string; parkingStartTimeLocal?: string; parkingStopTimeLocal?: string; isParkingAllowed?: boolean } | null;
    const p = qj?.price?.[0];
    report(third[0], q, p ? `${minutes} min in ${zone.signageCode} (${zone.locationName}): parking $${p.parkingPrice} + fee $${p.serviceFee} = $${p.totalPrice} ${qj?.currency}, ${qj?.parkingStartTimeLocal} -> ${qj?.parkingStopTimeLocal}, allowed ${qj?.isParkingAllowed}` : trim(q.text, 300));
  }

  // 4. Writes: render only, never send.
  for (const [name, args] of [
    ["start_parking", { internal_zone_code: zone.internalZoneCode, time_block_id: tb?.timeblockId ?? 0, minutes: 60, vehicle_id: 0, payment_method_id: 0 }],
    ["extend_parking", { parking_action_id: "0", time_block_id: tb?.timeblockId ?? 0, minutes: 30, payment_method_id: 0 }],
  ] as const) {
    const t = tool(name);
    const req = renderRequest(t.request!, args, session, {}, t.inputSchema);
    console.log(`\nSKIP ${name}  ${req.method} ${new URL(req.url).pathname}  (write, not executed: charges money)`);
    console.log("  body shape: " + req.body);
  }
}

(async () => {
  try {
    await main();
  } catch (e) {
    failures++;
    console.error("ERROR", e instanceof Error ? e.message : e);
  }
  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILED"}`);
  if (STAMP && failures === 0 && !CLOUD) {
    const at = Date.now();
    for (const p of passed) {
      const t = recipe.tools.find((x) => x.name === p.name);
      if (t && t.kind === "read") t.sample = { args: p.args, ok: true, at };
    }
    recipe.provenance.compiledAt = at;
    writeFileSync(RECIPE_PATH, JSON.stringify(recipe, null, 2) + "\n");
    console.log("stamped samples into", RECIPE_PATH);
  }
  process.exit(failures === 0 ? 0 : 1);
})();
