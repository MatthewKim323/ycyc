# Vision: agentify every app

**Plaid for consumer apps, for AI.** Connect any app on your phone to any AI assistant you use (Claude, ChatGPT, Grok, Muse), including the apps that have no API. Connect once, every assistant has it.

## Where it started (2026-11-14)
> "what if we make it so you can connect ANYTHING... mobile app that can connect ANY of your mobile apps to ur intelligence... make EVERYTHING agentic... the everything mcp... canvas, gym tracking app, nutrition apps, everything... it just goes thru ur phone and engineers its own api and map per app on the spot"

Inspired by [executor.sh](https://executor.sh/) (see `research/notes/executor-sh.md`).

## How the idea evolved in one night
1. **Everything MCP:** an app that builds an API per app on the spot. Research said the literal version can't ship: iOS gives apps zero access to other apps (that power is reserved for Siri AI), and Google Play has banned accessibility agents that plan and act on their own since Oct 2025.
2. **Siphon:** most apps have no API, so we make one. matt already synced Canvas data with a browser extension. An extension (or our own in-app browser) records the private API calls a web app makes, and an LLM compiles them into a tool map.
3. **Phone first:** the app becomes a browser. Log into each app's web version inside our app, inject a recorder, compile on the phone (mostly deterministic code plus the on-device model), execute from the phone (real cookies, real fingerprint, user's IP).
4. **Cloud phones:** for phone-only apps (Strong, Fitbod, MacroFactor), run them on a cloud Android emulator (Revyl), let an agent drive it, and watch its traffic to map the API. Works for iPhone users too.
5. **Not a subscription unifier:** T3 Code unifies coding-agent subscriptions because those are CLIs. Consumer chat subscriptions can't be driven that way. Instead, unify the apps and plug into every assistant: they all accept custom MCP now.
6. **The Plaid thesis:** nobody opens Plaid. It appears at the exact moment you need it inside someone else's app, you pick your bank, it's gone. Ours appears inside Claude/ChatGPT/Grok when the agent needs an app it can't reach yet. People "use" it every day without opening it.
7. **The MCP wallet:** the phone app is the wallet that holds every connection. The wallet alone already exists (MoChiPi, Rube). What goes in it, APIs for apps that have none, is the moat.

## The product
- **One MCP link per user.** Add it once to Claude, ChatGPT, Grok, Muse, Perplexity, Codex, T3 Code.
- **Connect pop-up.** When the agent needs an app that isn't connected, our MCP shows the connect screen (MCP URL elicitation or an MCP Apps card; fallback: a "tap to connect" link that opens our phone app). Pick the app, log in once, its tools appear right there.
- **Wallet app (phone).** Connected apps, a live feed of what your agents did ("Claude logged lunch in MyFitnessPal"), push notifications to approve anything that writes, morning brief.
- **Tool surface stays small.** Search + execute (code mode, the Executor pattern), so 50 connected apps don't flood the AI's context.

## How a connector gets built (the ladder, per app)
1. Official API or OAuth, where AI use is allowed
2. Maintained community MCP server (judge by release recency)
3. One-time capture of the app's web traffic, compiled into a client: normalize to OpenAPI, cut to 15-30 tools, inject auth at the transport, re-capture on failure
4. Browser agent on the web app as runtime fallback and repair loop that compiles back to direct API calls
5. Cloud phone (Android emulator) for phone-only apps: agent drives the UI, rooted emulator + Frida lets us map the API underneath
6. Exports and health stores (CSV, Apple Health, Health Connect) for history

Each app is learned **once** and shared across all users. Credentials stay per user. Only API shapes are shared, never anyone's data or tokens.

## Architecture
**Phone (native companion app)**
- In-app browser: log into web versions, injected recorder captures API calls, sessions stay on device
- Safari Web Extension on iOS (ships inside the App Store app): captures when you use apps in Safari; needed for Google sign-in, which blocks embedded browsers
- Reads HealthKit / Health Connect / EventKit through its own native code (not plug-in code, guideline 4.7.2)
- Tool maps are JSON data run by a fixed engine (App Store bans downloading code, not data)
- Publishes its own App Intents (iOS) and AppFunctions (Android) so Siri and Gemini can call us: being the target is allowed, calling into other apps isn't
- Local vault (SQLite mirror), push approvals

**Cloud**
- Connector compiler + shared route graph per app
- MCP endpoint per user (remote MCP for Claude/ChatGPT/Grok/Muse)
- Cloud phones for phone-only apps
- iOS kills background sockets, so the phone can only be an MCP server while open; Android can run a foreground service all day

## Business
- **Two-sided like Plaid.** Consumers free. Developers (fitness coach AIs, study apps, even Muse or Grok) drop in our connect screen and pay per connected account.
- **Near-zero inference cost.** The user's own assistant does the thinking. What costs money: cloud phones for phone-only apps, discovery and browser fallback (amortized per app), and maintenance as apps change.

## Why now
- Every major assistant accepts custom MCP connectors in 2026 (Claude all plans, ChatGPT dev mode, Grok paid, Muse opened Sep 18, Perplexity).
- The average AI user runs about 3 assistants (Menlo, Jul 2026) and nobody owns the neutral layer underneath.
- Platforms only connect allowlists: Gemini automates ~20 US apps, Claude has 15 consumer connectors, ChatGPT Health has a handful.
- Ninth Circuit, Aug 4 2026 (Amazon v. Perplexity): an agent acting from the user's own device is "a tool, not a person."

## Wedge (recommended): health and fitness logging
Biggest dark spots: Flo (~80M monthly users, nothing anywhere), MyFitnessPal (200M+, only ChatGPT Health), Strong/Fitbod/Ladder (sets and reps never leave the app), Garmin, Cal AI. Logged daily. Apple Health only carries summaries. Students read as a cheating tool (schools blocking Canvas tokens over AI); ordering is closing fast (Gemini, ChatGPT apps). Full map: `research/app-targets/`.

## Risks
- **Terms and account bans** (Cronometer's terms void your license for bypassing protections). Realistic downside for a user is a suspended account.
- **DMCA 1201:** never ship pinning or attestation bypass tools to users. Do reverse engineering in-house.
- **Server-side access** looks like Power Ventures (lost); device-side looks like Perplexity (won).
- **Apps fight back:** Doubao got 155 apps to opt out; Amazon, Delta, United, Chase, Match, Life360 already block agents. Skip hostile apps.
- **Breakage:** MyFitnessPal breaks about yearly; the community Cronometer MCP shipped 20 releases in 6 months. Self-repair is required.
- **Platform clocks:** Siri AI custom actions reach the App Store in spring 2027; Apple opening model delegation; Android AppFunctions opening to third parties; OpenAI Dots moving down from Pro.
- **Plaid's arc:** scraping, then banks fight back and charge, then official deals. Expect the same.

## Open calls
1. Demo app for the hackathon: A) MyFitnessPal web route, B) Strong on a cloud phone, C) both in one story (**recommended C**: A is the safety net, B proves the moat)
2. Pitch wedge: health and fitness (recommended), students, or everyday ordering
3. Which Canvas extension matt used (to build on instead of from zero)
