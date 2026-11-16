# Native app discovery

WebView traffic describes the app's website. It is not evidence that the native
mobile app uses the same API. Yuzu keeps these sources separate.

The hosted subscription agent receives four Yuzu MCP tools automatically:

1. `start_native_app({ app })` starts a private cloud-phone research job for a
   deployment-reviewed build. Missing builds return `needs_native_build`.
2. `native_app_status({ jobId })` reports progress and an active viewer link.
   Public exploration stops at login, consent or permission gates. It never
   signs in or performs writes on the user's behalf.
3. `inspect_native_package({ jobId, query? })` downloads the registered Android
   APK through a pinned, bounded transport, checks its SHA-256, and inspects DEX
   strings. The result contains limited, untrusted host/path hints. It is not
   full decompilation or API verification. There are at most three inspections
   per job.
4. `finish_native_capture({ jobId })` stops the phone and collects the provider's
   finalized network artifact. Missing traffic is an explicit failure, never
   replaced with website traffic.

Once capture is ready, `inspect_app_capture({ app, nativeJobId })` creates private
evidence from approved origins. The agent builds tools, verifies actual API
responses, and publishes only verified tools. A captured full GraphQL query can
be verified as a read. An opaque persisted hash always requires the existing
exact-action approval path; names and HTTP 200 responses do not prove safety.

## Build registration

`nativeDiscovery:registerBuild` is an internal deployment-admin mutation, not a
public or model-callable download tool. Review the package identity, native
build provenance and signer before registering its immutable provider build ID,
APK SHA-256 and permitted API origins. Exact HTTPS origins are supported, along
with reviewed registrable-domain patterns such as `https://*.vendor.com`.
Wildcards match subdomains only; the root origin needs a separate entry.
Public suffixes and neighboring private tenants cannot be authorized together.

No arbitrary APK URL, shell command, provider credential or origin allowlist is
accepted from the model. iOS static package inspection is not implemented.

## Isolation and limits

Jobs require the user's Yuzu capability and remain bound to that user, app and
connection. Native evidence never replaces the saved website session. Phone
leases expire after five minutes with a 120-second idle timeout. Captured
credentials expire after an hour; disconnect, reconnect and account deletion
revoke them. Remote stop failures retain minimal operational IDs for cleanup
and are never reported as successful stops.

Network support depends on the provider and the app. Android capture, pinned
TLS, absent response bodies and native sign-in gates can prevent usable API
evidence. Static hints alone cannot establish private account access. The
generic native flow must be tested live for each registered build before being
advertised as working.

The current flat credential bundle rejects native captures with credentials
on multiple origins, rather than replaying one origin's credentials to another.
Supporting these captures requires origin-scoped credential storage.

## Live verification

A real Spotify Android run on the shared Convex deployment opened the reviewed
native build and inspected its APK successfully (17 DEX files, 535,242 strings;
downloaded SHA-256 matched the registered original). The phone was stopped,
but Revyl returned no network artifact after bounded finalization polling.
The job ended with `native_missing_artifact` and zero captured requests. This
does **not** establish native Spotify API access or a signed-in Spotify account.
