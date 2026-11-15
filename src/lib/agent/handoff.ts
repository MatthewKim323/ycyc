import { PROMPT_PREFIX, type AgentProvider } from "./provider";

function handoff(id: string, name: string, url: (q: string) => string): AgentProvider {
  return {
    id,
    name,
    kind: "handoff",
    isConnected: () => true,
    connect: async () => {},
    send: async (text) => {
      const prompt = `${PROMPT_PREFIX}${text}`;
      return { type: "handoff", url: url(encodeURIComponent(prompt)), prompt };
    },
  };
}

export const claudeHandoff = handoff("claude", "Claude", (q) => `https://claude.ai/new?q=${q}`);
export const chatgptHandoff = handoff("chatgpt", "ChatGPT", (q) => `https://chatgpt.com/?q=${q}`);
export const grokHandoff = handoff("grok", "Grok", (q) => `https://grok.com/?q=${q}`);

export const HANDOFF_PROVIDERS = [claudeHandoff, chatgptHandoff, grokHandoff];
