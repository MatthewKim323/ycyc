# Tracks: where ycyc fits (from the kickoff deck + consumermobilehackathon.com)

## What's up for grabs
| Prize | What wins it | Fit |
|---|---|---|
| **Main 1st/2nd/3rd** | Best app overall. Must use Capy + Revyl + Convex or you're not eligible | **Strong.** Revyl is our runtime, not just a test rig |
| **Keiki: Best iMessage App** | iPhone Duo per member + 1 year of Keiki | **Strongest track fit.** Basically free to add |
| **Whop: Best Monetizable App** | iPad per member | **OK.** ~20 min paywall add-on, real business logic |
| **Supermemory: Best Use of Supermemory** | 1 year of Supermemory Max + merch | Possible: cross-app memory for the morning brief |
| OpenAI, Candle | No track prize. $100 OpenAI credits, Candle mentors on retention | Use as needed |

Track prizes per #general (10:43 AM, kickoff slides). Everything stacks: one project can win main + every track.

## Main prize: lean on Revyl
Most teams use Revyl to test their own app. We use it as the product: a cloud phone running Strong (an app with zero API) while an agent taps in your workout. That's the "best use of the required stack" story without a track for it.
- **Capy** builds connectors in parallel
- **Convex** holds connections and tool maps, hosts the MCP endpoint, streams the agent's actions to the phone live
- **Revyl** runs the phone-only apps, embedded live in our app

## Keiki: text your apps
Keiki gives an agent an iMessage number. Their guide: "The agent can call your Convex backend as its tools, over HTTP or MCP." That's our architecture already. The Keiki agent is just one more client on the same MCP link as Claude and ChatGPT.

Why it's more than a bolt-on:
- **Fixes our biggest demo risk.** Claude/ChatGPT mobile may not render the connect pop-up. In iMessage the agent just texts you a connect link
- **Kills the "open it tomorrow" question.** You don't open anything, you text it. "log my breakfast" from the lock screen
- **Approvals for free.** Keiki has Face ID approval before marked actions = our write approvals, inside the thread
- **Reach.** Works for people who don't pay for Claude or ChatGPT at all

Demo beat: text the Keiki number "log push day, bench 185 5x5" → it replies with a link to watch → Revyl phone taps it into Strong → reply "done ✓". Then ask Claude "what did I lift today?" and it knows.

Setup (from their guide): sign up at onkeiki.com/signup with invite code `KEIKI-CAPY-YC` (credits + iMessage line), add `https://onkeiki.com/mcp` to Capy, deploy from a template, use the **shared iMessage number** for the demo (a dedicated line costs $99-300/mo).

**Gotcha:** orgs without a plan run agents capped: cheap model, fewer steps, **no MCP tools**. Ask in #keiki whether the hackathon credits unlock MCP tools. If not, write the tools as Keiki TypeScript tools (`defineTool`) that call our Convex HTTP actions.

## Whop: charge for cloud phones
Cloud phones are our one real cost (VISION.md), so put the paywall there:
- Free: web-route apps (MyFitnessPal, Canvas)
- Pro (Whop checkout): phone-only apps on cloud phones (Strong, Fitbod, MacroFactor)

Their recipe: Convex action creates the checkout, `expo-web-browser` opens it, a Convex HTTP action at `/whop` verifies `payment.succeeded` and flips the user to Pro. Sandbox, test card 4242 4242 4242 4242, works in Expo Go. Demo beat: tap Strong → "Pro: runs on a cloud phone" → pay → connect.

Bigger version (pitch only, don't build): Whop as the developer side of the Plaid model, apps pay per connected account.

## Supermemory (optional)
Cross-app memory for the morning brief ("you skipped legs twice and you're under on protein"). Only if there's time.

## Candle (talk to them early)
Ask the one question judges score: "what brings someone back tomorrow?" Our answer to test on them: morning brief + feed of what your agents did.

## Recommended stack for the rest of the day
1. Main build (MyFitnessPal web route, then Strong on Revyl) on Convex MCP
2. Keiki agent on the same MCP link (~45 min, after MyFitnessPal works)
3. Whop paywall on cloud-phone apps (~20 min, only if 1 and 2 are solid by ~5pm)

## Submission (changed from the deck)
- **Due 6:30 PM** on vibeapps.dev (deck said 6:00), tagged "Consumer Mobile Hackathon"
- **Demo video + public GitHub repo required.** This repo is private right now
