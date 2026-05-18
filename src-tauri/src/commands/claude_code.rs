use crate::models::unified::*;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

fn projects_dir() -> PathBuf {
    dirs::home_dir().unwrap().join(".claude/projects")
}

/// Cache of session_id -> jsonl file path. Populated during `list_sessions`,
/// queried by `get_session_messages` to avoid re-walking `~/.claude/projects/`
/// on every tail poll. Entries are invalidated when the file no longer exists.
static SESSION_PATH_CACHE: Mutex<Option<HashMap<String, PathBuf>>> = Mutex::new(None);

fn cache_session_path(session_id: &str, path: &Path) {
    let mut guard = SESSION_PATH_CACHE.lock().unwrap();
    let map = guard.get_or_insert_with(HashMap::new);
    map.insert(session_id.to_string(), path.to_path_buf());
}

fn cached_session_path(session_id: &str) -> Option<PathBuf> {
    let mut guard = SESSION_PATH_CACHE.lock().unwrap();
    let map = guard.as_mut()?;
    let path = map.get(session_id)?.clone();
    if path.exists() {
        Some(path)
    } else {
        map.remove(session_id);
        None
    }
}

/// Decode dir name like "-Users-foo-project" -> "/Users/foo/project"
fn decode_project_path(dir_name: &str) -> String {
    let mut result = String::new();
    let mut chars = dir_name.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '-' {
            result.push('/');
        } else {
            result.push(ch);
        }
    }

    result
}

pub fn list_sessions() -> Vec<UnifiedSession> {
    let base = projects_dir();
    if !base.exists() {
        return vec![];
    }

    let mut sessions = Vec::new();

    let entries = match fs::read_dir(&base) {
        Ok(e) => e,
        Err(_) => return vec![],
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let dir_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        let project_path = decode_project_path(&dir_name);

        // Find all .jsonl files in this project dir (skip subagents/)
        let jsonl_files = match fs::read_dir(&path) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for file_entry in jsonl_files.flatten() {
            let file_path = file_entry.path();
            if file_path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            if file_path
                .to_str()
                .map_or(false, |p| p.contains("subagents"))
            {
                continue;
            }

            if let Some(session) = parse_session_preview(&file_path, &project_path) {
                cache_session_path(&session.id, &file_path);
                sessions.push(session);
            }
        }
    }

    sessions
}

