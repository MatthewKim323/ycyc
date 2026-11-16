// In-app browser that records a web app's private API while the user signs in.
// Renders only a full-bleed WebView; the screen around it (header, progress) belongs to the caller.
// Flow: start at app.loginUrl with the recorder injected before page scripts -> detect sign-in ->
// mint session material through the site's own endpoints -> walk the capture playbook -> onDone.
// Runs in Expo Go: no native cookie access, so HttpOnly cookies stay in the WebView's cookie store
// (shared with DeviceRelay) and we capture the bearer tokens and headers the site's JS can see.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/button";
import { Text } from "@/components/text";

import type { CaptureEntry, CatalogApp, SessionBundle } from "@/lib/contract";
import { captureConfigFor, originOf, type PlaybookStep } from "@/lib/capture/apps";
import { buildRecorderScript, parseRecorderMessage } from "@/lib/capture/recorder";
import { todayIn } from "@/lib/compiler/render";
import { NativeWebView, type WebViewHandle, type WebViewMessageEvent, type WebViewNavigation } from "@/lib/capture/native-webview";
import { colors, space } from "@/theme";

type Phase = "login" | "capturing";

export interface CaptureWebViewProps {
  app: CatalogApp;
  onDone: (r: { session: SessionBundle; capture: CaptureEntry[] }) => void;
  onProgress?: (p: { phase: Phase; requests: number; loggedIn: boolean }) => void;
  /** Optional first page instead of loginUrl (e.g. a pasted magic sign-in link). */
  startUrl?: string;
}

