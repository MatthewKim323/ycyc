import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Keep the Today screen's live metrics (MyFitnessPal totals, Strong sets) fresh.
crons.interval("refresh today summaries", { minutes: 5 }, internal.today.refreshAll, {});

export default crons;
