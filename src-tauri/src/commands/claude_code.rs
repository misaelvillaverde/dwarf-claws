use crate::models::unified::*;
use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

fn projects_dir() -> PathBuf {
    dirs::home_dir().unwrap().join(".claude/projects")
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
    let mut got_metadata = false;

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

                if first_msg.is_none() && line_type == "user" {
                    first_msg = extract_cc_text_preview(&val);
                }

                if line_type == "assistant" && model.is_none() {
                    model = val
                        .get("message")
                        .and_then(|m| m.get("model"))
                        .and_then(|m| m.as_str())
                        .map(|s| s.to_string());
                }

                // Once we have all metadata, just count remaining messages quickly
                if !got_metadata
                    && session_id.is_some()
                    && first_msg.is_some()
                    && model.is_some()
                {
                    got_metadata = true;
                }
            }
            _ => {
                // For non-message lines after metadata, skip full parse
                if got_metadata {
                    continue;
                }
            }
        }
    }

    let id = session_id.unwrap_or_else(|| {
        path.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string()
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
    })
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

pub fn get_session_messages(session_id: &str) -> Vec<UnifiedMessage> {
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
                // Also check sessionId inside the file
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
