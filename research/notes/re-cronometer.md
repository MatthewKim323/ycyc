# Web route: Cronometer

Status 2026-11-15: recipe `recipes/cronometer.json` verified live on matt's account (device path). Reads pass, and one write plus its undo passed (1 medium banana logged to Snacks, confirmed, deleted, confirmed gone).

## How the web app talks to its backend (confirmed in real traffic)

The signed-in app at `https://cronometer.com/#diary` is a GWT 2.13 single-page app. It uses two transports:

| Transport | Shape | Auth |
|---|---|---|
| GWT-RPC | `POST https://cronometer.com/cronometer/app`, `content-type: text/x-gwt-rpc; charset=utf-8`, headers `X-GWT-Permutation` and `X-GWT-Module-Base: https://cronometer.com/cronometer/`. Body is `7|0|N|<module base>|<policy hash>|com.cronometer.shared.rpc.CronometerService|<method>|<types...>|<nonce>|...` | The session nonce, sent as the first string argument. Works from Node with no cookies (checked), so it acts as a bearer. |
| REST JSON | `https://cronometer.com/api/v3/user/<user id>/...` | Cookies only (no headers). 401 from Node without cookies. |

The nonce cookie (`sesnonce`) is HttpOnly. The page never stores the nonce anywhere readable: it comes back in the `authenticate` response, and the app puts it in every GWT body.

### Endpoints in the recipe

| Tool | Request | Seen in live traffic |
|---|---|---|
| `search_food` | `GET /api/v3/user/{id}/food-search/string?query=&maxResults=&sources=All&categoryId=0&selectedTab=ALL&type=All` returns JSON `[ {name, id, measureId, measureDisplayName, source, type, ...} ]` | yes (Add Food dialog) |
| `get_targets` (also `auth.check`) | `GET /api/v3/user/{id}/targets` returns `[ {id, min, max, vis, custom} ]` keyed by nutrient id | yes (app load) |
| `get_diary` | GWT `getDayInfo(String nonce, Day, int userId)` returns DayInfo with servings `[measureId, "servingId", foodId, amount, userId, ..., mealCode, ..., day]` | yes (diary day nav) |
| `log_food` | GWT `updateDiary(String nonce, int userId, List<AddEntryChange<Serving>>)` returns `AddEntryChangeResult` whose first quoted string is the serving id | body copied from the web app's own request (send blocked during capture, then replayed by the template) |
| `delete_diary_entry` | GWT `removeServing(String nonce, long servingId, int userId)` returns `//OK[[],0,7]` | in the web proxy and the public source; not clicked in the UI |
| `get_daily_nutrition` | GWT `getTotalNutrients(String nonce, int userId, Day, Day, DayQueryType, boolean, boolean)` returns a map of nutrient id to amount | built from the proxy signature in the web JS, not seen in a UI flow |

The `updateDiary` serving tail is `day|month|year|1|1|0|<meal code>|0|0|<amount>|<foodId>|A|<measureId>|0|`. The meal code is `(diary group << 16) | 1`. Two values were seen live: Uncategorized = 1, Snacks (group 4) = 262145. Breakfast, Lunch and Dinner (65537, 131073, 196609) are assumed from the same rule. `amount` counts the chosen measure, and the server works out grams from the measure. The search hit's `id` is the food id and its `measureId` is the default serving measure (checked against `getFood`).

Nutrient ids: 208 energy kcal, 203 protein, 205 carbs, 204 fat, 291 fiber, 304 magnesium, 303 iron, 324 vitamin D IU, 307 sodium, 301 calcium, 401 vitamin C, 255 water.

## Session lifecycle (the part that bites)

- **The nonce rotates on every web-app page load.** Each load calls `authenticate(tzOffset)`, which returns a fresh nonce and invalidates the old one. Checked live: an old nonce returns `//EX[...NotLoggedInException..."Invalid or expired session"]` with HTTP 200.
- **Loading `/login/` while signed in also kills the nonce.** The cookie session survives (REST still works), but GWT calls fail.
- **Relay page:** the hidden WebView must sit on a static same-origin page. `/about/` works and was used for the verification. `/robots.txt` also works but is not HTML.
- **GWT dead-session signal:** HTTP 200 with a body starting `//EX` and containing `NotLoggedInException`. It is not a 401.
- **Deploy drift:** the policy hash (`B82D6F42004DB8749BB1C2080E1A4479` today) and permutation (`0EFF06F8710774B34D04BFA3409289E9` for desktop Chrome) change when Cronometer deploys. The recipe reads both from the session, so a re-capture heals them. The type signatures in the bodies (`Serving/2895043750`, `AddEntryChange/3949104564`, `Day/782579793`, `DayQueryType/1802942352`) matched the current web JS. If they change, the recipe needs a re-capture and a template edit.
- **AWS WAF** sits in front of the site (`aws-waf-token` cookie). The device path avoids it.

