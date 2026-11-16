// Reviewed remote services only. This is never populated from user URLs or an
// untrusted marketplace feed. Provider docs are the provenance for each entry.
export type ExternalPluginId = "mcp:deepwiki" | "mcp:context7" | "mcp:github";
export type ExternalPlugin = {
  readonly id: ExternalPluginId;
  readonly name: string;
  readonly publisher: string;
  readonly description: string;
  readonly category: string;
  readonly docsUrl: string;
  readonly endpoint: string;
  readonly auth: "none" | "api_key" | "optional_api_key";
  readonly allowedTools: readonly string[];
  readonly headers?: Readonly<Record<string, string>>;
};
const GITHUB_READS = ["get_me", "search_repositories", "get_file_contents", "search_code", "search_issues", "issue_read", "list_issues", "list_pull_requests", "pull_request_read", "search_pull_requests", "list_branches", "list_commits", "get_commit"];

export const EXTERNAL_PLUGINS: readonly ExternalPlugin[] = Object.freeze([
  {
    id: "mcp:deepwiki", name: "DeepWiki", publisher: "Cognition", category: "documentation",
    description: "Read public repository documentation and ask repository questions.",
    docsUrl: "https://docs.devin.ai/work-with-devin/deepwiki-mcp", endpoint: "https://mcp.deepwiki.com/mcp", auth: "none",
    // Official docs retain ask_question; anonymous live tools/list currently
    // advertises the equivalent read-only ask_wiki_question name.
    allowedTools: ["read_wiki_structure", "read_wiki_contents", "ask_question", "ask_wiki_question"],
  },
  {
    id: "mcp:context7", name: "Context7", publisher: "Upstash", category: "documentation",
    description: "Find libraries and read current documentation and code examples. A personal API key increases rate limits.",
    docsUrl: "https://context7.com/docs/resources/all-clients", endpoint: "https://mcp.context7.com/mcp", auth: "optional_api_key",
    allowedTools: ["resolve-library-id", "query-docs"],
  },
  {
    id: "mcp:github", name: "GitHub", publisher: "GitHub", category: "developer_tools",
    description: "Read repositories, files, issues and pull requests permitted by your personal access token. Writes are disabled.",
    docsUrl: "https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md", endpoint: "https://api.githubcopilot.com/mcp/", auth: "api_key",
    allowedTools: GITHUB_READS,
    headers: { "X-MCP-Readonly": "true", "X-MCP-Tools": GITHUB_READS.join(",") },
  },
].map((entry) => Object.freeze({ ...entry, allowedTools: Object.freeze(entry.allowedTools), ...(entry.headers ? { headers: Object.freeze(entry.headers) } : {}) })) as ExternalPlugin[]);

export function externalPlugin(id: string): ExternalPlugin | undefined {
  return EXTERNAL_PLUGINS.find((entry) => entry.id === id);
}
