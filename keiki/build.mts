import { mkdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { JSONSchema, type Schema } from 'effect'
import { tools } from './tools.mts'

const toolsFile = fileURLToPath(new URL('./tools.mts', import.meta.url))

// Same artifact @onkeiki/agents' kit.sync() uploads for a code tool: an ESM bundle exporting
// __run(input, host), where host carries { phone, user, channel, secrets, userState, ... }.
const entrySource = (toolName: string) => `import { Effect, Schema } from 'effect'
import * as mod from ${JSON.stringify(toolsFile)}

const tool = Object.values(mod).find((t) => t && typeof t.execute === 'function' && t.name === ${JSON.stringify(toolName)})
const fromPromise = (run) => Effect.tryPromise({ try: run, catch: (e) => e })

export async function __run(input, host) {
  const ctx = {
    phone: host.phone,
    user: host.user,
    channel: host.channel,
    attachments: host.attachments ?? {},
    secrets: { get: (n) => fromPromise(() => host.secrets.get(n)), getAll: () => fromPromise(() => host.secrets.getAll()) },
  }
  return await Effect.runPromise(tool.execute(Schema.decodeUnknownSync(tool.input)(input), ctx))
}
`

async function bundle(toolName: string) {
  const entry = fileURLToPath(new URL(`./.smskit-actor-${toolName}.mjs`, import.meta.url))
  await writeFile(entry, entrySource(toolName))
  try {
    const built = await Bun.build({ entrypoints: [entry], target: 'node', format: 'esm', minify: true })
    if (!built.success || !built.outputs[0]) throw new Error(`bundling ${toolName} failed: ${built.logs.join('\n')}`)
    return await built.outputs[0].text()
  } finally {
    await rm(entry, { force: true })
  }
}

function inputSchema(input: Schema.Schema<any, any, never>): Record<string, unknown> {
  const { $schema, $id, ...schema } = JSONSchema.make(input) as unknown as Record<string, unknown>
  return schema.type === 'object' ? schema : { type: 'object', properties: {} }
}

export async function buildTools() {
  return Promise.all(
    tools.map(async (tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: inputSchema(tool.input as Schema.Schema<any, any, never>),
      executionType: 'code' as const,
      code: await bundle(tool.name),
      timeout: 30000,
    }))
  )
}

if (import.meta.main) {
  const built = await buildTools()
  await mkdir(new URL('./dist/', import.meta.url), { recursive: true })
  await writeFile(new URL('./dist/tools.json', import.meta.url), JSON.stringify(built, null, 2))
  console.log(`built ${built.length} tools → keiki/dist/tools.json`)
}