## Auth flow for ycyc

1. The user signs in at `https://cronometer.com/login/` inside the WebView with email and password.
2. Sign-in is detected when `https://cronometer.com/` serves the app shell (`script[src*="cronometer.nocache.js"]`). Signed out, `/` is the marketing page.
3. The session is read off the app's own traffic:
   - `storage.nonce`: lowercase 32-hex in any `/cronometer/app` body
   - `storage.gwt_policy`: body field index 4
   - `headers.x-gwt-permutation`: request header
   - `storage.user_id`: from `/api/v3/user/(\d+)/` URLs
4. The relay then sits on `/about/` so nothing re-authenticates.

`authenticate` can mint a fresh nonce on demand, and the new nonce is the only lowercase 32-hex string in the response's string table. The executor can't parse that today, so `auth.refresh` is left out of the recipe.

## Confidence

| Item | Confidence |
|---|---|
| search, targets, diary read, log, delete | High. Each was run live through `renderRequest` |
| Meal codes for Breakfast, Lunch and Dinner | Medium. Assumed from the rule |
| `get_daily_nutrition` | Low to medium for usefulness. HTTP passes, but once foods are logged the map uses GWT back-references (negative numbers), so not every nutrient id is literal. A model can't reliably read totals from it |
| Cloud executor | Possible for GWT tools only (the nonce works without cookies). REST tools need the cookie jar. Device chosen |

## Open items

- Readable daily totals. Option 1 is a small GWT response decoder in the executor. Option 2 is the web app's export: GWT `generateAuthorizationToken(nonce, userId, 3600, AuthScope)` returns a token, then `GET /export?nonce=<token>&generate=dailySummary&start=&end=` returns CSV with named columns (servings CSV via `generate=servings`). That is two chained calls, which the recipe format can't express yet.
- The phone recorder records GWT request bodies raw, and they contain the nonce. Add redaction for `/cronometer/app` bodies (lowercase 32-hex becomes `<redacted:nonce>`) and copy the raw value into `SessionBundle.storage.nonce`.
- `convex/lib/render.ts` `renderBody` quotes bare string placeholders in non-JSON bodies (`|{{session.storage.nonce}}|` would render as `|"abc..."|`). GWT bodies need plain text substitution, which is what `src/lib/compiler/render.ts` `renderText` already does.

## ToS note

Cronometer's terms void the license for circumventing technical protections. This connector stays inside what matt's own signed-in browser session does: it uses the web app's own endpoints, from his session and his browser. There is no mobile app or APK analysis, no captcha or WAF bypass, and no fingerprint spoofing. Mobile-API projects (`mobile.cronometer.com`, derived from the Android app) were deliberately not used as sources. The public web JS bundle was read only to confirm method signatures and type CRCs. During capture, the one write the UI attempted was blocked before sending. The only diary write was the verification banana, which was deleted.

## Sources

- Live traffic and the public web bundle on 2026-11-15: `cronometer.nocache.js`, `<permutation>.cache.js`, `deferredjs/<permutation>/1..14.cache.js`.
- jrmycanady/gocronometer (`gwt_values.go`, `gocronometer.go`): GWT headers, `authenticate`, `generateAuthorizationToken`, `/export`. https://github.com/jrmycanady/gocronometer
- cphoskins/cronometer-mcp `cronometer_mcp/client.py`: `updateDiary` and `removeServing` templates, the REST food search move (observed 2026-08-19 there), dead-session `//EX` handling. https://github.com/cphoskins/cronometer-mcp

## Files

| Path | What it is |
|---|---|
| `recipes/cronometer.json` | Recipe (device executor, 6 tools) |
| `scripts/re/cronometer/capture.ts` | Real capture through Aside with the phone recorder, plus the proposed `AppCaptureConfig` (`CRONOMETER_CAPTURE`) |
| `scripts/re/cronometer/client.ts` | Live run of every tool (`--write` logs and deletes one banana; `--cloud` probes Node without cookies) |
| `scripts/re/cronometer/captures/` | Scrubbed captures (gitignored) |
