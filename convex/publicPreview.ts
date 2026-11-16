import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const SDK = "58.0.0";
const RUNTIME = `exposdk:${SDK}`;
const MAX_MANIFEST = 256 * 1024;
const SNAPSHOT = /^(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// Keep both already-shared URLs following new publications. Other snapshot
// URLs remain pinned; the underlying manifest records are always immutable.
const SHARED_LINKS = new Set([
  "1741c4c8-abfc-43b0-bb4f-2cd07791e337",
  "8450e2ab-f0a2-43be-9c55-25c6916897da",
]);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const bytes = (value: string) => new TextEncoder().encode(value).length;
function invalid(): never { throw new Error("invalid_public_preview"); }

// Publishing is a deployment-admin operation, never a public/client mutation.
// Only public Expo client configuration belongs in these immutable manifests.
export async function validatePreviewManifest(raw: string, verifyAsset: (url: string) => Promise<boolean>): Promise<void> {
  if (bytes(raw) > MAX_MANIFEST) invalid();
  let manifest: unknown;
  try { manifest = JSON.parse(raw); } catch { invalid(); }
  if (!object(manifest) || typeof manifest.id !== "string" || !UUID.test(manifest.id)
    || typeof manifest.createdAt !== "string" || !/^\d{4}-\d\d-\d\dT/.test(manifest.createdAt) || !Number.isFinite(Date.parse(manifest.createdAt))
    || manifest.runtimeVersion !== RUNTIME || !object(manifest.metadata) || !Object.values(manifest.metadata).every((value) => typeof value === "string")
    || !object(manifest.extra) || typeof manifest.extra.scopeKey !== "string" || !manifest.extra.scopeKey || manifest.extra.scopeKey.length > 512
    || !object(manifest.extra.expoClient) || manifest.extra.expoClient.sdkVersion !== SDK
    || !Array.isArray(manifest.assets) || manifest.assets.length > 1000) invalid();
  // Developer tooling marks a development-server manifest in Expo Go and must
  // not be used to disguise an unsigned self-hosted production JS preview.
  if (object(manifest.extra.expoGo) && object(manifest.extra.expoGo.developer) && Object.hasOwn(manifest.extra.expoGo.developer, "tool")) invalid();
  const assets = [manifest.launchAsset, ...manifest.assets];
  const urls = new Set<string>();
  for (const [index, asset] of assets.entries()) {
    if (!object(asset) || typeof asset.key !== "string" || !asset.key || asset.key.length > 256
      || typeof asset.contentType !== "string" || !/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(asset.contentType)
      || typeof asset.url !== "string" || asset.url.length > 2048
      || (asset.hash !== undefined && (typeof asset.hash !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(asset.hash)))
      || (asset.fileExtension !== undefined && (typeof asset.fileExtension !== "string" || !/^\.[A-Za-z0-9]{1,12}$/.test(asset.fileExtension)))) invalid();
    if (index === 0 && !["application/javascript", "text/javascript"].includes(asset.contentType)) invalid();
    let url: URL;
    try { url = new URL(asset.url); } catch { invalid(); }
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) invalid();
    urls.add(asset.url);
  }
  for (const url of urls) if (!await verifyAsset(url)) invalid();
}

export const createUploadUrls = internalMutation({
  args: { count: v.number() },
  handler: async (ctx, { count }): Promise<string[]> => {
    if (!Number.isInteger(count) || count < 1 || count > 100) invalid();
    return Promise.all(Array.from({ length: count }, () => ctx.storage.generateUploadUrl()));
  },
});

export const assetUrls = internalQuery({
  args: { ids: v.array(v.id("_storage")) },
  handler: async (ctx, { ids }) => {
    if (ids.length < 1 || ids.length > 100) invalid();
    return Promise.all(ids.map(async (id) => ({ id, url: await ctx.storage.getUrl(id) })));
  },
});

export const publish = internalMutation({
  args: { snapshot: v.string(), iosManifestJson: v.string(), androidManifestJson: v.string(), assetIds: v.array(v.id("_storage")) },
  handler: async (ctx, args): Promise<string> => {
    if (!SNAPSHOT.test(args.snapshot) || args.assetIds.length < 1 || args.assetIds.length > 200) invalid();
    // Download URL UUIDs are not opaque storage IDs. Resolve admin-supplied
    // IDs through this deployment, then compare exact returned URLs only.
    const assetUrls = await Promise.all([...new Set(args.assetIds)].map((id) => ctx.storage.getUrl(id)));
    if (assetUrls.some((url) => url === null)) invalid();
    const allowedUrls = new Set(assetUrls);
    const verifyAsset = async (raw: string) => allowedUrls.has(raw);
    await validatePreviewManifest(args.iosManifestJson, verifyAsset);
    await validatePreviewManifest(args.androidManifestJson, verifyAsset);
    const existing = await ctx.db.query("publicMobilePreviews").withIndex("by_snapshot", (q) => q.eq("snapshot", args.snapshot)).unique();
    if (existing) {
      if (existing.iosManifestJson !== args.iosManifestJson || existing.androidManifestJson !== args.androidManifestJson) throw new Error("public_preview_immutable");
      return args.snapshot;
    }
    const { assetIds: _assetIds, ...record } = args;
    await ctx.db.insert("publicMobilePreviews", { ...record, createdAt: Date.now() });
    return args.snapshot;
  },
});

