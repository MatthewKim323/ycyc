# executor.sh (Executor, by Rhys Sullivan / UsefulSoftwareCo): teardown as of 2026-11-15

Notes legend: "Documented" = stated in Executor's own docs, README or repo source. "Marketing" = homepage, YC page, launch posts, testimonials. "Inference" = my reading, not stated anywhere. All repo/stars/download numbers were pulled live on 2026-11-15 and will go stale fast (the project shipped 8 beta releases in the 3 days before this note).

Short glossary: **MCP** = Model Context Protocol, the standard way an AI agent (Claude Code, Cursor, ChatGPT) calls external tools. **Code mode** = instead of exposing hundreds of tools to the model, expose a "run this program" tool and let the model write code that calls tools as functions. **workerd** = Cloudflare's open-source JavaScript isolate runtime (what Cloudflare Workers run on).

## 1. What does executor.sh do, in its own words and in practice? Who is the target user?

### Takeaway
Executor is an open-source (MIT) "tool gateway" that now brands itself "your agents' cloud": you connect each service account once (API key or OAuth), Executor wraps services into small TypeScript "apps" whose operations become tools, and any MCP client reaches all of them through one MCP endpoint without ever seeing a credential. It runs no AI itself and is aimed squarely at developers and agent power users (plus their teams), not consumers.

