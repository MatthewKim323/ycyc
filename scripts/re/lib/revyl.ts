// Minimal Revyl REST client (cloud Android/iOS devices driven by plain-English steps).
// Mapped from the open-source CLI (github.com/RevylAI/revyl-cli: internal/api/client.go,
// internal/mcp/device_session.go). Pure fetch, no Node imports: used by convex/revyl.ts and
// by scripts/re/revyl-smoke.ts.
//
// Flow: GET build -> POST start_device -> poll worker-connection -> poll proxy health ->
//       POST device-proxy/<run>/launch -> POST device-proxy/<run>/execute_step (instruction |
//       extract), poll step_status/<id> when accepted -> POST device/sessions/<id>/stop.

export const REVYL_API = "https://backend.revyl.ai";
export const REVYL_APP = "https://app.revyl.ai";

export interface RevylSession {
  sessionId: string;
  workflowRunId: string;
  viewerUrl: string;
  packageName?: string;
}

export interface StepResult {
  ok: boolean;
  text: string; // extract: extracted information; instruction: agent's description of what it did
  raw?: unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function uuid(): string {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export class RevylClient {
  constructor(
    private apiKey: string,
    private base = REVYL_API,
  ) {
    if (!apiKey) throw new Error("REVYL_API_KEY is not set");
  }

  private async req(method: string, path: string, body?: unknown): Promise<{ status: number; json: any; text: string }> {
    const res = await fetch(this.base + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "X-Revyl-Client": "cli",
        "User-Agent": "revyl-cli/0.2.12", // backend answers 426 to unknown client versions
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* text */
    }
    return { status: res.status, json, text };
  }

  private proxy(run: string, action: string, body?: unknown) {
    const get = /^(screenshot|health|device_info|step_status|install_status|hierarchy|logs|requests)/.test(action);
    return this.req(get ? "GET" : "POST", `/api/v1/execution/device-proxy/${run}/${action}`, get ? undefined : body ?? {});
  }

  async getBuild(buildId: string): Promise<{ appId: string; downloadUrl: string; packageName?: string }> {
    const r = await this.req("GET", `/api/v1/apps/builds/${encodeURIComponent(buildId)}?include_download_url=true`);
    if (r.status !== 200 || !r.json?.download_url) throw new Error(`revyl build lookup failed: HTTP ${r.status}`);
    return { appId: r.json.app_id, downloadUrl: r.json.download_url, packageName: r.json.package_name };
  }

  // Starts an Android device with the build installed and waits until the device is connected.
  async start(opts: { buildId: string; platform?: "android" | "ios"; idleTimeoutSeconds?: number; readyTimeoutMs?: number }): Promise<RevylSession> {
    const b = await this.getBuild(opts.buildId);
    const sessionId = uuid();
    const r = await this.req("POST", "/api/v1/execution/start_device", {
      platform: opts.platform ?? "android",
      app_id: b.appId,
      build_id: opts.buildId,
      app_url: b.downloadUrl,
      app_package: b.packageName,
      is_simulation: true, // "simulation" = ad hoc session without a saved test (CLI does the same)
      idle_timeout_seconds: opts.idleTimeoutSeconds ?? 300,
    });
    if (r.status >= 300 || r.json?.error) throw new Error(`revyl start_device failed: HTTP ${r.status} ${String(r.json?.error ?? r.json?.message ?? r.json?.detail ? JSON.stringify(r.json?.error ?? r.json?.message ?? r.json?.detail) : r.text).slice(0, 300)}`);
    const run = r.json?.workflow_run_id;
    const sid = r.json?.session_id ?? sessionId;
    if (!run) throw new Error("revyl start_device: no workflow_run_id");
    const session: RevylSession = { sessionId: sid, workflowRunId: run, viewerUrl: `${REVYL_APP}/sessions/${sid}`, packageName: b.packageName };

    const deadline = Date.now() + (opts.readyTimeoutMs ?? 150_000);
    try {
      // 1. worker assigned
      for (;;) {
        const w = await this.req("GET", `/api/v1/execution/streaming/worker-connection/${run}`);
        if (w.json?.worker_ws_url) break;
        const st = String(w.json?.status ?? "").toLowerCase();
        if (st === "failed" || st === "cancelled" || st === "error") throw new Error(`revyl worker ${st}`);
        if (Date.now() > deadline) throw new Error("revyl worker not ready in time");
        await sleep(2000);
      }
      // 2. device connected
      for (;;) {
        const h = await this.proxy(run, "health");
        if (h.status === 200 && (h.json?.device_connected || h.json?.status === "ready" || h.json?.status === "healthy")) break;
        if (Date.now() > deadline) throw new Error("revyl device not connected in time");
        await sleep(2000);
      }
    } catch (e) {
      await this.stop(session).catch(() => {});
      throw e;
    }
    return session;
  }

  async launch(s: RevylSession, bundleId?: string): Promise<void> {
    const r = await this.proxy(s.workflowRunId, "launch", bundleId ? { bundle_id: bundleId } : {});
    if (r.status >= 300) throw new Error(`revyl launch failed: HTTP ${r.status}`);
  }

  async step(s: RevylSession, stepType: "instruction" | "extract" | "validation", description: string, timeoutMs = 180_000): Promise<StepResult> {
    const r = await this.proxy(s.workflowRunId, "execute_step", {
      step_type: stepType,
      step_description: description,
      session_id: s.sessionId,
      workflow_run_id: s.workflowRunId,
    });
    if (r.status >= 300) return { ok: false, text: `revyl step failed: HTTP ${r.status}`, raw: r.json ?? r.text };
    let result = r.json;
    if (result?.status === "accepted" && result?.step_id) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        await sleep(1000);
        const p = await this.proxy(s.workflowRunId, `step_status/${result.step_id}`);
        const st = p.json?.status;
        if (st === "completed" || st === "failed") {
          result = typeof p.json.result === "string" ? JSON.parse(p.json.result) : p.json.result;
          break;
        }
        if (Date.now() > deadline) return { ok: false, text: "revyl step timed out" };
      }
    }
    const out = result?.step_output ?? {};
    const text =
      stepType === "extract"
        ? String(out?.extracted_data?.information ?? out?.extracted_data ?? "")
        : String(out?.agent_description ?? out?.action_history?.slice?.(-1)?.[0] ?? "");
    return { ok: !!result?.success, text, raw: result };
  }

