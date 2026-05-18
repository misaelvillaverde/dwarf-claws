import { Component, Show, For, createSignal } from "solid-js";
import type { UnifiedSession, ToolStat } from "../lib/types";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { chatState, ChatState, sessionName, contextUsage } from "../lib/sessionState";
import ContextBar from "./ContextBar";
import { customNameFor, setCustomName } from "../lib/customNames";

interface Props {
  session: UnifiedSession | null;
  toolStats: ToolStat[];
  isPinned: boolean;
  onTogglePin: () => void;
  tailing?: boolean;
  onToggleTail?: () => void;
  onRequestBind?: (s: UnifiedSession) => void;
}

function stateMeta(s: ChatState): { cls: string; label: string } {
  if (s === "working") return { cls: "ok",   label: "WORK" };
  if (s === "waiting") return { cls: "warn", label: "WAIT" };
  return { cls: "idle", label: "IDLE" };
}

const TOOL_COLORS = [
  "var(--ink-2)", "var(--info)", "var(--ok)", "var(--accent)",
  "var(--warn)", "var(--ink-3)", "var(--ink-4)", "var(--ink)", "var(--info)",
];

function paneSourceLabel(s: NonNullable<UnifiedSession["pane_source"]>): string {
  switch (s) {
    case "manual": return "manual";
    case "resume_id": return "resume";
    case "scrollback": return "scrollback";
    case "jsonl": return "jsonl";
    case "active_cwd": return "active cwd";
    case "cwd": return "cwd guess";
    case "none":
    default:
      return "unknown";
  }
}
function paneSourceColor(s: NonNullable<UnifiedSession["pane_source"]>): string {
  if (s === "manual" || s === "resume_id" || s === "scrollback") return "var(--ok)";
  if (s === "cwd") return "var(--warn)";
  if (s === "none") return "var(--ink-3)";
  return "var(--info)";
}
function paneSourceTip(s: NonNullable<UnifiedSession["pane_source"]>): string {
  switch (s) {
    case "manual": return "You bound this pane explicitly.";
    case "resume_id": return "Matched by claude --resume <id> in process tree.";
    case "scrollback": return "Session UUID found in the pane's recent output.";
    case "jsonl": return "Matched by claude holding the session's .jsonl open.";
    case "active_cwd": return "A running claude has matching cwd.";
    case "cwd": return "No live claude found. Pane picked by directory only — may be wrong.";
    case "none":
    default:
      return "Source not recorded.";
  }
}

function KVRow(props: { k: string; v: string | null | undefined }) {
  return (
    <Show when={props.v}>
      <span class="ink-faint" style={{ "text-align": "right" }}>{props.k}</span>
      <span class="ink-mid" style={{
        overflow: "hidden",
        "text-overflow": "ellipsis",
        "white-space": "nowrap",
      }}>{props.v}</span>
    </Show>
  );
}

