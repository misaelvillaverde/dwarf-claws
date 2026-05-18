use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

const FALLBACK_TMUX_PATHS: &[&str] = &[
    "/opt/homebrew/bin/tmux",
    "/usr/local/bin/tmux",
    "/opt/local/bin/tmux",
    "/usr/bin/tmux",
];

static TMUX_BIN: OnceLock<Option<String>> = OnceLock::new();

/// Augment PATH on macOS GUI launch so `tmux`, `claude`, etc. resolve.
/// Called once at app startup.
pub fn ensure_brew_path() {
    let extra = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"];
    let cur = std::env::var("PATH").unwrap_or_default();
    let mut parts: Vec<String> = Vec::new();
    for p in extra {
        if !cur.split(':').any(|seg| seg == p) {
            parts.push(p.to_string());
        }
    }
    if parts.is_empty() {
        return;
    }
    if !cur.is_empty() {
        parts.push(cur);
    }
    std::env::set_var("PATH", parts.join(":"));
}

/// Resolve the tmux binary path. Tries `tmux` via PATH first, then known
/// Homebrew/macports locations. Cached for the process lifetime.
fn tmux_bin() -> Option<&'static str> {
    TMUX_BIN
        .get_or_init(|| {
            // Try plain PATH lookup.
            if Command::new("tmux")
                .arg("-V")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
            {
                return Some("tmux".to_string());
            }
            for path in FALLBACK_TMUX_PATHS {
                if PathBuf::from(path).is_file() {
                    if Command::new(path)
                        .arg("-V")
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .status()
                        .map(|s| s.success())
                        .unwrap_or(false)
                    {
                        return Some((*path).to_string());
                    }
                }
            }
            None
        })
        .as_deref()
}

#[derive(Debug, Clone, Serialize)]
pub struct TmuxProbe {
    pub bin: Option<String>,
    pub server_running: bool,
    pub pane_count: usize,
    pub error: Option<String>,
}

#[tauri::command]
pub fn probe_tmux() -> TmuxProbe {
    let bin = tmux_bin().map(|s| s.to_string());
    let Some(b) = bin.as_deref() else {
        return TmuxProbe {
            bin: None,
            server_running: false,
            pane_count: 0,
            error: Some("tmux binary not found in PATH or common brew locations".into()),
        };
    };

    let out = Command::new(b)
        .args([
            "list-panes",
            "-a",
            "-F",
            "#{pane_current_path}|#{session_name}:#{window_index}.#{pane_index}",
        ])
        .output();

    match out {
        Ok(o) if o.status.success() => {
            let s = String::from_utf8_lossy(&o.stdout);
            let count = s.lines().filter(|l| !l.trim().is_empty()).count();
            TmuxProbe {
                bin: Some(b.to_string()),
                server_running: true,
                pane_count: count,
                error: None,
            }
        }
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr).to_string();
            TmuxProbe {
                bin: Some(b.to_string()),
                server_running: false,
                pane_count: 0,
                error: Some(if stderr.is_empty() {
                    format!("tmux exited with {:?}", o.status.code())
                } else {
                    stderr
                }),
            }
        }
        Err(e) => TmuxProbe {
            bin: Some(b.to_string()),
            server_running: false,
            pane_count: 0,
            error: Some(format!("spawn failed: {e}")),
        },
    }
}

#[derive(Clone)]
struct ProcInfo {
    pid: u32,
    ppid: u32,
    command: String,
}

fn list_procs() -> Vec<ProcInfo> {
    // `-ww` keeps the command column un-truncated when stdout isn't a tty.
    let out = match Command::new("ps")
        .args(["-axww", "-o", "pid=,ppid=,command="])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return Vec::new(),
    };
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines().filter_map(parse_proc_line).collect()
}

/// Parse one line of `ps -o pid=,ppid=,command=` output. `ps` pads narrower
/// PIDs/PPIDs with spaces so columns align — `" 9606  9542 claude …"` for
/// 4-digit PIDs when the widest PID is 5 digits. A naive `splitn` on
/// whitespace produces empty fields and drops the row; walk the bytes
/// instead so any run of whitespace is one separator.
fn parse_proc_line(line: &str) -> Option<ProcInfo> {
    let bytes = line.as_bytes();
    let n = bytes.len();
    let mut i = 0;
    while i < n && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    let pid_start = i;
    while i < n && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i == pid_start {
        return None;
    }
    let pid: u32 = std::str::from_utf8(&bytes[pid_start..i]).ok()?.parse().ok()?;
    while i < n && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    let ppid_start = i;
    while i < n && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i == ppid_start {
        return None;
    }
    let ppid: u32 = std::str::from_utf8(&bytes[ppid_start..i]).ok()?.parse().ok()?;
    while i < n && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    let command = String::from_utf8_lossy(&bytes[i..]).to_string();
    Some(ProcInfo { pid, ppid, command })
}

