import { PROMPT_PREFIX, type AgentProvider } from "./provider";

type Spec = {
  id: string;
  name: string;
  /** Builds the URL from the encoded prompt. */
  url: (q: string) => string;
  /** False when the assistant ignores a prefilled message: the prompt is copied and the app opens. */
  prefill: boolean;
};

// Gemini and Muse have no prefill parameter. Their URLs are universal links, so they open the
// app when it's installed; the prompt is already on the clipboard (useAgent copies first).
const SPECS: Spec[] = [
  { id: "claude", name: "Claude", url: (q) => `https://claude.ai/new?q=${q}`, prefill: true },
  { id: "chatgpt", name: "ChatGPT", url: (q) => `https://chatgpt.com/?q=${q}`, prefill: true },
  { id: "grok", name: "Grok", url: (q) => `https://grok.com/?q=${q}`, prefill: true },
  { id: "perplexity", name: "Perplexity", url: (q) => `https://www.perplexity.ai/search?q=${q}`, prefill: true },
  { id: "gemini", name: "Gemini", url: () => "https://gemini.google.com/app", prefill: false },
  { id: "muse", name: "Muse", url: () => "https://muse.ai/chat", prefill: false },
];

const byId = new Map(SPECS.map((s) => [s.id, s]));

/** The URL that opens an assistant app with this prompt (prefilled where the app supports it). */
export function handoffUrl(id: string, prompt: string): string | null {
  const spec = byId.get(id);
  return spec ? spec.url(encodeURIComponent(prompt)) : null;
}

/** Whether the assistant opens with the message already typed in. */
export function takesPrefill(id: string): boolean {
  return byId.get(id)?.prefill ?? false;
}

function handoff(spec: Spec): AgentProvider {
  return {
    id: spec.id,
    name: spec.name,
    kind: "handoff",
    isConnected: () => true,
    connect: async () => {},
    send: async (text) => {
      const prompt = `${PROMPT_PREFIX}${text}`;
      return { type: "handoff", url: spec.url(encodeURIComponent(prompt)), prompt };
    },
  };
}

export const HANDOFF_PROVIDERS = SPECS.map(handoff);
