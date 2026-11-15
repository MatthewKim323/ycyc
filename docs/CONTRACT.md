# Build contract (Nov 15, hackathon day)

Shared types: `src/lib/contract.ts`. This file: who owns what, the Convex API surface, the MCP endpoint, and the design system. Deadline 6:30 PM. Working beats complete.

## Ownership (do not edit outside your paths)
| Owner | Paths |
|---|---|
| lead | `src/lib/contract.ts`, `docs/`, root config (`package.json`, `app.json`, `.gitignore`) |
| UI agent | `src/app/**`, `src/components/**`, `src/theme/**`, `src/hooks/**`, `assets/icons/**` |
| backend agent | `convex/**` (except `convex/revyl.ts`) |
| web RE agent (MFP) | `src/lib/capture/**`, `src/lib/compiler/**`, `recipes/myfitnesspal.json`, `research/notes/re-web.md` |
| phone RE agent (Strong, Flo) | `convex/revyl.ts`, `recipes/strong.json`, `recipes/flo.json`, `research/notes/re-phone.md`, `scripts/re/**` |

Install packages with `npx expo install <pkg>` and tell the lead which ones you added. Agents do not commit; the lead commits and pushes.

## Environment
- Convex team `matt-5326f`, project `yuzu`, dev deployment `optimistic-newt-247`
- `EXPO_PUBLIC_CONVEX_URL=https://optimistic-newt-247.convex.cloud` (in `.env.local`)
- HTTP actions: `https://optimistic-newt-247.convex.site`
- Convex CLI and Revyl CLI (`~/.revyl/bin/revyl`) are logged in on this machine
- No LLM key is set in Convex on purpose (no spending). Compiler must work heuristically; LLM refinement only if `OPENAI_API_KEY` exists in Convex env
- Must run in **Expo Go** on a real iPhone: no custom native modules

## Demo apps
| slug | route | how we get in |
|---|---|---|
| `myfitnesspal` | web | In-app browser login at myfitnesspal.com, recorder captures private API, compile to recipe. Calls run `device` (hidden WebView) or `cloud` if a bearer token is captured |
| `strong` | cloudPhone | APK runs on Revyl (app id `2bab1be3-763b-4a29-8580-83b56aa475f4`, build `7305e6d8-dec7-4875-af81-d2df944f5df1`). Map its API (known community reverse engineering + Revyl network capture), then call direct with `login_api`; fallback `phone` executor |
| `flo` | cloudPhone | Same pattern as Strong. Health data: write tools need approval, reads summarized |

## Convex API (names the UI calls)
Queries/mutations (`api.<file>.<fn>`):
- `users.ensure({ deviceId }) -> { userId, mcpUrl }` (mutation; creates user + random mcp token on first launch)
- `apps.list() -> (CatalogApp & { recipeStatus?: "draft"|"verified"|"broken", toolCount: number })[]`
- `apps.get({ slug })`
- `connections.mine({ userId }) -> (Connection & { app })[]`
- `connections.start({ userId, appSlug }) -> connectionId` (status `needs_login`)
- `connections.submitLogin({ connectionId, session: SessionBundle, capture: CaptureEntry[] })` (mutation; sets `building`, schedules the build)
- `connections.disconnect({ connectionId })`
- `builds.forConnection({ connectionId }) -> { status, steps: BuildStep[], recipeVersion? }` (reactive progress for the build screen)
- `activity.feed({ userId, limit? }) -> ActivityItem[]`
- `approvals.pending({ userId })`, `approvals.decide({ approvalId, decision: "approve"|"deny" })`
- `recipes.forApp({ slug }) -> Recipe | null`
- Device relay: `calls.queued({ userId })` (query the phone subscribes to), `calls.complete({ callId, response: { status, body } })`

Build pipeline (internal): `signin -> capture -> map -> generate -> verify -> publish`. Each step patches the build doc so the phone animates live. If a `verified` recipe already exists for the app, skip `map`/`generate` (the reproducible path) and just verify the user's session.

## HTTP routes (`convex/http.ts`)
- `POST /mcp/<token>`: MCP Streamable HTTP, JSON-RPC 2.0. Methods: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`. Respond `application/json` (no SSE needed). Tools exposed: every tool from the user's `live` connections as `<slug>__<tool>`, plus `connect_app({ app })` which returns a connect link + instructions when the app is not connected, and `list_apps`. Log every call to `activity`. Writes create an approval and wait up to ~20 s for a decision on the phone.
- `GET /connect/<slug>?u=<token>`: tap-to-connect fallback; redirects to `yuzu://connect/<slug>`
- `POST /whop`: Whop sandbox webhook (`payment.succeeded`) flips user to Pro

## Design system (UI)
Mostly black, white accent, clean like a ChatGPT/OpenAI app. No color except status dots.
- bg `#000000`, surface `#0B0B0B`, surface2 `#141414`, border `#1F1F1F`, borderStrong `#2A2A2A`
- text `#FFFFFF`, textSecondary `#A1A1A1`, textTertiary `#6B6B6B`
- accent = white: primary button white fill + black label, pill radius; secondary button transparent + 1px border
- status dots only: live `#FFFFFF`, building pulsing white at 50%, error `#FF453A`
- Type: Inter (400/500/600). Title 28/600, -0.5 tracking. Body 15/400. Label 13/500. **Never monospace.**
- Radius 16 cards, 999 pills. Spacing 4/8/12/16/24/32. 16px screen gutter. Hairline borders, no shadows, no gradients.
- Icons: **Lordicon only** (Lottie JSON from `https://cdn.lordicon.com/<id>.json`, saved under `assets/icons/`, rendered with `lottie-react-native`, colors forced to white). No other icon sets, no emoji, no SF Symbols.
- Copy: short, concrete, no filler. Every tappable thing must do something; nothing that looks tappable may be dead.
