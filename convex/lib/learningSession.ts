import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { epoch } from "./learningPolicy";
import { isApprovedNativeOrigin } from "./nativeOrigins";

type BoundEvidence = Pick<Doc<"appLearningEvidence">, "userId" | "appSlug" | "connectionId" | "nativeJobId" | "sessionEpoch" | "origin">;

/** Resolve the exact session that produced evidence, never another app/user or capture. */
export async function evidenceSession(ctx: Pick<QueryCtx, "db">, e: BoundEvidence) {
  if (!e.connectionId) throw new Error("Captured evidence needs its app connection");
  const conn = await ctx.db.get(e.connectionId);
  if (!conn || conn.userId !== e.userId || conn.appSlug !== e.appSlug) throw new Error("App session changed; connection unavailable");
  let sessionJson: string;
  let captureExpiresAt: number | undefined;
  if (e.nativeJobId) {
    const job = await ctx.db.get(e.nativeJobId);
    if (!job || job.userId !== e.userId || job.connectionId !== conn._id || job.appSlug !== e.appSlug ||
        job.status !== "ready" || (job.captureExpiresAt ?? 0) <= Date.now() || !job.sessionJson) throw new Error("Native app capture expired or was revoked");
    const build = await ctx.db.query("nativeAppBuilds").withIndex("by_app", q => q.eq("appSlug", e.appSlug)).filter(q => q.eq(q.field("buildId"), job.buildId)).first();
    if (!build || !isApprovedNativeOrigin(e.origin, build.approvedOrigins)) throw new Error("Native API origin was not approved for this build");
    sessionJson = job.sessionJson;
    captureExpiresAt = job.captureExpiresAt;
  } else {
    if (!["live", "capturing"].includes(conn.status) || !conn.sessionJson) throw new Error("App session changed");
    sessionJson = conn.sessionJson;
  }
  const sessionEpoch = await epoch(sessionJson);
  if (e.sessionEpoch && e.sessionEpoch !== sessionEpoch) throw new Error("App session changed");
  return { conn, sessionJson, sessionEpoch, captureExpiresAt };
}
