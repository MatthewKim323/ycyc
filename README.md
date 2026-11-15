# yuzu

**Your apps, in every AI.** yuzu connects consumer apps that have no API (MyFitnessPal, Strong, Duolingo, Cronometer, ParkMobile) to every assistant you already use: Claude, ChatGPT, Grok, Muse, Claude Code, Cursor. One link, connect once, and your assistant can log a meal, read your workouts or check your streak.

Built in one day at the YC Consumer Mobile Hackathon (Nov 15, 2026) with Capy, Revyl and Convex.

## How it works

1. **Pick an app and sign in** on its own page, inside yuzu.
2. **yuzu learns the app.** A recorder watches the app's own private API calls in your session, and a compiler turns them into a *recipe*: a small JSON file of tools with request templates. Phone-only apps are mapped the same way and can run on a Revyl cloud phone.
3. **Paste one link into your assistants.** Every connected app shows up there as tools. Anything that changes your data asks you first, with an approve tap on your phone.

**A recipe is learned once and reused by everyone.** The first person to connect an app teaches it; every user after that connects instantly and only their own session is stored. That shared, self-repairing library of connectors is the moat, the same way Plaid's bank connections were.

yuzu runs no AI of its own. Like [T3 Code](https://github.com/pingdotgg/t3code) does for coding agents, it uses what you already pay for: your assistants and your app accounts.

## Connectors (verified live on real accounts today)

| App | What your assistant can do | How it runs |
|---|---|---|
| MyFitnessPal | Find foods, read your diary, log and remove meals, check goals | Cloud, with a token minted from your session |
| Strong | Recent workouts, exercise history, search exercises, log a workout | Cloud, private API mapped, emailed-code sign-in |
| Duolingo | Streak, XP and history, courses, words you keep missing, league | Cloud |
| Cronometer | Nutrient targets, food search, diary, log and remove foods | From your phone's own session |
| ParkMobile | Find zones, rates and price quotes, active and past parking | From your phone's own session (start and extend always ask first) |

Each one was verified end to end with a live client, including a write that was confirmed and then cleaned up. Recipes live in [`recipes/`](recipes/); the reproducible process for each is in [`research/notes/`](research/notes/).

## The required stack

- **Convex**: the whole backend. Per-user MCP endpoint (`convex/http.ts`, Streamable HTTP, JSON-RPC), the live build pipeline (sign in, capture, map, generate, verify, publish) streamed to the phone, the recipe registry, the executor (cloud, on-device relay, or cloud phone), approvals, the Today summary and crons.
- **Revyl**: cloud iPhones run and test the app (remote iOS builds from `.revyl/config.yaml`), and `convex/revyl.ts` drives cloud phones as the last-resort executor for phone-only apps.
- **Capy**: built the Whop Pro paywall ([PR #1](https://github.com/MatthewKim323/yuzu/pull/1)) and an agent integration ([PR #2](https://github.com/MatthewKim323/yuzu/pull/2)) in parallel cloud threads.
- **Whop** (sandbox): Pro unlocks unlimited apps; checkout in `convex/whop.ts`, webhook at `/whop`.

## Run it

```bash
npm install
npx expo start          # scan with Expo Go
npx convex dev          # backend (needs your own Convex project)
```

Add your link to Claude Code:

```bash
claude mcp add --transport http yuzu https://<your-deployment>.convex.site/mcp/<token>
```

## Build a connector

1. Sign in to the app's website in a browser you control.
2. Record its traffic with the shared recorder (`src/lib/capture/recorder.ts`; see `scripts/re/mfp/capture.ts` for a full run).
3. Compile it: `compileCapture()` in `src/lib/compiler/compile.ts` turns the capture into a draft recipe.
4. Verify every tool live with a client like `scripts/re/mfp/client.ts`, then add `recipes/<app>.json`.

Rules we hold to: the user's own account and session only, writes behind approval, no bypassing bot protection or captchas, no mobile app decompiling, and skip apps whose terms ban automation.

## Repo map

- `src/app`: Expo Router screens (onboarding, apps, connect and build flow, approvals, link setup)
- `src/components/pattern-waves`: a 1:1 port of the PatternWaves shader to expo-gl
- `src/lib/capture`, `src/lib/compiler`: the in-app recorder, device relay and recipe compiler
- `convex/`: backend, MCP server, pipeline, executor
- `recipes/`: verified connector recipes
- `research/`: feasibility report, platform notes, app target audits, per-app reverse engineering notes
- `docs/`: build contract, onboarding and motion spec
