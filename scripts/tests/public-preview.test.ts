import assert from "node:assert/strict";
import test from "node:test";
import * as preview from "../../convex/publicPreview";
import http from "../../convex/http";

const functions = preview as unknown as Record<string, any>;
const snapshot = "12345678-1234-1234-1234-123456789abc";
const url = "https://deployment.convex.site/expo-preview/" + snapshot;
const assetUrl = "https://deployment.convex.cloud/api/storage/941d18c4-6e67-47ad-8576-b7a22b2907a9";
function manifest(extra: Record<string, unknown> = {}) {
  return { id: snapshot, createdAt: "2026-11-15T12:00:00.000Z", runtimeVersion: "exposdk:58.0.0",
    launchAsset: { key: "bundle", contentType: "application/javascript", hash: "a".repeat(43), url: assetUrl },
    assets: [{ key: "image", contentType: "image/png", fileExtension: ".png", url: assetUrl }], metadata: {},
    extra: { scopeKey: "yuzu-public-preview", expoClient: { sdkVersion: "58.0.0", name: "yuzu" } }, ...extra };
}
function fixture() {
  const rows: Record<string, any>[] = [], storageReads: string[] = [];
  let uploads = 0;
  const ctx = {
    storage: { generateUploadUrl: async () => `https://deployment.convex.cloud/upload/${++uploads}`, getUrl: async (id: string) => { storageReads.push(id); return id === "asset-1" ? assetUrl : null; } },
    db: {
      insert: async (table: string, fields: Record<string, unknown>) => { rows.push({ table, ...fields }); return "preview-1"; },
      query: (table: string) => {
        let expected: unknown;
        return { order: () => ({ first: async () => rows.filter((row) => row.table === table).at(-1) ?? null }), withIndex: (_index: string, filter: (q: unknown) => unknown) => {
          const q = { eq: (_key: string, value: unknown) => { expected = value; return q; } }; filter(q);
          return { unique: async () => rows.find((row) => row.table === table && row.snapshot === expected) ?? null };
        } };
      },
    },
  };
  const publish = (ios = manifest(), android = manifest(), id = snapshot, assetIds = ["asset-1"]) => functions.publish._handler(ctx, { snapshot: id, iosManifestJson: JSON.stringify(ios), androidManifestJson: JSON.stringify(android), assetIds });
  return { ctx, rows, storageReads, publish };
}

test("publishing, upload creation, asset URL lookup and manifest getter are internal only", async () => {
  for (const name of ["createUploadUrls", "assetUrls", "publish", "get"]) {
    assert.equal(functions[name].isInternal, true, name);
    assert.notEqual(functions[name].isPublic, true, name);
  }
  assert.ok(http.lookup("/expo-preview/" + snapshot, "GET"));
  const f = fixture();
  assert.equal((await functions.createUploadUrls._handler(f.ctx, { count: 2 })).length, 2);
  for (const count of [0, 101, 1.5, NaN]) await assert.rejects(functions.createUploadUrls._handler(f.ctx, { count }), /invalid_public_preview/);
  assert.deepEqual(await functions.assetUrls._handler(f.ctx, { ids: ["asset-1"] }), [{ id: "asset-1", url: assetUrl }]);
  await assert.rejects(functions.assetUrls._handler(f.ctx, { ids: [] }), /invalid_public_preview/);
  await assert.rejects(functions.assetUrls._handler(f.ctx, { ids: Array(101).fill("asset-1") }), /invalid_public_preview/);
});

test("publish verifies deployment-owned storage URLs, deduplicates exact snapshots and refuses mutation", async () => {
  const f = fixture();
  assert.equal(await f.publish(), snapshot); assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0]!.assetIds, undefined, "upload registration IDs are not public manifest state");
  assert.equal(await f.publish(), snapshot); assert.equal(f.rows.length, 1);
  assert.deepEqual([...new Set(f.storageReads)], ["asset-1"]);
  await assert.rejects(f.publish(manifest({ metadata: { changed: "true" } })), /public_preview_immutable/);
  assert.equal(f.rows.length, 1);
  const get = (platform: string, id = snapshot) => functions.get._handler(f.ctx, { snapshot: id, platform });
  assert.equal(await get("ios"), JSON.stringify(manifest()));
  assert.equal(await get("android"), JSON.stringify(manifest()));
  assert.equal(await get("ios", "../private"), null);
  assert.equal(await get("ios", "b".repeat(40)), null);
  for (const ids of [[], Array(201).fill("asset-1"), ["missing-opaque-id"]]) await assert.rejects(f.publish(manifest(), manifest(), snapshot, ids), /invalid_public_preview/);
});

