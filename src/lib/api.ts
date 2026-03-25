import { invoke } from "@tauri-apps/api/core";
import type { UnifiedSession, UnifiedMessage, SessionSource } from "./types";

export async function listSessions(
  sourceFilter?: string
): Promise<UnifiedSession[]> {
  return invoke("list_sessions", { sourceFilter: sourceFilter ?? null });
}

export async function getSessionMessages(
  sessionId: string,
  source: SessionSource
): Promise<UnifiedMessage[]> {
  return invoke("get_session_messages", { sessionId, source });
}

export async function searchSessions(
  query: string
): Promise<UnifiedSession[]> {
  return invoke("search_sessions", { query });
}
