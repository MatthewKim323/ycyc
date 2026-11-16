// Native CLI + local fake API/MCP smoke. No accounts or real inference.
// Bundle and run in Linux Docker; see docs/AI_STREAMING_API.md.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withNativeProvider } from '../../convex/lib/nativeProvider.ts';
import { collectNativeTurn, claudeTurnArguments, codexTurnArguments, codexTurnConfiguration, codexModelCatalog } from '../../convex/lib/providerTurn.ts';

globalThis.parentReservation = Buffer.alloc(80 * 1024 * 1024, 17);
const provider = process.env.SMOKE_TARGET;
if (!['claude', 'codex'].includes(provider)) throw new Error('Set SMOKE_TARGET=claude or codex');
let apiCalls = 0, mcpCalls = 0; let apiCompletedAt=0, firstTextAt=0;
const toolsSeen = [];
const server = createServer(async (request, response) => {
  let raw = ''; for await (const chunk of request) raw += chunk;
  let body = {}; try { body = JSON.parse(raw); } catch {}
  if (request.url === '/mcp') {
    response.setHeader('content-type', 'application/json');
    if (body.id === undefined) { response.statusCode = 202; response.end(); return; }
    if (body.method === 'tools/call') mcpCalls++;
    response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result:
      body.method === 'initialize' ? { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } :
      body.method === 'tools/list' ? { tools: [{ name: 'echo', description: 'Fixture echo', inputSchema: { type: 'object', properties: {} } }] } :
      body.method === 'tools/call' ? { content: [{ type: 'text', text: 'private result not sent to UI' }] } :
      body.method === 'resources/list' ? { resources: [] } : body.method === 'resources/templates/list' ? { resourceTemplates: [] } : {} }));
    return;
  }
  apiCalls++;
  const names = (body.tools ?? []).map((tool) => tool.type === 'namespace' ? `${tool.name}.${tool.tools.map((child) => child.name).join(',')}` : tool.name ?? tool.type);
  toolsSeen.push(names);
  const permitted = provider === 'claude'
    ? names.every((name) => name === 'DeferredToolPlaceholder' || name.startsWith('mcp__yuzu__'))
    : names.every((name) => ['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource'].includes(name) || name.startsWith('mcp__yuzu.'));
  if (!permitted) throw new Error(`unsafe native tool graph ${JSON.stringify(names)}`);
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const emit = (event, value) => response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
  if (provider === 'claude') {
    const block = apiCalls === 1 ? { type: 'tool_use', id: 'toolu_fixture', name: 'mcp__yuzu__echo', input: {} } : { type: 'text', text: '' };
    emit('message_start', { type: 'message_start', message: { id: `fixture-${apiCalls}`, type: 'message', role: 'assistant', content: [], model: 'fixture', stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
    emit('content_block_start', { type: 'content_block_start', index: 0, content_block: block });
    if (apiCalls > 1) {
      for (const text of ['verified ', 'fixture ', 'reply']) {
        emit('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    emit('content_block_stop', { type: 'content_block_stop', index: 0 });
    emit('message_delta', { type: 'message_delta', delta: { stop_reason: apiCalls === 1 ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } });
    if (apiCalls > 1) apiCompletedAt = Date.now();
    emit('message_stop', { type: 'message_stop' });
    response.end();
  } else {
    const item = apiCalls === 1
      ? { id: 'fc_fixture', type: 'function_call', call_id: 'call_fixture', namespace: 'mcp__yuzu', name: 'echo', arguments: '{}' }
      : { id: 'message_fixture', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'verified fixture reply', annotations: [] }] };
    if (apiCalls > 1) {
      emit('response.output_item.added', {type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}});
      emit('response.content_part.added', {type:'response.content_part.added',item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});
      for (const delta of ['verified ', 'fixture ', 'reply']) {
        emit('response.output_text.delta',{type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta});
        await new Promise(resolve=>setTimeout(resolve,200));
      }
      emit('response.output_text.done',{type:'response.output_text.done',item_id:item.id,output_index:0,content_index:0,text:'verified fixture reply'});
      apiCompletedAt=Date.now();
    }
    emit('response.output_item.done', { type: 'response.output_item.done', output_index: 0, item });
    emit('response.completed', { type: 'response.completed', response: { id: `response_fixture_${apiCalls}`, object: 'response', created_at: 0, status: 'completed', model: 'gpt-6.1-sol', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  await withNativeProvider(provider, async (binary, directory) => {
    const account = join(directory, 'account'), work = join(directory, 'work');
    await mkdir(account); await mkdir(work);
    const env = { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', TERM: 'dumb', NO_COLOR: '1', NODE_ENV: 'production', HOME: directory, TMPDIR: directory,
      DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', RUST_LOG: 'error' };
    if (provider === 'claude') Object.assign(env, { CLAUDE_CONFIG_DIR: account, ANTHROPIC_API_KEY: 'fake-fixture-key', ANTHROPIC_BASE_URL: base });
    else {
      env.CODEX_HOME = account;
      const catalogPath = join(directory, 'models.json');
      await writeFile(catalogPath, JSON.stringify(codexModelCatalog()));
      const config = codexTurnConfiguration(base + '/mcp', catalogPath).replace('model = "gpt-6.1-sol"', 'model = "gpt-6.1-sol"\nmodel_provider = "fixture"') +
        `\n[model_providers.fixture]\nname = "local fixture"\nbase_url = "${base}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`;
      await writeFile(join(account, 'config.toml'), config);
    }
    console.log(JSON.stringify({ event: 'before_spawn', provider, parentRss: process.memoryUsage().rss }));
    const child = spawn(binary, provider === 'claude' ? claudeTurnArguments(base + '/mcp') : codexTurnArguments(), { cwd: work, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const events = [];
    if(provider==='claude')child.stdin.end('Use the fixture echo tool, then answer.');
    await collectNativeTurn(child, provider, { active: async () => true, event: async (event) => { events.push(event); if(event.type==='text_delta'&&!firstTextAt)firstTextAt=Date.now(); } }, { timeout: 60_000, poll: 1_000 }, provider==='codex'?{prompt:'Use the fixture echo tool, then answer.',cwd:work}:undefined);
    if (mcpCalls !== 1 || !events.some((event) => event.type === 'tool_start') || !events.some((event) => event.type === 'tool_end') || events.filter((event) => event.type === 'text_delta').map((event) => event.text).join('') !== 'verified fixture reply') throw new Error('normalized fixture mismatch');
    if (!(firstTextAt < apiCompletedAt)) throw new Error('not truly streamed');
    console.log(JSON.stringify({ firstTextAt,apiCompletedAt,partialLeadMs:apiCompletedAt-firstTextAt,event: 'verified', provider, apiCalls, mcpCalls, toolsSeen, events, memoryPeak: (await readFile('/sys/fs/cgroup/memory.peak', 'utf8')).trim(), memoryEvents: (await readFile('/sys/fs/cgroup/memory.events', 'utf8')).trim() }));
  });
} finally { await new Promise((resolve) => server.close(resolve)); }