fn parse_session_preview(path: &Path, project_path: &str) -> Option<UnifiedSession> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);

    let mut session_id: Option<String> = None;
    let mut cwd: Option<String> = None;
    let mut timestamp: Option<String> = None;
    let mut model: Option<String> = None;
    let mut slug: Option<String> = None;
    let mut first_msg: Option<String> = None;
    let mut msg_count: usize = 0;
    let mut updated_at: Option<u64> = None;
    let mut last_role: Option<String> = None;
    let mut got_metadata = false;
    let mut context_tokens: Option<u64> = None;
    let mut context_chars: u64 = 0;
    let mut pending_pairs: Vec<(String, String, u64)> = Vec::new();

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if line.trim().is_empty() {
            continue;
        }

        // After metadata is gathered, use lightweight string matching for most fields.
        // For assistant lines we still need the JSON to capture usage tokens.
        if got_metadata {
            let is_user = line.contains("\"type\":\"user\"");
            let is_assistant = line.contains("\"type\":\"assistant\"");
            if is_user || is_assistant {
                msg_count += 1;
                last_role = Some(if is_assistant { "assistant".into() } else { "user".into() });
                context_chars = context_chars.saturating_add(line.len() as u64);
                let mut line_ts_ms: u64 = 0;
                if let Some(ts_start) = line.find("\"timestamp\":\"") {
                    let ts_offset = ts_start + 13;
                    if let Some(ts_end) = line[ts_offset..].find('"') {
                        let ts_str = &line[ts_offset..ts_offset + ts_end];
                        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts_str) {
                            let millis = dt.timestamp_millis() as u64;
                            updated_at = Some(updated_at.map_or(millis, |prev: u64| prev.max(millis)));
                            line_ts_ms = millis;
                        }
                    }
                }
                if is_assistant {
                    if let Some(tokens) = extract_usage_total(&line) {
                        context_tokens = Some(context_tokens.map_or(tokens, |t| t.max(tokens)));
                    }
                }
                // Track pending tool_use ids — string-scan first (5–10× faster than
                // a full serde parse). Fall back to JSON parse only when the scan
                // can't safely disambiguate.
                let has_tool_use = line.contains("\"tool_use\"");
                let has_tool_result = line.contains("\"tool_use_id\"");
                if has_tool_use || has_tool_result {
                    if !update_pending_scan(&line, line_ts_ms, &mut pending_pairs) {
                        if let Ok(val) = serde_json::from_str::<Value>(&line) {
                            update_pending(&val, line_ts_ms, &mut pending_pairs);
                        }
                    }
                }
            }
            continue;
        }

        let val: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let line_type = val.get("type").and_then(|t| t.as_str()).unwrap_or("");

        match line_type {
            "user" | "assistant" => {
                if session_id.is_none() {
                    session_id = val
                        .get("sessionId")
                        .and_then(|s| s.as_str())
                        .map(|s| s.to_string());
                }
                if cwd.is_none() {
                    cwd = val
                        .get("cwd")
                        .and_then(|s| s.as_str())
                        .map(|s| s.to_string());
                }
                if slug.is_none() {
                    slug = val
                        .get("slug")
                        .and_then(|s| s.as_str())
                        .map(|s| s.to_string());
                }

                let ts = val
                    .get("timestamp")
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string());

                if timestamp.is_none() {
                    timestamp = ts.clone();
                }
                if let Some(ts_str) = &ts {
                    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts_str) {
                        let millis = dt.timestamp_millis() as u64;
                        updated_at = Some(updated_at.map_or(millis, |prev: u64| prev.max(millis)));
                    }
                }

                msg_count += 1;
                last_role = Some(line_type.to_string());
                context_chars = context_chars.saturating_add(line.len() as u64);

                if first_msg.is_none() && line_type == "user" {
                    first_msg = extract_cc_text_preview(&val);
                }

                if line_type == "assistant" {
                    if model.is_none() {
                        model = val
                            .get("message")
                            .and_then(|m| m.get("model"))
                            .and_then(|m| m.as_str())
                            .map(|s| s.to_string());
                    }
                    let usage = val.get("message").and_then(|m| m.get("usage"));
                    if let Some(tokens) = usage_total(usage) {
                        context_tokens = Some(context_tokens.map_or(tokens, |t| t.max(tokens)));
                    }
                }

                // Track pending tool_use ids (both branches).
                let line_ts_ms: u64 = ts
                    .as_ref()
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    .map(|dt| dt.timestamp_millis() as u64)
                    .unwrap_or(0);
                update_pending(&val, line_ts_ms, &mut pending_pairs);

                if session_id.is_some()
                    && first_msg.is_some()
                    && model.is_some()
                {
                    got_metadata = true;
                }
            }
            _ => {}
        }
    }

    let id = session_id.unwrap_or_else(|| {
        path.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string()
    });

    let pending_tool_use = pending_pairs.last().map(|(id, name, ts_ms)| {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let age_ms = if *ts_ms == 0 || now_ms < *ts_ms {
            0
        } else {
            now_ms - *ts_ms
        };
        PendingToolUse {
            tool_name: name.clone(),
            tool_use_id: id.clone(),
            age_ms,
        }
    });

    Some(UnifiedSession {
        id,
        source: SessionSource::ClaudeCode,
        timestamp,
        updated_at,
        cwd,
        model,
        chat_type: Some("cli".to_string()),
        channel: Some("claude-code".to_string()),
        display_name: slug.clone(),
        project_path: Some(project_path.to_string()),
        message_count: msg_count,
        slug,
        first_user_message_preview: first_msg,
        last_message_role: last_role,
        jsonl_path: Some(path.to_string_lossy().to_string()),
        tmux_pane: None,
        context_tokens,
        context_chars: Some(context_chars),
        pending_tool_use,
        pane_source: None,
    })
}

