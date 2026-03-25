use crate::models::openclaw::*;
use crate::models::unified::*;
use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;

fn sessions_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap()
        .join(".openclaw/agents/main/sessions")
}

pub fn list_sessions() -> Vec<UnifiedSession> {
    let dir = sessions_dir();
    let registry_path = dir.join("sessions.json");

    let registry: SessionsRegistry = match fs::read_to_string(&registry_path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => return vec![],
    };

    let mut sessions = Vec::new();

    for (_key, meta) in &registry {
        let jsonl_path = dir.join(format!("{}.jsonl", meta.session_id));
        if !jsonl_path.exists() {
            continue;
        }

        let (header, model, first_msg, msg_count) = parse_session_header(&jsonl_path);

        let display = meta
            .display_name
            .clone()
            .or(meta.subject.clone())
            .or_else(|| {
                _key.split(':')
                    .last()
                    .map(|s| s.to_string())
            });

        sessions.push(UnifiedSession {
            id: meta.session_id.clone(),
            source: SessionSource::OpenClaw,
            timestamp: header.as_ref().and_then(|h| h.timestamp.clone()),
            updated_at: meta.updated_at,
            cwd: header.as_ref().and_then(|h| h.cwd.clone()),
            model,
            chat_type: meta.chat_type.clone(),
            channel: meta.channel.clone(),
            display_name: display,
            project_path: None,
            message_count: msg_count,
            slug: None,
            first_user_message_preview: first_msg,
        });
    }

    sessions
}

fn parse_session_header(
    path: &PathBuf,
) -> (Option<SessionHeader>, Option<String>, Option<String>, usize) {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return (None, None, None, 0),
    };
    let reader = BufReader::new(file);
    let mut header: Option<SessionHeader> = None;
    let mut model: Option<String> = None;
    let mut first_msg: Option<String> = None;
    let mut msg_count: usize = 0;

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

        match val.get("type").and_then(|t| t.as_str()) {
            Some("session") => {
                header = serde_json::from_value(val).ok();
            }
            Some("model_change") => {
                if model.is_none() {
                    model = val
                        .get("modelId")
                        .and_then(|m| m.as_str())
                        .map(|s| s.to_string());
                }
            }
            Some("message") => {
                let role = val
                    .get("message")
                    .and_then(|m| m.get("role"))
                    .and_then(|r| r.as_str());

                if role == Some("user") || role == Some("assistant") {
                    msg_count += 1;
                }

                if first_msg.is_none() && role == Some("user") {
                    first_msg = extract_text_preview(&val);
                }
            }
            _ => {}
        }
    }

    (header, model, first_msg, msg_count)
}

fn extract_text_preview(msg_val: &Value) -> Option<String> {
    let content = msg_val.get("message")?.get("content")?;
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
    let path = sessions_dir().join(format!("{}.jsonl", session_id));
    if !path.exists() {
        return vec![];
    }

    let file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return vec![],
    };
    let reader = BufReader::new(file);
    let mut messages = Vec::new();
    let mut current_model: Option<String> = None;

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

        match val.get("type").and_then(|t| t.as_str()) {
            Some("model_change") => {
                current_model = val
                    .get("modelId")
                    .and_then(|m| m.as_str())
                    .map(|s| s.to_string());
            }
            Some("message") => {
                if let Some(msg) = parse_oc_message(&val, &current_model) {
                    messages.push(msg);
                }
            }
            _ => {}
        }
    }

    messages
}

fn parse_oc_message(val: &Value, current_model: &Option<String>) -> Option<UnifiedMessage> {
    let msg = val.get("message")?;
    let role_str = msg.get("role")?.as_str()?;
    let id = val.get("id")?.as_str()?.to_string();
    let timestamp = val.get("timestamp").and_then(|t| t.as_str()).map(|s| s.to_string());

    let role = match role_str {
        "user" => MessageRole::User,
        "assistant" => MessageRole::Assistant,
        "toolResult" => MessageRole::ToolResult,
        _ => return None,
    };

    let content = parse_content_blocks(msg.get("content")?);

    Some(UnifiedMessage {
        id,
        role,
        content,
        timestamp,
        model: if role_str == "assistant" {
            current_model.clone()
        } else {
            None
        },
    })
}

fn parse_content_blocks(content: &Value) -> Vec<ContentBlock> {
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
