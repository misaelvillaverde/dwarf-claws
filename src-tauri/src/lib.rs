pub mod commands;
pub mod models;

use commands::sessions::{
    get_session_data, get_session_messages, get_session_messages_since, get_tool_usage,
    list_sessions, search_messages, search_sessions,
};
use commands::slash::list_slash_commands;
use commands::tmux::{capture_tmux_pane, ensure_brew_path, get_pane_question, list_tmux_panes, probe_tmux, send_to_tmux_pane, send_tmux_keys};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    ensure_brew_path();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_sessions,
            get_session_messages,
            get_session_data,
            get_session_messages_since,
            search_sessions,
            get_tool_usage,
            search_messages,
            send_to_tmux_pane,
            send_tmux_keys,
            capture_tmux_pane,
            list_tmux_panes,
            probe_tmux,
            get_pane_question,
            list_slash_commands,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
