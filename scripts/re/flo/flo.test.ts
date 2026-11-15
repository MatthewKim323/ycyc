// Synthetic fixtures: these tests verify transport/privacy, not live Flo access.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { Recipe, SessionBundle } from "../../../src/lib/contract";
import { renderRequest, runTool } from "../lib/template";
import { getProfile, login, profileSummary } from "./client";
import { inventory } from "./capture";

test("profile summary retains only the intended health fields", () => {
  const source = { user: { email: "private@example.invalid", session: { token: "secret" }, profile: { last_period_start_date: "2026-11-01", usage_purpose: 3, birth_date: "1990-01-01", notes: "private", pregnancy_due_date: null } } };
  assert.deepEqual(profileSummary(source), { lastPeriodStartDate: "2026-11-01", usagePurpose: 3 });
  assert.deepEqual(profileSummary({ profile: { lastPeriodStartDate: "2026-11-01", usagePurpose: 1 } }), { lastPeriodStartDate: "2026-11-01", usagePurpose: 1 });
  assert.throws(() => profileSummary({ errors: {} }), /missing profile/);
});

test("transport uses source-derived paths, token and JSON credentials without leaking failures", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(calls.length === 1 ? { user: {}, session: { token: "fixture-token" } } : { user: { profile: { usage_purpose: 3 } } });
  }) as typeof fetch;
  assert.equal(await login("fixture@example.invalid", 'p"ass', "fixture-visitor", fetcher), "fixture-token");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { username: "fixture@example.invalid", password: 'p"ass' });
  assert.equal(calls[0].url, "https://api.owhealth.com/call/v1/web_app/sessions");
  assert.deepEqual(await getProfile("fixture-token", fetcher), { usagePurpose: 3 });
  assert.equal(new Headers(calls[1].init?.headers).get("Authorization"), "Bearer fixture-token");
  await assert.rejects(getProfile("fixture-token", (async () => Response.json({ token: "DO_NOT_PRINT" }, { status: 401 })) as typeof fetch), (error: Error) => !error.message.includes("DO_NOT_PRINT") && /HTTP 401/.test(error.message));
});

test("draft recipe runs through shared recipe engine against an explicitly synthetic fixture", async () => {
  const recipe = JSON.parse(readFileSync(new URL("../../../recipes/flo.json", import.meta.url), "utf8")) as Recipe;
  assert.equal(recipe.status, "draft");
  assert.ok(recipe.tools.every((tool) => tool.kind === "read"));
  const session: SessionBundle = { credentials: { username: "fixture@example.invalid", password: 'a"b' }, capturedAt: 0 };
  const req = renderRequest(recipe.auth.loginRequest!, { session }, recipe.baseUrl);
  assert.equal(JSON.parse(req.body!).password, 'a"b');
  const fetcher = (async (url: string | URL | Request) => Response.json(String(url).endsWith("/sessions") ? { user: {}, session: { token: "fixture-token" } } : { user: { profile: { last_period_start_date: "2026-11-01" } } })) as typeof fetch;
  const result = await runTool(recipe, "get_last_period_start_date", {}, session, {}, fetcher);
  assert.equal(result.ok, true);
  assert.equal(result.data, "2026-11-01");
});

test("HAR inventory excludes credentials, IDs, query values and health values", () => {
  const har = { log: { entries: [{ request: { method: "GET", url: "https://api.owhealth.com/call/v1/web_app/users/12345678?token=PRIVATE_TOKEN", headers: [{ name: "Authorization", value: "SECRET" }] }, response: { status: 200, content: { text: JSON.stringify({ user: { email: "PRIVATE_EMAIL", profile: { last_period_start_date: "PRIVATE_HEALTH" } } }) } } }, { request: { url: "https://unrelated.example.invalid/private" } }] } };
  const result = JSON.stringify(inventory(har));
  for (const secret of ["PRIVATE_TOKEN", "SECRET", "PRIVATE_EMAIL", "PRIVATE_HEALTH", "12345678", "unrelated"]) assert.ok(!result.includes(secret));
  assert.equal((JSON.parse(result) as unknown[]).length, 1);
  assert.match(result, /last_period_start_date/);
});
