# Agent page spec

The Agent tab (second tab: Today, Agent, Apps, Link) is where someone asks an assistant to use their connected apps. It should feel like opening a fresh chat in the best iOS assistant apps: almost nothing on screen, a composer that owns the bottom, and the person's own apps as the only color.

References: Mobbin collection "yuzu agent" (6 screens: empty chat with composer, plain-text answer under a user bubble, tool steps inside a reply, dark composer with a model pill, wordmark-only home with a model pill, attach/connect sheet). Never name or copy a source app in our UI.

## What we took from the references
- **Empty means empty.** New chats show no greeting and no chrome: a blank canvas, a centered mark or one short line, and the composer. Suggestions are optional and sit low, near the thumb.
- **The composer is a card, not a text field.** One rounded container (radius ~26) holding the input on top and a control row underneath: attach / model pill on the left, voice / send on the right.
- **The model picker lives in the composer** as a small pill with just the name (no chevron). It opens a compact popover anchored to the pill, with a check on the current choice.
- **Assistant text is plain text**, full width, 16-17pt with generous line height. Only the person's messages get a bubble: subtle fill, right aligned, max ~80% width, radius ~20.
- **Tool use is quiet.** Steps render as light single lines or compact cards inside the reply, never as loud banners.
- **Send button**: a 32-34pt circle. Disabled = dim gray arrow; ready = solid high-contrast fill with an up arrow.

## Layout (iPhone, dark)
```
safe area top
                      (flex space)
              Ask your apps anything        24/600, -0.5 tracking, centered
                 [logo][logo][logo]         live apps, 22pt, overlapped 6pt
                      (flex space)
  [logo] How much protein do I have left?   suggestion rows x4
  [logo] Am I about to lose my streak?
  Recent
  [logo] Claude logged 2 eggs in MyFitnessPal        2h
  [logo] ChatGPT checked your streak in Duolingo     5h
 ┌─────────────────────────────────────────────┐
 │ Ask anything                                │  composer, #0B0B0B
 │ (Claude)                               (↑)  │
 └─────────────────────────────────────────────┘
       Opens in Claude with your apps attached     12/16 tertiary
tab bar
```
- Gutter 16 for content, 12 for the composer (it reads as floating). Section gap 24.
- The scroll content uses `flexGrow: 1` and the hero takes the free space, so with few items the prompt sits mid-screen and suggestions settle near the composer.
- With nothing connected, the suggestions become one card: plus icon, "Connect an app", arrow → `/add`.
- The composer stays pinned above the tab bar; `KeyboardAvoidingView` (padding) lifts it with the keyboard. Scroll dismisses the keyboard interactively.

## Type
| Use | Style |
|---|---|
| Empty prompt | Inter 600, 24/30, -0.5 |
| Composer input | Inter 400, 16/22 |
| Assistant text | Inter 400, 16/24 |
| User bubble | Inter 400, 16/22 |
| Suggestion row | body 15/21 |
| Recent row | body 15/21, time caption 13 tabular |
| Pill, menu rows | label 13/500, bodyMedium 15 |
| Footnote | 12/16 tertiary |

## Composer anatomy
- Container: `surface #0B0B0B`, 1px `border #1F1F1F`, radius 26, padding 12 top / 8 sides / 8 bottom.
- Input: multiline, 24 min / 132 max height then scrolls, white caret, dark keyboard, placeholder "Ask anything".
- Control row (12 below input): assistant pill left (34 high, `surface2`, hairline border, name only), send right.
- Send: 34 circle. Idle: `surface2` + white arrow at 35%. Ready: white fill + black arrow (Lordicon arrows-right turned up; black copy in `assets/icons/arrows-right-black.json`). Fill crossfades 160ms; arrow plays its hover motion once per send.
- Footnote under the card: "Opens in {assistant} with your apps attached". Becomes the error line if opening fails ("Couldn't open Claude. Your message is copied.").

## Suggestions
- Built from live connections only (`connections.mine`, `status === "live"`), round-robin across apps using `APP_COPY[slug].prompts`, max 4, so every app shows up before any repeats.
- Row: `surface` card, radius 16, 12/16 padding, app logo 24 + prompt (first letter capitalized, max 2 lines).
- Tap fills the composer (no auto-send, since sending leaves the app).

