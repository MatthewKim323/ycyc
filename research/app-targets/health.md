# Health and body apps: can a personal AI read and write them? (2026-11-15)

Difficulty: 1 = official API, 5 = native-only and locked down. Cells marked **(bg)** are background knowledge (to about mid-2026) that was not re-verified. Many user counts are missing or third-party estimates. Gemini coverage was not found and is unverified.

**Official health connectors today**
- **ChatGPT Health (Jan 2026):** Apple Health (iOS), MyFitnessPal, Peloton, Weight Watchers, Function, Instacart, AllTrails, plus US medical records. Peloton and Sleep Cycle are also standalone ChatGPT apps.
- **Claude (Jan 2026, US Pro/Max):** Apple Health, Health Connect, HealthEx (medical records), Function. Strava read-only connector added June 2026.
- **Meta Muse:** HealthEx, Apple Health, Function.
- **Gemini:** (bg) Fitbit coach only.

| app | users | official API | official MCP / connector | community MCP | health-store sync | web version | killer use case | diff |
|---|---|---|---|---|---|---|---|---|
| Flo | ~80M MAU (Aug 2026, secondary); 440M+ downloads (Dec 2025) | none | none | none found | Apple Health gets period data only; symptoms, notes, predictions stay in app | no tracking web app (bg) | "log cramps and spotting, when's my fertile window?" | 4 |
| Clue | ~4.2M MAU (AppGoblin est.) | none | none | none | Apple Health one way: period and flow only | no (bg) | same as Flo | 4 |
| Natural Cycles | not found | none | none | none | writes cycle entries to Apple Health | account pages only (bg) | "green or red day today?" | 5 (FDA-cleared) |
| Stardust | ~107K ratings | none | none | none | not found | no | "sync my cycle with my partner and calendar" | 5 (privacy brand) |
| Apple Cycle Tracking | built into iOS | HealthKit, on device only | read via Claude and ChatGPT Apple Health (iOS) | Apple Health export MCPs (read-only) | it is the health store | no | "summarize my last 6 cycles" | 3 |
| MyFitnessPal (owns Cal AI) | 200M+ registered (2026, secondary) | closed, partners only (bg) | ChatGPT Health partner; nothing in Claude | several, browser cookies; some log food | meal-level totals only | yes | "log my Chipotle bowl, how much protein is left?" | 2 |
| Lose It | not found | none | none | 2 (reverse-engineered web endpoint; one logs food) | nutrition (bg) | yes | same | 3 |
| Cronometer | not found | none for individuals | none | 3+ (web endpoint, Android API, remote read/write fork) | nutrients (bg) | yes | "am I low on magnesium this week?" | 3 |
| MacroFactor | not found | none, file export only | none | unofficial client archived after Firebase App Check (May 2026) | nutrition (bg) | no | "what's my new target, log this meal" | 5 |
| Noom | not found | none | none | none found | limited (bg) | sign-up only (bg) | "am I on track with GLP-1 protein?" | 4 |
| Yazio | not found | none | none | 3 (reverse-engineered) | nutrition (bg) | no full web app (bg) | log meal | 3 |
| Cal AI | 15M+ downloads, ~$40M ARR (Mar 2026); bought by MyFitnessPal | none | none | none found | calories and macros (bg) | no | "here's a photo, log it" | 4 |
| Strong | not found | none | none | reverse-engineered v6 API | workout summary only; sets and reps stay in app | no | "build next push day from my last 8 sessions" | 3 |
| Hevy | not found | Pro-only API key, read and write | none | many (chrisdoc/hevy-mcp) | summary only | yes | same | 1 |
| Fitbod | not found | none | none | mcp-fitbod (email and password, read) | summary | no | same | 3 |
| Ladder | not checked | none (bg) | none | none found | summary (bg) | no | "swap today's session, my knee hurts" | 4 |
| Peloton | 2.66M connected-fitness + 522K app subs (Mar 31 2026) | no public API (bg) | ChatGPT app + ChatGPT Health | some (bg) | workouts (bg) | yes | "pick a 20-min class for my recovery" | 2 |
| Strava | 200M+ (Aug 2026) | yes, $11.99/mo for developers since Jun 2026; terms ban AI use | official read-only MCP, Claude only, subscribers (Jun 1 2026) | many, policy reportedly bars them | workouts (bg) | yes | "analyze my block" | 2 read / 5 write |
| Nike Run Club | not checked | none (bg) | none | old exporters | runs (bg) | no | "plan my 10K" | 4 |
| Apple Fitness+ | not checked | none | workouts via Apple Health connectors | none | yes | partial (bg) | "queue a plan for this week" | 4 |
| Oura | 5M+ paid members (S-1, Sep 2026) | OAuth only, read-only | none | many (read-only) | yes | yes (bg) | "why was my readiness low?" | 1 |
| Whoop | not found | v2 OAuth, read-only, membership required | none | several | yes | yes (bg) | same | 2 |
| Sleep Cycle | not found | none | ChatGPT app (Apr 30 2026) | none | sleep (bg) | no | "start my wind-down" | 3 |
| Garmin Connect | not published | business-only Health and Training APIs | none from Garmin (Tredict in ChatGPT is third-party) | many; garth login broke Mar 28 2026 | partial (bg) | yes | "plan 4 weeks and push the workouts to my watch" | 4 |
| Fitbit | not checked | Google Health API (old Fitbit API off Nov 2 2026) | Gemini coach (bg) | several | Health Connect | partial | same | 2 |
| Eight Sleep | not found | none | none | several (reverse-engineered mobile API) | sleep (bg) | no | "make the bed 2 degrees cooler tonight" | 3 |
| Calm | 100M+ downloads (weak source) | none | none | unclear wrapper | mindful minutes | yes | "play a 10-min sleep story" | 3 |
| Headspace | not found | none | none | none | mindful minutes | yes | same | 3 |
| Finch | ~755K ratings, #13 free Health & Fitness (Sep 2026) | none | none | none | none (bg) | no | "check off my goals, log my mood" | 4 |
| How We Feel | not found | none | none | none | mood to Apple Health (bg) | no | "what's driving my bad days?" | 3 |
| Streaks | not found | none, Siri Shortcuts work (bg) | none | none | some habits (bg) | no | "mark meditate done" | 3 |
| Medisafe | not found | no public API | none | none | none | no (bg) | "did I take my 8am meds?" | 4 |
| MyChart | not checked | FHIR patient access per health system | HealthEx in Claude and Muse; ChatGPT Health records | browser scrapers | Apple Health Records | yes | "message my doctor, request a refill" | 3 read / 4 write |

