// Heuristic connector compiler: turns one user's recorded web traffic into a reusable Recipe.
// Pure TS, no deps, no I/O, importable by Convex. The recipe holds templates only; every secret stays
// in the SessionBundle and is referenced as {{session.headers.x}} / {{session.cookies.x}}.

import type { CaptureEntry, CatalogApp, Executor, Recipe, RecipeTool, RequestTemplate, SessionBundle } from "../contract";
import { captureConfigFor, hostOf, isApiCall, isNoise, originOf, pathOf } from "../capture/apps";

type Method = RequestTemplate["method"];
const METHODS: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

interface Param {
  name: string;
  in: "path" | "query" | "body";
  type: "string" | "integer" | "number" | "boolean";
  required: boolean;
  default?: unknown;
  enum?: unknown[];
  description?: string;
}

interface Cluster {
  key: string;
  method: Method;
  origin: string;
  pathTemplate: string;
  pathParams: string[];
  entries: CaptureEntry[];
}

// ---------- path templating ----------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUM = /^\d{2,}$/;
const HEX = /^[0-9a-f]{16,}$/i;
const TOKENISH = /^(?=.*\d)(?=.*[a-zA-Z])[A-Za-z0-9_-]{20,}$/;
const STOP_SEGMENTS = new Set(["api", "services", "service", "v1", "v2", "v3", "v4", "public", "rest", "json", "web", "app", "graphql", "uacf-nutrition"]);

function singular(word: string): string {
  if (/ies$/.test(word)) return word.slice(0, -3) + "y";
  if (/(ses|xes|zes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word) && !/ss$/.test(word)) return word.slice(0, -1);
  return word;
}

function snake(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function paramKind(seg: string): "uuid" | "date" | "id" | "hash" | null {
  if (UUID.test(seg)) return "uuid";
  if (DATE.test(seg)) return "date";
  if (NUM.test(seg)) return "id";
  if (HEX.test(seg) || TOKENISH.test(seg)) return "hash";
  return null;
}

export function templatePath(path: string): { template: string; params: string[] } {
  const segs = path.split("/");
  const params: string[] = [];
  const out = segs.map((seg, i) => {
    if (!seg) return seg;
    const kind = paramKind(decodeURIComponent(seg));
    if (!kind) return seg;
    const prev = segs
      .slice(0, i)
      .reverse()
      .find((s) => s && !paramKind(s) && !STOP_SEGMENTS.has(s.toLowerCase()));
    let name = kind === "date" ? "date" : prev ? snake(singular(prev)) + "_id" : "id";
    if (kind === "uuid" && prev && /diary|entr/i.test(prev)) name = "entry_id";
    while (params.includes(name)) name = name + "_" + (params.length + 1);
    params.push(name);
    return "{{" + name + "}}";
  });
  return { template: out.join("/"), params };
}

// ---------- helpers ----------

function parseJson(s?: string): unknown {
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function queryPairs(url: string): [string, string][] {
  const q = url.indexOf("?");
  if (q < 0) return [];
  return url
    .slice(q + 1)
    .split("#")[0]
    .split("&")
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf("=");
      const k = i >= 0 ? p.slice(0, i) : p;
      const v = i >= 0 ? p.slice(i + 1) : "";
      const dec = (x: string) => {
        try {
          return decodeURIComponent(x.replace(/\+/g, " "));
        } catch {
          return x;
        }
      };
      return [dec(k), dec(v)] as [string, string];
    });
}

function inferType(values: string[]): Param["type"] {
  if (values.length && values.every((v) => /^-?\d+$/.test(v))) return "integer";
  if (values.length && values.every((v) => /^-?\d*\.?\d+$/.test(v))) return "number";
  if (values.length && values.every((v) => v === "true" || v === "false")) return "boolean";
  return "string";
}

const SEARCH_KEYS = /^(q|query|search|term|keyword|keywords|text|name)$/i;
const DATE_KEYS = /(^|_)(date|day|entry_date|from|to|start|end)$/i;
const PAGING_KEYS = /^(page|per_page|limit|max_items|offset|count|size|page_size)$/i;
const REDACTED = /^<redacted(:[^>]*)?>$/;

function argName(key: string): string {
  const base = snake(key.replace(/\[\]$/, ""));
  if (SEARCH_KEYS.test(base)) return "query";
  return base || "value";
}