const SessionDetail: Component<Props> = (props) => {
  const [copied, setCopied] = createSignal<string | null>(null);
  const [editingName, setEditingName] = createSignal(false);
  const [nameDraft, setNameDraft] = createSignal("");
  let nameInputRef: HTMLInputElement | undefined;

  const startEdit = (s: UnifiedSession) => {
    setNameDraft(customNameFor(s.id) || "");
    setEditingName(true);
    queueMicrotask(() => nameInputRef?.focus());
  };
  const cancelEdit = () => {
    setEditingName(false);
    setNameDraft("");
  };
  const commitName = (id: string) => {
    if (!editingName()) return;
    setCustomName(id, nameDraft());
    setEditingName(false);
  };

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1200);
    } catch (e) {
      console.warn("Clipboard failed:", e);
    }
  };

  const reveal = async (path: string) => {
    try {
      await revealItemInDir(path);
    } catch (e) {
      console.warn("revealItemInDir failed:", e);
    }
  };

  return (
    <Show when={props.session}>
      {(s) => {
        const state = () => chatState(s());
        const sm = () => stateMeta(state());
        const totalCalls = () => props.toolStats.reduce((a, t) => a + t.call_count, 0) || 1;

        return (
          <div style={{
            "border-bottom": "1px solid var(--rule)",
            background: "var(--paper-2)",
            "flex-shrink": 0,
          }}>
            <div class="frame-head" style={{ "border-bottom": "1px dashed var(--rule-soft)" }}>
              <span class="bracket-title">[<b>session</b>]</span>
              <span style={{ "margin-left": "auto", display: "flex", gap: "6px" }}>
                <button
                  class={props.isPinned ? "active" : ""}
                  onClick={props.onTogglePin}
                >
                  {props.isPinned ? "★ pinned" : "☆ pin"}
                </button>
                <Show when={props.onToggleTail}>
                  <button
                    class={props.tailing ? "active" : ""}
                    onClick={props.onToggleTail}
                  >
                    {props.tailing ? "● live" : "○ tail"}
                  </button>
                </Show>
                <Show when={s().jsonl_path}>
                  <button
                    class="btn-ghost"
                    title="reveal jsonl in Finder"
                    onClick={() => reveal(s().jsonl_path!)}
                  >↗</button>
                </Show>
              </span>
            </div>

            <div style={{ padding: "10px 12px 8px" }}>
              <div style={{
                display: "flex",
                "align-items": "center",
                gap: "10px",
                "margin-bottom": "4px",
              }}>
                <span class={`chip ${sm().cls}`}>
                  <span class="dot"></span>{sm().label}
                </span>
                <Show
                  when={editingName()}
                  fallback={
                    <span
                      style={{
                        color: "var(--ink)",
                        "font-weight": 600,
                        "font-size": "13px",
                        overflow: "hidden",
                        "text-overflow": "ellipsis",
                        "white-space": "nowrap",
                        flex: 1,
                        "min-width": 0,
                      }}
                      title="click to rename"
                      onDblClick={() => startEdit(s())}
                    >
                      {sessionName(s())}
                      <Show when={customNameFor(s().id)}>
                        <span class="ink-faint" style={{ "font-size": "10px", "margin-left": "6px" }}>(renamed)</span>
                      </Show>
                    </span>
                  }
                >
                  <input
                    ref={(el) => (nameInputRef = el)}
                    value={nameDraft()}
                    onInput={(e) => setNameDraft(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitName(s().id);
                      if (e.key === "Escape") cancelEdit();
                    }}
                    onBlur={() => commitName(s().id)}
                    placeholder="custom name (Enter to save, blank to clear)"
                    style={{
                      flex: 1,
                      "min-width": 0,
                      "font-size": "13px",
                      "font-weight": 600,
                    }}
                  />
                </Show>
                <button
                  class="btn-ghost"
                  style={{ "font-size": "11px", padding: "0 4px" }}
                  title={customNameFor(s().id) ? "edit custom name" : "rename"}
                  onClick={() => (editingName() ? cancelEdit() : startEdit(s()))}
                >
                  {editingName() ? "✕" : "✎"}
                </button>
              </div>

              <Show when={s().first_user_message_preview}>
                <div class="ink-mid" style={{
                  "font-size": "11.5px",
                  "margin-bottom": "8px",
                  "font-style": "italic",
                }}>
                  &ldquo;{s().first_user_message_preview}&rdquo;
                </div>
              </Show>

              <div style={{
                display: "grid",
                "grid-template-columns": "62px 1fr",
                "row-gap": "1px",
                "column-gap": "8px",
                "font-size": "11.5px",
                "margin-bottom": "6px",
              }}>
                <span class="ink-faint" style={{ "text-align": "right" }}>ctx</span>
                <span class="ink-mid" style={{ display: "inline-flex", "align-items": "center", gap: "6px" }}>
                  <ContextBar session={s()} width="80px" />
                  <span>{Math.round(contextUsage(s()).pct * 100)}% &middot; {contextUsage(s()).label}</span>
                </span>
                <KVRow k="model" v={s().model} />
                <KVRow k="project" v={s().project_path} />
                <KVRow k="cwd" v={s().cwd} />
                <KVRow k="msgs" v={String(s().message_count)} />
                <KVRow k="id" v={s().id} />
              </div>

              <Show when={s().jsonl_path}>
                <div style={{ "margin-bottom": "6px" }}>
                  <div class="ink-faint" style={{
                    "font-size": "10.5px",
                    "letter-spacing": "0.06em",
                    "text-transform": "uppercase",
                    "margin-bottom": "2px",
                  }}>
                    ┄ jsonl
                  </div>
                  <div style={{ display: "flex", "align-items": "center", gap: "4px" }}>
                    <code style={{
                      flex: 1,
                      "font-size": "11px",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                    }}>
                      {s().jsonl_path}
                    </code>
                    <button
                      style={{ "font-size": "10px" }}
                      onClick={() => copy(s().jsonl_path!, "path")}
                    >
                      {copied() === "path" ? "Copied" : "Copy"}
                    </button>
                    <button
                      style={{ "font-size": "10px" }}
                      onClick={() => reveal(s().jsonl_path!)}
                    >
                      Reveal
                    </button>
                  </div>
                </div>
              </Show>

              <div style={{ "margin-bottom": "6px" }}>
                <div class="ink-faint" style={{
                  "font-size": "10.5px",
                  "letter-spacing": "0.06em",
                  "text-transform": "uppercase",
                  "margin-bottom": "2px",
                }}>
                  ┄ tmux pane
                </div>
                <Show
                  when={s().tmux_pane}
                  fallback={
                    <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
                      <span class="ink-faint" style={{ "font-size": "11px", "font-style": "italic" }}>
                        no pane resolved
                      </span>
                      <button
                        type="button"
                        style={{ "font-size": "10px" }}
                        onClick={() => props.onRequestBind?.(s())}
                      >
                        Bind…
                      </button>
                    </div>
                  }
                >
                  <div style={{ display: "flex", "align-items": "center", gap: "4px", "flex-wrap": "wrap" }}>
                    <code style={{ color: "var(--info)", "font-size": "11px" }}>
                      {s().tmux_pane}
                    </code>
                    <Show when={s().pane_source}>
                      <span
                        title={paneSourceTip(s().pane_source!)}
                        style={{
                          color: paneSourceColor(s().pane_source!),
                          "border": "1px solid currentColor",
                          "border-radius": "3px",
                          padding: "0 4px",
                          "font-size": "10px",
                          "letter-spacing": "0.04em",
                        }}
                      >
                        {paneSourceLabel(s().pane_source!)}
                      </span>
                    </Show>
                    <button
                      style={{ "font-size": "10px" }}
                      title="copy tmux switch-client cmd"
                      onClick={() => copy(`tmux switch-client -t ${s().tmux_pane}`, "tmux")}
                    >
                      {copied() === "tmux" ? "Copied" : "Copy cmd"}
                    </button>
                    <button
                      type="button"
                      style={{ "font-size": "10px" }}
                      onClick={() => props.onRequestBind?.(s())}
                      title="Pick a specific tmux pane"
                    >
                      Bind…
                    </button>
                  </div>
                </Show>
              </div>

              <Show when={props.toolStats.length > 0}>
                <div style={{ "margin-top": "6px" }}>
                  <div class="ink-faint" style={{
                    "font-size": "10.5px",
                    "letter-spacing": "0.06em",
                    "text-transform": "uppercase",
                    "margin-bottom": "4px",
                  }}>
                    ┄ tool mix ({totalCalls()})
                  </div>
                  <div style={{ display: "flex", height: "8px", border: "1px solid var(--rule)" }}>
                    <For each={props.toolStats}>
                      {(t, i) => (
                        <span
                          title={`${t.tool_name}: ${t.call_count}`}
                          style={{
                            width: `${(t.call_count / totalCalls()) * 100}%`,
                            background: TOOL_COLORS[i() % TOOL_COLORS.length],
                            "border-right": "1px solid var(--paper-2)",
                          }}
                        ></span>
                      )}
                    </For>
                  </div>
                  <div style={{
                    display: "flex",
                    "flex-wrap": "wrap",
                    gap: "4px 10px",
                    "margin-top": "4px",
                    "font-size": "10.5px",
                  }}>
                    <For each={props.toolStats.slice(0, 8)}>
                      {(t, i) => (
                        <span class="ink-mid" style={{
                          display: "inline-flex",
                          "align-items": "center",
                          gap: "4px",
                        }}>
                          <span style={{
                            width: "7px",
                            height: "7px",
                            background: TOOL_COLORS[i() % TOOL_COLORS.length],
                            display: "inline-block",
                          }}></span>
                          {t.tool_name}
                          <span class="ink-faint">{t.call_count}</span>
                          <Show when={t.error_count > 0}>
                            <span style={{ color: "var(--warn)" }}>({t.error_count} err)</span>
                          </Show>
                        </span>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
          </div>
        );
      }}
    </Show>
  );
};

export default SessionDetail;
