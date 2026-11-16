# Share Yuzu through Expo Go

The hosted `public-demo` branch belongs to `@stephenhung/yuzu`, project
`5336f37b-9daf-476e-b9eb-28ff7c38df56`. It publishes the complete iOS and
Android app bundle for SDK 58; testers install the current Expo Go app.
The project uses the `sdkVersion` runtime policy (`exposdk:58.0.0`). No
Apple membership, native build, development server, or shared Expo login is
needed to load a published update whose manifest is publicly accessible.

The project-scoped EAS `preview` environment contains these public values:

- `EXPO_PUBLIC_CONVEX_URL=https://optimistic-newt-247.convex.cloud`
- `EXPO_PUBLIC_CONVEX_SITE_URL=https://optimistic-newt-247.convex.site`

The public preview uses anonymous device identity. It does not supply a
Clerk publishable key. Google account linking is not supported by this
preview; browser OAuth custom callbacks require a development/native build.
Claude and Codex subscription connections use separate backend device/code
flows. Installed-app detection is unavailable in Expo Go.

Publish from the current main checkout after fetching/rebasing and checking:

```sh
bunx eas-cli@latest update --branch public-demo --environment preview \
  --platform all --message 'Yuzu public Expo Go preview' --non-interactive
```

`eas update` does not inherit the `env` object from an EAS build profile.
Keep the two URLs above in the selected EAS environment. Never put backend
secrets or user subscription credentials in an `EXPO_PUBLIC_` variable.

Use the returned update group ID to generate an Expo Go QR:

```text
https://qr.expo.dev/eas-update?projectId=5336f37b-9daf-476e-b9eb-28ff7c38df56&groupId=GROUP_ID&slug=exp
```

Use `slug=exp`, not `slug=yuzu`; the latter targets a development build.
Adding `&format=url` returns the matching `exp://` URL. Before sharing,
request the HTTPS manifest URL without authorization/cookies with
`expo-platform: ios`, `expo-runtime-version: exposdk:58.0.0`, and
`expo-protocol-version: 1`. Check the returned bundle and assets load using only the per-asset headers
issued in the anonymous manifest extensions (not Expo account credentials),
and verify their SHA-256 hashes. Repeat the manifest/bundle check for Android. These checks do
not prove that a physical phone has launched/rendered the app.

Development tunnel links are different: current physical-iPhone Expo Go
requires Expo CLI and Expo Go to use the same Expo account. A tunnel QR is
therefore unsuitable for sharing with arbitrary testers. Published updates
are exempt from that development-server rule. EAS CLI has no supported
project-privacy flag; prove anonymous access using the published manifest.

References: [Expo Go sign-in rule](https://docs.expo.dev/troubleshooting/expo-go-sign-in-required/),
[QR parameters](https://docs.expo.dev/more/qr-codes/),
[update environment](https://docs.expo.dev/eas-update/getting-started/).