function humanize(name: string): string {
  const s = name.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- naming ----------

const RESOURCE_NAMES: [RegExp, string, string][] = [
  // [path test, read name, write name]
  [/nutrient[-_]?goals?|\/goals?\b/i, "get_goals", "update_goals"],
  [/search|nutrition\b|\/foods?\?|\/nutrition\?/i, "search_food", "create_food"],
  [/diary\/read_diary|\/diary(\b|\?|$)/i, "get_diary", "log_food"],
  [/read_day|daily|summary|report/i, "get_daily_summary", "update_day"],
  [/water/i, "get_water", "log_water"],
  [/measurement|weight/i, "get_measurements", "log_measurement"],
  [/exercise/i, "get_exercises", "log_exercise"],
  [/users?\b|profile|account/i, "get_profile", "update_profile"],
  [/auth_token|token|session/i, "get_session", "refresh_session"],
];

function toolName(method: Method, pathTemplate: string, hasQueryText: boolean): string {
  const p = pathTemplate.toLowerCase();
  const read = method === "GET";
  if (method === "DELETE") {
    if (/diary|entr/.test(p)) return "delete_food_entry";
  }
  for (const [re, r, w] of RESOURCE_NAMES) {
    if (re.test(p) || (hasQueryText && r === "search_food" && /food|nutrition/.test(p))) {
      if (read) return r;
      if (method === "DELETE") return r.replace(/^get_/, "delete_");
      return w;
    }
  }
  const segs = pathTemplate.split("/").filter((s) => s && !s.startsWith("{{") && !STOP_SEGMENTS.has(s.toLowerCase()));
  const noun = snake(segs.slice(-2).join("_")) || "root";
  const verb = read ? (pathTemplate.endsWith("}}") ? "get" : "list") : method === "DELETE" ? "delete" : method === "POST" ? "create" : "update";
  return verb + "_" + noun;
}

// ---------- body templating ----------

const GENERIC_LEAVES = /^(id|version|value|unit|name|amount|quantity|multiplier|nutrition_multiplier|index)$/;

function templateBody(body: unknown, params: Param[], seen: Set<string>, prefix = ""): unknown {
  if (Array.isArray(body)) return body.length ? [templateBody(body[0], params, seen, prefix)] : [];
  if (body === null || typeof body !== "object") return body;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (v !== null && typeof v === "object") {
      out[k] = templateBody(v, params, seen, k);
      continue;
    }
    if (typeof v === "string" && REDACTED.test(v)) {
      out[k] = v;
      continue;
    }
    if (k === "type" && typeof v === "string") {
      out[k] = v; // discriminators stay literal
      continue;
    }
    const generic = GENERIC_LEAVES.test(k) && prefix && prefix !== "items";
    let name = argName(generic ? singular(prefix).replace(/_size$/, "") + "_" + k : k);
    if (seen.has(name) && prefix) name = argName(singular(prefix) + "_" + k);
    if (seen.has(name)) {
      out[k] = v;
      continue;
    }
    seen.add(name);
    const type: Param["type"] = typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v === "boolean" ? "boolean" : "string";
    const p: Param = { name, in: "body", type, required: !DATE_KEYS.test(name) };
    if (DATE_KEYS.test(name) && typeof v === "string" && DATE.test(v)) p.default = "{{today}}";
    if (typeof v === "number" && /serving|quantity|amount|count/.test(name)) p.default = v;
    params.push(p);
    out[k] = typeof v === "string" ? "{{" + name + "}}" : "__RAW__" + name + "__";
  }
  return out;
}

function bodyToTemplate(obj: unknown): string {
  return JSON.stringify(obj).replace(/"__RAW__([a-zA-Z0-9_]+)__"/g, "{{$1}}");
}

// ---------- main ----------

const CONSTANT_HEADERS = /(client[-_]?id|api[-_]?version|app[-_]?version|x-requested-with)$/i;

function sessionValueOf(session: SessionBundle, header: string): string | undefined {
  for (const [k, v] of Object.entries(session.headers || {})) if (k.toLowerCase() === header) return v;
  return undefined;
}

// auth.check is a bare template with no schema: bake defaults in, so {{date}} becomes {{today}}.
function bakeDefaults(tpl: RequestTemplate, schema: Record<string, unknown>): RequestTemplate {
  const props = ((schema as { properties?: Record<string, { default?: unknown }> }).properties) || {};
  const fill = (s: string) =>
    s.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, n: string) => {
      const d = props[n]?.default;
      if (d === undefined) return m;
      return typeof d === "string" && d.startsWith("{{") ? d : encodeURIComponent(String(d));
    });
  return { ...tpl, urlTemplate: fill(tpl.urlTemplate) };
}

