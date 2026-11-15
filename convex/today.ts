// Today screen: live fuel/protein/training (from the user's connected apps) plus streak, xp and
// achievements (from activity). The phone subscribes to today.get; today.summary refreshes the
// live part on demand. A cron and every successful write or new connection refresh it too.
import { v } from "convex/values";
import type { Recipe, SessionBundle } from "../src/lib/contract";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import { executeTool } from "./executor";
import { recipeAt, stripSource } from "./lib/recipeStore";

const DEFAULT_TZ = "America/Los_Angeles";
const WEEKLY_SET_TARGET = 60;
const THROTTLE_MS = 20_000;

type Metric = { value: number; goal: number } | null;

export interface TodaySummary {
  date: string;
  fuel: Metric;
  protein: Metric;
  training: Metric;
  streakDays: number;
  xp: number;
  achievements: { key: string; title: string; unlocked: boolean; at?: number }[];
  updatedAt: number | null;
}

// ---- date helpers (all in the user's zone) ----

function dayIn(ts: number, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
  }
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function mondayOf(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

function tzFromSessions(conns: Doc<"connections">[]): string {
  for (const c of conns) {
    if (!c.sessionJson) continue;
    try {
      const s = JSON.parse(c.sessionJson) as SessionBundle;
      const tz = s.storage?.tz ?? s.storage?.timeZone;
      if (tz) return tz;
    } catch {
      // ignore
    }
  }
  return DEFAULT_TZ;
}

// ---- activity-derived stats ----

const ACHIEVEMENTS: { key: string; title: string }[] = [
  { key: "first_log", title: "First log" },
  { key: "first_approval", title: "First approval" },
  { key: "streak_3", title: "3-day streak" },
  { key: "two_apps", title: "Two apps connected" },
  { key: "logged_by_text", title: "Logged by text" },
];

function isConnectRow(r: Doc<"activity">): boolean {
  return r.assistant === "ycyc" && r.tool === "connect";
}

async function computeSummary(ctx: QueryCtx, userId: Id<"users">): Promise<TodaySummary> {
  const now = Date.now();
  const conns = await ctx.db
    .query("connections")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const tz = tzFromSessions(conns);
  const today = dayIn(now, tz);

  const rows = await ctx.db
    .query("activity")
    .withIndex("by_user_at", (q) => q.eq("userId", userId))
    .order("desc")
    .take(2000);
  const ok = rows.filter((r) => r.status === "ok").sort((a, b) => a.at - b.at);

  // xp
  let xp = 0;
  for (const r of ok) xp += isConnectRow(r) ? 50 : r.kind === "write" ? 25 : 10;

  // streak: consecutive days with an ok row, counting back from today (or yesterday if today is empty)
  const firstAtByDay = new Map<string, number>();
  for (const r of ok) {
    const d = dayIn(r.at, tz);
    if (!firstAtByDay.has(d)) firstAtByDay.set(d, r.at);
  }
  let cursor = firstAtByDay.has(today) ? today : addDays(today, -1);
  let streakDays = 0;
  while (firstAtByDay.has(cursor)) {
    streakDays++;
    cursor = addDays(cursor, -1);
  }

  // first time a 3-day run completed
  let streak3At: number | undefined;
  const days = [...firstAtByDay.keys()].sort();
  for (let i = 2; i < days.length; i++) {
    if (addDays(days[i - 2], 1) === days[i - 1] && addDays(days[i - 1], 1) === days[i]) {
      streak3At = firstAtByDay.get(days[i]);
      break;
    }
  }

  const firstLog = ok.find((r) => r.kind === "write" && !isConnectRow(r));
  const byText = ok.find((r) => r.kind === "write" && r.assistant === "keiki");
  const seenApps = new Set<string>();
  let twoAppsAt: number | undefined;
  for (const r of ok) {
    if (!isConnectRow(r)) continue;
    seenApps.add(r.appSlug);
    if (seenApps.size >= 2) {
      twoAppsAt = r.at;
      break;
    }
  }
  const approved = await ctx.db
    .query("approvals")
    .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "approved"))
    .collect();
  const firstApprovalAt = approved.reduce<number | undefined>(
    (min, a) => (min === undefined || (a.decidedAt ?? a.createdAt) < min ? a.decidedAt ?? a.createdAt : min),
    undefined,
  );

  const unlockedAt: Record<string, number | undefined> = {
    first_log: firstLog?.at,
    first_approval: firstApprovalAt,
    streak_3: streak3At ?? (streakDays >= 3 ? now : undefined),
    two_apps: twoAppsAt,
    logged_by_text: byText?.at,
  };
  const achievements = ACHIEVEMENTS.map((a) => ({
    key: a.key,
    title: a.title,
    unlocked: unlockedAt[a.key] !== undefined,
    ...(unlockedAt[a.key] !== undefined ? { at: unlockedAt[a.key] } : {}),
  }));

  // live metrics from the cache: fuel/protein are daily, training is weekly
  const cache = await ctx.db
    .query("todaySummaries")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  const liveSlugs = new Set(conns.filter((c) => c.status === "live").map((c) => c.appSlug));
  const sameDay = cache?.date === today;
  const sameWeek = !!cache && cache.date >= mondayOf(today);
  return {
    date: today,
    fuel: liveSlugs.has("myfitnesspal") && sameDay ? cache?.fuel ?? null : null,
    protein: liveSlugs.has("myfitnesspal") && sameDay ? cache?.protein ?? null : null,
    training: liveSlugs.has("strong") && sameWeek ? cache?.training ?? null : null,
    streakDays,
    xp,
    achievements,
    updatedAt: cache?.updatedAt ?? null,
  };
}

