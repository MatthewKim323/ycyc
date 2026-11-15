// Per-app capture config for the web route.
// The recorder (recorder.ts) and the CaptureWebView read this to know where to start, how to tell
// the user is signed in, which pages to walk after sign-in, and which traffic is worth keeping.
// Pure data + tiny helpers, no React Native imports, so the compiler and Convex can import it too.

import type { AppSlug } from "../contract";

export type PlaybookStep =
  // Navigate the WebView to a page on the app's site and wait for its API calls to settle.
  | { kind: "visit"; path: string; label: string; dwellMs?: number }
  // Run a same-origin request from inside the signed-in page (the site's own endpoint, the user's own
  // session). It goes through the hooked fetch, so it lands in the capture like any other call.
  // headers may reference captured session values: { authorization: "{{session.headers.authorization}}" }.
  | { kind: "probe"; path: string; label: string; method?: "GET" | "POST"; body?: string; headers?: Record<string, string> };

export interface SessionProbe {
  // Same-origin GET run inside the page after sign-in. Picks fields from the JSON response into the
  // SessionBundle. Example: MFP /user/auth_token?refresh=true -> access_token, user_id.
  path: string;
  pick: Record<string, string>; // session key ("headers.authorization", "storage.mfp_user_id") -> dot path
  prefix?: Record<string, string>; // optional value prefix per session key, e.g. "Bearer "
}

export interface AppCaptureConfig {
  slug: AppSlug;
  loginUrl: string;
  webOrigin: string;
  // Signed-in detection. Any positive signal wins, a URL in loggedOutPaths always means signed out.
  loggedIn: {
    probe?: { path: string; truthyPath: string }; // e.g. NextAuth /api/auth/session -> "user"
    loggedOutPaths: string[]; // path prefixes that mean "still on the login flow"
    loggedInPaths?: string[]; // path prefixes that only render when signed in
    domSelectors?: string[]; // CSS selectors that only exist when signed in
  };
  playbook: PlaybookStep[];
  sessionProbes: SessionProbe[];
  // Request headers that carry auth. Redacted in CaptureEntry, copied raw into SessionBundle.headers.
  sessionHeaders: string[];
  // localStorage keys worth keeping (exact names or /regex/ strings).
  storageKeys: string[];
  // Cookie names visible to JS that matter (HttpOnly ones never show up in Expo Go).
  cookieNames: string[];
  // Hosts whose calls count as the app's API (suffix match).
  apiHosts: string[];
  // Path or URL substrings that mark a call as API even on the main origin.
  apiPathHints: string[];
  // Substrings of URLs to drop as noise (analytics, ads, static, telemetry).
  denylist: string[];
  // Where the hidden relay WebView sits for device execution.
  relayPath: string;
  // Request paths whose bodies must never be recorded (credentials, captcha tokens).
  sensitivePaths: string[];
  // Apps whose sign-in can't run inside the WebView (Google/Apple block embedded browsers, or the
  // site emails a magic link): the connect screen offers "Paste your sign-in link", checks the paste
  // with magicLinkFor(), and loads that URL in the capture WebView instead of loginUrl.
  magicLink?: {
    label: string; // button text
    hint: string; // one line under the paste field
    pattern: string; // RegExp source the pasted URL must match
  };
}

// Shared noise list: analytics, ads, consent, monitoring, static assets.
export const COMMON_DENYLIST: string[] = [
  "google-analytics.com",
  "googletagmanager.com",
  "analytics.google.com",
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "adservice.google",
  "facebook.net",
  "facebook.com/tr",
  "connect.facebook",
  "amplitude.com",
  "segment.io",
  "segment.com",
  "mixpanel.com",
  "sentry.io",
  "browser-intake-datadoghq",
  "datadoghq.com",
  "hotjar",
  "optimizely",
  "braze.com",
  "appboy",
  "adsrvr.org",
  "criteo",
  "amazon-adsystem",
  "pubmatic",
  "rubiconproject",
  "openx.net",
  "casalemedia",
  "taboola",
  "outbrain",
  "onetrust",
  "cookielaw",
  "cookiebot",
  "recaptcha",
  "challenges.cloudflare.com",
  "/cdn-cgi/",
  "newrelic",
  "nr-data.net",
  "launchdarkly",
  "intercom",
  "branch.io",
  "app.link",
  "tiktok",
  "snapchat",
  "pinterest",
  "bing.com",
  "clarity.ms",
  "/_next/static/",
  "/_next/image",
  "/__nextjs",
  "/favicon",
  "/manifest.json",
  "/sw.js",
  "/workbox",
];