export interface CompileOptions {
  now?: number;
  maxTools?: number;
}

export function compileCapture(app: CatalogApp, entries: CaptureEntry[], session: SessionBundle, opts: CompileOptions = {}): Recipe {
  const cfg = captureConfigFor(app.slug, app.loginUrl, app.webOrigin);
  const now = opts.now ?? Date.now();
  const maxTools = opts.maxTools ?? 12;
  const sessionHeaders = Object.keys(session.headers || {}).map((h) => h.toLowerCase());
  const hasBearer = Object.entries(session.headers || {}).some(([k, v]) => k.toLowerCase() === "authorization" && /^bearer\s+\S+/i.test(v));

  // 1. keep successful JSON API calls on allowed hosts
  const api = entries.filter((e) => {
    if (e.initiator === "navigation") return false;
    if (!METHODS.includes(e.method.toUpperCase() as Method)) return false;
    if (isNoise(cfg, e.url) || !isApiCall(cfg, e.url)) return false;
    if (e.status !== undefined && (e.status < 200 || e.status >= 400)) return false;
    const mime = e.mime || e.resHeaders?.["content-type"] || "";
    if (e.method.toUpperCase() === "GET" && mime && !/json/i.test(mime)) return false;
    return true;
  });

  // 2. auth.refresh: the call that minted a token (response had a redacted access token)
  let refresh: RequestTemplate | undefined;
  const refreshEntry = api.find((e) => /auth_token|oauth\/token|token\/refresh|refresh[-_]?token/i.test(pathOf(e.url)) && /access_token|accessToken/.test(e.resBody || ""));
  if (refreshEntry) {
    refresh = { method: refreshEntry.method.toUpperCase() as Method, urlTemplate: refreshEntry.url, headers: { accept: "application/json" } };
  }

  // 3. cluster by method + origin + path template
  const clusters = new Map<string, Cluster>();
  for (const e of api) {
    if (e === refreshEntry || /\/api\/auth\//.test(pathOf(e.url))) continue;
    const method = e.method.toUpperCase() as Method;
    const origin = originOf(e.url);
    const { template, params } = templatePath(pathOf(e.url));
    const key = method + " " + origin + template;
    const c = clusters.get(key) ?? { key, method, origin, pathTemplate: template, pathParams: params, entries: [] };
    c.entries.push(e);
    clusters.set(key, c);
  }

  // 4. one tool per cluster
  const tools: (RecipeTool & { __auth: "bearer" | "cookie" | "header"; __size: number; __host: string; __seen: number })[] = [];
  for (const c of clusters.values()) {
    const params: Param[] = c.pathParams.map((name) => ({ name, in: "path", type: "string", required: name !== "date", default: name === "date" ? "{{today}}" : undefined }));

    // query params
    const qValues = new Map<string, string[]>();
    const qOrder: string[] = [];
    for (const e of c.entries) {
      for (const [k, v] of queryPairs(e.url)) {
        if (!qValues.has(k)) {
          qValues.set(k, []);
          qOrder.push(k);
        }
        qValues.get(k)!.push(v);
      }
    }
    const queryParts: string[] = [];
    for (const k of qOrder) {
      const vals = qValues.get(k)!;
      const distinct = [...new Set(vals)];
      const encK = encodeURIComponent(k);
      const multi = vals.length > c.entries.length; // repeated key like fields[]=a&fields[]=b
      const isDate = distinct.every((v) => DATE.test(v));
      const isText = SEARCH_KEYS.test(k);
      const isPaging = PAGING_KEYS.test(k);
      if (REDACTED.test(distinct[0] || "")) continue;
      if (multi || (!isDate && !isText && !isPaging && (/\[\]$/.test(k) || distinct.length === 1))) {
        for (const v of multi ? distinct : [distinct[0]]) queryParts.push(encK + "=" + encodeURIComponent(v));
        continue;
      }
      const name = isDate ? (params.some((p) => p.name === "date") ? argName(k) : "date") : argName(k);
      if (!params.some((p) => p.name === name)) {
        const type = isDate || isText ? "string" : inferType(distinct);
        const p: Param = { name, in: "query", type, required: isText };
        if (isDate) {
          p.default = "{{today}}";
          p.description = "YYYY-MM-DD";
        } else if (isPaging) p.default = type === "integer" ? Number(distinct[0]) : distinct[0];
        params.push(p);
      }
      queryParts.push(encK + "={{" + name + "}}");
    }

    // body
    let bodyTemplate: string | undefined;
    const withBody = c.entries.find((e) => e.reqBody && parseJson(e.reqBody) !== undefined);
    if (withBody && c.method !== "GET") {
      const seen = new Set(params.map((p) => p.name));
      bodyTemplate = bodyToTemplate(templateBody(parseJson(withBody.reqBody), params, seen));
    }

    // headers: session-bound auth headers + stable non-auth headers
    const sample = c.entries[c.entries.length - 1];
    const headers: Record<string, string> = {};
    let authKind: "bearer" | "cookie" | "header" = "cookie";
    for (const [k0, v] of Object.entries(sample.reqHeaders || {})) {
      const k = k0.toLowerCase();
      if (REDACTED.test(v)) {
        const sv = sessionValueOf(session, k);
        if (sv && CONSTANT_HEADERS.test(k) && /^[A-Za-z][A-Za-z0-9._-]{1,40}$/.test(sv)) {
          headers[k] = sv; // app client id, not a user secret: same for every user
          continue;
        }
        if (sessionHeaders.includes(k)) {
          headers[k] = "{{session.headers." + k + "}}";
          if (k === "authorization" && hasBearer) authKind = "bearer";
          else if (authKind !== "bearer") authKind = "header";
        }
        continue;
      }
      if (k === "accept" || k === "content-type" || k.startsWith("x-") || k.startsWith(app.slug.slice(0, 3))) headers[k] = v;
    }
    if (bodyTemplate && !headers["content-type"]) headers["content-type"] = "application/json";
    if (!headers.accept) headers.accept = "application/json";

    const urlTemplate = c.origin + c.pathTemplate + (queryParts.length ? "?" + queryParts.join("&") : "");
    const hasText = params.some((p) => p.name === "query");
    const name = toolName(c.method, c.pathTemplate + (hasText ? "?q" : ""), hasText);

    // response shape + extract
    const res = parseJson(c.entries.find((e) => e.resBody)?.resBody);
    let extract = "";
    let shape = "";
    if (res && typeof res === "object" && !Array.isArray(res)) {
      const keys = Object.keys(res as Record<string, unknown>);
      const arrays = keys.filter((k) => Array.isArray((res as Record<string, unknown>)[k]));
      const main = ["items", "data", "results", "foods", "entries"].find((k) => arrays.includes(k));
      if (main) extract = c.method === "POST" ? main + ".0" : main;
      shape = "Returns {" + keys.slice(0, 8).join(", ") + (keys.length > 8 ? ", ..." : "") + "}.";
    } else if (Array.isArray(res)) {
      shape = "Returns a list.";
    }

    const properties: Record<string, unknown> = {};
    for (const p of params) {
      const prop: Record<string, unknown> = { type: p.type };
      if (p.default !== undefined) prop.default = p.default;
      if (p.description) prop.description = p.description;
      if (p.enum) prop.enum = p.enum;
      properties[p.name] = prop;
    }
    const required = params.filter((p) => p.required && p.default === undefined).map((p) => p.name);

    tools.push({
      name,
      title: humanize(name),
      description: `${c.method} ${hostOf(urlTemplate)}${c.pathTemplate} (seen ${c.entries.length}x). ${shape}`.trim(),
      kind: c.method === "GET" ? "read" : "write",
      inputSchema: { type: "object", properties, ...(required.length ? { required } : {}) },
      request: { method: c.method, urlTemplate, headers, ...(bodyTemplate ? { bodyTemplate } : {}) },
      extract,
      __auth: authKind,
      __size: (c.entries.find((e) => e.resBody)?.resBody || "").length,
      __host: hostOf(urlTemplate),
      __seen: c.entries.length,
    });
  }

  // 5. executor: cloud when a replayable bearer token exists and tools use it; cookie-only tools then
  //    collide with the bearer versions or cannot run in the cloud, so drop them.
  const bearerTools = tools.filter((t) => t.__auth === "bearer");
  const executor: Executor = hasBearer && bearerTools.length > 0 ? "cloud" : "device";
  let kept = executor === "cloud" ? bearerTools : tools;

  // dedupe names: keep the cluster seen most often, suffix the rest
  kept.sort((a, b) => b.__seen - a.__seen);
  const used = new Map<string, number>();
  for (const t of kept) {
    const n = used.get(t.name) ?? 0;
    used.set(t.name, n + 1);
    if (n > 0) {
      t.name = t.name + "_" + (n + 1);
      t.title = humanize(t.name);
    }
  }
  kept = kept.slice(0, maxTools);

  // 6. auth.check: cheapest authenticated GET
  const reads = kept.filter((t) => t.kind === "read" && t.request).sort((a, b) => a.__size - b.__size);
  const checkTool = reads.find((t) => !(t.inputSchema as { required?: string[] }).required?.length);
  const authType: Recipe["auth"]["type"] = executor === "cloud" ? "bearer" : kept.some((t) => t.__auth === "header") ? "header" : "cookie";
  const sessionKeys = new Set<string>();
  for (const t of kept) for (const v of Object.values(t.request?.headers || {})) for (const m of v.matchAll(/\{\{session\.([^}]+)\}\}/g)) sessionKeys.add(m[1]);

  // 7. playbook from the pages visited
  const playbook: string[] = [`Sign in at ${cfg.loginUrl}`];
  const seenPages = new Set<string>();
  for (const e of entries) {
    const page = e.initiator === "navigation" ? e.url : e.pageUrl;
    if (!page || originOf(page) !== originOf(cfg.webOrigin)) continue;
    const p = pathOf(page);
    if (cfg.loggedIn.loggedOutPaths.some((x) => p.startsWith(x)) || seenPages.has(p)) continue;
    seenPages.add(p);
    playbook.push("Visit " + p);
  }
  if (refresh) playbook.splice(1, 0, "Mint the API token: " + refresh.method + " " + pathOf(refresh.urlTemplate));

  const cleanTools: RecipeTool[] = kept.map(({ __auth, __size, __host, __seen, ...t }) => t);
  const baseHost = mostCommon(kept.map((t) => t.__host));

  return {
    appSlug: app.slug,
    version: 1,
    status: "draft",
    executor,
    baseUrl: baseHost ? "https://" + baseHost : undefined,
    auth: {
      type: authType,
      sessionKeys: [...sessionKeys],
      ...(refresh ? { refresh } : {}),
      ...(checkTool?.request ? { check: bakeDefaults(checkTool.request, checkTool.inputSchema) } : {}),
    },
    tools: cleanTools,
    playbook,
    provenance: {
      compiler: "heuristic",
      compiledAt: now,
      captureCount: entries.length,
      notes: `${api.length} API calls kept of ${entries.length}; ${clusters.size} endpoints; executor ${executor}${executor === "cloud" && tools.length > kept.length ? `; ${tools.length - kept.length} cookie-only endpoints left for the device path` : ""}`,
    },
  };
}

