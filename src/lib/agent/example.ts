import { notifyProvidersChanged, type AgentChunk, type AgentProvider } from "./provider";

// Local stand-in for an in-app provider. Registered only when AGENT_FLAGS.exampleConversation is
// on in a dev build (see ./index.ts). It shows the exact chunk shapes a real provider streams.

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });

async function* reply(text: string, appSlug: string, signal: AbortSignal): AsyncGenerator<AgentChunk> {
  yield { type: "action", id: "a1", appSlug, title: "Checking your diary", status: "running" };
  await wait(700, signal);
  yield { type: "action", id: "a1", appSlug, title: "Read today's diary", detail: "1,240 of 2,100 cal", status: "ok" };
  await wait(300, signal);
  for (const word of `You asked: "${text}". `.split(/(?<= )/)) {
    yield { type: "text", delta: word };
    await wait(35, signal);
  }
  yield { type: "action", id: "a2", appSlug, title: "Log 2 eggs to breakfast", detail: "140 cal", status: "needs_approval" };
  await wait(900, signal);
  yield { type: "action", id: "a2", appSlug, title: "Logged 2 eggs to breakfast", detail: "140 cal", status: "ok" };
  for (const word of "Done. You have 720 calories left today.".split(/(?<= )/)) {
    yield { type: "text", delta: word };
    await wait(35, signal);
  }
}

let connected = false;

export const exampleProvider: AgentProvider = {
  id: "example",
  name: "Example",
  kind: "inapp",
  isConnected: () => connected,
  connect: async () => {
    connected = true;
    notifyProvidersChanged();
  },
  send: async (text, ctx) => ({
    type: "stream",
    chunks: reply(text, ctx.apps[0]?.slug ?? "myfitnesspal", ctx.signal),
  }),
};