export const get = internalQuery({
  args: { snapshot: v.string(), platform: v.union(v.literal("ios"), v.literal("android")) },
  handler: async (ctx, { snapshot, platform }): Promise<string | null> => {
    if (!SNAPSHOT.test(snapshot)) return null;
    const preview = SHARED_LINKS.has(snapshot)
      ? await ctx.db.query("publicMobilePreviews").order("desc").first()
      : await ctx.db.query("publicMobilePreviews").withIndex("by_snapshot", (q) => q.eq("snapshot", snapshot)).unique();
    return preview ? platform === "ios" ? preview.iosManifestJson : preview.androidManifestJson : null;
  },
});

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
function quality(accept: string, type: string): number {
  let best = -1, specificity = -1;
  for (const part of accept.toLowerCase().split(",")) {
    const [mime, ...parameters] = part.trim().split(";");
    const score = mime === type ? 2 : mime === `${type.split("/")[0]}/*` ? 1 : mime === "*/*" ? 0 : -1;
    if (score < 0) continue;
    const parameter = parameters.find((value) => value.trim().startsWith("q="));
    const q = parameter ? Number(parameter.trim().slice(2)) : 1;
    if (score > specificity) { specificity = score; best = Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0; }
  }
  return best;
}

export async function previewResponse(req: Request, lookup: (snapshot: string, platform: "ios" | "android") => Promise<string | null>): Promise<Response> {
  const url = new URL(req.url), snapshot = url.pathname.slice("/expo-preview/".length);
  const headers = { "Cache-Control": "no-store", Vary: "Accept, Expo-Platform, Expo-Runtime-Version, Expo-SDK-Version", "X-Content-Type-Options": "nosniff" };
  const error = (status: number, message: string) => new Response(message, { status, headers });
  if (!SNAPSHOT.test(snapshot)) return error(404, "preview not found");
  const platform = req.headers.get("expo-platform") ?? url.searchParams.get("platform");
  const runtime = req.headers.get("expo-runtime-version");
  if (runtime && runtime !== RUNTIME) return error(400, "unsupported runtime");
  const sdks = req.headers.get("expo-sdk-version") ?? url.searchParams.get("sdkVersion");
  if (sdks && !sdks.split(",").map((value) => value.trim()).includes(SDK)) return error(400, "unsupported sdk");
  if (!platform) {
    // Check existence before exposing a landing page. No request session/auth
    // headers are logged, persisted or forwarded (including Expo-Session).
    if (!await lookup(snapshot, "ios")) return error(404, "preview not found");
    url.search = ""; url.hash = "";
    const target = url.href.replace(/^https?:/, "exps:");
    return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>yuzu preview</title><h1>yuzu preview</h1><p>open this preview in Expo Go for SDK 58.</p><p><a href="${escapeHtml(target)}?platform=ios">open on ios</a></p><p><a href="${escapeHtml(target)}?platform=android">open on android</a></p>`, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'" } });
  }
  if (platform !== "ios" && platform !== "android") return error(400, "unsupported platform");
  const protocol = req.headers.get("expo-protocol-version");
  if (protocol && protocol !== "1" && protocol !== "0") return error(406, "unsupported protocol");
  const accept = req.headers.get("accept") || "*/*";
  const multipart = quality(accept, "multipart/mixed"), json = Math.max(quality(accept, "application/expo+json"), quality(accept, "application/json"));
  if (multipart <= 0 && json <= 0) return error(406, "unsupported response format");
  const manifest = await lookup(snapshot, platform);
  if (!manifest) return error(404, "preview not found");
  // Expo Go supports unsigned self-hosted plain JS. Do not forge a signature or
  // relax a client's verification policy; the native client owns enforcement.
  const common = { ...headers, "expo-protocol-version": "1", "expo-sfv-version": "0", "expo-manifest-filters": "", "expo-server-defined-headers": "" };
  if (multipart > 0 && multipart >= json) {
    const boundary = `yuzu_preview_${snapshot}`;
    return new Response(`--${boundary}\r\nContent-Disposition: form-data; name="manifest"\r\nContent-Type: application/json\r\n\r\n${manifest}\r\n--${boundary}--\r\n`, { headers: { ...common, "Content-Type": `multipart/mixed; boundary="${boundary}"` } });
  }
  return new Response(manifest, { headers: { ...common, "Content-Type": quality(accept, "application/expo+json") >= quality(accept, "application/json") ? "application/expo+json" : "application/json" } });
}
