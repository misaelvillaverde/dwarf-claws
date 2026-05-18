use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SessionSource {
    ClaudeCode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingToolUse {
    pub tool_name: String,
    pub tool_use_id: String,
    pub age_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnifiedSession {
    pub id: String,
    pub source: SessionSource,
    pub timestamp: Option<String>,
    pub updated_at: Option<u64>,
    pub cwd: Option<String>,
    pub model: Option<String>,
    pub chat_type: Option<String>,
    pub channel: Option<String>,
    pub display_name: Option<String>,
    pub project_path: Option<String>,
    pub message_count: usize,
    pub slug: Option<String>,
    pub first_user_message_preview: Option<String>,
    pub last_message_role: Option<String>,
    pub jsonl_path: Option<String>,
    pub tmux_pane: Option<String>,
    /// Approximate context tokens used (max across assistant turns)
    pub context_tokens: Option<u64>,
    /// Char count of message text/tool output (fallback when no usage info)
    pub context_chars: Option<u64>,
    /// Last unresolved tool_use awaiting permission, if any.
    pub pending_tool_use: Option<PendingToolUse>,
    /// Which strategy resolved tmux_pane. One of:
    /// "resume_id" | "jsonl" | "active_cwd" | "cwd" | "none".
    /// Manual frontend overrides set this to "manual".
    pub pane_source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MessageRole {
    User,
    Assistant,
    ToolResult,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnifiedMessage {
    pub id: String,
    pub role: MessageRole,
    pub content: Vec<ContentBlock>,
    pub timestamp: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "thinking")]
    Thinking { text: String },
    #[serde(rename = "tool_call")]
    ToolCall {
        tool_name: String,
        tool_id: String,
        input: String,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_id: String,
        output: String,
        is_error: bool,
    },
}
