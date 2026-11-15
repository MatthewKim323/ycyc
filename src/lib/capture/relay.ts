// Injected JS for the hidden device-relay WebView. It sits on the app's web origin and runs queued
// requests inside the page context. Same-origin requests use credentials: "include", so the user's own
// cookies (including HttpOnly ones JS cannot read) apply; every request uses the phone's IP and browser
// fingerprint. Results go back to React Native.

export interface RelayRequest {
  callId: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export type RelayMessage =
  | { __yuzu: 1; t: "relay-ready"; url: string }
  | { __yuzu: 1; t: "relay"; callId: string; status: number; body: string; mime?: string; error?: string };

export const RELAY_MAX_BODY = 200 * 1024;

export function buildRelayScript(): string {
  return "(function(MAX){" + RELAY_BODY + "})(" + RELAY_MAX_BODY + ");true;";
}

// Call to run one request in the relay page. Payload is JSON-encoded twice so it is a safe JS literal.
export function relayExecSnippet(req: RelayRequest): string {
  return "window.__yuzuRelay && window.__yuzuRelay.exec(" + JSON.stringify(JSON.stringify(req)) + ");true;";
}

const RELAY_BODY = String.raw`
try {
  if (window.__yuzuRelay) { return; }
  var W = window;
  var f = W.fetch ? W.fetch.bind(W) : null;
  function post(o) {
    try { o.__yuzu = 1; W.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch (e) {}
  }
  W.__yuzuRelay = {
    exec: function (json) {
      var req = null;
      try { req = JSON.parse(json); } catch (e) { return; }
      var done = false;
      function finish(o) { if (done) return; done = true; o.t = "relay"; o.callId = req.callId; post(o); }
      try {
        if (!f) { finish({ status: 0, body: "", error: "no fetch" }); return; }
        var headers = req.headers || {};
        // Same-origin calls ride the user's cookies (HttpOnly too). Cross-origin calls (e.g. the app's API
        // host with a bearer header) omit cookies: credentialed CORS is usually refused.
        var same = false;
        try { same = new URL(req.url, W.location.href).origin === W.location.origin; } catch (e) {}
        var init = { method: req.method || "GET", headers: headers, credentials: same ? "include" : "omit", redirect: "follow" };
        if (req.body != null && init.method !== "GET" && init.method !== "HEAD") init.body = req.body;
        var timer = setTimeout(function () { finish({ status: 0, body: "", error: "timeout" }); }, req.timeoutMs || 20000);
        f(req.url, init).then(function (res) {
          var mime = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
          return res.text().then(function (txt) {
            clearTimeout(timer);
            finish({ status: res.status, body: txt.length > MAX ? txt.slice(0, MAX) : txt, mime: mime });
          });
        }).catch(function (err) {
          clearTimeout(timer);
          finish({ status: 0, body: "", error: String(err && err.message || err) });
        });
      } catch (e) { finish({ status: 0, body: "", error: String(e) }); }
    }
  };
  function ready() { post({ t: "relay-ready", url: W.location.href }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready); else setTimeout(ready, 0);
} catch (outer) {}
`;

export function parseRelayMessage(data: string): RelayMessage | null {
  if (!data || data.indexOf("__yuzu") < 0) return null;
  try {
    const m = JSON.parse(data);
    return m && m.__yuzu === 1 && (m.t === "relay" || m.t === "relay-ready") ? (m as RelayMessage) : null;
  } catch {
    return null;
  }
}
