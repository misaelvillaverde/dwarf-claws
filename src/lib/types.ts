export type SessionSource = "OpenClaw" | "ClaudeCode";

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
}

export type MessageRole = "User" | "Assistant" | "ToolResult";

export interface UnifiedMessage {
  id: string;
  role: MessageRole;
  content: ContentBlock[];
  timestamp: string | null;
  model: string | null;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; tool_name: string; tool_id: string; input: string }
  | { type: "tool_result"; tool_id: string; output: string; is_error: boolean };
