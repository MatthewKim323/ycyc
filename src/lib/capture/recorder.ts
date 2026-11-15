// Builds the JS string injected into the in-app browser before any page script runs.
// It watches the site's own JS-visible API traffic (fetch, XHR, sendBeacon), redacts secrets in the
// capture, and posts raw session material separately. It must never break the page: every hook is
// wrapped in try/catch and always falls through to the original behavior.
//
// Written as a plain string (not fn.toString()) because Hermes strips function source in release.
// Avoid backticks and "${" inside the script body.

import type { AppCaptureConfig } from "./apps";

export const MSG_TAG = "__ycyc";

// Messages the recorder posts to React Native (JSON strings via window.ReactNativeWebView.postMessage).
export type RecorderMessage =
  | { __ycyc: 1; t: "cap"; entries: RecordedEntry[] }
  | { __ycyc: 1; t: "session"; headers: Record<string, string>; cookies: Record<string, string>; storage: Record<string, string> }
  | { __ycyc: 1; t: "page"; url: string; title: string; loggedIn: boolean | null; signal: string }
  | { __ycyc: 1; t: "probe"; id: string; ok: boolean; status: number }
  | { __ycyc: 1; t: "log"; msg: string };

export interface RecordedEntry {
  id: string;
  ts: number;
  method: string;
  url: string;
  status?: number;
  reqHeaders: Record<string, string>;
  reqBody?: string;
  resHeaders?: Record<string, string>;
  resBody?: string;
  mime?: string;
  initiator: "fetch" | "xhr";
  pageUrl?: string;
}

export interface RecorderOptions {
  maxReqBody?: number; // default 8 KB
  maxResBody?: number; // default 16 KB
  flushMs?: number; // default 800
}

export function buildRecorderScript(cfg: AppCaptureConfig, opts: RecorderOptions = {}): string {
  const injected = {
    origin: cfg.webOrigin,
    apiHosts: cfg.apiHosts,
    apiPathHints: cfg.apiPathHints,
    denylist: cfg.denylist.map((d) => d.toLowerCase()),
    sessionHeaders: cfg.sessionHeaders.map((h) => h.toLowerCase()),
    storageKeys: cfg.storageKeys,
    cookieNames: cfg.cookieNames,
    sensitivePaths: cfg.sensitivePaths,
    loggedIn: cfg.loggedIn,
    sessionProbes: cfg.sessionProbes,
    maxReq: opts.maxReqBody ?? 8 * 1024,
    maxRes: opts.maxResBody ?? 16 * 1024,
    flushMs: opts.flushMs ?? 800,
  };
  return "(function(C){" + RECORDER_BODY + "})(" + JSON.stringify(injected) + ");true;";
}

