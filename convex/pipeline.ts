import { v } from "convex/values";
import type { CaptureEntry, CatalogApp, Recipe, SessionBundle } from "../src/lib/contract";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import { catalogApp } from "./catalog";
import { executeRequest, executeTool, isAuthFailure, recordHealth } from "./executor";
import { compileCapture, HAS_COMPILER } from "./lib/compilerShim";
import { fallbackCompile } from "./lib/fallbackCompiler";
import { handRecipeFor, normalizeRecipe } from "./lib/recipeStore";
import { deriveSession } from "./lib/sessionDerive";

// Short pauses so each step is visible on the phone. Real work happens between them.
const BEAT_MS = 700;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type StepKey = "signin" | "capture" | "map" | "generate" | "verify" | "publish";
type StepStatus = "running" | "done" | "error" | "skipped";

class BuildError extends Error {}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

async function compile(app: CatalogApp, entries: CaptureEntry[], session: SessionBundle): Promise<Recipe> {
  if (HAS_COMPILER && compileCapture) {
    const out = (await compileCapture(app, entries, session)) as Recipe | { recipe: Recipe };
    const recipe = "tools" in out ? out : out.recipe;
    return recipe;
  }
  return fallbackCompile(app, entries, session);
}

type Step = (key: StepKey, status: StepStatus, detail?: string) => Promise<unknown>;

interface BuildCtx {
  ctx: ActionCtx;
  buildId: Id<"builds">;
  step: Step;
  begin: (key: StepKey, detail?: string) => Promise<void>;
}

// The recipe whose auth block drives sign-in (before map picks the tools recipe).
async function authRecipeFor(ctx: ActionCtx, slug: string): Promise<Recipe | null> {
  const bestJson = await ctx.runQuery(internal.recipes.best, { slug });
  return bestJson ? (JSON.parse(bestJson) as Recipe) : handRecipeFor(slug) ?? null;
}

function stripCredentials(session: SessionBundle): SessionBundle {
  const { credentials, ...rest } = session;
  return rest as SessionBundle;
}

function mfaPrompt(recipe: Recipe, app: CatalogApp, fromLogin?: string): string {
  const mfa = (recipe.auth as Recipe["auth"] & { mfa?: { prompt?: string } }).mfa;
  return fromLogin || mfa?.prompt || `Enter the code ${app.name} sent you`;
}

// login_api sign-in. Returns "paused" when the app wants a code (status needs_code).
async function loginApiSignin(
  b: BuildCtx,
  conn: Doc<"connections">,
  app: CatalogApp,
  recipe: Recipe,
  session: SessionBundle,
): Promise<"continue" | "paused"> {
  const { ctx, step } = b;
  const st = session.storage ?? {};
  // Pre-seeded tokens: skip the password login entirely.
  if (st.accessToken) {
    const login = { accessToken: st.accessToken, refreshToken: st.refreshToken, userId: st.userId };
    await ctx.runMutation(internal.connections.saveAuthCache, { connectionId: conn._id, json: JSON.stringify(login) });
    await ctx.runMutation(internal.connections.updateSession, {
      connectionId: conn._id,
      json: JSON.stringify(stripCredentials(session)),
    });
    await step("signin", "done", "Signed in with your existing session");
    return "continue";
  }
  if (!recipe.auth.loginRequest) {
    await ctx.runMutation(internal.connections.scrubCredentials, { connectionId: conn._id });
    await step("signin", "skipped", "Signs in on the cloud phone");
    return "continue";
  }
  if (!session.credentials?.username || !session.credentials?.password) {
    throw new BuildError(`Enter your ${app.name} email and password to connect.`);
  }
  // A stable device id: the code exchange and token refresh must reuse the login's.
  const working: SessionBundle = { ...session, storage: { ...st, deviceId: st.deviceId || crypto.randomUUID() } };
  const r = await ctx.runAction(internal.authNode.loginStart, {
    recipeJson: JSON.stringify(recipe),
    sessionJson: JSON.stringify(working),
  });
  // The password is used once, here. Never stored past this point.
  await ctx.runMutation(internal.connections.updateSession, {
    connectionId: conn._id,
    json: JSON.stringify(stripCredentials(working)),
  });
  if (r.kind === "ok") {
    await ctx.runMutation(internal.connections.saveAuthCache, { connectionId: conn._id, json: r.loginJson });
    await step("signin", "done", `Signed in to ${app.name}`);
    return "continue";
  }
  if (r.kind === "mfa") {
    const prompt = mfaPrompt(recipe, app, r.prompt);
    await ctx.runMutation(internal.connections.setNeedsCode, { connectionId: conn._id, pendingJson: r.pendingJson, prompt });
    await step("signin", "running", prompt);
    return "paused";
  }
  throw new BuildError(r.error);
}

