# Web route: ParkMobile (app.parkmobile.io)

Status 2026-11-15: recipe verified live on matt's own account. All 8 read tools pass on the device path (signed-in page). The 4 zone and price tools also pass from plain Node with no session. `start_parking` and `extend_parking` are modeled from the web bundle and were never sent (they charge money).

## How the web app talks to its API (confirmed live)

- `app.parkmobile.io` is a Next.js app (pages router, Turbopack chunks, `server: envoy` behind CloudFront). There is no Cloudflare and no bot wall on the API routes.
- The browser only calls the app's own BFF at `https://app.parkmobile.io/api/*`, using axios XHR. The BFF proxies two kinds of upstream:
  - `/api/proxy/parkmobileapi/*` goes to the ParkMobile core API. The runtime config names this `phonixx`, at `http://services.parkmobile.io/parkmobileapi`, an internal host.
  - `/api/proxy/ressmartproxy/*` goes to the reservations proxy.
  - Server side, the BFF sends `Authorization: JWT <token>` upstream. That token never reaches the browser.
- The route table came from the public JS chunks. `/_next/static/<build>/_buildManifest.js` lists every page chunk, and each API call is an `endpoint:` string next to `method:`.

### Auth

| Cookie | JS-visible | Role |
|---|---|---|
| `JWT` | no (HttpOnly) | Session token. The BFF reads it from `req.cookies` |
| `REFRESH_TOKEN` | yes | `POST /api/refresh` rotates it. Response: `{newRefreshToken}`, plus new cookies |
| `XSRF-TOKEN` | yes | Double-submit CSRF value. It changes on every page load |
| `_csrfV2` | no (HttpOnly) | The CSRF secret |
| `IS_LOGGED_IN` | yes | Signed-in flag |
| `device-fingerprint` | no (HttpOnly) | Set on first page load |

- Every call sends the header `SourceAppKey: ParkmobileWeb`. `/api/zones/search` returns 400 without it. The other routes do not check it.
- Non-GET calls need `X-XSRF-TOKEN`. Without it, the BFF returns 403 `Cross-site forgery request detected`.
  - A stale `XSRF-TOKEN` from an earlier page load still passed (tested on `POST /api/refresh`). Validation is csurf-style against the `_csrfV2` secret.
  - So the value captured at sign-in stays good while `_csrfV2` lives.
- Signed out, every account route returns 401 `{"message":"Unauthorized"}`, which `isAuthFailure` catches. `GET /api/user` makes a cheap `auth.check`.
- **Executor: device.** The session token is an HttpOnly cookie, and the web app has no JS-readable bearer to mint. MFP had one (`/user/auth_token`); this app does not.
  - The hidden relay WebView on `/account/zones/active` already holds the cookies.
  - Zone and price tools also work from the cloud with no session, if the lead ever wants per-tool routing.
- **Untested cloud option.** `REFRESH_TOKEN` is JS-visible. A cloud executor could get its own `_csrfV2`/`XSRF-TOKEN` pair from any page GET, then `POST /api/refresh` with `REFRESH_TOKEN`, and read the new `JWT` from `Set-Cookie`.
  - Not tried, because rotating the refresh token outside the browser can sign the browser out.
  - The current `refreshBearer` also only reads a JSON `access_token`.

### Sign-in

- `/login` offers three ways in:
  - Continue with Google. Blocked in embedded WebViews.
  - Continue with Apple.
  - Email or phone magic link: `POST /api/login/send-login-token`, reCAPTCHA v3 header.
- The magic link is any app URL with `?login_token=...`, redeemed by `POST /api/login/magic-link`. In the in-app browser the user has to open that link in the same WebView, by pasting it or with a deep-link handoff. Tapping it in Mail opens Safari instead.
- We never call the login endpoints ourselves.

## Endpoints (recipe)

