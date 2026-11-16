import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Linking } from "react-native";

import { store } from "@/hooks/storage";

// The Agent tab talks to an assistant through one of these. Two kinds:
// - "handoff": no model runs in yuzu. send() returns a URL and the prompt; useAgent copies the
//   prompt and opens the assistant's own app with it prefilled (Claude, ChatGPT, Grok, Perplexity, Gemini, Muse).
// - "inapp": the assistant runs inside yuzu (for example on the person's own plan). send() returns
//   a stream of chunks that the conversation view renders live.
// See docs/agent-page-spec.md, "For Stephen".

export type ActionStatus = "running" | "ok" | "needs_approval" | "error";

/** One thing the assistant did in a connected app, shown as a card with the app's logo. */
export type AgentAction = {
  /** Stable id: a later chunk with the same id updates the card in place. */
  id: string;
  appSlug: string;
  /** Plain words, e.g. "Logged 2 eggs to breakfast". Never a tool name. */
  title: string;
  detail?: string;
  status: ActionStatus;
  /** Backend tool and start time, so the card can settle from the activity/approval receipt. */
  tool?: string;
  at?: number;
};

export type AgentPart =
  | { type: "text"; text: string }
  | { type: "error"; text: string }
  | ({ type: "action" } & AgentAction);

export type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  parts: AgentPart[];
};

/** What an in-app provider streams back. */
export type AgentChunk =
  | { type: "text"; delta: string }
  | ({ type: "action" } & AgentAction)
  | { type: "error"; message: string };

export type AgentHandoff = { type: "handoff"; url: string; prompt: string };
export type AgentStream = { type: "stream"; chunks: AsyncIterable<AgentChunk> };
export type AgentSendResult = AgentHandoff | AgentStream;

/** A saved in-app conversation, plus the rest of a reply that was still running. */
export type AgentRestore = { messages: AgentMessage[]; resume?: AsyncIterable<AgentChunk> };

export type AgentContext = {
  userId: string | null;
  /** The person's live apps, so a provider can scope tools or phrase the prompt. */
  apps: { slug: string; name: string }[];
  /** Earlier turns of the current in-app conversation (empty for handoffs). */
  history: AgentMessage[];
  /** Aborted when the person stops the reply or leaves the conversation. */
  signal: AbortSignal;
};

export interface AgentProvider {
  id: string;
  /** Shown in the picker and the composer line: "Claude", "ChatGPT". */
  name: string;
  kind: "handoff" | "inapp";
  /** Handoff providers are always connected. In-app providers report their own sign-in state. */
  isConnected(): boolean;
  /** Start the provider's sign-in (in-app only). Call notifyProvidersChanged() when it resolves. */
  connect(): Promise<void>;
  send(text: string, ctx: AgentContext): Promise<AgentSendResult>;
  /** In-app only: load the last conversation when the provider becomes active. */
  restore?(signal: AbortSignal): Promise<AgentRestore | null>;
  /** In-app only: "New chat" drops the saved thread. */
  resetThread?(): void;
}

// Registry: a tiny external store so registering or connecting a provider re-renders the tab.
const providers = new Map<string, AgentProvider>();
const listeners = new Set<() => void>();
let snapshot: AgentProvider[] = [];

function emit() {
  snapshot = [...providers.values()];
  listeners.forEach((l) => l());
}

export function registerProvider(provider: AgentProvider): () => void {
  providers.set(provider.id, provider);
  emit();
  return () => unregisterProvider(provider.id);
}

export function unregisterProvider(id: string) {
  if (providers.delete(id)) emit();
}

/** Call after a provider's connection state changes so pickers refresh. */
export function notifyProvidersChanged() {
  emit();
}