/// Update the running list of unresolved tool_use ids based on the content of one
/// user/assistant JSONL line. Insertion order is preserved; resolved ids are
/// removed so the last remaining entry reflects the most recent pending tool.
fn update_pending(val: &Value, line_ts_ms: u64, pending: &mut Vec<(String, String, u64)>) {
    let content = match val.get("message").and_then(|m| m.get("content")) {
        Some(c) => c,
        None => return,
    };
    let arr = match content.as_array() {
        Some(a) => a,
        None => return,
    };
    for block in arr {
        let t = match block.get("type").and_then(|t| t.as_str()) {
            Some(t) => t,
            None => continue,
        };
        match t {
            "tool_use" => {
                let id = block.get("id").and_then(|s| s.as_str()).unwrap_or("");
                let name = block.get("name").and_then(|s| s.as_str()).unwrap_or("");
                if !id.is_empty() {
                    pending.retain(|(p_id, _, _)| p_id != id);
                    pending.push((id.to_string(), name.to_string(), line_ts_ms));
                }
            }
            "tool_result" => {
                let id = block.get("tool_use_id").and_then(|s| s.as_str()).unwrap_or("");
                if !id.is_empty() {
                    pending.retain(|(p_id, _, _)| p_id != id);
                }
            }
            _ => {}
        }
    }
}

/// Lightweight string-scan version of `update_pending` used on the hot fast path.
/// Returns `false` when the scan can't confidently disambiguate the line so the
/// caller can fall back to the full JSON parse.
///
/// Strategy:
///   1. Resolve every `"tool_use_id":"toolu_…"` occurrence (tool_result blocks).
///   2. Then for every `"type":"tool_use"`, grab the nearest following
///      `"id":"toolu_…"` and `"name":"…"` and record as pending.
///
/// The JSONL lines we see are machine-produced, so quoting is regular and the
/// `toolu_<alnum/underscore>` token shape is reliable.
fn update_pending_scan(line: &str, line_ts_ms: u64, pending: &mut Vec<(String, String, u64)>) -> bool {
    // 1) Resolutions.
    let res_needle = "\"tool_use_id\":\"";
    let mut idx = 0;
    while let Some(rel) = line[idx..].find(res_needle) {
        let start = idx + rel + res_needle.len();
        let end = match line[start..].find('"') {
            Some(e) => start + e,
            None => return false,
        };
        let id = &line[start..end];
        if !id.starts_with("toolu_") {
            // Unexpected shape — bail to the JSON path.
            return false;
        }
        pending.retain(|(p_id, _, _)| p_id != id);
        idx = end + 1;
    }

    // 2) New tool_use blocks.
    let tu_needle = "\"type\":\"tool_use\"";
    let mut search_from = 0;
    while let Some(rel) = line[search_from..].find(tu_needle) {
        let tu_pos = search_from + rel;
        let after = tu_pos + tu_needle.len();
        // Walk forward to find this block's `"id":"toolu_…"` and `"name":"…"`.
        // They appear in the same `{…}` object; the next occurrences after the
        // `type` key are overwhelmingly the right ones.
        let id = match find_quoted_field(line, after, "\"id\":\"") {
            Some(s) => s,
            None => return false,
        };
        if !id.starts_with("toolu_") {
            return false;
        }
        let name = find_quoted_field(line, after, "\"name\":\"").unwrap_or_default();
        pending.retain(|(p_id, _, _)| p_id != id);
        pending.push((id.to_string(), name.to_string(), line_ts_ms));
        search_from = after;
    }

    true
}

