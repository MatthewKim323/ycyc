# Marketplace API

This is an API-only catalog and installation layer. It combines curated Yuzu connectors, the current user's published learned tools, and reviewed external MCP integrations. It adds no marketplace UI, OAuth flow, package installation or arbitrary MCP-server configuration.

All public operations require the current user's private Yuzu `token`. User IDs are derived on the server; callers cannot select another owner. Treat the token as a credential and do not put it in logs, plugin arguments or public links.

## Catalog

| Public Convex query | Arguments | Return |
| --- | --- | --- |
| `marketplace.list` | `{token, query?, kind?}` | `MarketplaceItem[]`; `kind` is `"yuzu"` or `"mcp"`. Search matches name, description, publisher and category. |
| `marketplace.get` | `{token, pluginId}` | One `MarketplaceItem`, or `null` when unavailable to this user. |
| `marketplace.installed` | `{token}` | Items whose state is anything other than `not_installed`. This includes entries needing connection, still connecting, or in error. |

Each `MarketplaceItem` contains:

```ts
{
  id: string;
  kind: "yuzu" | "mcp";
  source: "connector" | "learned" | "remote";
  name: string;
  description: string;
  publisher: string;
  category: string;
  visibility: "public" | "private";
  auth: string;
  sourceUrl: string;
  state: "not_installed" | "needs_connection" | "connecting" | "installed" | "error";
  toolCount: number;
  readOnly: boolean;
  permissions: string[];
  connectUrl?: string;
  errorCode?: string;
}
```

Plugin identifiers are stable:

| ID | Source and access |
| --- | --- |
| `yuzu:<appSlug>` | Curated native connector. Uses the user's existing app connection and its existing write-approval policy. |
| `learned:<toolId>` | One published private learned tool. Visible only to its owner while its evidence remains valid. Learned writes require one-time exact-action approval. |
| `mcp:deepwiki` | Reviewed public-repository documentation tools; no key required. |
| `mcp:context7` | Reviewed library documentation tools; an optional Context7 API key can be connected. |
| `mcp:github` | Reviewed GitHub read tools; requires the user's GitHub personal access token. GitHub writes are excluded. |

Existing live native connections and valid published learned tools appear without requiring a new installation record. An explicit uninstall overrides that implicit availability. `visibility: "public"` describes catalog metadata, not access to another user's account or credentials. Installation also does not prove upstream availability: inspect `state` and the actual call result.

## Installation and credentials

These are public Convex **actions** intended for an explicit user-controlled API flow. The agent receives no install, connect, refresh or uninstall MCP tools.

| Action | Arguments | Behavior |
| --- | --- | --- |
| `marketplaceActions.install` | `{token, pluginId}` | Enables a native/learned entry or discovers reviewed external tools. A native app needing login returns its existing `connectUrl`; it does not sign in automatically. |
| `marketplaceActions.connect` | `{token, pluginId, apiKey}` | Connects a key only for an external integration that supports credentials. Native app login uses its existing sign-in flow. |
| `marketplaceActions.refresh` | `{token, pluginId}` | Refreshes availability and external tool discovery, reusing this installation's connected key when present. |
| `marketplaceActions.uninstall` | `{token, pluginId}` | Revokes this user's entry and returns `{ok: true, pluginId, state: "not_installed"}`. |

Install/connect/refresh normally return `{ok: true, plugin: MarketplaceItem | null}`. An integration failure returns `{ok: false, error: {code, message}, plugin?}`. `ok: true` with `plugin.state: "needs_connection"` is a successful setup step, not a completed connection. Concurrent or repeated installs can return the existing `connecting` state.

`apiKey` accepts 16–4096 characters from the supported token character set. It means the selected integration's credential: a GitHub PAT or an optional Context7 key. It is never a Yuzu app password, app cookie, AI subscription credential or Yuzu capability. Keys are encrypted with a user-and-plugin-specific scope and are omitted from catalog/tool responses. DeepWiki does not accept a key. OAuth is not implemented.

Uninstalling a curated native connector atomically disconnects it, removes its captures/builds, denies pending approvals, clears its approval grants and expires queued app calls. Uninstalling a private learned entry disables that tool and denies its pending learned-write approvals; it does not disconnect every other tool using the same app. Remote uninstall clears its saved key and tool metadata. Runtime tombstones prevent removed entries from being reused through the older app/learning paths. In-flight remote/native marketplace calls recheck installation state before releasing their result. Another user's installation is unaffected.

