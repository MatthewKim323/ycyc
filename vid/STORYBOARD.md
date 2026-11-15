# Storyboard: "Your apps, in every AI" (FINAL v2, 2026-11-15)

~80 s, 1920x1080, 30 fps (render 60). Unlisted YouTube with captions on. VO: Chris (`iP95p4xoKVk53GoZ742B`, eleven_v3), ~130 wpm, lines in `audio/voice/script.json`. Music: Skarl temp bed (`~/dev/nautshow1/launch/assets/music/temp-bed.mp3`) until a final track is chosen. Sound: cue comments per scene, `build-fx.py`.

**The problem:** you pay for the smartest AI there is. Ask it something about your own body and it guesses, because what it needs (your meals in MyFitnessPal, your nutrients in Cronometer, your training in Strong) sits in apps it can't open, and none of them have an API.
**The spine:** one question travels the whole film: "why am I so tired this week?" It gets a guess at 0:00 and a real answer from your own data at ~0:30. Then the loop proves itself (a write with an approve tap, every assistant, iMessage), then it turns endless.

Rules: product on screen by 0:02. A new picture every 2-4 s. Real phone captures (R#) for anything claiming the product works; macro shots rebuilt from the app's code with its real labels. On-screen numbers only from the captures. Text never repeats the VO word for word, except the brand line. Apps appear as glyph + name, as in the app. Lordicons only. Inter only. Black, white, greys.

## Shots

| # | Scene | Time | Picture | VO (line id) | Sound | Source |
|---|---|---|---|---|---|---|
| 1 | s01-guess | 0:00-0:05 | Frame 0, macro on a real phone in Claude: "why am I so tired this week?" already sent, the generic answer streaming ("sleep, hydration, stress..."). The generic lines blur and dim as the push lands on the gap | v01 "You pay for the smartest AI there is. Ask it why you're tired this week... and it guesses." | text-tick under the stream, low thud on "guesses" | R1 |
| 2 | s02-islands | 0:05-0:11 | The answer is in three apps it can't open, 1.8 s each, hard cuts: MyFitnessPal (meals, calories, protein), Cronometer (nutrients under target), Strong (this week's sessions). Each screen sinks behind dark glass as the next cuts in | v02 "The answer's in your apps. Meals in MyFitnessPal. Nutrients in Cronometer. Training in Strong. Your AI can't open any of them." | flash-tick per cut | R2 |
| 3 | s03-reveal | 0:11-0:15 | Suck-out. The three screens shrink to dots and fall into the silk wave (2 s intro bloom). The yuzu mark lands, then "Your apps, in every AI." | v03a "Yuzu." ON the drop (s03 1.20, film 14.94), then v03b "It connects them. Even the ones with no API." | duck 0.4 s, low-hit + brand-shimmer on the mark | rebuilt + shader |
| 4 | s04-connect | 0:15-0:23 | Pick MyFitnessPal (tap ring, push follows the tap), the connect sheet (yuzu square slides into the MFP glyph), sign in on MyFitnessPal's own page, then the build macro: Signed in, Reading your account, Writing tools, Testing a real request, tools count to 5. Cronometer runs the same flow at 3x behind it, tools count to 6 | v04 "Sign in once. yuzu reads your account, writes the tools, and tests a real request." | ui-confirm on tap, row-tick per step, counter-grain on the count | R3 + rebuilt from build/[connectionId].tsx |
| 5 | s05-link | 0:23-0:28 | "MyFitnessPal is live", Copy your link (press spring), the URL lifts out of the phone and drops into Claude's connector settings (Add custom connector, paste, Add) | v05 "Then ONE link goes into every assistant you use." | ding-success, whoosh-soft on the lift, ui-confirm on Add | R3 + R4 |
| 6 | s06-knows | 0:28-0:38 | PAYOFF. The same question in Claude. Tool call chips light one by one (MyFitnessPal get diary, Cronometer get daily nutrition, Strong get recent workouts), then the real answer lands, built from the user's own numbers. Push in on the lines that cite MyFitnessPal, Cronometer and Strong | (silence while the tools run) then v06 "Same question. Now it actually knows you." | duck before, case-pop per chip, slam-impact as the answer lands | R5 |
| 7 | s07-approve | 0:38-0:44 | Claude offers to log a fix ("log spinach salad and almonds in MyFitnessPal"). The phone buzzes, the approval card at 3x, thumb taps Approve, the card slides right, match cut to the row landing in the MyFitnessPal diary | v07 "Anything that writes waits for your OK." | phone-buzz, ui-confirm on Approve, row-tick on the diary row | R6 + R7 |
| 8 | s08-chatgpt | 0:44-0:49 | Same link in ChatGPT: "what did I bench last week?" answers from Strong, no setup | v08 "Same link in ChatGPT." | msg-in on the answer | R8 |
| 9 | s09-text | 0:49-0:54 | iMessage (Keiki): "log push day, bench 185 5x5", the agent asks for a yes, "done ✓" | v09 "Or just text it." | msg-sent, msg-in | R9 |
| 9b | s09b-any | 0:57-1:05 | Your own AI, any AI: the Agent tab ("Ask your apps anything", suggestion tapped, assistant pill switches Claude → ChatGPT → Grok, "Opens in Grok with your apps attached", send) → match cut into Grok answering from Duolingo through yuzu (R11) → the Link tab rows check every half beat: Claude, ChatGPT, Grok, Muse, Claude Code, Codex, Cursor, iMessage | v09b "Yuzu runs no model of its own. It plugs into the AI you already pay for, and any agent that speaks MCP." | ui-roll, ui-confirm, row-tick per check | rebuilt from agent tab + link.tsx, R11 |
| 10 | s10-more | 0:54-0:59 | The build replays faster, 2x, 4x, 8x: ParkMobile, Duolingo, Cronometer. Each tile does the app's 3D flip to "Live" + "N tools in every assistant" (ParkMobile 10, Duolingo 8, Cronometer 6), with one real tool name each: extend_parking, get_weak_words, get_daily_nutrition | v10 "Every app yuzu learns, it learns once, for everyone." | riser-tight building, case-pop per flip | rebuilt from recipes/*.json |
| 11 | s11-endless | 0:59-1:06 | Pull back: the tiles are a few of a wall that never ends, each an app glyph + its sentence ("extend my parking 30 min" ParkMobile, "drill the words I keep missing" Duolingo, "what's due this week across all my classes" Canvas, "who still owes me from Tahoe?" Venmo, "why was my readiness low?" Oura, "make a playlist for my run" Spotify...). Keep pulling until the tiles are the dots of the silk wave | v11 "ParkMobile. Duolingo. Whatever you open next." | wall-riser, text-tick flurry thinning out | rebuilt + shader |
| 12 | s12-built | 1:06-1:12 | Built today: Capy's merged PRs (#1 Whop paywall, #2 Keiki agent), the Revyl cloud phone session, the Convex activity feed streaming. 2 s each, pushes | v12 "Built today at YC, with Capy, Revyl and Convex." | whoosh-soft per card | R10 |
| 13 | s13-end | 1:12-1:20 | The wave calms, the yuzu square carries in, the link icon joins it, "Your apps, in every AI.", github.com/MatthewKim323/ycyc. Hold 3 s, end by subtraction | v13 "Yuzu. Your apps, in every AI." | logo-bloom, the pad tail, no final hit | rebuilt |