function mostCommon(xs: string[]): string | undefined {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  let best: string | undefined;
  let n = 0;
  for (const [k, v] of m) if (v > n) [best, n] = [k, v];
  return best;
}

// Optional refinement pass (better names, descriptions, schemas). Does nothing without a key, and the
// heuristic recipe is always returned on any failure. The caller decides whether to pay for it.
export async function refineWithLLM(recipe: Recipe, opts: { apiKey?: string; model?: string; fetchImpl?: typeof fetch } = {}): Promise<Recipe> {
  if (!opts.apiKey) return recipe;
  const f = opts.fetchImpl ?? fetch;
  try {
    const prompt =
      "You improve an auto-generated API tool recipe. Return JSON {tools:[{name,title,description}]} with the same tool count and order. " +
      "snake_case names, short titles, one-sentence descriptions written for an AI assistant.\n" +
      JSON.stringify(recipe.tools.map((t) => ({ name: t.name, method: t.request?.method, url: t.request?.urlTemplate, inputSchema: t.inputSchema })));
    const res = await f("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer " + opts.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ model: opts.model ?? "gpt-4o-mini", response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) return recipe;
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const parsed = JSON.parse(j.choices?.[0]?.message?.content || "{}") as { tools?: { name?: string; title?: string; description?: string }[] };
    if (!parsed.tools || parsed.tools.length !== recipe.tools.length) return recipe;
    return {
      ...recipe,
      tools: recipe.tools.map((t, i) => ({
        ...t,
        name: snake(parsed.tools![i].name || t.name) || t.name,
        title: parsed.tools![i].title || t.title,
        description: parsed.tools![i].description || t.description,
      })),
      provenance: { ...recipe.provenance, compiler: "llm" },
    };
  } catch {
    return recipe;
  }
}