## Best "no API, high value" targets
- **Flo, Clue, Natural Cycles:** biggest dark spot. Flo ~80M MAU, no official or community connector anywhere. Apple Health only carries period and flow. Needs privacy-first design. [yespress](https://yespress.io/flo-health-inc), [Clue support](https://support.helloclue.com/hc/en-us/articles/20199556038813), [Sahha](https://sahha.ai/integrations/natural-cycles/)
- **Garmin Connect:** huge base, full web app, no consumer API, no official connector, actively blocking (login change Mar 28 2026, TLS fingerprinting). Pushing workouts to the watch is uncovered. [garth](https://garth.readthedocs.io/en/latest/), [Garmin forum](https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/433892/tls-fingerprinting-blocks-third-party-clients/2024198)
- **Nutrition logging is the best write case:** MyFitnessPal is only in ChatGPT; MacroFactor locked out unofficial clients (May 2026); Cal AI phone-only; Lose It and Cronometer have web apps. [macrofactor](https://github.com/sjawhar/macrofactor), [loseit-mcp](https://glama.ai/mcp/servers/atfinke/loseit-mcp), [cronometer-mcp](https://pypi.org/project/cronometer-mcp), [Cal AI sale](https://letsdatascience.com/news/cal-ai-sells-to-myfitnesspal-after-rapid-growth-f789c949)
- **Strong, Fitbod, Ladder:** sets and reps never reach Apple Health. Hevy opened an API and got a dozen community MCPs. [strong skill](https://clawhub.ai/skills/strong-app), [mcp-fitbod](https://glama.ai/mcp/servers/Muno459/mcp-fitbod), [hevy-mcp](https://glama.ai/mcp/servers/chrisdoc/hevy-mcp)
- **Eight Sleep:** agent controls hardware ("cool my bed"); community servers ride changing mobile endpoints. [eight-sleep-mcp](https://glama.ai/mcp/servers/davidmosiah/eight-sleep-mcp)
- **MyChart, Medisafe writes:** reading records is solved; messages, refills, scheduling and dose logging have no official path. [Fortune](https://fortune.com/2026/01/11/anthropic-unveils-claude-for-healthcare-and-expands-life-science-features-partners-with-healthex-to-let-users-connect-medical-records/)
- **Finch, How We Feel:** smaller but daily; no API or MCP.
- **Skip:** Strava (terms ban AI, official Claude MCP), Oura and Whoop (official APIs), Hevy (official API), Peloton and Sleep Cycle (in ChatGPT). [Strava](https://techcrunch.com/2026/06/01/strava-declares-war-on-scrapers-ahead-of-ipo), [Terra on Strava](https://tryterra.co/blog/strava-api-changes-2026)

Other sources: [ChatGPT Health](https://openai.com/index/introducing-chatgpt-health/), [Claude Apple Health](https://www.mactrast.com/2026/01/claude-ai-iphone-app-gains-apple-health-integration-in-the-us/), [Muse + Function](https://longevity.technology/news/function-connects-to-metas-muse-to-bring-personal-health-data/), [Sleep Cycle in ChatGPT](https://www.pulse.bot/consumer-tech/news/sleep-cycle-app-now-available-in-chatgpt-in-sleep-category-first-049eef6c-6f37-4390-8b6c-2e7a34577e12/), [Google Health API migration](https://developers.google.com/health/migration?hl=en)
