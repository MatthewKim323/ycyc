import { useEffect, useState } from "react";

import type { Assistant } from "@/lib/contract";

const ASSISTANTS: Record<string, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  grok: "Grok",
  muse: "Muse",
  keiki: "Keiki",
  ycyc: "ycyc",
};

export function assistantName(a: Assistant | string): string {
  return ASSISTANTS[a] ?? a;
}

export function timeAgo(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

/** A clock that ticks every 30 s so relative times stay fresh. */
export function useNow(intervalMs = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function hostOf(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "");
  }
}
