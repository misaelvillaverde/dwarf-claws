import type { UnifiedSession, UnifiedMessage } from "./types";
import { customNameFor } from "./customNames";

export interface PendingToolCall {
  id: string;
  name: string;
  ts: number;
}

/// Single-pass walk; return tool_call blocks whose id has no matching tool_result.
/// Map preserves insertion order. If a tool_use is inserted then deleted by a
/// tool_result and later re-inserted by an out-of-order tool_use, the re-insertion
/// goes to the end of the iteration order. Acceptable.
export function computePendingTools(messages: UnifiedMessage[]): PendingToolCall[] {
  const pendingMap = new Map<string, PendingToolCall>();
  for (const m of messages) {
    for (const b of m.content) {
      if (b.type === "tool_call") {
        const tsRaw = m.timestamp ? Date.parse(m.timestamp) : 0;
        const ts = isNaN(tsRaw) ? 0 : tsRaw;
        pendingMap.set(b.tool_id, { id: b.tool_id, name: b.tool_name, ts });
      } else if (b.type === "tool_result") {
        pendingMap.delete(b.tool_id);
      }
    }
  }
  return [...pendingMap.values()];
}

export const THIRTY_MIN = 30 * 60 * 1000;

export type ChatState = "waiting" | "working" | "idle";

export function chatState(session: UnifiedSession, nowMs: number = Date.now()): ChatState {
  const ts = session.updated_at ?? 0;
  const age = nowMs - ts;
  if (age >= THIRTY_MIN) return "idle";
  return session.last_message_role === "assistant" ? "waiting" : "working";
}

export function projectName(p: string | null | undefined): string {
  if (!p) return "COMMONS";
  const parts = p.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] || "UNKNOWN";
}

export function sessionName(s: UnifiedSession): string {
  return (
    customNameFor(s.id) ||
    s.display_name ||
    s.slug ||
    s.first_user_message_preview ||
    s.id.slice(0, 8)
  );
}

export function projectFullPath(s: UnifiedSession): string {
  return s.cwd || s.project_path || "(no path)";
}

/// Returns a 0..1 fraction indicating how full the model context is.
/// Prefers token usage from the JSONL when present; falls back to char-count approximation.
export const CONTEXT_TOKEN_LIMIT = 200_000;
export const CONTEXT_CHAR_LIMIT = 800_000; // ~ 200k tokens at 4 chars/token

export function contextUsage(s: UnifiedSession): { pct: number; label: string; source: "tokens" | "chars" } {
  if (s.context_tokens && s.context_tokens > 0) {
    const pct = Math.min(1, s.context_tokens / CONTEXT_TOKEN_LIMIT);
    return { pct, label: `${(s.context_tokens / 1000).toFixed(1)}k tok`, source: "tokens" };
  }
  if (s.context_chars && s.context_chars > 0) {
    const pct = Math.min(1, s.context_chars / CONTEXT_CHAR_LIMIT);
    const kb = s.context_chars / 1024;
    const label = kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
    return { pct, label: `~${label}`, source: "chars" };
  }
  return { pct: 0, label: "—", source: "chars" };
}

export function timeSince(ms: number | null, nowMs: number = Date.now()): string {
  if (ms === null) return "—";
  const ago = nowMs - ms;
  if (ago < 60_000) return "<1m";
  if (ago < 3_600_000) return `${Math.floor(ago / 60_000)}m`;
  if (ago < 86_400_000) return `${Math.floor(ago / 3_600_000)}h`;
  return `${Math.floor(ago / 86_400_000)}d`;
}
