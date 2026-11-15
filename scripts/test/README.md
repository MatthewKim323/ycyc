# Backend e2e

`e2e.ts` tests the backend end to end over the real MCP endpoint, using matt's live app sessions from the Aside browser.

```bash
npx tsx scripts/test/e2e.ts                       # all 5 apps: protocol, connect, every read, writes + approvals
npx tsx scripts/test/e2e.ts --only mfp,duolingo   # subset: mfp strong duolingo cronometer parkmobile
npx tsx scripts/test/e2e.ts --no-writes           # protocol + connect + reads only (~1 min)
npx tsx scripts/test/e2e.ts --keep                # leave the test connections connected
```

A full run takes about 3 to 4 minutes, so run it in the background. It exits 0 when every check passes and prints a markdown table at the end.

## What it needs
- Convex dev deployment (`EXPO_PUBLIC_CONVEX_URL` in `.env.local`) and the logged-in Convex CLI (it uses `npx convex run` for two internal functions).
- Aside CLI signed in to myfitnesspal.com, duolingo.com, cronometer.com and app.parkmobile.io.
- Strong tokens in `~/.ycyc/re-state/strong.json` (from `scripts/re/strong/login.ts`).

## What it does
1. Creates a throwaway user (`users.ensure`, deviceId `e2e-<ts>`) and gets its MCP URL.
2. Protocol: initialize (and version fallback), notifications/initialized (202), ping, tools/list, unknown method, bad token (404), malformed JSON, batch, unknown tool, list_apps, connect_app, check_approval, the sessionless ParkMobile zone tools, and a tool for an app that isn't connected.
3. Builds each app's SessionBundle from the signed-in Aside tab, the same way `scripts/re/<app>` does, then runs `connections.start` + `connections.submitLogin` and waits for `builds.forConnection` to finish.
4. Emulates the phone's DeviceRelay for Cronometer and ParkMobile: it polls `calls.queued`, runs each request inside a signed-in Aside page (`credentials: "include"` for same-origin requests), and calls `calls.complete`.
5. Calls every read tool over MCP `tools/call`.
6. Writes go through the approval flow, decided with `approvals.decide`:
   - MyFitnessPal: deny; log a banana to Snacks (approve), then approve again and re-run the runner (it must run once); approve_hour, after which the next log runs with no prompt; then each entry is deleted (approve).
   - Cronometer: log a banana with a late approval (the 20 s MCP wait runs out, then approve, then `check_approval` returns the result), then delete it.
   - Strong: log a "ycyc test" workout (approve), then hide it with the same soft delete `scripts/re/strong/run.ts` uses.
   - Duolingo and ParkMobile get no writes. The client refuses `start_parking` and `extend_parking`.
7. Disconnects every test connection. Anything it couldn't clean up is listed under LEFTOVERS.

## Secrets
Sessions stay in memory and every printed line is scrubbed. The only thing written to disk is Strong's token pair: the backend rotates it, so the new pair goes back to `~/.ycyc/re-state/strong.json`, where it already lived.
