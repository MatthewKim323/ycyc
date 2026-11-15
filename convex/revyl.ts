// Revyl cloud phone executor + shared recipe runner. Owner: phone RE agent.
// REST mapping and the step loop live in scripts/re/lib/revyl.ts (also used by
// scripts/re/revyl-smoke.ts, so a passing smoke run means these actions work).
// Env: REVYL_API_KEY (Convex dashboard / `npx convex env set`). Optional REVYL_<SLUG>_BUILD_ID.
import { v } from "convex/values";
import type { Recipe, SessionBundle } from "../src/lib/contract";
import { RevylClient, runPhoneTask } from "../scripts/re/lib/revyl";
import { runTool as runRecipeToolImpl, type RunState } from "../scripts/re/lib/template";
import { action, internalAction } from "./_generated/server";

// Revyl build version per phone-only app. Flo has no build until a plain APK is uploaded.
const BUILDS: Record<string, string | undefined> = {
  strong: "7305e6d8-dec7-4875-af81-d2df944f5df1",
  flo: undefined,
};

function buildFor(appSlug: string, override?: string): string {
  const env = typeof process !== "undefined" ? process.env : ({} as Record<string, string | undefined>);
  const id = override ?? env[`REVYL_${appSlug.toUpperCase()}_BUILD_ID`] ?? BUILDS[appSlug];
  if (!id) throw new Error(`No cloud phone build for ${appSlug} yet`);
  return id;
}

function client(): RevylClient {
  return new RevylClient((typeof process !== "undefined" && process.env.REVYL_API_KEY) || "");
}

const session = v.object({ sessionId: v.string(), workflowRunId: v.string() });

export const startSession = internalAction({
  args: { appSlug: v.string(), buildId: v.optional(v.string()) },
  handler: async (_ctx, a) => {
    const c = client();
    const s = await c.start({ buildId: buildFor(a.appSlug, a.buildId) });
    await c.launch(s).catch(() => {});
    return { sessionId: s.sessionId, workflowRunId: s.workflowRunId, viewerUrl: s.viewerUrl };
  },
});

export const runInstruction = internalAction({
  args: { session, instruction: v.string() },
  handler: async (_ctx, a) => {
    const r = await client().step({ ...a.session, viewerUrl: "" }, "instruction", a.instruction);
    return { ok: r.ok, text: r.text };
  },
});

export const runExtract = internalAction({
  args: { session, query: v.string() },
  handler: async (_ctx, a) => {
    const r = await client().step({ ...a.session, viewerUrl: "" }, "extract", a.query);
    return { ok: r.ok, text: r.text };
  },
});

export const viewerUrl = internalAction({
  args: { sessionId: v.string() },
  handler: async (_ctx, a) => `https://app.revyl.ai/sessions/${a.sessionId}`,
});

export const stopSession = internalAction({
  args: { session },
  handler: async (_ctx, a) => {
    await client().stop(a.session);
    return { ok: true };
  },
});

// One-shot phone call: boot the app's build, run the instruction, optionally extract, always stop.
export const runPhoneTool = internalAction({
  args: { appSlug: v.string(), instruction: v.optional(v.string()), extract: v.optional(v.string()), buildId: v.optional(v.string()) },
  handler: async (_ctx, a) => {
    const r = await runPhoneTask(client(), { buildId: buildFor(a.appSlug, a.buildId), instruction: a.instruction, extract: a.extract });
    return { ok: r.ok, text: r.text, viewerUrl: r.viewerUrl };
  },
});

// Signature convex/executor.ts calls by name ("revyl:runTool"). Reads go through extract,
// writes through instruction; a tool may pass "instruction ||| extract" to do both.
export const runTool = action({
  args: {
    appSlug: v.string(),
    tool: v.string(),
    instruction: v.string(),
    args: v.optional(v.any()),
    revylAppId: v.optional(v.string()),
    androidPackage: v.optional(v.string()),
  },
  handler: async (_ctx, a) => {
    const [first, second] = a.instruction.split("|||").map((x) => x.trim());
    const isRead = /^(get|list|search|read|find)_/.test(a.tool);
    const instruction = second !== undefined || !isRead ? first : undefined;
    const extract = second ?? (isRead ? first : undefined);
    try {
      const r = await runPhoneTask(client(), { buildId: buildFor(a.appSlug), instruction, extract });
      return { ok: r.ok, text: r.text || (r.ok ? "Done on the cloud phone." : "The cloud phone could not finish."), data: { viewerUrl: r.viewerUrl } };
    } catch (e) {
      return { ok: false, text: e instanceof Error ? e.message : String(e) };
    }
  },
});

// Runs a cloud recipe tool with the shared renderer (scripts/re/lib/template.ts), which adds
// {{#each}}, {{$uuid}}, fallbacks, pagination/filter/compact and token refresh that Strong needs.
// Pass the stored login (authCache) in `loginJson`; persist the returned `login` (tokens rotate).
export const runRecipeTool = internalAction({
  args: {
    recipeJson: v.string(),
    tool: v.string(),
    args: v.optional(v.any()),
    sessionJson: v.string(),
    loginJson: v.optional(v.string()),
  },
  handler: async (_ctx, a) => {
    const recipe = JSON.parse(a.recipeJson) as Recipe;
    const sess = JSON.parse(a.sessionJson) as SessionBundle;
    const state: RunState = {};
    if (a.loginJson) {
      try {
        state.login = JSON.parse(a.loginJson);
      } catch {
        /* ignore */
      }
    }
    try {
      const r = await runRecipeToolImpl(recipe, a.tool, (a.args ?? {}) as Record<string, unknown>, sess, state);
      return { ok: r.ok, status: r.status, data: r.data ?? null, error: r.error ?? null, login: state.login ? JSON.stringify(state.login) : null };
    } catch (e) {
      return { ok: false, status: 0, data: null, error: e instanceof Error ? e.message : String(e), login: state.login ? JSON.stringify(state.login) : null };
    }
  },
});
