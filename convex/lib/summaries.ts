// Plain-language summaries for approvals and activity ("Log Banana (1 serving) to Snacks"), and short
// receipts for writes whose response body is empty. Never shows long numeric ids or uuids.
import type { RecipeTool } from "../../src/lib/contract";
import { catalogApp } from "../catalog";

export type Names = Record<string, string>; // id -> label, learned from recent search results

const CRONOMETER_MEALS: Record<string, string> = {
  "1": "Uncategorized",
  "65537": "Breakfast",
  "131073": "Lunch",
  "196609": "Dinner",
  "262145": "Snacks",
};
const UNITS = /^(g|gram|grams|kg|oz|ounce|ounces|lb|lbs|ml|l|cup|cups|tbsp|tsp|serving|servings|piece|pieces|slice|slices|container|each|unit|portion|scoop|bar|item)$/i;

function appName(slug: string): string {
  return catalogApp(slug)?.name ?? slug;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return isFinite(n) ? n : fallback;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined;
}

// Long numbers, uuids and hex blobs are ids, not words.
export function looksLikeId(v: unknown): boolean {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!s) return false;
  return /^\d{7,}$/.test(s) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s) || /^[0-9a-f]{16,}$/i.test(s) || /^[A-Za-z0-9_-]{20,}$/.test(s);
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function foodLabel(args: Record<string, unknown>, names: Names): string | undefined {
  const id = str(args.food_id);
  if (id && names[id]) return names[id];
  const named = str(args.food_name) ?? str(args.name) ?? str(args.description);
  if (named && !looksLikeId(named)) return named;
  const unit = str(args.serving_unit);
  if (unit && /^[a-z][a-z ]+$/i.test(unit) && !UNITS.test(unit)) return titleCase(unit);
  return undefined;
}

function genericArgs(args: Record<string, unknown>): string {
  const vals = Object.entries(args)
    .filter(([k, v]) => v !== undefined && v !== null && v !== "" && !/(^|_)(id|ids|version|token)$/i.test(k) && !looksLikeId(v))
    .map(([, v]) => (typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : ""))
    .filter((s) => s && s.length <= 40)
    .slice(0, 3);
  return vals.join(", ");
}

export function summarizeCall(appSlug: string, tool: RecipeTool, args: Record<string, unknown> = {}, names: Names = {}): string {
  const app = appName(appSlug);
  const name = tool.name;

  if (name === "log_food" && appSlug === "myfitnesspal") {
    const meal = str(args.meal) ?? "Snacks";
    const servings = num(args.servings, 1);
    const food = foodLabel(args, names);
    return food ? `Log ${food} (${plural(servings, "serving")}) to ${meal}` : `Log a food to ${meal}`;
  }
  if (name === "log_food" && appSlug === "cronometer") {
    const meal = CRONOMETER_MEALS[str(args.meal) ?? "262145"] ?? "Snacks";
    const amount = num(args.amount, 1);
    const food = foodLabel(args, names);
    return food ? `Log ${food} (${plural(amount, "serving")}) to ${meal}` : `Log a food to ${meal}`;
  }
  if (name === "log_workout") {
    const exercises = Array.isArray(args.exercises) ? (args.exercises as { sets?: unknown[] }[]) : [];
    const sets = exercises.reduce((n, e) => n + (Array.isArray(e?.sets) ? e.sets.length : 0), 0);
    const label = str(args.name) ?? "Workout";
    return `Log ${label}: ${plural(exercises.length, "exercise")}, ${plural(sets, "set")}`;
  }
  if (name === "start_parking") {
    const code = str(args.internal_zone_code) ?? str(args.zone_number) ?? str(args.zone);
    const zone = code ? names[code] ?? code : undefined;
    const minutes = num(args.minutes, 0);
    const where = zone ? `zone ${zone}` : "your zone";
    return minutes > 0 ? `Park in ${where} for ${minutes} min` : `Park in ${where}`;
  }
  if (name === "extend_parking") {
    const minutes = num(args.minutes, 0);
    return minutes > 0 ? `Add ${minutes} min to your parking` : "Extend your parking";
  }
  const del = /^(delete|remove)_(.+)$/.exec(name);
  if (del) {
    const thing = del[2].replace(/_/g, " ");
    return `Remove ${/^[aeiou]/i.test(thing) ? "an" : "a"} ${thing} from ${app}`;
  }
  const extra = genericArgs(args);
  return extra ? `${tool.title}: ${extra}` : tool.title;
}

export function isEmptyResult(text: string | undefined): boolean {
  const t = (text ?? "").trim();
  return t === "" || t === "null" || t === "{}" || t === "[]" || t === "\"\"" || t === "Done." || t === "true";
}

// "Log ycyc test: 1 exercise, 2 sets" -> "Logged ycyc test: 1 exercise, 2 sets in Strong"
export function receiptFrom(summary: string, appSlug: string): string {
  const app = appName(appSlug);
  const past: [RegExp, string][] = [
    [/^Log /, "Logged "],
    [/^Park /, "Parked "],
    [/^Remove /, "Removed "],
    [/^Add /, "Added "],
    [/^Extend /, "Extended "],
  ];
  for (const [re, word] of past) {
    if (re.test(summary)) {
      const s = summary.replace(re, word);
      return s.includes(` ${app}`) ? s : `${s} in ${app}`;
    }
  }
  return `Done in ${app}: ${summary}`;
}

// Learn id -> label pairs from a search result (MFP items[].item, Cronometer foods, ParkMobile zones).
export function extractNames(data: unknown, limit = 60): Names {
  const out: Names = {};
  let count = 0;
  const visit = (v: unknown, depth: number) => {
    if (count >= limit || depth > 4 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v.slice(0, 50)) visit(x, depth + 1);
      return;
    }
    const o = v as Record<string, unknown>;
    const zone = str(o.internalZoneCode);
    if (zone) {
      const sign = str(o.signageCode) ?? zone;
      const where = str(o.locationName);
      out[zone] = where ? `${sign} (${where})` : sign;
      count++;
    }
    const id = str(o.id) ?? str(o.foodId) ?? str(o.food_id);
    const label = str(o.description) ?? str(o.name) ?? str(o.displayName) ?? str(o.foodName);
    if (id && label && !zone && label.length <= 80) {
      const brand = str(o.brand_name) ?? str(o.brandName);
      const useBrand = brand && !/^generic$/i.test(brand) && !label.toLowerCase().includes(brand.toLowerCase());
      out[id] = useBrand ? `${brand} ${label}` : label;
      count++;
    }
    for (const x of Object.values(o)) if (x && typeof x === "object") visit(x, depth + 1);
  };
  visit(data, 0);
  return out;
}