test("already-shared phone links advance while other snapshot links stay pinned", async () => {
  const f = fixture();
  const shared = ["1741c4c8-abfc-43b0-bb4f-2cd07791e337", "8450e2ab-f0a2-43be-9c55-25c6916897da"];
  for (const id of shared) assert.equal(await functions.get._handler(f.ctx, { snapshot: id, platform: "ios" }), null);
  await f.publish();
  const next = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const ios = manifest({ id: next }), android = manifest({ id: next, metadata: { platform: "android" } });
  await f.publish(ios, android, next);
  for (const id of shared) {
    for (const platform of ["ios", "android"]) {
      const response = await preview.previewResponse(new Request(`https://deployment.convex.site/expo-preview/${id}`, {
        headers: { "expo-platform": platform, accept: "application/expo+json" },
      }), (snapshot, platform) => functions.get._handler(f.ctx, { snapshot, platform }));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), platform === "ios" ? ios : android);
    }
    const browser = await preview.previewResponse(new Request(`https://deployment.convex.site/expo-preview/${id}`),
      (snapshot, platform) => functions.get._handler(f.ctx, { snapshot, platform }));
    assert.ok((await browser.text()).includes(`exps://deployment.convex.site/expo-preview/${id}?platform=ios`));
  }
  assert.equal(JSON.parse(await functions.get._handler(f.ctx, { snapshot, platform: "ios" })).id, snapshot);
  // Retrying an older publication must not roll the shared link back.
  await f.publish();
  assert.equal(JSON.parse(await functions.get._handler(f.ctx, { snapshot: shared[0], platform: "ios" })).id, next);
});

test("manifest validation rejects foreign assets, bytecode, missing Expo Go fields and unsupported runtime", async () => {
  const invalid: unknown[] = [
    manifest({ id: "not-a-uuid" }), manifest({ createdAt: "not-a-date" }), manifest({ runtimeVersion: "exposdk:57.0.0" }),
    manifest({ metadata: { invalid: 1 } }), manifest({ extra: { expoClient: { sdkVersion: "58.0.0" } } }),
    manifest({ extra: { scopeKey: "yuzu", expoClient: { sdkVersion: "57.0.0" } } }),
    manifest({ extra: { scopeKey: "yuzu", expoClient: { sdkVersion: "58.0.0" }, expoGo: { developer: { tool: "expo-cli" } } } }),
    manifest({ launchAsset: { key: "bundle", contentType: "application/x-hermes", url: assetUrl } }),
    manifest({ assets: [{ key: "private", contentType: "image/png", url: "https://other.convex.cloud/api/storage/asset-1" }] }),
    manifest({ assets: [{ key: "private", contentType: "image/png", url: assetUrl + "?token=private" }] }),
    manifest({ assets: [{ key: "private", contentType: "image/png", url: "http://127.0.0.1/api/storage/asset-1" }] }),
    manifest({ assets: [{ key: "private", contentType: "image/png", url: "https://deployment.convex.cloud/api/storage/unknown" }] }),
    manifest({ assets: [{ key: "private", contentType: "image/png", url: "https://deployment.convex.cloud/unregistered/asset-1" }] }),
    manifest({ extra: { scopeKey: "yuzu", expoClient: { sdkVersion: "58.0.0" }, tooBig: "a".repeat(256 * 1024) } }),
  ];
  for (const value of invalid) {
    const f = fixture();
    await assert.rejects(f.publish(value as ReturnType<typeof manifest>), /invalid_public_preview/);
    assert.equal(f.rows.length, 0);
  }
  await assert.rejects(preview.validatePreviewManifest("{broken", async () => true), /invalid_public_preview/);
  await assert.rejects(fixture().publish(manifest(), manifest(), "../../credentials"), /invalid_public_preview/);
});

