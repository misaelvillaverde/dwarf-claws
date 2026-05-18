use crate::commands::{claude_code, tmux};
use crate::models::unified::*;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

struct SessionCache {
    sessions: Vec<UnifiedSession>,
    last_scan_ms: u64,
}

static SESSION_CACHE: Mutex<Option<SessionCache>> = Mutex::new(None);

const CACHE_TTL_MS: u64 = 10_000;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn get_cached_sessions() -> Vec<UnifiedSession> {
    let now = now_ms();

    {
        let cache = SESSION_CACHE.lock().unwrap();
        if let Some(ref c) = *cache {
            if now - c.last_scan_ms < CACHE_TTL_MS {
                return c.sessions.clone();
            }
        }
    }

    let mut sessions = claude_code::list_sessions();

    let known_ids: std::collections::HashSet<String> =
        sessions.iter().map(|s| s.id.clone()).collect();
    let mappings = tmux::pane_mappings(&known_ids);
    for s in sessions.iter_mut() {
        // 1. claude was launched with `--resume <session-id>`.
        if let Some(pane) = mappings.resume_id.get(&s.id) {
            s.tmux_pane = Some(pane.clone());
            s.pane_source = Some("resume_id".into());
            continue;
        }
        // 2. Session UUID appears in a pane's scrollback (CC printed it).
        if let Some(pane) = mappings.scrollback.get(&s.id) {
            s.tmux_pane = Some(pane.clone());
            s.pane_source = Some("scrollback".into());
            continue;
        }
        // 3. claude has the session's jsonl open (lsof scan).
        if let Some(path) = &s.jsonl_path {
            if let Some(pane) = mappings.jsonl.get(path) {
                s.tmux_pane = Some(pane.clone());
                s.pane_source = Some("jsonl".into());
                continue;
            }
        }
        if let Some(cwd) = &s.cwd {
            // 4. Pane that actually has claude running with matching cwd.
            if let Some(pane) = mappings.active_cwd.get(cwd) {
                s.tmux_pane = Some(pane.clone());
                s.pane_source = Some("active_cwd".into());
                continue;
            }
            // 5. Fallback: any pane in that cwd (may be wrong if a shell
            //    shares the directory).
            if let Some(pane) = mappings.cwd.get(cwd) {
                s.tmux_pane = Some(pane.clone());
                s.pane_source = Some("cwd".into());
                continue;
            }
        }
        s.pane_source = Some("none".into());
    }

    sessions.sort_by(|a, b| {
        let a_time = a.updated_at.unwrap_or(0);
        let b_time = b.updated_at.unwrap_or(0);
        b_time.cmp(&a_time)
    });

    {
        let mut cache = SESSION_CACHE.lock().unwrap();
        *cache = Some(SessionCache {
            sessions: sessions.clone(),
            last_scan_ms: now,
        });
    }

    sessions
}

#[tauri::command]
pub fn list_sessions() -> Vec<UnifiedSession> {
    get_cached_sessions()
}

#[tauri::command]
pub fn get_session_messages(session_id: String) -> Vec<UnifiedMessage> {
    claude_code::get_session_messages(&session_id)
}

#[tauri::command]
pub fn search_sessions(query: String) -> Vec<UnifiedSession> {
    let all = get_cached_sessions();
    let query_lower = query.to_lowercase();

    all.into_iter()
        .filter(|s| {
            s.first_user_message_preview
                .as_ref()
                .map_or(false, |m| m.to_lowercase().contains(&query_lower))
                || s.display_name
                    .as_ref()
                    .map_or(false, |n| n.to_lowercase().contains(&query_lower))
                || s.slug
                    .as_ref()
                    .map_or(false, |sl| sl.to_lowercase().contains(&query_lower))
                || s.project_path
                    .as_ref()
                    .map_or(false, |p| p.to_lowercase().contains(&query_lower))
        })
        .collect()
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolStat {
    pub tool_name: String,
    pub call_count: usize,
    pub error_count: usize,
}

#[tauri::command]
pub fn get_tool_usage(session_id: String) -> Vec<ToolStat> {
    let messages = claude_code::get_session_messages(&session_id);
    compute_tool_stats(&messages)
}

fn compute_tool_stats(messages: &[UnifiedMessage]) -> Vec<ToolStat> {
    let mut call_counts: HashMap<String, usize> = HashMap::new();
    let mut error_counts: HashMap<String, usize> = HashMap::new();
    let mut tool_id_to_name: HashMap<String, String> = HashMap::new();

    for msg in messages {
        for block in &msg.content {
            match block {
                ContentBlock::ToolCall {
                    tool_name, tool_id, ..
                } => {
                    *call_counts.entry(tool_name.clone()).or_insert(0) += 1;
                    tool_id_to_name.insert(tool_id.clone(), tool_name.clone());
                }
                ContentBlock::ToolResult {
                    tool_id, is_error, ..
                } => {
                    if *is_error {
                        if let Some(name) = tool_id_to_name.get(tool_id) {
                            *error_counts.entry(name.clone()).or_insert(0) += 1;
                        }
                    }
                }
                _ => {}
            }
        }
    }

    let mut stats: Vec<ToolStat> = call_counts
        .into_iter()
        .map(|(name, count)| ToolStat {
            error_count: error_counts.get(&name).copied().unwrap_or(0),
            tool_name: name,
            call_count: count,
        })
        .collect();

    stats.sort_by(|a, b| b.call_count.cmp(&a.call_count));
    stats
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionData {
    pub messages: Vec<UnifiedMessage>,
    pub tool_stats: Vec<ToolStat>,
}

#[tauri::command]
pub fn get_session_data(session_id: String) -> SessionData {
    let messages = claude_code::get_session_messages(&session_id);
    let tool_stats = compute_tool_stats(&messages);
    SessionData { messages, tool_stats }
}

#[tauri::command]
pub fn get_session_messages_since(session_id: String, offset: usize) -> Vec<UnifiedMessage> {
    let messages = claude_code::get_session_messages(&session_id);
    if offset >= messages.len() {
        vec![]
    } else {
        messages[offset..].to_vec()
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct MessageSearchResult {
    pub session_id: String,
    pub snippet: String,
    pub role: String,
}

#[tauri::command]
pub fn search_messages(query: String) -> Vec<MessageSearchResult> {
    let all_sessions = get_cached_sessions();
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    for session in all_sessions {
        if !claude_code::file_contains_text(&session.id, &query_lower) {
            continue;
        }

        let messages = claude_code::get_session_messages(&session.id);

        for msg in messages {
            for block in &msg.content {
                let text = match block {
                    ContentBlock::Text { text } => text,
                    ContentBlock::Thinking { text } => text,
                    _ => continue,
                };

                if let Some(pos) = text.to_lowercase().find(&query_lower) {
                    let start = pos.saturating_sub(40);
                    let end = (pos + query_lower.len() + 40).min(text.len());
                    let snippet: String = text.chars().skip(start).take(end - start).collect();

                    let role = match msg.role {
                        MessageRole::User => "User",
                        MessageRole::Assistant => "Assistant",
                        MessageRole::ToolResult => "ToolResult",
                    };

                    results.push(MessageSearchResult {
                        session_id: session.id.clone(),
                        snippet,
                        role: role.to_string(),
                    });
                    break;
                }
            }
        }

        if results.len() >= 50 {
            break;
        }
    }

    results
}