fn find_claude_descendant(
    root: u32,
    children_map: &HashMap<u32, Vec<u32>>,
    by_pid: &HashMap<u32, ProcInfo>,
) -> Option<u32> {
    let mut stack = vec![root];
    let mut seen = HashSet::new();
    while let Some(pid) = stack.pop() {
        if !seen.insert(pid) {
            continue;
        }
        if let Some(kids) = children_map.get(&pid) {
            for &k_pid in kids {
                if let Some(k) = by_pid.get(&k_pid) {
                    if looks_like_claude(&k.command) {
                        return Some(k.pid);
                    }
                    stack.push(k.pid);
                }
            }
        }
    }
    None
}

fn list_pane_pids() -> HashMap<u32, String> {
    let mut map = HashMap::new();
    let Some(bin) = tmux_bin() else { return map };
    let output = match Command::new(bin)
        .args([
            "list-panes",
            "-a",
            "-F",
            "#{pane_pid}|#{session_name}:#{window_index}.#{pane_index}",
        ])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return map,
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let mut parts = line.splitn(2, '|');
        let pid: u32 = match parts.next().and_then(|s| s.parse().ok()) {
            Some(p) => p,
            None => continue,
        };
        let pane = match parts.next() {
            Some(p) if !p.is_empty() => p.to_string(),
            _ => continue,
        };
        map.insert(pid, pane);
    }
    map
}

fn find_pane_for_pid(
    start: u32,
    by_pid: &HashMap<u32, ProcInfo>,
    pane_pids: &HashMap<u32, String>,
) -> Option<String> {
    let mut cur = start;
    let mut seen = HashSet::new();
    while seen.insert(cur) {
        if let Some(pane) = pane_pids.get(&cur) {
            return Some(pane.clone());
        }
        match by_pid.get(&cur) {
            Some(p) if p.ppid != 0 && p.ppid != p.pid => cur = p.ppid,
            _ => return None,
        }
    }
    None
}

fn looks_like_claude(cmd: &str) -> bool {
    if cmd.contains("claude-code") {
        return true;
    }
    if let Some(arg0) = cmd.split_whitespace().next() {
        let base = arg0.rsplit('/').next().unwrap_or(arg0);
        if base == "claude" {
            return true;
        }
    }
    false
}

/// Batch `lsof` for multiple pids. Returns map of pid -> list of `n`-marker
/// filenames. The pid is parsed from `p<pid>` marker lines emitted by lsof's
/// `-F` field output mode.
///
/// `extra_args` lets callers narrow the query (e.g. `-d cwd` to only get cwd).
fn lsof_batch(pids: &[u32], extra_args: &[&str]) -> HashMap<u32, Vec<String>> {
    let mut map: HashMap<u32, Vec<String>> = HashMap::new();
    if pids.is_empty() {
        return map;
    }
    let pid_arg = pids
        .iter()
        .map(|p| p.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let mut args: Vec<&str> = vec!["-p", &pid_arg];
    // CRITICAL: macOS lsof ORs selection criteria by default. Without `-a`,
    // `-p PID -d cwd` means "PID's files OR every cwd file from every process",
    // which floods the output with unrelated cwds and breaks pid→cwd matching.
    // `-a` ANDs the criteria so only the requested pids' cwd lines are emitted.
    if !extra_args.is_empty() {
        args.push("-a");
    }
    for a in extra_args {
        args.push(a);
    }
    // Always include `-Fn` for filename markers; callers that pass `-d cwd`
    // already restrict the descriptor set.
    args.push("-Fn");
    let out = match Command::new("lsof").args(&args).output() {
        Ok(o) => o,
        Err(_) => return map,
    };
    // lsof returns non-zero when some pids have no matching fds, but stdout is
    // still populated for the ones that do. Parse regardless of status.
    let text = String::from_utf8_lossy(&out.stdout);
    let mut cur_pid: Option<u32> = None;
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix('p') {
            cur_pid = rest.parse().ok();
            continue;
        }
        if let Some(name) = line.strip_prefix('n') {
            if let Some(pid) = cur_pid {
                map.entry(pid).or_default().push(name.to_string());
            }
        }
    }
    map
}

