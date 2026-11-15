# Flo connector research — 2026-11-15

The direct web-account connector is now drafted. It does **not** provide cycle predictions, diary history or symptom writes. Successful authentication and health-data response shape still need a user-owned capture; the recipe must stay `draft` until then.

## Evidence and scope

Primary sources inspected:

- [Flo web app](https://app.flo.health/), including its public Next.js `runtimeConfig`: `apiUrl` is `https://api.owhealth.com`, `useProxy` is false, and the Auth0 tenant is `auth.flo.health`.
- [Official web app bundle](https://app.flo.health/_next/static/chunks/pages/_app-bb691ff7ac2c37fe.js), module 26413: `POST /sessions` with `{username, password, third_party_token}`, `POST /sessions/token` with `{token}`, and `GET /users` with query `ensure_pii=true`. The API client base is `/call/v1/web_app`. The frontend takes `session.token` from login and uses `Authorization: Bearer <token>`. Auth/register requests attach `X-Visitor-Id`.
- The same bundle maps profile fields `lastPeriodStartDate`, `pregnancyDueDate`, and `usagePurpose`; its wire adapter converts snake_case responses to camelCase. These are account profile fields, not evidence for a mobile diary API.
- [Official calendar route asset](https://app.flo.health/_next/static/chunks/pages/calendar-3ba3f70417c17b8c.js): `/calendar` renders nothing and redirects to `PAGE_DOWNLOAD`. A web calendar scraper will not obtain the user's mobile diary.
- Public GET to [the account endpoint](https://api.owhealth.com/call/v1/web_app/users?ensure_pii=true) returned **HTTP 401** with `{"errors":{"Authentication Required":"Please provide valid Token verification credentials"}}`. This verifies the unauthenticated boundary only. No password attempt was made in this work.

No account was created, no user was signed in, no health records were changed, and no APK was decompiled. The earlier phone note's suggestion to inspect decompiled APK strings conflicts with the repository README and should not be followed.

## What was built

- `recipes/flo.json`: cloud `login_api` draft using source-derived account endpoints. A single read tool projects `user.profile.last_period_start_date`; that **response envelope is provisional** until a successful capture. It deliberately makes no prediction or symptom claims. The former unverified phone instructions and health write tool were removed.
- `scripts/re/flo/client.ts`: typed explicit login and read-only profile client; accepts candidate direct/profile and user/profile envelopes and returns only stored period date, pregnancy due date and numerical usage purpose. Unknown shapes fail. Error messages omit server bodies. No account identity or tokens are printed.
- `scripts/re/flo/web.ts`: local CLI. Credentials come from environment variables; login requires an explicitly chosen new session file, created with mode `0600`. It never prints tokens. Profile reads use `FLO_SESSION_TOKEN` or that file. It does not register accounts, solve challenges, change records or automatically retry login.
- `scripts/re/flo/capture.ts`: local HAR inventory restricted to Flo API/Auth0 hosts. It omits request headers/bodies, query values and response values; unknown path segments are replaced. Field names/types are retained for local schema analysis. Review output before sharing, since JSON property names can themselves be user-supplied. The original HAR remains private and can contain highly sensitive health data and auth material.
- `scripts/re/flo/flo.test.ts`: synthetic tests for field minimization, safe error handling, source-derived transport, shared recipe rendering/execution and HAR inventory redaction. Fixtures are not evidence of successful Flo access.

## Running local checks

```sh
npx tsx --test scripts/re/flo/flo.test.ts
npx eslint scripts/re/flo/client.ts scripts/re/flo/web.ts scripts/re/flo/capture.ts scripts/re/flo/flo.test.ts
npx tsx scripts/re/flo/web.ts help
```

For a user who already owns a Flo account and wants to test:

1. Set `FLO_EMAIL` and `FLO_PASSWORD` locally, without putting values in chat, source files or shell history.
2. Run `npx tsx scripts/re/flo/web.ts login --session-file /private/path/new-flo-session.json`. Use the normal Flo app if it requires an interactive challenge; do not bypass it.
3. Run `npx tsx scripts/re/flo/web.ts profile --session-file /private/path/new-flo-session.json`. This prints a small health profile summary. It does not prove live cycle predictions or diary support.
4. Delete the private session file when no longer needed. Do not commit it.

## Integration and remaining work

The existing recipe engine/MCP catalog can consume this recipe without a new MCP server. Root integration must decide when to update the seeded Flo recipe; no shared Convex files were edited here. Do not promote a draft merely because an HTTP check succeeds: verify the projected value against the real account and preserve the `draft` state until that is done.

The original blocker was lack of a usable Flo mobile build/traffic. The public web bundle gets us past endpoint discovery for account login/profile only. To provide the requested useful mobile tools, obtain **the user's own** authenticated mobile request/response capture for: reading cycle status, reading a single day's logs, and (only if separately approved) writing/re-reading a disposable symptom. Record the method, host/path, required headers, response shape and token lifetime. Confirm snake_case and the `user` envelope, then change the projection if needed. Do not derive medical predictions from the stored last-period date or invent endpoints from UI labels.

No live authenticated check, mobile endpoint verification, MFA compatibility or token renewal was claimed. `POST /sessions/token` exists in the frontend, but its renewal semantics are unknown and no refresh behavior is configured.