// Web/session sign-in: count what the phone captured.
async function sessionSignin(b: BuildCtx, session: SessionBundle): Promise<void> {
  const nCookies = Object.keys(session.cookies ?? {}).length;
  const nHeaders = Object.keys(session.headers ?? {}).length;
  const nStorage = Object.keys(session.storage ?? {}).length;
  if (!nCookies && !nHeaders && !nStorage) {
    throw new BuildError("No session received. Sign in again.");
  }
  const parts = [
    nCookies ? plural(nCookies, "cookie") : "",
    nHeaders ? plural(nHeaders, "auth header") : "",
    nStorage ? plural(nStorage, "storage key") : "",
  ].filter(Boolean);
  await b.step("signin", "done", `Session saved: ${parts.join(", ")}`);
}

async function failBuild(ctx: ActionCtx, buildId: Id<"builds">, connectionId: Id<"connections">, step: Step, current: StepKey, e: unknown) {
  const message = e instanceof BuildError ? e.message : `Build failed: ${e instanceof Error ? e.message : String(e)}`;
  console.error("build", buildId, message);
  await step(current, "error", message.slice(0, 200));
  await ctx.runMutation(internal.builds.finish, { buildId, status: "error", error: message.slice(0, 500) });
  await ctx.runMutation(internal.connections.clearPending, { connectionId });
  await ctx.runMutation(internal.connections.scrubCredentials, { connectionId });
  await ctx.runMutation(internal.connections.setStatus, { connectionId, status: "error", error: message.slice(0, 500) });
}

function makeBuildCtx(ctx: ActionCtx, buildId: Id<"builds">) {
  const state = { current: "signin" as StepKey };
  const step: Step = (key, status, detail) => ctx.runMutation(internal.builds.step, { buildId, key, status, detail });
  const b: BuildCtx = {
    ctx,
    buildId,
    step,
    begin: async (key, detail) => {
      state.current = key;
      await step(key, "running", detail);
    },
  };
  return { b, state };
}

export const run = internalAction({
  args: { buildId: v.id("builds") },
  handler: async (ctx, { buildId }) => {
    const build = await ctx.runQuery(internal.builds.get, { buildId });
    if (!build) return;
    const { b, state } = makeBuildCtx(ctx, buildId);
    try {
      const conn = await ctx.runQuery(internal.connections.get, { connectionId: build.connectionId });
      if (!conn) throw new BuildError("Connection was removed");
      const app = catalogApp(conn.appSlug);
      if (!app) throw new BuildError(`Unknown app ${conn.appSlug}`);
      const session: SessionBundle = conn.sessionJson ? JSON.parse(conn.sessionJson) : { capturedAt: 0 };

      // 1. signin
      await b.begin("signin");
      await sleep(BEAT_MS);
      const authRecipe = await authRecipeFor(ctx, app.slug);
      if (authRecipe?.auth?.type === "login_api") {
        const outcome = await loginApiSignin(b, conn, app, authRecipe, session);
        if (outcome === "paused") return; // connections.submitCode resumes via pipeline.resume
      } else {
        if (app.route === "cloudPhone" && !authRecipe) {
          throw new BuildError(`${app.name} isn't mapped yet. Its recipe is still being built.`);
        }
        const derived = deriveSession(app.slug, session);
        if (derived) {
          await ctx.runMutation(internal.connections.updateSession, { connectionId: conn._id, json: JSON.stringify(derived) });
        }
        await sessionSignin(b, derived ?? session);
      }
      await afterSignin(b, build.connectionId, app);
    } catch (e) {
      await failBuild(ctx, buildId, build.connectionId, b.step, state.current, e);
    }
  },
});

