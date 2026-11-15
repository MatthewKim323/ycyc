import { v } from "convex/values";
import type { CaptureEntry, CatalogApp, Recipe, SessionBundle } from "../src/lib/contract";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import { catalogApp } from "./catalog";
import { executeRequest, executeTool, isAuthFailure } from "./executor";
import { compileCapture, HAS_COMPILER } from "./lib/compilerShim";
import { fallbackCompile } from "./lib/fallbackCompiler";
import { handRecipeFor, normalizeRecipe } from "./lib/recipeStore";

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

export const run = internalAction({
  args: { buildId: v.id("builds") },
  handler: async (ctx, { buildId }) => {
    const build = await ctx.runQuery(internal.builds.get, { buildId });
    if (!build) return;
    const step = (key: StepKey, status: StepStatus, detail?: string) =>
      ctx.runMutation(internal.builds.step, { buildId, key, status, detail });
    let current: StepKey = "signin";
    const begin = async (key: StepKey, detail?: string) => {
      current = key;
      await step(key, "running", detail);
    };

    try {
      const conn = await ctx.runQuery(internal.connections.get, { connectionId: build.connectionId });
      if (!conn) throw new BuildError("Connection was removed");
      const app = catalogApp(conn.appSlug);
      if (!app) throw new BuildError(`Unknown app ${conn.appSlug}`);
      const session: SessionBundle = conn.sessionJson ? JSON.parse(conn.sessionJson) : { capturedAt: 0 };

      // 1. signin: the session we got from the phone.
      await begin("signin");
      await sleep(BEAT_MS);
      const nCookies = Object.keys(session.cookies ?? {}).length;
      const nHeaders = Object.keys(session.headers ?? {}).length;
      const nStorage = Object.keys(session.storage ?? {}).length;
      const hasCreds = !!session.credentials?.username;
      if (!nCookies && !nHeaders && !nStorage && !hasCreds) {
        throw new BuildError("No session received. Sign in again.");
      }
      const parts = [
        hasCreds ? "account" : "",
        nCookies ? plural(nCookies, "cookie") : "",
        nHeaders ? plural(nHeaders, "auth header") : "",
        nStorage ? plural(nStorage, "storage key") : "",
      ].filter(Boolean);
      await step("signin", "done", `Session saved: ${parts.join(", ")}`);

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
      } else if (hand) {
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
          throw new BuildError("No API calls recorded. Open your diary in the browser, then finish again.");
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
      } else {
        await begin("map");
        await sleep(BEAT_MS);
        throw new BuildError(`${app.name} isn't mapped yet. Its recipe is still being built.`);
      }

      // 5. verify the user's own session against the recipe.
      await begin("verify");
      const verdict = await verify(ctx, conn, recipe);
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
      await ctx.runMutation(internal.builds.finish, { buildId, status: "done", recipeVersion: recipe.version });
    } catch (e) {
      const message = e instanceof BuildError ? e.message : `Build failed: ${e instanceof Error ? e.message : String(e)}`;
      console.error("build", buildId, message);
      await step(current, "error", message.slice(0, 200));
      await ctx.runMutation(internal.builds.finish, { buildId, status: "error", error: message.slice(0, 500) });
      await ctx.runMutation(internal.connections.setStatus, {
        connectionId: build.connectionId,
        status: "error",
        error: message.slice(0, 500),
      });
    }
  },
});

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
  const ms = Date.now() - started;

  if (res.ok) {
    return { status: "done", detail: `Session works (${check ? "auth check" : readTool!.name}, ${ms} ms)` };
  }
  if (res.status === undefined && /Phone did not answer/.test(res.text)) {
    return { status: "skipped", detail: "Phone relay did not answer, verify on first call" };
  }
  if (isAuthFailure(res)) {
    return { status: "error", detail: `Session rejected (${res.status}). Sign in again.` };
  }
  if (/MFA_REQUIRED/.test(res.text)) {
    return { status: "error", detail: "Account needs an emailed code. Sign in again on the phone." };
  }
  return { status: "error", detail: `Check failed: ${res.text.slice(0, 140)}` };
}

