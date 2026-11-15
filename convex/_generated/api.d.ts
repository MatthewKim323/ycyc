/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activity from "../activity.js";
import type * as approvals from "../approvals.js";
import type * as apps from "../apps.js";
import type * as builds from "../builds.js";
import type * as calls from "../calls.js";
import type * as catalog from "../catalog.js";
import type * as connections from "../connections.js";
import type * as executor from "../executor.js";
import type * as http from "../http.js";
import type * as lib_compilerShim from "../lib/compilerShim.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_fallbackCompiler from "../lib/fallbackCompiler.js";
import type * as lib_handRecipes from "../lib/handRecipes.js";
import type * as lib_mcp from "../lib/mcp.js";
import type * as lib_recipeStore from "../lib/recipeStore.js";
import type * as lib_render from "../lib/render.js";
import type * as lib_sanitize from "../lib/sanitize.js";
import type * as lib_templateShim from "../lib/templateShim.js";
import type * as lib_webhook from "../lib/webhook.js";
import type * as mcpData from "../mcpData.js";
import type * as pipeline from "../pipeline.js";
import type * as recipes from "../recipes.js";
import type * as revyl from "../revyl.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  approvals: typeof approvals;
  apps: typeof apps;
  builds: typeof builds;
  calls: typeof calls;
  catalog: typeof catalog;
  connections: typeof connections;
  executor: typeof executor;
  http: typeof http;
  "lib/compilerShim": typeof lib_compilerShim;
  "lib/env": typeof lib_env;
  "lib/fallbackCompiler": typeof lib_fallbackCompiler;
  "lib/handRecipes": typeof lib_handRecipes;
  "lib/mcp": typeof lib_mcp;
  "lib/recipeStore": typeof lib_recipeStore;
  "lib/render": typeof lib_render;
  "lib/sanitize": typeof lib_sanitize;
  "lib/templateShim": typeof lib_templateShim;
  "lib/webhook": typeof lib_webhook;
  mcpData: typeof mcpData;
  pipeline: typeof pipeline;
  recipes: typeof recipes;
  revyl: typeof revyl;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