## Captures (iPhone screen recordings, portrait, 60 fps if possible, drop them in vid/assets/footage/)

- R1 Claude, yuzu NOT connected: "why am I so tired this week?" and its generic answer
- R2 The three apps showing the data: MyFitnessPal (today's meals and macros), Cronometer (nutrients vs targets), Strong (this week's workouts). 3-4 s each, a slow scroll
- R3 yuzu: Apps → Flo → Continue → sign in → build → "MyFitnessPal is live" → Copy your link (then Cronometer the same way)
- R4 Claude: Settings → Connectors → Add custom connector, paste the link
- R5 Claude, connected: the same question, showing the tool calls and the answer citing MyFitnessPal, Cronometer and Strong
- R6 Claude: "log spinach salad and almonds in MyFitnessPal" → the yuzu approval card on the phone → Approve
- R7 MyFitnessPal: the diary with the new entry (r7-mfp-diary)
- R8 ChatGPT: "what did I bench last week?"
- R9 iMessage (Keiki): "log push day, bench 185 5x5" → yes → done
- R11 Grok, yuzu connected: "am I about to lose my Duolingo streak?" answered from Duolingo (r11-grok-duolingo)
- R10 Screenshots: Capy PR #1 and #2, a Revyl device session, the Convex dashboard

Flo was dropped (it already has an API); MyFitnessPal is the hero connector. If Cronometer isn't verified by capture time, Strong data carries shot 6 and Cronometer stays a name in the VO.