| Tool | Request | Live result |
|---|---|---|
| auth.check | `GET /api/user` | 200 `{userProfile, hasBillingMethod, userId, ...}` |
| get_active_sessions | `GET /api/proxy/parkmobileapi/v2/parking/active[?parkingActionType=OnDemand\|Reservation]` | 200 `{totalPages, count, sessionInfo: []}` (nothing running) |
| get_parking_history | `GET /api/proxy/parkmobileapi/v2/parking/history?parkingActionType=OnDemand` | 200, `sessionInfo: []` (new account) |
| get_vehicles | `GET /api/proxy/parkmobileapi/account/vehicles` | 404 `{"message":"Vehicle not found"}` = no vehicles. The site treats 404 as empty too (`validateStatus` allows 404) |
| get_payment_methods | `GET /api/payment-methods` | 200 `{orderedBillingMethods: []}` |
| find_zone | `GET /api/proxy/parkmobileapi/zones/{signageCode}` | 200, 2 zones for sign 51103 (Atlanta 71451103, Columbus 97051103) |
| find_zones_nearby | `GET /api/zones/search?parkingType=1&upper={N},{E}&lower={S},{W}` | 200, 48 on-street zones in a ~900 m box. Needs the box: center-only gives 422 |
| get_zone_rates | `GET /api/zones/{internalZoneCode}` | 200, `parkInfo` with `timeBlocks[{timeblockId, min, max, increment}]`, `maxParkingTime`, `maxStopTimeLocal`, `durationSelections`, `paymentOptions` |
| quote_parking | `GET /api/proxy/parkmobileapi/price/{internalZoneCode}?timeBlockId=&timeBlockQuantity={minutes}` | 200. 60 min in Atlanta 51103 = $3.50 + $0.30 fee = $3.80. 90 min = $5.25 + $0.30 |
| start_parking (write, not executed) | `POST /api/proxy/parkmobileapi/parking/active` with `{internalZoneCode, durationInMinutes, timeBlockId, vehicleId, selectedBillingMethodId, spaceNumber?, accessCode?}` + `X-XSRF-TOKEN` | not sent |
| extend_parking (write, not executed) | `PUT /api/proxy/parkmobileapi/parking/active/{parkingActionId}` with `{durationInMinutes, timeBlockId, selectedBillingMethodId}` + `X-XSRF-TOKEN` | not sent |

Two endpoints are known but left out of the recipe:

- `DELETE /api/proxy/parkmobileapi/parking/active/{id}` stops a session.
- `GET /api/proxy/parkmobileapi/v2/parking/{id}` returns session details. It is unverified because the account has no sessions.

Notes:

- `parkingType` 1 = on-demand (street and lots), 2 = reservations (garages, with `startDate`/`endDate`/`includeServices`).
- `parkingActionType` is `OnDemand` or `Reservation`.
- **Price preview.** There is also an authenticated variant: `GET /api/proxy/parkmobileapi/parking/price/{zone}?timeBlockId&timeBlockQuantity&vehicleId&selectedBillingMethodId`. It returns 400 `invalid vehicleid` without a vehicle, so the recipe uses the anonymous `/price/` route. That route is the same one the site's zone page uses before sign-in.
- **Session item fields.** Taken from the web app's selectors: `zone.{signageCode, internalZoneCode, locationName, zoneInfo}`, `startLocal`, `stopLocal`, `timeZoneStandardName`, `priceDetail.{parkingPrice, billingType}`, `vehicleLpnState`, `creditCardType`, `creditCardLastFourDigits`, `parkingActionType`. The account had no sessions, so these were not seen in a live response.
- **Duration.** `timeBlockQuantity` is minutes. A 90-minute quote worked although `incrementValue` was 60. `durationSelections` lists the 15-minute steps the app offers.

## Confidence

- **High** for every read tool: real 200s on matt's account and on public zones, and the site itself calls the same routes during capture.
- **Medium** for the write templates. The bodies are lifted from the bundle's `startParking`/`extendParking` functions. The `X-XSRF-TOKEN` behavior was checked on a safe POST (`/api/refresh`), but no write was ever sent.
- Account data is empty today: no vehicles, cards or sessions. Field names inside those lists come from the bundle's selectors, not from live rows.

## Gotchas

- The same zone number exists in many cities. `find_zone` returns all of them, so the model must pick by `locationName`.
- Some zones return 404 from `/api/zones/{code}` at times. The site's own reservation sweep saw one. Treat 404 as "not sold right now".
- There is no address search on the BFF: the site geocodes in the browser with Google Places. The model geocodes and passes a box.
- Cloud calls to the public routes worked from a residential IP with plain fetch, with no UA or cookies needed. Not tried from Convex.

## Files

| Path | What it is |
|---|---|
| `recipes/parkmobile.json` | The recipe (device executor, cookie auth) |
| `scripts/re/parkmobile/capture.ts` | Aside capture with the shared recorder. Also exports `PARKMOBILE_CAPTURE`, the `AppCaptureConfig` for `src/lib/capture/apps.ts` |
| `scripts/re/parkmobile/client.ts` | Live run of every read tool: device path by default, `--cloud` for the no-session path. Writes are rendered but never sent |
| `scripts/re/parkmobile/captures/` | Scrubbed captures (gitignored) |

## Sources

- The public web bundle at app.parkmobile.io:
  - `_buildManifest.js`, the page chunks and the `endpoint:` route strings.
  - The runtime config in the HTML (`SOURCE_APP_KEY`, `JWT_COOKIE`, `API_SERVICES`).
  - The axios client module (headers `SourceAppKey`, `X-XSRF-TOKEN`, and `Authorization: JWT` server side).
- No open-source ParkMobile web clients were needed. The bundle had the full route table.
- Live checks on 2026-11-15 through Aside, in matt's signed-in session (`scripts/re/parkmobile/capture.ts`, `client.ts`), plus anonymous curl for the public zone routes.