const MAX_ENTRIES = 600;
const LOGIN_POLL_MS = 5000;
const SETTLE_AFTER_LOGIN_MS = 1500;
const LOAD_TIMEOUT_MS = 15000;
const PROBE_TIMEOUT_MS = 6000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function CaptureWebView({ app, onDone, onProgress, startUrl }: CaptureWebViewProps) {
  const cfg = useMemo(() => captureConfigFor(app.slug, app.loginUrl, app.webOrigin), [app.slug, app.loginUrl, app.webOrigin]);
  const recorder = useMemo(() => buildRecorderScript(cfg), [cfg]);
  const origin = useMemo(() => originOf(cfg.webOrigin || cfg.loginUrl), [cfg]);

  const webRef = useRef<WebViewHandle>(null);
  const [uri, setUri] = useState(startUrl ?? cfg.loginUrl);
  const [phase, setPhase] = useState<Phase>("login");

  const [startedAt] = useState(() => Date.now());
  const entries = useRef<CaptureEntry[]>([]);
  const session = useRef<SessionBundle>({ headers: {}, cookies: {}, storage: {}, capturedAt: startedAt });
  const loggedIn = useRef(false);
  const done = useRef(false);
  const loadWaiter = useRef<(() => void) | null>(null);
  const probeWaiters = useRef(new Map<string, () => void>());
  const lastReported = useRef("");

  const onDoneRef = useRef(onDone);
  const onProgressRef = useRef(onProgress);
  useLayoutEffect(() => {
    onDoneRef.current = onDone;
    onProgressRef.current = onProgress;
  });

  const report = useCallback((p: Phase) => {
    const payload = { phase: p, requests: entries.current.length, loggedIn: loggedIn.current };
    const key = payload.phase + payload.requests + payload.loggedIn;
    if (key === lastReported.current) return;
    lastReported.current = key;
    onProgressRef.current?.(payload);
  }, []);

  const phaseRef = useRef<Phase>("login");
  useLayoutEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const inject = useCallback((js: string) => {
    webRef.current?.injectJavaScript(js);
  }, []);

  const beginCapture = useCallback(() => {
    if (loggedIn.current) return;
    loggedIn.current = true;
    setPhase("capturing");
    report("capturing");
  }, [report]);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      const m = parseRecorderMessage(e.nativeEvent.data);
      if (!m) return;
      switch (m.t) {
        case "cap": {
          const room = MAX_ENTRIES - entries.current.length;
          if (room > 0) entries.current.push(...(m.entries as CaptureEntry[]).slice(0, room));
          report(phaseRef.current);
          break;
        }
        case "session": {
          const s = session.current;
          s.headers = { ...s.headers, ...m.headers };
          s.cookies = { ...s.cookies, ...m.cookies };
          s.storage = { ...s.storage, ...m.storage };
          s.capturedAt = Date.now();
          break;
        }
        case "page": {
          if (m.loggedIn === true) beginCapture();
          break;
        }
        case "probe": {
          const w = probeWaiters.current.get(m.id);
          if (w) {
            probeWaiters.current.delete(m.id);
            w();
          }
          break;
        }
        default:
          break;
      }
    },
    [report, beginCapture],
  );

  const onNavChange = useCallback(
    (nav: WebViewNavigation) => {
      if (nav.loading || !nav.url || originOf(nav.url) !== origin) return;
      const last = entries.current[entries.current.length - 1];
      if (last && last.initiator === "navigation" && last.url === nav.url) return;
      if (entries.current.length >= MAX_ENTRIES) return;
      entries.current.push({
        id: "n" + Date.now().toString(36) + entries.current.length.toString(36),
        ts: Date.now(),
        method: "GET",
        url: nav.url.split("#")[0],
        reqHeaders: {},
        initiator: "navigation",
        pageUrl: nav.url,
      });
    },
    [origin],
  );

  const onLoadEnd = useCallback(() => {
    const w = loadWaiter.current;
    loadWaiter.current = null;
    w?.();
  }, []);

  // While signing in: poll the signed-in check (covers logins that finish without a full page load).
  useEffect(() => {
    if (phase !== "login") return;
    report("login");
    const id = setInterval(() => inject("window.__yuzu && window.__yuzu.checkLogin();true;"), LOGIN_POLL_MS);
    return () => clearInterval(id);
  }, [phase, inject, report]);

  // After sign-in: session probes, then the playbook, then hand everything back.
  useEffect(() => {
    if (phase !== "capturing") return;
    let cancelled = false;

    const visit = (path: string) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          loadWaiter.current = null;
          resolve();
        }, LOAD_TIMEOUT_MS);
        loadWaiter.current = () => {
          clearTimeout(timer);
          resolve();
        };
        const target = origin + path;
        setUri((cur) => (cur === target ? target + (target.includes("?") ? "&" : "?") + "_y=" + Date.now() : target));
      });

    const probe = (step: Extract<PlaybookStep, { kind: "probe" }>, id: string) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          probeWaiters.current.delete(id);
          resolve();
        }, PROBE_TIMEOUT_MS);
        probeWaiters.current.set(id, () => {
          clearTimeout(timer);
          resolve();
        });
        const path = step.path.replace(/\{\{today\}\}/g, todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone));
        const args = [id, path, step.method ?? "GET", step.body ?? null, step.headers ?? null].map((a) => JSON.stringify(a)).join(",");
        inject("window.__yuzu && window.__yuzu.probe(" + args + ");true;");
      });

    const sessionProbes = (id: string) => new Promise<void>((resolve) => {
      if (!cfg.sessionProbes.length) { resolve(); return; }
      const timer = setTimeout(() => { probeWaiters.current.delete(id); resolve(); }, PROBE_TIMEOUT_MS);
      probeWaiters.current.set(id, () => { clearTimeout(timer); resolve(); });
      inject("window.__yuzu && window.__yuzu.runSessionProbes(" + JSON.stringify(id) + ");true;");
    });

    (async () => {
      await sleep(SETTLE_AFTER_LOGIN_MS);
      if (cancelled) return;
      await sessionProbes("session-initial");
      let i = 0;
      for (const step of cfg.playbook) {
        if (cancelled) return;
        if (step.kind === "visit") {
          await visit(step.path);
          await sleep(step.dwellMs ?? 3500);
          if (cancelled) return;
          // Each loaded page has a fresh recorder. Wait for its token exchange
          // before another navigation or an API probe that needs those headers.
          await sessionProbes("session-after-visit-" + i);
        } else {
          await probe(step, "p" + i);
          await sleep(600);
        }
        report("capturing");
        i++;
      }
      if (cancelled) return;
      inject("window.__yuzu && (window.__yuzu.postSession(), window.__yuzu.flush());true;");
      await sleep(1500);
      if (cancelled || done.current) return;
      done.current = true;
      session.current.capturedAt = Date.now();
      onDoneRef.current({ session: { ...session.current }, capture: entries.current.slice() });
    })();

    return () => {
      cancelled = true;
    };
  }, [phase, cfg, origin, inject, report]);

  return (
    <View style={styles.web}>
      <NativeWebView
      ref={webRef}
      style={styles.web}
      source={{ uri }}
      originWhitelist={["https://*", "http://*", "about:*"]}
      injectedJavaScriptBeforeContentLoaded={recorder}
      injectedJavaScriptBeforeContentLoadedForMainFrameOnly
      injectedJavaScriptForMainFrameOnly
      onMessage={onMessage}
      onNavigationStateChange={onNavChange}
      onLoadEnd={onLoadEnd}
      onContentProcessDidTerminate={() => webRef.current?.reload()}
      javaScriptEnabled
      domStorageEnabled
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      setSupportMultipleWindows={false}
      allowsBackForwardNavigationGestures
      webviewDebuggingEnabled={__DEV__}
      automaticallyAdjustContentInsets={false}
      contentInsetAdjustmentBehavior="never"
      />
      {cfg.loggedIn.manual && phase === "login" ? (
        <View style={styles.confirm}>
          <Text variant="caption" color={colors.textSecondary}>Sign in on the website, then continue.</Text>
          <Button label="I'm signed in — continue" onPress={beginCapture} fullWidth />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: "#000000" },
  confirm: { padding: space.md, gap: space.sm, backgroundColor: colors.bg },
});

export default CaptureWebView;
