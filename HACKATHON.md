# YC consumer mobile hackathon (Nov 15, 2026)

180 builders at the YC office, consumer mobile apps in one day. Build an app someone would open again tomorrow; it must run on a real device for the live demo (App Store not required).

## Schedule
| Time | |
|---|---|
| 8:00 AM | Doors open |
| 9:00 AM | Kickoff, lightning talks, tracks announced |
| 10:00 AM | Hacking begins |
| 12:30 PM | Lunch |
| 6:30 PM | Submissions due (vibeapps.dev, demo video + public repo required) |
| 7:00 PM | Finalist demos |
| 8:00 PM | Winners |

## Rules
- Teams of up to 3, solo welcome
- **All code written after 10:00 AM.** Come with ideas, not code. (This repo is research and docs only until then.)
- **Must use Capy, Revyl and Convex**

## Prizes
1st: YC interview + iPhone 18 Pro each. 2nd: MacBook Neo each. 3rd: Apple Watch each. Track prizes at kickoff.

## Sponsors and how each fits
| Sponsor | What it is | Our use |
|---|---|---|
| **Revyl** | Cloud iOS sims + Android emulators, CLI + MCP, live embed | The cloud phones that run phone-only apps (Strong). Embed the live phone in our app so the user watches the agent work |
| **Convex** | Reactive backend | Connected apps, tool maps, activity feed; streams the agent's actions live to the phone |
| **Capy** | AI software engineer, parallel cloud agents | Build connectors in parallel during the day |
| Supermemory | Memory engine for agents | Optional: remember habits across apps |
| Candle | YC consumer app, 1M+ users, on the floor | Ask about retention |
| Whop | Business API | n/a |

## Free credits and setup (from consumermobilehackathon.com, no money spent)
| Sponsor | Perk | How to claim |
|---|---|---|
| Capy | 1 free month of Capy Max ($200), sent to your **registration email** | Sign in with that email. Connect GitHub ("Only select repositories", this repo). Project env var `CONVEX_DEPLOY_KEY`. Questions: #capy |
| Revyl | Free via Capy (Capy links Revyl on first use). CLI free plan: 1,200 device min/mo, 2 devices | Existing Revyl account: approve in Capy, Settings → Integrations → Revyl. CLI: `curl -fsSL https://revyl.com/install.sh \| sh`, `revyl auth login` |
| Convex | Free plan (1M calls/mo). Nothing to claim | Project → Development deployment → Settings → Generate deploy key (Select all) → into Capy |
| Keiki | Build credits + shared iMessage line, no card | https://onkeiki.com/signup?code=KEIKI-CAPY-YC (needs phone). Setup prompt: https://onkeiki.com/setup.md. Dedicated line and API gateway cost money: skip |
| Whop | Sandbox, free | https://sandbox.whop.com, Admin API key, webhook `<convex .site URL>/whop` on payment_succeeded. Capy env: `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `WHOP_ENVIRONMENT=sandbox` |
| OpenAI | $100 API credits | Personal one-time link handed out at kickoff (platform.openai.com/p/...) |
| Supermemory | 1 month Pro with code `CAPYSM` | Pro checkout + code drops to $0. Skipped unless it works with no card |

Discord: https://discord.gg/RfTHVTVFX (sponsor channels: #capy #revyl #convex #keiki #whop #supermemory, else #general). Submit: https://vibeapps.dev/judging/consumer-mobile-hackathon/submit

Revyl MCP tools worth knowing: `start_device_session`, `install_app` (URL artifact), `launch_app`, `device_instruction` (one plain-English step), `device_extract` (pull data off the screen), `device_tap/type/swipe`, `screenshot`, `get_session_info` (viewer URL). Embed sessions end after 3 min idle or 10 min active. Network capture shows method, status, URL.

## Judging lens and our answer
Judges score "would you open it again tomorrow." Our answer is the Plaid one: **you use it every day without opening it.** The phone app is the connect screen plus the wallet (connected apps, feed of what agents did, approvals) plus a morning brief across your apps.

Expect the question "isn't this MoChiPi?" The demo answers it: connect an app with **zero API** live.

## Demo (recommended: option C)
1. In Claude on the phone: "log my breakfast." Our connect screen pops, log into MyFitnessPal, entry shows up (web route, reliable)
2. "Log push day, bench 185 for 5x5." A live Revyl phone opens Strong and taps it in, embedded in our app (the moment people remember)
3. Switch to ChatGPT: "what did I eat and lift today?" Already connected, works with no setup
4. Our app's feed shows every action, with an approve tap on writes

## 8-hour scope
- Expo app on matt's phone: connect flow, wallet, feed, approvals, morning brief
- Remote MCP server (one link per user) with the connect prompt
- MyFitnessPal via web session (build first, done by ~2pm)
- Strong on Revyl via `device_instruction` / `device_extract` (after)
- Canvas via official token for the morning brief (if the school allows tokens)
- Stretch: web traffic capture compiled into tools

## Before 10am (checks only, no code)
- [ ] Revyl account + API key; confirm `install_app` takes a third-party APK URL and the app (Strong, MyFitnessPal) runs and logs in on the emulator
- [ ] Check whether MCP URL elicitation or MCP Apps cards work in Claude and ChatGPT **mobile** using an existing public sample server; if not, use the "tap to connect" deep-link fallback
- [ ] Canvas personal access token from school (some schools block them)
- [ ] Convex and Capy accounts
- [ ] Demo script and the one-line pitch

## Risks on the day
- Emulator detection (Play Integrity) could stop an app from running or logging in
- Agent taps are slow (~15 s per step on real apps) and flaky; keep MyFitnessPal as the safety net
- Mobile assistant apps may not render the connect pop-up; deep-link fallback
- ChatGPT consumer custom connectors may be read-only (sources conflict); demo writes in Claude
