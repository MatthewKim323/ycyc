# Agent-led app API learning

Both hosted native agents receive Yuzu's discovery and learning MCP tools automatically. They can research a requested app, inspect the user's captured request schemas, create an immutable private read tool, verify its real endpoint, publish it, and call it in the same session. Neither native runtime receives a shell, arbitrary code execution, raw source/capture bodies, or session credentials.

## Workflow

1. `search_apps({query})` finds App Store apps. `investigate_app({app})` accepts a returned app slug or a public HTTPS website URL. It reads public HTML/JavaScript/documentation and returns same-origin source IDs and endpoint evidence IDs. Follow a source with `investigate_app({app,sourceId})`.
2. For authenticated data, `connect_app` opens the existing mobile sign-in/capture flow. Unknown web apps finish at **Capture ready**, then return to the in-app agent. Their captures no longer create or publish global recipes. `inspect_app_capture({app})` returns endpoint paths, response types and optional query schemas, never recorded values or credentials.
3. `build_app_tool({app,evidenceId,name,title,responsePath?})` creates a private immutable draft. The server chooses the GET request and derives its optional arguments from observed query keys. The model cannot supply a request URL, header, method, body, login exchange or executable code.
4. `verify_app_tool({toolId,args?})` calls the actual endpoint and requires a successful JSON object/array at the selected response path. Its receipt contains status and schema, not response values. Verification does not itself publish a tool.
5. `publish_app_tool({toolId})` requires a fresh server verification receipt and the same app session. `call_learned_tool({toolId,args?})` executes the published read and returns bounded, credential-scrubbed app data.

`list_apps` includes private learned tool IDs and input schemas, so later sessions can reuse them. It also includes schemas for existing app tools. `call_app_tool({app,tool,args})` calls existing connector tools without requiring the native MCP client to refresh its initial catalog; existing writes keep the approval/exactly-once path.

## Boundaries

- Learning is initially limited to a conservative subset of same-origin JSON GET reads. Final paths must identify a supported read operation; unknown operations, GraphQL, login/refresh, writes, dynamic authorities and unsupported parameters are refused. GET alone is not treated as proof that an arbitrary endpoint is safe.
- Query arguments replace values of observed keys only. They cannot change hosts, paths, methods, headers or introduce new query keys. Path-parameter templating and automatic cross-origin authentication are not supported.
- Public research has no cookies or custom authorization. Requests require HTTPS, public unicast IPs, DNS pinned to the checked address, valid TLS, exact origin, no redirects, a 10-second deadline and a 256 KiB body limit. Compressed responses are refused.
- Captured session headers are chosen server-side from observed header names. The captured connection ID, active status and session hash are checked before and after the read. Disconnect/re-login revokes old evidence, including a recreated connection with identical session JSON.
- Evidence and tools are owner scoped by the private MCP capability. There is no public verification/publish mutation. Draft specifications are immutable and never saved to the shared recipe table. Source evidence expires after one day; endpoint evidence after seven days. Publishing requires verification within ten minutes. Expired evidence/tools are pruned as new evidence/tools are created; account deletion removes both tables.
- Existing curated connectors continue to work. Previously stored legacy shared recipes are not migrated by this change. New unsupported web captures hand off privately instead of compiling globally.
- Native-only apps, unknown write APIs, absent API evidence, expired sessions, cross-origin APIs and unsupported response formats require user login/capture or a reviewed connector. The agent must explain this instead of inventing API behavior or success.

## Account linking prerequisite

The previous `users.get` capability disclosure is removed. Google account linking now requires a verified Clerk JWT and the current device capability. Mobile uses the official Convex/Clerk bridge when Clerk is configured. Enable Clerk's Convex integration (or its `convex` JWT template with audience `convex`), and set `CLERK_JWT_ISSUER_DOMAIN` to that same Clerk instance's HTTPS Frontend API origin on each backend. Device mode remains available if verified account linking is unavailable. These checks do not constitute a migration of every legacy user-ID-only API.

## Verification

Regression coverage includes ownership, immutable revisions, fresh verification, session invalidation during reads, credential echoes (including escaped/nested JSON), endpoint constraints, query arguments, SSRF/redirect/body limits, MCP dispatch, write approvals, capture handoff and account-link authentication. Real public-API and hosted-agent verification results are recorded below when run; protected consumer-app login/writes and rendered mobile interaction are separate checks.

### Real verification — November 15, 2026 Pacific

The deployed MCP workflow passed against [Open Library's public Search API documentation](https://openlibrary.org/dev/docs/api/search), without fabricated source, API responses or provider output. Real App Store search returned 17 results. Investigation extracted endpoint evidence from the documentation; the test built a draft, confirmed publication was blocked before verification, verified HTTP 200 against the real API, published privately, then changed observed query arguments and received **Pride and Prejudice** by Jane Austen. A second real device identity could neither list nor call the tool.

Both actual hosted subscription agents independently completed investigation → build → real verification → publication → parameterized call in a single turn, creating separate private tools. Claude completed in 42.8 seconds; Codex in 43.9 seconds. Durable tool events and the published private-tool records were checked, in addition to the final answer. These runs used the isolated `watchful-oyster-561` deployment and the already authorized private test identity; provider credentials and MCP capabilities are not committed.

All 142 regressions passed, along with application/Convex typechecks, full lint and diff checks. No protected consumer-app records or writes were exercised, and the rendered native capture UI has not been manually tested.

```sh
npm exec --yes --package=tsx -- tsx scripts/test/app-learning-live.ts /private/identity.json /private/public-api-report.json
npm exec --yes --package=tsx -- tsx scripts/test/agent-learning-live.ts /private/identity.json /private/claude-report.json claude
npm exec --yes --package=tsx -- tsx scripts/test/agent-learning-live.ts /private/identity.json /private/codex-report.json codex
```

The identity file is the same private `{url,token}` format used by the subscription verification runner. The two agent checks require an already connected real subscription. Appending `resume` rechecks the latest matching run using durable records without generating another model response. Reports omit credentials and capabilities.