export const STATIC_EXTENSIONS = /\.(js|mjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wasm)(\?|$)/i;

const MFP_API_HEADERS = {
  authorization: "{{session.headers.authorization}}",
  "mfp-client-id": "mfp-main-js",
  "mfp-user-id": "{{session.headers.mfp-user-id}}",
};

const MFP: AppCaptureConfig = {
  slug: "myfitnesspal",
  loginUrl: "https://www.myfitnesspal.com/account/login",
  webOrigin: "https://www.myfitnesspal.com",
  loggedIn: {
    // NextAuth returns {} when signed out and { user, expires, ... } when signed in (checked live 2026-11-15).
    probe: { path: "/api/auth/session", truthyPath: "user" },
    loggedOutPaths: ["/account/login", "/account/create", "/account/forgot-password", "/api/auth/"],
    loggedInPaths: ["/food/diary", "/account/my-goals", "/account/settings", "/reports"],
  },
  playbook: [
    { kind: "visit", path: "/food/diary", label: "Food diary", dwellMs: 4500 },
    { kind: "visit", path: "/account/my-goals", label: "Goals", dwellMs: 3500 },
    { kind: "probe", path: "/api/nutrition?query=banana&page=1", label: "Food search" },
    { kind: "probe", path: "/api/services/diary/nutrient_goals?date={{today}}", label: "Nutrient goals" },
    // The site proxies api.myfitnesspal.com server-side, so the browser never calls it directly. With the
    // bearer minted by the session probe, exercise the same v2 endpoints from the page (CORS allows it
    // without cookies) so the compiler can emit cloud-executable tools.
    { kind: "probe", path: "https://api.myfitnesspal.com/v2/nutrient-goals?date={{today}}", label: "Goals (API)", headers: MFP_API_HEADERS },
    { kind: "probe", path: "https://api.myfitnesspal.com/v2/diary?entry_date={{today}}&types=food_entry&fields%5B%5D=nutritional_contents&fields%5B%5D=food&fields%5B%5D=serving_size&fields%5B%5D=meal_name&fields%5B%5D=servings", label: "Diary (API)", headers: MFP_API_HEADERS },
    { kind: "probe", path: "https://api.myfitnesspal.com/v2/nutrition?q=banana&max_items=5&fields%5B%5D=nutritional_contents&fields%5B%5D=serving_sizes", label: "Food search (API)", headers: MFP_API_HEADERS },
  ],
  sessionProbes: [
    {
      // Legacy endpoint the web app and python-myfitnesspal use to mint an API bearer token from the
      // cookie session. Returns { access_token, refresh_token, user_id, token_type, expires_in }.
      path: "/user/auth_token?refresh=true",
      pick: {
        "headers.authorization": "access_token",
        "headers.mfp-user-id": "user_id",
        "storage.mfp_token_expires_in": "expires_in",
      },
      prefix: { "headers.authorization": "Bearer " },
    },
  ],
  sessionHeaders: ["authorization", "mfp-client-id", "mfp-user-id", "x-csrf-token", "captcha-token", "cookie"],
  storageKeys: ["/user/i", "/token/i", "/session/i", "anon-device-id"],
  cookieNames: ["anon-device-id", "mfp_wm_route", "known_user", "p", "_mfp_session"],
  apiHosts: ["api.myfitnesspal.com", "www.myfitnesspal.com"],
  apiPathHints: ["/api/", "/v2/", "/user/auth_token", "/public/"],
  denylist: [...COMMON_DENYLIST, "/api/auth/csrf", "/api/auth/_log", "/api/flags", "/api/logs"],
  relayPath: "/account/my-goals",
  sensitivePaths: ["/api/auth/callback", "/api/auth/signin", "/account/login", "/password", "/api/idm/"],
};

// ParkMobile: from scripts/re/parkmobile/capture.ts (PARKMOBILE_CAPTURE), verified 2026-11-15.
// Sign-in is Google, Apple or an emailed/texted magic link, so it also takes a pasted link.
const PM_HEADERS = { SourceAppKey: "ParkmobileWeb" };

