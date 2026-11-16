"use node";

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withNativeProvider, type NativeProvider } from "./nativeProvider";

export type ProviderCredentials = { files: Record<string, string> };
type Challenge = { loginUrl: string; userCode?: string };
type Watch = { active: () => Promise<boolean> };
type LoginHooks = Watch & { challenge: (value: Challenge) => Promise<void>; takeCode: () => Promise<string | null> };
const stripAnsi = (value: string) => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
const allowedHosts: Record<NativeProvider, string[]> = {
  claude: ["claude.ai", "claude.com", "console.anthropic.com", "platform.claude.com"],
  codex: ["auth.openai.com", "chatgpt.com", "openai.com"],
};

export function loginChallenge(provider: NativeProvider, output: string): Challenge | null {
  const text = stripAnsi(output);
  const urls = text.match(/https:\/\/[^\s<>"'\x1b]+/g) ?? [];
  for (const candidate of [...urls].reverse()) {
    let url: URL;
    try { url = new URL(candidate); } catch { continue; }
    const hasUserInfo = Boolean(url.username) || Boolean(url.password);
    if (hasUserInfo || url.port || !allowedHosts[provider].includes(url.hostname)) continue;
    if (provider === "claude") {
      // The native remote-login URL, not the local-browser callback URL. Never
      // rewrite a provider redirect URI or borrow another app's OAuth client.
      if (url.searchParams.get("code") !== "true" ||
        (url.hostname === "claude.com" && url.pathname !== "/cai/oauth/authorize")) continue;
      return { loginUrl: url.href };
    }
    if (!/device|activate/i.test(url.pathname)) continue;
    const code = text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,5}\b/)?.[0];
    return code ? { loginUrl: url.href, userCode: code } : null;
  }
  return null;
}

export async function layout(directory: string, provider: NativeProvider, credentials?: ProviderCredentials) {
  const config = join(directory, "account");
  const work = join(directory, "work");
  await mkdir(config, { mode: 0o700 });
  await mkdir(work, { mode: 0o700 });
  const authFile = provider === "claude" ? ".credentials.json" : "auth.json";
  for (const [name, contents] of Object.entries(credentials?.files ?? {})) {
    if (name !== authFile || contents.length > 500_000) throw new Error("invalid_provider_credentials");
    JSON.parse(contents);
    await writeFile(join(config, name), contents, { mode: 0o600 });
  }
  // Deliberately do not inherit server secrets or this machine's AI logins.
  const env: NodeJS.ProcessEnv = {
    PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8", TERM: "dumb", NO_COLOR: "1", NODE_ENV: "production",
    HOME: directory, TMPDIR: directory,
    ...(provider === "claude" ? { CLAUDE_CONFIG_DIR: config } : { CODEX_HOME: config }),
  };
  return { config, work, env, authFile };
}

export async function snapshot(config: string, authFile: string): Promise<ProviderCredentials> {
  const text = await readFile(join(config, authFile), "utf8");
  if (!text.trim()) throw new Error("invalid_provider_credentials");
  JSON.parse(text);
  const credentials = { files: { [authFile]: text } };
  // Bound the actual serialized UTF-8 payload before envelope/base64 expansion.
  if (Buffer.byteLength(JSON.stringify(credentials), "utf8") > 256 * 1024) throw new Error("invalid_provider_credentials");
  return credentials;
}

function child(binary: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return spawn(binary, args, { cwd, env, shell: false, stdio: ["pipe", "pipe", "pipe"] });
}

async function collect(
  process: ChildProcessWithoutNullStreams, timeout: number, watch: Watch,
  onOutput?: (text: string, process: ChildProcessWithoutNullStreams) => Promise<void>,
) {
  let text = "";
  let stopped = false;
  let error: Error | undefined;
  let handling = Promise.resolve();
  const stop = (reason: string) => {
    if (stopped) return;
    stopped = true;
    error = new Error(reason);
    process.kill("SIGTERM");
    const force = setTimeout(() => process.kill("SIGKILL"), 1500);
    force.unref();
  };
  const append = (chunk: Buffer) => {
    text += chunk.toString("utf8");
    if (text.length > 500_000) return stop("provider_output_limit");
    if (onOutput) handling = handling.then(() => onOutput(text, process)).catch(() => stop("provider_login_failed"));
  };
  process.stdout.on("data", append);
  process.stderr.on("data", append);
  const timer = setTimeout(() => stop("provider_timeout"), timeout);
  let polling = false;
  const poll = setInterval(() => {
    if (polling || stopped) return;
    polling = true;
    watch.active().then((active) => { if (!active) stop("provider_cancelled"); })
      .catch(() => stop("provider_cancelled")).finally(() => { polling = false; });
  }, 1500);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      process.once("error", reject);
      process.once("close", resolve);
    });
    await handling;
    if (error) throw error;
    return { code, text: stripAnsi(text) };
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
  }
}

export async function nativeLogin(provider: NativeProvider, hooks: LoginHooks): Promise<ProviderCredentials> {
  return withNativeProvider(provider, async (binary, directory) => {
    if (!(await hooks.active())) throw new Error("provider_cancelled");
    const account = await layout(directory, provider);
    let challengeSent = false;
    const process = child(binary, provider === "claude" ? ["auth", "login"] : ["login", "--device-auth"], account.work, account.env);
    const codeTimer = setInterval(() => {
      if (provider !== "claude" || !challengeSent) return;
      hooks.takeCode().then((code) => { if (code) process.stdin.write(`${code}\n`); })
        .catch(() => process.kill("SIGTERM"));
    }, 1000);
    try {
      const result = await collect(process, 420_000, hooks, async (output) => {
        if (challengeSent) return;
        const challenge = loginChallenge(provider, output);
        if (challenge) { await hooks.challenge(challenge); challengeSent = true; }
      });
      if (result.code !== 0) {
        // Diagnostic categories only; provider output can contain credentials.
        const reason = /certificate|tls|ssl/i.test(result.text) ? "tls" :
          /403|forbidden/i.test(result.text) ? "forbidden" :
          /connect|network|dns|resolve/i.test(result.text) ? "network" :
          /permission|denied/i.test(result.text) ? "permission" : "unknown";
        throw new Error(`provider_login_exit_${result.code}_${reason}`);
      }
      const status = child(binary, provider === "claude" ? ["auth", "status"] : ["login", "status"], account.work, account.env);
      const check = await collect(status, 20_000, hooks);
      if (check.code !== 0 || (provider === "claude" && !/claude\.ai/.test(check.text)) ||
        (provider === "codex" && !/ChatGPT/i.test(check.text))) throw new Error("provider_login_failed");
      return snapshot(account.config, account.authFile);
    } finally { clearInterval(codeTimer); }
  });
}
