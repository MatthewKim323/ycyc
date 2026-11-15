# iOS platform routes for a "connect any of your phone apps to your AI" consumer app (state as of 2026-11-15)

Scope note: Apple primary sources (newsroom, developer docs, App Review Guidelines) were fetched directly for the 2026 facts. Items marked "(search summary)" come from search-result summaries rather than a direct page read. Items from before 2025 are flagged as possibly dated.

## 1. App Intents and Shortcuts: how much of the ecosystem is exposed, can one app call another app's intents, and does shortcuts:// x-callback-url work as a data bridge?

### Takeaway
App Intents is the only sanctioned way a third-party app exposes actions and data to the rest of the system, but those intents are exposed to Apple's surfaces (Siri, Spotlight, Shortcuts, widgets), not to other apps. No public iOS API lets one app enumerate or directly invoke another app's intents. The only app-to-app bridge is a user-built shortcut launched via `shortcuts://x-callback-url/run-shortcut`, which visibly opens the Shortcuts app, returns only text output, and requires the user to have installed or created a shortcut with a known name.

### Cited Findings
- URL scheme format: `shortcuts://x-callback-url/run-shortcut?name=...&input=text&text=...&x-success=...&x-cancel=...`. When the shortcut finishes, Shortcuts opens the x-success URL and appends a `result` parameter containing the shortcut's text output; if the shortcut is stopped early no output is returned. [Apple Shortcuts User Guide: Use x-callback-url](https://support.apple.com/guide/shortcuts/apdcd7f20a6f/)
- `result` only appears if the shortcut produces output; errors go to `x-error` with an `errorMessage` parameter. [supersonicbyte blog](https://supersonicbyte-blog.pages.dev/blog/shortcuts-url-scheme); [r/shortcuts tip](https://cal1.lr.ggtyler.dev/r/shortcuts/comments/y5f119/ios_tip_using_xcallbackurl_to_make_shortcut_keep)
- An app can run another app's shortcuts only by name through the deep link; "there's no way for you to retrieve a list of the user's shortcuts" and the deep link "has to open the Shortcuts app in order to work." (Article dated Oct 2018 / iOS 12, possibly dated, but no newer enumeration API was found.) [SwiftRocks](https://swiftrocks.com/running-other-apps-siri-shortcuts-through-deep-links-in-swift)
- On macOS, the `shortcuts` command-line tool allows programmatic runs; the open-source `intents-mcp` project exposes a Mac's App Intents as MCP tools through Shortcuts, "Public APIs only", tested on macOS 27.0. This has no iOS equivalent. [GitHub: VladUZH/intents-mcp](https://github.com/VladUZH/intents-mcp) (search summary)
- Existing "Shortcuts as MCP tools" products are Mac-based: community MCP servers that trigger Shortcuts on macOS, and a ChatGPT connector ("ShortcutsBridge") that relays requests to a Shortcuts agent on the user's Mac. No App Store iPhone app doing this standalone was found. [mcpservers.org: shortcuts-mcp-server](https://mcpservers.org/de/servers/artemnovichkov/shortcuts-mcp-server) (search summary)
- WWDC25 (iOS 26): Shortcuts gained a "Use Model" action that sends prompts to the on-device model, Private Cloud Compute model, or ChatGPT, and can return structured output (a native dictionary) usable by other actions; requires iPhone 15 Pro or later. [WWDC25 session 260](https://developer.apple.com/videos/play/wwdc2025/260/); [AppleInsider](https://appleinsider.com/articles/25/06/16/apple-says-theres-no-chatbot----but-shortcuts-in-ios-26-says-otherwise); [Matthew Cassinelli](https://matthewcassinelli.com/ios-26-public-beta-shortcuts-actions-apple-intelligence-messages-notes-checklists/)
- WWDC26 (iOS 27): Use Model gets the latest Apple Intelligence models with web retrieval and a transcript inspector showing exactly what App Intent entity data is passed to the model; new automation triggers for screenshot, keyboard connection and notification, the last supporting "fine-grained, keyword-filtered triggers based on notification content"; new Storage actions with iCloud-synced global values. [Matthew Cassinelli: WWDC26 What's New in Shortcuts](https://matthewcassinelli.com/wwdc26-sessions-whats-new-in-shortcuts/)
- A developer reports that both App Intents and SiriKit require the app's name in the Siri invocation phrase (pre-Siri AI behavior). [Apple Developer Forums 798123](https://developer.apple.com/forums/thread/798123) (search summary)
- App Review 2.5.11: apps "should only sign up for intents they can handle without the support of an additional app"; Siri aliases "should not be generic terms or include third-party app names or services." [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- Target-app coverage spot checks: a third-party listing says Strong supports Siri Shortcuts and has no public API [macmyths: Strong](https://macmyths.com/apps/strong/); an undated Hevy App Store review asks for Shortcuts and API integration, suggesting Shortcuts support was missing at the time [Hevy App Store listing](https://apple.co/2VvCsFt) (search summary).

### Inferences
- A "Shortcuts bridge" architecture is possible and App Store safe: the AI app ships a gallery of iCloud shortcut links that wrap each target app's exposed actions, the user installs them, and the AI app calls them by name with x-callback-url and parses the text `result` (JSON-encode in the shortcut). Limits: works only for apps that already expose App Intents actions; every call flips the screen to Shortcuts and back (foreground only, no background agent loop); no discovery of what is installed; brittle to renames. It cannot reach apps with no Shortcuts actions.
- The iOS 27 notification automation could let a user configure an automation that forwards a matching app notification's text into the AI app (for example via Storage or a file), giving a user-configured read path for notification content. This is speculative and needs a hands-on test.
- Because Siri is the only consumer of other apps' intents, the realistic platform-native play is to be something Siri calls (expose your own App Intents) or something Siri delegates to (see section 2), not something that calls other apps.

### Gaps
- No reliable statistic was found on what share of App Store apps (or top-N apps) expose App Intents / Shortcuts actions.
- Not verified whether Canvas Student, Hevy, MyFitnessPal or Cronometer currently ship App Intents actions, or what data those actions return.
- No evidence found of any iOS 27 API that lets a third-party app run shortcuts in the background or read the user's shortcut library.

## 2. Apple Intelligence / Siri: personal context, on-screen awareness, in-app actions, and MCP (WWDC 2025, WWDC 2026, iOS 26.x, iOS 27)

### Takeaway
The 2024-promised personal Siri slipped out of iOS 26.4 and arrived as "Siri AI" in iOS 27 (shipped Sept 14, 2026, in beta, English first, not on EU iPhones, not in China). Siri AI does personal context, on-screen awareness and cross-app actions, but only Siri drives them. Custom third-party actions are in a developer preview (iOS 27.3 beta, Nov 3, 2026) that cannot ship to App Store users until spring. There is still no public system-level MCP on iOS: Apple shipped MCP only in Xcode 27 and in Keynote/Pages/Numbers on macOS 27. A hidden "model delegation" mechanism lets a third-party model sit behind Siri, but Apple had not opened that entitlement to third parties as of Sept 2026.

### Cited Findings
**Timeline 2025 to early 2026**
- Code in the iOS 26.1 / macOS Tahoe 26.1 betas (Sept 2025) showed early groundwork for MCP inside the App Intents framework; it was not a user-facing feature. [9to5Mac](https://9to5mac.com/2025/09/22/macos-tahoe-26-1-beta-1-mcp-integration/); [AppleInsider](https://appleinsider.com/articles/25/09/22/ios-26-could-get-a-major-ai-boost-with-the-model-context-protocol)
- Heise reported the code did not indicate MCP would ship directly with iOS 26.1. [heise](https://heise.de/-10670566) (search summary)
- Feb 2026: Gurman reported the personalized Siri would not ship in iOS 26.4; the ability to "tap into personal data" and "voice-based control of in-app actions" were among features pushed to 26.5 or iOS 27. [MacRumors, Feb 11 2026](https://www.macrumors.com/2026/02/11/siri-features-delayed-ios-26-4/); first iOS 26.4 beta shipped without them [MacRumors, Feb 17 2026](https://www.macrumors.com/2026/02/17/ios-26-4-no-new-siri-features/)

**WWDC 2026 (June 8, 2026)**
- Apple announced "Siri AI" with world knowledge, personal context, on-screen awareness and "systemwide app actions." Personal context "extends to third-party apps when developers integrate with Spotlight." Siri AI uses the system orchestrator to reach "the Spotlight index and App Toolbox," which run on device. [Apple Newsroom, June 8 2026](https://www.apple.com/newsroom/2026/06/apple-introduces-siri-ai-a-profoundly-more-capable-and-personal-assistant/)
- That release does not mention MCP, third-party chatbot extensions, or letting third parties plug in models. [Apple Newsroom, June 8 2026](https://www.apple.com/newsroom/2026/06/apple-introduces-siri-ai-a-profoundly-more-capable-and-personal-assistant/)
- Developer release: "Updates to the App Intents framework enable developers to connect their apps to Siri AI capabilities" (personal context, app actions, on-screen awareness). MCP is mentioned only for Xcode 27 plug-ins ("bring in the tools they use every day through the Model Context Protocol") plus Agent Client Protocol support in Xcode. Foundation Models framework gets server models, image input and custom skills; developers can use other providers' models (Claude, Gemini) via "the new language model protocol"; new Core AI framework for on-device custom models. No general API for one app to read another app's data or trigger its actions is described. [Apple Newsroom, June 8 2026](https://www.apple.com/newsroom/2026/06/apple-aids-app-development-with-new-intelligence-frameworks-and-advanced-tools/)
- A developer GitHub issue states WWDC26's MCP support is Xcode-only and there is no public system-level MCP or chatbot "Extensions" API in 27.0. [GitHub: cedricziel/folio #350](https://github.com/cedricziel/folio/issues/350) (search summary). Some SEO blogs claim system-wide MCP in iOS 27; no Apple source supports that claim. [SoftwareSeni](https://www.softwareseni.com/why-apple-is-retiring-sirikit-and-what-app-intents-means-for-developers/) (treat as unreliable)
- Several secondary sources say SiriKit was deprecated at WWDC26 in favor of App Intents. [SoftwareSeni](https://www.softwareseni.com/why-apple-is-retiring-sirikit-and-what-app-intents-means-for-developers/) (secondary, not verified against Apple docs)

**What shipped (iOS 27, Sept 14 2026)**
- Siri AI "begins rolling out today in beta in English" across iOS/iPadOS/macOS/watchOS/visionOS 27; French, Japanese, Korean, Portuguese, Spanish "coming next month." Not available initially in the EU on iOS/iPadOS/watchOS; not available in China. Server-side features have daily usage limits, with expanded access "available for a fee in the future"; not available to users under 13. [Apple Newsroom, Sept 2026](https://www.apple.com/newsroom/2026/09/siri-ai-a-profoundly-more-capable-and-personal-assistant-is-here/)
- At launch Siri AI "already works seamlessly" with some third-party apps (WhatsApp messaging, Audible playback), with Outlook, Notability and Tripsy "soon." [Apple Newsroom, Sept 2026](https://www.apple.com/newsroom/2026/09/siri-ai-a-profoundly-more-capable-and-personal-assistant-is-here/)
- Siri AI device support: iPhone 16 or later and iPhone 15 Pro/Pro Max (plus M1+ iPad/Mac, etc.). [Apple Newsroom, June 8 2026](https://www.apple.com/newsroom/2026/06/apple-introduces-siri-ai-a-profoundly-more-capable-and-personal-assistant/)

**Third-party app access to Siri AI (Nov 2026, announced but not shippable)**
- Nov 3, 2026: Apple opened a "Siri AI Developer Preview" in the iOS/iPadOS/macOS/visionOS 27.3 betas. Siri can handle custom actions and content beyond the system schema domains; requests need not name the app when it is foreground, has a Live Activity, or is in the conversation; background apps must be named; "Requests can include actions across apps" (e.g., find favorite sneakers in one app, look up the partner in Contacts, send via a messaging app). [Apple Developer Documentation: Siri AI Developer Preview](https://developer.apple.com/documentation/appintents/siri-ai-developer-preview)
- "Siri can only find custom content and perform custom actions an app makes explicitly available using App Intents." Intents become Siri tools via the `@AppIntent(...)` macro / `ToolIntent` protocol; entities via `GenerableEntity`, `@AppEntity`, `@ComputedProperty`, `@DeferredProperty`; responses render as developer-provided `CardSnippet` views; "app skills" guide multi-step tasks; Xcode adds a Siri Integration Advisor and a SiriEvaluations framework. [Apple Developer Documentation: Siri AI Developer Preview](https://developer.apple.com/documentation/appintents/siri-ai-developer-preview)
- The preview "isn't available to external testers in TestFlight or to versions of your app that you publish on the App Store"; API "may change." [Apple Developer Documentation: Siri AI Developer Preview](https://developer.apple.com/documentation/appintents/siri-ai-developer-preview)
- 9to5Mac: app skills are "only an early developer preview" and are "scheduled to officially roll out in the spring." [9to5Mac, Nov 3 2026](https://9to5mac.com/2026/11/03/developers-can-now-create-advanced-app-skills-for-siri-ai/); Apple announcement [developer.apple.com news](https://developer.apple.com/news/?id=gdk2umrf); app skills doc [Orchestrating complex actions with app skills](https://developer.apple.com/documentation/appintents/orchestrating-complex-actions-with-app-skills). A secondary post says app skills are a trimmed SKILL.md (Markdown with frontmatter) format. [DEV Community](https://dev.to/gabrielanhaia/siri-ai-opens-to-every-app-in-the-ios-273-beta-its-app-skills-are-skillmd-files-4dc5) (secondary)

**Third-party AI models behind Siri ("Extensions" / model delegation)**
- March 2026: Bloomberg reported Apple planned to let rival chatbots integrate with Siri in iOS 27. [MacRumors, Mar 26 2026](https://www.macrumors.com/2026/03/26/apple-ios-27-siri-chatbot-integration/) (search summary)
- June 2026: Extensions was missing from the WWDC keynote; Gurman said a settings panel and App Store section were already built in beta 1. [MacRumors, June 15 2026](https://www.macrumors.com/2026/06/15/three-unannounced-ios-27-features-are-still-coming/) (search summary)
- Sept 14 2026: code found in iOS 27 / macOS 27 private frameworks shows "Model Delegation" (a third-party model appears as a Siri extension via an "Ask..." menu and hands system tasks back to Siri) and an "Inference Providing" protocol where a provider can replace Apple's server Siri model, receiving "Apple's native Siri planner prompt and tool definitions" and personal data. Apple "has not yet opened up the model delegation entitlement to third parties"; "Ask..." is "currently limited to the ChatGPT extension." [MacRumors, Sept 14 2026](https://www.macrumors.com/2026/09/14/siri-can-be-swapped-out-for-chatgpt-claude/)

**Apple's own MCP shipments (not OS-level)**
- Oct 27 2026: Keynote, Pages and Numbers add "Model Context Protocol (MCP) support" so "external AI agents and tools [can] read content, perform edits, and execute automated actions"; footnote: MCP "requires macOS 27 or later" (no iOS/iPadOS MCP mentioned); arrives in November for Apple Creator Studio subscribers. [Apple Newsroom, Oct 27 2026](https://www.apple.com/newsroom/2026/10/apple-creator-studio-adds-powerful-new-ai-features-and-even-more-creative-tools/)

### Inferences
- As of Nov 2026, a third-party AI assistant app on iOS cannot use Siri AI's App Toolbox, personal context, or on-screen awareness; these are Siri-only. The only plausible future route for a third-party AI to drive other apps' intents through the OS is the model delegation / inference provider mechanism, which is entitlement-gated, not open, and appears built for large model vendors (ChatGPT first).
- The 26.1 MCP code never surfaced as a public iOS API; Apple's 2026 MCP use is developer tooling (Xcode) and per-app servers on macOS (iWork). For iOS, "App Intents as tools for Siri" is Apple's functional equivalent of MCP, but the client is Siri, not your app.
- Timeline risk: custom third-party Siri AI actions reach App Store users "in the spring" (likely 2027), and only for apps whose developers adopt them, so even Siri's own reach into Canvas/Hevy/MFP-type apps depends on those vendors.
- For the product pitch, the most defensible iOS-native move is to expose the product's own App Intents/app skills so Siri AI can call it, and to apply for model delegation if Apple opens it.

### Gaps
- No Apple statement found on whether or when the model delegation / Extensions entitlement will open to third parties, or under what criteria.
- Not confirmed whether any personal Siri features shipped in iOS 26.5 (evidence suggests they arrived with iOS 27 instead).
- Whether the Siri AI "spring" App Store date means spring 2027 is not stated explicitly by Apple in the sources read.

## 3. Accessibility/automation APIs, XCUITest/WebDriverAgent/Appium, and ReplayKit screen capture

### Takeaway
iOS has no Android-AccessibilityService equivalent: a third-party app cannot read another app's view tree or inject taps. XCUITest/WebDriverAgent can drive any app's UI, but only as a developer test runner built and launched from a Mac with Xcode, not as an App Store feature. ReplayKit broadcast extensions are the only way to see other apps' pixels, read-only, user-started, with a persistent recording indicator, a roughly 50 MB extension memory cap, and Apple DTS calling the UX a poor fit for "helper" use.

### Cited Findings
- Apple DTS (Quinn, Mar 2026) on background OCR of other apps: ReplayKit is "the only option for this sort of thing on iOS" (ScreenCaptureKit is macOS-only); "I don't think you'll be able to make progress on this. Broadcast extensions were designed for... broadcasting, and the user experience reflects that"; unsure whether a broadcast extension can persist in the background, recommends prototyping; DTS does not advise on App Review. [Apple Developer Forums 818940](https://developer.apple.com/forums/thread/818940)
- A forum user in that thread notes the persistent red recording indicator creates a "surveillance" perception; the same user (not Apple) suggests a keyboard extension that analyzes context in the text field as an alternative. [Apple Developer Forums 818940](https://developer.apple.com/forums/thread/818940)
- Another developer (rideshare income app) states a Broadcast Upload Extension "is not intended for background processing" and "there is no overlay across apps on iOS," asking for any supported path to read on-screen text with consent. [Apple Developer Forums 844393](https://developer.apple.com/forums/thread/844393) (search summary)
- Broadcast Upload Extensions run with a roughly 50 MB memory cap enforced by jetsam; large iPad frames can push ReplayKit over it; common workaround is to keep the extension light and forward frames to the main app. These come from developer reports, not Apple documentation. [Apple Developer Forums 651367](https://developer.apple.com/forums/thread/651367); [Forasoft](https://www.forasoft.com/blog/article/how-to-implement-screen-sharing-in-ios-1193)
- Shipping example: ScribeMe Live Assist (Jan 2026) lets blind/low-vision users share their screen so AI describes it while they use other apps. [AppleVis](https://www.applevis.com/forum/ios-ipados/new-update-scribeme-live-assist) (search summary)
- App Review 2.5.14: "Apps must request explicit user consent and provide a clear visual and/or audible indication when recording, logging, or otherwise making a record of user activity. This includes any use of the device camera, microphone, screen recordings, or other user inputs." [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- WebDriverAgent is "a WebDriver server for iOS" for end-to-end testing, adopted by Appium's XCUITest driver; setup is done by opening the project in Xcode and running the WebDriverAgentRunner test target on the device; Facebook archived its original repo in favor of IDB. [appium-webdriveragent README](https://cdn.jsdelivr.net/npm/appium-webdriveragent@15.0.0/README.md) (search summary)
- AI agents built on this stack (e.g., NavAIGuide) require macOS with Xcode, a real iOS device, and an Appium server with the XCUITest driver. [npm: @navaiguide/ios](https://www.npmjs.com/package/@navaiguide/ios); earlier research agent using XCUITest XML hierarchy as the "DOM" [DEV Community](https://dev.to/francedot/ios-os-agents-in-the-era-of-multi-modal-generative-ai-154p) (search summary)

### Inferences
- XCUITest-based control is "possible but not for consumers": it needs a Mac, Xcode, a developer-signed runner, and a tethered or same-network device. It cannot be distributed through the App Store (it is test infrastructure, and Guideline 2.5.1 limits apps to public APIs used for their intended purposes). Not verified this session: free-provisioning profiles expiring after 7 days, and whether WDA can be launched without a Mac after install.
- ReplayKit gives an AI read-only vision of other apps while the user is actively broadcasting: feasible for "look at what I'm doing and help" sessions (same pattern ScribeMe ships), not for background data sync, and never for taking actions. Expect App Review scrutiny on purpose framing and the 2.5.14 consent/indicator requirement. Screenshots shared via the share sheet or the iOS 27 screenshot automation are a lower-friction read-only alternative.
- A custom keyboard extension only sees text in fields the user is typing into (and network access requires "full access"), so it is not a general cross-app reader.

### Gaps
- No Apple documentation found stating the current broadcast extension memory limit or whether ReplayKit blanks protected content (password fields, DRM video) on iOS 27.
- No App Review precedent found for an app whose primary purpose is continuous AI reading of other apps' screens.

## 4. Data aggregation routes: HealthKit, Screen Time/DeviceActivity, Calendar/Reminders/Contacts, Files, share/action extensions, and public web APIs

### Takeaway
HealthKit is a real cross-app hub for fitness and nutrition, but only at summary level: gym apps write workout sessions (type, duration, energy), not sets/reps/weights, and nutrition apps write daily or per-meal nutrient totals, not food line items. EventKit and Contacts give full read/write with permission. Screen Time data cannot leave its sandboxed extension. Everything else (Canvas, detailed lifting logs, MFP diaries) must come from the vendors' web APIs, which are uneven: Canvas has a REST API gated by each institution, Hevy has a Pro-only API key, Strong has CSV export only, MyFitnessPal's API is closed to new developers.

### Cited Findings
**HealthKit**
- Hevy "uses HealthKit and CareKit to export your Hevy workouts into the Health app" (opt-in in settings). [Hevy App Store listing](https://apple.co/2VvCsFt) (search summary)
- Hevy writes completed strength workouts with activity type, duration and active energy; "Set, rep, and weight detail stays in the Hevy app"; it reads body weight. This is a vendor claim (Sahha), not Hevy's. [Sahha: Hevy integration](https://sahha.ai/integrations/hevy/) (search summary)
- Strong syncs with Apple Health (nutrition info, bodyweight, body fat %, workouts) and offers CSV export; no public API. [macmyths: Strong](https://macmyths.com/apps/strong/) (third-party listing, search summary)
- MyFitnessPal writes food to Apple Health as meal summaries, one-way, no individual food entries, no food timestamps; caffeine and vitamin A excluded. [Sonar Health](https://www.sonarhealth.co/en-AU/blog/sync-myfitnesspal-with-apple-health/); [Amy Food Journal](https://www.amyfoodjournal.com/blog/best-calorie-tracker-apple-health) (search summary)
- Cronometer's own blog lists about 13 nutrients exported to Apple Health plus categories like blood glucose and body fat; not every tracked nutrient is exported. [Cronometer blog](https://cronometer.com/blog/apple-health) (search summary)
- HealthKit read and write permissions are granted per data type, separately. [Amy Food Journal](https://www.amyfoodjournal.com/blog/best-calorie-tracker-apple-health) (search summary)
- Third-party apps already expose HealthKit data to AI: "Ask My Health" answers questions about Apple Health data via Siri, Shortcuts or an MCP client; "Health Exporter & Shortcuts" exports workouts across 76+ activity types via Shortcuts. [Ask My Health](https://apps.apple.com/ml/app/id6781414964); [Health Exporter & Shortcuts](https://apps.apple.com/app/id6759006922) (search summary)
- Guideline 2.5.1: "HealthKit should be used for health and fitness purposes and integrate with the Health app." Guideline 5.1.3(i): HealthKit data may not be used or disclosed to third parties for advertising, marketing or data mining "other than improving health management, or for the purpose of health research, and then only with permission"; apps must disclose the specific health data collected. 5.1.3(ii): may not "store personal health information in iCloud." [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)

**Screen Time / DeviceActivity**
- Apple forum answer: "moving Device Activity data outside of your extension's sandbox is not possible in order to preserve the user's privacy." Developers report App Group writes from the report extension silently fail to reach the host app. [Apple Developer Forums 727958](https://developer.apple.com/forums/thread/727958) (search summary)
- Guideline 4.10: apps may not monetize "Screen Time APIs." [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)

**Calendar / Reminders / Contacts**
- EventKit (iOS 17+): `requestFullAccessToEvents` (read/write) or `requestWriteOnlyAccessToEvents` (write only, cannot read back); Reminders only offers full access via `requestFullAccessToReminders`. [Apple: Accessing the event store](https://developer.apple.com/documentation/eventkit/accessing-the-event-store); [TN3152](https://developer.apple.com/documentation/technotes/tn3152-migrating-to-the-latest-calendar-access-levels) (search summary)
- Contacts has a Limited authorization level (iOS 18) where the app sees only user-selected contacts (third-party source, unverified against Apple docs). [Axiom: EventKit & Contacts](https://charleswiltgen.github.io/Axiom/skills/integration/eventkit-contacts) (search summary)

**Public web APIs for the named example apps**
- Canvas LMS: tokens are tied to a per-institution developer key; "if the developer key is not enabled for the requested account, Canvas will respond with 401 Unauthorized"; only root account admins or Instructure can change key scopes. [Canvas API: Developer Keys](https://lms.au.af.edu/doc/api/file.developer_keys.html); institutions publish their own token policies [UW Canvas API access tokens](https://ois.uw.edu/learn/tools/canvas/canvas-policies/integration-development-data-access/api-access-tokens). One university page says user API token access is being deprecated by Instructure in H1 2027 (unverified). [University of Missouri](https://tdx.umsystem.edu/TDClient/66/MOOnline/KB/ArticleDet?ID=2193) (search summary)
- Hevy: public API at api.hevyapp.com, Hevy Pro only, per-account API key in an `api-key` header; covers workouts, change feed, routines, exercise templates/history, body measurements. Community MCP server exists (hevy-mcp). [docs.rs: hevy](https://docs.rs/crate/hevy/0.1.0); [hevy-mcp](https://mcpservers.org/servers/chrisdoc/hevy-mcp) (search summary)
- MyFitnessPal developer program "currently closed to new applicants." [apis.io: MyFitnessPal](https://apis.io/security/myfitnesspal/myfitnesspal-authentication/) (search summary)

### Inferences
- Rough coverage of the "connect every app" vision from HealthKit + EventKit/Contacts + public APIs: good for activity/sleep/heart/body metrics and calendar/reminders; partial for gym apps (sessions yes, lifts no, unless the vendor has an API like Hevy Pro); partial for nutrition (daily/meal totals for a subset of nutrients, no food diary); school LMS only where the institution allows tokens or OAuth keys; near zero for long-tail apps with no HealthKit write, no API and no App Intents. Not verified this session: HealthKit has no native per-set strength data type, which would explain why gym apps only write session summaries.
- Share sheet and Action extensions are a user-initiated, App Store safe way to pull content (text, URLs, files, screenshots) from any app that offers sharing, but they are one-shot and user-driven, not sync.
- Files app / document providers give access only to files the user picks or that apps put in shared locations; not verified in detail this session.

### Gaps
- No Cronometer public or partner API information was found.
- No authoritative list of exactly which HealthKit types MyFitnessPal writes (MFP has not published one per Sonar).
- HealthKit background delivery behavior and locked-device read restrictions were not re-verified for iOS 27.

## 5. App Store Review Guidelines relevant to an "AI connected to your other apps" product

### Takeaway
The guidelines forbid exactly the Android-style approach (private APIs, reading outside the container, executing code that changes other apps), require explicit per-recipient consent before sending personal data to third-party AI (5.1.2(i), Nov 2025), restrict HealthKit data use (5.1.3), and require visible consent for any screen recording (2.5.14). A server-side connector model (remote MCP servers calling vendor web APIs) plus on-device HealthKit/EventKit reads with clear AI disclosures is compliant; downloading plug-in code onto the device or hiding screen capture is not.

### Cited Findings
- 2.5.1: "Apps may only use public APIs ... Apps should use APIs and frameworks for their intended purposes." [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- 2.5.2: apps "may not read or write data outside the designated container area, nor may they download, install, or execute code which introduces or changes features or functionality of the app, including other apps." [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- 2.5.4: background services only for intended purposes "VoIP, audio playback, location, task completion, local notifications, etc." [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- 2.5.14: explicit consent plus clear indication for recording user activity, including "screen recordings." [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- 2.5.16: "Widgets, extensions, and notifications should be related to the content and functionality of your app." [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- 4.7: apps may offer software not embedded in the binary, including "chatbots, and plug-ins"; 4.7.2 "Your app may not extend or expose native platform APIs or technologies to the software without prior permission from Apple"; 4.7.3 "may not share data or privacy permissions to any individual software offered in your app without explicit user consent in each instance." [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- 5.1.2(i) (revised Nov 13 2025): "You must clearly disclose where personal data will be shared with third parties, including with third-party AI, and obtain explicit permission before doing so." [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/); [Apple developer news](https://developer.apple.com/news?id=ey6d8onl); [TechCrunch, Nov 13 2025](https://techcrunch.com/2025/11/13/apples-new-app-review-guidelines-clamp-down-on-apps-sharing-personal-data-with-third-party-ai)
- 5.1.3(i)/(ii): HealthKit data restrictions and no personal health info in iCloud (see section 4). [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- 2.5.11: SiriKit/Shortcuts intents must be handleable without another app; no third-party app names in aliases. [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)

### Inferences
- 4.7.2 is a sleeper risk for an MCP-host app: if third-party "connectors" run inside the app and get access to HealthKit/EventKit/Contacts data, that may count as exposing native platform APIs to plug-in software, needing Apple permission, and 4.7.3 requires per-instance consent for sharing data with each plug-in. Keeping connectors server-side (remote MCP servers reached over the network) and having the app itself own all native API calls is the safer design.
- Sending HealthKit data to an LLM provider must be disclosed and consented under 5.1.2(i) and must stay within "improving health management" under 5.1.3; no marketing use.
- A long-running background agent loop is not a sanctioned background mode under 2.5.4; background work must use task completion, BGTaskScheduler, push, or HealthKit background delivery.

### Gaps
- The guidelines page did not show a "last updated" date in the fetched text, and the content after 5.2.5 was not read.
- No App Review precedent found specifically on MCP-host apps or AI agent apps that call other apps' Shortcuts.

## 6. Workarounds and shipping products: Mac-tethered control, cloud iOS devices, jailbreak, MDM, and anything doing on-device iOS app control

### Takeaway
No App Store app performs general on-device control of other iOS apps; the only shipping cross-app agent on iPhone is Apple's Siri AI (beta, iOS 27). Everything that actually drives third-party iOS app UIs uses XCUITest/WebDriverAgent from a Mac. Consumer-viable workarounds are user-initiated (Shortcuts bridges, share sheet, ReplayKit sessions) or move off-device to vendor web APIs.

### Cited Findings
- Apple's Siri AI is the shipping on-device cross-app agent: personal context, on-screen awareness, app actions, beta, English. [Apple Newsroom, Sept 2026](https://www.apple.com/newsroom/2026/09/siri-ai-a-profoundly-more-capable-and-personal-assistant-is-here/)
- Third-party models behind Siri exist only for ChatGPT as of Sept 2026; the delegation entitlement is closed to others. [MacRumors, Sept 14 2026](https://www.macrumors.com/2026/09/14/siri-can-be-swapped-out-for-chatgpt-claude/)
- Mac-tethered: WDA / Appium XCUITest driver and AI agents like NavAIGuide need macOS + Xcode + a real device. [appium-webdriveragent README](https://cdn.jsdelivr.net/npm/appium-webdriveragent@15.0.0/README.md); [npm: @navaiguide/ios](https://www.npmjs.com/package/@navaiguide/ios) (search summary)
- Mac-side bridges to Shortcuts (intents-mcp, ShortcutsBridge relay to a Mac) show the pattern of using a Mac as the agent host for Apple automation. [GitHub: intents-mcp](https://github.com/VladUZH/intents-mcp); [mcpservers.org](https://mcpservers.org/de/servers/artemnovichkov/shortcuts-mcp-server) (search summary)
- Screen-reading assistant precedent on iPhone: ScribeMe Live Assist via screen sharing. [AppleVis](https://www.applevis.com/forum/ios-ipados/new-update-scribeme-live-assist) (search summary)
- Apple's iWork MCP servers on macOS 27 show Apple's chosen pattern: per-app MCP on Mac, not OS-wide MCP on iPhone. [Apple Newsroom, Oct 27 2026](https://www.apple.com/newsroom/2026/10/apple-creator-studio-adds-powerful-new-ai-features-and-even-more-creative-tools/)

### Inferences
- Cloud-hosted iOS simulators or device farms can run an app under XCUITest, but the user's real accounts, data and installed apps are on their phone, so this does not help a consumer "connect my apps" product except as a scraping farm with user credentials (high ToS and security risk).
- Jailbreak: not viable for consumers (not available on current iOS versions in a consumer-friendly way, voids App Store distribution); no source checked this session.
- MDM: designed for configuring and restricting managed devices, not reading third-party app data or driving UI; not a route for a consumer app. No source checked this session.

### Gaps
- No source found listing any App Store app that drives other apps' UI on-device; absence is consistent with the platform rules but not proven by a dataset.
- Cloud iOS device providers' current terms, MDM capabilities in iOS 27, and jailbreak status for iOS 26/27 were not researched.

## 7. EU Digital Markets Act (and Japan) effects on third-party assistant access

### Takeaway
The DMA is the main force that could open iOS to third-party assistants controlling apps, and it is mid-fight: the Commission's reading of Article 6(7) would require Apple to give rival assistants the same access Siri AI has (subject to user consent); Apple refused without an 18-month "Trusted System Agent" phase-in, the Commission refused the exemption, and as a result Siri AI is not on EU iPhones at all. Nothing shipped for third-party assistants in the EU as of Nov 2026. Japan's MSCA produced a narrower win: since iOS 26.2 a third-party voice assistant can be bound to the side button in Japan.

### Cited Findings
- Apple (June 8 2026): it "will not be able to ship Siri AI in the European Union" with iOS/iPadOS 27; regulators' interpretation would require giving any virtual assistant "direct access to users' private data" and the ability to control other installed apps; Apple proposed a "Trusted System Agent," "an intermediary that would allow virtual assistants to safely access the same features," with an 18-month gradual rollout; the Commission "did not agree to any of Apple's proposals"; EU developers "will not be able to test or use the new Siri AI features for their apps" on iOS/iPadOS/watchOS 27; "no timeline." [Apple Newsroom, June 8 2026](https://www.apple.com/newsroom/2026/06/due-to-dma-siri-ai-delayed-in-eu-for-ios-27-and-ipados-27/)
- Commission response: the DMA does not bar Apple launching; Apple "simply made a request ... to be exempted from their interoperability obligations under the DMA, and this for at least 18 months" (spokesperson Regnier). [Tech Times, June 10 2026](https://www.techtimes.com/articles/318136/20260610/eu-rejects-apple-siri-ai-exemption-commission-says-dma-never-blocked-launch.htm) (search summary); commentary [Michael Tsai](https://mjtsai.com/blog/2026/06/10/no-siri-ai-in-eu/)
- The relevant obligation is DMA Article 6(7) (interoperability with the same hardware and software features the gatekeeper's own services use); commentary reports the Commission says Apple must provide equivalent features to third parties subject to user consent. [Truth on the Market](https://truthonthemarket.com/2026/06/10/brussels-ai-catch-22-siri-define-choice/); [SoftwareSeni](https://www.softwareseni.com/siri-ai-and-the-european-union-digital-markets-act-lockout/) (search summary, advocacy-leaning)
- Siri AI still not available in the EU on iOS/iPadOS/watchOS at the Sept 14 2026 launch. [Apple Newsroom, Sept 2026](https://www.apple.com/newsroom/2026/09/siri-ai-a-profoundly-more-capable-and-personal-assistant-is-here/)
- Earlier DMA specification decisions (preliminary instructions March 19 2025): nine connectivity features for connected devices (e.g., peer-to-peer Wi-Fi, NFC, pairing, notifications on third-party watches) plus a more predictable process for app developers' interoperability requests. [TechCrunch, Mar 19 2025](https://techcrunch.com/2025/03/19/eu-sends-apple-first-dma-interoperability-instructions-for-apps-and-connected-devices/)
- MacRumors speculates the DMA may have shaped the hidden model delegation design. [MacRumors, Sept 14 2026](https://www.macrumors.com/2026/09/14/siri-can-be-swapped-out-for-chatgpt-claude/)
- Japan: iOS 26.2 lets users in Japan (Apple Account region Japan and physically in Japan) assign a third-party voice assistant app to the side button, built on App Intents, to comply with the Mobile Software Competition Act; "Hey Siri" cannot summon it. [MacRumors, Nov 17 2025](https://www.macrumors.com/2025/11/17/ios-26-2-iphone-users-japan-siri/); [9to5Mac](https://9to5mac.com/2025/11/17/iphone-replace-siri-side-button-japan-ios-26-2/); Japan also got alternative marketplaces and payments in Dec 2025 [MacRumors, Dec 17 2025](https://macrumors.com/2025/12/17/japan-app-store-feature-updates)

### Inferences
- If the Commission prevails, an EU-only API for third-party assistants to access app actions and personal context (via a Trusted System Agent-style intermediary or App Intents exposure) is the single most likely future opening for a "connect your apps to my AI" product on iPhone. It is not available today and has no timeline; any product plan should treat it as upside, EU-only, and probably years out.
- Alternative EU marketplaces do not change the API surface: apps still run in the iOS sandbox with public APIs, so they do not enable Android-style cross-app control. (Not re-verified this session: notarization rules for alternative distribution.)
- Japan's side-button access lets an AI app be the launch-point assistant but gives it no new access to other apps' data or actions.

### Gaps
- No formal Commission non-compliance decision or specification decision on virtual assistants was found as of Nov 2026.
- No evidence found of any third-party assistant receiving Siri-equivalent API access in the EU.

## 8. Overall map: possible vs impossible vs possible-but-App-Store-rejected (Nov 2026)

### Takeaway
On iOS, a third-party app can aggregate data from Apple-mediated hubs (HealthKit, EventKit, Contacts, Photos, Files, share sheet) and from vendors' web APIs, and can trigger other apps' exposed actions only indirectly through user-installed Shortcuts. It cannot read other apps' private data or UI, and it cannot take actions in arbitrary apps. Apple reserves cross-app agentic control for Siri AI, with third-party model access entitlement-gated and EU-mandated access stalled.

### Cited Findings
- Siri AI only acts on what apps "make explicitly available using App Intents," and third-party custom actions cannot ship to App Store users until spring. [Apple Developer Documentation: Siri AI Developer Preview](https://developer.apple.com/documentation/appintents/siri-ai-developer-preview)
- ReplayKit is "the only option for this sort of thing on iOS" for seeing other apps' screens. [Apple Developer Forums 818940](https://developer.apple.com/forums/thread/818940)
- 2.5.1 and 2.5.2 forbid private APIs, reading outside the container, and executing code that changes other apps. [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- Model delegation entitlement not opened to third parties (Sept 2026). [MacRumors, Sept 14 2026](https://www.macrumors.com/2026/09/14/siri-can-be-swapped-out-for-chatgpt-claude/)

### Inferences
Feasibility matrix (inferences drawn from the cited findings in sections 1 to 7):

| Route | Read data | Take actions | Status for an App Store consumer app |
|---|---|---|---|
| HealthKit | Yes, per-type permission; summaries only for gym/nutrition apps | Write own samples | Possible (5.1.2(i), 5.1.3 apply) |
| EventKit / Contacts | Yes (full access) | Create/edit events, reminders, contacts | Possible |
| Vendor web APIs / OAuth (Canvas, Hevy Pro, etc.) | Yes where offered | Yes where offered | Possible; coverage depends on each vendor and institution |
| Shortcuts via x-callback-url | Text result from user-installed shortcut | Runs other apps' exposed actions | Possible; foreground bounce, user setup, only apps with App Intents |
| Share sheet / Action extension | User-shared content | No | Possible, user-initiated |
| ReplayKit broadcast | Pixels of other apps while user broadcasts | No | Possible with consent and indicator; App Review risk if framed as background surveillance |
| Screen Time / DeviceActivity | Only inside sandboxed report extension | Shielding only | Not usable for AI ingestion |
| Siri AI App Toolbox / personal context | Siri only | Siri only | Impossible for third parties |
| Model delegation / Inference Provider (be the model behind Siri) | Via Siri tools | Via Siri tools | Exists in code, entitlement closed (ChatGPT only) |
| System-wide MCP on iOS | n/a | n/a | Does not exist (Xcode 27 and macOS iWork only) |
| Accessibility-style UI reading/driving of other apps | No | No | Impossible (no API) |
| XCUITest / WebDriverAgent | Full UI tree | Full UI control | Possible only with Mac + Xcode developer setup; not App Store distributable |
| Private APIs, jailbreak | Yes | Yes | Rejected (2.5.1) / non-viable for consumers |
| EU DMA third-party assistant access | Possibly future | Possibly future | Not shipped; no timeline |

- Practical implication for the pitch: on iPhone, "connect ANY app" has to be re-scoped to "connect any app that has a cloud API, writes to Apple Health, or exposes Shortcuts actions," with the AI's brain and connectors running server-side, plus user-initiated capture (share sheet, screenshots, screen-share sessions) for everything else.

### Gaps
- Quantitative coverage (what fraction of a typical user's top apps fall into each row) was not measurable from available sources.
