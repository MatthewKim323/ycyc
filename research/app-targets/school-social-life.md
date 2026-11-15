# School, social, entertainment and home apps: agent access (2026-11-14)

Difficulty: 1 = official API or connector, 5 = locked down or hostile. "est." = approximate, not re-checked.

| App | Users | Official API | Official MCP / connector | Community MCP | Web | Blocking / ToS | Killer use case | Diff |
|---|---|---|---|---|---|---|---|---|
| Canvas | ~30M+ (est.) | REST + GraphQL with personal tokens; since Sep 2025 schools can block student tokens (Instructure cited AI doing assignments) | none from Instructure | many (canvas-mcp etc.) | yes | spreading token blocks | "what's due this week across all my classes" | 2 (4 if blocked) |
| Blackboard | large (est.) | school-registered apps only | none | none | yes | gated by school | "new announcements + deadlines" | 3 |
| Google Classroom | 150M+ (est.) | Classroom API (OAuth) | MCP developer preview (teacher tools) | Composio, Metorial | yes | admins can restrict | "what am I missing" | 1 |
| Schoology | K-12 | per-school keys | none | few | yes | gated by district | same | 3 |
| Brightspace (D2L) | higher ed / K-12 | Valence API, gated | none | several | yes | gated | grades + syllabus Q&A | 3 |
| Quizlet | ~60M MAU | none | ChatGPT app (Mar 11 2026) | few | yes | ToS bans scraping | "turn my notes into a set and quiz me" | 2 / 4 |
| Duolingo | 64.9M DAU (Q3 2026) | none | none anywhere | sparse unofficial | yes | ToS bans scraping | "drill the words I keep missing, keep my streak" | 3 |
| Anki | millions (est.) | AnkiConnect, local | none | several | AnkiWeb limited | friendly | "make cards from this PDF" | 2 |
| GoodNotes | ~24M MAU (older) | none | none | none | yes | proprietary format | "find where the prof explained X" | 4 |
| Notability | n/a | none | none | none | view-only links | proprietary | same | 4 |
| Gradescope | thousands of schools | none for students | none | gradescope-mcp (password) | web only | ToS, school SSO | "why did I lose points, draft a regrade" | 3 |
| Piazza | declining | none | none | piazza-mcp (password) | web only | moderate | "has anyone asked about HW3 Q2?" | 3 |
| Ed Discussion | growing | personal API tokens (unofficial edapi) | none | several | web only | tolerant | same | 2 |
| Handshake | ~20M students (est.) | employer/school side only | none | none | yes | ToS bans bots | "find paid SWE internships in NYC" | 3-4 |
| Instagram | 3B MAU | business/creator only; DMs replies only | Muse only | bridges | yes | suspends automated accounts | "who haven't I replied to" | 5 |
| TikTok | 200M US | your own videos, posting | none | few | yes | strong anti-bot | "save recipes from my likes" | 4 |
| Snapchat | 495M DAU (Q3 2026) | Snap Kit only | none | none | web | bans third-party clients | "what did the group plan for Friday" | 5 |
| BeReal | ~40M MAU | none | none | reverse-engineered | limited | unclear | low value | 4 |
| GroupMe | default college chat | public API v3, personal token, read + write | none | one community server | yes | API license allows | "catch me up on 400 unread in the dorm chat" | 1 |
| Discord | 200M+ MAU | bot accounts only | none | bot MCPs | yes | selfbots get banned | "summarize unread in my class server" | 3 / 5 DMs |
| WhatsApp | 3B+ | business only | none | whatsapp-mcp (whatsmeow) | web | against ToS, number bans | "summarize the family chat" | 4-5 |
| iMessage | ~1B+ iPhone (est.) | none | Claude connector, Mac only (Mar 2026) | many (Mac) | no | Mac chat.db tolerated | "who haven't I answered today" | 2 Mac / 5 iPhone |
| Partiful | ~500K monthly (Q1 2025); +2M new users 2025 | none | none | reverse-engineered client | full web app | none known | "invite my roommates Sat 9pm, who RSVP'd?" | 2-3 |
| Life360 | 107.7M MAU (Q3 2026) | none | none | HA integration 403s (May 2026) | limited | actively blocking | "tell me when my sister leaves campus" | 5 |
| Tinder | ~50M MAU (est.) | none | none | old libs | yes | ToS bans AI apps; Match CEO Nov 11 2026: guardrails vs agents | triage matches | 5 |
| Hinge | est. | none | none | none | no | any automation violates ToS | same | 5 |
| Bumble | est. | none | none | none | yes | ToS bans bots | same | 5 |
| Spotify | ~700M MAU (est.) | Web API, limited since Feb 2026 | ChatGPT, Claude, Gemini, Muse | many | yes | official | "make a playlist for my run" | 1 |
| Apple Music | ~100M subs (est.) | MusicKit ($99 dev account) | ChatGPT app | AppleScript MCPs | yes | official | same | 2 |
| Letterboxd | ~17M+ (est.) | by request only | none | scrapers, RSS | yes | scrapers get 403 | "log Dune 2, 4 stars" | 3 |
| Goodreads | 150M+ (est.) | retired Dec 2020 | none | unofficial CLI + MCP | yes | ToS bans scraping, light enforcement | "mark it finished, add the next 3" | 3 |
| Netflix | 300M+ paid | none since 2014 | none | few | yes | ToS bars automation | "what on my list leaves this month" | 4 |
| YouTube | ~2.7B (est.) | Data API v3 read + write | Gemini | many | yes | official | "Watch Later into a study playlist" | 1 |
| Ticketmaster | n/a | Discovery API | ChatGPT, Gemini, Muse (discovery) | few | yes | bot defense at checkout | "2 tix under $100" | 2 / 4 |
| StubHub | n/a | partner | Claude, ChatGPT | n/a | yes | official | same | 1 |
| AMC | ~30M+ Stubs (est.) | none | none | none | yes | bot protection at checkout | "2 seats tonight at 7 with my A-List" | 3 |
| Fandango | n/a | affiliate only | none | none | yes | moderate | "what's playing near me" | 3 |
| Ring | tens of millions (est.) | partners only (Jan 2026) | Alexa+ only | ring-client-api | yes | libs break | "who came to the door today" | 3 |
| Google Nest | n/a | Device Access ($5) | Gemini | some | yes | official | "68 degrees before I get home" | 2 |
| Tesla | ~7M+ cars (est.) | Fleet API, pay-per-use | Tessie in Muse | many | no | official | "precondition at 7:45" | 2 |
| SimpliSafe | n/a | none | none | simplisafe-python | yes | auth changes | "arm away" | 3 |
| Apple Notes | n/a | none (local AppleScript) | Claude Mac ext (unverified) | apple-mcp, iMCP | icloud.com | local only | "save this to my class notes" | 2 Mac / 4 iPhone |
| Apple Reminders | n/a | EventKit, local | none | iMCP | icloud.com | local only | "remind me Thu 9pm to submit lab" | 2 Mac / 4 iPhone |
| Notion | 100M+ (est.) | official API | official MCP | many | yes | official | n/a | 1 |
| Todoist | n/a | official REST API | official MCP; Muse | many | yes | official | n/a | 1 |

