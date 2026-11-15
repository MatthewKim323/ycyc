/// <reference types="node" />
// Compiles a real capture with compileCapture and compares it to the hand recipe.
// Run: npx tsx scripts/re/mfp/compare.ts [capture.json]
// Writes the compiled recipe next to the capture (compiled-<name>.json) so client.ts can run it live:
//   npx tsx scripts/re/mfp/client.ts --recipe scripts/re/mfp/captures/compiled-<name>.json

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import type { CaptureEntry, CatalogApp, Recipe, SessionBundle } from "../../../src/lib/contract";
import { compileCapture } from "../../../src/lib/compiler/compile";

const dir = join(__dirname, "captures");
const file = process.argv[2] || join(dir, readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().pop()!);
const cap = JSON.parse(readFileSync(file, "utf8")) as { entries: CaptureEntry[]; sessionShape: Record<string, string> };

// The capture only stores session key names; stand-in values let the compiler see which keys exist.
const session: SessionBundle = { headers: {}, cookies: {}, storage: {}, capturedAt: Date.now() };
for (const key of Object.keys(cap.sessionShape || {})) {
  const [kind, ...rest] = key.split(".");
  const name = rest.join(".");
  const bag = (session as unknown as Record<string, Record<string, string>>)[kind];
  if (!bag) continue;
  bag[name] = name === "authorization" ? "Bearer stand-in" : name === "mfp-client-id" ? "mfp-main-js" : "stand-in";
}

const app: CatalogApp = {
  slug: "myfitnesspal",
  name: "MyFitnessPal",
  category: "nutrition",
  route: "web",
  loginUrl: "https://www.myfitnesspal.com/account/login",
  webOrigin: "https://www.myfitnesspal.com",
  blurb: "",
};

const compiled = compileCapture(app, cap.entries, session);
const out = join(dirname(file), "compiled-" + basename(file));
writeFileSync(out, JSON.stringify(compiled, null, 2));

const hand = JSON.parse(readFileSync(join(__dirname, "../../../recipes/myfitnesspal.json"), "utf8")) as Recipe;
const strip = (u?: string) => (u || "").split("?")[0];
console.log(`compiled: executor ${compiled.executor}, auth ${compiled.auth.type}, ${compiled.tools.length} tools  (${compiled.provenance.notes})`);
console.log(`hand:     executor ${hand.executor}, auth ${hand.auth.type}, ${hand.tools.length} tools`);
console.log(`refresh:  compiled ${compiled.auth.refresh?.urlTemplate ?? "-"} | hand ${hand.auth.refresh?.urlTemplate}`);
console.log(`check:    compiled ${compiled.auth.check?.urlTemplate ?? "-"}`);
console.log("\ntool                 compiled endpoint                                   hand endpoint");
const names = [...new Set([...compiled.tools.map((t) => t.name), ...hand.tools.map((t) => t.name)])];
for (const n of names) {
  const c = compiled.tools.find((t) => t.name === n);
  const h = hand.tools.find((t) => t.name === n);
  const ce = c ? `${c.request?.method} ${strip(c.request?.urlTemplate)}` : "(not in capture)";
  const he = h ? `${h.request?.method} ${strip(h.request?.urlTemplate)}` : "(not in hand recipe)";
  const same = c && h && ce === he ? "  same" : "";
  console.log(`${n.padEnd(20)} ${ce.padEnd(52)} ${he}${same}`);
}
console.log("\nplaybook:", compiled.playbook.join(" -> "));
console.log("wrote", out);
