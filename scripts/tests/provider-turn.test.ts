import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { collectNativeTurn, claudeTurnArguments, codexModelCatalog, codexTurnArguments, codexTurnConfiguration, nativeTurn, validateTurnInput, VisibleRedactor } from "../../convex/lib/providerTurn";
import { SITE_URL } from "../../convex/lib/env";
import type { ProviderEvent } from "../../convex/lib/providerEvents";

const mcpUrl = `${SITE_URL}/mcp/${"a".repeat(48)}`;
const init = { type: "system", subtype: "init", tools: ["mcp__yuzu__list_apps"], mcp_servers: [{ name: "yuzu" }] };
const final = { type: "result", subtype: "success", is_error: false, result: "fixture answer" };
function fixture(lines: unknown[], tail = "") {
  const script = `process.stderr.write("private stderr token");process.stdout.write(${JSON.stringify(lines.map((line) => JSON.stringify(line)).join("\n") + "\n")});${tail}`;
  const process = spawn(globalThis.process.execPath, ["-e", script], { stdio: ["pipe", "pipe", "pipe"] });
  process.stdin.end();
  return process;
}

test("validates only the current Yuzu endpoint and bounded prompts", () => {
  validateTurnInput("hello", mcpUrl);
  for (const url of ["https://other.convex.site/mcp/" + "a".repeat(48), mcpUrl + "?other=1", mcpUrl + "#secret", "http://127.0.0.1/mcp/" + "a".repeat(48), `${SITE_URL}/other/path`]) {
    assert.throws(() => validateTurnInput("hello", url), /provider_invalid_mcp/);
  }
  assert.throws(() => validateTurnInput("x".repeat(60_001), mcpUrl), /provider_prompt_limit/);
  assert.throws(() => validateTurnInput(" ", mcpUrl), /provider_prompt_limit/);
});

test("Claude args hard-disable builtins, settings and skills; permit only the sole Yuzu MCP", () => {
  const args = claudeTurnArguments(mcpUrl);
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.equal(args[args.indexOf("--setting-sources") + 1], "");
  assert.equal(args[args.indexOf("--permission-mode") + 1], "dontAsk");
  assert.equal(args[args.indexOf("--allowedTools") + 1], "mcp__yuzu__*");
  assert.ok(args.includes("--disable-slash-commands"));
  assert.ok(args.includes("--strict-mcp-config"));
  assert.deepEqual(JSON.parse(args[args.indexOf("--mcp-config") + 1]!), { mcpServers: { yuzu: { type: "http", url: mcpUrl } } });
  assert.ok(!args.includes("--dangerously-skip-permissions"));
});

test("redacts actual secrets split across streaming deltas without buffering unrelated text", () => {
  const redact = new VisibleRedactor(["very-private-token", "another-secret"]);
  assert.equal(redact.push("ordinary visible text "), "ordinary visible text ");
  assert.equal(redact.push("very-pri"), "");
  assert.equal(redact.push("vate-token done"), "[private] done");
  assert.equal(redact.push(" another-"), " ");
  assert.equal(redact.push("", true), "[private]");
});

test("collects visible normalized events without streaming stderr or raw metadata", async () => {
  const events: ProviderEvent[] = [];
  await collectNativeTurn(fixture([init, final]), "claude", { active: async () => true, event: async (event) => { events.push(event); } });
  assert.deepEqual(events, [{ type: "text_delta", text: "fixture answer" }]);
});

