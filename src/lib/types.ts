export type SessionSource = "ClaudeCode";

export interface PendingToolUse {
  tool_name: string;
  tool_use_id: string;
  age_ms: number;
}

export interface UnifiedSession {
  id: string;
  source: SessionSource;
  timestamp: string | null;
  updated_at: number | null;
  cwd: string | null;
  model: string | null;
  chat_type: string | null;
  channel: string | null;
  display_name: string | null;
  project_path: string | null;
  message_count: number;
  slug: string | null;
  first_user_message_preview: string | null;
  last_message_role: string | null;
  jsonl_path: string | null;
  tmux_pane: string | null;
  context_tokens: number | null;
  context_chars: number | null;
  pending_tool_use: PendingToolUse | null;
  pane_source: PaneSource | null;
}

export type PaneSource = "resume_id" | "scrollback" | "jsonl" | "active_cwd" | "cwd" | "manual" | "none";

export type MessageRole = "User" | "Assistant" | "ToolResult";

export interface UnifiedMessage {
  id: string;
  role: MessageRole;
  content: ContentBlock[];
  timestamp: string | null;
  model: string | null;
  /** Frontend-only: true while the message is being delivered to tmux but
   *  not yet confirmed in the JSONL. Never set by Rust. */
  _optimistic?: boolean;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; tool_name: string; tool_id: string; input: string }
  | { type: "tool_result"; tool_id: string; output: string; is_error: boolean };

export interface CcOption {
  number: number;
  label: string;
  description: string | null;
  is_freetext: boolean;
}

export interface CcQuestion {
  prompt: string;
  options: CcOption[];
}

export interface ToolStat {
  tool_name: string;
  call_count: number;
  error_count: number;
}

export interface PinnedSession {
  session_id: string;
  source: SessionSource;
  pinned_at: number;
}
