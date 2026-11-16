# Profile and account spec

Research: Mobbin collection "yuzu profile" (6 screens). Source apps are never named in the UI.

## What the best apps do
- **Entry point.** An avatar or monogram in the top corner of the home screen, 32 to 36 pt, opens the account surface. Assistant apps put it top-left next to the drawer; consumer apps with a large title put it top-right, level with the title. We have a large "Today" title, so: top-right, centered on the title baseline.
- **Transition.** The account surface opens as a page sheet (card stack: the home screen scales back and dims) with an X or drag-to-dismiss. Push is reserved for subpages. Sheet reads as "your stuff, on top of the app", which is the right weight for us.
- **Header.** Big centered avatar (72 to 96 pt), name, then one muted line: email plus a plan pill. A Google photo when signed in; a monochrome monogram otherwise. Name is edited in place, not on a separate page.
- **Stats.** 2 to 4 numbers in equal tiles, big tabular figures, short labels under them. Streak and points sit together. Numbers count up on open.
- **Grouping.** Inset rounded groups on a black page with a small label above each: identity, your stuff, plan, settings, then account actions. Rows: title left, value right, chevron only when the row navigates.
- **Destructive actions.** Sign out and Delete live at the very bottom, in their own group, red text. Delete always confirms in a sheet with the consequence in one sentence and a red primary action; Cancel is equal width or a quiet text button.
- **Plan.** Free users see an Upgrade row; paid users see the plan name only.

## yuzu profile (top to bottom)
1. Close (BackButton, left) in a 48 pt bar.
2. Avatar 88 pt, scales in from 0.7 with the enter spring. Name (tap to edit, inline field, layout spring). Email or "Not signed in". Plan pill.
3. Sign in with Google row, only when the Clerk hook is configured and the user is signed out.
4. Stats: Apps, This week, Streak, XP. Count up over 700 ms.
5. Your apps: logo strip, each logo opens /app/<slug>.
6. Your assistants: names from activity, row opens the Link tab.
7. Plan: Free with Upgrade (opens /paywall) or Pro.
8. Settings: Approvals default (Ask every time / Allow for an hour, expands in place), Weekly recap (switch), Export my data (iOS share sheet), Privacy line "yuzu never stores your passwords".
9. Sign out (signed in only). Delete account (red), confirm sheet, then wipe and route to onboarding.

## Motion
- Staggered entrance per section (55 ms), enter spring, everything respects Reduce Motion.
- Press 0.97 with a selection haptic; destructive confirm uses a warning haptic.
- Name edit: field and text swap inside one Animated.View with the layout spring.
