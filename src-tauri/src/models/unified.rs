use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SessionSource {
    OpenClaw,
    ClaudeCode,
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
