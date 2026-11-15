# Competitive landscape: consumer "connect any app to your AI" products, mobile focus (as of 2026-11-15)

Notes on sourcing: every fact below carries a link. Where the only source is an aggregator or low-quality site it is flagged "(weak source)". Numbers are dated; anything older than ~6 months is flagged "STALE". Today is 2026-11-15.

## 1. Platform owners: what they connect to today and how

### Takeaway
In 2026 every major platform shipped some version of "AI acts across your apps", but each is walled: Google does it natively on Android with screen automation on a short app allowlist plus an on-device MCP API (AppFunctions) still in preview; Apple rebuilt Siri on Gemini with app actions via developer annotations, but kept third-party AI "Extensions" switched off; OpenAI, Anthropic and Microsoft connect via first-party connector/plugin directories built on MCP, mostly to cloud accounts (email, calendar, commerce), not to on-phone app state. None offers a neutral, cross-OS, user-controlled "connect anything on my phone" layer.

### Cited Findings

**Google / Android (Gemini)**
- Feb 25, 2026: Gemini "screen automation" launched in beta, U.S. and Korea only, on Pixel 10/10 Pro and Galaxy S26. U.S. apps: DoorDash, Grubhub, Instacart, Lyft, McDonald's, Starbucks, Uber, Uber Eats; Korea: Kaemin, Kakao T. Runs in a "secure, virtual window" with access only to limited apps; needs explicit user command; user can watch and stop it. TechCrunch notes "the types of things that Gemini can manage are still limited." ([TechCrunch](https://techcrunch.com/2026/02/25/gemini-can-now-automate-some-multi-step-tasks-on-android))
- Rollout followed S26 store release Mar 11, 2026, then Pixel 10; enabled under Gemini settings > Screen automation. ([9to5Google](https://9to5google.com/2026/03/12/gemini-android-app-automation-galaxy-s26-rollout/); [Android Central](https://www.androidcentral.com/phones/google-pixel/gemini-screen-automation-expands-to-pixel-10-series))
- Google I/O (May 2026): AppFunctions ("Android MCP") lets an app act as an on-device MCP server exposing tools/data to the system and agents; platform API + Jetpack library in **experimental preview**. Google also shipped a skill to generate AppFunctions, a test agent, Gemini Nano 4 preview, and an ADK for Android for multi-agent workflows. Google states the OS "already enables agents like Gemini to complete task automation, where it can navigate an app on the user's behalf." ([Android Developers blog](https://developer.android.com/blog/posts/top-ai-on-android-updates-for-building-intelligent-experiences-from-google-i-o-26))

**Apple (Siri / Apple Intelligence)**
- The Gemini-powered Siri features (personal context, in-app actions) slipped past iOS 26.4 (planned March 2026) after testing problems; Gurman later pointed to iOS 27. ([9to5Mac](https://9to5mac.com/2026/02/11/apple-reportedly-pushing-back-gemini-powered-siri-features-beyond-ios-26-4); [iGeeksBlog](https://www.igeeksblog.com/apple-delays-gemini-powered-siri-features-ios-26-4-ios-27/))
- WWDC Jun 8, 2026: Apple unveiled "Siri AI" (standalone Siri app, personal context, three-tier privacy). Powered by a custom ~1.2T-parameter Gemini model in Google Cloud under a ~$1B/yr deal. Gurman's hands-on: functional but buggy, about where leading chatbots were six months earlier; Federighi called the agent-like features "experimental." ([The Next Web](https://thenextweb.com/news/apple-siri-extensions-third-party-ai-missing-wwdc))
- An "Extensions" framework in the iOS 27 beta would let users pick ChatGPT, Claude or Gemini for Siri; settings panel and App Store section are built but toggled off (per Bloomberg). Apple discussed entitlements with OpenAI, Anthropic, Google. Not announced, reportedly due to EU DMA (EU rejected Apple's "Trusted System Agent" proposal; Siri AI not launching in EU), possible OpenAI legal action, and messaging. ([The Next Web](https://thenextweb.com/news/apple-siri-extensions-third-party-ai-missing-wwdc))
- Siri AI "offers systemwide app actions" across multiple apps; not available in China. ([HotHardware](https://hothardware.com/news/apple-unveils-siri-ai-wwdc-2026))
- MacStories iOS 27 review: third-party apps embed invisible annotations so Siri gets structured entities instead of OCR; effectiveness "will depend on how well third-party developers support it." Personal context is the weak point: "I've frequently run into scenarios where a question I knew had data to back it up in iMessage couldn't be answered by Siri AI at all." ([MacStories](https://www.macstories.net/stories/ios-and-ipados-27-review/6/))
- Developer blogs claim SiriKit is deprecated in Xcode 27 and App Intents is the only path for Siri to call third-party apps; one claims MCP support (first seen in Xcode 26.3) extends across iOS 27. (weak sources, not confirmed against Apple docs) ([stork.ai](https://stork.ai/blog/wwdc-2026-graded-what-apple-shipped-ios-27); [dev.to](https://dev.to/malik_chohra/wwdc-2026-app-intents-foundation-models-and-what-rn-devs-should-ship-3o8a))

**OpenAI (ChatGPT, apps/plugins, Dots, device)**
- App Directory + Apps SDK (built on MCP) opened Dec 17, 2025; third-party submissions reviewed, rollout from early 2026. ([VentureBeat](https://venturebeat.com/technology/openai-now-accepting-chatgpt-app-submissions-from-third-party-devs-launches))
- Commerce apps differ in depth: Instacart allows checkout inside ChatGPT, DoorDash hands purchase off to its own app (Dec 2025). ([Digital Commerce 360](https://www.digitalcommerce360.com/2025/12/19/doordash-app-openai-chatgpt/)) Uber/Uber Eats in ChatGPT show options, payment completes in Uber's apps (Apr 2026). ([TechCrunch](https://techcrunch.com/2026/04/06/how-to-use-chatgpt-apps-doordash-spotify-uber))
- DevDay Sep 29, 2026: launched **Dots**, "always-on agents" each with its own cloud computer and browser, on GPT-6 Astra, connecting to **4,000+ apps**, reachable in ChatGPT, by voice call, Slack, Teams, with texting "coming soon." Sensitive tasks (e.g., password changes) stay with the human. First dot included only with Pro and Business Premium; Free and Plus excluded. Apps renamed "plugins," available on all plans with a redesigned directory. OpenAI says ChatGPT has **1.2B weekly users**. "Sign in with ChatGPT" lets users spend their ChatGPT plan allowance in 16 partner tools including Devin, Notion, Vercel and OpenClaw. A $500/mo "Pro 500" plan was added; computer use added to the Agents API. ([Decrypt](https://decrypt.co/379584/openai-ai-agents-computers-devday-2026-everything-announced); [Axios](https://www.axios.com/2026/09/29/openai-dev-day-2026-dots-space-sol))
- Feb 2026: OpenAI hired OpenClaw creator Peter Steinberger to lead personal-agent work; OpenClaw to become a foundation OpenAI supports. ([Computerworld](https://www.computerworld.com/article/4132725/openai-hires-openclaw-founder-as-ai-agent-race-intensifies.html); [Business Today](https://www.businesstoday.in/technology/news/story/openai-ropes-in-openclaw-creator-peter-steinberger-to-lead-personal-agent-push-516333-2026-02-16))
- io device (Jony Ive): OpenAI said in Jan 2026 it was on track to unveil in H2 2026 ([Axios](https://axios.com/2026/01/19/openai-device-2026-lehane-jony-ive)); court filings in the iyO trademark case (Feb 2026) say it will not ship to customers until 2027. ([MacRumors](https://www.macrumors.com/2026/02/10/openais-jony-ive-designed-device-delayed-to-2027/))

**Anthropic (Claude)**
- Apr 23, 2026: 15 consumer connectors (AllTrails, Audible, Booking.com, Instacart, Credit Karma, TurboTax, Resy, Spotify, StubHub, Taskrabbit, Thumbtack, Tripadvisor, Uber, Uber Eats, Viator); directory "over 200 connectors" since July 2025; available on all plans; **mobile in beta**; asks confirmation before booking/buying; no paid placements. ([Claude blog](https://claude.com/blog/connectors-for-everyday-life))
- Jan 2026: Apple Health (iOS) and Health Connect (Android) integrations in beta, U.S.-only, Pro/Max plans. ([MacTrast](https://www.mactrast.com/2026/01/claude-ai-iphone-app-gains-apple-health-integration-in-the-us/); [Claude support](https://support.claude.com/en/articles/11869619-using-claude-with-ios-apps))
- Claude iOS works with system apps (Mail, Calendar, Reminders) and compatible third-party apps, with per-feature permission. ([Claude support](https://support.claude.com/en/articles/11869619-using-claude-with-ios-apps)) Interactive (rendered) connectors reached iOS/Android Mar 25, 2026. (weak source) ([Buttondown](https://buttondown.com/verified/archive/anthropics-interactive-connectors-hit-claude))

**Microsoft (Copilot consumer)**
- Consumer connectors: OneDrive, Outlook.com, Google Drive, Gmail, Google Calendar, Google Contacts; available on Copilot.com and Copilot mobile (iOS/Android); opt-in per conversation. ([Microsoft Support](https://support.microsoft.com/microsoft-copilot/connecting-microsoft-copilot-to-other-services); [Windows Central](https://www.windowscentral.com/artificial-intelligence/microsoft-copilot/microsoft-copilot-can-now-create-office-365-docs-and-sync-with-gmail-making-it-a-true-windows-11-productivity-hub))
- Copilot Actions (booking hotels, filling forms in browser) described as U.S.-only. (weak source, undated) ([MobileSyrup](https://mobilesyrup.com/2025/10/16/microsoft-copilot-ai-updates/))

**Meta**
- Dec 2025: Meta bought Manus (general agent) for reportedly >$2B; Manus had reportedly passed $100M ARR ~8 months after launch; Meta plans to fold it into Meta AI. ([TechRadar](https://www.techradar.com/pro/meta-buys-manus-for-usd2-billion-to-power-high-stakes-ai-agent-race))
- Dec 2025: Meta acquired Limitless (pendant), wound down hardware sales, team into Reality Labs. ([Sacra](https://sacra.com/research/why-meta-bought-limitless/))
- Oct 2026: Amazon blocks Meta's "Muse" shopping agent; Meta instead partnered with Walmart, Gap, Sephora, Best Buy so Muse can shop there. ([The Verge via Slashdot](https://tech.slashdot.org/story/26/10/18/1715218/); [Search Engine Journal](https://searchenginejournal.com/amazon-blocked-metas-muse-and-robots-txt-had-nothing-to-say/590494))

**Samsung / Perplexity**
- Feb 26, 2026 (Perplexity's own claim): Perplexity APIs power search/reasoning for Bixby on Galaxy S26; Perplexity app preinstalled; Samsung Browser to get Comet-style agentic browsing. On Galaxy, Gemini still takes precedence over Bixby. ([Perplexity blog](https://hub-prod.perplexity.ai/hub/blog/perplexity-apis-deliver-powerful-ai-to-the-world’s-largest-android-device-maker); [Android Authority](https://www.androidauthority.com/galaxy-s26-gemini-bixby-3618888/))
- Comet browser: Android Nov 20, 2025; iOS Mar 18, 2026. ([TechCrunch](https://www.techcrunch.com/2025/11/20/perplexity-brings-its-ai-browser-comet-to-android/); [MacRumors](https://www.macrumors.com/2026/03/18/perplexity-comet-browser-iphone/))

### Inferences
- Platform owners split into two mechanisms: (a) OS-level control of on-device apps (Google screen automation, Apple app actions, Honor/Doubao in China), which only the OS owner can do well and only on a curated allowlist; and (b) cloud connector directories over MCP/OAuth (OpenAI, Anthropic, Microsoft), which work cross-OS but only reach apps that have a public API and a deal/listing.
- Both mechanisms are partner-gated. Gemini's list is 8 U.S. apps; Claude's consumer list is 15; ChatGPT's commerce apps often hand off payment. The "connect ANY app" promise is unmet by everyone.
- Apple is the most locked platform: third-party apps cannot drive other apps on iOS, and Apple has built but withheld a mechanism for even ChatGPT/Claude/Gemini to plug into Siri. Any iOS entrant depends on cloud APIs, Shortcuts/App Intents exposed by each app, or messaging channels.
- OpenAI Dots (4,000+ apps, always-on, own cloud computer) is the closest thing to a consumer "everything agent," but is gated behind Pro/Business Premium, which signals compute cost per user is high.

### Gaps
- Could not confirm from Apple docs whether iOS 27 exposes MCP or a system-wide agent API to third parties, or whether Extensions shipped in iOS 27.x by November.
- No primary figure for number of ChatGPT plugins/apps in the directory, or mobile usage of connectors on any platform.
- Did not verify whether Gemini screen automation expanded beyond the launch app list or devices after March 2026, or Gemini desktop "agent mode" status.
- Microsoft Copilot mobile "Actions" scope in 2026 unconfirmed.
- ChatGPT Health (Jan 2026, with Apple Health and fitness/nutrition app integrations) was not verified in this session.

## 2. Hardware and agent-first attempts: how far they got and what they learned

### Takeaway
Standalone AI hardware that "uses your apps for you" failed on retention and reliability (Humane dead, Rabbit pivoted to a cloud agent OS, Limitless absorbed by Meta, Friend tiny), and China's Doubao phone proved the harder lesson: an agent that impersonates a human tapping through apps gets blocked by the apps within days. The survivors moved toward software agents reached through existing channels (messaging, desktop) or OS-level deals with app owners.

### Cited Findings

**Rabbit r1 / LAM**
- STALE (Sep 2024): founder said ~5,000 people used r1 daily against ~100,000 units sold; later corrected to "concurrent" users. ([9to5Google](https://9to5google.com/2024/09/26/rabbit-5000-people-use-the-r1-daily/); [The Verge mirror](https://thevergenews.pages.dev/2024/9/25/24254253/rabbit-r1-5000-daily-users-ai-gadget)) Forbes estimate ~130,000 units sold by June 2024. ([Laptop Mag](https://www.laptopmag.com/ai/rabbit-r1-2024-ai-year-in-review))
- Jan 2026: Rabbit shipped DLAM (r1 controls a Windows/Mac computer by voice) and OpenClaw integration. ([Rabbit blog](https://www.rabbit.tech/blog/first-major-update-of-2026-dlam-openclaw-and-a-surprise))
- Sep 22-23, 2026: Rabbit launched **OS3**, a cloud agent "OS" that operates up to five of the user's computers through a local agent; reachable via web, Telegram, iMessage, RCS/SMS or r1; r1 not required; users bring their own model API keys; sensitive actions need confirmation; skills added by pasting a URL. No mention of controlling phone apps. ([Help Net Security](https://www.helpnetsecurity.com/?p=385383); [TechSpot](https://www.techspot.com/news/113954-rabbit-launches-os3-agentic-ai-platform-desktop-telegram.html))
- CEO Jesse Lyu told Wired the company secured more funding (amount undisclosed). (via search summary of TechSpot/Wired; not directly read)
- Aug 2026 review: r1 "still is not the app-driving AI agent the 2024 launch demo showed," app coverage narrow, latency slow. (weak source) ([Layer3 Labs](https://www.layer3labs.io/gear/reviews/rabbit-r1))

**Humane AI Pin**
- Feb 2025: HP bought Humane's software, IP and team for ~$116M; AI Pin cloud features shut off; refunds only within 90 days. ([The Decoder](https://the-decoder.com/humane-ends-its-ai-pin-in-ten-days-sells-technology-to-hp-for-116-million/); [Android Central](https://www.androidcentral.com/apps-software/humane-announces-its-departure-from-the-ai-scene-hp-acquires-it-for-usd116-million))
- Returns reportedly outpaced sales. ([Yahoo Tech](https://tech.yahoo.com/ai/articles/status-major-ai-gadgets-released-132118274.html))

**Friend, Limitless**
- STALE: Friend had ~$348K in sales as of Sep 2025 and was shifting from pendant to web chatbot; Limitless acquired by Meta Dec 2025 with hardware sales wound down. Sacra argues pendant experiences will be absorbed into glasses/earbuds. ([Sacra](https://sacra.com/research/why-meta-bought-limitless/)) (Friend figure came via search summary attributed to Sacra; exact page not read.)

**Nothing**
- Sep 2025: raised $200M Series C to build an "AI-native OS"; launched "Essential" (Essential Apps, Playground for prompt-built widgets) as the first step. ([9to5Google](https://9to5google.com/2025/09/16/nothing-will-make-its-own-os-for-phones-and-beyond-first-ai-native-devices-in-2026/); [CO/AI](https://getcoai.com/news/nothing-raises-200m-to-build-ai-native-os-for-smartphones/))
- Feb 2026, Carl Pei: "everybody will have their own personalised operating system." ([Business Today](https://www.businesstoday.in/technology/news/story/everybody-will-have-their-own-personalised-operating-system-says-nothing-ceo-carl-pei-514804-2026-02-05)) No confirmation found that a true AI-native device has shipped as of Nov 2026.

**ByteDance Doubao phone assistant (China)**
- Dec 1, 2025: technical preview on ZTE nubia M153; the assistant uses system-level permissions (INJECT_EVENTS) to simulate user taps. Within days WeChat logged users out ("abnormal login environment"), Alipay flagged payment as risky, Taobao/Alibaba apps and several banks blocked it. ByteDance disabled WeChat control. WeChat said it took no specific action and routine risk controls triggered. ([Business Standard](https://www.business-standard.com/world-news/bytedance-ai-phone-doubao-nubia-zte-app-blocks-user-control-china-125120800459_1.html); [Yicai Global](https://www2.yicaiglobal.com/news/wechat-some-chinese-banking-apps-reportedly-restrict-devices-with-bytedances-new-ai-voice-assistant); [Lawfare](https://www.lawfaremedia.org/article/china-s-agentic-ai-controversy))
- Reports range from 8 of 23 mainstream apps failing to ~150 apps refusing the assistant (counts conflict). ([Sixth Tone](https://www.sixthtone.com/news/1019137/Over%20150%20Chinese%20Apps%20Deny%20AI%20Assistant%E2%80%99s%20Use%20on%20Smartphone))
- WeChat reportedly working with phone makers on a structured agent-to-agent alternative where the OEM assistant sends structured instructions to WeChat rather than driving its UI. ([Jeff Xiong Substack](https://jeffxiong.substack.com/p/when-ai-wants-to-be-your-new-portal)) (analysis, not confirmed by Tencent)
- Sep 30, 2026: Doubao reportedly preparing a general personal agent codenamed "Spell," tested since April; consumer version of phone assistant followed in September; talks with OEMs including vivo. ([TechNode](https://technode.com/2026/09/30/bytedances-doubao-reportedly-preparing-personal-ai-agent-codenamed-spell-and-tested-since-april/))

**Honor / Xiaomi / Alibaba**
- Honor YOYO agent (co-developed with Alibaba) on MagicOS 10 phones; reported 3,000+ automatic-execution scenarios on an MCP-based architecture; multi-app, highly specific tasks may stall; payments still need user confirmation. ([Computerworld](https://www.computerworld.com/article/4203560/how-ai-in-china-is-killing-smartphone-apps.html); [FoneArena](https://www.fonearena.com/blog/?p=464171)) (detail attributions came via search summary)
- Xiaomi began limited test of "miclaw" agent Mar 6, 2026 on its MiMo model amid an "OpenClaw craze" in China. ([Caixin](https://www.caixinglobal.com/2026-03-12/xiaomi-huawei-rush-to-deploy-ai-agents-amid-openclaw-craze-102422164.html))

**Adept (STALE, 2024)**
- Jun 2024: Amazon hired Adept's CEO David Luan and co-founders and took a non-exclusive license to Adept's agent tech, models and datasets; Adept said building its own models needed too much capital. ([TechCrunch](https://techcrunch.com/2024/06/28/amazon-hires-founders-away-from-ai-startup-adept))

### Inferences
- Lesson 1: Dedicated hardware adds friction without adding capability; every agent device either died or re-platformed onto channels people already use (Rabbit OS3 on iMessage/Telegram, Friend to web).
- Lesson 2: UI-impersonation agents ("press the buttons like a human") trip anti-fraud systems in exactly the high-value apps (messaging, payments, shopping). Doubao's failure maps directly onto Amazon v. Perplexity and the Oct 2026 bank/airline blocks in the U.S.
- Lesson 3: China's OEMs are converging on MCP-style structured intents (Honor) and agent-to-agent deals (WeChat), the same direction as Google AppFunctions. Sanctioned, structured interfaces beat screen scraping on durability.
- Rabbit's own trajectory (r1 handheld to LAM web playground to desktop DLAM to cloud OS3 with BYO keys over iMessage) is a compressed version of the whole market's learning.

### Gaps
- Brain.ai "Natural AI" phone: found no 2026 information.
- No current (2026) r1 sales or active-user numbers; OS3 pricing unknown; Rabbit's 2026 funding amount unknown.
- Could not confirm whether WeChat/Alipay ever reinstated access for Doubao or signed a formal agent agreement.

## 3. Startups: who is building it, funding, users, pricing

### Takeaway
The consumer-facing "text your agent, it uses your accounts" startups proved engagement but not margins (Poke: hundreds of thousands of users, 100M messages per quarter, then sold to Cognition for low nine figures because it was expensive to run). Most money in 2025-26 went to the picks-and-shovels layer (Composio, Arcade, Gumloop, Pipedream to Workday, Manufact) and enterprise automation, not consumer. Mobile-control startups (DroidRun/Mobilerun, Minitap) pivoted to developer/enterprise testing. Open-source OpenClaw became the real consumer phenomenon and was effectively absorbed into OpenAI's orbit.

### Cited Findings

**Poke (The Interaction Company of California)**
- Seed $15M at $100M valuation led by General Catalyst (2025). ([Dealroom](https://dealroom.co/companies/poke/)) $10M co-led by Spark Capital and General Catalyst at $300M post, April 2026 (Dealroom dates it Jan 2026). ([Let's Data Science](https://letsdatascience.com/news/poke-raises-10m-values-company-at-300m-caa657f0))
- Jul 23-24, 2026: acquired by Cognition (Devin) at a "low nine figures" valuation. "Hundreds of thousands of people" use Poke; 100M+ messages exchanged in the prior three months; top uses are email, reminders, to-dos, plus travel, health, finance, scheduling, education. Channels: iMessage, SMS, Telegram, WhatsApp (some markets). First AI agent approved on Apple Messages for Business (June 2026). Co-founder Marvin von Hagen: Poke **was expensive to run, which made it hard to turn a profit**. Poke stays live; may use Cognition's SWE-1.7 model. ([TechCrunch](https://techcrunch.com/2026/07/24/why-cognition-bought-poke-ai-personality-is-becoming-a-competitive-advantage/))

**OpenClaw (open source, formerly Clawdbot/Moltbot)**
- Self-hosted personal agent reached via WhatsApp, Telegram, Discord, iMessage; became one of the most-starred GitHub projects (~373k stars May 2026, ~384k July 2026); ClawHub registry ~13,700 community skills (counts vary by source). WhatsApp/iMessage rely on unofficial libraries (iMessage via BlueBubbles on a Mac). (weak/aggregator sources) ([Neurohive](https://neurohive.io/en/guides/openclaw-the-lobster-that-took-over-the-world-how-one-developer-built-the-most-popular-open-source-ai-agent-in-history/); [Ry Walker research](https://rywalker.com/research/openclaw); [DEV](https://dev.to/jangwook_kim_e31e7291ad98/openclaw-self-hosted-ai-gateway-for-whatsapp-telegram-discord-5eco))
- Security: Gartner labeled it an "unacceptable cybersecurity risk"; ongoing vulnerabilities and misconfigurations; mitigation advice is to run it in a VM or a minimal-permission account. ([SecurityWeek](https://securityweek.com/openclaw-security-issues-continue-as-secureclaw-open-source-tool-debuts))
- Creator joined OpenAI Feb 2026; OpenClaw is a Sign in with ChatGPT partner as of Sep 2026. ([Computerworld](https://www.computerworld.com/article/4132725/openai-hires-openclaw-founder-as-ai-agent-race-intensifies.html); [Decrypt](https://decrypt.co/379584/openai-ai-agents-computers-devday-2026-everything-announced))
- Menlo's July 2026 survey: among agent users, Manus, OpenClaw and Hermes each reach 10 to 16%. ([Menlo Ventures](https://menlovc.com/perspective/2026-the-state-of-consumer-ai/))

**Lindy**
- Feb 6, 2026: launched "Lindy Assistant," a personal assistant run from iMessage. ([Lindy blog](https://www.lindy.ai/blog/lindy-assistant-launch)) Third-party pricing: Plus $49.99/mo, Pro $99.99/mo (3x usage, computer use), Max $199.99/mo; free plan removed for a 7-day trial. ([We Are Founders](https://www.wearefounders.uk/lindy-pricing-2026-every-plan-explained/)) Now pitched Slack-first to teams, still reachable via iMessage/RCS/SMS. ([Ry Walker research](https://rywalker.com/research/lindy)) Total funding ~$50M, figures conflict across aggregators. (weak sources)

**Martin (YC S23)** (STALE)
- $2M seed Jan 2025; assistant over SMS/call/WhatsApp/email/Slack for calendar, inbox, reminders, calls. Traction claims conflict (100K users and ~$1.2M ARR in 2024 vs 30K users). Founders reportedly pivoted to Letterbook (AI customer support) after high support volume for Martin. ([Extruct](https://www.extruct.ai/hub/trymartin-com-funding/); [YC](https://ycombinator.com/companies/martin); [YC Letterbook jobs](https://www.ycombinator.com/companies/letterbook/jobs/lmfkrj9-founding-ai-engineer)) (pivot detail from weak source)

**Integration / "action layer" infrastructure**
- Composio: $25M Series A led by Lightspeed (Jul 2025), $29M total; 200+ paying customers, >$1M ARR (STALE). Enterprise/developer positioning. ([Entrackr](https://entrackr.com/news/agentic-ai-startup-composio-raises-25-mn-led-by-lightspeed-9525112); [Composio](https://composio.dev/content/series-a))
- Arcade.dev: $12M seed (Mar 2025); $60M Series A led by SYN Ventures with Morgan Stanley and Wipro (Jun 16, 2026), $72M total; positioned as authorization/governance for production agents. ([Arcade](https://www.arcade.dev/blog/arcade-series-a/); [HPCwire/BigDATAwire](https://www.hpcwire.com/bigdatawire/this-just-in/arcade-secures-60m-to-scale-authorization-and-governance-for-ai-agents/))
- Gumloop: $50M Series B led by Benchmark, Mar 12, 2026; workplace agents. ([SiliconANGLE](https://siliconangle.com/2026/03/13/gumloop-reels-50m-ai-automation-platform/))
- Pipedream: Workday agreed to acquire (Nov 19, 2025), ~3,000 integrations; had raised ~$22.4M. ([SiliconANGLE](https://siliconangle.com/2025/11/19/workday-acquire-pipedream-extend-ai-agent-integrations-across-enterprise-apps/); [Techzine](https://www.techzine.eu/news/applications/136504/workday-acquires-pipedream-gaining-3000-integrations-with-it))
- Zapier MCP: available to all Zapier accounts; each MCP tool call consumes two tasks from plan quota. ([Zapier docs](https://docs.zapier.com/mcp/usage.md))
- Manufact (formerly mcp-use): $6.3M seed led by Peak XV, Feb 2026; MCP agent and ChatGPT-app infrastructure. ([Pulse 2.0](https://pulse2.com/manufact-6-3-million-seed-funding-raised-to-power-mcp-based-agents-and-chatgpt-apps))
- Desktop Commander (open-source MCP server): EUR 1.1M pre-seed, Oct 2025. ([Tech.eu](https://tech.eu/2025/10/28/desktop-commander-lands-eur11m-pre-seed-for-ai-desktop-automation/))

**Computer-use / mobile-control agents**
- Simular: $21.5M Series A led by Felicis (Dec 2025) after $5M seed. ([Simular](https://www.simular.ai/articles/simular-raises-21-5m-to-build-autonomous-computer-agents)) "Sai" agent GA Sep 2026 (search-summary claim, unverified).
- DroidRun (now "Mobilerun"): EUR 2.1M pre-seed led by Merantix Capital, Jul 2025; open-source framework for agents controlling Android/iOS apps; funds aimed at enterprise cloud platform. No 2026 round found. ([Tech.eu](https://tech.eu/2025/07/23/droidrun-raises-eur21m-pre-seed-to-scale-mobile-native-ai-agent-infrastructure/); [Distill](https://www.distillintelligence.com/news/mobilerun-1))
- Minitap (mobile-use): GBP 3M seed co-led by Moxxie Ventures and Mercuri (~Dec 2025) for agents operating virtual phones for **app development and testing**. ([StartupMag](https://www.startupmag.co.uk/funding/minitap-2025-seed-funding))
- MultiOn: status murky; reportedly folded into "AGI, Inc." under founder Div Garg; one source claims a Feb 2026 consumer extension with 500K downloads and an iOS product in preparation. (weak sources) ([AI Wiki](https://aiwiki.ai/wiki/agi_inc))

**Perplexity**
- Comet on Android and iOS (see section 1). Amazon v. Perplexity: Mar 6, 2026 preliminary injunction under the CFAA (Comet accessed password-protected accounts with user but not Amazon permission; ordered to stop and destroy data) ([eWeek](https://www.eweek.com/news/amazon-perplexity-comet-injunction/)); Ninth Circuit later reversed, saying liability would need "a novel interpretation far afield" of the anti-hacking law; ruling limited to the facts. ([MediaPost](https://www.mediapost.com/publications/article/417007/appeals-court-sides-against-amazon-lifts-perplexi.html))
- Menlo July 2026: Perplexity used by 24% of agent users. ([Menlo Ventures](https://menlovc.com/perspective/2026-the-state-of-consumer-ai/))

**2026 seed-stage "personal AI" entrants (closest to "personal MCP")**
- Hello Haven: $15M pre-seed led by Mayfield; thesis that the durable consumer layer is the user's memory and permissions sitting above whichever model does each task. ([Runtime Wire](https://runtimewire.com/article/frank-addante-hello-haven-15m-personal-ai-digital-twin))
- Tomo: $5M seed led by Bain Capital Ventures; a phone number you text for reminders, accountability, goals. ([Pulse 2.0](https://pulse2.com/tomo-raises-5-million-seed-round-led-by-bain-capital-ventures/))

### Inferences
- The proven consumer interface is messaging (iMessage/SMS/WhatsApp/Telegram): Poke, Lindy Assistant, Martin, Tomo, OpenClaw, Rabbit OS3, and OpenAI Dots ("texting coming soon") all converge there. It avoids app-store distribution and OS restrictions but is now crowded.
- Consumer agent startups exit by acquihire to model/platform companies (Poke to Cognition, Manus to Meta, Adept to Amazon, OpenClaw creator to OpenAI); none has shown durable standalone consumer economics.
- The integration layer (Composio, Arcade, Zapier MCP, Pipedream) is mostly sold to developers and enterprises; a consumer entrant can rent it rather than build 3,000 integrations.
- Mobile-UI-control startups found their paying market in QA/testing and enterprise automation, not consumers, which is itself a signal about consumer reliability and willingness to pay.

### Gaps
- "Dex" (as named in the brief) could not be identified; multiple products share the name. Needs the specific company.
- Composio's consumer product (Rube) usage, pricing and 2026 funding: nothing found.
- No 2026 YC batch company found explicitly pitching "personal MCP for consumers"; YC directory was not queried directly.
- Poke's pricing model and per-user cost not found in sources read.
- OpenClaw active-user count: no reliable figure (only stars, installs, site traffic).

## 4. Consumer demand signals: what people want AI to do across apps

### Takeaway
Stated willingness is high (70%+ in industry surveys) but actual delegation is still a minority (EY: ~10% have let an agent buy). The accounts people actually connect are email, browser, messaging, cloud storage, calendar, then health and finance. Real usage on Poke skews to email, reminders and to-dos. Health is the fastest-growing category; bill pay, staying in touch and healthcare navigation are low-penetration white spaces. Trust, not capability, is the binding constraint.

### Cited Findings
- Menlo Ventures / Morning Consult, 5,067 U.S. adults, July 2026: 64% of U.S. adults use AI, 25% daily; phone apps are the top surface (56% weekly). 72% of AI users know what agents are, 41% tried one, 24% use regularly; 32% have let AI act without final sign-off at least once. ([Menlo Ventures](https://menlovc.com/perspective/2026-the-state-of-consumer-ai/))
- Same survey, what agent users connect: email 36%, web browsers 33%, messaging apps 31%, cloud storage 29%, calendars 27%, health apps 23%, financial accounts 20%. ([Menlo Ventures](https://menlovc.com/perspective/2026-the-state-of-consumer-ai/))
- Same survey: health information use grew 14% to 25%; school/work assignments have 56% AI penetration among people doing them; low penetration in bill payment (23%), staying in touch (25%), healthcare navigation (23%); report says the barrier is trust "in money, institutions, personal data, and relationships, not capability." Among holdouts, 76% cite privacy and 70% distrust AI information. ([Menlo Ventures](https://menlovc.com/perspective/2026-the-state-of-consumer-ai/))
- Same survey, assistant share among AI users: ChatGPT 60%, Gemini 58%, Claude 20%; Siri fell 25% to 20%, Alexa 32% to 22%; average user uses 3.0 assistants. ([Menlo Ventures](https://menlovc.com/perspective/2026-the-state-of-consumer-ai/))
- Same survey, shopping: among AI-using shoppers, 50% use AI for price comparison, 26% have had AI complete a purchase. ([Menlo Ventures](https://menlovc.com/perspective/2026-the-state-of-consumer-ai/))
- Poke's most common uses: email, reminders, to-dos; also travel, health, finance, scheduling, education. ([TechCrunch](https://techcrunch.com/2026/07/24/why-cognition-bought-poke-ai-personality-is-becoming-a-competitive-advantage/))
- Accenture, 25,590 consumers in 16 countries (Jan 2026): 74% would let an AI agent handle routine tasks like deal negotiation, complaint resolution, subscription renewals, reorders; interest in agents that work across providers. ([Chain Store Age](https://chainstoreage.com/accenture-customers-trust-ai-agents-perform-these-tasks-them); [AI News](https://www.artificialintelligence-news.com/news/ai-shopping-agents-consumer-trust-accenture-report/))
- PYMNTS, 2,299 U.S. adults (reported Jan 2026): interest from 54% (school and parenting tasks) to 71% (health and wellness management); demand centers on recurring renewals, replenishment and payments; banks and digital wallets are most-trusted providers. ([PYMNTS](https://www.pymnts.com/?p=3358244); [PYMNTS 70% shopping](https://www.pymnts.com/artificial-intelligence-2/2026/70-percent-of-consumers-say-yes-to-ai-agents-for-shopping/))
- EY, 18,000+ people in 23 markets (2026): 10% have used AI agents to buy on their behalf; 11% let AI auto-refill carts or manage banking tasks; growth comes from familiarity with low-stakes tasks, not rising trust. ([CXM World](https://cxm.world/?p=141939))
- Platform choices as revealed demand: Gemini automation launched with food delivery, rideshare, coffee ([TechCrunch](https://techcrunch.com/2026/02/25/gemini-can-now-automate-some-multi-step-tasks-on-android)); Claude's consumer set is travel, dining, groceries, fitness (AllTrails), money (Credit Karma, TurboTax), music, home services ([Claude blog](https://claude.com/blog/connectors-for-everyday-life)); Claude added Apple Health / Health Connect ([MacTrast](https://www.mactrast.com/2026/01/claude-ai-iphone-app-gains-apple-health-integration-in-the-us/)).
- Students / Canvas: Instructure-OpenAI partnership (Jul 2025) embeds teacher-built AI assignments in Canvas, opt-in, institution-licensed. ([Axios](https://www.axios.com/2025/07/23/openai-chatgpt-schools-canvas-instructure)) Instructure's IgniteAI Agent uses Claude and MCP (Mar 2026). ([Constellation Research](https://www.constellationr.com/index%2Ephp/insights/news/instructure-launches-igniteai-agent-canvas-builds-amazon-bedrock)) No official public Canvas MCP server for students' personal agents; community MCP servers rely on personal API tokens, which some institutions disable. (vendor blog) ([Carly blog](https://www.usecarly.com/blog/claude-canvas-lms-integration/))

### Inferences
- Use cases that stuck: inbox/calendar triage, reminders, to-dos, research, shopping comparison, food/ride ordering on allowlisted apps, health data Q&A. Use cases that stalled: fully autonomous purchases and anything touching banks or payments (blocked or confirmation-gated everywhere).
- Students are a high-penetration group (56% for assignments) but Canvas access runs through institutions, not students, so a student-focused "connect Canvas" product depends on per-school token policies. That is a real wedge and a real fragility.
- Health/fitness/nutrition are where platforms are visibly investing (Claude health, Menlo's fastest-growing category), so sherlocking risk there is high.
- Budgeting/bill pay is a low-penetration, high-trust category; banks are blocking agents (see section 5), so read-only aggregation (e.g., via Credit Karma or Plaid-style permissions) is more viable than acting.

### Gaps
- Menlo reports a paying rate of 55% of AI users "up from 3%" per the fetched summary; this jump looks implausible versus 2025's ~3% and may reflect a definitional change. Verify against the PDF ([Menlo PDF](https://menlovc.com/wp-content/uploads/2026/09/menlo_ventures_consumer_ai_report-2026.pdf)) before quoting.
- No hard usage data found for fitness, nutrition (e.g., MyFitnessPal) or budgeting connectors specifically, or for student use of personal agents against Canvas.
- No retention or churn data for any consumer connector or agent product.

## 5. Business model and moat: pricing, unit economics, platform dependence, target-app pushback

### Takeaway
Agent compute is expensive enough that OpenAI gates Dots to its top tiers and Poke could not get to profit; the market answer is high-priced subs ($50 to $500/mo), bring-your-own-key, or borrowing the user's existing AI plan (Sign in with ChatGPT). The bigger existential risks are platform sherlocking (Google, Apple, OpenAI, Anthropic all shipped cross-app agents in 2026) and target apps blocking agents (Amazon, banks, airlines, Yelp in the U.S.; WeChat/Alipay in China). Legal ground for agents improved slightly with the Ninth Circuit's Perplexity reversal, but sites keep blocking via ToS and anti-bot tooling.

### Cited Findings

**Pricing and unit economics**
- Poke "was expensive to run, which made it hard to turn a profit." ([TechCrunch](https://techcrunch.com/2026/07/24/why-cognition-bought-poke-ai-personality-is-becoming-a-competitive-advantage/))
- OpenAI Dots included only in Pro and Business Premium; new Pro 500 plan at $500/mo; computer use in Codex/ChatGPT Work only on Pro 500 and Enterprise. ([Decrypt](https://decrypt.co/379584/openai-ai-agents-computers-devday-2026-everything-announced))
- Sign in with ChatGPT lets users spend their ChatGPT plan allowance in 16 partner tools (incl. OpenClaw, Devin, Notion) for Plus and Pro users, globally. ([Decrypt](https://decrypt.co/379584/openai-ai-agents-computers-devday-2026-everything-announced))
- Rabbit OS3: users bring their own model API keys. ([Help Net Security](https://www.helpnetsecurity.com/?p=385383))
- Lindy Assistant: $49.99 / $99.99 / $199.99 tiers, computer use only from Pro. (third-party) ([We Are Founders](https://www.wearefounders.uk/lindy-pricing-2026-every-plan-explained/))
- Zapier MCP: 2 tasks per tool call against plan quota. ([Zapier docs](https://docs.zapier.com/mcp/usage.md))
- Menlo July 2026: payers' pricing is 50% flat monthly, 26% annual, 17% usage-based; top 14% of payers (>$100/mo) are 60% of spend; typical payer $20 to $49/mo; 92% of agent users pay for AI; 21% of regular agent users pay $100+/mo. Global consumer AI spend ~$40B in 2026 vs $12B in 2025 (Menlo estimate). ([Menlo Ventures](https://menlovc.com/perspective/2026-the-state-of-consumer-ai/))
- Claude connectors are on all plans, including free; Claude stresses no paid placements in its directory. ([Claude blog](https://claude.com/blog/connectors-for-everyday-life))

**Platform dependence / sherlocking**
- Google ships native screen automation on Pixel/S26 and is standardizing AppFunctions as on-device MCP. ([TechCrunch](https://techcrunch.com/2026/02/25/gemini-can-now-automate-some-multi-step-tasks-on-android); [Android Developers blog](https://developer.android.com/blog/posts/top-ai-on-android-updates-for-building-intelligent-experiences-from-google-i-o-26))
- Apple built a third-party AI Extensions system but withheld it; EU rejected Apple's Trusted System Agent proposal. ([The Next Web](https://thenextweb.com/news/apple-siri-extensions-third-party-ai-missing-wwdc))
- OpenAI Dots connects to 4,000+ apps and ChatGPT has 1.2B weekly users. ([Decrypt](https://decrypt.co/379584/openai-ai-agents-computers-devday-2026-everything-announced))

**Target-app pushback**
- Amazon v. Perplexity: preliminary injunction Mar 6, 2026 under CFAA ([eWeek](https://www.eweek.com/news/amazon-perplexity-comet-injunction/)), reversed by the Ninth Circuit, which called CFAA liability "a novel interpretation far afield" of the law; limited to the case facts. ([MediaPost](https://www.mediapost.com/publications/article/417007/appeals-court-sides-against-amazon-lifts-perplexi.html))
- Oct 2026 (The Verge): users of Meta Muse, xAI Grok, OpenAI Dots and Instinct report blocks. Amazon says Muse's access violates site policies; Yelp only allows agents that pay for data licensing; Delta blocks agent bookings; JPMorgan Chase and Charles Schwab confirmed blocking agents from accounts (Bloomberg, Oct 16, 2026); Cars.com and Amtrak reportedly stopped working. Counter-moves: Shopify opened its storefront network to agents; Meta partnered with Walmart, Gap, Sephora, Best Buy. ([The Verge via Slashdot](https://tech.slashdot.org/story/26/10/18/1715218/))
- Agents reported failing on sites from Pizza Hut to Yelp; Amazon's block message cites its Conditions of Use. ([MIT Technology Review](https://technologyreview.com/2026/10/19/1147186/making-the-internet-better-for-ai-agents-might-make-it-worse-for-everyone-else); [Android Headlines](https://www.androidheadlines.com/2026/10/banks-retail-websites-block-ai-agents-promises.html))
- Study of 79,173 domains with ToS: 7,481 prohibit crawling; Cloudflare-hosted sites block AI agents at 11.3%, more than double baseline, due to a one-click toggle. (aggregator) ([AI Productivity](https://aiproductivity.ai/news/study-1m-domains-90-percent-no-ai-agent-policy/)) Cloudflare's customer AI-traffic controls. ([Cloudflare blog](https://blog.cloudflare.com/content-independence-day-ai-options/))
- China: WeChat/Alipay/Taobao/banks blocked Doubao's UI-driving assistant within days (section 2). ([Business Standard](https://www.business-standard.com/world-news/bytedance-ai-phone-doubao-nubia-zte-app-blocks-user-control-china-125120800459_1.html))
- Security drag: OpenClaw flagged by Gartner as "unacceptable cybersecurity risk." ([SecurityWeek](https://securityweek.com/openclaw-security-issues-continue-as-secureclaw-open-source-tool-debuts))

### Inferences
- Unit economics: always-on agents with their own cloud computer/browser cost real money per user; a consumer entrant charging $10 to $20/mo cannot run computer-use loops for every request. Cheapest viable path: structured API/MCP calls (cents) over screen automation (many model steps), plus pushing model cost to the user's existing plan (Sign in with ChatGPT, BYO key) or to an on-device model (Gemini Nano, Apple Foundation Models).
- Moat is not integrations (rentable from Composio/Arcade/Zapier/Pipedream) and not models. Candidate moats: (1) the user's cross-app memory and permission graph (Hello Haven's thesis), (2) a trusted brand in a vertical where platforms are timid (students, money), (3) sanctioned partnerships with target apps (the Meta-Walmart/Shopify pattern) instead of scraping.
- Sherlocking risk is highest for horizontal "connect your email/calendar/Uber" plays: ChatGPT, Claude, Gemini and Copilot all do this for free or within existing plans. Lowest for long-tail, institution-gated or locally-stored data (school LMS, on-device health/fitness logs, small regional apps) that platforms do not prioritize.
- Legal: the Ninth Circuit reversal lowers CFAA risk for user-authorized agents, but sites can still block via ToS, CAPTCHAs and account bans, so "works today" is not "works next month" for any scraping-based approach.

### Gaps
- No public per-task cost figures (dollars per agent action) for Dots, Gemini automation, Poke or Lindy.
- Exact date of the Ninth Circuit decision and whether Amazon sought en banc/Supreme Court review not found.
- No data on how many consumer apps expose MCP servers or AppFunctions today.

## 6. Where is the white space in Nov 2026, and what a new entrant must do differently

### Takeaway
The open gap is a neutral, cross-platform (iOS and Android) personal layer that connects the long tail of a person's apps through sanctioned interfaces (MCP servers, AppFunctions, App Intents, OAuth APIs, health stores) rather than screen scraping, runs on the user's existing AI plan or on-device models to escape inference costs, and owns the user's permission and memory graph. Horizontal "email + calendar + Uber" is already owned by ChatGPT/Claude/Gemini; the defensible openings are vertical (students, personal health/fitness/nutrition logs, household money) and structural (portable memory/permissions across assistants, messaging-first UX, works on iPhone where Apple will not let anyone else drive apps).

### Cited Findings
- Platforms connect only allowlisted partners: Gemini 8 U.S. apps ([TechCrunch](https://techcrunch.com/2026/02/25/gemini-can-now-automate-some-multi-step-tasks-on-android)); Claude 15 consumer apps among 200+ connectors ([Claude blog](https://claude.com/blog/connectors-for-everyday-life)); Apple's third-party Extensions withheld ([The Next Web](https://thenextweb.com/news/apple-siri-extensions-third-party-ai-missing-wwdc)).
- Users run ~3 assistants each, so a layer that is assistant-agnostic has a reason to exist. ([Menlo Ventures](https://menlovc.com/perspective/2026-the-state-of-consumer-ai/))
- Sanctioned structured interfaces are where the platforms are heading: Android AppFunctions as on-device MCP ([Android Developers blog](https://developer.android.com/blog/posts/top-ai-on-android-updates-for-building-intelligent-experiences-from-google-i-o-26)); Honor's MCP-based YOYO ([Computerworld](https://www.computerworld.com/article/4203560/how-ai-in-china-is-killing-smartphone-apps.html)); WeChat's structured agent-to-agent alternative ([Jeff Xiong Substack](https://jeffxiong.substack.com/p/when-ai-wants-to-be-your-new-portal)); ChatGPT plugins and Claude connectors both on MCP ([VentureBeat](https://venturebeat.com/technology/openai-now-accepting-chatgpt-app-submissions-from-third-party-devs-launches)).
- Hello Haven raised $15M on the thesis that the durable consumer layer is memory and permissions above the model. ([Runtime Wire](https://runtimewire.com/article/frank-addante-hello-haven-15m-personal-ai-digital-twin))
- Messaging is the proven engagement surface (Poke 100M messages/quarter; first AI agent on Apple Messages for Business). ([TechCrunch](https://techcrunch.com/2026/07/24/why-cognition-bought-poke-ai-personality-is-becoming-a-competitive-advantage/))
- Trust is the binding constraint (privacy 76% of holdouts; low penetration in bill pay, healthcare navigation). ([Menlo Ventures](https://menlovc.com/perspective/2026-the-state-of-consumer-ai/))
- Canvas has no official public MCP server for personal agents; community servers depend on student API tokens. (vendor blog) ([Carly blog](https://www.usecarly.com/blog/claude-canvas-lms-integration/))

### Inferences
- What a new entrant must do differently than the failures:
  1. **Do not impersonate the user in the UI.** Doubao, Comet-on-Amazon, and Oct 2026 bank/airline blocks show UI-driving gets blocked in high-value apps. Use APIs/MCP/AppFunctions/App Intents, and treat screen automation only as a fallback for low-stakes apps.
  2. **Do not carry inference COGS on a flat cheap sub.** Poke's lesson. Route reasoning through the user's existing plan (Sign in with ChatGPT), BYO keys, or on-device models; keep the product's own cost to connector plumbing and memory.
  3. **Do not build hardware.** Humane/Rabbit/Friend/Limitless all failed or got absorbed; phones plus messaging won.
  4. **Be the neutral layer the platforms will not be.** Each platform only connects its own assistant; a user-owned "personal MCP server" that exposes the user's apps to ChatGPT, Claude, Gemini and Siri (when Extensions open) is complementary rather than competitive with them, which lowers sherlock risk (it rides their distribution, as OpenClaw did with Sign in with ChatGPT).
  5. **Pick a vertical with a long tail the giants skip.** Students (Canvas, Gradescope, school email, campus apps), personal health/fitness/nutrition logs, household budgeting in read-only mode. These have high stated demand (PYMNTS 71% health management interest; 56% AI penetration in assignments) and weak official connectors.
  6. **Make permissions and safety the product.** OpenClaw's security backlash and Menlo's privacy numbers say a consumer "connect everything" product must ship scoped, revocable, read-first permissions with confirmation on writes.
- Biggest risks to the thesis: OpenAI Dots moving down-market to Plus/Free and adding texting; Apple turning on Extensions plus App Intents in iOS 27.x; Google graduating AppFunctions and widening screen automation; target apps' ToS. On iOS specifically, a third party still cannot drive other apps, so iPhone coverage depends entirely on each app's cloud API or its App Intents being reachable via Shortcuts.

### Gaps
- No source quantifies the size of the "long tail" (how many of a typical user's phone apps have public APIs or MCP servers).
- No data on whether users want one neutral layer versus staying inside a single assistant's connector directory.
- Unclear whether Apple will allow a third-party app to act as an MCP/intents hub that other AIs call on iOS; no Apple policy statement found.
