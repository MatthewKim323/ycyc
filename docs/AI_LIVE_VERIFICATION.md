# Real subscription verification — November 15, 2026

The real subscription login → hosted native runtime → Convex stream → client flow passed for both providers. No mock provider, injected model response, developer-machine Claude/Codex credential file, or paid API key was used for these results.

The test used the isolated `watchful-oyster-561` deployment and a private test device identity. Its capability and provider credentials are not committed. Browser authorization happened through the providers' real pages; the native CLIs exchanged the resulting codes and encrypted their credentials in Convex.

| Check | ChatGPT / Codex | Claude |
| --- | --- | --- |
| Real native subscription login | Passed | Passed |
| First completed response | 1,294 characters | 1,121 characters |
| Distinct text updates before completion | 39 | 20 |
| First visible text, including startup | 22.9 seconds | 26.2 seconds |
| First turn duration | 35.1 seconds | 31.3 seconds |
| New WebSocket resumed after first event | Passed | Passed |
| Durable cursor replay without gaps/duplicates | Passed | Passed |
| Separate hosted follow-up called real `list_apps` | Once, completed | Once, completed |
| App data changed | None | None |

The first prompt requested 24 short numbered lines without tools. The second used the same thread and requested `list_apps`, with no app mutations. Each follow-up used a fresh native process restored from the saved subscription credentials. The test identity correctly reported zero connected consumer apps.

Codex completed at 4:12 PM Pacific and Claude at 4:22 PM Pacific. Claude initially had a disabled consent button in Dia; the owner completed provider verification. A fresh attempt was required after the earlier backend attempt expired. The new code matched the active PKCE state and was accepted by the login API.

## Restore race and fixes

A separate real Codex generation exercised mobile restoration while text continued arriving. The snapshot contained cursor 1 and 21 characters; by the delayed resume the server had reached cursor 3. Resuming from the original snapshot cursor recovered all 61 remaining events, ending at cursor 62 with 1,734 characters exactly matching the final stored response.

`watchMessages` now returns its text and cursor atomically. Mobile restore uses that cursor and keeps later events available for replay. The integration also handles a rejected Claude code without entering a permanent Checking state, terminates failed subscriptions with a safe error and cleanup, and enforces AI login before onboarding continuation or Skip.

## Reproduce

Use a private identity file containing `{ "url": "https://<deployment>.convex.cloud", "token": "<own capability>", "userId": "<own user ID>" }`. Finish the real provider login first, then run:

```sh
npm exec --yes --package=tsx -- tsx scripts/test/provider-live.ts --provider codex --identity /private/path/identity.json --output /private/path/codex-report.json
npm exec --yes --package=tsx -- tsx scripts/test/provider-live.ts --provider claude --identity /private/path/identity.json --output /private/path/claude-report.json
```

The runner uses only public Convex APIs, actually closes/reopens the event WebSocket, and checks the completed response against durable event replay. Reports contain timing, cursors and non-sensitive test replies; no capability, authorization code, raw SDK errors or provider credentials.

## Scope

Verified: real provider browser authorization, hosted subscription inference, saved credential reuse across turns, real MCP installation/call, live client subscriptions and cursor restoration. Separate regression tests cover state/security and mobile adapter failures.

Not exercised: a fully rendered iOS/Android interaction, protected consumer-app records or writes, forced token expiry/renewal, or provider approval for distributing a hosted commercial service. The live test logins remain encrypted in the private dev test identity for further authorized testing. They can be removed using `aiProviders.disconnect`.
