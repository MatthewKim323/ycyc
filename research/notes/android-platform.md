# Android platform: how a consumer app can let an AI agent read from and act in OTHER apps (state as of 2026-11-14)

Scope note: research done 2026-11-14. Many sources are from 2026 and postdate the model's training, so everything below is taken from fetched pages. Where only secondary or vendor sources exist, that is flagged. "Play-rejected" means technically possible on Android but blocked by Google Play policy for a Play-distributed app.

## Q0. Overall route map for a "connect ANY of your phone apps to your AI" product

### Takeaway
On Android in November 2026 there is exactly one route that reaches arbitrary third-party apps without their cooperation from a normal third-party app: an AccessibilityService. Google Play policy now explicitly forbids using it to "autonomously initiate, plan, and execute actions", which is what an LLM agent does. Google's own sanctioned routes (Computer Control screen automation, AppFunctions) are either restricted to OEM-preloaded, privileged assistants or still experimental and dependent on each target app opting in. For gym and nutrition data, Health Connect is the only fully sanctioned aggregator, but it carries summary data, not app-specific detail.

### Cited Findings
Route-by-route status (each line is detailed with more sources in the sections below):
- **AccessibilityService, LLM agent that plans and acts (Play):** prohibited. Play policy: "any use of this API that enables an app to autonomously initiate, plan, and execute actions is prohibited" (announced 30 Oct 2025). [Play policy announcement, 30 Oct 2025](https://support.google.com/googleplay/android-developer/answer/16550159?hl=en)
- **AccessibilityService, deterministic user-defined macros (Play):** allowed with prominent disclosure, consent and a declaration form with video. Policy allows "rule-based automation, where behavior follows a static, human-defined script". [Play: Use of the AccessibilityService API](https://support.google.com/googleplay/android-developer/answer/10964491?hl=en)
- **AccessibilityService agent distributed outside Play (sideload):** technically works (e.g. Sova AI, self-hosted APK after a Play rejection for "universal automation"), but runs into Restricted Settings, Play Protect fraud blocking in many markets, Advanced Protection on Android 17 and target-app defenses. [Hacker News: Sova](https://news.ycombinator.com/item?id=47613614)
- **MediaProjection screen capture + vision model:** allowed for reading the screen with per-session user consent; it cannot inject input on its own. [Android Developers: Media projection](https://developer.android.com/media/grow/media-projection)
- **Android Computer Control (system screen automation in a virtual display, what Gemini uses):** limited to "OEM-preloaded AI assistants" holding the "privileged `ACCESS_COMPUTER_CONTROL` permission"; in preview with "a limited set of target apps". [Android Developers: Computer Control](https://developer.android.com/ai/computer-control)
- **AppFunctions (on-device MCP-like tools exposed by apps):** Android 16+, experimental; callers need `EXECUTE_APP_FUNCTIONS`; "only a limited number of apps and system agents can access the entire pipeline"; only covers apps that implement it. [Android Developers: AppFunctions](https://developer.android.com/ai/appfunctions)
- **Health Connect:** sanctioned, per-data-type read permissions, built into Android 14+; covers exercise sessions, nutrition, weight, sleep, vitals and more. [Android Developers: Health Connect data types](https://developer.android.com/health-and-fitness/health-connect/data-types); [Android 14 features](https://developer.android.com/about/versions/14/features)
- **Intents / deep links / content providers:** apps targeting Android 11+ can't see other installed apps by default; visibility must be declared with `<queries>`, and `QUERY_ALL_PACKAGES` is approval-gated on Play. [Android Developers: Package visibility](https://developer.android.com/training/package-visibility); [Play: QUERY_ALL_PACKAGES policy](https://support.google.com/googleplay/android-developer/answer/10158779?hl=en)

### Inferences
- Possible and Play-safe: Health Connect reads/writes; launching other apps and passing data through share/launch intents; reading the screen via MediaProjection with consent; user-recorded deterministic macros via accessibility; AppFunctions calls once (and if) the caller permission opens up and target apps implement functions.
- Possible but Play-rejected: an LLM agent that reads the accessibility tree and taps through arbitrary apps on its own (the core "connect ANY app" mechanic).
- Impossible for a third-party app today: Computer Control (privileged, OEM-preload only), `INJECT_EVENTS`-style input injection (system permission, used by Doubao only because it shipped as part of the OS), seeing `FLAG_SECURE` or `accessibilityDataSensitive` content via a non-accessibility-tool service.
- The most viable product shape on Android is a hybrid: sanctioned structured sources (Health Connect, vendor web APIs, AppFunctions where they exist) plus a sideloaded or "power user" accessibility agent with heavy caveats, or an OEM partnership to become a preloaded assistant.

### Gaps
- No source states whether Google will open Computer Control or full AppFunctions calling to Play-distributed third-party agents. 9to5Google reported Google "plan[s] to share more details later this year" (Feb 2026) on developer access, and nothing confirming third-party agent access was found by November 2026. [9to5Google, 25 Feb 2026](https://9to5google.com/2026/02/25/android-appfunctions-gemini/)

## Q1. AccessibilityService: capabilities, Play policy, approvals/rejections, Android 15/16/17 restrictions

### Takeaway
Technically, an AccessibilityService can read the UI tree of the foreground app, tap, type, swipe and screenshot. That is enough to build a general phone agent, and DroidRun hit 91% on AndroidWorld this way. Policy-wise, Play now bans autonomous plan-and-act use, limits the `isAccessibilityTool` flag to disability tools, and requires disclosure, consent and a declaration with video for everything else. Platform-wise, Android keeps adding walls: Restricted Settings for sideloads, sensitive-view hiding, Advanced Protection revocation in Android 17, and Play Protect blocking sideloaded installs that request accessibility.

### Cited Findings
**What it can do (technical)**
- A service declaring `canRetrieveWindowContent` can read window content "represented as a tree of AccessibilityWindowInfo and AccessibilityNodeInfo objects" via `getRootInActiveWindow()`, `getWindows()` and similar calls; nodes "may contain outdated information because the window content may change at any time". `dispatchGesture` will "Dispatch a gesture to the touch screen". [Android reference: AccessibilityService](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService)
- `takeScreenshot` exists with failure codes including `ERROR_TAKE_SCREENSHOT_SECURE_WINDOW` ("the window contains secure content") and `ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT` ("too little time has elapsed since the last screenshot"), so screenshots are rate-limited and `FLAG_SECURE` windows are blocked. [Android reference: AccessibilityService](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService). `takeScreenshot` was added in the Android 11 (R) API diff. [API diff R](https://developer.android.com/sdk/api_diff/r-dp4-incr/changes/android.accessibilityservice.AccessibilityService)
- Real agent example: Sova AI "uses the Accessibility API to read the screen's UI tree and perform taps, scrolls, and typing in other installed apps", with no root, ADB or PC needed. [Hacker News: Sova](https://news.ycombinator.com/item?id=47613614)
- DroidRun reached 106/116 (91.4%) on AndroidWorld in October 2025 "using GPT-5 and direct Accessibility API access". [Droidrun benchmark](https://droidrun.ai/benchmark/); [Mobilerun blog](https://mobilerun.ai/blog/posts/droidrun-achieved-state-of-the-art-performance)
- Sensitive-view hiding: `accessibilityDataSensitive` (API 34 attribute, promoted by Google as an Android 16 defense in Dec 2025) lets apps mark views so that services without `isAccessibilityTool=true` "can't read that view's data or interact with it". Views using `setFilterTouchesWhenObscured(true)` are automatically treated as sensitive. Google recommends it for "login pages, payment flows, and screens showing personal or financial data". [Android Developers Blog, 11 Dec 2025](https://android-developers.googleblog.com/2025/12/enhancing-android-security-stop-malware.html?hl=en); [Guardsquare](https://guardsquare.com/mobile-app-security-research-center/malware/accessibility-data-sensitive)
- Play policy (since Nov 2022, per a Stack Overflow mirror) bars building workarounds that bypass another app's `FLAG_SECURE`. [SO mirror](https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/73421598/access-flag-secure-from-an-accessibility-service)

**Google Play policy (current text)**
- `isAccessibilityTool` eligibility: "Only services that are designed to help people with disabilities access their device". Explicitly non-qualifying: "antivirus software, automation tools, assistants, monitoring apps, cleaners, password managers, and launchers". Qualifying: screen readers, switch-based input, voice-based input, braille. [Play: Use of the AccessibilityService API](https://support.google.com/googleplay/android-developer/answer/10964491?hl=en)
- Autonomy ban: "Any use of the Accessibility API that enables an app to autonomously initiate, plan, and execute actions" is "strictly prohibited"; deterministic "rule-based automation, where behavior follows a static, human-defined script" is allowed. Verified accessibility tools may use autonomous functionality only if it serves their disability-support purpose. [Play: Use of the AccessibilityService API](https://support.google.com/googleplay/android-developer/answer/10964491?hl=en)
- Sensitive-permissions policy page wording: the API cannot "power autonomous decision-making agents"; "Don't use the API to autonomously initiate, plan, and execute actions or decisions"; also prohibited: "Change user settings without their permission", "Work around Android built-in platform security controls, privacy controls and notifications", and deceptive UI changes. [Play: Permissions and APIs that Access Sensitive Information](https://support.google.com/googleplay/android-developer/answer/16558241?hl=en)
- Non-tool requirements: prominent in-app disclosure shown during normal use, separate from other disclosures, with affirmative consent. It "cannot only be in the app description or on a website" or only in a privacy policy. Plus a Play Console declaration and a video showing the disclosure, the consent and non-consent paths, and a core feature using accessibility. Declarations have been required since 3 Nov 2021 for apps targeting API 31. Violations can mean "a suspension of your app" and/or developer account termination. [Play: Use of the AccessibilityService API](https://support.google.com/googleplay/android-developer/answer/10964491?hl=en)
- OpenAlly's reading of the policy: automated actions must be "for a narrow and clearly understood purpose"; the policy example of allowed automation is "If Trigger X occurs, perform Action Y". [OpenAlly blog, Aug 2026](https://openally.ai/blog/how-ai-agents-do-things-on-your-phone)

**Policy timeline**
- 30 Oct 2025: Play announced the Accessibility API update ("clarifies and reinforces existing rules"), with "at least 30 days" to comply. [Play announcement 30 Oct 2025](https://support.google.com/googleplay/android-developer/answer/16550159?hl=en). A third-party blog says the stricter wording took effect 28 Jan 2026 (unconfirmed on Google pages). [MyAppMonitor](https://myappmonitor.com/blog/google-play-accessibility-services-policy-update)
- 29 Oct 2026: Play "Clarified the policy summary on the isAccessibilityTool flag usage and disclosure requirements based on app designation", with enforcement standards that "remain the same". The same announcement adds an AppFunctions policy and agentic-purchase payments guidance. [Play announcement 29 Oct 2026](https://support.google.com/googleplay/android-developer/answer/18100766?hl=en)

**Approvals and rejections of AI-agent apps**
- Sova AI (accessibility-based LLM agent, BYOK): "Google Play rejected our submission" for "universal automation"; now distributed as a self-hosted APK. The HN post is about 7 months old (around April 2026). [Hacker News](https://news.ycombinator.com/item?id=47613614)
- COSMO, an experimental proactive agent using AccessibilityService, was removed from the Play Store; reason not found. [PhoneArena](https://www.phonearena.com/news/google-testing-proactive-android-assistant_id180092)
- The Dec 2025 Google blog says apps that set `isAccessibilityTool=true` without being genuine tools "will be rejected by Google Play and blocked by Google Play Protect". [Android Developers Blog](https://android-developers.googleblog.com/2025/12/enhancing-android-security-stop-malware.html?hl=en)

**Platform restrictions (Android 13 to 17)**
- Restricted Settings (Android 13+) stops users from enabling Accessibility or Notification Listener services for sideloaded apps without an extra manual step, and Android 15 extended it. This comes from a search summary of secondary coverage; no Google page was fetched to confirm it. [Tom's Guide on Android 15](https://www.tomsguide.com/phones/android-phones/android-15-could-feature-extra-security-to-protect-users-from-shady-sideloaded-apps)
- Android 17 Advanced Protection (opt-in): restricts AccessibilityService "exclusively to verified applications categorized as Accessibility Tools". Non-tool apps that already hold the permission are auto-revoked, and users can't grant it while the mode is on. This first appeared in Android 17 Beta 2 (March 2026), and Google formally announced it around 2 Oct 2026. Developers can detect the mode via the `AdvancedProtectionManager` API. [The Hacker News, 16 Mar 2026](https://thehackernews.com/2026/03/android-17-blocks-non-accessibility.html); [The Hacker News, 2 Oct 2026](https://thehackernews.com/2026/10/android-17-advanced-protection-locks.html); [Android Authority](https://www.androidauthority.com/android-17-beta-2-advanced-protection-mode-accessibility-apps-3648860/)
- One hands-on test reports that Advanced Protection also blocks installing APKs from outside verified stores, with no per-app override. [Android Police](https://www.androidpolice.com/advanced-protection-mode-week-test/)
- Play Protect "enhanced fraud protection" blocks installs of internet-sideloaded apps (from browsers, messaging apps or file managers) that request SMS, notification-listener or accessibility permissions. It started as a Singapore pilot and was reported active in 185 markets on about 2.8B devices by early 2026; Malaysia's full rollout followed in April 2026. [Bayton FAQ](https://bayton.org/android/android-enterprise-faq/enhanced-fraud-protection-enterprise/); [Google Malaysia blog](https://blog.google/intl/ms-my/company-news/technology/google-launches-enhanced-protection-in-google/); [Technobezz](https://www.technobezz.com/news/google-blocked-175-million-malicious-android-apps-in-2025-security-push)
- Android developer verification: rules took effect 30 Sep 2026 in four countries. Outlets disagree on whether manual APK installs are covered (Gadget Hacks says direct website APK installs aren't subject to the 30 Sep requirements). [Gadget Hacks](https://android.gadgethacks.com/news/google-android-sideloading-restrictions-sept-30-explained/); [WhistleOut](https://www.whistleout.com/CellPhones/Guides/how-to-sideload-apps-on-android); [Play announcement 30 Oct 2025](https://support.google.com/googleplay/android-developer/answer/16550159?hl=en)

### Inferences
- An app whose core loop is "LLM decides what to tap in Canvas / Hevy / MyFitnessPal" fits the prohibited "autonomously initiate, plan, and execute" description almost word for word. Expect Play rejection, as with Sova. A user-confirmed, step-by-step "agent proposes, user taps approve on each action" design is a grey zone, and no source shows Google approving one.
- Read-only screen understanding (e.g. "summarize what's on screen when I press a button") is not autonomy, and probably passes with disclosure and consent. It is still exposed to `accessibilityDataSensitive` hiding on login, payment and finance screens.
- Sideloading is a shrinking escape hatch: Restricted Settings friction, Play Protect install blocks in most markets, developer verification and Advanced Protection all bite exactly the accessibility-plus-sideload combination.

### Gaps
- No primary source lists AI-agent apps that Google has approved under the post-Oct-2025 wording. I found no confirmed approvals.
- Exact wording of the 29 Oct 2026 `isAccessibilityTool` clarification was not retrieved (the announcement links to the full policy only).
- Per-method API levels (e.g. `dispatchGesture`, `takeScreenshotOfWindow`) and the screenshot minimum interval were not confirmed from the fetched reference excerpt.

## Q2. MediaProjection screen capture + vision models as an alternative

### Takeaway
MediaProjection lets an app capture the full screen or a single app window, with user consent for every session. It's fine for "read what's on screen" with a vision model. But it can't tap or type, so acting still needs accessibility, and it is noisy UX: a consent dialog per session, a prominent status-bar chip, auto-stop on screen lock, and black frames on `FLAG_SECURE` screens.

### Cited Findings
- "Your app must request user consent before each media projection session. A session is a single call to `createVirtualDisplay()`. A `MediaProjection` token must be used only once." On Android 14+, reusing the intent or calling `createVirtualDisplay()` twice throws `SecurityException`. [Android Developers: Media projection](https://developer.android.com/media/grow/media-projection)
- Apps targeting Android 14+ must run capture in a foreground service of type `mediaProjection`. [Android Developers: Media projection](https://developer.android.com/media/grow/media-projection)
- Android 14 QPR2+ offers app screen sharing (a single app window). It excludes the status bar, navigation bar and notifications, and the user can choose a single app rather than the full screen. [Android 14 features](https://developer.android.com/about/versions/14/features); [Media projection](https://developer.android.com/media/grow/media-projection)
- Android 15 QPR1+: a "large and prominent" status bar chip shows during any projection, users can tap it to stop, and projection "automatically stops when the device screen is locked". Sessions also end when another projection starts or the process is killed. [Media projection](https://developer.android.com/media/grow/media-projection)
- Gemini's own screen automation "requires Gemini to take screenshots, which could expose visible information" (reviewer note), which shows the same vision-loop design. [Search summary of S26 coverage, e.g. Android Central](https://www.androidcentral.com/apps-software/gemini-screen-automation-rolling-out-for-galaxy-s26)
- Gemini's Computer Use API supports a "mobile" environment: the model sees a screenshot plus a goal and returns taps, text input, swipes and app launches. Google publishes an Android emulator quickstart for it. Its safety layer marks actions as allowed, requiring confirmation, or blocked. [Phil Schmid guide](https://www.philschmid.de/gemini-android-use); [Gemini API computer use](https://ai.google.dev/gemini-api/docs/computer-use)

### Inferences
- MediaProjection plus a VLM is the most Play-defensible "read any app" path, because it uses no accessibility and requires user consent each session. But it reads only what's currently on screen, so the user (or something else) has to navigate. Pairing it with accessibility-driven input brings back the autonomy-policy problem.
- Each new capture session needs a new consent tap, so persistent background "watching" of other apps isn't practical.
- FLAG_SECURE behavior for MediaProjection (black output) is documented widely but wasn't confirmed by a fetched page here (see Gaps).

### Gaps
- No fetched official page confirms how MediaProjection renders `FLAG_SECURE` windows or which Android 15/16 versions redact OTPs and notifications during projection.

## Q3. AppFunctions, Gemini's app control, Computer Control, and OS-level MCP

### Takeaway
Google is building two official agent hooks into Android:
- **AppFunctions:** apps expose typed tools, described as "on device MCP servers". It is experimental or beta, and works only if each target app implements functions.
- **Computer Control:** the system runs target apps in a secure virtual display that the agent drives from screenshots. Only OEM-preloaded, privileged assistants can use it, and the user approves each app under a new Android 17 "Automation" permission.

Gemini uses both. A third-party Play app can implement AppFunctions as a target, but cannot today be a Computer Control agent, and has no confirmed general access to calling other apps' AppFunctions.

### Cited Findings
**AppFunctions**
- "AppFunctions is an Android platform API with an accompanying Jetpack library to simplify Android MCP integration. It empowers your apps to behave like on device MCP servers." It is available on Android 16+, and is marked "Experimental". [Android Developers: AppFunctions](https://developer.android.com/ai/appfunctions)
- "As of May 2026, AppFunctions integration with Gemini is in a private preview with trusted testers." Callers "must have the `EXECUTE_APP_FUNCTIONS` permission" and "can include agents, apps, and AI assistants like Gemini". FAQ: "only a limited number of apps and system agents can access the entire pipeline". There is an Early Access Program sign-up, and registering does NOT grant access. [Android Developers: AppFunctions](https://developer.android.com/ai/appfunctions)
- Differences vs MCP: "AppFunctions are built-in OS-level hooks exclusive to Android that execute locally", unlike cloud MCP servers. [Android Developers: AppFunctions](https://developer.android.com/ai/appfunctions)
- On 25 Feb 2026 Google detailed AppFunctions plus a "UI automation framework" ("developers can get agentic reach with zero code"). The Gemini app already uses AppFunctions for Calendar, Notes and Tasks, and Samsung Gallery on the Galaxy S26. Google said Android 17 would broaden this to "more users, developers, and device manufacturers" and called it "early, beta stages". [9to5Google, 25 Feb 2026](https://9to5google.com/2026/02/25/android-appfunctions-gemini/)
- Android Dev Summit (around 28 Oct 2026): AppFunctions API now **beta** as "a unified tool-calling layer" using MCP. Also announced: Agentic API **alpha** (ML Kit GenAI, Gemini Nano 4, on-device orchestration loop), A2UI for Compose **alpha**, and Connected Apps Platform **preview**, where "Developers can link their apps via Android MCP or cloud-hosted MCP servers" into Gemini, with 50+ partner integrations (Adobe, Peloton, Experian) live in the Gemini app. [The Decoder, 28 Oct 2026](https://the-decoder.com/google-opens-android-development-to-third-party-ai-agents-and-unveils-new-gemini-apis/)
- New Play policy: AppFunctions must not "deceive or manipulate AI agents, bypass security controls, or interfere with other applications", effective 14 Apr 2027 per the preview policy page. [Play: Permissions/Sensitive APIs](https://support.google.com/googleplay/android-developer/answer/16558241?hl=en); [Play announcement 29 Oct 2026](https://support.google.com/googleplay/android-developer/answer/18100766?hl=en)
- Secondary claim: Gemini task automation reached 40+ apps at Galaxy Unpacked (22 Jul 2026). This is unverified against Google. [LetsDataScience](https://letsdatascience.com/news/google-enables-android-apps-with-appfunctions-for-gemini-8e56077a)

**Computer Control (screen automation)**
- "The Android Computer Control framework allows OEM-preloaded AI assistants to perform task automation on selected apps." An assistant "must have the privileged `ACCESS_COMPUTER_CONTROL` permission". A session covers "up to six target apps for sequential execution", with "one active session at a given time". Target apps run "in a secure background virtual display", and the assistant captures the screen and injects taps, swipes and text. Control can be handed to the user for transaction confirmation. Target apps need no changes ("the assistant app determines how to navigate by analyzing screenshots"). Status: preview, "a limited set of target apps". [Android Developers: Computer Control](https://developer.android.com/ai/computer-control)
- Per a search-result summary of the API reference: only the current ASSISTANT role holder can use it, gated by an agent allowlist and a target-app denylist. [VirtualDeviceManager / Computer Control reference via search](https://developer.android.com/reference/android/companion/virtual/VirtualDeviceManager) (not directly fetched; treat as secondary)
- Android Help "Manage automation controls": "AI assistant apps (such as Gemini or other qualified AI assistants)" can interact with apps through either "direct app functions (background)" or "screen automation". These controls are "available on devices running the latest version of Android 17 and up". Users manage them under Permission manager > Automation, per assistant and per app, with Always allow / Ask every time / Don't allow. Sessions end "after a 60 minute time limit". "By default, assistants cannot automate apps without your explicit approval." [Android Help 18921033](https://support.google.com/android/answer/18921033?hl=en)
- Android Authority first exposed "Computer Control" in Oct 2025 (virtual displays plus virtual input devices). An Android 17 QPR1 Beta 5 teardown found about 37 `computer_control_*` Settings strings. [Android Authority](https://www.androidauthority.com/android-computer-control-feature-3603862/); [NerdsChalk](https://nerdschalk.com/android-17-is-adding-a-settings-screen-to-manage-which-apps-ai-assistants-can-automate-apk-teardown)
- Enterprise: agents in the personal profile can't automate Work Profile apps, and admins can disable AI automation (search summary). [Android Enterprise community](https://www.androidenterprise.community/product-updates/android-17-brings-intelligent-experiences-and-advanced-safeguards-for-enterprise-2705)

**Gemini as a shipping agent**
- 25 Feb 2026: Gemini "screen automation" beta on Pixel 10 and Galaxy S26 (US and Korea). It covers Uber, Lyft, DoorDash, Grubhub, Uber Eats and Starbucks (Instacart coming), runs in a sandboxed virtual window, and stops before the final purchase or booking. [9to5Google](https://9to5google.com/2026/02/25/gemini-automation-android/); [Android Central](https://www.androidcentral.com/apps-software/gemini-screen-automation-rolling-out-for-galaxy-s26)
- 12 May 2026: "Gemini Intelligence", a computer-use agent for phones, first on recent Pixel and Galaxy phones. Purchases require confirmation and a progress bar lets users stop it. [Engadget](https://www.engadget.com/2170770/gemini-intelligence-brings-app-automation-to-android/)
- Nov 2026 leak: Gemini task automation is coming to 134 apps, only on 2026+ Galaxy flagships running Android 17 / One UI 9, and reportedly only for Play-installed apps. [BestAITools, citing Android Authority/SamMobile](https://bestaitools.com/gemini-task-automation-is-coming-to-134-apps-but-only-on-2026-galaxy-flagships). OpenAlly cites a 12GB+ RAM requirement and Fold8/Flip8/Pixel 11 devices. [OpenAlly](https://openally.ai/blog/how-ai-agents-do-things-on-your-phone)

### Inferences
- The Android Help wording "other qualified AI assistants" plus the ASSISTANT-role requirement suggests that a third-party app set as the default assistant might someday qualify. But the developer page says the permission is privileged and OEM-preloaded only, so a Play-installed startup can't use it today without an OEM preload deal.
- AppFunctions is the right long-term "MCP for Android", but coverage depends on Canvas, Hevy, MFP and others each shipping functions. The calling side is gated to a limited set of system agents in the experimental phase. A startup can't rely on it in 2026 for arbitrary apps.
- Google's own app automation is curated: it covers a fixed app list (6 at launch, reportedly 134 later), and it's gated by device, OS version, RAM and region. "Any app" is not even Google's promise.

### Gaps
- Protection level of `EXECUTE_APP_FUNCTIONS` (normal, privileged or role-based) wasn't confirmed by a fetched source.
- No primary Google doc for the "Android MCP" term beyond AppFunctions and the Connected Apps Platform preview.
- No evidence found of Project Astra controlling third-party apps beyond Gemini's screen automation.

## Q4. Open-source on-device agent frameworks, benchmark results, latency and cost

### Takeaway
On the saturated AndroidWorld benchmark (116 tasks, 20 mostly open-source apps), top self-reported agents score 90-100%, above the roughly 80% human baseline. On harder or real-app benchmarks, success drops sharply: MobileWorld's best framework scores 51.7%, and AndroidDaily (94 real closed-source apps) tops out at 62.0%. Real tasks take minutes, and each step takes several to 30 seconds. Cost runs from cents to about $1.50 per task depending on model mix.

### Cited Findings
**Frameworks**
- DroidRun: 91.4% (106/116) on AndroidWorld with GPT-5 via Accessibility API (Oct 2025). An earlier run scored 63.0% with Gemini 2.5 Pro, and a later leaderboard entry lists 0.888 for v0.3.9+AppCards. [Droidrun](https://droidrun.ai/benchmark/); [Mobilerun blog](https://mobilerun.ai/blog/posts/droidrun-achieved-state-of-the-art-performance)
- Minitap (mobile-use): claims 100% on AndroidWorld via multi-agent task decomposition and is open-sourced (self-reported, arXiv 2602.07787). Cost per task was $1.58 with all-frontier models vs $1.07 using a frontier model only for the reasoning-critical agent (OpenRouter pricing, Jan 2026). [arXiv 2602.07787](https://arxiv.org/pdf/2602.07787); [search summary](https://arxiv.org/html/2602.07787v1)
- Open-AutoGLM (Zhipu): open-sourced Dec 2025. It includes AutoGLM-Phone-9B and a multilingual 9B model plus a phone-use framework, and requires an Android phone driven over ADB. [TechNode](https://technode.com/2025/12/09/zhipu-ai-open-sources-autoglm-an-ai-agent-model-capable-of-full-phone-operation/); [GitHub zai-org/Open-AutoGLM](https://github.com/zai-org/Open-AutoGLM)
- Vendor claims: FinalRun 97.4% on AndroidWorld (vendor page) [FinalRun](https://www.finalrun.app/benchmark); Mobilerun reports a 98.34% mean across iOSWorld + AndroidWorld runs [Mobilerun](https://mobilerun.ai/benchmark/)
- Leaderboard aggregators (not authoritative, mixed pass@1/pass@k): AutoGLM-Mobile 80.2%, Human 80% [benchmarklist](https://benchmarklist.com/benchmarks/androidworld/); UI-Venus-2-27B 84.0 [Scholar Compass](https://scholarcompass.net/en/tasks/computer-use-agents/benchmarks/androidworld); Qwen3.5-35B-A3B 0.711 [llm-stats](https://llm-stats.com/benchmarks/androidworld-sr); GLM-5V-Turbo 75.7% [Respan](https://www.respan.ai/models/benchmarks/androidworld)
- Rabbit showed a "generalist Android agent" in research preview only; it was not publicly released. [eWeek](https://www.eweek.com/news/rabbit-ai-agent/)

**Benchmarks beyond AndroidWorld**
- MobileWorld (Dec 2025): 201 tasks across 20 apps, averaging 27.8 steps vs 14.3 in AndroidWorld, with 62.2% multi-app tasks vs 9.5%. It includes agent-user interaction and MCP-augmented tasks. The best agentic framework scored 51.7% and the best end-to-end model 20.9%. The authors call AndroidWorld saturated (>90%). [arXiv 2512.19432](https://arxiv.org/abs/2512.19432)
- AndroidDaily (2026): 350 tasks across 94 real closed-source apps (EN+CN). Results: Gemini 3 Flash 62.0% at 14.7 s/step; Gemini 3 Pro 58.6% at 30.0 s/step; Seed1.8 46.3%; UI-TARS-1.5 (top GUI-specialist) 42.3% at 7.0 s/step. Failure modes: latency-induced misclicks when pop-ups shift targets, 40-minute timeouts, action loops. [arXiv 2605.27761](https://arxiv.org/html/2605.27761)
- Jev-Mobile (preprint, 2026): 79% on full AndroidWorld. Successful tasks took 132.67 s on average (vs 162.63 s for SeeAct-V and 197.21 s for a step-wise VLM), and API cost per successful trajectory was $0.073 (vs $0.19 and $0.27). [arXiv 2609.30186](https://arxiv.org/html/2609.30186v1)
- V-Droid: 4.3 s per step at 59.5% on AndroidWorld (earlier work). [arXiv 2503.15937](https://arxiv.org/pdf/2503.15937)
- Android in the Wild (Google, 2023): 715k episodes, 30k unique instructions, Android 10-13, eight Pixel device types. It is a training/eval dataset for device control. [arXiv 2307.10088](https://arxiv.org/abs/2307.10088)

### Inferences
- AndroidWorld scores overstate real-world reliability for a consumer "any app" product. Real closed-source apps with logins, pop-ups and dynamic content sit around 40-62% for single tasks, and multi-app long-horizon work is around 50% at best.
- At 7-30 s per step and 15-28 steps per task, a typical task takes about 2-14 minutes. That's acceptable for background "fetch my Canvas grades" jobs but poor for interactive chat.
- Most open-source stacks drive the phone via ADB from a PC (Open-AutoGLM) or via an accessibility service (DroidRun Portal, Sova). Neither is a Play-compliant consumer path for autonomous use.

### Gaps
- Primary AndroidWorld numbers for Alibaba Mobile-Agent-v3/GUI-Owl, ByteDance UI-TARS-2 and AppAgent were not retrieved. I recall UI-TARS-2 and Mobile-Agent-v3 at about 73% from 2025 papers, but that is unverified here and should be checked.
- No independently verified, official AndroidWorld leaderboard snapshot for Nov 2026 was found. Top numbers are self-reported on the 116-task set.

## Q5. Health Connect as the aggregator for gym and nutrition data

### Takeaway
Health Connect is built into Android 14+ (and available on Play before that). It is the sanctioned, structured on-device hub: per-type read and write permissions, 30 days of history by default, and extra permissions for older history and background reads. It carries nutrition (about 40 nutrients plus meal type), exercise sessions (including strength training and weightlifting types), weight, body composition, sleep and vitals. Gym apps tend to write only session summaries. Hevy reportedly writes type, duration and energy, while sets, reps and weights stay in the app.

### Cited Findings
- Seven categories: Activity, Body Measurement, Cycle Tracking, Nutrition, Sleep, Vitals, Wellness. Each data type has its own `READ_*`/`WRITE_*` permission (e.g. `READ_NUTRITION`, `READ_EXERCISE`, `READ_WEIGHT`). [Health Connect data types](https://developer.android.com/health-and-fitness/health-connect/data-types)
- Extra read permissions: `READ_HEALTH_DATA_IN_BACKGROUND` for background reads and `READ_HEALTH_DATA_HISTORY` to read data older than 30 days. Apps must complete a Play health apps declaration or users see access errors. [Health Connect data types](https://developer.android.com/health-and-fitness/health-connect/data-types)
- `NutritionRecord`: mandatory fields `startTime`, `endTime`, `mealType`, `metadata`. Aggregates cover energy, protein, carbs, fats (saturated, trans, mono, poly), fiber, sugar, caffeine and about 25 vitamins and minerals. `HydrationRecord` is separate. [Health Connect data types](https://developer.android.com/health-and-fitness/health-connect/data-types)
- `ExerciseSessionRecord`: mandatory `exerciseType`, `segments`, `laps`, and start and end times. Types include `STRENGTH_TRAINING`, `WEIGHTLIFTING`, `CALISTHENICS` and `HIGH_INTENSITY_INTERVAL_TRAINING`. There are also `PlannedExerciseSessionRecord` (training plans), routes, power, speed, heart rate, active/total calories and VO2 max. [Health Connect data types](https://developer.android.com/health-and-fitness/health-connect/data-types)
- Since Android 14, Health Connect is part of the platform and updated via Play system updates. [Android 14 features](https://developer.android.com/about/versions/14/features)
- MyFitnessPal was a Health Connect launch partner and shares and receives exercise data. [Android Developers Blog 2022 (search result)](https://android-developers.googleblog.com/2022/11/leading-health-and-fitness-apps-roll-out-health-connect-integrations.html?hl=es_CL); [Android Authority](https://androidauthority.com/google-health-connect-3164755)
- Hevy: Health Connect integration under Settings > Integrations [Hevy help](https://help.hevyapp.com/hc/en-us/articles/34204824335255). A third-party vendor says Hevy writes completed workouts as activity type, duration and active energy, and that sets, reps and weights stay in Hevy. [Sahha](https://sahha.ai/integrations/hevy/) (vendor, not Hevy docs)
- Cronometer imports biometrics (glucose, BP, body fat, heart rate) and exercise from Health Connect. [Cronometer support](https://support.cronometer.com/hc/en-us/articles/22731903751316-Health-Connect); [Cronometer blog](https://cronometer.com/blog/health-connect)

### Inferences
- For "connect MyFitnessPal/Cronometer/Hevy to your AI", Health Connect gives a Play-legal, no-scraping read of daily nutrition totals or per-meal nutrients (if the source app writes them), workout sessions, weight and sleep. It will not give exercise-level strength detail (per-set weight) or app-specific objects such as MFP food diary names or Hevy routines.
- Health Connect has no Canvas-like (education or productivity) equivalent. Non-health apps need vendor web APIs, AppFunctions or UI automation.

### Gaps
- Whether Strong writes to Health Connect wasn't found.
- Whether MyFitnessPal and Cronometer write detailed per-food `NutritionRecord`s (with names) or only daily totals wasn't confirmed.
- Whether `ExerciseSegment` carries rep counts or load per set wasn't confirmed from a fetched page.

## Q6. Intents, deep links and content providers as structured hooks

### Takeaway
Intents and deep links let an agent launch another app or a specific screen, and share text or files into it. They do not let it read the app's data back. Package visibility (Android 11+) and Play's `QUERY_ALL_PACKAGES` gate even discovering which apps are installed. Exported content providers holding useful user data are rare in consumer apps (no source quantifies this).

### Cited Findings
- Apps targeting Android 11+ get filtered results from `queryIntentActivities()`, `getPackageInfo()` and `getInstalledApplications()`. To see other packages they must declare `<queries>`, and `QUERY_ALL_PACKAGES` is "subject to approval" on Play. Play treats the installed-app list as "personal and sensitive user data". [Package visibility](https://developer.android.com/training/package-visibility)
- `QUERY_ALL_PACKAGES` permitted uses: "device search, antivirus apps, file managers, and browsers". It is disallowed "When the required task can be done with a less broad app-visibility method". Use requires a Permissions Declaration Form, and AI assistants and automation aren't listed. [Play: QUERY_ALL_PACKAGES](https://support.google.com/googleplay/android-developer/answer/10158779?hl=en)
- Perplexity Assistant (Jan 2025, default-assistant replacement) supported a curated set: Uber, Spotify, YouTube, OpenTable, Gmail, messaging and clock. It couldn't reach Slack or Reddit at launch. [9to5Google](https://9to5google.com/2025/01/24/perplexity-assistant-android/); [TechCrunch](https://techcrunch.com/2025/01/23/perplexity-launches-an-assistant-for-android)

### Inferences
- An "any app" agent can enumerate a fixed list of target apps through `<queries>` without `QUERY_ALL_PACKAGES`, open them via launch or deep-link intents, and push content via `ACTION_SEND`. For reading data, intents are a dead end unless the target app exposes an API.
- Curated-integration assistants like Perplexity show the realistic ceiling of the intents route: a handful of apps with known deep links, not "any app".

### Gaps
- No source quantifies how many popular apps expose useful exported content providers or documented deep links. Canvas Student, Hevy, Strong, MFP and Cronometer deep-link schemes weren't researched.

## Q7. Shipping consumer products that drive other apps, and how target apps responded

### Takeaway
Shipping "drive any app" agents fall into three groups:
- **OS-integrated:** Gemini, Doubao on Nubia, Honor YOYO.
- **Curated-integration:** Perplexity.
- **Research previews:** Rabbit.

Target apps fight back when an agent drives their UI. In China, WeChat force-logged-out Doubao users, banks showed warnings, and by Oct 2026, 155 apps (including WeChat, Taobao, Alipay, Meituan and major banks) had formally refused GUI-agent operation under Doubao's own opt-out protocol. The OEMs that avoided conflict (Honor, StepFun) went the cooperative MCP/API route.

### Cited Findings
**ByteDance Doubao Phone Assistant (ZTE Nubia)**
- Nubia M153 launched 1 Dec 2025 at CNY 3,499, for developers and industry only. The assistant holds `INJECT_EVENTS` (normally reserved for system components) and is "configured as part of the OS". WeChat users got "abnormality in the login environment" errors and forced logouts. Agricultural Bank of China and China Construction Bank apps showed pop-ups asking users to disable the AI tool. WeChat said it took no deliberate action. Doubao said it uses the permission only with consent, won't do payments or identity authentication, and doesn't store screen content in the cloud. [Yicai Global, 4 Dec 2025](https://www.yicaiglobal.com/news/wechat-some-chinese-banking-apps-reportedly-restrict-devices-with-bytedances-new-ai-voice-assistant)
- Tencent said its simulated clicks were identified as "automation scripts", and Alipay treated it as an external script. Doubao issued a "Notice Regarding Adjustments to AI Mobile Phone Operation Capabilities" on 5 Dec 2025 restricting those scenarios (search summary). [Business Standard](https://www.business-standard.com/world-news/bytedance-ai-phone-doubao-nubia-zte-app-blocks-user-control-china-125120800459_1.html) (page returned 403; claim via search snippet); [36Kr](https://eu.36kr.com/en/p/3580978646121604)
- WeChat flagged "automated high-frequency clicking" as an abnormal operation trajectory and restricted logins. Tencent reportedly opposes uploading users' screen recordings to the cloud. [36Kr, 15 Jul 2026](https://eu.36kr.com/en/p/3896193801602697)
- SAEP ("Screen Automation Operation Declaration Protocol"): 30-day notice from 14 Sep 2026; non-responders default to allowing operation. The ZTE Nubia NaviX Ultra went on sale 16 Sep. By 14 Oct 2026, 155 apps had refused: 66 Tencent-ecosystem, 23 Alibaba-ecosystem, plus Pinduoduo, Xiaohongshu, Zhihu, DeepSeek, the three telcos, CMB and ICBC. Of the H1 top-10 apps, only Douyin (ByteDance) and JD didn't refuse. [PANews citing Caixin](https://panews.io/articles/01a13cf8-b32e-750e-8074-a39f759f3206). Another newsletter counts 151 apps. [China AI Dispatch](https://chinaaidispatch.substack.com/p/151-apps-refused-bytedances-phone)

**Other OEM and Chinese agents**
- Honor YOYO runs on a "system-level MCP architecture" covering 3,000+ scenarios. It depends on third-party developers adapting interfaces, and "may stop responding" on tasks spanning non-adapted apps. [36Kr](https://eu.36kr.com/en/p/3896193801602697); [36Kr on Honor vs Doubao](https://eu.36kr.com/en/p/3707061911843331)
- StepFun/StepVerse uses a GUI-MCP dual stack: screenshots stay local and only semantic summaries go to the cloud. Its 4B model reportedly operates 200+ apps. Partners are Alipay, Meituan, Didi and JD, not WeChat, Taobao or Douyin. [36Kr](https://eu.36kr.com/en/p/3896193801602697)

**Western products**
- Gemini screen automation and Gemini Intelligence: see Q3. They use a curated app list and stop before payment. [9to5Google](https://9to5google.com/2026/02/25/gemini-automation-android/); [Engadget](https://www.engadget.com/2170770/gemini-intelligence-brings-app-automation-to-android/)
- Perplexity Assistant: default-assistant role with a curated set of app actions. Its CEO said actions "might not always work". [TechCrunch](https://techcrunch.com/2025/01/23/perplexity-launches-an-assistant-for-android); [9to5Google](https://9to5google.com/2025/01/24/perplexity-assistant-android/)
- Rabbit: R1 runs an AOSP-based rabbitOS. Its generalist Android agent was a research preview only, and 2026 reviews say the R1 still doesn't do general app driving. [Wikipedia: Rabbit r1](https://en.wikipedia.org/wiki/Rabbit_r1); [eWeek](https://www.eweek.com/news/rabbit-ai-agent/); [eesel](https://www.eesel.ai/blog/rabbit-ai)
- OpenAlly (Aug 2026) splits its product: the Play app avoids autonomous accessibility use, and a separate sideloaded companion ("Aster") does screen automation. [OpenAlly](https://openally.ai/blog/how-ai-agents-do-things-on-your-phone)

### Inferences
- Pattern: the more an agent looks like a bot to the target app (high-frequency injected clicks, cloud-uploaded screens), the more likely large platforms and banks are to detect and block it. They do this with environment checks, `accessibilityDataSensitive`, `FLAG_SECURE` and ToS. Super-apps with their own AI ambitions also block for competitive reasons.
- Western target apps haven't publicly blocked Gemini, which uses a curated partner list. A third-party agent would face the same anti-bot and accessibility-detection defenses banks already deploy against malware.

### Gaps
- Nothing found on Brain.ai Natural AI, Nothing's agent features, Samsung's own (non-Gemini) agent, or Xiaomi HyperAI agents driving third-party apps.
- No Western app ToS language specifically banning AI agents was retrieved.
- Perplexity's exact Android mechanism (accessibility vs intents) wasn't confirmed.

## Q8. Security and abuse concerns shaping the policy

### Takeaway
Accessibility is the main vector for Android banking trojans. In 2026 the trojans themselves started using LLMs to decide taps. That is why Google keeps narrowing accessibility to certified disability tools, adding view-level hiding, and blocking sideloaded apps that ask for it. A legitimate AI agent built on accessibility is technically indistinguishable from this malware at the API level.

### Cited Findings
- Google: accessibility services "can exploit them to read sensitive data, install malware, or block uninstallation". The API has been abused by "banking trojans and spyware" and is "the main conduit" for malware and fraud. [The Hacker News, Oct 2026](https://thehackernews.com/2026/10/android-17-advanced-protection-locks.html)
- ToxicPanda 2.0 (Zimperium, Aug 2026): 349 financial apps across 16 countries, 167 remote commands. [Malwarebytes](https://www.malwarebytes.com/blog/mobile/2026/08/toxicpanda-2-0-can-take-over-your-android-phone-and-banking-apps); [eSecurity Planet](https://www.esecurityplanet.com/threats/news-toxicpanda-2-android-malware-349-financial-apps/)
- RatHat (Sept 2026): malware that "uses the AI assistant to determine whether it needs to tap or scroll" instead of hardcoded scripts. [Malwarebytes](https://www.malwarebytes.com/blog/news/2026/09/new-android-malware-uses-ai-to-steal-bank-log)
- Zimperium (Apr 2026): four campaigns targeting 800+ apps through overlays, Accessibility and sideloaded fake apps. [Zimperium](https://zimperium.com/blog/android-bankers-4-campaigns-in-a-row); [TechRepublic](https://techrepublic.com/article/news-android-malware-stealing-pin-overlay-attack)
- Group-IB: RemControl (since Jul 2026) and Mirax (Mar to Sep 2026, thousands infected) both hinge on the Accessibility permission. [Group-IB RemControl](https://www.group-ib.com/blog/remcontrol-android-banking-trojan/); [Group-IB Mirax](https://www.group-ib.com/blog/mirax-android-device-takeover-rat/)
- A Korean banking-security SDK developer says "Android has no good way to tell malicious automation from legitimate automation". They call the Play restriction "a bit blunt" and note Gemini has system-level access third parties can't request. [HN comment](https://news.ycombinator.com/item?id=47613614)
- Google is adding dynamic monitoring for accessibility overlay abuse on Android 17, with rollout planned later in 2026 (secondary). [VPN Central](https://vpncentral.com/?p=250149)

### Inferences
- The policy direction is one-way: each Android release since 13 has narrowed accessibility for non-disability apps. A business that depends on accessibility-driven autonomy is betting against Google's stated security roadmap.
- Banking, finance and payment screens are the most likely to be invisible to a non-tool accessibility agent (`accessibilityDataSensitive`, `FLAG_SECURE`), and the most likely to carry anti-automation checks. Fitness and LMS apps are less likely to, but no source confirms this.

### Gaps
- No aggregate 2026 statistic (e.g. share of Android malware abusing accessibility) from Kaspersky or Google was found. Only per-campaign vendor counts.
