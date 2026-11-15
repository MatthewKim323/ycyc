import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Keep the Today screen's live metrics (MyFitnessPal totals, Strong sets) fresh.
crons.interval("refresh today summaries", { minutes: 5 }, internal.today.refreshAll, {});

// Run every live connection's auth.check; mark signed-out connections and failing recipes.
crons.interval("connection health", { minutes: 10 }, internal.health.checkAll, {});

export default crons;
