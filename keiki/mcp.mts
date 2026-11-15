export type McpTool = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
}

let nextId = 1

export async function rpc(url: string, method: string, params?: Record<string, unknown>): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  })
  if (!res.ok) throw new Error(`ycyc MCP ${method} failed: HTTP ${res.status}`)
  const body = (await res.json()) as { result?: any; error?: { message?: string } }
  if (body.error) throw new Error(`ycyc MCP ${method} failed: ${body.error.message ?? 'unknown error'}`)
  return body.result
}

export async function listTools(url: string): Promise<McpTool[]> {
  return ((await rpc(url, 'tools/list')) as { tools: McpTool[] }).tools
}

export async function callTool(url: string, name: string, args: Record<string, unknown>) {
  const result = (await rpc(url, 'tools/call', { name, arguments: args })) as {
    content?: Array<{ type: string; text?: string }>
    structuredContent?: unknown
    isError?: boolean
  }
  const text = (result.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
  return { ok: !result.isError, text, data: result.structuredContent ?? null }
}