// Second half of an MFA sign-in: exchange the code, then carry on with the build.
export const resume = internalAction({
  args: { buildId: v.id("builds"), code: v.string() },
  handler: async (ctx, { buildId, code }) => {
    const build = await ctx.runQuery(internal.builds.get, { buildId });
    if (!build) return;
    const { b, state } = makeBuildCtx(ctx, buildId);
    try {
      const conn = await ctx.runQuery(internal.connections.get, { connectionId: build.connectionId });
      if (!conn) throw new BuildError("Connection was removed");
      const app = catalogApp(conn.appSlug);
      if (!app) throw new BuildError(`Unknown app ${conn.appSlug}`);
      if (!conn.pendingJson) throw new BuildError("Code expired. Sign in again.");
      const recipe = await authRecipeFor(ctx, app.slug);
      if (!recipe) throw new BuildError(`${app.name} isn't mapped yet.`);
      await b.begin("signin", "Checking code");
      const r = await ctx.runAction(internal.authNode.loginVerify, {
        recipeJson: JSON.stringify(recipe),
        sessionJson: conn.sessionJson ?? JSON.stringify({ capturedAt: Date.now() }),
        pendingJson: conn.pendingJson,
        code,
      });
      if (r.kind === "error") {
        if (r.retry) {
          await ctx.runMutation(internal.connections.setNeedsCode, {
            connectionId: conn._id,
            pendingJson: conn.pendingJson,
            prompt: r.error,
          });
          await b.step("signin", "running", r.error);
          return;
        }
        throw new BuildError(r.error);
      }
      await ctx.runMutation(internal.connections.saveAuthCache, { connectionId: conn._id, json: r.loginJson });
      await ctx.runMutation(internal.connections.clearPending, { connectionId: conn._id });
      await ctx.runMutation(internal.connections.setStatus, { connectionId: conn._id, status: "building" });
      await b.step("signin", "done", `Signed in to ${app.name}`);
      await afterSignin(b, build.connectionId, app);
    } catch (e) {
      await failBuild(ctx, buildId, build.connectionId, b.step, state.current, e);
    }
  },
});

// capture -> map -> generate -> verify -> publish
async function afterSignin(b: BuildCtx, connectionId: Id<"connections">, app: CatalogApp) {
  const { ctx, buildId, step, begin } = b;
  // Reload: sign-in may have stored tokens and stripped credentials.
  const conn = await ctx.runQuery(internal.connections.get, { connectionId });
  if (!conn) throw new BuildError("Connection was removed");
  const session: SessionBundle = conn.sessionJson ? JSON.parse(conn.sessionJson) : { capturedAt: 0 };

  // 2. capture: what the recorder saw.
  await begin("capture");
  const entries = await ctx.runQuery(internal.connections.captureEntries, { connectionId: conn._id });
  await sleep(BEAT_MS);
  const apiEntries = entries.filter((e) => e.initiator === "fetch" || e.initiator === "xhr" || e.initiator === "revyl");
  const hosts = new Set<string>();
  for (const e of apiEntries) {
    try {
      hosts.add(new URL(e.url).hostname);
    } catch {
      // ignore malformed
    }
  }
  await step(
    "capture",
    "done",
    entries.length
      ? `${plural(entries.length, "request")} recorded, ${plural(apiEntries.length, "API call")} across ${plural(hosts.size, "host")}`
      : "No new requests needed",
  );

  // 3 + 4. map and generate, unless a verified recipe already exists for this app.
  const bestJson = await ctx.runQuery(internal.recipes.best, { slug: app.slug });
  const best: Recipe | null = bestJson ? JSON.parse(bestJson) : null;
  const hand = handRecipeFor(app.slug);
  let recipe: Recipe;

  if (best && best.status === "verified") {
    recipe = best;
    await step("map", "skipped", `Reusing verified recipe v${recipe.version}`);
    await step("generate", "skipped", `Reusing verified recipe v${recipe.version}`);
  } else if (hand && best?.status !== "broken") {
    await begin("map");
    await sleep(BEAT_MS);
    // Keep the DB copy's status (a hand recipe verified earlier stays verified).
    const version = await ctx.runMutation(internal.recipes.save, { json: JSON.stringify(hand) });
    const savedJson = await ctx.runQuery(internal.recipes.at, { slug: app.slug, version });
    recipe = savedJson ? (JSON.parse(savedJson) as Recipe) : hand;
    const endpoints = new Set(recipe.tools.map((t) => t.request?.urlTemplate.split("?")[0]).filter(Boolean));
    await step("map", "done", `Hand-mapped recipe v${recipe.version}: ${plural(endpoints.size, "endpoint")}`);
    await begin("generate");
    await sleep(BEAT_MS);
    await step("generate", "done", `${plural(recipe.tools.length, "tool")}: ${recipe.tools.map((t) => t.name).join(", ")}`.slice(0, 140));
  } else if (app.route === "web") {
    await begin("map");
    if (apiEntries.length === 0) {
      throw new BuildError(
        best?.status === "broken"
          ? `${app.name} changed and yuzu needs to relearn it. Browse a few pages, then finish again.`
          : "No API calls recorded. Open your diary in the browser, then finish again.",
      );
    }
    const compiled = normalizeRecipe(await compile(app, entries, session));
    const endpoints = new Set(compiled.tools.map((t) => `${t.request?.method} ${t.request?.urlTemplate.split("?")[0]}`));
    await step("map", "done", `${plural(endpoints.size, "endpoint")} found`);
    await begin("generate");
    await sleep(BEAT_MS);
    if (compiled.tools.length === 0) {
      throw new BuildError("No usable endpoints in this capture. Browse a few pages and retry.");
    }
    const latest = await ctx.runQuery(internal.recipes.latestVersion, { slug: app.slug });
    compiled.version = latest + 1;
    compiled.status = "draft";
    compiled.appSlug = app.slug;
    await ctx.runMutation(internal.recipes.save, { json: JSON.stringify(compiled) });
    recipe = compiled;
    await step("generate", "done", `${plural(recipe.tools.length, "tool")} in draft v${recipe.version}`);
  } else if (best) {
    // A broken recipe on an app with no capture to relearn from (cloud phone): try it again;
    // a passing check marks it healthy.
    recipe = best;
    await step("map", "skipped", `Recipe v${recipe.version} has been failing, trying it again`);
    await step("generate", "skipped", `Recipe v${recipe.version}`);
  } else {
    await begin("map");
    await sleep(BEAT_MS);
    throw new BuildError(`${app.name} isn't mapped yet. Its recipe is still being built.`);
  }

  // 5. verify the user's own session against the recipe.
  await begin("verify");
  const fresh = (await ctx.runQuery(internal.connections.get, { connectionId })) ?? conn;
  const verdict = await verify(ctx, fresh, recipe);
  if (verdict.status === "error") throw new BuildError(verdict.detail);
  await step("verify", verdict.status, verdict.detail);
  if (verdict.status === "done" && recipe.status !== "verified") {
    await ctx.runMutation(internal.recipes.setStatus, { slug: app.slug, version: recipe.version, status: "verified" });
  }

  // 6. publish: tools go live on this user's MCP link.
  await begin("publish");
  await sleep(BEAT_MS);
  await ctx.runMutation(internal.connections.setStatus, {
    connectionId: conn._id,
    status: "live",
    recipeVersion: recipe.version,
  });
  await ctx.runMutation(internal.activity.log, {
    userId: conn.userId,
    appSlug: app.slug,
    assistant: "ycyc",
    tool: "connect",
    kind: "write",
    summary: `Connected ${app.name}: ${plural(recipe.tools.length, "tool")} live`,
    status: "ok",
  });
  await step("publish", "done", `${plural(recipe.tools.length, "tool")} live on your MCP link`);
  await ctx.scheduler.runAfter(0, internal.today.refresh, { userId: conn.userId });
  await ctx.runMutation(internal.builds.finish, { buildId, status: "done", recipeVersion: recipe.version });
}

