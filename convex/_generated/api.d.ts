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
import type * as aiChat from "../aiChat.js";
import type * as aiChatActions from "../aiChatActions.js";
import type * as aiChatApprovals from "../aiChatApprovals.js";
import type * as aiOnboarding from "../aiOnboarding.js";
import type * as aiProviders from "../aiProviders.js";
import type * as appLearning from "../appLearning.js";
import type * as appLearningWrites from "../appLearningWrites.js";
import type * as approvalRunner from "../approvalRunner.js";
import type * as approvals from "../approvals.js";
import type * as apps from "../apps.js";
import type * as authNode from "../authNode.js";
import type * as builds from "../builds.js";
import type * as calls from "../calls.js";
import type * as catalog from "../catalog.js";
import type * as connections from "../connections.js";
import type * as crons from "../crons.js";
import type * as executor from "../executor.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as learningResearch from "../learningResearch.js";
import type * as lib_appResolver from "../lib/appResolver.js";
import type * as lib_compilerShim from "../lib/compilerShim.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_fallbackCompiler from "../lib/fallbackCompiler.js";
import type * as lib_handRecipes from "../lib/handRecipes.js";
import type * as lib_learnedWritePolicy from "../lib/learnedWritePolicy.js";
import type * as lib_learningHttp from "../lib/learningHttp.js";
import type * as lib_learningPolicy from "../lib/learningPolicy.js";
import type * as lib_mcp from "../lib/mcp.js";
import type * as lib_nativeProvider from "../lib/nativeProvider.js";
import type * as lib_providerCli from "../lib/providerCli.js";
import type * as lib_providerErrors from "../lib/providerErrors.js";
import type * as lib_providerEvents from "../lib/providerEvents.js";
import type * as lib_providerTurn from "../lib/providerTurn.js";
import type * as lib_providerVault from "../lib/providerVault.js";
import type * as lib_publicToolData from "../lib/publicToolData.js";
import type * as lib_recipeOverrides from "../lib/recipeOverrides.js";
import type * as lib_recipeStore from "../lib/recipeStore.js";
import type * as lib_render from "../lib/render.js";
import type * as lib_sanitize from "../lib/sanitize.js";
import type * as lib_sessionDerive from "../lib/sessionDerive.js";
import type * as lib_summaries from "../lib/summaries.js";
import type * as lib_templateShim from "../lib/templateShim.js";
import type * as lib_turnStream from "../lib/turnStream.js";
import type * as lib_webhook from "../lib/webhook.js";
import type * as mcpData from "../mcpData.js";
import type * as pipeline from "../pipeline.js";
import type * as profile from "../profile.js";
import type * as providerActions from "../providerActions.js";
import type * as providerProbe from "../providerProbe.js";
import type * as recipes from "../recipes.js";
import type * as revyl from "../revyl.js";
import type * as today from "../today.js";
import type * as users from "../users.js";
import type * as whop from "../whop.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  aiChat: typeof aiChat;
  aiChatActions: typeof aiChatActions;
  aiChatApprovals: typeof aiChatApprovals;
  aiOnboarding: typeof aiOnboarding;
  aiProviders: typeof aiProviders;
  appLearning: typeof appLearning;
  appLearningWrites: typeof appLearningWrites;
  approvalRunner: typeof approvalRunner;
  approvals: typeof approvals;
  apps: typeof apps;
  authNode: typeof authNode;
  builds: typeof builds;
  calls: typeof calls;
  catalog: typeof catalog;
  connections: typeof connections;
  crons: typeof crons;
  executor: typeof executor;
  health: typeof health;
  http: typeof http;
  learningResearch: typeof learningResearch;
  "lib/appResolver": typeof lib_appResolver;
  "lib/compilerShim": typeof lib_compilerShim;
  "lib/env": typeof lib_env;
  "lib/fallbackCompiler": typeof lib_fallbackCompiler;
  "lib/handRecipes": typeof lib_handRecipes;
  "lib/learnedWritePolicy": typeof lib_learnedWritePolicy;
  "lib/learningHttp": typeof lib_learningHttp;
  "lib/learningPolicy": typeof lib_learningPolicy;
  "lib/mcp": typeof lib_mcp;
  "lib/nativeProvider": typeof lib_nativeProvider;
  "lib/providerCli": typeof lib_providerCli;
  "lib/providerErrors": typeof lib_providerErrors;
  "lib/providerEvents": typeof lib_providerEvents;
  "lib/providerTurn": typeof lib_providerTurn;
  "lib/providerVault": typeof lib_providerVault;
  "lib/publicToolData": typeof lib_publicToolData;
  "lib/recipeOverrides": typeof lib_recipeOverrides;
  "lib/recipeStore": typeof lib_recipeStore;
  "lib/render": typeof lib_render;
  "lib/sanitize": typeof lib_sanitize;
  "lib/sessionDerive": typeof lib_sessionDerive;
  "lib/summaries": typeof lib_summaries;
  "lib/templateShim": typeof lib_templateShim;
  "lib/turnStream": typeof lib_turnStream;
  "lib/webhook": typeof lib_webhook;
  mcpData: typeof mcpData;
  pipeline: typeof pipeline;
  profile: typeof profile;
  providerActions: typeof providerActions;
  providerProbe: typeof providerProbe;
  recipes: typeof recipes;
  revyl: typeof revyl;
  today: typeof today;
  users: typeof users;
  whop: typeof whop;
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
