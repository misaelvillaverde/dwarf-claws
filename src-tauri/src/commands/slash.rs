use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlashCommand {
    pub name: String,
    pub kind: String,  // "command" | "skill" | "agent"
    pub scope: String, // "user" | "project"
    pub description: Option<String>,
    pub path: String,
}

struct SlashCache {
    key: String,
    cached_at_ms: u64,
    items: Vec<SlashCommand>,
}

static SLASH_CACHE: Mutex<Option<SlashCache>> = Mutex::new(None);

const SLASH_CACHE_TTL_MS: u64 = 30_000;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn dir_mtime(p: &Path) -> u64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn cache_key(cwd: Option<&str>) -> String {
    let home = dirs::home_dir();
    let user_cmds = home.as_ref().map(|h| h.join(".claude/commands"));
    let user_skills = home.as_ref().map(|h| h.join(".claude/skills"));
    let user_agents = home.as_ref().map(|h| h.join(".claude/agents"));

    let proj = cwd
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    let proj_cmds = proj.as_ref().map(|p| p.join(".claude/commands"));
    let proj_skills = proj.as_ref().map(|p| p.join(".claude/skills"));
    let proj_agents = proj.as_ref().map(|p| p.join(".claude/agents"));

    let m = |p: &Option<PathBuf>| -> u64 {
        p.as_deref().map(dir_mtime).unwrap_or(0)
    };

    format!(
        "{}|{}|{}|{}|{}|{}|{}",
        cwd.unwrap_or(""),
        m(&user_cmds),
        m(&user_skills),
        m(&user_agents),
        m(&proj_cmds),
        m(&proj_skills),
        m(&proj_agents),
    )
}

#[tauri::command]
pub fn list_slash_commands(cwd: Option<String>) -> Vec<SlashCommand> {
    let key = cache_key(cwd.as_deref());
    let now = now_ms();

    {
        let guard = SLASH_CACHE.lock().unwrap();
        if let Some(ref c) = *guard {
            if c.key == key && now.saturating_sub(c.cached_at_ms) < SLASH_CACHE_TTL_MS {
                return c.items.clone();
            }
        }
    }

    let items = scan_slash_commands(cwd.as_deref());

    {
        let mut guard = SLASH_CACHE.lock().unwrap();
        *guard = Some(SlashCache {
            key,
            cached_at_ms: now,
            items: items.clone(),
        });
    }

    items
}

fn scan_slash_commands(cwd: Option<&str>) -> Vec<SlashCommand> {
    let mut out: Vec<SlashCommand> = Vec::new();

    if let Some(home) = dirs::home_dir() {
        scan_md_dir(&home.join(".claude/commands"), "command", "user", &mut out);
        scan_skills_dir(&home.join(".claude/skills"), "user", &mut out);
        scan_md_dir(&home.join(".claude/agents"), "agent", "user", &mut out);
    }

    if let Some(cwd) = cwd.filter(|s| !s.is_empty()) {
        let proj = PathBuf::from(cwd);
        scan_md_dir(&proj.join(".claude/commands"), "command", "project", &mut out);
        scan_skills_dir(&proj.join(".claude/skills"), "project", &mut out);
        scan_md_dir(&proj.join(".claude/agents"), "agent", "project", &mut out);
    }

    // De-dup by (name, kind), preferring project scope.
    out.sort_by(|a, b| {
        let a_proj = a.scope == "project";
        let b_proj = b.scope == "project";
        b_proj.cmp(&a_proj).then(a.name.cmp(&b.name))
    });
    let mut seen = std::collections::HashSet::new();
    out.retain(|c| seen.insert((c.name.clone(), c.kind.clone())));

    out.sort_by(|a, b| {
        // Show project commands first, then sort by kind then name.
        let a_proj = a.scope == "project";
        let b_proj = b.scope == "project";
        b_proj
            .cmp(&a_proj)
            .then(a.kind.cmp(&b.kind))
            .then(a.name.cmp(&b.name))
    });
    out
}

fn scan_md_dir(base: &Path, kind: &str, scope: &str, out: &mut Vec<SlashCommand>) {
    if !base.exists() {
        return;
    }
    walk_md(base, base, kind, scope, out);
}

fn walk_md(base: &Path, dir: &Path, kind: &str, scope: &str, out: &mut Vec<SlashCommand>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_md(base, &path, kind, scope, out);
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let rel = match path.strip_prefix(base).ok() {
            Some(r) => r,
            None => continue,
        };
        let name = rel
            .with_extension("")
            .to_string_lossy()
            .replace('\\', "/")
            .to_string();
        if name.is_empty() {
            continue;
        }
        let description = extract_description(&path);
        out.push(SlashCommand {
            name,
            kind: kind.to_string(),
            scope: scope.to_string(),
            description,
            path: path.to_string_lossy().to_string(),
        });
    }
}

fn scan_skills_dir(dir: &Path, scope: &str, out: &mut Vec<SlashCommand>) {
    if !dir.exists() {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let skill_md = path.join("SKILL.md");
        if !skill_md.exists() {
            continue;
        }
        let dir_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let (name_override, description) = extract_skill_meta(&skill_md);
        let name = name_override.unwrap_or(dir_name);
        if name.is_empty() {
            continue;
        }
        out.push(SlashCommand {
            name,
            kind: "skill".to_string(),
            scope: scope.to_string(),
            description,
            path: skill_md.to_string_lossy().to_string(),
        });
    }
}

fn unquote(s: &str) -> String {
    let t = s.trim();
    if (t.starts_with('"') && t.ends_with('"') && t.len() >= 2)
        || (t.starts_with('\'') && t.ends_with('\'') && t.len() >= 2)
    {
        t[1..t.len() - 1].to_string()
    } else {
        t.to_string()
    }
}

fn extract_description(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    if let Some(desc) = parse_frontmatter_field(&content, "description") {
        return Some(desc);
    }
    // Fall back to first heading or first non-empty prose line.
    let mut in_fm = false;
    for (i, line) in content.lines().enumerate() {
        let t = line.trim();
        if i == 0 && t == "---" {
            in_fm = true;
            continue;
        }
        if in_fm {
            if t == "---" {
                in_fm = false;
            }
            continue;
        }
        if t.starts_with("# ") {
            return Some(t[2..].trim().to_string());
        }
        if !t.is_empty() && !t.starts_with('#') {
            return Some(t.chars().take(120).collect());
        }
    }
    None
}

fn extract_skill_meta(path: &Path) -> (Option<String>, Option<String>) {
    let content = fs::read_to_string(path).ok().unwrap_or_default();
    let name = parse_frontmatter_field(&content, "name");
    let description = parse_frontmatter_field(&content, "description");
    (name, description)
}

fn parse_frontmatter_field(content: &str, field: &str) -> Option<String> {
    let mut lines = content.lines();
    if lines.next()?.trim() != "---" {
        return None;
    }
    let needle = format!("{field}:");
    for line in lines {
        let t = line.trim_start();
        if t == "---" {
            return None;
        }
        if let Some(rest) = t.strip_prefix(&needle) {
            let v = unquote(rest);
            if v.is_empty() {
                return None;
            }
            return Some(v);
        }
    }
    None
}
