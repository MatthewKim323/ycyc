import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";

import { api } from "@/hooks/convex";
import { useUser } from "@/hooks/user";

export type Me = NonNullable<FunctionReturnType<typeof api.profile.me>>;

// Same args everywhere, so the Today avatar and the profile screen share one subscription
// and the profile opens with its data already in hand.
export const profileTzOffset = new Date().getTimezoneOffset();

export function useMe() {
  const { userId } = useUser();
  const me = useQuery(api.profile.me, userId ? { userId, tzOffset: profileTzOffset } : "skip");
  return { userId, me };
}
