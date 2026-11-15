// Everything a person reads about an app, in one place: plain verbs, example prompts, the logo.
// Never put tool names, endpoints or protocol words in here.

export type Capability = {
  verb: string;
  /** Writes wait for an OK on the phone. */
  asks?: boolean;
  /** Backend tool names this verb covers (used to phrase approvals; never shown). */
  tools: string[];
};

export type AppCopy = {
  tagline: string;
  can: Capability[];
  prompts: [string, string];
  logo?: number;
};

export const APP_COPY: Record<string, AppCopy> = {
  myfitnesspal: {
    tagline: "Food diary, macros",
    logo: require("@/assets/apps/myfitnesspal.png"),
    can: [
      { verb: "Find foods", tools: ["search_food"] },
      { verb: "Read your diary", tools: ["get_diary"] },
      { verb: "Check your goals", tools: ["get_goals"] },
      { verb: "Log a meal", asks: true, tools: ["log_food"] },
      { verb: "Remove an entry", asks: true, tools: ["delete_food_entry"] },
    ],
    prompts: ["how much protein do I have left today?", "log my usual chipotle bowl for lunch"],
  },
  strong: {
    tagline: "Workouts, sets, PRs",
    logo: require("@/assets/apps/strong.png"),
    can: [
      { verb: "Read your workouts", tools: ["get_recent_workouts"] },
      { verb: "Find exercises", tools: ["search_exercises"] },
      { verb: "See your lift history", tools: ["get_exercise_history"] },
      { verb: "Log a workout", asks: true, tools: ["log_workout"] },
    ],
    prompts: ["what did I bench last week?", "how many sets did I do this week?"],
  },
  duolingo: {
    tagline: "Streak, XP, words",
    logo: require("@/assets/apps/duolingo.png"),
    can: [
      { verb: "Check your streak", tools: ["get_streak", "get_profile_summary"] },
      { verb: "See your XP", tools: ["get_xp_history", "get_league"] },
      { verb: "Words you keep missing", tools: ["get_weak_words", "get_skill_words"] },
      { verb: "See your courses and lessons", tools: ["get_courses", "get_recent_lessons"] },
    ],
    prompts: ["am I about to lose my Duolingo streak?", "quiz me on the words I keep missing"],
  },
  cronometer: {
    tagline: "Nutrients, food log",
    logo: require("@/assets/apps/cronometer.png"),
    can: [
      { verb: "Check your nutrients", tools: ["get_daily_nutrition", "get_targets"] },
      { verb: "Read your diary", tools: ["get_diary", "search_food"] },
      { verb: "Log a meal", asks: true, tools: ["log_food"] },
      { verb: "Remove an entry", asks: true, tools: ["delete_diary_entry"] },
    ],
    prompts: ["am I low on any vitamins today?", "log a cup of greek yogurt for breakfast"],
  },
  parkmobile: {
    tagline: "Zones, prices, parking",
    logo: require("@/assets/apps/parkmobile.png"),
    can: [
      { verb: "Find parking zones", tools: ["find_zone", "find_zones_nearby"] },
      { verb: "Get a price", tools: ["get_zone_rates", "quote_parking"] },
      { verb: "See active parking", tools: ["get_active_sessions", "get_parking_history"] },
      { verb: "Start parking", asks: true, tools: ["start_parking"] },
      { verb: "Extend parking", asks: true, tools: ["extend_parking"] },
    ],
    prompts: ["how much is parking in zone 4021 for two hours?", "extend my parking by 30 minutes"],
  },
  flo: {
    tagline: "Cycle, symptoms",
    can: [
      { verb: "Read your cycle", tools: [] },
      { verb: "Log symptoms", asks: true, tools: [] },
    ],
    prompts: ["when does my next period start?", "log a headache for today"],
  },
};

export function copyFor(slug: string): AppCopy | undefined {
  return APP_COPY[slug];
}

export function taglineFor(app: { slug: string; blurb?: string }): string {
  return APP_COPY[app.slug]?.tagline ?? app.blurb ?? "";
}

/** Plain verb for a backend tool, e.g. log_food -> "Log a meal". */
export function verbForTool(slug: string, tool: string): string | undefined {
  return APP_COPY[slug]?.can.find((c) => c.tools.includes(tool))?.verb;
}

/** True when a string looks like an internal name (snake_case, paths, hosts, methods). */
export function looksInternal(text: string | undefined | null): boolean {
  if (!text) return true;
  return (
    /\b[a-z]+_[a-z_]+\b/.test(text) ||
    /https?:\/\//i.test(text) ||
    /\/[a-z0-9_-]+\//i.test(text) ||
    /\b(GET|POST|PUT|PATCH|DELETE)\b/.test(text) ||
    /\b(endpoint|recipe|executor|mcp|api)\b/i.test(text)
  );
}

/** Backend error text if it's safe to show, otherwise a plain fallback. */
export function plainError(text: string | undefined | null, fallback = "Something went wrong. Try again."): string {
  return text && !looksInternal(text) ? text : fallback;
}
