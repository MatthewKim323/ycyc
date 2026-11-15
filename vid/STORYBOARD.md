# Storyboard: "Your apps, in every AI" (the ultimate cut, 2026-11-15)

~78 s, 1920x1080, 30 fps (render 60). VO at ~130 wpm, ~125 words. Unlisted YouTube with captions on.
Built from storyline A (the real loop as an object-to-object chain), plus an endless-zoom section where the
connected apps turn into the dots of the app's own silk wave: every dot is an app.

Rules: product on screen by 0:02. A new picture every 2-4 s. Real phone captures for anything that claims the
product works; macro shots rebuilt only from the app's code, with its real labels. On-screen text never repeats
the VO word for word, except the brand line. Apps are shown as their glyph plus name, as in the app (Lordicons only).

## Shots

| # | Time | Picture | VO | Source |
|---|---|---|---|---|
| 1 | 0:00-0:04 | Macro on a real phone: Claude chat. "log two eggs and toast for breakfast" sent. Reply: can't access MyFitnessPal. Push in on the refusal | "Ask your AI to log breakfast... and it hits a wall." | R1 |
| 2 | 0:04-0:09 | Three more walls, 1.2 s each, cut on the beat: ChatGPT can't reach Flo ("log cramps and spotting"), Grok can't reach ParkMobile ("extend my parking 30 min"), Claude on Cronometer ("am I low on magnesium this week?") | "Most of the apps you live in have no API. Your AI can't touch them." | R2 |
| 3 | 0:09-0:13 | Suck-out. The refusal bubbles shrink to dots and fall into the silk wave (intro bloom). The ycyc mark lands, then "Your apps, in every AI." | "ycyc connects them. Even the ones with no API." | rebuilt + shader |
| 4 | 0:13-0:17 | Pick an app: the tile grid, MyFitnessPal tapped (tap ring, push follows the tap). The connect sheet rises: ycyc square slides into the MFP glyph | "Pick an app. Sign in on its own page." | R3 + rebuilt macro |
| 5 | 0:17-0:24 | Watch it build, macro: Signed in, Reading your account, Writing tools, Testing a real request. The tools card counts to 5, two tagged Needs OK | "ycyc reads your account, writes the tools, and tests a real request." | rebuilt from build/[connectionId].tsx |
| 6 | 0:24-0:27 | Success mark draws, "MyFitnessPal is live". Copy your link pressed, the URL lifts out of the phone | "Then one link..." | R3 + rebuilt |
| 7 | 0:27-0:31 | The link drops into Claude's connector settings (paste, Add) | "...goes into every assistant you use." | R4 |
| 8 | 0:31-0:36 | Same prompt in Claude. A tool call to myfitnesspal log_food. The phone buzzes | "Now Claude can log it. Anything that writes waits for your OK." | R5 |
| 9 | 0:36-0:40 | The approval card at 3x, thumb taps Approve (the one big hit), the card slides right. Match cut: the eggs and toast row lands in the MyFitnessPal diary. No VO, let it land | (silence, hit) | R6 + R7 |
| 10 | 0:40-0:46 | Same link in ChatGPT: "what did I bench last week?" answers from Strong. No setup | "Same link in ChatGPT." | R8 |
| 11 | 0:46-0:51 | iMessage: "log push day, bench 185 5x5". The agent asks for a yes, "done ✓" | "Or just text it." | R9 (Keiki) |
| 12 | 0:51-0:56 | Endless, part 1: the build steps replay faster and faster, 2x, 4x, 8x, for Flo, Cronometer, ParkMobile. Each tile does the app's 3D flip to Live (or "Next") | "Every app ycyc learns, it learns once, for everyone." | rebuilt |
| 13 | 0:56-1:04 | Endless, part 2: pull back. The tiles are three of a wall that never ends, each tile an app plus its sentence: "what's due this week across all my classes" (Canvas), "who still owes me from Tahoe?" (Venmo), "my usual bowl, pickup 12:15" (Chipotle), "why was my readiness low?" (Oura), "drill the words I keep missing" (Duolingo)... Keep pulling until the tiles are the dots of the silk wave | "Flo. Cronometer. ParkMobile. Whatever you open next." | rebuilt + shader |
| 14 | 1:04-1:10 | Built today: Capy's merged PRs (#1 paywall, #2 Keiki), the Revyl cloud phone, the Convex activity feed streaming, 2 s each | "Built today at YC, with Capy, Revyl and Convex." | real screenshots |
| 15 | 1:10-1:18 | End card: the wave calms, the ycyc square carries in, the link icon joins it, "Your apps, in every AI.", github.com/MatthewKim323/ycyc. Hold 3 s, end by subtraction | "ycyc. Your apps, in every AI." | rebuilt |

## Captures needed (iPhone screen recordings, portrait, 60 fps if possible)

- R1 Claude: "log two eggs and toast for breakfast" before ycyc is connected (the refusal)
- R2 ChatGPT, Grok, Claude: the Flo, ParkMobile and Cronometer prompts above (the refusals)
- R3 ycyc: Apps → MyFitnessPal → Continue → sign in → build → "is live" → Copy your link
- R4 Claude: Settings → Connectors → Add custom connector, paste the link
- R5 Claude: the same breakfast prompt, now calling ycyc
- R6 ycyc Today: the approval card → Approve
- R7 MyFitnessPal: the diary with the entry
- R8 ChatGPT: "what did I bench last week?"
- R9 iMessage (Keiki): "log push day, bench 185 5x5" → yes → done

## Open

- Flo, Cronometer, ParkMobile: Live or "Next" in shot 12 (only real status goes on screen)
- Voice: Chris (casual) or Brian (deep narrator)
- Music: Skarl temp bed or a free track
