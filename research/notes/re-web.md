# Web route: reverse engineering a site's private API (MyFitnessPal)

Status 2026-11-15: MyFitnessPal recipe verified live on a real account (all 5 tools, cloud and device paths, a write and its cleanup confirmed).

## The process (reproducible, per app)

1. **Sign in inside our WebView.** `CaptureWebView` opens `loginUrl` with the recorder injected at document start (`injectedJavaScriptBeforeContentLoaded`, main frame only). The user signs in with email and password.
2. **Detect sign-in.** URL rules (`loggedOutPaths`, `loggedInPaths`) plus a probe. For MFP the probe is NextAuth `GET /api/auth/session`, which returns `{}` when signed out and `{user, expires, userId, ...}` when signed in (checked live).
3. **Mint session material through the site's own endpoints.** Session probes run inside the signed-in page. MFP: `GET /user/auth_token?refresh=true` returns `{token_type, access_token, expires_in: 864000, refresh_token, user_id}`. The 864000 s lifetime (10 days) was observed live. The recorder posts the bearer and user id as a `session` message. Raw values never enter capture entries.
4. **Walk the playbook.** Visit pages (diary, goals), then run probe requests: the site's BFF routes, plus the API host with the minted bearer. The hooked `fetch`/`XHR` record method, URL, status, request headers (auth redacted), bodies (request up to 8 KB, JSON response up to 16 KB, secret keys redacted) and the page URL.
5. **Compile.** `compileCapture(app, entries, session)` does the following:
   - Keeps successful JSON calls on the allowed hosts and drops noise.
   - Templates ids, uuids and dates in paths, clusters calls by method + path, and infers args from query params and JSON bodies.
   - Binds auth headers to `{{session.headers.x}}` and keeps constant client ids as literals.
   - Picks `auth.refresh` (the token mint), `auth.check` (the cheapest no-arg GET) and the executor: `cloud` if a bearer was captured, else `device`.
6. **Verify, then publish.** Run every tool through `renderRequest` (shared by Convex, the relay and `scripts/re/mfp/client.ts`). A recipe is `verified` once its reads pass and one write plus its undo pass.
7. **Reuse.** Once a `verified` recipe exists, later users skip map and generate. Their sign-in only has to produce a SessionBundle, which comes from steps 2-3.

## What MFP actually looks like (confirmed live)

- The website never calls `api.myfitnesspal.com` from the browser. It proxies through Next.js routes at `www.myfitnesspal.com/api/services/*`, e.g.:
  - `diary/read_diary?entry_date=`
  - `diary/read_day?date=`
  - `nutrient-goals?date=`
  - `diary/nutrient_goals?date=`
  - `GET /api/nutrition?query=`
  - `POST /api/services/diary`, `PUT/DELETE /api/services/diary/:id`
- The route table was found in the site's JS chunks. These routes auth with the HttpOnly NextAuth cookie, so only the device path can use them.
- The API host takes `Authorization: Bearer <access_token>`, `mfp-client-id: mfp-main-js` and `mfp-user-id: <user_id>`. CORS allows these calls from the www origin **without** cookies. A credentialed fetch fails, so the relay omits cookies for cross-origin calls.
- Verified endpoints (the recipe):

  | Endpoint | Status |
  |---|---|
  | `GET /v2/nutrition?q=&max_items=&fields[]=nutritional_contents&fields[]=serving_sizes` | 200 |
  | `GET /v2/diary?entry_date=&types=food_entry&fields[]=...` | 200 |
  | `POST /v2/diary` with `{"items":[{"type":"food_entry","date","meal_name","servings","food":{"id","version"},"serving_size":{"value","unit","nutrition_multiplier"}}]}` | 201, new uuid at `items[0].id` |
  | `DELETE /v2/diary/{uuid}` | 204 |
  | `GET /v2/nutrient-goals?date=` | 200, `items[0].default_goal` + `daily_goals[7]` |

- The compiler, run on the real capture, independently produced `get_goals`, `get_diary` and `search_food` with the same endpoints as the hand recipe, and they pass live (`scripts/re/mfp/compare.ts`). Writes are absent from captures by design: we never write during capture.

## Repair when the site changes

