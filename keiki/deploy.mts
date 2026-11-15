import { agent, externalRef } from './agent.mts'
import { buildTools } from './build.mts'

const apiKey = process.env.KEIKI_API_KEY
if (!apiKey) throw new Error('KEIKI_API_KEY is not set')
const base = process.env.KEIKI_BASE_URL ?? 'https://onkeiki.com'

const res = await fetch(`${base}/api/v1/developer/deployments`, {
  method: 'POST',
  headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
  body: JSON.stringify({ external_ref: externalRef, agent, channels: [], tools: await buildTools() }),
})
const body = await res.json()
if (!res.ok) throw new Error(`deploy failed (${res.status}): ${JSON.stringify(body)}`)
console.log(JSON.stringify(body, null, 2))
