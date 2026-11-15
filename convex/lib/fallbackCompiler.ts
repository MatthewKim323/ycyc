// Local heuristic compiler, used only when src/lib/compiler/compile.ts is not bundled yet.
// TODO: drop once the web RE agent's compileCapture lands (convex/sync.recipes.mjs wires it in).
import type { CaptureEntry, CatalogApp, Recipe, RecipeTool, SessionBundle } from "../../src/lib/contract";

const STATIC = /\.(js|css|png|jpe?g|gif|svg|webp|woff2?|ttf|ico|map|mp4|html?)(\?|$)/i;
const NOISE = /(analytics|collect|segment|sentry|datadog|doubleclick|google|facebook|optimizely|hotjar|braze|amplitude|newrelic|pixel|beacon|telemetry|metrics|log)/i;

function templatePath(path: string): string {
  return path
    .split("/")
    .map((seg) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(seg)) return "{date}";
      if (/^\d+$/.test(seg)) return "{id}";
      if (/^[0-9a-f-]{16,}$/i.test(seg)) return "{id}";
      return seg;
    })
    .join("/");
}

function snake(s: string): string {
  return s
    .replace(/[{}]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function isJson(e: CaptureEntry): boolean {
  const mime = (e.mime ?? e.resHeaders?.["content-type"] ?? "").toLowerCase();
  if (mime.includes("json")) return true;
  const b = (e.resBody ?? "").trim();
  return b.startsWith("{") || b.startsWith("[");
}

export function fallbackCompile(app: CatalogApp, entries: CaptureEntry[], session: SessionBundle): Recipe {
  const apiCalls = entries.filter(
    (e) =>
      (e.initiator === "fetch" || e.initiator === "xhr" || e.initiator === "revyl") &&
      !STATIC.test(e.url) &&
      !NOISE.test(new URL(e.url, "https://x").hostname + new URL(e.url, "https://x").pathname) &&
      (e.status === undefined || (e.status >= 200 && e.status < 300)) &&
      isJson(e),
  );

  type Group = { method: string; origin: string; path: string; sample: CaptureEntry; count: number; query: Set<string> };
  const groups = new Map<string, Group>();
  for (const e of apiCalls) {
    let u: URL;
    try {
      u = new URL(e.url);
    } catch {
      continue;
    }
    const path = templatePath(u.pathname);
    const key = `${e.method.toUpperCase()} ${u.origin}${path}`;
    const g = groups.get(key) ?? { method: e.method.toUpperCase(), origin: u.origin, path, sample: e, count: 0, query: new Set<string>() };
    g.count++;
    g.sample = e;
    u.searchParams.forEach((_v, k) => g.query.add(k));
    groups.set(key, g);
  }

  const bearer = Object.entries(session.headers ?? {}).find(([k, val]) => k.toLowerCase() === "authorization" && /^bearer /i.test(val));
  const executor = bearer ? "cloud" : "device";
  const tools: RecipeTool[] = [];
  const used = new Set<string>();

  for (const g of [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 12)) {
    const isRead = g.method === "GET";
    const segs = g.path.split("/").filter((s) => s && !s.startsWith("{") && !/^v\d+$/.test(s));
    const noun = snake(segs.slice(-2).join("_")) || "data";
    let name = `${isRead ? "get" : g.method === "DELETE" ? "delete" : "save"}_${noun}`.slice(0, 48);
    while (used.has(name)) name += "_2";
    used.add(name);

    const properties: Record<string, unknown> = {};
    let urlTemplate = g.origin + g.path.replace(/\{(\w+)\}/g, (_m, p) => {
      properties[p] = { type: "string", description: p === "date" ? "YYYY-MM-DD" : p };
      return `{{${p}}}`;
    });
    const qs = [...g.query].map((k) => {
      properties[k] = { type: "string" };
      return `${k}={{${k}}}`;
    });
    if (qs.length) urlTemplate += "?" + qs.join("&");

    let bodyTemplate: string | undefined;
    if (!isRead && g.sample.reqBody) {
      try {
        const parsed = JSON.parse(g.sample.reqBody) as Record<string, unknown>;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const tpl: Record<string, unknown> = {};
          for (const [k, val] of Object.entries(parsed)) {
            if (val !== null && typeof val === "object") {
              tpl[k] = val;
              continue;
            }
            properties[k] = { type: typeof val === "number" ? "number" : typeof val === "boolean" ? "boolean" : "string" };
            tpl[k] = `{{${k}}}`;
          }
          bodyTemplate = JSON.stringify(tpl);
        }
      } catch {
        bodyTemplate = g.sample.reqBody;
      }
    }

    const headers: Record<string, string> = {};
    for (const [k, val] of Object.entries(g.sample.reqHeaders ?? {})) {
      if (/^<redacted:/.test(val)) {
        const lk = k.toLowerCase();
        if (lk === "cookie") continue;
        headers[k] = `{{session.headers.${lk}}}`;
      } else if (/^(mfp-|x-)/i.test(k)) {
        headers[k] = val;
      }
    }

    tools.push({
      name,
      title: name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
      description: `${isRead ? "Read" : "Write"} ${segs.join(" ") || "data"} from ${app.name} (${g.method} ${g.path}).`,
      kind: isRead ? "read" : "write",
      inputSchema: { type: "object", properties },
      request: { method: g.method as "GET", urlTemplate, headers, bodyTemplate },
      sample: { args: {}, ok: true, at: g.sample.ts },
    });
  }

  const firstRead = tools.find((t) => t.kind === "read" && !(t.request?.urlTemplate ?? "").includes("{{"));
  const sessionKeys = [
    ...Object.keys(session.headers ?? {}).map((k) => `headers.${k.toLowerCase()}`),
    ...(Object.keys(session.cookies ?? {}).length ? ["cookies"] : []),
  ];

  return {
    appSlug: app.slug,
    version: 1,
    status: "draft",
    executor,
    baseUrl: app.webOrigin,
    auth: {
      type: bearer ? "bearer" : "cookie",
      sessionKeys,
      check: firstRead?.request,
    },
    tools,
    playbook: [...new Set(entries.map((e) => e.pageUrl).filter((x): x is string => !!x))].slice(0, 10),
    provenance: {
      compiler: "heuristic",
      compiledAt: Date.now(),
      captureCount: entries.length,
      notes: "convex fallback compiler",
    },
  };
}