// Reactive: the phone subscribes to this.
export const get = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<TodaySummary> => computeSummary(ctx, userId),
});

// Refresh live metrics now, then return the full summary.
export const summary = action({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<TodaySummary> => {
    await refreshLive(ctx, userId, false);
    return await ctx.runQuery(api.today.get, { userId });
  },
});

export const refresh = internalAction({
  args: { userId: v.id("users"), force: v.optional(v.boolean()) },
  handler: async (ctx, { userId, force }): Promise<void> => {
    await refreshLive(ctx, userId, force ?? true);
  },
});

// Cron: refresh everyone with a live MyFitnessPal or Strong connection.
export const refreshAll = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    const userIds: Id<"users">[] = await ctx.runQuery(internal.today.liveUsers, {});
    for (const userId of userIds) await ctx.scheduler.runAfter(0, internal.today.refresh, { userId, force: false });
    return userIds.length;
  },
});

// ---- internal plumbing ----

export const liveUsers = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"users">[]> => {
    const rows = await ctx.db.query("connections").collect();
    const ids = new Set<Id<"users">>();
    for (const c of rows) if (c.status === "live" && (c.appSlug === "myfitnesspal" || c.appSlug === "strong")) ids.add(c.userId);
    return [...ids];
  },
});

type LiveFor = { live: { conn: Doc<"connections">; recipeJson: string }[]; tz: string; cacheUpdatedAt: number | null };

export const liveFor = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<LiveFor> => {
    const conns = await ctx.db
      .query("connections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const out: { conn: Doc<"connections">; recipeJson: string }[] = [];
    for (const conn of conns) {
      if (conn.status !== "live") continue;
      const r = stripSource(await recipeAt(ctx, conn.appSlug, conn.recipeVersion));
      if (r) out.push({ conn, recipeJson: JSON.stringify(r) });
    }
    const cache = await ctx.db
      .query("todaySummaries")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return { live: out, tz: tzFromSessions(conns), cacheUpdatedAt: cache?.updatedAt ?? null };
  },
});

const metricV = v.optional(v.object({ value: v.number(), goal: v.number() }));