## Tool discovery and calls

`marketplaceActions.tools({token, pluginId})` requires state `installed` and returns:

```ts
{
  ok: true,
  pluginId: string,
  tools: Array<{
    name: string;
    description: string;
    inputSchemaJson: string;
    kind: "read" | "write";
    toolId?: string; // Private learned tools only.
  }>;
}
```

Parse `inputSchemaJson` as JSON before constructing arguments. It is deliberately a string, rather than a Convex object that might contain unsupported JSON-Schema keys. Only reviewed, actually discovered external tools are exposed. Remote tool descriptions and output remain untrusted data.

`marketplaceActions.call({token, pluginId, tool, args, requestId?})` accepts a structured argument object matching that tool's schema. The public API bounds serialized arguments to 32 KiB and validates their structure; the MCP broker applies a smaller 16,384-character serialized-argument limit. Never embed the Yuzu token or connected plugin key in arguments.

- **Curated native connector:** returns `{ok, pluginId, tool, result}`, with `result` in the existing Yuzu MCP content format. Calls use the existing app-tool/approval path; curated writes retain their existing policy.
- **Private learned tool:** returns `{pluginId, tool, result}`, where `result` is the parsed learning response. Do not infer success from the outer envelope. Reads return the bounded learned-read result. Writes require `requestId` matching `^[A-Za-z0-9_-]{8,128}$`; IDs are never autogenerated. The nested result initially contains `{status: "approval_required", approvalId, preview, executed: false, ...}`. Wait for the user's one-time exact-action approval, then obtain the execution receipt with the existing `check_approval` MCP tool. Approval is not execution; do not resubmit the write or generate a new key to retry an uncertain outcome. See [APP_LEARNING.md](./APP_LEARNING.md) for write restrictions and expiry rules.
- **External integration:** returns `{ok, pluginId, tool, result}`. `result` contains the bounded, scrubbed remote MCP text content and `isError`. Calls are restricted to the reviewed read-only allowlist and the installation's discovered tool names. No native app cookies, app-session credentials or AI subscription credentials are forwarded.

Handled failures use `{ok: false, error: {code, message}}`, with codes including `not_installed`, `invalid_arguments`, `authentication_required`, `rate_limited`, `invalid_response`, `unavailable` and `revoked`. Authentication failures and unknown plugin identifiers can also reject the Convex request before an envelope is produced. Provider diagnostics, keys and session headers are not part of these public errors.

Example with an existing Convex client and private token:

```ts
const catalog = await client.query(api.marketplace.list, { token, kind: "mcp" });
const installed = await client.action(api.marketplaceActions.install, {
  token, pluginId: "mcp:deepwiki",
});
if (installed.ok && installed.plugin?.state === "installed") {
  const tools = await client.action(api.marketplaceActions.tools, {
    token, pluginId: "mcp:deepwiki",
  });
  // Parse the returned inputSchemaJson and select a reviewed tool before calling.
}
```

## Native-agent boundary

Both hosted runtimes still connect to **one Yuzu MCP server**. Its marketplace tools are:

| MCP tool | Public API behind it |
| --- | --- |
| `list_plugins()` | `marketplace.installed({token})` |
| `plugin_tools({pluginId})` | `marketplaceActions.tools({token, pluginId})` |
| `call_plugin_tool({pluginId, tool, args, requestId?})` | `marketplaceActions.call({token, pluginId, tool, args, requestId?})` |

The token comes from the current Yuzu MCP URL, never from model-supplied arguments. The broker does not expose installation or permission-changing operations. External endpoints and tool allowlists come from the reviewed server catalog, not caller URLs or a third-party marketplace feed. There is no stdio transport, plugin-package execution, arbitrary shell command or additional native MCP server. Installing an external integration grants access only to its reviewed tools and its own explicitly connected credential.

## Verification

An isolated deployment passed a real two-user DeepWiki check: both users installed concurrently, and `read_wiki_structure` was called for `modelcontextprotocol/typescript-sdk`. A real call through the Yuzu MCP broker also passed. Uninstalling user A blocked A's later calls while user B remained installed and could still inspect the tools; both test installations were cleaned up.

This verifies the public API and Yuzu broker path, not a hosted Claude/Codex marketplace-loading session. No GitHub PAT, Context7 key, protected consumer-app write or marketplace UI was exercised by that live check. The final regression run for this change passed 241 tests, both typechecks and lint; credentials and private capabilities are not committed.
