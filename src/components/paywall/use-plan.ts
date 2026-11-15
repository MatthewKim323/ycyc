import { useQuery } from "convex/react";

import { api } from "@/hooks/convex";
import { useUser } from "@/hooks/user";

/** The signed-in user's plan, live from Convex. plan is null while it loads. */
export function usePlan() {
  const { userId } = useUser();
  const user = useQuery(api.users.get, userId ? { userId } : "skip");
  const plan = user?.plan ?? null;
  return { userId, plan, isPro: plan === "pro", loading: user === undefined };
}