export const store = internalMutation({
  args: {
    userId: v.id("users"),
    date: v.string(),
    fuel: metricV,
    protein: metricV,
    training: metricV,
    errors: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("todaySummaries")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    // A failed refresh keeps today's last good numbers.
    const keep = existing && existing.date === args.date;
    const row = {
      ...args,
      fuel: args.fuel ?? (keep ? existing.fuel : undefined),
      protein: args.protein ?? (keep ? existing.protein : undefined),
      training: args.training ?? (keep ? existing.training : undefined),
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("todaySummaries", row);
  },
});

function num(x: unknown): number {
  if (typeof x === "number" && isFinite(x)) return x;
  if (typeof x === "string" && x.trim() !== "" && isFinite(Number(x))) return Number(x);
  return 0;
}

// MFP energy may be kilojoules.
function kcal(energy: unknown): number {
  if (!energy || typeof energy !== "object") return num(energy);
  const e = energy as { value?: unknown; unit?: string };
  const val = num(e.value);
  return /kilojoule|kj/i.test(e.unit ?? "") ? val / 4.184 : val;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

async function refreshLive(ctx: Parameters<typeof executeTool>[0], userId: Id<"users">, force: boolean) {
  const { live, tz, cacheUpdatedAt }: LiveFor = await ctx.runQuery(internal.today.liveFor, { userId });
  if (!force && cacheUpdatedAt && Date.now() - cacheUpdatedAt < THROTTLE_MS) return;
  const today = dayIn(Date.now(), tz);
  const errors: string[] = [];
  let fuel: { value: number; goal: number } | undefined;
  let protein: { value: number; goal: number } | undefined;
  let training: { value: number; goal: number } | undefined;

  const run = async (entry: { conn: Doc<"connections">; recipeJson: string }, toolName: string, args: Record<string, unknown>) => {
    const recipe = JSON.parse(entry.recipeJson) as Recipe;
    const tool = recipe.tools.find((t) => t.name === toolName);
    if (!tool) throw new Error(`${entry.conn.appSlug} has no ${toolName}`);
    const res = await executeTool(ctx, { conn: entry.conn, recipe, tool, args });
    if (!res.ok) throw new Error(`${entry.conn.appSlug} ${toolName}: ${res.text.slice(0, 120)}`);
    return res.data;
  };

  const mfp = live.find((l) => l.conn.appSlug === "myfitnesspal");
  if (mfp) {
    try {
      const [diary, goals] = await Promise.all([
        run(mfp, "get_diary", { date: today }),
        run(mfp, "get_goals", { date: today }).catch((e: unknown) => {
          errors.push(e instanceof Error ? e.message : String(e));
          return undefined;
        }),
      ]);
      const items = Array.isArray(diary) ? (diary as { nutritional_contents?: Record<string, unknown> }[]) : [];
      const eaten = items.reduce((s, it) => s + kcal(it.nutritional_contents?.energy), 0);
      const prot = items.reduce((s, it) => s + num(it.nutritional_contents?.protein), 0);
      const g = (goals ?? {}) as {
        default_goal?: Record<string, unknown>;
        daily_goals?: (Record<string, unknown> & { day_of_week?: string })[];
      };
      const dow = WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()];
      const goal = g.daily_goals?.find((d) => String(d.day_of_week ?? "").toLowerCase() === dow) ?? g.default_goal ?? {};
      fuel = { value: Math.round(eaten), goal: Math.round(kcal(goal.energy)) };
      protein = { value: Math.round(prot), goal: Math.round(num(goal.protein)) };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  const strong = live.find((l) => l.conn.appSlug === "strong");
  if (strong) {
    try {
      const logs = await run(strong, "get_recent_workouts", { limit: 20, page: 1 });
      const monday = mondayOf(today);
      let sets = 0;
      for (const log of Array.isArray(logs) ? (logs as Record<string, any>[]) : []) {
        if (log.isHidden === true) continue;
        const started = Date.parse(String(log.startDate ?? log.created ?? ""));
        if (!isFinite(started) || dayIn(started, tz) < monday) continue;
        const groups = (log.cellSetGroup ?? log._embedded?.cellSetGroup ?? []) as Record<string, any>[];
        for (const g of groups) {
          if (g.isHidden === true) continue;
          for (const cs of (g.cellSets ?? g._embedded?.cellSets ?? []) as Record<string, any>[]) {
            if (cs.isHidden === true || cs.isCompleted === false) continue;
            sets++;
          }
        }
      }
      training = { value: sets, goal: WEEKLY_SET_TARGET };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  await ctx.runMutation(internal.today.store, { userId, date: today, fuel, protein, training, errors });
}
