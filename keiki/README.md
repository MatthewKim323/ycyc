# ycyc on iMessage (Keiki)

The `ycyc` Keiki agent puts the ycyc MCP tools behind a text thread. It runs on Keiki's shared iMessage number (no dedicated line), logs food and workouts, and answers questions about the user's day. Every write is confirmed first and followed by a short "done" receipt.

## How it reaches ycyc

Keiki's built-in MCP connections need the paid sandbox capability and take the endpoint as a literal URL, so the URL couldn't live in a secret. Instead, three code tools in [`tools.mts`](tools.mts) (`defineTool` from `@onkeiki/agents`) proxy JSON-RPC to the ycyc MCP server ([`mcp.mts`](mcp.mts)):

- `list_apps`: which apps exist, which are connected, and the tools each one adds.
- `connect_app`: returns the link that connects MyFitnessPal or Strong.
- `call_tool`: calls any tool by name. If the server doesn't mark the tool `readOnlyHint`, the call is refused until the agent passes `confirmed: true`, so a write can't happen without a yes, even if the prompt is ignored.

Each tool reads the endpoint from the Keiki org secret **`YCYC_MCP_URL`** on every call. To point the agent at another user's token, change only that secret (Keiki dashboard → Settings → Secrets, or `PUT /secrets/YCYC_MCP_URL`). You don't need to redeploy.

## Files

| File | Purpose |
| --- | --- |
| `agent.mts` | Name, model, persona prompt, and features (all paid features are off) |
| `tools.mts` | The three `defineTool` tools |
| `mcp.mts` | Minimal Streamable HTTP JSON-RPC client (`tools/list`, `tools/call`) |
| `build.mts` | Bundles each tool into the `__run(input, host)` ESM artifact that `kit.sync()` uploads, written to `dist/tools.json` |
| `deploy.mts` | Upserts the deployment `external_ref: "ycyc"` through `POST /api/v1/developer/deployments` with no channels |

## Deploy

```bash
cd keiki
bun install
bun run build.mts            # optional: inspect dist/tools.json
KEIKI_API_KEY=... bun run deploy.mts
bunx tsc --noEmit -p .       # typecheck
```

The deploy sends `channels: []` on purpose. An `imessage` channel in a deployment buys a dedicated line. The shared number needs no channel. To get the join code, call `GET /agents/:id/shared-line` or open the agent's Channels tab.

## Reaching it

Text the join code to Keiki's shared iMessage number (currently **+1 779-625-1378**, code **K-CL3GHH**). After that, the contact's messages on that number reach `ycyc`. Contact cards aren't sent from the shared number.

Every contact who joins uses the same `YCYC_MCP_URL`, which means the same ycyc user. Per-user routing needs a token lookup keyed on `ctx.phone`.