### Cited Findings
- Homepage tagline (Marketing): "Everything you use, connected in one place." It calls itself "your agents' cloud", combining connectors, skills, automations, personal software, plus "browser" and "computer" use marked "Coming soon" ([executor.sh](https://executor.sh/), fetched 2026-11-15).
- v2 README (Documented): "Everything your agent needs, drivable as code. Think of Executor as Zapier or Retool, but fully drivable as code, with everything exposed to your agent. Connect the services you already use once, and any agent can use them through one MCP endpoint, without ever seeing a credential." ([README v2](https://github.com/UsefulSoftwareCo/executor/blob/v2/README.md))
- README framing of the core unit: "Executor gives all of that one shape: the **app**. An app is a small TypeScript program that turns your accounts into tools. One app can wrap an OpenAPI spec, proxy a remote MCP server, or call an API by hand. It can also store data, serve its own UI, run in the background, and ask before it does anything risky." ([README v2](https://github.com/UsefulSoftwareCo/executor/blob/v2/README.md))
- YC listing: "The open source tool gateway"; "An MCP gateway that lets users sign in once to all their integrations and use them with any client. It supports MCP, GraphQL, and OpenAPI" ([YC company page](https://www.ycombinator.com/companies/executor)).
- "What it isn't" section (Marketing): not an agent ("runs no AI itself", extends the agent you already use through one MCP server); not n8n/Zapier (no flow builder, "your agent writes automations as code" and Executor runs them on a schedule or webhook); vs Composio, "Both connect your accounts", but Executor also lets you bring your own integrations, change how tools work and build apps on them; "MCP gateway? Yes" as the starting point ([executor.sh](https://executor.sh/)).
- Homepage example: a connected Gmail account grows from search/read/label/send tools into scheduled jobs, webhooks and a custom inbox app/dashboard; a sample "daily-brief" app reads GitHub data via OAuth, stores briefs in a database and runs a durable refresh workflow. Apps are TypeScript projects with tools, providers, workflows, SQL migrations, a skill Markdown file and a React UI ([executor.sh](https://executor.sh/)).
- Problem statement at YC launch (~Aug 2026): every agent needs its own OAuth setup per service; most connectors support only one account per service (no work + personal Gmail side by side); "once an agent holds a token, it can do anything that token allows" ([Launch YC post](https://www.ycombinator.com/launches/SBH-executor-one-place-to-connect-your-agents-to-everything)).
- v2 launched 2026-11-05: "Today we're launching Executor v2 ... You can think of v2 as if Zapier / Retool were fully drivable as code, with everything being exposed to your agent" (1,189 likes, 74k views when fetched) ([X, @RhysSullivan](https://x.com/RhysSullivan/status/2118440383353172022)).
- v1 (still on the `main` branch) was narrower: "Connect any agent to everything ... Configure every integration once (MCP servers, OpenAPI specs, GraphQL APIs) with authentication and per-tool policies, then use that one catalog from any MCP-compatible agent" ([README v1](https://github.com/UsefulSoftwareCo/executor/blob/main/README.md)).
- Testimonials are all developers (e.g. Wes Bos: connect apps once and reach them through one MCP across machines and harnesses; Serge: separate work/personal Cloudflare connections; James Brock: "Been able to cull so many tools loading at session launch") ([executor.sh](https://executor.sh/)).
- Founder's positioning essay "I don't want to use your agent" (2026-06-27): "I want to use the skills, knowledge, and APIs your company has spent years developing, not your custom agent"; argues companies should expose skills, docs, APIs, CLIs and MCP to users' own agents. It does not discuss consumers or mobile ([executor.sh blog](https://executor.sh/blog/i-dont-want-to-use-your-agent)).
- Other blog posts: "Why MCP had so many growing pains" (2026-06-25), "MCPs, APIs, and CLIs are not three separate concepts" (2026-06-26), "We're not using enough inference" (2026-08-09) ([executor.sh/blog](https://executor.sh/blog)).

### Inferences
- In practice it is three things layered: (1) a credential vault keyed by "accounts", (2) a single MCP endpoint with a fixed-size, code-mode tool surface, (3) a serverless app platform (tools + storage + UI + schedules + webhooks) that coding agents author into. v2 shifted the center of gravity from (1)+(2) "gateway" to (3) "agent-built personal software".
- Target user: someone who already lives in Claude Code/Cursor/Codex. A consumer with only a phone and a chat app is not served; there is no mobile client and the setup assumes an MCP client and, for anything not in the catalog, an agent that can write TypeScript.

### Gaps
- No public v2 user/active-account numbers found (only the ~3,000 local users claimed at YC launch, ~Aug 2026).
- No mobile app, mobile MCP client or consumer onboarding found anywhere in the site, docs or repo.

## 2. Technical architecture: gateway, sandbox, registry, auto-generator? How does it connect, authenticate and where does code run?

### Takeaway
It is all of these at once: an MCP server (one streamable-HTTP endpoint), a credential vault (encrypted per-account secrets, OAuth with DCR/CIMD/refresh), a tool registry with search, source generators that turn OpenAPI/GraphQL/remote-MCP into TypeScript apps, a code-mode JS interpreter for agent programs, and a workerd/Cloudflare-Dynamic-Workers runtime that executes the apps. Everything executes server-side: on your machine (local daemon), in your Docker container, or on Executor Cloud (Cloudflare).

### Cited Findings
**MCP surface**
- One endpoint: hosted `https://mcp.executor.sh/mcp`, self-host `<origin>/mcp`, local `http://127.0.0.1:4312/mcp`; streamable HTTP; `executor mcp` gives the same over stdio ([MCP docs source](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/mcp.md), published at executor.sh/docs/mcp).
- "The endpoint does not expose one MCP tool per app tool. However many apps you add, the tool list stays the same size." Tools: `skills` (read app-shipped instructions), `search`, `describe`, `call` (direct calls, can batch concurrently), `execute` (run a JS program), `resume` (continue after an approval/input pause) ([MCP docs](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/mcp.md)). Note: the README simplifies this to "Agents get two tools, `skills` and `execute`" ([README v2](https://github.com/UsefulSoftwareCo/executor/blob/v2/README.md)), so the docs and README disagree on the count.
- Token claim (Marketing): 1,600+ tools collapsed into ~1k tokens vs ~280k tokens of raw tool definitions ([YC page](https://www.ycombinator.com/companies/executor)); AlphaSignal coverage repeats "278,800 ... down to 1,044" tokens ([AlphaSignal](https://alphasignal.ai/news/executor-shrinks-278-800-ai-agent-tokens-down-to-1-044-with-one-tool.md)). I found no reproducible benchmark from Executor itself.

**Code mode sandbox**
- Agent writes JavaScript; inside it, tools are async functions `tools.<app-slug>.<tool>(input)`, discovered with `tools.search({ query })` and `tools.search.describe({ paths })` ([MCP docs](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/mcp.md)).
- "The interpreter has no `fetch`, no `process`, no filesystem, no timers and no imports. Its only way out is a tool call, which enters the trusted runtime where your credentials live. Limits are cooperative, not process isolation." Fixed limits: 65,536 chars of program source, 100 tool calls, 5 minutes per program (approval wait time excluded); 32 MiB per value crossing app/Executor; Cloud MCP session memory 128 MB ([MCP docs](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/mcp.md)).
- The interpreter is `@opencode-ai/codemode` on all targets ([DEVELOPMENT.md](https://github.com/UsefulSoftwareCo/executor/blob/v2/DEVELOPMENT.md)).
- Images/audio returned by tools (e.g. screenshots) are forwarded as native MCP media blocks ([MCP docs](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/mcp.md)).

**Apps (the integration unit)**
- An app = `index.ts` exporting `defineApp(requirements, { tools: router({...}) })` + `package.json` pinning an exact `apps` framework version. Operations are `query` (read-only view of app storage) or `mutation` (transactional writes to app storage); both may call external services; "external effects are never rolled back". Schema helpers: object/string/number/boolean/array/record/json/literal ([Author an app](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/author-an-app.mdx)).
- Outbound HTTP from apps uses `ctx.fetch(...)` with credentials read from `ctx.user.accounts.<slot>.fields` (e.g. a Vercel token) ([Author an app](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/author-an-app.mdx)).
- Importers: `mcpRouter` (apps/mcp), `graphqlRouter` (apps/graphql), `liveOpenapiRouter` (apps/openapi) return routers so you can wrap a service without writing handlers ([Author an app](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/author-an-app.mdx)); `packages/app-templates` are "source generators using the `apps` protocol subpaths for MCP, OpenAPI and GraphQL" ([DEVELOPMENT.md](https://github.com/UsefulSoftwareCo/executor/blob/v2/DEVELOPMENT.md)). v1 also listed Google Discovery docs as first-party ([README v1](https://github.com/UsefulSoftwareCo/executor/blob/main/README.md)).
- Extras: schedules (`appInterval`/`appCron` run as the app; `userInterval`/`userCron` per member; all start paused; app schedules cannot carry approvals), webhooks bound to an account slot, mid-tool input via `ctx.elicit` form mode ([Author an app](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/author-an-app.mdx)); stored data with live queries and private app UIs ([DEVELOPMENT.md](https://github.com/UsefulSoftwareCo/executor/blob/v2/DEVELOPMENT.md)).
- Versions: each deploy is an immutable version (Git commit + retained build); rollback changes code but "does not rewind app data or external actions"; copies/forks get fresh Git history and no accounts/data; public listings under `<org-slug>.executor.community` ([Apps and versions](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/concepts/apps-and-versions.md); [CONTEXT.md](https://github.com/UsefulSoftwareCo/executor/blob/v2/CONTEXT.md)).

**Where code runs**
- "Every product runs authored apps and workflows in workerd, never in the host Node process. Local and self-host use `workerdApps` ...; cloud uses Dynamic Workers." Native dependencies or packages with install scripts are not supported; "Apps cannot start local processes, so stdio MCP servers are not supported" ([DEVELOPMENT.md](https://github.com/UsefulSoftwareCo/executor/blob/v2/DEVELOPMENT.md)).
- Deploy targets: Executor Cloud (app.executor.sh), Desktop (Electron, beta, Mac/Windows/Linux), CLI (`curl -fsSL https://executor.sh/docs/install.sh | sh` or `npm i -g executor@beta`), self-host (one Docker container with embedded PGlite) ([README v2](https://github.com/UsefulSoftwareCo/executor/blob/v2/README.md); [executor.sh](https://executor.sh/)).
- Stack: TypeScript (~22 MB of TS source), Bun, Effect v4, PGlite locally/self-host; Cloud = Cloudflare Worker + Durable Objects + PlanetScale Postgres via Hyperdrive, deployed with Alchemy; TanStack Router dashboard; Autumn for billing ([DEVELOPMENT.md](https://github.com/UsefulSoftwareCo/executor/blob/v2/DEVELOPMENT.md); [GitHub languages API](https://github.com/UsefulSoftwareCo/executor)).

**Auth and credentials**
- Provider = a service + named auth methods declared in app code; `secrets` (fields you paste) or `oauth2` (browser sign-in). No registry: two apps declaring the same provider resolve to the same provider ID (SHA-256 of the canonical JSON definition), so one saved account is reusable across apps ([Providers and accounts](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/concepts/providers-and-accounts.md); [DEVELOPMENT.md](https://github.com/UsefulSoftwareCo/executor/blob/v2/DEVELOPMENT.md)).
- OAuth supports supplied clients, Dynamic Client Registration (DCR), CIMD and token refresh ([DEVELOPMENT.md](https://github.com/UsefulSoftwareCo/executor/blob/v2/DEVELOPMENT.md)).
- Storage: "Accounts store metadata and opaque encrypted credential bytes ... The local server uses AES-GCM with an explicitly configured key." Public account records contain only metadata ([DEVELOPMENT.md](https://github.com/UsefulSoftwareCo/executor/blob/v2/DEVELOPMENT.md)). "The agent never sees the credential; Executor attaches it inside the app" ([docs index](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/index.mdx)).
- Requirement scopes: `user` slots filled by each caller's own linked account; `app` slots filled once by an app editor for everyone (and for schedules/webhooks); `provider.many()` accepts multiple accounts. "Calls never choose accounts"; an input with `$accounts` fails with `AccountChoiceUnsupported`; to use work and personal accounts separately you copy the app ([Providers and accounts](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/concepts/providers-and-accounts.md); [MCP docs](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/mcp.md)).
- Accounts can carry a free-text description for agents, e.g. "reads only; use the sandbox account for writes" ([Providers and accounts](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/concepts/providers-and-accounts.md)).
- MCP client auth (hosted/self-host): OAuth at `/mcp/authorize`; grant bound to one organization; "scoped connections" (`/mcp?connection=<id>`) restrict which apps, which linked account, and which tools (all / read-only / picked); agents can list but not create or widen scoped connections ([MCP docs](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/mcp.md)).

**Approvals**
- Per-operation `approval`: `always()`, `never()`, or a function receiving tool name + decoded input returning `approved` / `denied` / `user-approval` (e.g. small refund runs, large one asks). `withApprovals(router, policy)` applies a rule across imported routers (e.g. ask before every GraphQL/OpenAPI mutation, or MCP tools with `destructiveHint`). "There is no app-wide setting, and nothing is inferred from whether an operation looks read-only" ([Tools and approvals](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/concepts/tools-and-approvals.md)).
- Contrast: v1 and the YC launch claimed "sensible defaults derived from the spec" / GET auto-allowed, DELETE gated ([README v1](https://github.com/UsefulSoftwareCo/executor/blob/main/README.md); [Launch YC](https://www.ycombinator.com/launches/SBH-executor-one-place-to-connect-your-agents-to-everything)). v2 moved those defaults into generated source.
- Elicitation modes chosen at sign-in and stored in the grant: `automatic` (no Executor prompt), `model` (agent relays and calls `resume`), `native` (MCP client's own form prompt), `browser` (signed-in approval page via `approvalUrl`) ([MCP docs](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/mcp.md)).

### Inferences
- The architecture is a productized version of the Cloudflare Code Mode / Anthropic "code execution with MCP" pattern plus a credential vault plus a mini Vercel-for-agent-apps. The key design move is the split: untrusted agent code runs in a capability-less interpreter; credentialed code runs only inside reviewed/deployed app code in workerd, so the LLM's program can only reach credentials through typed tool calls.
- "Agent never sees the credential" holds for the agent's program, but app code itself does see raw tokens (`ctx.user.accounts.x.fields.token`). So an agent that is allowed to author and deploy apps can, in principle, write an app that exfiltrates a token via `ctx.fetch`. I found no documented egress allowlist for `ctx.fetch` (see Gaps).

### Gaps
- No documented network egress restrictions for app code (`ctx.fetch`), nor resource limits for apps beyond the code-mode interpreter's limits.
- Hosted key custody (KMS? per-tenant keys?) is not in public docs; design notes live in a private `notes/` folder excluded from the public export ([DEVELOPMENT.md](https://github.com/UsefulSoftwareCo/executor/blob/v2/DEVELOPMENT.md)).
- I did not read the remaining ~19k characters of the homepage (mostly testimonials).

## 3. Does it "engineer its own API" for services that have none?

### Takeaway
No. There is no traffic capture, HAR replay, docs scraping pipeline, reverse-engineering or self-healing loop. The closest thing is "your agent writes the app": for any service not importable from OpenAPI/GraphQL/remote MCP, Executor hands your coding agent a setup prompt plus its `app-authoring` skill, and the agent hand-writes a TypeScript wrapper against the service's public API, which Executor then hosts, versions and guards with approvals. Browser-session providers, browser use and computer use are announced as "coming".

### Cited Findings
- "From the catalog. Add an MCP server that needs no sign-in or supports OAuth. For any other service, copy the setup prompt and your agent writes the app." ([Apps and versions](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/concepts/apps-and-versions.md))
- README: you may want to call "a service with no spec at all"; options are "Install from the catalog, add a remote MCP server by URL, or have your agent write and deploy a new app for you. Every deploy is a new version you can roll back." The agent "can read the same guide through the `skills` tool." ([README v2](https://github.com/UsefulSoftwareCo/executor/blob/v2/README.md))
- Homepage: "ask your agent to write the tool"; start with a service's existing tools and ask your agent to add what's missing ([executor.sh](https://executor.sh/)).
- The bundled "Executor app" exposes deploy/connect/select tools through MCP so the agent can deploy source and create configured copies from inside a session ([DEVELOPMENT.md](https://github.com/UsefulSoftwareCo/executor/blob/v2/DEVELOPMENT.md)); authoring needs the exact framework version from `framework.release` ([Author an app](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/author-an-app.mdx)).
- "What is coming later: Providers backed by a signed-in browser session." ([Providers and accounts](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/concepts/providers-and-accounts.md))
- Homepage lists "browser" and "computer" as "Coming soon" with no further detail ([executor.sh](https://executor.sh/)).
- Open proposal #2414 (2026-10-27, contributor JustYannicc): an `interactive()` provider method so apps can run sign-ins the host can't, e.g. device code (RFC 8628), paste-back of a fixed loopback redirect, or a backend that holds rotating refresh tokens; the account stores only an opaque `ref` ([issue #2414](https://github.com/UsefulSoftwareCo/executor/issues/2414)). Related PR #2479 adds host-registered "acquisition drivers" so such accounts survive app removal ([#2479](https://github.com/UsefulSoftwareCo/executor/issues/2479)).
- I searched repo branches and issues for browser/cookie/session/HAR/scrape/reverse/mobile and found only approval-page and tracing work, no API-discovery feature (GitHub API search, 2026-11-15, [repo](https://github.com/UsefulSoftwareCo/executor)).

### Inferences
- The "build an API on the fly" loop exists only as: coding agent + public docs + Executor deploy target. Quality depends entirely on the agent and on the service having a documented, token-authenticated API. Consumer services that only have a mobile app or a logged-in website (no public API) are out of reach today.
- "Self-healing" is approximated by versioning and fast redeploys (agent edits source, redeploys, rollback if broken), not by automatic repair.

### Gaps
- No public detail on what "browser" / "computer" will be (hosted browser? local Chrome? session-cookie providers?) or a date.

## 4. Is it open source? Repo facts, docs, changelog, launch posts

### Takeaway
Yes: MIT, TypeScript, github.com/UsefulSoftwareCo/executor, ~4.45k stars, essentially a one-person codebase developed in a private repo and exported as snapshots to the public `v2` branch, shipping beta releases multiple times a day.

### Cited Findings
- Repo stats on 2026-11-15: 4,453 stars, 419 forks, 187 open issues+PRs, license MIT, language TypeScript (plus some Rust, Go, Astro), created 2026-02-07, default branch `v2`, last push 2026-11-15T01:01Z ([GitHub API, UsefulSoftwareCo/executor](https://github.com/UsefulSoftwareCo/executor)).
- Commits: RhysSullivan 1,157; devin-ai-integration[bot] 14; next human contributor 9. Recent public commits are all titled "Export <sha>" ([contributors](https://github.com/UsefulSoftwareCo/executor/graphs/contributors)). "Development happens in this private repository. The public `UsefulSoftwareCo/executor` repository receives snapshots on its `v2` branch through `scripts/export-public.sh`"; public PRs are ported in with co-author trailers ([DEVELOPMENT.md](https://github.com/UsefulSoftwareCo/executor/blob/v2/DEVELOPMENT.md)).
- Releases: 173 on GitHub; oldest listed v1.1.8 on 2026-03-09; latest `executor@2.0.0-beta.51` on 2026-11-14; beta.44 to beta.51 shipped 2026-11-12 to 2026-11-14 ([releases](https://github.com/UsefulSoftwareCo/executor/releases)).
- npm: `executor` latest 1.6.11 (v1), `beta` tag 2.0.0-beta.51; 29,320 downloads in the week 2026-11-07 to 11-13 ([npm downloads API](https://api.npmjs.org/downloads/point/last-week/executor); [npm](https://www.npmjs.com/package/executor)). YC launch (~Aug 2026) claimed ~14k/week ([Launch YC](https://www.ycombinator.com/launches/SBH-executor-one-place-to-connect-your-agents-to-everything)). The npm package record was created in 2011, so the name was evidently taken over from an older package (Inference from npm `time.created`).
- Earlier repo home: github.com/RhysSullivan/executor (linked in an April 2026 HN comment) ([HN item 47753689](https://news.ycombinator.com/item?id=47753689)).
- Docs: executor.sh/docs, sources in `apps/docs/content` (index, mcp, mcp-clients, connect-an-account, author-an-app, concepts/{providers-and-accounts, tools-and-approvals, apps-and-versions, organizations-and-access}, run/{cli, self-host, tracing, usage-analytics}, api-keys) ([repo tree](https://github.com/UsefulSoftwareCo/executor/tree/v2/apps/docs/content)).
- Demo video ([YouTube](https://youtu.be/NWYFpDW02Dw)) and walkthrough booking listed on YC ([YC page](https://www.ycombinator.com/companies/executor)); a Kent C. Dodds chat episode with Rhys Sullivan on "primitives, agent UX and Executor" exists ([kentcdodds.com](https://kentcdodds.com/chats/07/10/primitives-agent-ux-and-executor-product-engineering-with-rhys-sullivan)).
- Hacker News: Algolia search found no dedicated launch thread with executor.sh as the URL; it appears in comments, e.g. "mcp with 2 tools: execute(code) and search(query) ... executor is a great implementation of this" (2026-09-23) ([HN 49805748](https://news.ycombinator.com/item?id=49805748)), and a comparison to Agent Vault ("executor.sh is an integration and execution layer for agents", while Agent Vault is a MITM credential proxy) (2026-04-24) ([HN 47865822](https://news.ycombinator.com/item?id=47865822)).

### Inferences
- "Open source" is real (MIT, full server, self-hostable) but governance is single-maintainer; internal design notes are private. Treat API surfaces as unstable (e.g. `apps@0.0.1-beta.90` broke `ctx.accounts`).

### Gaps
- No Product Hunt launch found (not searched exhaustively). No changelog page beyond GitHub releases/changesets was reviewed.

## 5. Who is behind it? Funding, launch dates, pricing

### Takeaway
Solo founder Rhys Sullivan (ex-Vercel), YC Summer 2026, team of one in San Francisco; v1 shipped early 2026, YC launch ~Aug 2026, v2 on 2026-11-05. Open-source local/self-host is free; Cloud is free up to 3 members, $15/member/month for Team, custom Enterprise.

### Cited Findings
- Founder: Rhys Sullivan, solo technical founder; previously engineer at Vercel, Microsoft, Raven Software, Epic Games; built answeroverflow.com to 1.5M monthly users bootstrapped. YC batch Summer 2026, founded 2026, team size 1, SF Bay Area, primary partner Jared Friedman ([YC company page](https://www.ycombinator.com/companies/executor)).
- GitHub org is "UsefulSoftwareCo"; contact rhys@executor.sh; X @RhysSullivan and @executorsh; Discord ([executor.sh](https://executor.sh/); [YC page](https://www.ycombinator.com/companies/executor)).
- Timeline: repo created 2026-02-07 ([GitHub API](https://github.com/UsefulSoftwareCo/executor)); v1.1.8 on 2026-03-09 ([releases](https://github.com/UsefulSoftwareCo/executor/releases)); Launch YC post shown as "3 months ago" on 2026-11-15 with 2,800+ stars, ~14k npm/week, ~3,000 local users ([Launch YC](https://www.ycombinator.com/launches/SBH-executor-one-place-to-connect-your-agents-to-everything)); v2 launch 2026-11-05 ([X](https://x.com/RhysSullivan/status/2118440383353172022)).
- Pricing (Executor Cloud): Free $0/month, up to 3 members, unlimited integrations; Team $15/member/month, 14-day trial, verified domains and join-by-domain, billing counts active members only; Enterprise custom: self-hosted or dedicated cloud support, SSO/SAML, SCIM, audit logs for every tool call, SOC 2/DPA on request. Page says Cloud and self-hosted "are the same code" ([executor.sh/pricing](https://executor.sh/pricing)).

### Inferences
- Pricing is per seat, not per tool call or per execution, which suggests compute cost is assumed small (Cloudflare isolates) and the business is team collaboration + enterprise controls.

### Gaps
- Funding amount beyond YC participation not found. No disclosed revenue or paying-customer counts.

## 6. Limits and criticisms (security of agent-written code, credential handling, reliability)

### Takeaway
Executor is unusually candid in its docs about its limits: the code-mode sandbox is cooperative not process-isolated, approval does not cover an app's own setup code, approvals cannot be remembered yet, programs cannot resume after restarts, and external side effects are never rolled back. Structural risks: a hosted honeypot of every user's tokens, agent-authored app code that does see raw credentials, single-maintainer bus factor, and visible beta instability.

### Cited Findings
- "Limits are cooperative, not process isolation" for the code-mode interpreter ([MCP docs](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/mcp.md)); "CodeMode's interpreter limits and cancellation remain cooperative" ([DEVELOPMENT.md](https://github.com/UsefulSoftwareCo/executor/blob/v2/DEVELOPMENT.md)).
- "The app's own setup has already run, with its credentials, before any tool approval is evaluated. Approval governs the selected tool, not your trust in the app's code. Decide that when you deploy or install it." Skill text never grants permission ([Tools and approvals](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/concepts/tools-and-approvals.md)).
- Declining fails that call but "does not undo tool calls that already ran"; agents must not re-run to get past a refusal ([Tools and approvals](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/concepts/tools-and-approvals.md)).
- Coming later (i.e. missing now): remembering approvals; resuming a program after server restart ("the program must not be run again automatically, because earlier tool calls may already have taken effect"); browser approval for tools called from an app's own web page ([MCP docs](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/mcp.md); [Tools and approvals](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/concepts/tools-and-approvals.md)).
- MCP clients with shorter tool-call timeouts ("often 60 seconds") may cancel a program that is allowed 5 minutes; a 64 MiB value on Cloud "can end with no answer" ([MCP docs](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/mcp.md)).
- A remote MCP tool returning `isError: true` "may still have made changes"; "success only means no tool error was reported" ([MCP docs](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/mcp.md)).
- `automatic` elicitation mode "approves tool calls at once" and relies on the agent's own permission prompt ([MCP docs](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/mcp.md)).
- Platform limits: no stdio MCP servers, no native deps or install scripts, remote SDK facade not implemented, durable discovery indexes and app-to-app calls deferred ([DEVELOPMENT.md](https://github.com/UsefulSoftwareCo/executor/blob/v2/DEVELOPMENT.md)).
- Open reliability bugs on 2026-11-15: hosted MCP intermittently returns HTTP 508 on `tools/call` and `resume` ([#2379](https://github.com/UsefulSoftwareCo/executor/issues/2379)); local offline MCP grants stop working seven days after server start ([#2550](https://github.com/UsefulSoftwareCo/executor/issues/2550)); LinkedIn OAuth `invalid_client` on Cloud and self-host ([#2468](https://github.com/UsefulSoftwareCo/executor/issues/2468)); 42 open issues with "[bug]" in the title (GitHub search, [repo issues](https://github.com/UsefulSoftwareCo/executor/issues)).
- Breaking change example: apps written before `apps@0.0.1-beta.90` that read `ctx.accounts` "now fail" ([Author an app](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/author-an-app.mdx)).
- General critique of the code-execution pattern from Anthropic: running agent-generated code "requires a secure execution environment with appropriate sandboxing, resource limits, and monitoring", adding operational overhead and security considerations that direct tool calls avoid ([Anthropic engineering, 2025-11-04](https://www.anthropic.com/engineering/code-execution-with-mcp)).
- Installed public apps are copies and do not get upstream fixes ("Upstream changes do not update it") ([CONTEXT.md](https://github.com/UsefulSoftwareCo/executor/blob/v2/CONTEXT.md)).

### Inferences
- Credential concentration: Executor Cloud holds every connected OAuth token and API key for every member; compromise of the hosted tier (Cloudflare Worker + PlanetScale) would be high impact. The local mode avoids this but then requires the user's machine to be on for schedules/webhooks.
- The real trust boundary is "who may deploy app code". If an agent can deploy apps (it can, via the Executor app), a prompt-injected agent could deploy code that reads `ctx.user.accounts.*.fields` and posts them out with `ctx.fetch`, unless deploy itself is approval-gated. I did not find docs saying deploy always requires human approval.
- I found no substantive public criticism threads (HN/Reddit) specific to Executor; sentiment in found mentions is positive and developer-centric.

### Gaps
- No third-party security audit, pentest, or SOC 2 report found (SOC 2 is "on request" for Enterprise).
- Whether app deploys from an agent session require approval by default is not documented in the pages read.

## 7. Closest comparables and how Executor differs

### Takeaway
Executor sits between "managed connector catalogs" (Composio, Arcade, Pipedream, Zapier MCP), "registries/hosts" (Smithery), and "code-mode patterns" (Cloudflare Code Mode, Anthropic code execution with MCP). Its differentiators are open source + self-host, multi-account per service, input-aware per-tool approvals in code, and agent-authored hosted apps. It does not do what Integuru or Unbrowse do (reverse-engineer internal APIs from traffic) or what browser-use/Stagehand do (drive a browser).

### Cited Findings
- **Composio**: Executor's own comparison: "Both connect your accounts"; Executor adds bring-your-own integrations, editable tools and apps ([executor.sh](https://executor.sh/)). Composio core is Apache 2.0 with managed OAuth and a large catalog; comparisons note lighter RBAC (vendor-authored comparison, biased) ([CData](https://www.cdata.com/blog/composio-alternatives-ai-agents); [Arcade vs Composio](https://arcade.dev/compare/arcade-vs-composio/)). A third-party post frames Executor as a "Self-Hosted Open-Source Composio Alternative" ([bitdoze](https://www.bitdoze.com/executor-sh-vs-composio/), title only, not read).
- **Arcade.dev**: positioned on per-user agent authorization; ~80 first-party MCP servers / ~7,000 tools, proprietary token engine (figures from vendor-authored comparisons, unverified) ([Nango](https://nango.dev/blog/best-mcp-servers-for-agent-api-integrations); [CData](https://www.cdata.com/blog/arcade-dev-alternatives-ai-agents)).
- **Pipedream Connect / MCP**: hosted MCP servers for ~2,800 APIs, internal-automation oriented; Workday acquisition reported Dec 2025 (secondary sources, flagged as needing verification) ([Nango](https://nango.dev/blog/best-mcp-servers-for-agent-api-integrations)).
- **Zapier MCP**: hosted remote MCP listed as `com.zapier/mcp`; 9,000+ apps and 30,000 to 40,000+ actions (sources conflict); Zapier handles OAuth; reportedly each successful tool call uses two Zapier tasks ([rywalker.com research](https://rywalker.com/research/zapier-mcp); [Smithery listing](https://smithery.ai/server/zapier); [zapier/zapier-mcp](https://github.com/zapier/zapier-mcp)).
- **Smithery**: registry plus hosting for MCP servers; a secondary source cites a March 2026 scan where 22 of 100 Smithery servers had security findings ([apideck](https://www.apideck.com/blog/mcp-server-directories); [respan](https://www.respan.ai/market-map/compare/smithery-vs-zapier-mcp)).
- **Cloudflare Code Mode**: converts MCP tools into a TypeScript API and has the LLM write code against it, executed in a Worker isolate; Cloudflare's own Code Mode MCP server reportedly exposes its whole API (~2,500 endpoints) in ~1,000 tokens ([Cloudflare blog](https://blog.cloudflare.com/code-mode/); [InfoQ](https://infoq.com/news/2026/04/cloudflare-code-mode-mcp-server)). Executor Cloud itself runs apps on Cloudflare Dynamic Workers ([DEVELOPMENT.md](https://github.com/UsefulSoftwareCo/executor/blob/v2/DEVELOPMENT.md)).
- **Anthropic "Code execution with MCP"** (2025-11-04): present MCP servers as a filesystem of TypeScript files (one file per tool) or a `search_tools` tool; example task dropped from 150,000 to 2,000 tokens (98.7%) ([Anthropic engineering](https://www.anthropic.com/engineering/code-execution-with-mcp)).
- **Open-source codemode libraries**: `universal-tool-calling-protocol/code-mode` (1,667 stars) and others; Executor uses `@opencode-ai/codemode` ([GitHub search](https://github.com/universal-tool-calling-protocol/code-mode); [DEVELOPMENT.md](https://github.com/UsefulSoftwareCo/executor/blob/v2/DEVELOPMENT.md)).
- **Integuru** (AGPL-3.0, 4,799 stars, last push 2026-06-24): "The first AI agent that builds permissionless integrations through reverse engineering platforms' internal APIs" ([Integuru-AI/Integuru](https://github.com/Integuru-AI/Integuru)).
- **Unbrowse** (926 stars, pushed 2026-11-13): replays a site's first-party HTTP requests instead of a browser; learns a site once from a recorded cloud browser session or two HAR recordings and compiles it into a one-call capability; public registry of compiled sites; vendor claims 950 ms uncached vs 3,404 ms browser automation (3.6x across 94 domains), 67 ms cached; passwords kept in Unbrowse's password manager; paper "Internal APIs Are All You Need" (arXiv:2604.00694) ([unbrowse-ai/unbrowse](https://github.com/unbrowse-ai/unbrowse)).
- **browser-use / Stagehand**: both Playwright-based; Stagehand gives developer primitives (`act`, `extract`, `observe`), browser-use is an autonomous agent; blog estimates put AI browser automation at ~72 to 78% task completion and 85 to 95% reliability vs 99%+ for scripted selectors (unverified blog numbers) ([morphllm](https://morphllm.com/comparisons/stagehand-vs-browser-use); [nxcode](https://www.nxcode.io/resources/news/stagehand-vs-browser-use-vs-playwright-ai-browser-automation-2026); [pkgpulse](https://www.pkgpulse.com/guides/stagehand-vs-playwright-ai-vs-browser-use-ai-web-2026)).
- **Agent Vault** (HN, 2026-04-24): MITM credential-injection proxy that works across API/CLI/SDK/MCP; commenters place it at a different layer from Executor ([HN 47865822](https://news.ycombinator.com/item?id=47865822)).

### Inferences
- Positioning map: Composio/Arcade/Pipedream/Zapier = "we maintain the connectors"; Executor = "you (your agent) own the connector code, we host and guard it"; Integuru/Unbrowse = "we derive the connector from traffic"; browser-use/Stagehand = "no connector, drive the UI". An "everything MCP" for phone apps would need the Executor layer (vault, approvals, code mode) plus an Unbrowse/Integuru-style derivation layer, because most consumer apps have no public API.
- Executor's token story is not unique (Cloudflare and Anthropic published the same pattern in 2025); its moat is product surface (multi-account, approvals-in-code, app hosting) and open source.

### Gaps
- I did not read Composio, Arcade, Pipedream or Zapier first-party docs this session; their figures above come from vendor-authored comparisons and should be rechecked.

## 8. Which mechanisms transfer to a phone-based "connect every app" product, and which need a server/desktop?

### Takeaway
The ideas that transfer are protocol and policy ideas: a fixed-size tool surface (search + describe + execute) instead of one tool per app, accounts separated from integrations and never shown to the agent, input-aware per-tool approval callbacks, scoped connections, multiple accounts per service, versioned agent-authored connectors with rollback, and approval routed to wherever the human is. The execution pieces (workerd/Dynamic Workers running agent-written TypeScript, schedules, webhooks, OAuth callback hosting, durable workflows) are server-side by design and also collide with iOS rules on downloaded code and cross-app data access. Executor has nothing for the hardest consumer problem: apps with no public API.

### Cited Findings
- Executor's untrusted-code boundary: agent programs get no fetch/fs/imports and reach the outside only via tool calls into the trusted runtime ([MCP docs](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/mcp.md)); credentialed app code runs in workerd or Cloudflare Dynamic Workers, never the host process ([DEVELOPMENT.md](https://github.com/UsefulSoftwareCo/executor/blob/v2/DEVELOPMENT.md)).
- Approval routing options already include a separate signed-in browser page (`browser` mode) "when you do not want the agent to be the one holding the question" ([MCP docs](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/mcp.md)).
- Approval functions see decoded input and can return approved/denied/user-approval (e.g. refund thresholds) ([Tools and approvals](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/concepts/tools-and-approvals.md)).
- Provider identity by content hash means two independently written connectors for the same service share saved accounts without a central registry ([Providers and accounts](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/concepts/providers-and-accounts.md)).
- Planned "providers backed by a signed-in browser session" and the `interactive()` sign-in proposal (device code, paste-back, backend-held tokens) are the pieces closest to consumer logins ([Providers and accounts](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/concepts/providers-and-accounts.md); [#2414](https://github.com/UsefulSoftwareCo/executor/issues/2414)).
- Schedules and webhooks run "without a caller", with app accounts, and start paused; app schedules cannot carry approvals because "no person is there to ask" ([Author an app](https://github.com/UsefulSoftwareCo/executor/blob/v2/apps/docs/content/author-an-app.mdx)).
- Apple App Review 2.5.2: apps "may not read or write data outside the designated container area, nor may they download, install, or execute code which introduces or changes features or functionality of the app, including other apps" ([App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)).
- Apple 4.7 allows "HTML5 and JavaScript mini apps and mini games, streaming games, chatbots, and plug-ins" not embedded in the binary, but 4.7.2: "Your app may not extend or expose native platform APIs or technologies to the software without prior permission from Apple"; 4.7.3 requires explicit user consent in each instance before sharing data or permissions with such software; 4.7.4 requires an index of offered software ([App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)).
- Unbrowse's derivation approach (record a browser session or two HARs, compile first-party requests into a replayable capability, keep passwords in its own manager) is the closest existing mechanism to "build an API per app on the fly" for web-backed services ([unbrowse-ai/unbrowse](https://github.com/unbrowse-ai/unbrowse)).

### Inferences
**Transfers well (can live in a phone product, mostly as design):**
- Fixed tool surface + code mode: keeps the agent's context small no matter how many phone apps are connected; the phone never needs to ship hundreds of tool schemas to the model.
- Accounts vs connectors vs requirements, `.many()` multi-account, account descriptions for agents ("use personal Gmail for X"), scoped connections per agent: all pure data model, platform-agnostic.
- Input-aware approval callbacks map naturally to consumer guardrails (auto-allow reads, ask before payments over $X, block deletes), and Executor's `browser`/`native` elicitation modes map to a phone push notification / lock-screen approval. A phone is arguably a better approval surface than a desktop browser.
- Versioned connectors with rollback and fork/copy semantics: useful for a crowd-sourced or agent-generated connector registry, as long as the code runs server-side.

**Needs a server (or desktop), not the phone:**
- Running agent-authored connector code: Executor runs it in workerd/Dynamic Workers. On iOS, downloading and executing new connector code that changes app functionality runs into 2.5.2; 4.7 allows JS "plug-ins" only with indexing, consent and no native-API exposure. Practical answer: connectors execute in the cloud, the phone is the vault UI, connect UI and approval UI.
- Schedules, webhooks, durable workflows and OAuth redirect hosting all assume an always-on host.
- Credential custody: Executor's model is a server-held encrypted vault; a phone-first product could instead keep secrets in the device keychain and only release short-lived tokens, but then background/scheduled actions need the server anyway.

**Not solved by Executor at all (the hard part for "every phone app"):**
- Most consumer phone apps have no public API, no OpenAPI spec and no MCP server, and iOS sandboxing (2.5.2) means one app cannot read another app's data or traffic. Executor's "agent writes the app from public docs" loop does not apply. Discovery would have to come from web counterparts (Unbrowse/Integuru-style capture of first-party HTTP calls, done in a server-side browser), from OS-level intents/shortcuts, or from official APIs where they exist. That is a separate research question from Executor.

### Gaps
- No evidence Executor plans a mobile client or consumer tier; nothing found.
- iOS-specific mechanisms (App Intents, Shortcuts, background task limits) and Android equivalents (Accessibility Service, intents) were out of scope for this source and not researched here.
