# Mobile agent streaming API

All functions below are deployed to Convex. Matthew owns the mobile UI; these APIs fit the `AgentProvider` / `AgentChunk` interface in `src/lib/agent/provider.ts`. The UI sends mutations and subscribes to durable updates with Convex. There is no separate SSE URL or custom WebSocket server.

## Onboarding starts with AI login

Call `api.users.ensure` to establish the Yuzu device identity, then subscribe to **`api.aiOnboarding.state({ token })`**. Its authoritative order is:

1. `connect_ai`: connect and select a Claude or ChatGPT subscription using [AI_LOGIN_API.md](AI_LOGIN_API.md). Show this before the app picker/login/capture pipeline. A provider must report `connected` and be selected before advancing.
2. `connect_apps`: run the existing app connection pipeline, or explicitly defer app setup after AI login.
3. `ready`: at least one app is `live`, completing the recommended setup.

Result: `{ step: "connect_ai" | "connect_apps" | "ready", provider: "claude" | "codex" | null, connectedApps: number, ready: boolean }`.

The local `yuzu.onboarded` flag is not proof of AI login. The mobile flow now consults this query and cannot continue, skip or finish while it says `connect_ai` (or while the query is unavailable). Once AI is connected and selected, the existing Skip option may defer app setup; the backend still reports `connect_apps` until an app is live. Disconnecting the selected provider returns the query to `connect_ai`.

`token` is the final path component of the current user's `mcpUrl`. Use the same Convex deployment that issued it. Never use `userId` alone as authentication or log the capability, provider codes, or credential material.

## Public API

| Function | Kind | Arguments | Result |
| --- | --- | --- | --- |
| `api.aiChat.sendMessage` | mutation | `{ token, message, clientMessageId, threadId?, provider? }` | `{ threadId, turnId }` |
| `api.aiChat.watchMessages` | query | `{ token, threadId, limit? }` | `{ thread, turns }` |
| `api.aiChat.events` | query | `{ token, threadId, afterSeq?, limit? }` | `{ events, cursor, hasMore }` |
| `api.aiChat.threads` | query | `{ token }` | Latest 50 safe thread summaries |
| `api.aiChat.cancelTurn` | mutation | `{ token, turnId }` | `{ status }` |
| `api.aiChatApprovals.pendingApprovals` | query | `{ token }` | Latest 10 pending approval cards |
| `api.aiChatActions.approveTool` | action | `{ token, approvalId, decision: "approve" | "deny" }` | `{ status }` |
| `api.aiChatApprovals.approvalResult` | query | `{ token, approvalId }` | `{ approvalId, status, runState, result }` |

New threads use the selected connected provider unless `provider` explicitly chooses another connected one. A thread keeps its original provider. The chat provider name is `codex` for a ChatGPT subscription; the UI can label it “ChatGPT”. One active turn is permitted per user. Wait or cancel before sending the next message.

Generate one `clientMessageId` per user send (a UUID works) and reuse it across network retries. Repeating the same ID returns the original IDs without scheduling a second model run. Reusing it with different text/provider/thread is rejected. Omitting `threadId` starts a new conversation; persist the returned ID for follow-ups and restores.

## Streaming and reconnect

`watchMessages` returns `{thread, turns, cursor}` from one transactional snapshot and is the source of truth for app resumes. `turns` are chronological, default latest 20 / maximum 50, further bounded to about 1 MiB of text. Each turn has `{ turnId, message, assistantText, status, error?, createdAt, updatedAt, completedAt? }`. The thread has `{ threadId, provider, title, activeTurnId?, createdAt, updatedAt }`. Resume events after this **snapshot cursor**, not a later event cursor fetched while reconstructing cards: generation can continue between those reads.

Status is `queued → running → completed | error | cancelled`. A failed/cancelled reply retains text already persisted. The scheduled action starts immediately; the send mutation returns before native startup/download. Do not treat a slow cold start as a disconnected account.

For an `AsyncIterable<AgentChunk>`, subscribe to `events`. Each event is `{ seq, turnId, type, text?, name?, id?, createdAt }`. Sequences increase across the entire thread, starting at 1:

- `text_delta`: map `text` to `{ type: "text", delta: text }` for the current turn.
- `tool_start` / `tool_end`: metadata about a call to the configured Yuzu MCP server. Reuse `id` to update the same card. Raw arguments, results, hidden reasoning and native stderr are excluded.
- A `tool_end` means the native tool call returned. It does **not** prove an app write succeeded: use the existing activity/approval receipt to show “Done”, “Waiting for you” or “Didn't go through”. Do not render internal tool names as product copy; use the app's existing `verbForTool` mapping.

Keep the last **consumed** `seq` as your cursor. On reconnect call/subscribe with `afterSeq: cursor`; advance it after delivering each event. If `hasMore` is true, advance and fetch the next page immediately (default 100 / maximum 200). Deduplicate by `seq`, filter by `turnId` for the active reply, and drain remaining pages when the turn becomes terminal. Keep `watchMessages` subscribed as well: terminal status can change without a final text event. Use its full `assistantText` to restore a conversation, instead of replaying text into an already restored message.