## Best "no API, high value, not hostile" targets
- **Partiful:** Gen Z party default, full web app, reverse-engineered client exists, no anti-bot stance. [apievangelist](https://providers.apievangelist.com/providers/partiful/), [sacra](https://sacra.com/research/partiful)
- **Goodreads:** ~150M members, API dead since Dec 2020, simple web-form writes, light enforcement. [infodocket](https://www.infodocket.com/2020/12/13/report-goodreads-plans-to-retire-api-access-disables-existing-api-keys/)
- **Student course tools (Gradescope, Piazza, student side of Blackboard/Brightspace):** no student APIs, web only, community MCPs want raw passwords. Frame as read-only planner, never a homework doer: Canvas token blocks cite AI doing assignments. [Canvas blog](https://community.canvaslms.com/t5/The-Product-Blog/Strengthening-Security-in-Canvas-Updates-to-User-Access-Token/ba-p/660299), [UM System](https://tdx.umsystem.edu/TDClient/66/MOOnline/KB/ArticleDet?ID=2302)
- **Duolingo:** 64.9M DAU, no connector anywhere, web version, daily habit loop. [247wallst](https://247wallst.com/cards/duolingo-q3-2026-earnings-duol-01m6hkzaqtk5596n48x4pxv0q5)
- **Movie tickets (AMC + Fandango):** event ticketing is in assistants, movie theaters are not. Confirm before purchase. [Gemini connected apps](https://9to5google.com/2026/08/13/gemini-is-getting-over-a-dozen-new-connected-apps-heres-the-list/)
- **Letterboxd:** API by request only, RSS covers reads, logging needs only a web session. [Letterboxd API](https://letterboxd.com/api-beta/)
- **GroupMe (quick win):** public API with personal tokens, no official MCP or assistant connector. [GroupMe API](https://dev.groupme.com/docs/v3)
- **Skip:** Instagram, Snapchat, TikTok, WhatsApp, Discord DMs, Tinder, Hinge, Bumble, Life360, Venmo (hostile). Already covered: Spotify, Notion, Todoist, YouTube, StubHub, Ticketmaster discovery, Quizlet (ChatGPT), Google Classroom (preview), Tesla, Nest, iMessage on Mac. [Match/Dexerto](https://www.dexerto.com/entertainment/tinder-and-hinge-ban-ai-agents-from-running-profiles-and-dating-for-you-3427393/), [Hinge help](https://help.hinge.co/hc/en-us/articles/49657802257683-Note-on-Third-Party-Automated-Tools), [Life360 HA thread](https://community.home-assistant.io/t/life360-device-tracker-platform/52406?page=119), [Spotify dev update](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security)
