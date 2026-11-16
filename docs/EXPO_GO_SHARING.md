# Share Yuzu through Expo Go

EAS-hosted updates are restricted to the project owner or members of its owning organization. An anonymous HTTP manifest/bundle download does **not** prove another account can open the update inside Expo Go. The earlier EAS preview QR is unsuitable for public testers.

Expo officially supports self-hosted **plain JavaScript** updates. Yuzu publishes that format using Convex file storage and the public HTTP endpoint `/expo-preview/<snapshot>`. No EAS project membership, Apple membership, or local development server is required by that hosting route. A physical-phone launch must still be checked before calling a particular preview working.

Always share the original stable URL: https://optimistic-newt-247.convex.site/expo-preview/1741c4c8-abfc-43b0-bb4f-2cd07791e337

That URL and the previously shared `8450e2ab-f0a2-43be-9c55-25c6916897da` URL serve the latest publication without redirecting or changing the phone link. Reopen the same link in Expo Go after an update. Manifests use `Cache-Control: no-store`; an already-running app still needs to reload. Other snapshot URLs remain pinned.

## Publish a public mobile preview

Use current Expo Go for SDK 58. Export both native platforms without Hermes bytecode:

```sh
npx expo export --platform ios --platform android --no-bytecode --output-dir dist
CONVEX_ACCOUNT=ycyc node scripts/publish-expo-go.mjs dist .expo/public-preview.json
```

The uploader defaults to Matthew's shared `optimistic-newt-247` Convex deployment. Override `CONVEX_PREVIEW_DEPLOYMENT` only when deliberately targeting another deployment. The deployment-admin CLI must already be authenticated. The `publicPreview` backend must be deployed first.

The script uploads only exported bundle/assets; it never publishes `.env` files, source maps, credentials or Expo sessions. It verifies UTF-8 JavaScript, refuses HBC bytecode, publishes immutable manifest records, downloads all assets anonymously, and verifies SHA-256 hashes. Its JSON receipt and matching QR always use the stable URL. The receipt also includes a snapshot URL for diagnostics. New publications advance both already-shared links; retrying an existing older publication does not roll them back. The publisher checks that the stable link serves the newly published manifests before reporting success.

Client configuration is compiled by `expo export`, so ensure `EXPO_PUBLIC_CONVEX_URL` points to the intended backend before export. The current preview uses anonymous device identity with the shared backend. It does not configure Google account linking; Claude/Codex subscription connections use separate backend device/code flows. Installed-app detection is unavailable in Expo Go. Backend secrets never belong in `EXPO_PUBLIC_` variables.

## Hosting and verification

Upload URL creation and manifest publishing are internal deployment-admin operations. The public GET handler serves only validated preview records; the two shared aliases resolve the most recently inserted publication. Asset URLs must match the same deployment's Convex file storage exactly. The manifest uses `runtimeVersion: exposdk:58.0.0`, an independent scope, and SDK58 client metadata; it does not impersonate a signed EAS update or a development server.

Expo Go supports unsigned plain-JavaScript self-hosted manifests and applies its own unsigned sandbox. The server never fabricates a signature, certificate or verification flag. It ignores and does not log, persist or forward any Expo-Session header sent by the native client. No account permissions or client verification settings are changed.

Check both platform manifests, plain-JavaScript launch assets and every asset hash, then open the QR on a real phone with an unrelated Expo account. HTTP success alone is insufficient. A browser can open the HTTPS preview landing page and choose its platform; it still needs Expo Go to launch the native application.

The existing public development-tunnel browser URL runs the web version only while its local server remains online. Native WebView capture requires a mobile runtime. Expo Go development-server links on physical iOS require the same Expo account in CLI and phone, so they are not public-sharing links.

References: [Expo Go ownership and self-hosting policy](https://expo.dev/changelog/expo-go-loading-changes-may-2026), [Updates protocol](https://docs.expo.dev/technical-specs/expo-updates-1/), [official custom-server example](https://github.com/expo/custom-expo-updates-server), [development-server sign-in restriction](https://docs.expo.dev/troubleshooting/expo-go-sign-in-required/).

## Verified public preview

The latest preview includes the onboarding capture lifetime fix from `206cc86`:

https://optimistic-newt-247.convex.site/expo-preview/8450e2ab-f0a2-43be-9c55-25c6916897da

Both platform manifests and all 66 asset hashes passed anonymous checks. A fresh physical-phone onboarding retry is pending; the earlier launch confirmation below applies only to the previous snapshot. The capture fix was mobile UI only. Enabling the stable-link aliases requires deploying the updated `publicPreview` backend.

The user confirmed a physical-phone Expo Go launch from this self-hosted snapshot after the EAS preview had failed with403:

https://optimistic-newt-247.convex.site/expo-preview/1741c4c8-abfc-43b0-bb4f-2cd07791e337

Both platform manifests and all66 public files passed anonymous download and SHA256 checks. Google account linking remains unavailable in this preview.