export function listProviders(): AgentProvider[] {
  return snapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useProviders(): AgentProvider[] {
  return useSyncExternalStore(subscribe, listProviders, listProviders);
}

export const PROMPT_PREFIX = "Use my yuzu tools: ";
const PICK_KEY = "yuzu.agentProvider";

/** Remember the picked assistant across launches (also used by onboarding). */
export function rememberPick(id: string) {
  store.set(PICK_KEY, id).catch(() => {});
}

let seq = 0;
const nextId = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

function applyChunk(msg: AgentMessage, chunk: AgentChunk): AgentMessage {
  const parts = [...msg.parts];
  if (chunk.type === "text") {
    const last = parts[parts.length - 1];
    if (last?.type === "text") parts[parts.length - 1] = { type: "text", text: last.text + chunk.delta };
    else parts.push({ type: "text", text: chunk.delta });
  } else if (chunk.type === "action") {
    const i = parts.findIndex((p) => p.type === "action" && p.id === chunk.id);
    if (i >= 0) parts[i] = chunk;
    else parts.push(chunk);
  } else {
    parts.push({ type: "error", text: chunk.message });
  }
  return { ...msg, parts };
}

export type AgentStatus = "idle" | "sending" | "streaming";

/**
 * Everything the Agent tab needs: the provider list, the picked provider (remembered across
 * launches), the in-app conversation and send().
 */
export function useAgent(ctx: { userId: string | null; apps: { slug: string; name: string }[] }) {
  const all = useProviders();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [lastHandoffAt, setLastHandoffAt] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const { userId, apps } = ctx;

  useEffect(() => {
    store
      .get(PICK_KEY)
      .then((v) => v && setPickedId(v))
      .catch(() => {});
    return () => abort.current?.abort();
  }, []);

  // An in-app provider that isn't signed in can't be the active one.
  // A connected plan beats a handoff when nothing was picked.
  const usable = all.filter((p) => p.kind === "handoff" || p.isConnected());
  const provider =
    usable.find((p) => p.id === pickedId) ?? usable.find((p) => p.kind === "inapp") ?? usable[0] ?? null;
  const providerId = provider?.id ?? null;

  const select = useCallback((id: string) => {
    setPickedId(id);
    rememberPick(id);
  }, []);

  // Stream chunks into one assistant message until the reply ends or is stopped.
  const pump = useCallback(async (replyId: string, chunks: AsyncIterable<AgentChunk>, controller: AbortController) => {
    setStatus("streaming");
    for await (const chunk of chunks) {
      if (controller.signal.aborted) break;
      setMessages((m) => m.map((msg) => (msg.id === replyId ? applyChunk(msg, chunk) : msg)));
    }
  }, []);

  // Switching assistants starts clean; an in-app plan brings back its last conversation.
  const [shownFor, setShownFor] = useState(providerId);
  if (shownFor !== providerId) {
    setShownFor(providerId);
    setMessages([]);
    setStatus("idle");
  }
  useEffect(() => {
    abort.current?.abort();
    abort.current = null;
    const p = providerId ? listProviders().find((x) => x.id === providerId) : undefined;
    if (!p?.restore || !p.isConnected()) return;
    const controller = new AbortController();
    let live = true;
    p.restore(controller.signal)
      .then(async (saved) => {
        if (!live || !saved) return;
        setMessages(saved.messages);
        const last = saved.messages[saved.messages.length - 1];
        if (saved.resume && last?.role === "assistant") {
          abort.current = controller;
          try {
            await pump(last.id, saved.resume, controller);
          } finally {
            if (abort.current === controller) abort.current = null;
            setStatus("idle");
          }
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [providerId, pump]);

  const send = useCallback(
    async (raw: string): Promise<AgentSendResult | null> => {
      const text = raw.trim();
      if (!text || !provider || status !== "idle") return null;
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setStatus("sending");
      try {
        const result = await provider.send(text, { userId, apps, history: messages, signal: controller.signal });
        if (result.type === "handoff") {
          // Copy first: if the assistant drops the prefill, the prompt is one paste away.
          await Clipboard.setStringAsync(result.prompt).catch(() => {});
          setLastHandoffAt(Date.now());
          await Linking.openURL(result.url);
          return result;
        }
        const user: AgentMessage = { id: nextId("u"), role: "user", parts: [{ type: "text", text }] };
        const reply: AgentMessage = { id: nextId("a"), role: "assistant", parts: [] };
        setMessages((m) => [...m, user, reply]);
        await pump(reply.id, result.chunks, controller);
        return result;
      } finally {
        if (abort.current === controller) abort.current = null;
        setStatus("idle");
      }
    },
    [provider, status, userId, apps, messages, pump],
  );

  const stop = useCallback(() => abort.current?.abort(), []);
  const reset = useCallback(() => {
    abort.current?.abort();
    provider?.resetThread?.();
    setMessages([]);
  }, [provider]);

  return {
    providers: all,
    provider,
    select,
    send,
    stop,
    reset,
    messages,
    status,
    lastHandoffAt,
    /** Show "Connect your plan" rows only when an in-app provider exists. */
    hasInApp: all.some((p) => p.kind === "inapp"),
  };
}