test("HTTP serves platform-specific JSON with required protocol headers and never returns request session data", async () => {
  const calls: unknown[] = [];
  const lookup = async (id: string, platform: string) => { calls.push({ id, platform }); return JSON.stringify(manifest({ metadata: { platform } })); };
  const response = await preview.previewResponse(new Request(url, { headers: { "expo-platform": "ios", "expo-runtime-version": "exposdk:58.0.0", accept: "application/expo+json", "expo-session": "PRIVATE_EXPO_ACCOUNT_SESSION", "expo-expect-signature": 'sig, keyid="root"' } }), lookup);
  assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "application/expo+json");
  assert.equal(response.headers.get("expo-protocol-version"), "1"); assert.equal(response.headers.get("expo-sfv-version"), "0");
  assert.equal(response.headers.get("expo-signature"), null);
  const text = await response.text(); assert.equal(JSON.parse(text).metadata.platform, "ios");
  assert.ok(!text.includes("PRIVATE_EXPO_ACCOUNT_SESSION")); assert.ok(!JSON.stringify([...response.headers]).includes("PRIVATE_EXPO_ACCOUNT_SESSION"));
  assert.deepEqual(calls, [{ id: snapshot, platform: "ios" }]);
  const android = await preview.previewResponse(new Request(url + "?platform=android&sdkVersion=58.0.0", { headers: { accept: "application/json" } }), lookup);
  assert.equal(JSON.parse(await android.text()).metadata.platform, "android");
});

test("HTTP negotiates multipart/q values, bounds supported versions and returns safe browser links", async () => {
  let lookups = 0;
  const lookup = async () => { lookups++; return JSON.stringify(manifest()); };
  const mixed = await preview.previewResponse(new Request(url, { headers: { "expo-platform": "ios", accept: "application/expo+json;q=0.8,multipart/mixed;q=1" } }), lookup);
  assert.match(mixed.headers.get("content-type")!, /^multipart\/mixed; boundary=/);
  const multipart = await mixed.text(); assert.match(multipart, /Content-Disposition: form-data; name="manifest"\r\n/);
  assert.match(multipart, /Content-Type: application\/json\r\n/); assert.ok(multipart.includes(JSON.stringify(manifest())));
  const json = await preview.previewResponse(new Request(url, { headers: { "expo-platform": "ios", accept: "application/json;q=1,multipart/mixed;q=0" } }), lookup);
  assert.equal(json.headers.get("content-type"), "application/json");
  for (const headers of [{ "expo-platform": "windows" }, { "expo-platform": "ios", "expo-runtime-version": "exposdk:57.0.0" }, { "expo-platform": "ios", "expo-sdk-version": "57.0.0" }] as Record<string, string>[]) {
    assert.equal((await preview.previewResponse(new Request(url, { headers }), lookup)).status, 400);
  }
  for (const headers of [{ "expo-platform": "ios", accept: "text/html" }, { "expo-platform": "ios", "expo-protocol-version": "99" }] as Record<string, string>[]) {
    assert.equal((await preview.previewResponse(new Request(url, { headers }), lookup)).status, 406);
  }
  const before = lookups;
  assert.equal((await preview.previewResponse(new Request(url + "/private"), lookup)).status, 404); assert.equal(lookups, before);
  const browser = await preview.previewResponse(new Request(url), lookup);
  assert.match(browser.headers.get("content-type")!, /^text\/html/);
  const html = await browser.text(); assert.ok(html.includes(`exps://deployment.convex.site/expo-preview/${snapshot}?platform=ios`));
  assert.ok(html.includes("platform=android")); assert.ok(!html.includes("PRIVATE_"));
  assert.equal((await preview.previewResponse(new Request(url), async () => null)).status, 404);
  assert.equal((await preview.previewResponse(new Request(url + "?platform=ios"), async () => null)).status, 404);
});