const RECORDER_BODY = String.raw`
try {
  if (window.__ycyc && window.__ycyc.installed) { return; }
  var W = window;
  var Y = W.__ycyc = { installed: true, queue: [], session: { headers: {}, cookies: {}, storage: {} }, seq: 0, lastLogin: null };
  var origFetch = W.fetch ? W.fetch.bind(W) : null;
  Y.origFetch = origFetch;
  var STATIC_RE = /\.(js|mjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wasm)(\?|$)/i;
  var AUTH_HDR_RE = /(^authorization$|token|cookie|secret|session|csrf|xsrf|api-key|apikey|captcha)/i;
  var SECRET_KEY_RE = /(pass(word)?|passwd|token|secret|captcha|otp|code_verifier|refresh|authorization|cookie|api_?key|ssn)/i;
  var SECRET_QS_RE = /^(access_token|id_token|refresh_token|token|login_token|magic_token|otp|api_key|apikey|key|secret|signature|sig|password|code|auth|session)$/i;

  function now() { return Date.now(); }
  function post(obj) {
    try {
      obj.__ycyc = 1;
      var s = JSON.stringify(obj);
      if (W.ReactNativeWebView && W.ReactNativeWebView.postMessage) { W.ReactNativeWebView.postMessage(s); return true; }
    } catch (e) {}
    return false;
  }
  function log(msg) { post({ t: "log", msg: String(msg).slice(0, 300) }); }
  Y.log = log;

  function absUrl(u) {
    try { return new URL(String(u), W.location.href).href; } catch (e) { return String(u); }
  }
  function hostOf(u) { try { return new URL(u).host.toLowerCase(); } catch (e) { return ""; } }
  function pathOf(u) { try { return new URL(u).pathname; } catch (e) { return ""; } }
  function isNoise(u) {
    var l = String(u).toLowerCase();
    if (STATIC_RE.test(l.split("#")[0])) return true;
    for (var i = 0; i < C.denylist.length; i++) { if (l.indexOf(C.denylist[i]) >= 0) return true; }
    return false;
  }
  function isApi(u) {
    var h = hostOf(u);
    var on = false;
    for (var i = 0; i < C.apiHosts.length; i++) { var a = C.apiHosts[i]; if (h === a || h.slice(-(a.length + 1)) === "." + a) { on = true; break; } }
    if (!on) return false;
    if (/^api\.|\.api\.|^graphql\./.test(h)) return true;
    var p = pathOf(u);
    for (var j = 0; j < C.apiPathHints.length; j++) { if (p.indexOf(C.apiPathHints[j]) >= 0) return true; }
    return false;
  }
  function isSensitivePath(u) {
    var p = pathOf(u).toLowerCase();
    for (var i = 0; i < C.sensitivePaths.length; i++) { if (p.indexOf(C.sensitivePaths[i].toLowerCase()) >= 0) return true; }
    return false;
  }
  function redactUrl(u) {
    try {
      var x = new URL(u);
      var changed = false;
      x.searchParams.forEach(function (v, k) { if (SECRET_QS_RE.test(k)) { changed = true; } });
      if (!changed) return u;
      var keys = [];
      x.searchParams.forEach(function (v, k) { keys.push(k); });
      for (var i = 0; i < keys.length; i++) { if (SECRET_QS_RE.test(keys[i])) x.searchParams.set(keys[i], "<redacted>"); }
      return x.href;
    } catch (e) { return u; }
  }
  function redactJson(v, depth) {
    if (depth > 8 || v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) { var out = []; for (var i = 0; i < v.length && i < 200; i++) out.push(redactJson(v[i], depth + 1)); return out; }
    var o = {};
    for (var k in v) {
      if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
      o[k] = SECRET_KEY_RE.test(k) && (typeof v[k] === "string" || typeof v[k] === "number") ? "<redacted:" + k + ">" : redactJson(v[k], depth + 1);
    }
    return o;
  }
  // GWT-RPC (Cronometer /cronometer/app): the per-session nonce rides in the body. Copy it and the
  // serialization policy (field 4 of the |-split body) into the session, keep them out of the capture.
  var GWT_NONCE_RE = /\b[0-9a-f]{32}\b/g;
  function isGwtRpc(url, s) {
    return pathOf(url).indexOf("/cronometer/app") >= 0 || /^\d+\|\d+\|\d+\|https?:\/\//.test(s);
  }
  function harvestGwt(s) {
    try {
      var parts = s.split("|");
      if (parts.length > 4 && /^[0-9A-Fa-f]{32}$/.test(parts[4])) setSession("storage", "gwt_policy", parts[4]);
      var m = s.match(GWT_NONCE_RE);
      if (m && m.length) setSession("storage", "nonce", m[0]);
    } catch (e) {}
  }
  // Numeric user id in REST paths (Cronometer /api/v3/user/<id>/...).
  function harvestUrl(u) {
    try {
      var m = /\/api\/v3\/user\/(\d+)\//.exec(pathOf(u));
      if (m && hostOf(u) === hostOf(C.origin)) setSession("storage", "user_id", m[1]);
    } catch (e) {}
  }
  function redactBody(body, url, limit) {
    if (body == null) return undefined;
    if (isSensitivePath(url)) return "<redacted>";
    var s = String(body);
    if (url.indexOf("#res") < 0 && isGwtRpc(url, s)) harvestGwt(s);
    if (isGwtRpc(url, s)) s = s.replace(GWT_NONCE_RE, "<redacted:nonce>");
    var t = s.replace(/^\s+/, "");
    if (t[0] === "{" || t[0] === "[") {
      try { s = JSON.stringify(redactJson(JSON.parse(t), 0)); } catch (e) {}
    } else if (/^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(t)) {
      s = t.split("&").map(function (pair) {
        var i = pair.indexOf("=");
        var k = i >= 0 ? pair.slice(0, i) : pair;
        var dk = k; try { dk = decodeURIComponent(k); } catch (e) {}
        return SECRET_KEY_RE.test(dk) ? k + "=<redacted>" : pair;
      }).join("&");
    }
    return s.length > limit ? s.slice(0, limit) : s;
  }

  // Session material: raw values, posted separately, never inside capture entries.
  var sessionTimer = null;
  function setSession(kind, key, value) {
    if (value == null || value === "") return;
    var v = String(value);
    if (Y.session[kind][key] === v) return;
    Y.session[kind][key] = v;
    if (sessionTimer) clearTimeout(sessionTimer);
    sessionTimer = setTimeout(postSession, 300);
  }
  Y.setSession = setSession;
  function matchKey(name, list) {
    for (var i = 0; i < list.length; i++) {
      var k = list[i];
      if (k.length > 2 && k[0] === "/" && k.lastIndexOf("/") > 0) {
        var end = k.lastIndexOf("/");
        try { if (new RegExp(k.slice(1, end), k.slice(end + 1)).test(name)) return true; } catch (e) {}
      } else if (k === name) { return true; }
    }
    return false;
  }
  function readCookiesAndStorage() {
    try { setSession("storage", "tz", Intl.DateTimeFormat().resolvedOptions().timeZone); } catch (e) {}
    try {
      var parts = (document.cookie || "").split(/;\s*/);
      for (var i = 0; i < parts.length; i++) {
        var eq = parts[i].indexOf("=");
        if (eq <= 0) continue;
        var name = parts[i].slice(0, eq);
        if (C.cookieNames.indexOf(name) >= 0 || /(sess|auth|token|csrf|xsrf|user|device)/i.test(name)) {
          setSession("cookies", name, parts[i].slice(eq + 1));
        }
      }
    } catch (e) {}
    try {
      var ls = W.localStorage;
      if (ls) {
        for (var j = 0; j < ls.length && j < 300; j++) {
          var key = ls.key(j);
          if (key && matchKey(key, C.storageKeys)) {
            var val = ls.getItem(key);
            if (val != null) setSession("storage", key, val.length > 4096 ? val.slice(0, 4096) : val);
          }
        }
      }
    } catch (e) {}
  }
  function postSession() {
    sessionTimer = null;
    post({ t: "session", headers: Y.session.headers, cookies: Y.session.cookies, storage: Y.session.storage });
  }
  Y.postSession = function () { readCookiesAndStorage(); postSession(); };

  function normHeaders(h) {
    var out = {};
    try {
      if (!h) return out;
      if (typeof Headers !== "undefined" && h instanceof Headers) { h.forEach(function (v, k) { out[String(k).toLowerCase()] = String(v); }); return out; }
      if (Array.isArray(h)) { for (var i = 0; i < h.length; i++) { if (h[i] && h[i].length >= 2) out[String(h[i][0]).toLowerCase()] = String(h[i][1]); } return out; }
      for (var k in h) { if (Object.prototype.hasOwnProperty.call(h, k)) out[String(k).toLowerCase()] = String(h[k]); }
    } catch (e) {}
    return out;
  }
  function redactHeaders(h, url) {
    harvestUrl(url);
    var out = {};
    var mine = !isNoise(url) && (isApi(url) || hostOf(url) === hostOf(C.origin));
    for (var k in h) {
      var auth = C.sessionHeaders.indexOf(k) >= 0 || AUTH_HDR_RE.test(k);
      if (auth) {
        out[k] = "<redacted:" + k + ">";
        if (mine) setSession("headers", k, h[k]);
      } else { out[k] = h[k]; }
    }
    return out;
  }
  function bodyToString(b) {
    try {
      if (b == null) return undefined;
      if (typeof b === "string") return b;
      if (typeof URLSearchParams !== "undefined" && b instanceof URLSearchParams) return b.toString();
      if (typeof FormData !== "undefined" && b instanceof FormData) {
        var parts = [];
        b.forEach(function (v, k) { parts.push(encodeURIComponent(k) + "=" + (typeof v === "string" ? encodeURIComponent(v) : "<file>")); });
        return parts.join("&");
      }
      if (typeof Blob !== "undefined" && b instanceof Blob) return "<blob:" + b.size + ">";
      if (b instanceof ArrayBuffer || (b.buffer && b.buffer instanceof ArrayBuffer)) return "<binary>";
    } catch (e) {}
    return undefined;
  }
  function isJsonMime(m) { return /json|\+json|javascript-json/i.test(m || ""); }

  function record(e) {
    try {
      if (isNoise(e.url)) return;
      if (!isApi(e.url) && !isJsonMime(e.mime)) return;
      e.id = "c" + now().toString(36) + (Y.seq++).toString(36);
      e.url = redactUrl(e.url);
      e.pageUrl = redactUrl(W.location.href);
      Y.queue.push(e);
      if (Y.queue.length >= 25) flush();
    } catch (err) {}
  }
  function flush() {
    try {
      if (!Y.queue.length) return;
      if (!(W.ReactNativeWebView && W.ReactNativeWebView.postMessage)) return;
      var batch = Y.queue.splice(0, Y.queue.length);
      post({ t: "cap", entries: batch });
    } catch (e) {}
  }
  Y.flush = flush;
  setInterval(flush, C.flushMs);

  // fetch
  if (origFetch) {
    var hooked = function (input, init) {
      var meta = null;
      try {
        var isReq = typeof Request !== "undefined" && input instanceof Request;
        var url = absUrl(isReq ? input.url : input);
        var method = String((init && init.method) || (isReq ? input.method : "GET") || "GET").toUpperCase();
        var hdrs = normHeaders(isReq ? input.headers : null);
        var extra = normHeaders(init && init.headers);
        for (var k in extra) hdrs[k] = extra[k];
        meta = { ts: now(), method: method, url: url, reqHeaders: redactHeaders(hdrs, url), reqBody: redactBody(bodyToString(init && init.body), url, C.maxReq), initiator: "fetch" };
      } catch (e) { meta = null; }
      var p = origFetch(input, init);
      if (meta) {
        try {
          p.then(function (res) {
            try {
              meta.status = res.status;
              var mime = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
              meta.mime = mime;
              meta.resHeaders = mime ? { "content-type": mime } : {};
              if (isNoise(meta.url) || (!isApi(meta.url) && !isJsonMime(mime))) return;
              if (isJsonMime(mime) && !/event-stream/i.test(mime)) {
                res.clone().text().then(function (txt) {
                  meta.resBody = redactBody(txt, meta.url + "#res", C.maxRes);
                  record(meta);
                }, function () { record(meta); });
              } else { record(meta); }
            } catch (e) {}
          }, function (err) { try { meta.status = 0; record(meta); } catch (e) {} });
        } catch (e) {}
      }
      return p;
    };
    try { W.fetch = hooked; } catch (e) {}
  }

  // XMLHttpRequest
  try {
    var XP = W.XMLHttpRequest && W.XMLHttpRequest.prototype;
    if (XP) {
      var oOpen = XP.open, oSet = XP.setRequestHeader, oSend = XP.send;
      XP.open = function (method, url) {
        try { this.__y = { method: String(method || "GET").toUpperCase(), url: absUrl(url), headers: {} }; } catch (e) {}
        return oOpen.apply(this, arguments);
      };
      XP.setRequestHeader = function (k, v) {
        try { if (this.__y) this.__y.headers[String(k).toLowerCase()] = String(v); } catch (e) {}
        return oSet.apply(this, arguments);
      };
      XP.send = function (body) {
        try {
          var y = this.__y;
          if (y && !isNoise(y.url)) {
            var meta = { ts: now(), method: y.method, url: y.url, reqHeaders: redactHeaders(y.headers, y.url), reqBody: redactBody(bodyToString(body), y.url, C.maxReq), initiator: "xhr" };
            var xhr = this;
            xhr.addEventListener("loadend", function () {
              try {
                meta.status = xhr.status;
                var mime = xhr.getResponseHeader("content-type") || "";
                meta.mime = mime;
                meta.resHeaders = mime ? { "content-type": mime } : {};
                if (isJsonMime(mime)) {
                  var txt = null;
                  if (xhr.responseType === "" || xhr.responseType === "text") txt = xhr.responseText;
                  else if (xhr.responseType === "json") txt = JSON.stringify(xhr.response);
                  if (txt != null) meta.resBody = redactBody(txt, meta.url + "#res", C.maxRes);
                }
                record(meta);
              } catch (e) {}
            });
          }
        } catch (e) {}
        return oSend.apply(this, arguments);
      };
    }
  } catch (e) {}

  // sendBeacon (almost always analytics; kept only when it hits the app's API)
  try {
    var nav = W.navigator;
    if (nav && nav.sendBeacon) {
      var oBeacon = nav.sendBeacon.bind(nav);
      nav.sendBeacon = function (url, data) {
        try {
          var u = absUrl(url);
          if (!isNoise(u) && isApi(u)) record({ ts: now(), method: "POST", url: u, reqHeaders: {}, reqBody: redactBody(bodyToString(data), u, C.maxReq), initiator: "fetch", status: 0 });
        } catch (e) {}
        return oBeacon(url, data);
      };
    }
  } catch (e) {}

  // Signed-in detection
  function getPath(o, path) {
    var parts = String(path).split(".");
    var cur = o;
    for (var i = 0; i < parts.length; i++) { if (cur == null) return undefined; cur = cur[parts[i]]; }
    return cur;
  }
  function startsWithAny(p, list) {
    if (!list) return false;
    for (var i = 0; i < list.length; i++) { if (p.indexOf(list[i]) === 0) return true; }
    return false;
  }
  function reportPage(loggedIn, signal) {
    Y.lastLogin = loggedIn;
    post({ t: "page", url: W.location.href, title: document.title || "", loggedIn: loggedIn, signal: signal });
  }
  function checkLogin() {
    try {
      var p = W.location.pathname || "/";
      var L = C.loggedIn || {};
      if (startsWithAny(p, L.loggedOutPaths)) { reportPage(false, "url"); return; }
      if (startsWithAny(p, L.loggedInPaths)) { reportPage(true, "url"); }
      if (L.domSelectors) {
        for (var i = 0; i < L.domSelectors.length; i++) {
          try { if (document.querySelector(L.domSelectors[i])) { reportPage(true, "dom"); return; } } catch (e) {}
        }
      }
      if (L.probe && origFetch) {
        origFetch(L.probe.path, { credentials: "include", headers: { accept: "application/json" } }).then(function (r) {
          return r.ok ? r.json() : null;
        }).then(function (j) {
          reportPage(!!(j && getPath(j, L.probe.truthyPath)), "probe");
        }, function () { reportPage(null, "probe-failed"); });
      } else if (!startsWithAny(p, L.loggedInPaths)) {
        reportPage(null, "unknown");
      }
    } catch (e) { log("checkLogin " + e); }
  }
  Y.checkLogin = checkLogin;

  // Session probes: mint a bearer token from the cookie session through the site's own endpoint.
  Y.runSessionProbes = function () {
    try {
      var probes = C.sessionProbes || [];
      probes.forEach(function (sp) {
        W.fetch(sp.path, { credentials: "include", headers: { accept: "application/json" } }).then(function (r) {
          return r.ok ? r.json() : null;
        }).then(function (j) {
          if (!j) return;
          for (var key in sp.pick) {
            var v = getPath(j, sp.pick[key]);
            if (v == null || v === "") continue;
            var dot = key.indexOf(".");
            var kind = key.slice(0, dot), name = key.slice(dot + 1);
            var pre = (sp.prefix && sp.prefix[key]) || "";
            if (kind === "headers" || kind === "cookies" || kind === "storage") setSession(kind, name, pre + String(v));
          }
        }, function () {});
      });
    } catch (e) { log("sessionProbes " + e); }
  };

  // Playbook probe: same-origin request through the hooked fetch so it lands in the capture.
  Y.probe = function (id, path, method, body, headers) {
    try {
      var url = absUrl(path);
      var same = hostOf(url) === hostOf(W.location.href);
      // Cross-origin probes (the app's API host) carry the bearer header, not cookies.
      var init = { method: method || "GET", credentials: same ? "include" : "omit", headers: { accept: "application/json" } };
      if (body) { init.body = body; init.headers["content-type"] = "application/json"; }
      if (headers) {
        for (var hk in headers) {
          var hv = String(headers[hk]).replace(/\{\{session\.headers\.([a-zA-Z0-9_-]+)\}\}/g, function (m, n) { return Y.session.headers[n.toLowerCase()] || ""; });
          if (hv) init.headers[hk] = hv;
        }
      }
      W.fetch(url, init).then(function (r) { post({ t: "probe", id: id, ok: r.ok, status: r.status }); }, function () { post({ t: "probe", id: id, ok: false, status: 0 }); });
    } catch (e) { post({ t: "probe", id: id, ok: false, status: 0 }); }
  };

  // SPA navigation
  var navTimer = null;
  function onNav() {
    if (navTimer) clearTimeout(navTimer);
    navTimer = setTimeout(function () { readCookiesAndStorage(); checkLogin(); }, 600);
  }
  try {
    var H = W.history;
    var oPush = H.pushState, oReplace = H.replaceState;
    H.pushState = function () { var r = oPush.apply(this, arguments); try { onNav(); } catch (e) {} return r; };
    H.replaceState = function () { var r = oReplace.apply(this, arguments); try { onNav(); } catch (e) {} return r; };
    W.addEventListener("popstate", onNav);
  } catch (e) {}
  function onReady() { readCookiesAndStorage(); checkLogin(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onReady);
  else setTimeout(onReady, 0);
  W.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", flush);
} catch (outer) {}
`;

// Parses a message from the WebView. Returns null for anything that is not ours.
export function parseRecorderMessage(data: string): RecorderMessage | null {
  if (!data || data.indexOf(MSG_TAG) < 0) return null;
  try {
    const m = JSON.parse(data);
    return m && m.__ycyc === 1 && typeof m.t === "string" ? (m as RecorderMessage) : null;
  } catch {
    return null;
  }
}