test("kills an active native process when cancelled and never reports success", async () => {
  const child = fixture([init], "setInterval(()=>{},1000)");
  await assert.rejects(collectNativeTurn(child, "claude", { active: async () => false, event: async () => assert.fail("no visible events expected") }, { timeout: 2_000, poll: 10 }), /provider_cancelled/);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test("enforces deadline, failed exit and unsafe output without leaking provider diagnostics", async () => {
  await assert.rejects(collectNativeTurn(fixture([init], "setInterval(()=>{},1000)"), "claude", { active: async () => true, event: async () => undefined }, { timeout: 30, poll: 10 }), /provider_timeout/);
  await assert.rejects(collectNativeTurn(fixture([init, final], "process.exit(2)"), "claude", { active: async () => true, event: async () => undefined }), /provider_turn_failed/);
  await assert.rejects(collectNativeTurn(fixture([{ ...init, tools: ["Bash"] }], "setInterval(()=>{},1000)"), "claude", { active: async () => true, event: async () => undefined }), /provider_disallowed_tool/);
});

test("Codex locks the authoritative catalog and disables native code/filesystem/browser capabilities", () => {
  const catalog = codexModelCatalog();
  assert.equal(catalog.models.length, 1);
  assert.equal(catalog.models[0]!.slug, "gpt-6.1-sol");
  assert.equal(catalog.models[0]!.shell_type, "disabled");
  assert.equal(catalog.models[0]!.apply_patch_tool_type, null);
  assert.equal(catalog.models[0]!.tool_mode, "direct");
  assert.equal(catalog.models[0]!.multi_agent_version, "disabled");
  assert.equal(catalog.models[0]!.node_repl_disabled, true);
  assert.deepEqual(catalog.models[0]!.experimental_supported_tools, []);
  const config = codexTurnConfiguration(mcpUrl, "/tmp/private/models.json");
  assert.match(config, /^model = "gpt-6.1-sol"/);
  for (const name of ["shell_tool", "view_image", "code_mode", "code_mode_only", "code_mode_host", "js_repl", "browser_use", "apps", "plugins", "hooks", "multi_agent_v2", "request_permissions_tool", "tool_search"]) assert.ok(config.includes(`${name} = false`));
  assert.ok(config.includes('[tools.experimental_request_user_input]\nenabled = false'));
  assert.equal((config.match(/\[mcp_servers\./g) ?? []).length, 1);
  assert.ok(config.includes(`url = ${JSON.stringify(mcpUrl)}`));
  assert.ok(config.includes('default_tools_approval_mode = "approve"'));
  assert.ok(!config.includes("model_provider"));
  assert.ok(codexTurnArguments().includes("--strict-config"));
  assert.ok(!codexTurnArguments().includes("--dangerously-bypass-approvals-and-sandbox"));
});

test("both providers stop before installation when the owning turn is cancelled", async () => {
  for (const provider of ["claude", "codex"] as const) {
    await assert.rejects(nativeTurn(provider, { files: {} }, { prompt: "hello", mcpUrl, hooks: { active: async () => false, event: async () => undefined } }), /provider_cancelled/);
  }
});

function rpcFixture(serverRequest = false) {
  return spawn(process.execPath, ["-e", `
    const rl=require('node:readline').createInterface({input:process.stdin});
    const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
    rl.on('line',line=>{
      const v=JSON.parse(line);
      if(v.id===1){if(v.method!=='initialize')process.exit(2);send({id:1,result:{}});}
      if(v.id===2){if(v.method!=='thread/start'||v.params.ephemeral!==true||v.params.model!=='gpt-6.1-sol'||v.params.cwd!=='/private/work')process.exit(2);send({id:2,result:{thread:{id:'thread-1'}}});}
      if(v.id===3){
        if(v.method!=='turn/start'||v.params.input[0].text!=='bounded prompt')process.exit(2);
        send({id:3,result:{}});
        if(${serverRequest}){send({id:100,method:'item/commandExecution/requestApproval',params:{command:'private'}});return;}
        send({method:'item/agentMessage/delta',params:{itemId:'a1',delta:'first '}});
        setTimeout(()=>{send({method:'item/agentMessage/delta',params:{itemId:'a1',delta:'last'}});send({method:'item/completed',params:{item:{id:'a1',type:'agentMessage',text:'first last'}}});send({method:'turn/completed',params:{turn:{status:'completed',error:null}}});},100);
      }
    });
  `], { stdio: ["pipe", "pipe", "pipe"] });
}

test("Codex native protocol performs only bounded handshake and streams before child completion", async () => {
  const child = rpcFixture();
  const events: ProviderEvent[] = [];
  await collectNativeTurn(child, "codex", { active: async () => true, event: async (event) => {
    if (!events.length) assert.equal(child.exitCode, null);
    events.push(event);
  } }, { timeout: 2_000, poll: 10 }, { prompt: "bounded prompt", cwd: "/private/work" });
  assert.deepEqual(events, [{ type: "text_delta", text: "first " }, { type: "text_delta", text: "last" }]);
  assert.equal(child.exitCode, 0);
  assert.deepEqual(codexTurnArguments(), ["app-server", "--strict-config", "--listen", "stdio://"]);
});

test("Codex unexpected server-side approval/tool request fails closed", async () => {
  const child = rpcFixture(true);
  await assert.rejects(collectNativeTurn(child, "codex", { active: async () => true, event: async () => assert.fail("no visible events") }, { timeout: 2_000, poll: 10 }, { prompt: "bounded prompt", cwd: "/private/work" }), /provider_disallowed_tool/);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});
