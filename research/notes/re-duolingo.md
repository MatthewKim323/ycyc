# Web route: Duolingo

Status 2026-11-15: recipe verified live on matt's account. All 8 read tools pass on the cloud path (plain Node `fetch` from a residential IP, no cookies, no user-agent override). The 6 no-argument reads also pass on the device path (in-page `fetch` from www.duolingo.com with `credentials: "omit"`). There is no write tool (see "Daily goal" below).

## Auth (confirmed live)

- The bearer is the `jwt_token` cookie on `.duolingo.com`. It is **not HttpOnly**: `document.cookie` shows it, so the recorder can read it. It is 145 chars, and its claims are `exp`, `iat` and `sub`. `exp` is in 2169, so the token effectively never expires and needs no refresh. It dies only on logout or a password change.
- The web app sends `Authorization: Bearer <jwt>` on its own calls to `duolingo-leaderboards-prod.duolingo.com`, and the recorder captures that header. Every endpoint below also accepts the header with cookies omitted, which is how the cloud executor calls them.
- **User id:** the numeric id is the JWT `sub` claim. The web app derives it the same way: bundle module `16086` decodes `jwt_token` and reads `sub`.
  - The `logged_out_uuid` cookie equals the same id once the user is signed in (checked live). Despite its name, it works as a fallback that needs no decoding.
  - No same-origin endpoint returns the id without already knowing it. `/users/me` returns 400.
- **Logged-in signal:** the `jwt_token` cookie exists and the `logged_in` cookie is `true`. Signed out, `/learn` redirects client-side to `/` and the sidebar links (`a[href="/leaderboard"]`) are missing.
- **Login page:** `/log-in` (route found in the app bundle; `/login` and `/register` also exist). The site loads reCAPTCHA Enterprise (invisible), and Google sign-in uses GSI, which is blocked in embedded WebViews. Users should sign in with email/username and password.
- CORS: the leaderboards host accepts the `authorization` header from the www origin without cookies (device run).

## SessionBundle

```
headers.authorization = "Bearer " + cookies.jwt_token
storage.userId        = jwt sub   (or cookies.logged_out_uuid)
```

## Endpoints (the recipe)

All on `https://www.duolingo.com` unless noted. `{uid}` is the numeric user id. `fields=` uses `%7B`/`%7D` braces for sub-selection, the same way the web app writes it.

| Tool | Request | Notes |
|---|---|---|
| auth.check | `GET /2023-05-23/users/{uid}?fields=id` | 200 |
| get_streak | `GET /2023-05-23/users/{uid}?fields=streak,streakData{currentStreak,longestStreak,previousStreak},xpGoal,xpGoalMetToday,timezone,trackingProperties{num_item_streak_freeze},shopItems{id,quantity}` | Done today when `xpGoalMetToday` is true or `currentStreak.lastExtendedDate` is today. Freeze count is in `trackingProperties.num_item_streak_freeze`, and also in `shopItems[id=streak_freeze].quantity`. |
| get_profile_summary | `GET /2023-05-23/users/{uid}?fields=username,...,courses{...},trackingProperties{leaderboard_tier_name,leaderboard_league,num_sessions_completed}` | The league name comes from `trackingProperties.leaderboard_tier_name` (e.g. Bronze). |
| get_xp_history | `GET /2023-05-23/users/{uid}/xp_summaries?startDate&endDate&timezone` | Per-day `gainedXp`, `dailyGoalXp`, `numSessions`, `frozen`, `streakExtended`. `date` is UTC midnight of the calendar day. |
| get_courses | `GET /2023-05-23/users/{uid}?fields=currentCourseId,courses{...},currentCourse{...,wordsLearned,pathSectionsSummary{id,index,type,completedUnits,totalUnits,cefr}}` | Without the sub-selection, `currentCourse` is around 30 to 47 KB. |
| get_weak_words | `GET /v2/mistakes/users/{uid}/courses/{courseId}?includeListening=false&includeSpeaking=false&requestType=INBOX` | The mistakes inbox, exact request the web app makes on /learn. Returns `mistakes[].prompt`. Works on a free account. `/count` returns `{numberMistakes}`. |
| get_league | `GET https://duolingo-leaderboards-prod.duolingo.com/leaderboards/7d9f5dd1-8423-491a-91f2-2532052038ce/users/{uid}?get_reactions=true` | `tier` 0-9. `active` is null until the user is placed in this week's cohort. The UUID is the weekly league board the web app calls. |
| get_recent_lessons | `GET /2023-05-23/users/{uid}?fields=xpGains` | `[{xp, skillId, eventType, time}]` |
| get_skill_words | `POST /2017-06-30/users/{uid}/courses/{learning}/{from}/learned-lexemes?limit&sortBy=LEARNED_DATE&startIndex=0` with body `{"lastTotalLexemeCount":0,"progressedSkills":[{"finishedLevels":99,"finishedSessions":99,"skillId":{"id":skill}}]}` | Returns `learnedLexemes[{text, translations, audioURL, isNew}]` and `pagination.totalLexemes`. See below. |

