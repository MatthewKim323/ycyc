import type { FunctionReturnType } from "convex/server";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export { api };
export type { Id };

export type CatalogEntry = FunctionReturnType<typeof api.apps.list>[number];
export type MyConnection = FunctionReturnType<typeof api.connections.mine>[number];
export type Activity = FunctionReturnType<typeof api.activity.feed>[number];
export type PendingApproval = FunctionReturnType<typeof api.approvals.pending>[number];
export type BuildState = NonNullable<FunctionReturnType<typeof api.builds.forConnection>>;