  async stop(s: Pick<RevylSession, "sessionId" | "workflowRunId">): Promise<void> {
    const r = await this.req("POST", `/api/v1/execution/device/sessions/${encodeURIComponent(s.sessionId)}/stop`, {});
    if (r.status >= 300 && s.workflowRunId) {
      await this.req("POST", `/api/v1/execution/device/status/cancel/${s.workflowRunId}`, {});
    }
  }
}

// One phone tool call end to end: boot, launch, act, read, always stop.
export async function runPhoneTask(
  client: RevylClient,
  opts: { buildId: string; instruction?: string; extract?: string; keepAlive?: boolean },
): Promise<{ ok: boolean; text: string; viewerUrl: string; sessionId: string; steps: StepResult[] }> {
  const s = await client.start({ buildId: opts.buildId });
  const steps: StepResult[] = [];
  try {
    await client.launch(s).catch(() => {});
    if (opts.instruction) steps.push(await client.step(s, "instruction", opts.instruction));
    if (opts.extract && steps.every((x) => x.ok)) steps.push(await client.step(s, "extract", opts.extract));
    const last = steps[steps.length - 1];
    return { ok: steps.length > 0 && steps.every((x) => x.ok), text: last?.text ?? "", viewerUrl: s.viewerUrl, sessionId: s.sessionId, steps };
  } finally {
    if (!opts.keepAlive) await client.stop(s).catch(() => {});
  }
}
