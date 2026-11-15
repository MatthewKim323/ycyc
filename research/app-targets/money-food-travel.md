# Money, food, shopping and travel apps: agent access (2026-11-14)

Difficulty: 1 = official API or connector, 5 = locked down or hostile. Counts with `~` are older or secondary.

Shorthand: CGPT = ChatGPT apps directory. Gem = Gemini on-device task automation list (Android Authority, Nov 12 2026; US20 = 20-app US list). Claude = Claude connector directory (15 consumer connectors added Apr 23 2026).

| App | Users | Official API | Official MCP / connector | Community MCP | Web | Agent blocking | Killer use case | Diff |
|---|---|---|---|---|---|---|---|---|
| Venmo | ~67M MAU (Q4 2025) | none for consumers | none (PayPal's is merchant-only) | a few; Strider pulled theirs Jun 5 2026 | limited | 2FA, PayPal risk checks | "who still owes me from Tahoe? request them" | 4 |
| Cash App | 60M monthly actives (Sep 2026) | none | none | thin, mostly pulled | limited | n/a | "send rent to my roommate on the 1st" | 4 |
| Zelle | ~150M enrolled | none (lives in bank apps) | none | none | via banks | banks blocking agents (Oct 2026) | "Zelle my landlord" | 5 |
| Robinhood | ~26M funded | crypto API | official trading MCP, beta (May 27 2026) | robin_stocks etc. | yes | open | n/a | 1 |
| Coinbase | ~9M MTU | Advanced Trade API | official MCP | many | yes | open | n/a | 1 |
| PayPal | ~430M accounts | merchant API | official MCP, CGPT app | many | yes | open | n/a | 1 |
| Splitwise | no public count | free self-serve, read and write | none | many | yes | none | "add the $240 dinner split 4 ways" | 1 |
| Rocket Money | millions | none | none | export workarounds | yes | none known | "cancel every sub I haven't used in 60 days" | 3 |
| Copilot Money | niche | none | official read-only MCP (Oct 27 2026) | some | yes | open | n/a | 1 |
| YNAB | niche | read and write | CGPT app | many | yes | open | n/a | 1 |
| Monarch | niche | none | official hosted MCP (Oct 21 2026) | many | yes | open | n/a | 1 |
| Chase | ~70M digital | none (charges aggregators) | none | n/a | yes | blocks outside agents (Oct 13 2026); Plaid reads still work | "dining spend in October?" | 5 |
| Amazon | 300M+ | none for consumers | none | order-history MCPs | yes | most hostile: Perplexity suit, blocks Muse since Sep 20 | "reorder my usual" | 5 |
| Target | ~100M Circle | none | CGPT (cart + checkout), Gem | n/a | yes | open | n/a | 2 |
| Walmart | ~150M weekly | none | CGPT, Gem, Muse | n/a | yes | open | n/a | 2 |
| Costco | ~81M households | none | Gem test list only | receipt scrapers (unverified) | yes | opened to AI bots | "what did I buy here this year, is X in stock" | 3 |
| Shein / Temu | huge | none | Gem global | scrapers | yes | heavy anti-bot | "track my orders" | 3-4 |
| Kroger | large | public API incl. cart | Gem | some | yes | open | n/a | 1 |
| DoorDash | ~42M MAU | none for consumers | CGPT groceries only, Gem | Playwright MCP | yes | none reported | "reorder Friday's Thai" | 3 |
| Uber Eats / Grubhub | Uber 215M MAPCs | none | CGPT, Claude (browse), Gem | n/a | yes | open | n/a | 2 |
| Instacart | large | developer platform | CGPT, Claude | n/a | yes | open | n/a | 1 |
| Starbucks | 35.5M active US Rewards | none | CGPT discovery only, Gem | few | yes | open | "order my usual at the closest store" | 2-3 |
| Chipotle | ~24M active rewards (Q3 2026) | none | none anywhere | Playwright MCP (rated 37/100) | yes | none reported | "my usual bowl, pickup 12:15" | 3 |
| Sweetgreen | small | none | none | browser automation | yes | none reported | same | 3 |
| McDonald's | ~175M loyalty worldwide | none in US | Gem only | China only | app mostly | none reported | "use my best deal" | 4 |
| Resy | Amex-owned | none | Claude, CGPT | n/a | yes | open | n/a | 1-2 |
| OpenTable | large | partner only | CGPT | Apify booker | yes | open | n/a | 1-2 |
| Yelp | large | Fusion API (paid) | CGPT, Gem | n/a | yes | agents must license data | n/a | 4 |
| Uber | 215M MAPCs | restricted | CGPT, Claude, Gem | n/a | yes | open | n/a | 1-2 |
| Lyft | 31.6M riders (Q3 2026) | partners only | Gem only | browser MCPs | yes | none reported | "Uber or Lyft to SFO at 6am, book the cheaper one" | 3 |
| Expedia / Booking / Tripadvisor | large | partner | CGPT and/or Claude | n/a | yes | open | n/a | 1 |
| Airbnb | large | no guest API | none | search only | yes | robots.txt disallows agents | "3BR Tahoe under $400 with hot tub" | 3-4 |
| Hopper | 100M+ downloads | none (B2B only) | none | scraper | yes | none known | "watch SFO-JFK, buy under $300" | 3 |
| Delta | ~200M passengers/yr | none | Gem (on-device) | n/a | yes | refuses outside agents (Oct 2026) | "move me to the earlier flight" | 5 |
| United | large | none | Gem | n/a | yes | bans agent purchases even supervised (Nov 11 2026) | n/a | 5 |
| Southwest | large | none | CGPT search only | n/a | yes | has sued scrapers | n/a | 4 |
| ParkMobile | 66M+ registered | commercial deals only | none | none maintained | yes | none known | "extend my parking 30 min" | 3 |
| SpotHero | being bought by Uber | partner key | none | wrapper | yes | none | "garage near Chase Center, Sat 7pm" | 2-3 |
| GasBuddy | conflicting (10M to 90M) | none | none | unofficial GraphQL lib | yes | none | "cheapest gas on my route" | 2 |

## Best targets: no API, high value, not hostile
- **Chipotle, then Sweetgreen:** 24M rewards members, no connector anywhere (not even Gemini's list) while fast-food peers have ChatGPT apps. Web ordering. "My usual" is perfect. Risk: Chipotle ships its own ChatGPT app. [restauranttechnologynews](https://restauranttechnologynews.com/2026/07/chipotle-tests-new-payment-technology-to-expand-in-restaurant-loyalty-as-rewards-membership-reaches-23-million/), [agentseal](https://agentseal.org/mcp/https-githubcom-markswendsen-code-mcp-chipotle)
- **ParkMobile:** 66M+ registered, no API, no MCP, urgent frequent actions, web app. SpotHero going to Uber leaves this lane open. [supergood](https://supergood.ai/api-report-card/parkmobile)
- **Costco:** ~81M households, receipts and per-warehouse stock locked in the app, reportedly open to AI bots. [shopifreaks](https://www.shopifreaks.com/costco-jumps-182-spots-in-ai-shopping-readiness-on-bot-access-as-many-top-retailers-still-block-ai-agents-per-refibuys-ai1000/)
- **Lyft:** 31.6M riders, no ChatGPT or Claude connector while Uber has both. Price comparison is the killer ask. [Lyft Q3](https://www.lyft.com/blog/posts/lyft-reports-strong-q3-2026-financial-results)
- **Venmo + Cash App (read + requests only):** 127M+ combined, no official path. Requests, not sends. Still difficulty 4. [vorplabs](https://vorplabs.com/agent-tools/venmo-cli)
- **Rocket Money (actions only):** reads are covered by Plaid/Monarch/Copilot; cancellations and bill negotiation have no API. [candor.money](https://candor.money/personal-finance-mcp-servers)
- **Short windows:** DoorDash restaurant reorders, Starbucks ordering + Stars, Airbnb account actions. All three are building their own.
- **Skip:** Amazon, Chase/Zelle, Delta, United, Yelp (hostile or paywalled). Already official: Robinhood, Coinbase, Monarch, Copilot, YNAB, Splitwise, Instacart, Uber, Target, Walmart, Kroger, Resy, OpenTable, Expedia/Booking.
- Wrinkle: Delta and United block cloud agents but sit on Gemini's on-device list, so automating the user's own app on the phone is treated differently from a cloud agent.

Sources: [agent blocking (The Verge via aiweekly)](https://aiweekly.co/alerts/amazon-yelp-delta-join-banks-blocking-third-party-ai-agents), [Chase](https://thepaypers.com/fintech/news/jpmorgan-chase-blocks-external-ai-agents-from-customer-accounts), [United](https://www.spokesman.com/stories/2026/nov/11/united-blocks-ai-agents-from-booking-flights-ahead/), [Ninth Circuit](https://www.pearlcohen.com/ninth-circuit-vacates-injunction-against-perplexitys-ai-shopping-agent/), [Gemini app list](https://www.androidauthority.com/google-gemini-task-automation-target-apps-list-3734443/), [Claude connectors](https://www.claudeainews.com/news/claude-consumer-lifestyle-connectors), [Robinhood MCP](https://robinhood.com/newsroom/robinhood-is-now-open-to-agents/), [Coinbase MCP](https://docs.cdp.coinbase.com/ai-agents/coinbase-for-agents/coinbase-mcp)
