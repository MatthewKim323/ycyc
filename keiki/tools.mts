import { Effect, Schema } from 'effect'
import { defineTool, type ToolContext } from '@onkeiki/agents'
import { callTool, listTools } from './mcp.mts'

const mcpUrl = (ctx: ToolContext) =>
  Effect.flatMap(ctx.secrets.get('YCYC_MCP_URL'), (url) =>
    url ? Effect.succeed(url) : Effect.die(new Error('YCYC_MCP_URL secret is not set'))
  )

export const listApps = defineTool({
  name: 'list_apps',
  description:
    "List the apps ycyc can reach (MyFitnessPal, Strong), which ones this user has connected, and the tools each connected app adds. Call this first to answer questions about the user's apps or to find tool names for call_tool.",
  input: Schema.Struct({}),
  execute: (_input, ctx) =>
    Effect.gen(function* () {
      const url = yield* mcpUrl(ctx)
      return yield* Effect.promise(() => callTool(url, 'list_apps', {}))
    }),
})

export const connectApp = defineTool({
  name: 'connect_app',
  description:
    'Get a link that connects one of the user\'s apps to ycyc (myfitnesspal or strong). Send the link to the user to open on their phone and sign in.',
  input: Schema.Struct({ app: Schema.String }),
  execute: (input, ctx) =>
    Effect.gen(function* () {
      const url = yield* mcpUrl(ctx)
      return yield* Effect.promise(() => callTool(url, 'connect_app', { app: input.app.trim().toLowerCase() }))
    }),
})

export const callYcycTool = defineTool({
  name: 'call_tool',
  description:
    'Call any tool a connected app exposes through ycyc, by the name list_apps reports (for example logging food or a workout, or reading today\'s diary). Tools that change data are refused unless confirmed is true: first tell the user exactly what will be written and only set confirmed after they say yes.',
  input: Schema.Struct({
    name: Schema.String,
    arguments: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
    confirmed: Schema.optional(Schema.Boolean),
  }),
  execute: (input, ctx) =>
    Effect.gen(function* () {
      const url = yield* mcpUrl(ctx)
      const tools = yield* Effect.promise(() => listTools(url))
      const tool = tools.find((t) => t.name === input.name)
      if (!tool) {
        return { ok: false, error: `unknown tool "${input.name}"`, available: tools.map((t) => t.name) }
      }
      if (!tool.annotations?.readOnlyHint && input.confirmed !== true) {
        return {
          ok: false,
          needs_confirmation: true,
          tool: tool.name,
          arguments: input.arguments ?? {},
          message: 'This changes the user\'s data. Ask the user to confirm, then call again with confirmed: true.',
        }
      }
      return yield* Effect.promise(() => callTool(url, tool.name, input.arguments ?? {}))
    }),
})

export const tools = [listApps, connectApp, callYcycTool]