/// Find the value of the next `<needle>"` field in `line` starting at `from`.
/// Returns the slice between the opening and closing double quotes.
fn find_quoted_field<'a>(line: &'a str, from: usize, needle: &str) -> Option<&'a str> {
    let rel = line[from..].find(needle)?;
    let start = from + rel + needle.len();
    let end = line[start..].find('"')?;
    Some(&line[start..start + end])
}

/// Sum input + cache + output tokens from a Claude API usage object, if present.
fn usage_total(usage: Option<&Value>) -> Option<u64> {
    let u = usage?;
    let get = |k: &str| -> u64 { u.get(k).and_then(|n| n.as_u64()).unwrap_or(0) };
    let total = get("input_tokens")
        + get("cache_read_input_tokens")
        + get("cache_creation_input_tokens")
        + get("output_tokens");
    if total == 0 { None } else { Some(total) }
}

fn extract_usage_total(line: &str) -> Option<u64> {
    let val: Value = serde_json::from_str(line).ok()?;
    usage_total(val.get("message").and_then(|m| m.get("usage")))
}

fn extract_cc_text_preview(val: &Value) -> Option<String> {
    let content = val.get("message")?.get("content")?;
    let text = if let Some(s) = content.as_str() {
        s.to_string()
    } else if let Some(arr) = content.as_array() {
        arr.iter()
            .filter_map(|block| {
                if block.get("type")?.as_str()? == "text" {
                    block.get("text")?.as_str().map(|s| s.to_string())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        return None;
    };

    let preview: String = text.chars().take(120).collect();
    if preview.is_empty() {
        None
    } else {
        Some(preview)
    }
}

/// Quick check: does the session's JSONL file contain the given text (case-insensitive)?
/// Used as a pre-filter before expensive full-message parse in search_messages.
pub fn file_contains_text(session_id: &str, query_lower: &str) -> bool {
    if let Some(path) = cached_session_path(session_id) {
        return scan_file_for_text(&path, query_lower);
    }

    let base = projects_dir();
    let entries = match fs::read_dir(&base) {
        Ok(e) => e,
        Err(_) => return false,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let files = match fs::read_dir(&path) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for file_entry in files.flatten() {
            let file_path = file_entry.path();
            if file_path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let fname = file_path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            if fname == session_id || fname.starts_with(&format!("{}-", session_id)) {
                cache_session_path(session_id, &file_path);
                return scan_file_for_text(&file_path, query_lower);
            }
        }
    }
    false
}

/// Stream a file line by line, lowercasing on the fly and short-circuiting on
/// the first hit. Avoids the double allocation of `read_to_string` +
/// `to_lowercase` for large JSONL files.
fn scan_file_for_text(path: &Path, query_lower: &str) -> bool {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let reader = BufReader::new(file);
    for line in reader.lines().flatten() {
        if line.to_lowercase().contains(query_lower) {
            return true;
        }
    }
    false
}

pub fn get_session_messages(session_id: &str) -> Vec<UnifiedMessage> {
    // Fast path: cached path from a previous list_sessions / get_session_messages.
    if let Some(path) = cached_session_path(session_id) {
        return parse_session_messages(&path);
    }

    let base = projects_dir();

    // Search all project dirs for the session
    let entries = match fs::read_dir(&base) {
        Ok(e) => e,
        Err(_) => return vec![],
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        // Check all jsonl files in this dir
        let files = match fs::read_dir(&path) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for file_entry in files.flatten() {
            let file_path = file_entry.path();
            if file_path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }

            // Check if this file matches the session_id
            let fname = file_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            if fname == session_id || fname.starts_with(&format!("{}-", session_id)) {
                cache_session_path(session_id, &file_path);
                return parse_session_messages(&file_path);
            }
        }
    }

    // Fallback: check if sessionId is embedded in any file
    // This is slow but handles edge cases
    vec![]
}

fn _find_session_file(session_id: &str) -> Option<PathBuf> {
    let base = projects_dir();
    let entries = fs::read_dir(&base).ok()?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let files = fs::read_dir(&path).ok()?;
        for file_entry in files.flatten() {
            let file_path = file_entry.path();
            if file_path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            if let Ok(file) = fs::File::open(&file_path) {
                let reader = BufReader::new(file);
                for line in reader.lines().take(5) {
                    if let Ok(line) = line {
                        if let Ok(val) = serde_json::from_str::<Value>(&line) {
                            if val.get("sessionId").and_then(|s| s.as_str()) == Some(session_id) {
                                return Some(file_path);
                            }
                        }
                    }
                }
            }
        }
    }

    None
}

fn parse_session_messages(path: &Path) -> Vec<UnifiedMessage> {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return vec![],
    };
    let reader = BufReader::new(file);
    let mut messages = Vec::new();

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if line.trim().is_empty() {
            continue;
        }

        let val: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let line_type = val.get("type").and_then(|t| t.as_str()).unwrap_or("");

        match line_type {
            "user" => {
                if let Some(msg) = parse_cc_user_message(&val) {
                    messages.push(msg);
                }
            }
            "assistant" => {
                if let Some(msg) = parse_cc_assistant_message(&val) {
                    messages.push(msg);
                }
            }
            _ => {}
        }
    }

    messages
}

