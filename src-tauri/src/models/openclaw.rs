#![allow(dead_code)]
use serde::Deserialize;
use std::collections::HashMap;

pub type SessionsRegistry = HashMap<String, SessionMeta>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    pub session_id: String,
    #[serde(default)]
    pub updated_at: Option<u64>,
    #[serde(default)]
    pub chat_type: Option<String>,
    #[serde(default)]
    pub channel: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub session_file: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SessionHeader {
    #[serde(rename = "type")]
    pub line_type: String,
    pub id: String,
    #[serde(default)]
    pub timestamp: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
}
