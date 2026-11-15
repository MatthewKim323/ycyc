# yuzu onboarding + connect spec

Research: Mobbin collection "yuzu onboarding" (private to matt's team): https://mobbin.com/collections/b69f79a2-4f4e-46a4-be89-208be7bb4d4c/mobile/screens

Ground rules for the build:
- No account creation. Identity is the device (`src/hooks/user.tsx`), so we skip the auth wall every AI app opens with. That is our fastest-to-value edge: 2 taps from launch to picking an app.
- Shader lives once, in the root layout behind a transparent stack. Never remount it between onboarding screens; dim it with a black overlay instead.
- Shader never sits behind forms, lists or the webview. Legibility wins.
- Icons through the existing `Icon` component (Lordicon). Inter only, tabular figures (`fontVariant: ['tabular-nums']`) for counters.
- Lines marked **(verify)** make a claim. Ship them only if the implementation makes them true.

---

## 1. Onboarding (2 screens, then the connect flow)

### O1. Welcome
- **Layout:** shader full bleed at 100%. Small `yuzu` wordmark centered at top, 24pt below safe area. Headline + sub left-aligned in the bottom third, 16pt gutters. One white pill CTA (52pt tall, full width minus gutters) 16pt above the home indicator. Nothing else on screen.
- **Copy:**
  - Headline (`title`, 34/40 on this screen only): **Your apps, in every AI.**
  - Sub (`body`, textSecondary): **Connect apps that have no API. Use them from Claude, ChatGPT, Grok and Muse.**
  - CTA: **Get started**
- **Motion (first launch only):** shader opacity 0 to 1 over 1200ms `Easing.out(Easing.cubic)`. Then text enters with `withTiming(600, Easing.bezier(0.16, 1, 0.3, 1))`, opacity 0 to 1 + translateY 12 to 0: wordmark at 200ms, headline line 1 at 350ms, line 2 at 430ms (80ms line stagger), sub at 560ms, CTA at 700ms. On return visits render static.
- **Haptics:** none on mount. `impactAsync(Light)` on CTA press.

### O2. How it works
- **Layout:** shader stays, overlay fades to `rgba(0,0,0,0.55)` over 400ms. Headline top-left under safe area + 32pt. Three numbered rows below (24pt number circle, `rowTitle` + one `caption` line), 24pt apart. Same CTA position as O1 so the thumb doesn't move.
- **Copy:**
  - Headline: **Set it up once.**
  - 1. **Sign in to an app** / Right inside yuzu, on its own login page.
  - 2. **We build your connector** / Takes about a minute. You watch it happen. **(verify timing)**
  - 3. **Paste one link into your assistants** / Then ask: log my lunch, what did I bench last week.
  - CTA: **Pick your first app**
- **Motion:** screen transition is a crossfade (`animation: 'fade'`, 250ms), not a slide, so the shader reads as one continuous surface. Headline enters at 0ms, rows use `enter(index)` starting at 120ms (existing 55ms stagger), CTA at 320ms.
- **Haptics:** `impactAsync(Light)` on CTA.

---

## 2. Connect flow

Pick app → pre-sign-in sheet → sign-in → building → live. Steps 3 to 5 run inside ONE full-screen modal with a persistent 3-segment progress bar at top (**Sign in · Build · Live**), 3pt tall, 4pt gaps, white fill on `border` track. Content crossfades inside the modal; the bar never re-renders.

### C1. Pick an app (`(tabs)/library` or first-run route)
- **Layout:** solid black, shader overlay to 1.0 over 300ms then unmount. Large title top-left. Search field under it. 2-column grid of tiles (`surface`, radius 16, 120pt tall): app glyph 40pt top-left, name `rowTitle`, capability line `caption` textTertiary. Apps not ready yet are NOT tiles: list them as plain text under "Coming next" with no chevron, no press state.
- **Copy:** title **Pick an app**. Tile lines: MyFitnessPal / **Food diary, macros** · Strong / **Workouts, sets, PRs** · Flo / **Cycle, symptoms**.
- **Motion:** tiles `enter(index)`. Press: scale 0.97 with `springs.press`, release `springs.release`.
- **Haptics:** `selectionAsync()` on tile tap.

### C2. Pre-sign-in (form sheet over C1)
- **Layout:** `presentation: 'formSheet'`, detent fitted to content (about 52%), grabber on, `surface` background, radius 24. Centered lockup: yuzu mark, small link glyph, app logo (48pt each, 12pt apart). Title centered under it. Two icon rows, left-aligned. CTA pinned bottom.
- **Copy:**
  - Title: **Connect Strong**
  - Row 1 (lock): **Sign in on Strong's own page** / yuzu never stores your password. **(verify)**
  - Row 2 (check): **You approve every change** / Assistants read freely. Logging or editing waits for your OK.
  - CTA: **Continue**
- **Motion:** sheet uses native spring. Lockup: the two logos start 16pt apart further and slide together with `springs.enter` at 150ms after sheet settles, link glyph fades in at 250ms. Rows `enter(index)` from 200ms.
- **Haptics:** `impactAsync(Light)` on Continue.

### C3. Sign in (modal, segment 1 active)
- **Layout:** full-screen modal. Header: close (left), center stack of **Sign in to Strong** (`label`) over the domain with a lock glyph (`micro`, textTertiary). Progress bar under header. Webview fills the rest on the app's own background. No yuzu chrome over the webview.
- **Motion:** segment 1 fills to 33% of its width on mount (shows "you are here"), to 100% the moment login is detected (`withTiming(400, Easing.out(Easing.cubic))`). Then hold 250ms and crossfade to C4 (280ms).
- **Haptics:** `selectionAsync()` when login is detected.

### C4. Building (segment 2 active)
- **Layout:** black. App glyph 64pt centered at 30% height with one soft ring breathing out behind it. Headline centered under it. Step list left-aligned in a column 24pt below. Under the steps, a **Tools** section that fills live as tools are written.
- **Copy:**
  - Headline: **Building your Strong connector**
  - Steps: **Signed in** · **Reading your account** · **Writing tools** · **Testing a real request**
  - Section: **Tools** with a live count on the right (**4**), rows in plain language: **Read workouts**, **Read personal records**, **Log a set** (write rows get a small "Needs OK" tag).
- **Step states:** pending = hollow 16pt ring, textTertiary. Active = ring with a 270° arc rotating (900ms linear loop), text white. Done = filled white circle, black check drawn by stroke (240ms), text drops to textSecondary. Every step dwells at least 600ms even if the backend is faster, so nothing flashes.
- **Motion:** ring behind glyph: scale 1 to 1.35, opacity 0.35 to 0, 1800ms `Easing.out(Easing.quad)`, loop. Tool rows `enter(index)` as they arrive, count ticks with the counter rule below. Segment 2 fill tracks step progress (25% per step).
- **Haptics:** `selectionAsync()` on each step done. Nothing per tool row.

### C5. Live (segment 3 fills)
- **Layout:** same modal. White 72pt circle with black check centered at 30% height. Headline + one example prompt under it. Tools list collapses to a compact summary row. Primary CTA bottom, text button under it.
- **Copy (first connect):**
  - Headline: **Strong is live**
  - Sub: **Ask any assistant: "what did I bench last week?"**
  - Primary: **Copy your link** → morphs in place to **Copied** with a check (holds 1600ms, then **Copy again**).
  - After copy, an inline row slides in above the CTA: **Paste it in your assistant's connector settings.** with a **Show me** button that routes to the Link tab.
  - Text button: **Done** → home feed.
- **Copy (every later connect):** sub **Already in your assistants. Nothing to paste.** Primary: **Done**.
- **Motion:** circle scales 0.6 to 1 with `springs.pop` (see fix below) and opacity 0 to 1 in 200ms. Check stroke draws 320ms starting 120ms in. Headline + sub fade up at 260ms / 320ms. Segment 3 fills over 400ms in parallel. CTA morph: width animates with `springs.layout`, label crossfades 150ms.
- **Haptics:** `notificationAsync(Success)` timed to the end of the check stroke (about 440ms). Copy: `impactAsync(Light)`.

---

## 3. App-wide motion rules

Existing tokens in `src/theme/tokens.ts` are right in spirit (near-critical springs). Keep them, with two changes.

| Token | damping / stiffness / mass | Damping ratio | Use |
|---|---|---|---|
| `press` | 26 / 420 / 0.6 | 0.82 | scale down on touch |
| `release` | 20 / 260 / 0.7 | 0.72 | scale back up |
| `enter` | 22 / 170 / 1 | 0.84 | list items, cards, rows |
| `layout` | 24 / 200 / 1 | 0.85 | reflow, CTA width morph |
| `pop` | **18** / 180 / 0.8 (was 14) | 0.75 | success check only. 14 is 0.58, visibly bouncy |
| `sheet` (new) | 30 / 300 / 1 | 0.87 | custom sheets, approval cards |

- **Durations:** press feedback is spring only. Fades 200 to 280ms (`motion.fade` 280). Crossfades between modal steps 280ms. Hero text 600ms. Nothing interactive over 400ms.
- **Easing for timing:** `Easing.bezier(0.16, 1, 0.3, 1)` for entrances, `Easing.out(Easing.cubic)` for fills and progress, `Easing.in(Easing.cubic)` 200ms for exits. Never linear except spinners.
- **Stagger:** 55ms per item, cap at 8 items (already in `enter`). Headline lines 80ms. Start a list's stagger 120ms after its header.
- **Press:** every pressable uses `PressableScale` at 0.97. Primary pill also drops to opacity 0.92. No highlight colors, no ripples.
- **Screen transitions:** tabs switch instantly. Pushes use the native iOS slide. Onboarding uses fade. Connect uses formSheet (C2) then a full-screen modal (C3 to C5) with internal crossfades.
- **Lists:** entering `enter(index)` on first mount only, not on every refetch. Exiting `FadeOut` 200ms. Siblings reflow with `layout`. New feed items arriving live: enter from translateY -8, plus a background flash `surface2` to `surface` over 1200ms.
- **Counters:** tween the displayed value over 500ms `Easing.out(Easing.cubic)`, tabular figures so width never jitters. Integers only, no decimals mid-tween.
- **Success moments:** check circle + stroke + one Success haptic. Same recipe everywhere (connector live, write approved). No confetti, no particles, no full-screen color floods.
- **Approve / deny:** approve card exits right with `springs.sheet` + `notificationAsync(Success)`. Deny exits left + `impactAsync(Light)`.
- **Do not animate:** tab switches, scroll-linked parallax, body copy on revisit, the webview, values that did not change, color or gradient shifts, skeleton shimmer (use static `surface` blocks). Only two things may loop: the shader and an active-step spinner (plus C4's breathing ring).
- **Reduce Motion:** `useReducedMotion()` swaps every translate for a plain fade and freezes the shader on a still frame.

---

## 4. Patterns to steal (source names stay in this doc only)

- **Branded consent sheet with logo lockup**: two logos side by side, two value rows, one "Agree and continue". Etsy, Stripe Link sheet in "Link a bank account" flow: https://mobbin.com/flows/f0a166e9-2e07-4e60-8601-295fa08e5c62
- **Logo grid in a sheet + fallback row**: 2-column institution tiles, then "Link other institutions". Copilot, "Linking a bank account" flow (screen 2): https://mobbin.com/flows/c57a07bf-6d7d-4c13-8543-1bd24829153c
- **Persistent segmented progress bar across the connect modal + minimal success with one CTA**. Copilot, Plaid success: https://mobbin.com/screens/f7dfef81-680a-4da1-9313-4230a3dc126c
- **Working screen as a live checklist** (done dimmed, active bright, pending dimmed). Rocket Money, "preparing your account": https://mobbin.com/screens/da08a12d-7485-4319-aa2c-579422bd1482
- **Only the active step gets a subline + spinner ring**. Fuse wallet setup: https://mobbin.com/screens/9db2c1f9-6f5f-4620-a9cd-c5ff1af0710e
- **Connector rows**: logo, name, one-line capability, black pill "Connect", floating search pill at the bottom. Claude, Connectors: https://mobbin.com/screens/607ce591-69e1-4815-9e3a-d1b733c693a9
- **Dark full-bleed animated texture welcome**: wordmark center, translucent stacked pills bottom. Grok welcome: https://mobbin.com/screens/28949a4c-b1c8-43f8-b908-a6e78b5e5796
- **CTA morphs to "Link copied" instead of a toast**. Coinbase referral: https://mobbin.com/screens/eb69f90a-5485-4975-8634-bf98898d91c3
- **"What you're sharing" checklist**, adapt as read vs write capabilities. Lloyds account connection: https://mobbin.com/screens/34f27d64-afe8-4b9e-958b-c51559332fea
- **Eyebrow + 3 icon rows + single CTA** for a "how it works" beat. Public, "Start in seconds": https://mobbin.com/flows/c8874c5d-0465-48cd-a63a-74f8e5f2c03d
- **Minimal sheet type scale**: small centered mark, headline, one-line sub, black pill primary. ChatGPT onboarding: https://mobbin.com/flows/a3d88c2e-f61e-4b0c-9b0b-d2f452c2b516
- **Anti-pattern: confetti on connect** (reads cheap against our system). Monarch "Account synced": https://mobbin.com/screens/78b9ebb4-1828-4d06-a440-803b38f8f368
