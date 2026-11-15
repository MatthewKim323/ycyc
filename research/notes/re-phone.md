# Phone-only apps: reverse engineering process (Strong, Flo)

Hackathon day, 2026-11-15. Owner: phone RE agent.

## The loop

1. **Discover.** Pull the APK (APKMirror first), unzip, `strings` the dex files and `resources.arsc` for hosts, Retrofit paths and auth hints. Search GitHub (`gh search code "<host>"`) for community clients. Boot the APK on Revyl and look at the welcome/login screens.
2. **Map.** Confirm the host and login with harmless probes (public endpoints, a deliberately wrong password). Then log in with the approved account and walk the read endpoints. Prefer endpoints that answer the tool in one call (Strong `GET /api/users/{id}/logs?limit&page` is newest first; the sync endpoint is oldest first).
3. **Recipe.** Write the recipe in TS (`scripts/re/<app>/recipe.ts`), generate `recipes/<app>.json`. Templates use the shared renderer `scripts/re/lib/template.ts` (`{{login.*}}`, `{{session.*}}`, `{{#each}}`, `{{$uuid}}`, `{{$now}}`, fallbacks, plus optional `pages`, `filterContains`, `maxItems`, `compact`).
4. **Verify.** `scripts/re/<app>/run.ts verify` runs every tool through the same `runTool` the backend can call (`internal.revyl.runRecipeTool`). Writes use one clearly named test record and clean it up.
5. **Repair.** Fingerprint headers (`x-client-build`), MFA, pagination limits and response shapes drift. Rerun `verify`; if a call breaks, re-probe that endpoint and regenerate the recipe. Fallback: `executor: "phone"` with Revyl instruction/extract steps.

## Strong (verified, cloud executor)

| | |
|---|---|
| Host | `https://back.strong.app` (ASP.NET, HAL JSON, RFC 9110 problem JSON on errors) |
| Fingerprint | `User-Agent: Strong Android`, `x-client-build: 600013`, `x-client-platform: android` |
| Login | `POST /auth/login {usernameOrEmail, password, deviceId}` -> `{accessToken (HS256 JWT, 20 min), refreshToken, expiresIn, userId}` |
| MFA | Every password login on this account returned `403 {code: "MFA_REQUIRED", challenge, redirectUrl}` and emailed a 6-digit code, even with the same deviceId. Completion: `GET auth.strongapp.com/auth/mfa/<challenge>?redirectUrl=strong://mfa` (any non-http scheme; https callbacks are refused), POST the form (`Code`, `ChallengeId`, `RedirectUrl`, antiforgery token + cookies), read `token`/`challenge` from the `strong://mfa?...` redirect, `POST /auth/mfa/verify {token, challenge}` -> tokens |
| Refresh | `POST /auth/login/refresh {accessToken, refreshToken, deviceId}`, rotates both tokens |
| Reads | `GET /api/users/{id}/logs?limit=N&page=P` (newest first, `total`, max limit 200), `GET /api/users/{id}/measurements?limit=200&page=P` (332 = 253 built-in + custom), `GET /api/measurements?page=N` (public, no auth) |
| Write | `PUT /api/users/{id}` with envelope `{id, strongAnalytics:false, _embedded:{log:[...], template:[], ...}}`. Delete = same PUT with `isHidden:true` on the log and its children |
| Units | weights stored as kg strings; user pref `preferences.weightUnit[userId]` (matt: POUNDS) |

Verification on matt's real account: login + MFA ok, reads ok, wrote one workout "ycyc test" (2 sets of Bench Press - Wide Grip (Barbell), 20 kg x 5), read it back, soft deleted it (PUT 200), confirmed it no longer appears in recent workouts. The hidden record stays in Strong's sync history the same way an in-app delete does.

Tools: `get_recent_workouts`, `search_exercises`, `get_exercise_history`, `log_workout`.

Sources: tolik518/strong-api-workout-sync (Rust client, fixtures), crcatala/strong-cli `docs/api-inventory.md` and `docs/auth-findings.md`, jerhinesmith/strong-mcp (write envelope, log builder, MFA form flow, MIT), live probes. Older Parse API (dmzoneill/strongapp-api, `ws13.strongapp.co/parse`) is retired and drew termination warnings.

APK evidence: Strong 2.7.11 (the newest plain APK on APKMirror; 6.x ships only as split bundles) is Parse + Realm, `resources.arsc` names `https://ws13.strongapp.co/parse` (now 403). So the Revyl build cannot log in to the current backend. The phone executor for Strong needs a 6.x install (split APKs) if we ever want it.