In the existing `AgentProvider.send`, call `sendMessage` and return `{ type: "stream", chunks }`. Map terminal `error` into an `AgentChunk` error with user-facing copy. On the context's `AbortSignal`, invoke `cancelTurn`, stop listeners, and close the iterable. “New chat” drops the local thread ID. Closing a subscription alone does not cancel the cloud turn, so a backgrounded app can reconnect and recover persisted output.

## Approvals back to the backend

Subscribe to `pendingApprovals` for the phone's approval sheet. Use `approveTool` to decide and then subscribe to `approvalResult` for the eventual receipt. Approval ownership is checked against the capability. The existing approval executor claims the write exactly once; duplicate decisions do not repeat it.

The decision returning `approved` means accepted, not completed. Only `runState: "done"` plus the result confirms execution. Pending cards include their expiry deadline for a local countdown; the existing server expiry job removes expired cards. Public tool data is bounded and redacted. Cancelling model generation does not undo a write already approved or executed, and pending app approvals keep their existing independent lifecycle.

Native turns are ephemeral processes, with bounded completed conversation text rebuilt on each request. Recent approval IDs/statuses are passed privately to the next turn so it can check an existing pending write instead of repeating it. Native coding workspaces and hidden model reasoning are not persisted as conversation history.

## Runtime and limits

- Pinned unmodified Claude Code and Codex binaries run in Convex Node actions using saved encrypted subscription credentials. Successful turns snapshot refreshed credentials with the original user's/provider's login epoch; disconnect/relogin prevents stale workers from overwriting a new account.
- Claude uses native streaming JSON. Codex uses native app-server stdio notifications for actual text deltas; its older exec JSON output buffers text until completion.
- Only the configured Yuzu MCP tools are available. Claude removes built-ins; Codex uses its supported static model catalog locked to `gpt-6.1-sol` plus disabled native tools. Read-only sandboxing alone is insufficient protection for the backend host. Do not loosen flags or update pinned binaries without rerunning tool-surface/adversarial fixtures.
- Messages: 16 KiB UTF-8. Prompt: at most 60,000 bytes, dropping oldest whole history pairs when needed. History starts from at most 12 completed turns / 64 KiB.
- Durable turn deadline: eight minutes including startup. The native generation process also has a shorter four-minute timeout. Expiry persists a terminal state even if a worker crashes.
- Normalized events: at most 8 KiB text per event, 32 per database batch, 2,000 per turn; 256 KiB accumulated assistant text and 512 KiB serialized events. Native stream parsing imposes additional conservative limits. The bridge batches about every 200 ms.

`error` contains a stable safe code: `runtime_unavailable`, `provider_disconnected`, `turn_expired`, `output_limit`, `provider_error`, `tool_error`, or `turn_failed`. The mobile UI supplies plain copy. Never show raw provider exceptions or silently retry a failed turn: an approved tool may already have changed app data. A transport retry of the original send uses its same `clientMessageId`.

## Deployment and verification

Development endpoint: `https://watchful-oyster-561.convex.cloud` in Matt's `matt-5326f:ycyc:dev/yuzu-subscriptions` deployment. It expires around November 20, 2026. The shared dev watcher remains independent; to use this API there, pull main first and deploy the combined source with `AI_SESSION_ENCRYPTION_KEY` configured. Never deploy an old snapshot over Matthew's current work.

The encryption key is also configured in the shared `optimistic-newt-247` deployment; the combined main source still needs to be pulled by its active dev watcher. Keys are private and distinct per deployment.

State/security/process/parser fixtures and lint/typechecks are run locally. Native fixture providers verify both CLIs' tool restrictions without billing or real account grants. A separate hosted Convex transport fixture verified three distinct live text updates, reconnect cursors, cancellation and private-field exclusion through a real WebSocket subscription; its temporary admin seed was removed and its rows deleted.

Real provider login and inference were verified on November 15: Claude delivered 20 pre-completion text updates and Codex 39; both completed a real `list_apps` follow-up. A separate real midstream restore recovered all text across a delayed restore. See [AI_LIVE_VERIFICATION.md](AI_LIVE_VERIFICATION.md). These results do not establish refresh-token renewal or a complete rendered mobile UI flow.

Reproduce native runtime/resource smoke checks (Docker and the installed esbuild CLI required):

```sh
mkdir -p /tmp/yuzu-native-smoke
./node_modules/.bin/esbuild scripts/test/native-provider-stream.mjs --bundle --platform=node --format=esm --outfile=/tmp/yuzu-native-smoke/probe.mjs
docker run --rm --memory=512m --memory-swap=512m -e SMOKE_TARGET=claude -v /tmp/yuzu-native-smoke:/smoke:ro node:24 node /smoke/probe.mjs
docker run --rm --memory=512m --memory-swap=512m -e SMOKE_TARGET=codex -v /tmp/yuzu-native-smoke:/smoke:ro node:24 node /smoke/probe.mjs
```

The test starts loopback fixture API/MCP servers, creates fresh temporary account directories, and passes no host credentials to the child. It checks the actual pinned binaries' tool surface, a real local MCP roundtrip, normalized text, and Codex text arriving before fixture response completion. Production uses native subscription authentication; the fixture provider override is test-only.

Reference: [Claude CLI](https://code.claude.com/docs/en/cli-reference.md), [pinned Codex source](https://github.com/openai/codex/tree/rust-v0.169.0), [Convex subscriptions](https://docs.convex.dev/client/react/overview).