The web app also calls these, but they are not in the recipe:

- Courses and words:
  - `POST .../practice-lexemes` (same body; `{practiceLexemes:[{word, translation, isNew}]}`)
  - `POST .../learned-lexemes/count`
- Profile and goals:
  - `GET /users/{uid}/streak-goal-current`
  - `goals-api.duolingo.com/users/{uid}/progress?timezone=` (daily quests)
  - `/quests`
  - `duolingo-achievements-prod.duolingo.com/users/{uid}/achievements`
  - The full user fetch, which carries around 60 fields
- Ignored as noise: `/api/1/sync/batch` (tracking).

## Gotchas

- **Lexeme endpoints need `progressedSkills`.**
  - With `progressedSkills: []`, both endpoints return nothing. Entries without `finishedLevels` and `finishedSessions` also return nothing.
  - With those fields, only the skill id matters: 1/1 and 99/99 return the same 11 words, matching owlcatraz's note.
  - The full skill list is `currentCourse{skills}`: 310 skills, 47 KB, too big for one tool. So `get_skill_words` takes one skill id, which comes from `get_recent_lessons` or `get_weak_words`.
- **Daily goal.**
  - The web app has no daily goal setting anymore: `/settings/coach` redirects to `/settings/account`.
  - `PATCH /users/{uid}?fields=xpGoal` with `{"xpGoal":20}` returns 200 and `{"xpGoal":10}` on both 2017-06-30 and 2023-05-23. The goal does not change.
  - We tried it once per version, saw the goal stay at 10, and dropped `set_daily_goal`. The account ends unchanged.
- **Rate limiting** is captcha style: a 403 with a `blockScript` payload, not a 429 (duolingo-dash docs). Keep polling light.
- **Datacenter IPs** are untested. Calls from this Mac on a residential IP passed with Node's default user agent. If Convex gets 403 `blockScript`, flip `executor` to `device`. The same templates pass in-page unchanged.
- **API versions.** The web app reads users on `/2023-05-23/` and lexemes on `/2017-06-30/`. Both prefixes serve the user object.

## Confidence

- High: auth, user id, streak, profile, XP history, courses, mistakes, league, recent lessons. All are seen in real traffic and pass live.
- Medium: `get_skill_words`. It passes live, but the `progressedSkills` contract is unofficial.
- Medium: the meaning of `weeklyXp` (it read 10 while today's XP was 12; probably counted from the leaderboard contest start).

## Files

| Path | What it is |
|---|---|
| `recipes/duolingo.json` | The recipe (hand, cloud, verified) |
| `scripts/re/duolingo/capture.ts` | Real capture through Aside with the shared recorder. It also holds `DUOLINGO_CAPTURE`, the in-app capture config. |
| `scripts/re/duolingo/client.ts` | Live run of every tool (`--device` runs them in-page) |
| `scripts/re/duolingo/captures/` | Redacted captures (gitignored; user id, JWT and username scrubbed in-page) |

## Sources

- Live traffic on 2026-11-15:
  - performance resource list on /learn, hooked fetch/XHR on /leaderboard and /quests
  - recorder capture
  - public JS bundle (`app-*.js` on d35aaqx5ub95lt.cloudfront.net): user fields list, lexeme calls, user PATCH, JWT to user id
- csutaria/duolingo-dash `docs/api-map.md` and `src/lib/duolingo.ts`: `/2017-06-30/users/{id}`, `xp_summaries`, `/v2/mistakes/.../count`, JWT `sub`, 403 `blockScript` rate limiting. https://github.com/csutaria/duolingo-dash
- jlopez/owlcatraz `extension/src/lib/duolingo.ts`: `jwt_token` cookie, `learned-lexemes` body and pagination, numbers in `progressedSkills` ignored. https://github.com/jlopez/owlcatraz