fn list_claude_pids(procs: &[ProcInfo]) -> Vec<u32> {
    procs
        .iter()
        .filter(|p| looks_like_claude(&p.command))
        .map(|p| p.pid)
        .collect()
}

/// One-shot snapshot of process + pane state used to build all the
/// pane mapping tables in a single sweep.
struct PaneSnapshot {
    procs: Vec<ProcInfo>,
    by_pid: HashMap<u32, ProcInfo>,
    pane_pids: HashMap<u32, String>,
    children_map: HashMap<u32, Vec<u32>>,
}

impl PaneSnapshot {
    fn build() -> Self {
        let procs = list_procs();
        let pane_pids = list_pane_pids();
        let mut by_pid: HashMap<u32, ProcInfo> = HashMap::with_capacity(procs.len());
        let mut children_map: HashMap<u32, Vec<u32>> = HashMap::with_capacity(procs.len());
        for p in &procs {
            by_pid.insert(p.pid, p.clone());
            children_map.entry(p.ppid).or_default().push(p.pid);
        }
        PaneSnapshot {
            procs,
            by_pid,
            pane_pids,
            children_map,
        }
    }
}

pub struct PaneMappings {
    pub resume_id: HashMap<String, String>,
    /// Session id -> pane id, recovered by grepping each pane's scrollback for
    /// a known session UUID. Catches sessions launched without `--resume`
    /// (CC prints the id in its banner / `/status` output).
    pub scrollback: HashMap<String, String>,
    pub jsonl: HashMap<String, String>,
    pub active_cwd: HashMap<String, String>,
    pub cwd: HashMap<String, String>,
    /// Set of pane ids currently present in tmux; used to validate manual
    /// bindings and to detect stale cached panes.
    pub known_panes: HashSet<String>,
}

/// Capture the recent scrollback (~2000 lines) for a pane as a single string.
fn pane_scrollback(pane_id: &str) -> String {
    let Some(bin) = tmux_bin() else { return String::new() };
    let out = Command::new(bin)
        .args(["capture-pane", "-p", "-J", "-S", "-2000", "-t", pane_id])
        .output();
    match out {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
        _ => String::new(),
    }
}

/// Find all UUID-v4-shaped tokens (`8-4-4-4-12` lowercase hex) in `text` that
/// also appear in `known`. Returns the matched ids. Filtering against `known`
/// avoids false positives from unrelated UUIDs (request IDs, traces, etc.)
/// CC may print in its output.
fn scrollback_uuids_in(text: &str, known: &HashSet<String>) -> Vec<String> {
    let mut out = Vec::new();
    if text.len() < 36 || known.is_empty() {
        return out;
    }
    let bytes = text.as_bytes();
    let n = bytes.len();
    let mut i = 0;
    while i + 36 <= n {
        // Bail fast if the dash positions are wrong.
        if bytes[i + 8] != b'-' || bytes[i + 13] != b'-' || bytes[i + 18] != b'-' || bytes[i + 23] != b'-' {
            i += 1;
            continue;
        }
        let groups: [&[u8]; 5] = [
            &bytes[i..i + 8],
            &bytes[i + 9..i + 13],
            &bytes[i + 14..i + 18],
            &bytes[i + 19..i + 23],
            &bytes[i + 24..i + 36],
        ];
        let ok = groups
            .iter()
            .all(|g| g.iter().all(|b| b.is_ascii_hexdigit()));
        if !ok {
            i += 1;
            continue;
        }
        // Reject if surrounded by other hex/word chars (avoid mid-token matches).
        let prev_ok = i == 0 || !bytes[i - 1].is_ascii_hexdigit();
        let next_pos = i + 36;
        let next_ok = next_pos >= n || !bytes[next_pos].is_ascii_hexdigit();
        if prev_ok && next_ok {
            let candidate = std::str::from_utf8(&bytes[i..i + 36])
                .ok()
                .map(|s| s.to_lowercase());
            if let Some(u) = candidate {
                if known.contains(&u) && !out.contains(&u) {
                    out.push(u);
                }
            }
            i += 36;
            continue;
        }
        i += 1;
    }
    out
}