fn parse_cc_user_message(val: &Value) -> Option<UnifiedMessage> {
    let uuid = val
        .get("uuid")
        .and_then(|s| s.as_str())
        .unwrap_or("unknown")
        .to_string();
    let timestamp = val
        .get("timestamp")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string());

    let content = parse_cc_content_blocks(val.get("message")?.get("content")?);

    Some(UnifiedMessage {
        id: uuid,
        role: MessageRole::User,
        content,
        timestamp,
        model: None,
    })
}

fn parse_cc_assistant_message(val: &Value) -> Option<UnifiedMessage> {
    let uuid = val
        .get("parentUuid")
        .and_then(|s| s.as_str())
        .unwrap_or("unknown")
        .to_string();
    let timestamp = val
        .get("timestamp")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string());
    let model = val
        .get("message")
        .and_then(|m| m.get("model"))
        .and_then(|m| m.as_str())
        .map(|s| s.to_string());

    let content = parse_cc_content_blocks(val.get("message")?.get("content")?);

    Some(UnifiedMessage {
        id: uuid,
        role: MessageRole::Assistant,
        content,
        timestamp,
        model,
    })
}

fn parse_cc_content_blocks(content: &Value) -> Vec<ContentBlock> {
    if let Some(s) = content.as_str() {
        return vec![ContentBlock::Text {
            text: s.to_string(),
        }];
    }

    let arr = match content.as_array() {
        Some(a) => a,
        None => return vec![],
    };

    arr.iter()
        .filter_map(|block| {
            let block_type = block.get("type")?.as_str()?;
            match block_type {
                "text" => Some(ContentBlock::Text {
                    text: block.get("text")?.as_str()?.to_string(),
                }),
                "thinking" => Some(ContentBlock::Thinking {
                    text: block
                        .get("thinking")
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .to_string(),
                }),
                "tool_use" => Some(ContentBlock::ToolCall {
                    tool_name: block.get("name")?.as_str()?.to_string(),
                    tool_id: block.get("id")?.as_str()?.to_string(),
                    input: serde_json::to_string(block.get("input").unwrap_or(&Value::Null))
                        .unwrap_or_default(),
                }),
                "tool_result" => Some(ContentBlock::ToolResult {
                    tool_id: block
                        .get("tool_use_id")
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .to_string(),
                    output: extract_tool_result_text(block),
                    is_error: block
                        .get("is_error")
                        .and_then(|e| e.as_bool())
                        .unwrap_or(false),
                }),
                _ => None,
            }
        })
        .collect()
}

fn extract_tool_result_text(block: &Value) -> String {
    if let Some(content) = block.get("content") {
        if let Some(s) = content.as_str() {
            return s.to_string();
        }
        if let Some(arr) = content.as_array() {
            return arr
                .iter()
                .filter_map(|c| c.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("\n");
        }
    }
    String::new()
}
