# Who's already building pieces of this (checked 2026-11-15)

Short version: the **wallet** (one MCP link that holds your connections) already exists. The **contents** (APIs for consumer apps that have none, especially phone-only apps) do not. That is the moat, same as Plaid: the bank picker screen was never the value, the 12k bank connections were.

## MCP wallets and hubs (aggregate existing MCPs)
| Product | What it is | Gap vs us |
|---|---|---|
| **MoChiPi** (Manufact, launched Aug 26 2026) | "Dead-simple MCP wallet. Connect once, use anywhere." One URL (`slug.mochipi.dev/mcp`), runs OAuth per service, merges tools into a namespaced list, routes calls. Works in ChatGPT, Claude, Cursor, OpenCode. | Only holds MCPs that already exist (Linear, Notion, Stripe). Web only, no phone app, builds no connectors. [site](https://mochipi.dev/), [launch post](https://manufact.com/blog/mochipi) |
| **Composio Rube** | One endpoint (`rube.app/mcp`) to 500-600+ apps across Claude, ChatGPT, Cursor. | Mostly work SaaS (Gmail, Slack, Notion); review says quality drops outside popular apps. [blog](https://composio.dev/blog/rube-mcp-solving-context-overload), [review](https://dev.to/grove_chatforest/composio-mcp-server-500-app-integrations-through-a-single-endpoint-1po4) |
| **Executor** (executor.sh, YC S26, solo founder, MIT) | Open-source tool gateway: credential vault, fixed tool surface (search/execute, code mode), approvals as code, agent-written TypeScript "apps" on workerd. ~4.45k stars. | Developer tool, no consumer or mobile client. Does not engineer APIs; "your agent writes the app" from public docs. Could be our backbone. See `notes/executor-sh.md`. |
| Personal Hub, AppContext, MCP Depot | Personal / self-hosted MCP hubs. | Dev or self-hosted. [Personal Hub](https://www.personalhub.io/docs/mcp), [AppContext](https://appcontext.dev/docs/mcp-hub/), [MCP Depot](https://mcp-depot.com/) |

## "Plaid for agents" (log into accounts without APIs)
| Product | What it is | Gap vs us |
|---|---|---|
| **Deck** ($12M, Apr 2025) | "Plaid-ify any website": browser agents log in, extract, then generate scripts so the connection runs without AI. | B2B, websites (utilities, payroll, gov). Not consumer, not mobile. [TechCrunch](https://techcrunch.com/2025/04/16/deck-raises-12m-to-plaid-ify-any-website-using-ai/) |
| **Anon** (2023) | Auth layer for agents; Link SDK collects and validates user credentials (MFA, SSO, CAPTCHA). Literally a Plaid Link for agents. | B2B developer platform. [TechCrunch](https://techcrunch.com/2024/04/24/anon-is-building-an-automated-authentication-layer-for-the-gen-ai-age) |
| Plaidify (open source, HN Mar 2026) | REST API for login-protected sites. | Small project. |
| Integuru, Unbrowse, reverse-api-engineer | Turn captured traffic (HAR) into a client. Unbrowse: ~950 ms per call vs ~3.4 s Playwright, shared route graph. | Tools, not a consumer product. These are the derivation layer we'd build on. |

## Personal context across assistants
- **AI Passport** (Egoist Machines, YC S26, $3M seed, Oct 2026): portable memory/profile across ChatGPT, Claude, Gemini, Perplexity. Memory, not app actions. [pulse2](https://pulse2.com/egoist-machines-raises-3-million-seed-round-and-launches-ai-passport/)
- **Hello Haven** ($15M pre-seed): durable layer = user's memory and permissions above whichever model. (see `notes/landscape.md`)

## Phone data into MCP (single vertical)
- **Wellness Project, Fulcra:** iPhone app reads HealthKit, uploads, exposes cloud MCP to Claude/ChatGPT. Health only. [Wellness Project](https://wellnessproject.ai/integrations/apple-health-mcp)
- iphone-use, Icemoon: drive a real iPhone from a Mac over USB/Wi-Fi. Dev tools.

## Subscription unifiers (we chose NOT to do this)
- **T3 Code** (Theo, MIT, 20k+ stars Aug 2026): GUI that runs coding agents you already pay for (Claude Code, Codex, Grok, OpenCode). No model of its own. Works because coding agents are CLIs; consumer chat subscriptions (ChatGPT Plus, SuperGrok, Muse) have no sanctioned way to be driven by a third-party app. [flaviocopes](https://flaviocopes.com/t3-code)
- Decision: unify the **apps**, plug into every assistant via MCP. Same "use what they already pay for" trick, aimed at apps.

## Assistants that accept custom MCP connectors (2026)
| Assistant | Custom MCP | Notes |
|---|---|---|
| Claude | all plans (limits by plan; Free may get 1) | 15 consumer connectors (Apr 2026), mobile beta |
| ChatGPT | Developer Mode, paid | one source: Pro read-only, Business/Enterprise read+write (conflicting). Connectors sometimes vanish from the list |
| Grok | paid plans, remote servers | web, iOS, Android (per one source) |
| Meta Muse | launched Sep 8 2026; developer connectors opened Sep 18 via muse.ai/platform | review process unclear |
| Perplexity | Pro and Max (Mar 2026) | |
| Gemini app | unconfirmed for consumers | |
| Copilot consumer | no | |

Sources: [calmara](https://calmara.app/mcp-compatibility), [Grok connectors](https://skillsplayground.com/integrations/grok/), [Muse devs](https://runtimewire.com/article/meta-opens-muse-connectors-developers), [Muse custom integrations](https://parallel.ai/articles/meta-muse-custom-integrations)

## MCP primitives for the Plaid-style connect pop-up
- **URL-mode elicitation** (MCP spec): server sends the user to an external URL for auth/payment that must not pass through the client. Exactly the "connect your app" moment. Confirmed in Claude Code CLI, Codex, VS Code; **not confirmed in Claude/ChatGPT apps or mobile**. [spec](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation), [WorkOS](https://workos.com/blog/mcp-url-mode-elicitation)
- **MCP Apps** (official extension): interactive UI cards inside chat. Claude since Jan 26 2026, ChatGPT that week. One source says Claude's is web/desktop only. [alpic](https://alpic.ai/blog/mcp-apps-goes-official-claude-chatgpt-support)
- **Fallback that works everywhere:** tool returns a "tap to connect" link that opens our phone app, connect, bounce back.

## Cloud phones (Android emulators in the cloud)
| Vendor | Notes |
|---|---|
| **Revyl** (hackathon sponsor) | Cloud iOS sims + Android emulators. CLI + MCP (`start_device_session`, `install_app` from URL artifact, `device_instruction` natural-language step, `device_extract` pull data off screen, tap/type/swipe/screenshot, `launch_app`, `get_session_info` viewer URL). Live interactive iframe embed (390x740; ends after 3 min idle or 10 min active, 50 embeds per app). Captures network requests (method, status, URL; bodies/HTTPS not documented). No device SDK. [docs](https://docs.revyl.com/), [MCP tools](https://docs.revyl.com/reference/mcp-tools.md), [embed](https://docs.revyl.com/devices/embed.md) |
| Limrun (YC P26) | Cloud iOS/Android sims for agents; customers Replit, Rork, Momentic. [YC](https://www.ycombinator.com/companies/limrun) |
| Genymotion SaaS | Android 6-15 virtual devices on AWS/GCP/Alibaba, ADB + HTTP API. Testing/CI. |
| FoxPhone (Oct 2026) | Cloud Android phones for agents, per-device fingerprint and IP. |
| DIY | Cuttlefish on GCE, redroid, docker-android on bare metal (needs KVM). |

Why cloud phones matter: Play's accessibility ban covers apps on the user's phone, not an emulator we run. iPhone users' phone-only apps can run there too. A rooted emulator + our CA + Frida lets us watch traffic and map the API while the agent taps. Catches: Play Integrity (emulators fail device integrity), getting APKs, one-time login via streamed screen, cost per user, and server-side access is the riskier side of the Perplexity ruling.

## Consumer agent graveyard / lessons (see `notes/landscape.md`)
- Poke: hundreds of thousands of users, 100M messages, sold to Cognition; "expensive to run, which made it hard to turn a profit."
- Humane sold to HP for $116M. Rabbit pivoted to OS3 cloud agent over iMessage/Telegram.
- ByteDance Doubao phone agent: WeChat, Alipay, Taobao blocked it within days; 155 apps opted out by Oct 14 2026.
- Plaid itself: started by logging into banks with users' passwords and scraping, banks fought back and charged for access, then official data deals.