const PARKMOBILE: AppCaptureConfig = {
  slug: "parkmobile",
  loginUrl: "https://app.parkmobile.io/login",
  webOrigin: "https://app.parkmobile.io",
  loggedIn: {
    // Next.js BFF: 200 { userProfile, userId, ... } when signed in, 401 {"message":"Unauthorized"} when not.
    probe: { path: "/api/user", truthyPath: "userProfile" },
    loggedOutPaths: ["/login", "/register", "/magic-link-sent", "/global/login"],
  },
  playbook: [
    { kind: "visit", path: "/account/zones/active", label: "Active parking", dwellMs: 4000 },
    { kind: "visit", path: "/account/zones/history", label: "Parking history", dwellMs: 4000 },
    { kind: "visit", path: "/account/settings", label: "Vehicles and payment", dwellMs: 4000 },
    { kind: "probe", path: "/api/proxy/parkmobileapi/account/vehicles", label: "Vehicles", headers: PM_HEADERS },
    { kind: "probe", path: "/api/payment-methods", label: "Payment methods", headers: PM_HEADERS },
    { kind: "probe", path: "/api/proxy/parkmobileapi/v2/parking/active", label: "Active sessions", headers: PM_HEADERS },
    { kind: "probe", path: "/api/proxy/parkmobileapi/v2/parking/history?parkingActionType=OnDemand", label: "History", headers: PM_HEADERS },
    { kind: "probe", path: "/api/proxy/parkmobileapi/zones/51103", label: "Zone lookup", headers: PM_HEADERS },
    { kind: "probe", path: "/api/zones/71451103", label: "Zone rules", headers: PM_HEADERS },
  ],
  // The session JWT is an HttpOnly cookie; there is no JS-readable bearer to mint.
  sessionProbes: [],
  sessionHeaders: ["x-xsrf-token", "authorization", "cookie"],
  storageKeys: [],
  // XSRF-TOKEN: double-submit CSRF header for non-GET calls. IS_LOGGED_IN: JS-visible signed-in flag.
  cookieNames: ["XSRF-TOKEN", "IS_LOGGED_IN"],
  apiHosts: ["app.parkmobile.io"],
  apiPathHints: ["/api/"],
  denylist: [
    ...COMMON_DENYLIST,
    "launchdarkly",
    "maps.googleapis.com",
    "maps.gstatic.com",
    "res.cloudinary.com",
    "typekit",
    "fonts.googleapis.com",
    "/api/web-auth/",
    "/api/user/flags",
    "/api/refresh",
    "/api/logout",
  ],
  relayPath: "/account/zones/active",
  sensitivePaths: [
    "/api/login",
    "/api/register",
    "/api/refresh",
    "/api/global/login",
    "/api/global/user",
    "/api/cybersource",
    "/api/payment-methods/card",
    "/api/payment-methods/digital",
    "/api/proxy/parkmobileapi/account/paymentmethod",
    "/api/orders/payment",
    "login_token",
  ],
  magicLink: {
    label: "Paste your sign-in link",
    hint: "Copy the link from ParkMobile's sign-in email or text.",
    pattern: "^https://app\\.parkmobile\\.io/\\S*[?&]login_token=[^&\\s]+",
  },
};

// Duolingo: from scripts/re/duolingo/capture.ts (DUOLINGO_CAPTURE), verified 2026-11-15.
// The API bearer is the JS-readable jwt_token cookie; the backend derives headers.authorization and
// storage.userId from it when the session arrives.
const DUOLINGO: AppCaptureConfig = {
  slug: "duolingo",
  loginUrl: "https://www.duolingo.com/log-in",
  webOrigin: "https://www.duolingo.com",
  loggedIn: {
    // Signed out, /learn redirects client-side to "/" and there is no jwt_token cookie. The sidebar
    // links below render only for a signed-in user.
    loggedOutPaths: ["/log-in", "/login", "/register", "/sign-up", "/signup", "/forgot_password", "/reset_password", "/logout"],
    domSelectors: ['a[href="/leaderboard"]', 'a[href="/quests"]'],
  },
  playbook: [
    { kind: "visit", path: "/learn", label: "Learn", dwellMs: 4500 },
    { kind: "visit", path: "/leaderboard", label: "Leaderboard", dwellMs: 3500 },
    { kind: "visit", path: "/quests", label: "Quests", dwellMs: 3000 },
  ],
  sessionProbes: [],
  sessionHeaders: ["authorization"],
  storageKeys: [],
  // jwt_token: the bearer. logged_out_uuid: equals the numeric user id once signed in.
  cookieNames: ["jwt_token", "logged_out_uuid", "logged_in"],
  apiHosts: ["duolingo.com"],
  apiPathHints: ["/2017-06-30/", "/2023-05-23/", "/v2/mistakes/", "/leaderboards/", "/users/"],
  denylist: [
    ...COMMON_DENYLIST,
    "/api/1/sync/batch",
    "zombie.duolingo.com",
    "excess.duolingo.com",
    "/2023-05-23/config",
    "/subscription-catalog",
    "/shop-items",
    "/family-plan",
    "/avatar-builder-config",
    "/built-avatar-states",
    "/messaging/",
    "/rocks/",
    "/friends/",
    "/kudos",
    "/reactions/",
    "/lottie/",
  ],
  relayPath: "/learn",
  sensitivePaths: ["/login", "/log-in", "/register", "/password", "/users/reset"],
};

