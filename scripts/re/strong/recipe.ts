// Source of truth for recipes/strong.json. Regenerate: npx tsx scripts/re/strong/recipe.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Recipe } from "../../../src/lib/contract";
import type { ToolExtras } from "../lib/template";

const H = {
  "User-Agent": "Strong Android",
  Accept: "application/json",
  "Content-Type": "application/json",
  "x-client-build": "600013",
  "x-client-platform": "android",
};
const AUTHED = { ...H, Authorization: "Bearer {{login.accessToken}}" };

// One working set per item in `sets`. Cells mirror the app: weight (kg string), reps, empty RPE.
const LOG_BODY =
  `{"id":"{{login.userId}}","strongAnalytics":false,"_embedded":{` +
  `"template":[],"measurement":[],"widget":[],"tag":[],"folder":[],"metric":[],"measuredValue":[],` +
  `"log":[{"id":"{{$uuid}}","logType":"WORKOUT","name":{"custom":"{{name|Workout}}"},` +
  `"isHidden":false,"isArchived":false,"access":"PRIVATE","isGlobal":false,` +
  `"created":"{{$now}}","lastChanged":"{{$now}}","startDate":"{{startDate|$now}}","endDate":"{{endDate|$now}}",` +
  `"_links":{"user":{"href":"/api/users/{{login.userId}}"}},` +
  `"_embedded":{"cellSetGroup":[{{#each exercises}}` +
  `{"id":"{{$uuid}}","isHidden":false,"groupIndex":null,` +
  `"_links":{"measurement":{"href":"/api/users/{{login.userId}}/measurements/{{exerciseId}}"}},` +
  `"cellSets":[{{#each sets}}{"id":"{{$uuid}}","cellSetTag":null,"isCompleted":true,"isHidden":false,"cells":[` +
  `{"id":"{{$uuid}}","cellType":"{{weightCellType|OTHER_WEIGHT}}","value":"{{weightKg}}","isHidden":false},` +
  `{"id":"{{$uuid}}","cellType":"REPS","value":"{{reps}}","isHidden":false},` +
  `{"id":"{{$uuid}}","cellType":"RPE","value":null,"isHidden":false}]}{{/each}}]}` +
  `{{/each}}]}}]}}`;

type Tool = Recipe["tools"][number] & ToolExtras;

const tools: Tool[] = [
  {
    name: "get_recent_workouts",
    title: "Recent workouts",
    description:
      "Most recent Strong workouts, newest first. Each has name, startDate/endDate and cellSetGroup (one per exercise: measurementId plus cellSets of cells; weight cells are kilograms, REPS are reps). Resolve measurementId to a name with search_exercises.",
    kind: "read",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50, default: 5, description: "How many workouts" },
        page: { type: "integer", minimum: 1, default: 1 },
      },
    },
    request: {
      method: "GET",
      urlTemplate: "https://back.strong.app/api/users/{{login.userId}}/logs?limit={{limit|5}}&page={{page|1}}",
      headers: AUTHED,
    },
    extract: "_embedded.log",
    compact: true,
  },
  {
    name: "search_exercises",
    title: "Find exercises",
    description:
      "Search the user's Strong exercise library (built-in and custom) by name. Returns id, name and cellTypeConfigs (the weight cell type to use when logging, e.g. BARBELL_WEIGHT, DUMBBELL_WEIGHT, OTHER_WEIGHT).",
    kind: "read",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Part of the exercise name, e.g. 'bench'" } },
      required: ["query"],
    },
    request: {
      method: "GET",
      urlTemplate: "https://back.strong.app/api/users/{{login.userId}}/measurements?limit=200&page={{$page}}",
      headers: AUTHED,
    },
    extract: "_embedded.measurement",
    pages: 3,
    filterContains: "{{query}}",
    maxItems: 15,
    compact: true,
  },
  {
    name: "get_exercise_history",
    title: "Exercise history",
    description:
      "Recent workouts that include one exercise (by id from search_exercises), newest first, with every set's weight (kg) and reps.",
    kind: "read",
    inputSchema: {
      type: "object",
      properties: {
        exerciseId: { type: "string", description: "Exercise id from search_exercises" },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 5 },
      },
      required: ["exerciseId"],
    },
    request: {
      method: "GET",
      urlTemplate: "https://back.strong.app/api/users/{{login.userId}}/logs?limit=100&page={{$page}}",
      headers: AUTHED,
    },
    extract: "_embedded.log",
    pages: 2,
    filterContains: "{{exerciseId}}",
    maxItems: "{{limit|5}}",
    compact: true,
  },
  {
    name: "log_workout",
    title: "Log workout",
    description:
      "Save a finished workout to Strong. Get exerciseId and weightCellType from search_exercises first. Weights are kilograms (pounds x 0.45359237). Only for exercises whose cellTypeConfigs are weight + REPS + RPE.",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Workout name, e.g. 'Push day'" },
        startDate: { type: "string", description: "ISO time the workout started (default now)" },
        endDate: { type: "string", description: "ISO time it ended (default now)" },
        exercises: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              exerciseId: { type: "string" },
              weightCellType: {
                type: "string",
                enum: ["OTHER_WEIGHT", "BARBELL_WEIGHT", "DUMBBELL_WEIGHT", "WEIGHTED_BODYWEIGHT", "ASSISTED_BODYWEIGHT"],
              },
              sets: {
                type: "array",
                minItems: 1,
                items: {
                  type: "object",
                  properties: { weightKg: { type: "number" }, reps: { type: "integer" } },
                  required: ["weightKg", "reps"],
                },
              },
            },
            required: ["exerciseId", "weightCellType", "sets"],
          },
        },
      },
      required: ["name", "exercises"],
    },
    request: {
      method: "PUT",
      urlTemplate: "https://back.strong.app/api/users/{{login.userId}}",
      headers: AUTHED,
      bodyTemplate: LOG_BODY,
    },
    extract: "",
  },
];