/// Walk a claude process's argv looking for `--resume <uuid>`. Returns the
/// session id if present.
fn extract_resume_id(cmd: &str) -> Option<String> {
    let needle = "--resume";
    let idx = cmd.find(needle)?;
    let rest = &cmd[idx + needle.len()..];
    let trimmed = rest.trim_start();
    // Take the next whitespace-separated token; strip surrounding quotes.
    let token = trimmed.split_whitespace().next()?;
    let stripped = token.trim_matches(|c: char| c == '"' || c == '\'');
    // Session ids are 36-char UUIDs (8-4-4-4-12). Be a little tolerant of
    // longer or shorter ids while still rejecting obvious garbage.
    if stripped.len() < 8 || stripped.len() > 64 {
        return None;
    }
    if !stripped
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return None;
    }
    Some(stripped.to_string())
}

/// Build all five pane lookup maps from one process+lsof sweep:
///   - `resume_id`:  session id -> pane id (claude was launched with --resume <id>)
///   - `scrollback`: session id -> pane id (pane's scrollback contains the id)
///   - `jsonl`:      jsonl path -> pane id (claude descendant has the file open)
///   - `active_cwd`: cwd -> pane id (pane has a running claude process at cwd)
///   - `cwd`:        cwd -> pane id (any pane currently at cwd)
///
/// `known_session_ids` is the universe of session ids we know about (JSONL
/// filenames). The scrollback strategy only records UUIDs from this set, so
/// random request/trace ids printed by CC don't become spurious mappings.
pub fn pane_mappings(known_session_ids: &HashSet<String>) -> PaneMappings {
    let cwd_map = pane_by_cwd();
    let snap = PaneSnapshot::build();
    let known_panes: HashSet<String> = snap.pane_pids.values().cloned().collect();
    if snap.procs.is_empty() || snap.pane_pids.is_empty() {
        return PaneMappings {
            resume_id: HashMap::new(),
            scrollback: HashMap::new(),
            jsonl: HashMap::new(),
            active_cwd: HashMap::new(),
            cwd: cwd_map,
            known_panes,
        };
    }

    // 0) resume_id map: scan every claude process's command line for `--resume <id>`,
    //    walk up to its enclosing pane. No subprocess calls needed.
    let mut resume_map: HashMap<String, String> = HashMap::new();
    for p in &snap.procs {
        if !looks_like_claude(&p.command) {
            continue;
        }
        let Some(id) = extract_resume_id(&p.command) else {
            continue;
        };
        if let Some(pane) = find_pane_for_pid(p.pid, &snap.by_pid, &snap.pane_pids) {
            resume_map.entry(id).or_insert(pane);
        }
    }

    // Collect (pane_id, claude_pid) for every pane that has a claude descendant.
    let mut pane_claude: Vec<(String, u32)> = Vec::new();
    for (&pane_pid, pane_id) in &snap.pane_pids {
        if let Some(claude_pid) =
            find_claude_descendant(pane_pid, &snap.children_map, &snap.by_pid)
        {
            pane_claude.push((pane_id.clone(), claude_pid));
        }
    }

    // 0.5) scrollback map: for each session id still unresolved after the
    //      `--resume` argv scan, grep each claude-bearing pane's scrollback for
    //      the UUID. CC prints the session id in startup banners, `/status`
    //      output, and error messages, so this catches sessions launched with
    //      a plain `claude` (no --resume) that have run long enough to log.
    let resolved_so_far: HashSet<String> = resume_map
        .keys()
        .filter(|k| known_session_ids.contains(*k))
        .cloned()
        .collect();
    let unresolved: HashSet<String> = known_session_ids
        .difference(&resolved_so_far)
        .cloned()
        .collect();
    let mut scrollback_map: HashMap<String, String> = HashMap::new();
    if !unresolved.is_empty() {
        for (pane_id, _) in &pane_claude {
            // Bail early if all unresolved ids already found.
            if unresolved.iter().all(|id| scrollback_map.contains_key(id)) {
                break;
            }
            let text = pane_scrollback(pane_id);
            if text.is_empty() {
                continue;
            }
            for uuid in scrollback_uuids_in(&text, &unresolved) {
                scrollback_map.entry(uuid).or_insert_with(|| pane_id.clone());
            }
        }
    }

    // 1) jsonl map: one batched lsof for all claude pids (no descriptor filter so
    //    we can pick out .jsonl entries from regular file fds).
    let pids: Vec<u32> = pane_claude.iter().map(|(_, p)| *p).collect();
    let lsof_all = lsof_batch(&pids, &[]);
    let mut jsonl_map: HashMap<String, String> = HashMap::new();
    for (pane_id, cpid) in &pane_claude {
        if let Some(names) = lsof_all.get(cpid) {
            for name in names {
                if name.contains("/.claude/projects/") && name.ends_with(".jsonl") {
                    jsonl_map.insert(name.clone(), pane_id.clone());
                    break;
                }
            }
        }
    }

    // 2) active_cwd map: walk every claude pid (not just those rooted at a pane)
    //    up to its containing pane; one batched lsof with `-d cwd` for cwd lookup.
    let claude_pids = list_claude_pids(&snap.procs);
    let cwd_lsof = lsof_batch(&claude_pids, &["-d", "cwd"]);
    let mut active_cwd_map: HashMap<String, String> = HashMap::new();
    for cpid in &claude_pids {
        let pane = match find_pane_for_pid(*cpid, &snap.by_pid, &snap.pane_pids) {
            Some(p) => p,
            None => continue,
        };
        let cwd = match cwd_lsof.get(cpid).and_then(|names| names.first()) {
            Some(c) => c.clone(),
            None => continue,
        };
        active_cwd_map.entry(cwd).or_insert(pane);
    }

    PaneMappings {
        resume_id: resume_map,
        scrollback: scrollback_map,
        jsonl: jsonl_map,
        active_cwd: active_cwd_map,
        cwd: cwd_map,
        known_panes,
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TmuxPaneInfo {
    pub pane: String,
    pub session: String,
    pub window_index: u32,
    pub window_name: String,
    pub pane_index: u32,
    pub cwd: String,
    pub has_claude: bool,
    pub resume_id: Option<String>,
}

/// List every pane in the running tmux server with the metadata the binding
/// picker needs. Empty when tmux is not installed or no server is running.
#[tauri::command]
pub fn list_tmux_panes() -> Vec<TmuxPaneInfo> {
    let Some(bin) = tmux_bin() else {
        return Vec::new();
    };
    let output = match Command::new(bin)
        .args([
            "list-panes",
            "-a",
            "-F",
            "#{pane_pid}|#{session_name}:#{window_index}.#{pane_index}|#{session_name}|#{window_index}|#{window_name}|#{pane_index}|#{pane_current_path}",
        ])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return Vec::new(),
    };

    let snap = PaneSnapshot::build();
    let mut out = Vec::new();
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let parts: Vec<&str> = line.splitn(7, '|').collect();
        if parts.len() < 7 {
            continue;
        }
        let pane_pid: u32 = match parts[0].parse() {
            Ok(p) => p,
            Err(_) => continue,
        };
        let claude_pid = find_claude_descendant(pane_pid, &snap.children_map, &snap.by_pid);
        let resume_id = claude_pid
            .and_then(|pid| snap.by_pid.get(&pid))
            .and_then(|p| extract_resume_id(&p.command));
        out.push(TmuxPaneInfo {
            pane: parts[1].to_string(),
            session: parts[2].to_string(),
            window_index: parts[3].parse().unwrap_or(0),
            window_name: parts[4].to_string(),
            pane_index: parts[5].parse().unwrap_or(0),
            cwd: parts[6].to_string(),
            has_claude: claude_pid.is_some(),
            resume_id,
        });
    }
    out
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CcOption {
    pub number: u8,
    pub label: String,
    pub description: Option<String>,
    pub is_freetext: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CcQuestion {
    pub prompt: String,
    pub options: Vec<CcOption>,
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' && chars.peek() == Some(&'[') {
            chars.next();
            while let Some(&nc) = chars.peek() {
                chars.next();
                if nc.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn match_numbered_option(line: &str) -> Option<(u8, String)> {
    let cleaned = strip_ansi(line.trim_start());
    // Strip leading whitespace AND interactive-prompt selector characters
    // (❯, >, ○, ●) that appear before the number on the selected option.
    let s = cleaned.trim_start_matches(|c: char| {
        c.is_whitespace()
            || matches!(c, '❯' | '>' | '○' | '●' | '*' | '■' | '▶' | '➜' | '→')
    });
    let dot = s.find(". ")?;
    if dot == 0 || dot > 2 {
        return None;
    }
    let num_str = &s[..dot];
    if !num_str.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let num: u8 = num_str.parse().ok()?;
    let label = s[dot + 2..].trim().to_string();
    if label.is_empty() {
        return None;
    }
    Some((num, label))
}

pub fn parse_cc_question(text: &str) -> Option<CcQuestion> {
    let raw_lines: Vec<&str> = text.lines().collect();
    let n = raw_lines.len();
    let start = n.saturating_sub(120);
    let raw_recent = &raw_lines[start..];

    // Require CC selector context in the recent block: at least one `❯` or
    // box-drawing `│` character. Without this, plain numbered lists in user
    // messages would be incorrectly parsed as CC questions.
    let has_cc_context = raw_recent.iter().any(|l| l.contains('❯') || l.contains('│'));
    if !has_cc_context {
        return None;
    }

    let lines: Vec<String> = raw_recent.iter().map(|l| strip_ansi(l)).collect();
    let recent = &lines[..];

    // Collect numbered option positions.
    let mut option_pos: Vec<(usize, u8, String)> = Vec::new();
    for (i, line) in recent.iter().enumerate() {
        if let Some((num, label)) = match_numbered_option(line) {
            option_pos.push((i, num, label));
        }
    }

    if option_pos.len() < 2 {
        return None;
    }
    // Must have options 1 and 2 to count as a CC question.
    let has_one = option_pos.iter().any(|(_, n, _)| *n == 1);
    let has_two = option_pos.iter().any(|(_, n, _)| *n == 2);
    if !has_one || !has_two {
        return None;
    }

    // The LAST option must appear in the most recent 30 lines so we don't
    // detect already-answered questions that are still in the scrollback.
    let last_idx = option_pos.last().map_or(0, |(i, _, _)| *i);
    if last_idx + 30 < recent.len() {
        return None;
    }

    // Build option structs with optional descriptions.
    let mut options: Vec<CcOption> = Vec::new();
    for i in 0..option_pos.len() {
        let (line_idx, num, label) = &option_pos[i];
        let next_idx = option_pos
            .get(i + 1)
            .map_or(recent.len(), |(idx, _, _)| *idx);
        let mut desc_parts: Vec<String> = Vec::new();
        for k in (line_idx + 1)..next_idx {
            let l = &recent[k];
            let trimmed = l.trim();
            if trimmed.is_empty() {
                break;
            }
            if (l.starts_with(' ') || l.starts_with('\t'))
                && match_numbered_option(l).is_none()
            {
                desc_parts.push(trimmed.to_string());
            } else {
                break;
            }
        }
        let is_freetext = label.to_lowercase().contains("type something");
        options.push(CcOption {
            number: *num,
            label: label.clone(),
            description: if desc_parts.is_empty() {
                None
            } else {
                Some(desc_parts.join(" "))
            },
            is_freetext,
        });
    }

    // Find the prompt: non-empty line(s) before the first option, going backwards.
    let first_idx = option_pos[0].0;
    let mut prompt_parts: Vec<String> = Vec::new();
    let mut i = first_idx;
    while i > 0 {
        i -= 1;
        let l = recent[i].trim().to_string();
        if l.is_empty() {
            if !prompt_parts.is_empty() {
                break;
            }
            continue;
        }
        // Navigation / separator lines — stop.
        if l.contains('□')
            || l.contains('✓')
            || l.contains('→')
            || l.contains('─')
            || l.contains('━')
            || l.contains('┄')
        {
            break;
        }
        prompt_parts.push(l);
    }
    prompt_parts.reverse();
    let prompt = prompt_parts.join(" ").trim().to_string();

    if prompt.is_empty() {
        return None;
    }

    Some(CcQuestion { prompt, options })
}

#[tauri::command]
pub fn get_pane_question(pane: String) -> Option<CcQuestion> {
    if !valid_pane(&pane) {
        return None;
    }
    let text = pane_scrollback(&pane);
    if text.is_empty() {
        return None;
    }
    parse_cc_question(&text)
}

/// Map of cwd -> "session:window.pane" using `tmux list-panes -a`.
/// Empty when tmux is not installed or no server is running.
pub fn pane_by_cwd() -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Some(bin) = tmux_bin() else { return map };

    let output = match Command::new(bin)
        .args([
            "list-panes",
            "-a",
            "-F",
            "#{pane_current_path}|#{session_name}:#{window_index}.#{pane_index}",
        ])
        .output()
    {
        Ok(o) => o,
        Err(_) => return map,
    };

    if !output.status.success() {
        return map;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let mut parts = line.rsplitn(2, '|');
        let pane = match parts.next() {
            Some(s) if !s.is_empty() => s,
            _ => continue,
        };
        let cwd = match parts.next() {
            Some(s) if !s.is_empty() => s,
            _ => continue,
        };
        map.entry(cwd.to_string()).or_insert_with(|| pane.to_string());
    }

    map
}

fn valid_pane(pane: &str) -> bool {
    !pane.is_empty()
        && pane.len() < 200
        && pane
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '.' | '_' | '-' | '@' | '%'))
}

const ALLOWED_KEYS: &[&str] = &[
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    "Enter", "Escape", "Tab", "BTab", "Space", "BSpace",
    "Up", "Down", "Left", "Right", "M-m",
];

fn valid_key(key: &str) -> bool {
    ALLOWED_KEYS.iter().any(|&k| k == key)
}

#[tauri::command]
pub fn capture_tmux_pane(pane: String) -> Result<String, String> {
    if !valid_pane(&pane) {
        return Err(format!("invalid tmux pane target: {pane}"));
    }
    let bin = tmux_bin().ok_or_else(|| "tmux binary not found".to_string())?;
    let out = Command::new(bin)
        .args(["capture-pane", "-p", "-J", "-t", &pane])
        .output()
        .map_err(|e| format!("spawn capture-pane: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "tmux capture-pane failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[tauri::command]
pub async fn send_tmux_keys(pane: String, keys: Vec<String>) -> Result<(), String> {
    if !valid_pane(&pane) {
        return Err(format!("invalid tmux pane target: {pane}"));
    }
    if keys.is_empty() {
        return Err("no keys".into());
    }
    for k in &keys {
        if !valid_key(k) {
            return Err(format!("invalid key: {k}"));
        }
    }
    let bin = tmux_bin().ok_or_else(|| "tmux binary not found".to_string())?;

    let mut args: Vec<&str> = vec!["send-keys", "-t", &pane];
    for k in &keys {
        args.push(k);
    }

    let out = Command::new(bin)
        .args(&args)
        .output()
        .map_err(|e| format!("spawn send-keys: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "tmux send-keys failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn send_to_tmux_pane(pane: String, text: String) -> Result<(), String> {
    if !valid_pane(&pane) {
        return Err(format!("invalid tmux pane target: {pane}"));
    }
    if text.is_empty() {
        return Err("empty text".into());
    }
    let bin = tmux_bin().ok_or_else(|| "tmux binary not found".to_string())?;

    let mut child = Command::new(bin)
        .args(["load-buffer", "-b", "dwarf-claws-send", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn tmux load-buffer: {e}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|e| format!("write to tmux stdin: {e}"))?;
    }
    drop(child.stdin.take());

    let load_out = child
        .wait_with_output()
        .map_err(|e| format!("wait tmux load-buffer: {e}"))?;
    if !load_out.status.success() {
        return Err(format!(
            "tmux load-buffer failed: {}",
            String::from_utf8_lossy(&load_out.stderr)
        ));
    }

    // -p enables bracketed paste so CC's TUI receives the text as a single paste
    // event instead of a stream of key events (otherwise `/` opens the slash picker
    // and subsequent chars filter it, eating the first letters).
    let paste = Command::new(bin)
        .args(["paste-buffer", "-b", "dwarf-claws-send", "-d", "-p", "-t", &pane])
        .output()
        .map_err(|e| format!("spawn tmux paste-buffer: {e}"))?;
    if !paste.status.success() {
        return Err(format!(
            "tmux paste-buffer failed: {}",
            String::from_utf8_lossy(&paste.stderr)
        ));
    }

    let enter = Command::new(bin)
        .args(["send-keys", "-t", &pane, "Enter"])
        .output()
        .map_err(|e| format!("spawn tmux send-keys: {e}"))?;
    if !enter.status.success() {
        return Err(format!(
            "tmux send-keys Enter failed: {}",
            String::from_utf8_lossy(&enter.stderr)
        ));
    }

    Ok(())
}