// Prove the session works: the recipe's auth.check, or else a read tool that needs no arguments.
async function verify(
  ctx: ActionCtx,
  conn: Doc<"connections">,
  recipe: Recipe,
): Promise<{ status: "done" | "skipped" | "error"; detail: string }> {
  const check = recipe.auth?.check;
  const readTool = recipe.tools.find((t) => {
    if (t.kind !== "read") return false;
    const req = (t.inputSchema as { required?: string[] })?.required ?? [];
    return req.length === 0;
  });
  if (!check && !readTool) {
    return { status: "skipped", detail: "No read check defined, verify on first call" };
  }
  const executor = recipe.executor ?? "cloud";
  if (!check && readTool && (!readTool.request || executor === "phone")) {
    // Cloud phone runs take minutes; don't hold the build screen on one.
    return { status: "skipped", detail: "Runs on a cloud phone, verified on first call" };
  }

  const started = Date.now();
  const res = check
    ? await executeRequest(ctx, {
        conn,
        recipe,
        template: check,
        args: {},
        toolName: "auth_check",
        executor: executor === "phone" ? "cloud" : executor,
      })
    : await executeTool(ctx, { conn, recipe, tool: readTool!, args: {} });
  if (check) await recordHealth(ctx, recipe, res);
  const ms = Date.now() - started;

  if (res.ok) {
    return { status: "done", detail: `Session works (${check ? "auth check" : readTool!.name}, ${ms} ms)` };
  }
  if (res.status === undefined && /Phone did not answer/.test(res.text)) {
    return { status: "skipped", detail: "Phone relay did not answer, verify on first call" };
  }
  if (isAuthFailure(res) || /signed you out/i.test(res.text)) {
    return { status: "error", detail: `Session rejected (${res.status}). Sign in again.` };
  }
  if (/MFA_REQUIRED/.test(res.text)) {
    return { status: "error", detail: "Account needs an emailed code. Sign in again on the phone." };
  }
  if (/session expired/i.test(res.text)) return { status: "error", detail: res.text.slice(0, 140) };
  return { status: "error", detail: `Check failed: ${res.text.slice(0, 140)}` };
}

