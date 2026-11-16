import type { NativeProvider } from "./nativeProvider";

export type ProviderEvent = {
  type: "text_delta" | "tool_start" | "tool_end";
  text?: string;
  name?: string;
  id?: string;
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const safeId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
const safeTool = (value: unknown): value is string => typeof value === "string" && /^mcp__yuzu__[A-Za-z0-9_-]{1,160}$/.test(value);

// Only allowlisted user-facing text and tool identities leave this parser.
// Thinking, arguments, tool results, stderr, account metadata and raw errors do
// not become UI events. An observed unexpected capability is a hard failure.
export class ProviderEvents {
  private decoder = new TextDecoder("utf-8", { fatal: true });
  private pending = "";
  private bytes = 0;
  private visible = 0;
  private count = 0;
  private succeeded = false;
  private manifest = false;
  private messageText = "";
  private anyText = false;
  private finalText = "";
  private tools = new Map<string, string>();
  private completedTools = new Set<string>();
  private codexText = new Map<string, string>();

  constructor(private provider: NativeProvider, private protocol?: (value: Record<string, unknown>) => void) {}

  get completed(): boolean { return this.succeeded; }

  push(chunk: Uint8Array): ProviderEvent[] {
    this.bytes += chunk.byteLength;
    if (this.bytes > 2_000_000) throw new Error("provider_output_limit");
    try { this.pending += this.decoder.decode(chunk, { stream: true }); } catch { throw new Error("provider_invalid_event"); }
    const events: ProviderEvent[] = [];
    let newline: number;
    while ((newline = this.pending.indexOf("\n")) >= 0) {
      const line = this.pending.slice(0, newline).trim();
      this.pending = this.pending.slice(newline + 1);
      if (line.length > 256_000) throw new Error("provider_output_limit");
      if (line) events.push(...this.line(line));
    }
    if (this.pending.length > 256_000) throw new Error("provider_output_limit");
    return events;
  }

  finish(): ProviderEvent[] {
    try { this.pending += this.decoder.decode(); } catch { throw new Error("provider_invalid_event"); }
    const events = this.pending.trim() ? this.line(this.pending.trim()) : [];
    this.pending = "";
    if (!this.succeeded) throw new Error("provider_turn_incomplete");
    if (this.provider === "claude" && !this.manifest) throw new Error("provider_tool_manifest_missing");
    if (!this.anyText && this.finalText) events.push(...this.text(this.finalText));
    return events;
  }

  private text(text: string): ProviderEvent[] {
    if (!text) return [];
    this.visible += text.length;
    if (this.visible > 80_000 || ++this.count > 2_000) throw new Error("provider_output_limit");
    this.anyText = true;
    return [{ type: "text_delta", text }];
  }

  private start(id: unknown, name: unknown): ProviderEvent[] {
    if (!safeId(id) || !safeTool(name)) throw new Error("provider_disallowed_tool");
    if (this.tools.has(id)) return [];
    if (this.tools.size >= 24 || ++this.count > 2_000) throw new Error("provider_output_limit");
    this.tools.set(id, name);
    return [{ type: "tool_start", id, name }];
  }

  private end(id: unknown): ProviderEvent[] {
    if (!safeId(id) || !this.tools.has(id) || this.completedTools.has(id)) return [];
    this.completedTools.add(id);
    return [{ type: "tool_end", id, name: this.tools.get(id)! }];
  }

  private line(line: string): ProviderEvent[] {
    let value: unknown;
    try { value = JSON.parse(line); } catch { throw new Error("provider_invalid_event"); }
    if (!record(value)) throw new Error("provider_invalid_event");
    this.protocol?.(value);
    return this.provider === "claude" ? this.claude(value) : this.codex(value);
  }

  private claude(value: Record<string, unknown>): ProviderEvent[] {
    if (value.parent_tool_use_id) return []; // No subagent text is part of this conversation.
    if (value.error === "authentication_failed") throw new Error("provider_authentication_failed");
    if (value.type === "system" && value.subtype === "init") {
      if (!Array.isArray(value.tools) || value.tools.some((name) => name !== "EndConversation" && !safeTool(name))) {
        throw new Error("provider_disallowed_tool");
      }
      if (Array.isArray(value.mcp_servers) && value.mcp_servers.some((server) => !record(server) || server.name !== "yuzu")) {
        throw new Error("provider_disallowed_tool");
      }
      this.manifest = true;
      return [];
    }
    if (["stream_event", "assistant", "user", "result"].includes(String(value.type)) && !this.manifest) {
      throw new Error("provider_tool_manifest_missing");
    }
    if (value.type === "stream_event" && record(value.event)) {
      const event = value.event;
      if (event.type === "message_start") this.messageText = "";
      if (event.type === "content_block_delta" && record(event.delta) && event.delta.type === "text_delta" && typeof event.delta.text === "string") {
        this.messageText += event.delta.text;
        return this.text(event.delta.text);
      }
      if (event.type === "content_block_start" && record(event.content_block) && event.content_block.type === "tool_use") {
        if (event.content_block.name === "EndConversation") return [];
        return this.start(event.content_block.id, event.content_block.name);
      }
      if (event.type === "content_block_start" && record(event.content_block) && event.content_block.type === "text" && typeof event.content_block.text === "string") {
        this.messageText += event.content_block.text;
        return this.text(event.content_block.text);
      }
      return [];
    }
    if ((value.type === "assistant" || value.type === "user") && record(value.message) && Array.isArray(value.message.content)) {
      if (value.error === "authentication_failed") throw new Error("provider_authentication_failed");
      const events: ProviderEvent[] = [];
      let text = "";
      for (const block of value.message.content) {
        if (!record(block)) continue;
        if (value.type === "assistant" && block.type === "text" && typeof block.text === "string") text += block.text;
        if (block.type === "tool_use" && block.name !== "EndConversation") events.push(...this.start(block.id, block.name));
        if (block.type === "tool_result") events.push(...this.end(block.tool_use_id));
      }
      if (text && !this.messageText) events.push(...this.text(text));
      else if (text.startsWith(this.messageText)) events.push(...this.text(text.slice(this.messageText.length)));
      if (text) this.messageText = text;
      return events;
    }
    if (value.type === "result") {
      if (value.subtype !== "success" || value.is_error === true || (Array.isArray(value.permission_denials) && value.permission_denials.length)) {
        throw new Error("provider_turn_failed");
      }
      this.succeeded = true;
      if (typeof value.result === "string") this.finalText = value.result;
    }
    return [];
  }

  private codex(value: Record<string, unknown>): ProviderEvent[] {
    // App-server is required for real deltas: exec --json only publishes the
    // completed message. Protocol replies and private metadata never reach UI.
    const method = value.method;
    const params = record(value.params) ? value.params : {};
    if (method === "error") throw new Error("provider_turn_failed");
    if (method === "turn/completed") {
      if (!record(params.turn) || params.turn.status !== "completed" || params.turn.error) throw new Error("provider_turn_failed");
      this.succeeded = true;
      return [];
    }
    if (method === "item/agentMessage/delta") {
      if (!safeId(params.itemId) || typeof params.delta !== "string") throw new Error("provider_invalid_event");
      this.codexText.set(params.itemId, (this.codexText.get(params.itemId) ?? "") + params.delta);
      return this.text(params.delta);
    }
    if (method !== "item/started" && method !== "item/completed") return [];
    const completed = method === "item/completed";
    const item = params.item;
    if (!record(item)) throw new Error("provider_invalid_event");
    if (["reasoning", "userMessage", "contextCompaction"].includes(String(item.type))) return [];
    if (item.type === "agentMessage" && safeId(item.id) && typeof item.text === "string") {
      const previous = this.codexText.get(item.id) ?? "";
      if (!item.text.startsWith(previous)) throw new Error("provider_invalid_event");
      this.codexText.set(item.id, item.text);
      return this.text(item.text.slice(previous.length));
    }
    if (item.type === "mcpToolCall" && item.server === "yuzu" && typeof item.tool === "string") {
      const events = this.start(item.id, `mcp__yuzu__${item.tool}`);
      if (completed) events.push(...this.end(item.id));
      return events;
    }
    // Native resource wrappers can only access the sole configured Yuzu server.
    // They carry no visible content: resource arguments/results stay private.
    if (item.type === "functionCallOutput" && ["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"].includes(String(item.name)) && (item.namespace == null || item.namespace === "functions")) return [];
    throw new Error("provider_disallowed_tool");
  }
}
