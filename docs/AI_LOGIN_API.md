# AI subscription login API

Backend-only contract for the Yuzu mobile UI. Providers are `"claude" | "codex"`. These endpoints connect the user's own subscription through the unmodified Claude Code/Codex login flow. Message streaming is documented in [AI_STREAMING_API.md](AI_STREAMING_API.md); a connected status alone does not establish model entitlement.

## Convex functions

Every public call takes `token`, the capability at the end of the current user's `mcpUrl` from `useUser()` / `users.ensure`. Do not send a user ID as authentication. Keep this token and login URLs out of analytics, crash reports and shared logs.

| Function | Type | Arguments | Result |
| --- | --- | --- | --- |
| `api.aiProviders.status` | query | `{ token }` | One status row per provider |
| `api.aiProviders.startLogin` | mutation | `{ token, provider }` | `{ attemptId }` |
| `api.providerActions.submitCode` | action | `{ token, provider: "claude", attemptId, code }` | `{ ok }` |
| `api.aiProviders.select` | mutation | `{ token, provider }` | `{ provider }` |
| `api.aiProviders.disconnect` | mutation | `{ token, provider }` | `{ provider, status: "disconnected" }` |

Subscribe to `status` with `useQuery`; mutations return immediately while a scheduled Node action runs the native login. The status row is:

```ts
type ProviderStatus = {
  provider: "claude" | "codex";
  status: "disconnected" | "starting" | "authorizing" | "connected" | "error";
  selected: boolean;
  attemptId?: string;
  loginUrl?: string;
  userCode?: string;
  loginExpiresAt?: number; // Unix milliseconds; includes native startup time
  error?: string;         // Safe, user-facing message
};
```

## Mobile flow

1. Call `startLogin` and observe that provider's status. Show a loading state for `starting`; cold startup downloads a verified native CLI and can take time. Duplicate taps reuse the same active attempt. A connected provider is not restarted. Failed attempts have a five-second retry throttle.
2. When `authorizing`, open the returned `loginUrl` in the system browser. Use that exact URL, including its parameters. Do not construct OAuth URLs, add callbacks or exchange provider tokens on the phone.
3. **Codex:** display/copy `userCode`; the user enters it on the official device page. No `submitCode` call is needed. They may need to enable device-code authorization in their ChatGPT security settings. The backend's native Codex process polls for completion.
4. **Claude:** the provider's remote sign-in page gives a code. Let the user paste it into the app and call `submitCode` with the current `attemptId`. `{ ok: true }` means accepted for delivery to the waiting CLI, not connected yet. Disable repeat submission and observe status. An invalid code requires a new login attempt after the runtime reports failure.
5. `connected` appears only after native login succeeds, native auth status reports the subscription account, and credentials are encrypted and saved. The first connected provider becomes selected. Selecting another requires it to be connected.
6. An attempt expires after eight minutes; a scheduled database mutation clears the challenge and publishes an error. Display a local countdown from `loginExpiresAt` as well. `disconnect` cancels the attempt, clears local backend credentials and prevents late actions from reconnecting it. It does not revoke the grant at the provider; users can revoke there separately.

Do not show `starting` as failure just because the user switches apps. On resume, use the current server row; persist no provider password, authorization code, access token or refresh token in the mobile UI.

## Backend configuration and deployment

Set `AI_SESSION_ENCRYPTION_KEY` to a cryptographically random 32-byte base64url value in the target Convex deployment. A missing/invalid key fails closed. Credentials use AES-256-GCM with owner, provider and purpose bound as authenticated data. The key must survive deployments: rotating/removing it disconnects stored sessions unless migration is added.

Login actions execute in Convex's Node runtime, with private temporary directories, a clean child environment, pinned official binary downloads and SHA-512 verification before execution. No CLI credentials from the developer's machine are used. Temporary files are removed after the action; no child process is expected to survive between actions. CLI stdout/stderr and credentials are never returned by public endpoints.

Development verification uses **`matt-5326f:ycyc:dev/yuzu-subscriptions`**, `https://watchful-oyster-561.convex.cloud`, inside Matt's project. This isolated deployment expires around November 20, 2026. It avoids overwriting Matthew's running `convex dev` deployment. Mobile and backend must point at the same deployment; a token from a different deployment will not work. To integrate into the shared deployment, pull this branch's backend changes first, keep main current, configure the encryption key there, then deploy the combined source. Never push this branch's stale snapshot over a teammate's newer backend.

Connection uses native login. Provider policies still govern hosted use and distribution; this API is not a generic OAuth-token proxy or a promise that subscription inference is approved or available. [AI_STREAMING_API.md](AI_STREAMING_API.md) documents the native turn runner and credential snapshots.

## Checks

```sh
npm exec --yes --package=tsx -- tsx --test scripts/tests/*.test.ts
CI=1 npm run lint
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/tsc --noEmit -p convex/tsconfig.json
CONVEX_ACCOUNT=ycyc ./node_modules/.bin/convex dev --once --typecheck enable
npm exec --yes --package=tsx -- tsx --env-file=.env.local scripts/test/provider-login.ts
```

The fixture suite checks state transitions, authentication, expiry/cancellation, secret redaction, envelope binding, official challenge parsing and bounded binary extraction. Native startup and real login challenge checks are separate from a completed user authorization and from model inference.
