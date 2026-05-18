import { invoke } from "@tauri-apps/api/core";
import type { UnifiedSession, UnifiedMessage, ToolStat, CcQuestion } from "./types";

export async function listSessions(): Promise<UnifiedSession[]> {
  return invoke("list_sessions");
}

export async function getSessionMessages(sessionId: string): Promise<UnifiedMessage[]> {
  return invoke("get_session_messages", { sessionId });
}

export async function searchSessions(query: string): Promise<UnifiedSession[]> {
  return invoke("search_sessions", { query });
}

export async function getToolUsage(sessionId: string): Promise<ToolStat[]> {
  return invoke("get_tool_usage", { sessionId });
}

export interface SessionData {
  messages: UnifiedMessage[];
  tool_stats: ToolStat[];
}

export async function getSessionData(sessionId: string): Promise<SessionData> {
  return invoke("get_session_data", { sessionId });
}

export async function getSessionMessagesSince(
  sessionId: string,
  offset: number
): Promise<UnifiedMessage[]> {
  return invoke("get_session_messages_since", { sessionId, offset });
}

export interface MessageSearchResult {
  session_id: string;
  snippet: string;
  role: string;
}

export async function searchMessages(query: string): Promise<MessageSearchResult[]> {
  return invoke("search_messages", { query });
}

export async function sendToTmuxPane(pane: string, text: string): Promise<void> {
  return invoke("send_to_tmux_pane", { pane, text });
}

export async function sendTmuxKeys(pane: string, keys: string[]): Promise<void> {
  return invoke("send_tmux_keys", { pane, keys });
}

export async function captureTmuxPane(pane: string): Promise<string> {
  return invoke("capture_tmux_pane", { pane });
}

export interface TmuxPaneInfo {
  pane: string;
  session: string;
  window_index: number;
  window_name: string;
  pane_index: number;
  cwd: string;
  has_claude: boolean;
  resume_id: string | null;
}

export async function listTmuxPanes(): Promise<TmuxPaneInfo[]> {
  return invoke("list_tmux_panes");
}

export interface SlashCommand {
  name: string;
  kind: "command" | "skill" | "agent";
  scope: "user" | "project";
  description: string | null;
  path: string;
}

export async function listSlashCommands(cwd: string | null): Promise<SlashCommand[]> {
  return invoke("list_slash_commands", { cwd });
}

export interface TmuxProbe {
  bin: string | null;
  server_running: boolean;
  pane_count: number;
  error: string | null;
}

export async function probeTmux(): Promise<TmuxProbe> {
  return invoke("probe_tmux");
}

export async function getPaneQuestion(pane: string): Promise<CcQuestion | null> {
  return invoke("get_pane_question", { pane });
}