export const CAPTURE_APPS: Record<string, AppCaptureConfig> = {
  myfitnesspal: MFP,
  parkmobile: PARKMOBILE,
  duolingo: DUOLINGO,
};

// The URL to load for a pasted sign-in link, or null if it isn't this app's link.
// Takes the first matching URL out of pasted text (people paste whole messages).
export function magicLinkFor(slug: AppSlug, pasted: string): string | null {
  const cfg = CAPTURE_APPS[slug]?.magicLink;
  if (!cfg) return null;
  const re = new RegExp(cfg.pattern);
  for (const candidate of pasted.match(/https?:\/\/[^\s<>"']+/g) ?? []) {
    const url = candidate.replace(/[).,;]+$/, "");
    if (re.test(url)) return url;
  }
  return null;
}

// Fallback for any web app without a hand config: record everything JSON on its origin.
export function captureConfigFor(slug: AppSlug, loginUrl?: string, webOrigin?: string): AppCaptureConfig {
  const known = CAPTURE_APPS[slug];
  if (known) {
    return {
      ...known,
      loginUrl: loginUrl || known.loginUrl,
      webOrigin: webOrigin || known.webOrigin,
    };
  }
  const origin = webOrigin || (loginUrl ? originOf(loginUrl) : "");
  const host = origin.replace(/^https?:\/\//, "");
  return {
    slug,
    loginUrl: loginUrl || origin,
    webOrigin: origin,
    loggedIn: { loggedOutPaths: ["/login", "/signin", "/sign-in", "/account/login", "/auth"] },
    playbook: [{ kind: "visit", path: "/", label: "Home", dwellMs: 4000 }],
    sessionProbes: [],
    sessionHeaders: ["authorization", "x-csrf-token", "x-xsrf-token", "x-api-key", "cookie"],
    storageKeys: ["/token/i", "/auth/i", "/session/i", "/user/i"],
    cookieNames: [],
    apiHosts: host ? [host.split(".").slice(-2).join(".")] : [],
    apiPathHints: ["/api/", "/graphql", "/v1/", "/v2/", "/v3/"],
    denylist: COMMON_DENYLIST,
    relayPath: "/",
    sensitivePaths: ["/login", "/signin", "/password", "/auth"],
  };
}

export function originOf(url: string): string {
  const m = /^(https?:\/\/[^/?#]+)/i.exec(url);
  return m ? m[1].toLowerCase() : "";
}

export function pathOf(url: string): string {
  const m = /^https?:\/\/[^/?#]+([^?#]*)/i.exec(url);
  return m ? m[1] || "/" : url;
}

export function hostOf(url: string): string {
  return originOf(url).replace(/^https?:\/\//, "");
}

export function isNoise(cfg: Pick<AppCaptureConfig, "denylist">, url: string): boolean {
  if (STATIC_EXTENSIONS.test(url.split("#")[0])) return true;
  const u = url.toLowerCase();
  return cfg.denylist.some((d) => u.includes(d.toLowerCase()));
}

export function isApiCall(cfg: Pick<AppCaptureConfig, "apiHosts" | "apiPathHints" | "denylist">, url: string): boolean {
  if (isNoise(cfg, url)) return false;
  const host = hostOf(url);
  const onHost = cfg.apiHosts.some((h) => host === h || host.endsWith("." + h));
  if (!onHost) return false;
  // Dedicated API hosts count wholesale; the main web origin needs a path hint.
  if (/^api\.|\.api\.|^graphql\./.test(host)) return true;
  const p = pathOf(url);
  return cfg.apiPathHints.some((hint) => p.includes(hint));
}