## Flo (blocked, draft phone recipe)

- No community reverse engineering exists. Flo files DMCA takedowns (github/dmca 2022-09-01, 2022-09-09, 2023-11-10) and APKMirror shows a DMCA removal notice. Uptodown/APKPure have nothing; APKCube has only a 160 MB `.apks` split bundle. No Flo build on Revyl yet.
- From Flo's public web app bundle (`app.flo.health`, Next.js): Auth0 tenant on `auth.flo.health` (OIDC discovery: `/oauth/token`, `/mfa/challenge`, `/oauth/device/code`), backend `https://api.owhealth.com` behind a `/call/v1/<service>` gateway, telehealth hosts under `*.th.owhealth.com`, two web Auth0 client ids.
- Web account API, base `https://api.owhealth.com/call/v1/web_app` (snake_case bodies, `X-Visitor-Id` header): `POST /sessions {username, password}` (live: wrong password -> 401 `{"type":"unauthorized"}`, `WWW-Authenticate: token realm="simple"`), `POST /sessions/token {token}`, `POST /users` (register: email, password, name, time_zone, consents, profile{usage_purpose 3 = track cycle, last_period_start_date, birth_date, birth_date_precision}), `GET /users?ensure_pii=true`, `PUT /users/consents`. A first register attempt without consents returned 500; the account was not created. Client: `scripts/re/flo/web.ts`.
- Mobile cycle/symptom endpoints are unknown: Revyl network capture (`revyl device requests`) is iOS only ("live network requests are currently supported only for iOS sessions"), Android logcat shows no URLs, and no APK to grep.
- Next step: install the split bundle on an emulator with `adb install-multiple` (or get a universal APK), grep its dex for `api.owhealth.com` paths and the Android Auth0 client id, then build `login_api` via Auth0 password grant if the tenant allows it. Use only the approved throwaway account and fake cycle data.

## Revyl findings

- REST (from RevylAI/revyl-cli): base `https://backend.revyl.ai`, `Authorization: Bearer <api key>`. Unknown User-Agents get HTTP 426, send `revyl-cli/<version>`.
- `GET /api/v1/apps/builds/<build>?include_download_url=true` -> app_id, download_url, package_name
- `POST /api/v1/execution/start_device {platform, app_id, build_id, app_url, app_package, is_simulation:true, idle_timeout_seconds}` (without `is_simulation` it demands a test_id) -> workflow_run_id, session_id
- Ready: poll `GET /api/v1/execution/streaming/worker-connection/<run>` for `worker_ws_url`, then proxy `health`
- Device actions go through `/api/v1/execution/device-proxy/<run>/<action>`: `launch`, `execute_step {step_type: instruction|extract|validation, step_description}` (may return `accepted` + step_id, then poll `step_status/<id>`), `screenshot`, `hierarchy`
- Stop: `POST /api/v1/execution/device/sessions/<session>/stop`
- Viewer: `https://app.revyl.ai/sessions/<session>`
- Timing seen: device boot about 10 s once a worker is assigned, but queueing for a worker took up to 2 minutes; one instruction about 12 s (tap Log in), one extract about 5 s. Each step costs Revyl a vision LLM call (about $0.01).
- REST path verified: `npx tsx scripts/re/revyl-smoke.ts` booted the Strong build, tapped Log in, extracted "Text field labels: 'Username or email', 'Password'. Button labels: 'RESET PASSWORD', 'LOG IN'." and stopped the device (50 s of device time, 157 s wall clock).
- Android sessions have no network capture (`revyl device requests` is iOS only) and logcat showed no request URLs, so Revyl helps with UI driving, not API discovery, on Android.

## Legal / ToS

Both apps' terms forbid reverse engineering and automated access. Strong has threatened account termination over the old Parse API. Keep traffic personal, low frequency, on accounts the user owns, with the official fingerprint and no bypasses (no pinning or attestation bypass was built or used). Flo is sensitive health data: writes need approval, reads should be summarized, and the team should not store raw cycle data.

## Demo risks

- Strong MFA: every fresh password login emails a code. Keep the token pair alive (refresh before 20 min expiry, persist the rotated pair) or the demo needs a code from matt's inbox.
- Phone executor speed: about 15 s per Revyl step; a log_workout through the UI would take 1 to 2 minutes.
- Emulator detection / Play Integrity: not hit by Strong 2.7.11; untested for Flo.
- Free plan: 1,200 device minutes, 2 concurrent devices.
