"use node";
// Password login and MFA code exchange for login_api recipes (Strong), wired to the phone RE
// agent's loginStart/loginVerify in scripts/re/lib/template.ts. Node runtime because the code
// form needs Set-Cookie access and manual redirects.
// Credentials and codes are never logged or returned; errors are reduced to short user copy.
import { v } from "convex/values";
import type { Recipe, SessionBundle } from "../src/lib/contract";
import { internalAction } from "./_generated/server";
import * as tmpl from "./lib/templateShim";

type StartResult =
  | { kind: "ok"; loginJson: string }
  | { kind: "mfa"; pendingJson: string; prompt?: string }
  | { kind: "error"; error: string };
type VerifyResult = { kind: "ok"; loginJson: string } | { kind: "error"; error: string; retry: boolean };

const TIMEOUT_MS = 15_000;

const timedFetch: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(input, { ...(init ?? {}), signal: controller.signal }).finally(() => clearTimeout(timer));
};

function statusOf(msg: string): number | undefined {
  const m = /HTTP (\d{3})/.exec(msg);
  return m ? Number(m[1]) : undefined;
}

export const loginStart = internalAction({
  args: { recipeJson: v.string(), sessionJson: v.string() },
  handler: async (_ctx, a): Promise<StartResult> => {
    if (typeof tmpl.loginStart !== "function") return { kind: "error", error: "Sign-in isn't available yet" };
    const recipe = JSON.parse(a.recipeJson) as Recipe;
    const session = JSON.parse(a.sessionJson) as SessionBundle;
    try {
      const r = (await tmpl.loginStart(recipe, session, timedFetch)) as
        | { status: "ok"; login: Record<string, unknown> }
        | { status: "mfa_required"; challenge: Record<string, unknown>; prompt?: string };
      if (r.status === "ok") return { kind: "ok", loginJson: JSON.stringify(r.login) };
      return { kind: "mfa", pendingJson: JSON.stringify(r.challenge ?? {}), prompt: r.prompt };
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return { kind: "error", error: "Sign-in timed out" };
      const status = statusOf(e instanceof Error ? e.message : "");
      if (status === 400 || status === 401 || status === 403) return { kind: "error", error: "Wrong email or password" };
      return { kind: "error", error: status ? `Sign-in failed (HTTP ${status})` : "Sign-in failed" };
    }
  },
});

export const loginVerify = internalAction({
  args: { recipeJson: v.string(), sessionJson: v.string(), pendingJson: v.string(), code: v.string() },
  handler: async (_ctx, a): Promise<VerifyResult> => {
    if (typeof tmpl.loginVerify !== "function") return { kind: "error", error: "Code check isn't available yet", retry: false };
    const recipe = JSON.parse(a.recipeJson) as Recipe;
    const session = JSON.parse(a.sessionJson) as SessionBundle;
    const challenge = JSON.parse(a.pendingJson) as Record<string, unknown>;
    try {
      const r = (await tmpl.loginVerify(recipe, session, a.code.replace(/\s+/g, ""), challenge, timedFetch)) as {
        login: Record<string, unknown>;
      };
      if (!r?.login?.accessToken) return { kind: "error", error: "No token came back. Sign in again.", retry: false };
      return { kind: "ok", loginJson: JSON.stringify(r.login) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (e instanceof Error && e.name === "AbortError") return { kind: "error", error: "Code check timed out. Try again.", retry: true };
      if (/too many/i.test(msg)) return { kind: "error", error: "Too many attempts. Sign in again later.", retry: false };
      if (/code rejected|expired/i.test(msg)) {
        return { kind: "error", error: "That code didn't work. Enter the newest code.", retry: true };
      }
      const status = statusOf(msg);
      return { kind: "error", error: status ? `Code check failed (HTTP ${status})` : "Code check failed", retry: false };
    }
  },
});