- `auth.check` fails, or a tool starts returning 4xx: mark the recipe `broken` and rerun the playbook on the next user who signs in. Recompile, diff the result against the live recipe (`compare.ts` does this), and re-verify with `client.ts`.
- MFP breaks roughly yearly. History: a login captcha in 2022, then the move to Cloudflare + NextAuth, then a client-side food form ([python-myfitnesspal docs](https://python-myfitnesspal.readthedocs.io/en/latest/getting_started.html), [mfp-mcp](https://pypi.org/project/mfp-mcp/)).
- If the API host ever blocks cloud calls, flip the recipe `executor` to `device`. The same templates run in the hidden WebView unchanged (tested in-page).

## Gotchas

- **Google, Facebook and Apple sign-in.** Google refuses OAuth in embedded WebViews (`disallowed_useragent`). Users must use email + password. We do not spoof user agents around this.
- **Captcha on login.** The login page loads reCAPTCHA and Turnstile. Server-side credential login fails with `RecaptchaFailed` (SHARPIT-WEBAPP ADR-013, matixlol/caloric `login.ts`). That is why sign-in happens in a real WebView driven by the user.
- **HttpOnly cookies in Expo Go.** JS cannot read them, and there is no native cookie module. That is fine for two reasons:
  - The WKWebView default data store is shared and persistent, so the hidden relay WebView rides the same cookies.
  - The bearer is minted in-page through `/user/auth_token`.
  - `auth.refresh` must therefore run on the device.
- **Cloudflare and datacenter IPs.** `www` sits behind Cloudflare (`server: cloudflare`, `__cf_bm`, `/cdn-cgi/challenge-platform` on the login page). Plain-TLS clients get 403s on diary pages, which is why mfp-mcp uses curl_cffi Chrome impersonation and suggests a residential IP ([mfp-mcp](https://pypi.org/project/mfp-mcp/)).
  - `api.myfitnesspal.com` answered plain Node `fetch` from a residential IP.
  - Untested from Convex. If it 403s there, use the device executor.
- **CSP.** `script-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob:` is set, with no `connect-src`. WKWebView user scripts bypass page CSP anyway.
- **Service workers.** Calls answered by a service worker still pass through the page's `fetch`, so the hook sees them. Calls made inside the worker are invisible. MFP registers none on the pages we use.
- **Full page loads.** MFP diary and goals pages are full loads, not client-side routes, so the recorder must be injected at document start on every navigation. `injectedJavaScriptBeforeContentLoaded` does this; post-load injection misses the first calls.
- **Legal line.** We record only the site's own JS-visible traffic in the user's own session, on the user's device. No pinning or attestation bypass. Device execution keeps calls on the user's IP and session ([feasibility report](../feasibility-report.md), Power Ventures discussion).

## Files

| Path | What it is |
|---|---|
| `src/lib/capture/apps.ts` | Per-app config: login detection, playbook, session probes, hosts, noise |
| `src/lib/capture/recorder.ts` | Injected recorder (string builder) |
| `src/lib/capture/relay.ts` | Injected relay for device execution |
| `src/components/capture-webview.tsx` | Sign-in + capture |
| `src/components/device-relay.tsx` | Hidden WebViews that run queued calls |
| `src/lib/compiler/compile.ts` | `compileCapture`, `refineWithLLM` (no-op without a key) |
| `src/lib/compiler/render.ts` | `renderRequest`, `extractPath`, `todayIn` |
| `src/lib/compiler/selftest.ts` | Synthetic self-test |
| `scripts/re/mfp/capture.ts` | Real capture through the Aside browser, using the same recorder and playbook |
| `scripts/re/mfp/client.ts` | Live run of every recipe tool (`--write` logs and deletes one banana; `--device` runs in-page) |
| `scripts/re/mfp/compare.ts` | Compile a capture and diff it against the hand recipe |

## Sources

- coddingtonbear/python-myfitnesspal `myfitnesspal/client.py`: `/user/auth_token?refresh=true` and the `mfp-client-id`/`mfp-user-id` headers. https://github.com/coddingtonbear/python-myfitnesspal
- mfp-mcp 0.5.0 (Mason-Levyy/myfitnesspal-mcp): NextAuth cookie, token rotation, curl_cffi impersonation. https://pypi.org/project/mfp-mcp/
- AdamWalt/myfitnesspal-mcp-python and zN3utr4l/MFP-Auto: `POST /v2/diary`, `DELETE /v2/diary/{id}`, `/v2/nutrition`.
- mvanhorn/printing-press-library `mfp_transport.go`: Origin/Referer and CORS notes.
- SHARPIT-WEBAPP ADR-013/014 and matixlol/caloric `login.ts`: captcha on credential login.
- Live checks on 2026-11-15: login page headers and CSP, `/api/auth/session`, `/api/auth/providers`, the JS chunk route table, and all recipe tools against a real account.
