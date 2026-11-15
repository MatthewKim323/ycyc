// Runs recipes/strong.json tools through scripts/re/lib/template.ts (the same runner the
// Convex executor can import). Tokens come from ~/.ycyc/re-state/strong.json (see login.ts);
// rotated tokens are written back. Never prints credentials or tokens.
//
//   npx tsx scripts/re/strong/run.ts check
//   npx tsx scripts/re/strong/run.ts get_recent_workouts '{"limit":3}'
//   npx tsx scripts/re/strong/run.ts search_exercises '{"query":"bench"}'
//   npx tsx scripts/re/strong/run.ts get_exercise_history '{"exerciseId":"<id>"}'
//   npx tsx scripts/re/strong/run.ts log_workout '{...}'          (write: real account!)
//   npx tsx scripts/re/strong/run.ts delete_log <logId>            (soft delete, script only)
//   npx tsx scripts/re/strong/run.ts verify                         (all reads; write test with --write)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Recipe, SessionBundle } from "../../../src/lib/contract";
import { loadEnv, scrub } from "../lib/env";
import { ensureLogin, renderRequest, runTool, send, type RunState } from "../lib/template";
import { CLIENT_HEADERS, loadState, saveState } from "./auth";

const recipe: Recipe = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "recipes", "strong.json"), "utf8"));

function session(): { session: SessionBundle; secrets: string[] } {
  const env = loadEnv();
  const st = loadState();
  return {
    session: {
      credentials: env.STRONG_EMAIL ? { username: env.STRONG_EMAIL, password: env.STRONG_PASSWORD } : undefined,
      storage: {
        ...(st.accessToken ? { accessToken: st.accessToken } : {}),
        ...(st.refreshToken ? { refreshToken: st.refreshToken } : {}),
        ...(st.userId ? { userId: st.userId } : {}),
        deviceId: st.deviceId,
      },
      capturedAt: Date.now(),
    },
    secrets: [env.STRONG_EMAIL, env.STRONG_PASSWORD, st.refreshToken ?? "", st.accessToken ?? ""],
  };
}

function persist(state: RunState) {
  const st = loadState();
  const l = state.login ?? {};
  if (typeof l.accessToken === "string" && l.accessToken !== st.accessToken) {
    st.accessToken = l.accessToken;
    if (typeof l.refreshToken === "string") st.refreshToken = l.refreshToken;
    if (typeof l.userId === "string") st.userId = l.userId;
    saveState(st);
  }
}

const show = (v: unknown, secrets: string[], max = 2500) => {
  const s = scrub(JSON.stringify(v, null, 1), secrets);
  return s.length > max ? s.slice(0, max) + `\n... (${s.length} chars)` : s;
};

async function deleteLog(logId: string, state: RunState, sess: SessionBundle) {
  await ensureLogin(recipe, sess, state);
  const uid = state.login!.userId as string;
  const A = { ...CLIENT_HEADERS, Authorization: `Bearer ${state.login!.accessToken}` };
  const r = await fetch(`https://back.strong.app/api/users/${uid}/logs/${logId}`, { headers: A });
  if (r.status !== 200) throw new Error(`fetch log ${r.status}`);
  const log: any = await r.json();
  const now = new Date().toISOString();
  log.isHidden = true;
  log.lastChanged = now;
  for (const g of log._embedded?.cellSetGroup ?? []) {
    g.isHidden = true;
    for (const cs of g.cellSets ?? []) {
      cs.isHidden = true;
      for (const c of cs.cells ?? []) c.isHidden = true;
    }
  }
  const env = {
    id: uid,
    strongAnalytics: false,
    _embedded: { template: [], log: [log], measurement: [], widget: [], tag: [], folder: [], metric: [], measuredValue: [] },
  };
  const p = await fetch(`https://back.strong.app/api/users/${uid}`, { method: "PUT", headers: A, body: JSON.stringify(env) });
  return { status: p.status, body: (await p.text()).slice(0, 200) };
}

(async () => {
  const [cmd = "verify", argJson] = process.argv.slice(2);
  const { session: sess, secrets } = session();
  const state: RunState = {};
  try {
    if (cmd === "check") {
      await ensureLogin(recipe, sess, state);
      const res = await send(renderRequest(recipe.auth.check!, { session: sess, login: state.login }, recipe.baseUrl));
      console.log("check", res.status);
    } else if (cmd === "delete_log") {
      console.log("delete", await deleteLog(argJson, state, sess));
    } else if (cmd === "verify") {
      const recent = await runTool(recipe, "get_recent_workouts", { limit: 2 }, sess, state);
      console.log("get_recent_workouts", recent.status, show(recent.data, secrets, 900));
      const ex = await runTool(recipe, "search_exercises", { query: "bench press" }, sess, state);
      const list = (ex.data as any[]) ?? [];
      console.log("search_exercises", ex.status, list.length, list.slice(0, 4).map((m) => [m.id, m.name, (m.cellTypeConfigs ?? []).map((c: any) => c.cellType).join("+")]));
      const firstGroup = ((recent.data as any[])?.[0]?.cellSetGroup ?? [])[0];
      const exId = firstGroup?.measurementId ?? list[0]?.id;
      const hist = await runTool(recipe, "get_exercise_history", { exerciseId: exId, limit: 2 }, sess, state);
      console.log("get_exercise_history", hist.status, (hist.data as any[])?.length, (hist.data as any[])?.map((l) => [l.startDate, l.name]));
      if (process.argv.includes("--write")) {
        const bench = list.find((m) => /bench press/i.test(JSON.stringify(m.name))) ?? list[0];
        const wct = (bench.cellTypeConfigs ?? []).map((c: any) => c.cellType).find((c: string) => /WEIGHT/.test(c)) ?? "OTHER_WEIGHT";
        const w = await runTool(
          recipe,
          "log_workout",
          { name: "ycyc test", exercises: [{ exerciseId: bench.id, weightCellType: wct, sets: [{ weightKg: 20, reps: 5 }, { weightKg: 20, reps: 5 }] }] },
          sess,
          state,
        );
        console.log("log_workout", w.status, show(w.raw, secrets, 400));
        const after = await runTool(recipe, "get_recent_workouts", { limit: 3 }, sess, state);
        const mine = (after.data as any[]).find((l) => JSON.stringify(l.name).includes("ycyc test"));
        console.log("readback", mine ? `found ${mine.id} sets=${mine.cellSetGroup?.[0]?.cellSets?.length}` : "not found");
        if (mine && process.argv.includes("--cleanup")) console.log("cleanup", await deleteLog(mine.id, state, sess));
      }
    } else {
      const res = await runTool(recipe, cmd, argJson ? JSON.parse(argJson) : {}, sess, state);
      console.log(cmd, res.ok ? "ok" : "FAIL", res.status, show(res.data ?? res.raw, secrets));
    }
  } catch (e: any) {
    console.error("error:", scrub(String(e?.message ?? e), secrets));
    process.exitCode = 1;
  } finally {
    persist(state);
  }
})();
