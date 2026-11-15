import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { catalogApp } from "./catalog";
import { deeplinkBase } from "./lib/env";
import { CORS_HEADERS, handleMcpPost } from "./lib/mcp";
import { verifyStandardWebhook } from "./lib/webhook";

const http = httpRouter();

// ---- MCP: POST /mcp/<token> ----

http.route({
  pathPrefix: "/mcp/",
  method: "POST",
  handler: httpAction(async (ctx, req) => handleMcpPost(ctx, req)),
});

const methodNotAllowed = httpAction(async (_ctx, req) => {
  return new Response(null, {
    status: 405,
    headers: {
      Allow: "POST, OPTIONS",
      ...CORS_HEADERS,
      ...(req.headers.get("mcp-session-id") ? { "Mcp-Session-Id": req.headers.get("mcp-session-id")! } : {}),
    },
  });
});

http.route({ pathPrefix: "/mcp/", method: "GET", handler: methodNotAllowed });
http.route({ pathPrefix: "/mcp/", method: "DELETE", handler: methodNotAllowed });
http.route({
  pathPrefix: "/mcp/",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: CORS_HEADERS })),
});

// ---- Tap-to-connect: GET /connect/<slug> ----

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

http.route({
  pathPrefix: "/connect/",
  method: "GET",
  handler: httpAction(async (_ctx, req) => {
    const slug = decodeURIComponent(new URL(req.url).pathname.slice("/connect/".length).split("/")[0] ?? "");
    const app = catalogApp(slug);
    const target = `${deeplinkBase()}connect/${encodeURIComponent(app?.slug ?? slug)}`;
    const line = app ? `Open ycyc to connect ${app.name}` : "Open ycyc";
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ycyc</title><style>html,body{margin:0;height:100%;background:#000;color:#fff;font:500 17px/1.4 Inter,-apple-system,system-ui,sans-serif}body{display:flex;align-items:center;justify-content:center;padding:0 16px}a{color:#fff}</style></head><body><a href="${escapeHtml(target)}">${escapeHtml(line)}</a></body></html>`;
    return new Response(html, {
      status: 302,
      headers: { Location: target, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }),
});

// ---- Whop sandbox webhook: POST /whop ----

http.route({
  path: "/whop",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const raw = await req.text();
    const secret = process.env.WHOP_WEBHOOK_SECRET;
    if (secret) {
      const ok = await verifyStandardWebhook(secret, req.headers, raw);
      if (!ok) return new Response("invalid signature", { status: 401 });
    }
    let event: { type?: string; action?: string; data?: Record<string, unknown> };
    try {
      event = JSON.parse(raw);
    } catch {
      return new Response("bad json", { status: 400 });
    }
    const type = event.type ?? event.action ?? "";
    if (type !== "payment.succeeded") {
      return Response.json({ ok: true, ignored: type });
    }
    const data = (event.data ?? {}) as Record<string, any>;
    const meta: Record<string, any> = {
      ...(data.checkout_configuration?.metadata ?? {}),
      ...(data.membership?.metadata ?? {}),
      ...(data.metadata ?? {}),
    };
    const user = await ctx.runQuery(internal.users.findForWebhook, {
      userId: str(meta.ycyc_user_id ?? meta.userId ?? meta.user_id),
      deviceId: str(meta.deviceId ?? meta.device_id),
      token: str(meta.mcpToken ?? meta.mcp_token),
    });
    if (!user) {
      console.warn("whop payment.succeeded without a matching ycyc user", data.id);
      return Response.json({ ok: true, matched: false });
    }
    await ctx.runMutation(internal.users.setPlan, { userId: user._id, plan: "pro" });
    return Response.json({ ok: true, matched: true });
  }),
});

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => new Response("ok")),
});

export default http;