export const strongRecipe: Recipe = {
  appSlug: "strong",
  version: 1,
  status: "verified",
  executor: "cloud",
  baseUrl: "https://back.strong.app",
  auth: {
    type: "login_api",
    sessionKeys: ["credentials.username", "credentials.password", "storage.accessToken", "storage.refreshToken", "storage.userId"],
    loginRequest: {
      method: "POST",
      urlTemplate: "https://back.strong.app/auth/login",
      headers: H,
      bodyTemplate:
        '{"usernameOrEmail":"{{session.credentials.username}}","password":"{{session.credentials.password}}","deviceId":"{{session.storage.deviceId|$uuid}}"}',
    },
    refresh: {
      method: "POST",
      urlTemplate: "https://back.strong.app/auth/login/refresh",
      headers: H,
      bodyTemplate:
        '{"accessToken":"{{login.accessToken}}","refreshToken":"{{login.refreshToken}}","deviceId":"{{session.storage.deviceId|}}"}',
    },
    check: {
      method: "GET",
      urlTemplate: "https://back.strong.app/api/users/{{login.userId}}/logs?limit=1&page=1",
      headers: AUTHED,
    },
  },
  tools,
  playbook: [
    "POST /auth/login with email + password (+ stable deviceId). New devices get 403 MFA_REQUIRED and an emailed 6-digit code",
    "MFA: GET auth.strongapp.com/auth/mfa/<challenge>?redirectUrl=strong://mfa, POST the code form, read token+challenge from the strong:// redirect, POST /auth/mfa/verify",
    "Keep accessToken (JWT, 20 min) + refreshToken; POST /auth/login/refresh rotates both",
    "Reads: GET /api/users/{userId}/logs?limit&page (newest first), GET /api/users/{userId}/measurements?limit&page",
    "Write: PUT /api/users/{userId} with envelope {id, strongAnalytics:false, _embedded:{log:[...]}}; delete = same PUT with isHidden:true on the log and its children",
  ],
  provenance: {
    compiler: "hand",
    compiledAt: Date.now(),
    captureCount: 0,
    notes:
      "Strong v6 backend back.strong.app (ASP.NET, HAL JSON). Confidence high for reads and login (verified live on a real account 2026-11-15), see research/notes/re-phone.md for write verification. " +
      "Login needs an emailed MFA code on every password login, so the executor should keep and rotate tokens (session.storage.accessToken/refreshToken) and only fall back to loginRequest. " +
      "Sources: tolik518/strong-api-workout-sync, crcatala/strong-cli docs/api-inventory.md, jerhinesmith/strong-mcp (write envelope, MFA), live probes. " +
      "The Strong 2.7.11 APK on Revyl talks to the retired Parse backend ws13.strongapp.co/parse (403), so the phone executor cannot log in with it; 6.x is only published as a split bundle. " +
      "Extra tool fields (pages, filterContains, maxItems, compact) are handled by scripts/re/lib/template.ts runTool.",
  },
};

// Live verification 2026-11-15 (scripts/re/strong/run.ts verify --write --cleanup).
const VERIFIED_AT = Date.parse("2026-11-15T22:30:00Z");
const SAMPLES: Record<string, Record<string, unknown>> = {
  get_recent_workouts: { limit: 2 },
  search_exercises: { query: "bench press" },
  get_exercise_history: { exerciseId: "d5ec7625-fa68-49c2-95d4-748cd5205c9a", limit: 2 },
  log_workout: { name: "ycyc test", exercises: [{ exerciseId: "6b6456e0-3725-4a0a-8306-1bd555f4e5b5", weightCellType: "BARBELL_WEIGHT", sets: [{ weightKg: 20, reps: 5 }, { weightKg: 20, reps: 5 }] }] },
};
for (const t of tools) if (SAMPLES[t.name]) t.sample = { args: SAMPLES[t.name], ok: true, at: VERIFIED_AT };

if (require.main === module) {
  const out = join(__dirname, "..", "..", "..", "recipes", "strong.json");
  writeFileSync(out, JSON.stringify(strongRecipe, null, 2) + "\n");
  console.log("wrote", out, strongRecipe.tools.length, "tools");
}
