# Storyboard: "Your apps, in every AI" (FINAL, 2026-11-15)

~78 s, 1920x1080, 30 fps (render 60). Unlisted YouTube with captions on. VO: Chris (`iP95p4xoKVk53GoZ742B`, eleven_v3), ~130 wpm, 100 words, lines in `audio/voice/script.json`. Music: Skarl temp bed (`~/dev/nautshow1/launch/assets/music/temp-bed.mp3`) until a final track is chosen. Sound: cue comments per scene, `build-fx.py`.

Spine: the real loop as an object-to-object chain (each shot ends on the thing that opens the next), then an endless zoom where the apps become the dots of the app's own silk wave. Every dot is an app.

Rules: product on screen by 0:02. A new picture every 2-4 s. Real phone captures (R#) for anything claiming the product works; macro shots rebuilt from the app's code with its real labels. On-screen text never repeats the VO word for word, except the brand line. Apps appear as glyph + name, as in the app. Lordicons only. Inter only. Black, white, greys.

## Shots

| # | Scene | Time | Picture | VO (line id) | Sound | Source |
|---|---|---|---|---|---|---|
| 1 | s01-wall | 0:00-0:04 | Macro, real phone: Claude. "log two eggs and toast for breakfast" sent, the reply can't access MyFitnessPal. Push 1.0 to 1.15 into the refusal | v01 "Ask your AI to log breakfast... and it hits a wall." | msg-sent on send, low thud on "wall" | R1 |
| 2 | s02-walls | 0:04-0:09 | Three more refusals, 1.2 s each, hard cuts on the beat: ChatGPT / Flo "log cramps and spotting", Grok / ParkMobile "extend my parking 30 min", Claude / Cronometer "am I low on magnesium this week?" | v02 "Most of the apps you live in have no API. Your AI can't touch them." | flash-tick per cut | R2 |
| 3 | s03-reveal | 0:09-0:13 | Suck-out. The refusal bubbles shrink to dots and fall into the silk wave (2 s intro bloom). The ycyc mark lands, then "Your apps, in every AI." | v03 "ycyc connects them. Even the ones with no API." | duck 0.4 s, low-hit + brand-shimmer on the mark | rebuilt + shader |
| 4 | s04-pick | 0:13-0:17 | Apps grid, MyFitnessPal tapped (tap ring, push follows the tap). The connect sheet rises and the ycyc square slides into the MFP glyph (springs.enter) | v04 "Pick an app. Sign in on its own page." | ui-confirm on tap, card-morph on the sheet | R3 + rebuilt macro |
| 5 | s05-build | 0:17-0:24 | Macro of the build: Signed in, Reading your account, Writing tools, Testing a real request, each ticking in. The tools card counts to 5, two tagged Needs OK | v05 "ycyc reads your account, writes the tools, and tests a real request." | row-tick per step, counter-grain on the count | rebuilt from build/[connectionId].tsx |
| 6 | s06-live | 0:24-0:27 | The success mark draws, "MyFitnessPal is live". Copy your link pressed (press spring), the URL lifts out of the phone toward camera | v06a "Then one link..." | ding-success, whoosh-soft on the lift | R3 + rebuilt |
| 7 | s07-paste | 0:27-0:31 | The link drops into Claude's connector settings (Add custom connector, paste, Add) | v06b "...goes into every assistant you use." | ui-confirm on Add | R4 |
| 8 | s08-claude | 0:31-0:36 | Same prompt in Claude, the tool call to MyFitnessPal log food. The phone buzzes | v07 "Now Claude can log it. Anything that writes waits for your OK." | phone-buzz | R5 |
| 9 | s09-approve | 0:36-0:40 | The approval card at 3x, thumb taps Approve, the card slides right. Match cut: the eggs and toast row lands in the MyFitnessPal diary. No VO, let it land | (silence) | duck, slam-impact on Approve, row-tick on the diary row | R6 + R7 |
| 10 | s10-chatgpt | 0:40-0:46 | Same link in ChatGPT: "what did I bench last week?" answers from Strong, no setup | v08 "Same link in ChatGPT." | msg-in on the answer | R8 |
| 11 | s11-text | 0:46-0:51 | iMessage (Keiki): "log push day, bench 185 5x5", the agent asks for a yes, "done ✓" | v09 "Or just text it." | msg-sent, msg-in | R9 |
| 12 | s12-more | 0:51-0:56 | The build steps replay faster, 2x, 4x, 8x: Flo, Cronometer, ParkMobile, Duolingo. Each tile does the app's 3D flip to its back, "Live" + "N tools in every assistant" (real counts: Flo 3, Cronometer 6, ParkMobile 10, Duolingo 8; springs.flip). One real tool name flashes per app: log_symptoms, get_daily_nutrition, extend_parking, get_weak_words | v10 "Every app ycyc learns, it learns once, for everyone." | riser-tight building, case-pop per flip | rebuilt from recipes/*.json |
| 13 | s13-endless | 0:56-1:04 | Pull back: the tiles are three of a wall that never ends, each an app glyph + its sentence ("what's due this week across all my classes" Canvas, "who still owes me from Tahoe?" Venmo, "my usual bowl, pickup 12:15" Chipotle, "why was my readiness low?" Oura, "drill the words I keep missing" Duolingo, "make a playlist for my run" Spotify...). Keep pulling until the tiles are the dots of the silk wave | v11 "Flo. Cronometer. ParkMobile. Duolingo. Whatever you open next." | wall-riser, text-tick flurry thinning out | rebuilt + shader |
| 14 | s14-built | 1:04-1:10 | Built today: Capy's merged PRs (#1 Whop paywall, #2 Keiki agent), the Revyl cloud phone session, the Convex activity feed streaming. 2 s each, pushes | v12 "Built today at YC, with Capy, Revyl and Convex." | whoosh-soft per card | real screenshots |
| 15 | s15-end | 1:10-1:18 | The wave calms, the ycyc square carries in, the link icon joins it, "Your apps, in every AI.", github.com/MatthewKim323/ycyc. Hold 3 s, end by subtraction | v13 "ycyc. Your apps, in every AI." | logo-bloom, the pad tail, no final hit | rebuilt |

## Captures (iPhone screen recordings, portrait, 60 fps if possible, drop them in vid/assets/footage/)

- R1 Claude: "log two eggs and toast for breakfast" before ycyc is connected (the refusal)
- R2 ChatGPT, Grok, Claude: the Flo, ParkMobile and Cronometer prompts from shot 2 (the refusals)
- R3 ycyc: Apps → MyFitnessPal → Continue → sign in → build → "is live" → Copy your link
- R4 Claude: Settings → Connectors → Add custom connector, paste the link
- R5 Claude: the same breakfast prompt, now calling ycyc
- R6 ycyc Today: the approval card → Approve
- R7 MyFitnessPal: the diary with the entry
- R8 ChatGPT: "what did I bench last week?"
- R9 iMessage (Keiki): "log push day, bench 185 5x5" → yes → done
- R10 screenshots: Capy PR #1 and #2, a Revyl device session, the Convex dashboard
