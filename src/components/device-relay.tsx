// Device execution path: "runs from your phone, your session, your IP".
// Keeps one hidden WebView per web app the user has connected (plus any app a queued call targets),
// subscribes to the backend's device-call queue, runs each request inside that app's signed-in page
// (same-origin calls carry the user's own cookies, HttpOnly ones too; API-host calls carry the bearer
// header the backend rendered), and reports the response back. Mount once near the app root, inside the ConvexProvider. Renders nothing visible.

import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { captureConfigFor, originOf } from "@/lib/capture/apps";
import { buildRelayScript, parseRelayMessage, relayExecSnippet } from "@/lib/capture/relay";
import { NativeWebView, type WebViewHandle, type WebViewMessageEvent } from "@/lib/capture/native-webview";

const RELAY_SCRIPT = buildRelayScript();
const RELAY_TIMEOUT_MS = 20000;

interface QueuedCall {
  _id: Id<"calls">;
  appSlug: string;
  tool: string;
  request: { method: string; url: string; headers: Record<string, string>; body?: string };
}

export function DeviceRelay({ userId }: { userId: string | null }) {
  const uid = userId as Id<"users"> | null;
  const queued = useQuery(api.calls.queued, uid ? { userId: uid } : "skip") as QueuedCall[] | undefined;
  const connections = useQuery(api.connections.mine, uid ? { userId: uid } : "skip");
  const complete = useMutation(api.calls.complete);
  const heartbeat = useMutation(api.calls.heartbeat);

  // Tell the backend this phone can run calls, so device-only apps know whether to wait or say "open yuzu".
  useEffect(() => {
    if (!uid) return undefined;
    const beat = () => heartbeat({ userId: uid }).catch(() => {});
    beat();
    const id = setInterval(beat, 30_000);
    return () => clearInterval(id);
  }, [uid, heartbeat]);

  // appSlug -> the web origin whose page runs that app's calls, and origin -> page URL the WebView sits on.
  // Calls to an app's API host (e.g. api.myfitnesspal.com) run from the app's web origin, where CORS is
  // known to allow them; unknown apps fall back to the call's own origin.
  const { relays, slugOrigin } = useMemo(() => {
    const map = new Map<string, string>();
    const bySlug = new Map<string, string>();
    const addApp = (slug: string, loginUrl?: string, webOrigin?: string) => {
      if (bySlug.has(slug)) return;
      const cfg = captureConfigFor(slug, loginUrl, webOrigin);
      const origin = originOf(cfg.webOrigin);
      if (!origin) return;
      bySlug.set(slug, origin);
      if (!map.has(origin)) map.set(origin, origin + cfg.relayPath);
    };
    for (const c of connections ?? []) {
      const conn = c as { status?: string; app?: { slug: string; route?: string; webOrigin?: string; loginUrl?: string } };
      const app = conn.app;
      if (!app || app.route !== "web" || conn.status === "error") continue;
      addApp(app.slug, app.loginUrl, app.webOrigin);
    }
    for (const call of queued ?? []) {
      addApp(call.appSlug);
      if (!bySlug.has(call.appSlug)) {
        const origin = originOf(call.request.url);
        if (origin && !map.has(origin)) map.set(origin, origin + "/");
      }
    }
    return { relays: map, slugOrigin: bySlug };
  }, [connections, queued]);

  const refs = useRef(new Map<string, WebViewHandle | null>());
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const inFlight = useRef(new Map<string, { origin: string; timer: ReturnType<typeof setTimeout> }>());
  const finished = useRef(new Set<string>());

  const report = useCallback(
    async (callId: string, status: number, body: string) => {
      const entry = inFlight.current.get(callId);
      if (entry) clearTimeout(entry.timer);
      inFlight.current.delete(callId);
      if (finished.current.has(callId)) return;
      finished.current.add(callId);
      try {
        await complete({ callId: callId as Id<"calls">, response: { status, body } });
      } catch {
        // The backend expires calls it stops waiting on; nothing else to do here.
      }
    },
    [complete],
  );

  // Dispatch queued calls to ready relays.
  useEffect(() => {
    if (!queued) return;
    const live = new Set(queued.map((c) => c._id as string));
    for (const id of finished.current) if (!live.has(id)) finished.current.delete(id);
    for (const call of queued) {
      const id = call._id as string;
      if (inFlight.current.has(id) || finished.current.has(id)) continue;
      const origin = slugOrigin.get(call.appSlug) ?? originOf(call.request.url);
      const view = refs.current.get(origin);
      if (!view || !ready[origin]) continue;
      const timer = setTimeout(() => report(id, 0, JSON.stringify({ error: "device relay timeout" })), RELAY_TIMEOUT_MS + 2000);
      inFlight.current.set(id, { origin, timer });
      view.injectJavaScript(
        relayExecSnippet({
          callId: id,
          method: call.request.method,
          url: call.request.url,
          headers: call.request.headers,
          body: call.request.body,
          timeoutMs: RELAY_TIMEOUT_MS,
        }),
      );
    }
  }, [queued, ready, report, slugOrigin]);

  useEffect(() => {
    const flights = inFlight.current;
    return () => {
      for (const f of flights.values()) clearTimeout(f.timer);
    };
  }, []);

  const onMessage = useCallback(
    (origin: string) => (e: WebViewMessageEvent) => {
      const m = parseRelayMessage(e.nativeEvent.data);
      if (!m) return;
      if (m.t === "relay-ready") {
        setReady((r) => (r[origin] ? r : { ...r, [origin]: true }));
      } else {
        const body = m.error && !m.body ? JSON.stringify({ error: m.error }) : m.body;
        void report(m.callId, m.status, body);
      }
    },
    [report],
  );

  if (!uid || relays.size === 0) return null;

  return (
    <View style={styles.host} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[...relays.entries()].map(([origin, url]) => (
        <NativeWebView
          key={origin}
          ref={(r) => {
            refs.current.set(origin, r);
          }}
          style={styles.web}
          source={{ uri: url }}
          injectedJavaScriptBeforeContentLoaded={RELAY_SCRIPT}
          injectedJavaScript={RELAY_SCRIPT}
          onMessage={onMessage(origin)}
          onLoadStart={() => setReady((r) => (r[origin] ? { ...r, [origin]: false } : r))}
          onContentProcessDidTerminate={() => refs.current.get(origin)?.reload()}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          setSupportMultipleWindows={false}
          mediaPlaybackRequiresUserAction
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute", left: -10, top: -10, width: 1, height: 1, opacity: 0, overflow: "hidden" },
  web: { width: 1, height: 1 },
});

export default DeviceRelay;