## Recent
- `activity.feed` limit 4, rows with no card chrome: logo 28, one plain sentence, relative time on the right.
- Sentence: `{Assistant} {summary, first word lowercased} in {App}` ("Claude logged 2 eggs to breakfast in MyFitnessPal"). In-app actions drop the assistant ("Connected Strong"). Summaries that look internal fall back to the app-copy verb. Non-ok status adds a second line: "Waiting for you", "Denied", "Didn't go through" (red).
- Row tap → `/app/[slug]`.
- Coming back to the foreground within 10 minutes of a handoff lights the newest row (`surface2` wash in 220ms, hold 900ms, out 700ms), and again when a new item lands on top.

## Conversation view (in-app providers only)
- User: right-aligned bubble, `surface2`, radius 22, 16/10 padding, max 82%.
- Assistant: plain text, full width, 12 between parts.
- App action card: `surface`, radius 16, padding 12, app logo 32, title (plain words), caption "{App} · {detail}", trailing status dot + word ("Working" pulsing, "Done", "Waiting for you", "Didn't go through").
- While streaming, a breathing white dot sits under the last part. Auto-scroll to the end on content change.
- Top bar shows the assistant name and "New chat" (resets the thread).

## Motion
- Calm springs from `src/theme/tokens.ts`. Hero fades in (280ms). Suggestions `enter(i + 2)`, Recent `enter(6+)`, 55ms stagger.
- Assistant menu: `ZoomIn` on `springs.pop` from the bottom-left (anchored at the pill), backdrop fade 160ms, rows press-scale 0.98.
- Press feedback is spring only (`PressableScale`). Haptics: selection for pills/rows, light for send.

## Copy rules
- No "MCP", tool names, endpoints, "Live" or protocol words. Assistant names are fine (they are what the person picks).
- No greeting, no disclaimers.

## For Stephen
Everything lives in `src/lib/agent/`. Import from `@/lib/agent`.

```ts
interface AgentProvider {
  id: string;                 // "claude", "chatgpt-plan", ...
  name: string;               // shown in the pill, the menu and the footnote
  kind: "handoff" | "inapp";
  isConnected(): boolean;     // handoff: always true. inapp: your sign-in state
  connect(): Promise<void>;   // inapp: run sign-in, then call notifyProvidersChanged()
  send(text: string, ctx: AgentContext): Promise<AgentSendResult>;
}

type AgentContext = {
  userId: string | null;
  apps: { slug: string; name: string }[];  // the person's live apps
  history: AgentMessage[];                  // earlier turns of this in-app thread
  signal: AbortSignal;                      // aborted on stop / new chat
};

type AgentSendResult =
  | { type: "handoff"; url: string; prompt: string }          // useAgent copies prompt, opens url
  | { type: "stream"; chunks: AsyncIterable<AgentChunk> };    // useAgent renders live

type AgentChunk =
  | { type: "text"; delta: string }                                    // appended to the reply
  | { type: "action"; id; appSlug; title; detail?; status }            // card; same id updates in place
  | { type: "error"; message: string };                                // shown as text
// status: "running" | "ok" | "needs_approval" | "error"
```

Registry and hook:
- `registerProvider(p)` returns an unregister function. `unregisterProvider(id)`, `listProviders()`, `useProviders()`, `notifyProvidersChanged()`.
- Built-ins are registered in `src/lib/agent/index.ts`: Claude, ChatGPT, Grok handoffs (`handoff.ts`). Prompt is `Use my yuzu tools: ${text}`; URLs `claude.ai/new?q=`, `chatgpt.com/?q=`, `grok.com/?q=`.
- `useAgent({ userId, apps })` → `{ providers, provider, select, send, stop, reset, messages, status, lastHandoffAt, hasInApp }`. The pick is remembered under `yuzu.agentProvider` (SecureStore, localStorage on web).

How to add your in-app provider:
1. Implement `AgentProvider` with `kind: "inapp"`. Stream chunks from your backend (text deltas plus `action` chunks for anything done in an app; reuse the same `id` to move a card from `running` to `ok`).
2. Call `registerProvider(yourProvider)` once at startup (for example from the root layout or your subscription module). Nothing in the Agent tab needs to change.
3. While `isConnected()` is false, the menu shows "Connect your {name} plan" under the handoff list and calls `connect()`. Once connected it becomes a normal pick. That row never appears unless an in-app provider is registered, so nothing dead ships today.
4. Action titles are plain words a person would say ("Logged 2 eggs to breakfast"), never tool names. Use `verbForTool` from `src/components/app-copy.ts` if you only have a tool name.

Dev preview: set `AGENT_FLAGS.exampleConversation = true` in `src/lib/agent/flags.ts` (dev builds only) to register `example.ts`, a local in-app provider that streams a canned reply with two action cards and exercises the connect row. Keep it `false` in commits.
