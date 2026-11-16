import type { ConvexReactClient } from "convex/react";
import type { FunctionReturnType } from "convex/server";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { AgentChunk } from "./provider";

type Client = Pick<ConvexReactClient, "query" | "watchQuery" | "mutation">;
type ChatEvent = FunctionReturnType<typeof api.aiChat.events>["events"][number];
type Turn = FunctionReturnType<typeof api.aiChat.watchMessages>["turns"][number];
export const TERMINAL = new Set(["completed", "error", "cancelled"]);

// Cards are optional history. Never consume beyond the cursor captured atomically
// with restored assistantText: later text still belongs to the resumed stream.
export async function snapshotEvents(client: Client, token: string, threadId: Id<"aiThreads">, cursor: number) {
  const events: ChatEvent[] = [];
  let after = 0;
  for (let pageNumber = 0; pageNumber < 10 && after < cursor; pageNumber++) {
    const page = await client.query(api.aiChat.events, { token, threadId, afterSeq: after, limit: 200 });
    for (const event of page.events) {
      if (event.seq > cursor) return events;
      events.push(event);
      after = event.seq;
    }
    if (!page.hasMore || !page.events.length) break;
  }
  return events;
}

/** Stream durable turn events; query failures end safely and release listeners. */
export async function* streamTurnUpdates(o: {
  client: Client; token: string; threadId: Id<"aiThreads">; turnId: Id<"aiTurns">;
  cursor: number; signal: AbortSignal;
  chunk: (event: ChatEvent) => AgentChunk | null;
  error: (code?: string) => string;
  saveCursor: (cursor: number) => void;
}): AsyncGenerator<AgentChunk> {
  const { client, token, threadId, turnId, signal } = o;
  const queue: AgentChunk[] = [];
  let wake: (() => void) | null = null;
  let done = false, draining = false, last = o.cursor;
  let stopEvents: (() => void) | null = null, stopTurn: (() => void) | null = null;
  let resub: ReturnType<typeof setTimeout> | null = null;
  const poke = () => wake?.();
  const cancel = () => { void client.mutation(api.aiChat.cancelTurn, { token, turnId }).catch(() => {}); };
  const fail = () => {
    if (done) return;
    queue.push({ type: "error", message: o.error("turn_failed") });
    done = true; cancel(); poke();
  };
  const take = (events: ChatEvent[]) => {
    if (done) return;
    for (const event of events) {
      if (event.seq <= last) continue;
      last = event.seq;
      if (event.turnId !== turnId) continue;
      const chunk = o.chunk(event);
      if (chunk) queue.push(chunk);
    }
    poke();
  };
  const subscribe = () => {
    if (done) return;
    stopEvents?.();
    const after = last;
    const watch = client.watchQuery(api.aiChat.events, { token, threadId, afterSeq: after, limit: 200 });
    const read = () => {
      if (done) return;
      try {
        const page = watch.localQueryResult();
        if (!page) return;
        take(page.events);
        if ((page.hasMore || page.events.length >= 120) && last > after && !resub) {
          resub = setTimeout(() => { resub = null; try { subscribe(); } catch { fail(); } }, 0);
        }
      } catch { fail(); }
    };
    stopEvents = watch.onUpdate(read);
    read();
  };
  const finish = async (turn: Turn) => {
    if (draining || done) return;
    draining = true;
    try {
      for (let pageNumber = 0; pageNumber < 20 && !done; pageNumber++) {
        const page = await client.query(api.aiChat.events, { token, threadId, afterSeq: last, limit: 200 });
        take(page.events);
        if (!page.hasMore) break;
      }
    } catch { fail(); return; }
    if (done) return;
    if (turn.status === "error") queue.push({ type: "error", message: o.error(turn.error) });
    done = true; poke();
  };
  const onAbort = () => { cancel(); done = true; poke(); };
  signal.addEventListener("abort", onAbort);
  if (signal.aborted) onAbort();
  try {
    if (!done) {
      const watch = client.watchQuery(api.aiChat.watchMessages, { token, threadId, limit: 5 });
      const check = () => {
        if (done) return;
        try {
          const turn = watch.localQueryResult()?.turns.find((item) => item.turnId === turnId);
          if (turn && TERMINAL.has(turn.status)) void finish(turn);
        } catch { fail(); }
      };
      stopTurn = watch.onUpdate(check);
      subscribe(); check();
    }
    while (true) {
      while (queue.length) yield queue.shift()!;
      if (done || signal.aborted) break;
      await new Promise<void>((resolve) => { wake = resolve; });
      wake = null;
    }
  } catch { fail(); while (queue.length) yield queue.shift()!; }
  finally {
    signal.removeEventListener("abort", onAbort);
    o.saveCursor(last);
    if (resub) clearTimeout(resub);
    (stopEvents as (() => void) | null)?.(); stopTurn?.();
  }
}
