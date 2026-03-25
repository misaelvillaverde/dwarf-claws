use crate::commands::{claude_code, openclaw};
use crate::models::unified::*;

#[tauri::command]
pub fn list_sessions(source_filter: Option<String>) -> Vec<UnifiedSession> {
    let filter = source_filter.as_deref();

    let mut sessions = Vec::new();

    if filter != Some("claude_code") {
        sessions.extend(openclaw::list_sessions());
    }

    if filter != Some("openclaw") {
        sessions.extend(claude_code::list_sessions());
    }

    // Sort by updated_at desc, then timestamp desc
    sessions.sort_by(|a, b| {
        let a_time = a.updated_at.unwrap_or(0);
        let b_time = b.updated_at.unwrap_or(0);
        b_time.cmp(&a_time)
    });

    sessions
}

#[tauri::command]
pub fn get_session_messages(session_id: String, source: String) -> Vec<UnifiedMessage> {
    match source.as_str() {
        "OpenClaw" => openclaw::get_session_messages(&session_id),
        "ClaudeCode" => claude_code::get_session_messages(&session_id),
        _ => vec![],
    }
}

#[tauri::command]
pub fn search_sessions(query: String) -> Vec<UnifiedSession> {
    let all = list_sessions(None);
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
