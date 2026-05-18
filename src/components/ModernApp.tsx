import { Component, For, Show, createMemo, createEffect, createSignal, onCleanup } from "solid-js";
import type { UnifiedSession, UnifiedMessage, ToolStat } from "../lib/types";
import { chatState, ChatState, projectFullPath, sessionName, timeSince, PendingToolCall } from "../lib/sessionState";
import MessageBlock from "./MessageBlock";
import ContextBar from "./ContextBar";
import PendingToolBar from "./PendingToolBar";
import ModeBar from "./ModeBar";
import SlashCommandPopup from "./SlashCommandPopup";
import PaneSourceBadge from "./PaneSourceBadge";
import { clearDraft, getDraft, setDraft } from "../lib/drafts";
import { detectXmlTags } from "../lib/markdown";
import logoUrl from "../assets/logo.png";

export interface ModernAppProps {
  sessions: UnifiedSession[];
  sortedSessions: UnifiedSession[];
  selectedSession: UnifiedSession | null;
  focusedIndex: number;
  messages: UnifiedMessage[];
  toolStats: ToolStat[];
  loading: boolean;
  tailing: boolean;
  searchQuery: string;
  inboxOnly: boolean;
  viewMode: "list" | "grid";
  pinnedSessionIds: Set<string>;
  inboxCount: number;
  counts: { roomCount: number; active: number; idle: number; waiting: number };
  clockLabel: string;
  palette: string;
  projectFilter: string;
  projectGroups: [string, number][];
  pendingList: PendingToolCall[];
  pendingIds: Set<string>;
  firstPendingId: string | null;
  onSetProjectFilter: (k: string) => void;
  onSelect: (s: UnifiedSession) => void;
  onContextMenu: (s: UnifiedSession, x: number, y: number) => void;
  onSearch: (q: string) => void;
  onToggleInbox: () => void;
  onSetViewMode: (v: "list" | "grid") => void;
  onToggleTail: () => void;
  onTogglePin: (id: string) => void;
  onSwitchToTerminal: () => void;
  onSendTmux: (pane: string, text: string) => Promise<void>;
  onOpenPalette: () => void;
  detailWidth: number;
  detailHeight: number;
  onResizeStart: (e: MouseEvent) => void;
  onVResizeStart: (e: MouseEvent) => void;
  onRequestBind?: (s: UnifiedSession) => void;
}

function stateMeta(s: ChatState): { cls: string; label: string } {
  if (s === "working") return { cls: "ok", label: "Working" };
  if (s === "waiting") return { cls: "warn", label: "Needs you" };
  return { cls: "muted", label: "Idle" };
}

const ModernApp: Component<ModernAppProps> = (props) => {
  const visibleRows = () => props.sortedSessions;

  return (
    <div style={{
      height: "100vh",
      display: "flex",
      "flex-direction": "column",
      background: "var(--bg)",
    }}>
      <TopBar {...props} />
      <ProjectTabs
        projects={props.projectGroups}
        active={props.projectFilter}
        onChange={props.onSetProjectFilter}
        totalAll={props.sessions.length}
      />
      <div style={{
        flex: 1,
        display: "flex",
        "min-height": 0,
      }}>
        <div style={{ flex: 1, "min-width": "320px", display: "flex" }}>
          <SessionsPanel
            rows={visibleRows()}
            selectedId={props.selectedSession?.id ?? null}
            focusedIndex={props.focusedIndex}
            onSelect={props.onSelect}
            onContextMenu={props.onContextMenu}
            pinnedSessionIds={props.pinnedSessionIds}
            viewMode={props.viewMode}
          />
        </div>
        <div
          onMouseDown={props.onResizeStart}
          title="drag to resize"
          style={{
            width: "4px",
            cursor: "col-resize",
            background: "var(--border-soft)",
            "flex-shrink": 0,
            "user-select": "none",
          }}
        ></div>
        <div style={{
          width: `${props.detailWidth}px`,
          "flex-shrink": 0,
          display: "flex",
          "min-height": 0,
        }}>
          <DetailPanel
            session={props.selectedSession}
            messages={props.messages}
            toolStats={props.toolStats}
            tailing={props.tailing}
            onToggleTail={props.onToggleTail}
            onTogglePin={props.onTogglePin}
            isPinned={props.selectedSession ? props.pinnedSessionIds.has(props.selectedSession.id) : false}
            onSendTmux={props.onSendTmux}
            detailHeight={props.detailHeight}
            onVResizeStart={props.onVResizeStart}
            pendingList={props.pendingList}
            pendingIds={props.pendingIds}
            firstPendingId={props.firstPendingId}
            onRequestBind={props.onRequestBind}
          />
        </div>
      </div>
      <StatusBar counts={props.counts} />
    </div>
  );
};

const TopBar: Component<ModernAppProps> = (props) => {
  return (
    <header
      data-tauri-drag-region
      style={{
        flex: "0 0 auto",
        display: "flex",
        "align-items": "center",
        gap: "12px",
        padding: "10px 16px 10px 82px",
        "border-bottom": "1px solid var(--border-soft)",
        background: "var(--bg)",
      }}
    >
      <div style={{ display: "flex", "align-items": "center", gap: "10px" }}>
        <img
          src={logoUrl}
          alt="Dwarf Claws"
          style={{ width: "26px", height: "26px", "border-radius": "6px" }}
        />
        <span style={{ "font-weight": 700, "font-size": "14px", "letter-spacing": "-0.01em", color: "var(--m-text)" }}>
          Dwarf Claws
        </span>
      </div>

      <div style={{
        position: "relative",
        "margin-left": "16px",
        flex: 1,
        "max-width": "520px",
        "-webkit-app-region": "no-drag",
      }}>
        <span style={{ position: "absolute", top: "9px", left: "10px", color: "var(--text-3)" }}>
          <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="7" cy="7" r="4.5" /><path d="M11 11l3 3" />
          </svg>
        </span>
        <input
          id="dc-search"
          class="m-input"
          placeholder="Search sessions… (prefix ! to search messages)"
          value={props.searchQuery}
          onInput={(e) => props.onSearch(e.currentTarget.value)}
        />
        <span style={{ position: "absolute", top: "7px", right: "10px" }}>
          <span class="m-kbd">/</span>
        </span>
      </div>

      <div style={{ "margin-left": "auto", display: "flex", "align-items": "center", gap: "6px", "-webkit-app-region": "no-drag" }}>
        <button
          class={`m-btn ${props.inboxOnly ? "active" : ""}`}
          onClick={props.onToggleInbox}
          title="Show only sessions waiting for input"
        >
          <span style={{ display: "inline-flex" }}>
            <svg width={13} height={13} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 9v4.5h12V9M2 9l1.5-5h9L14 9M2 9h3.5l1 2h3l1-2H14" />
            </svg>
          </span>
          <span>Inbox</span>
          <Show when={props.inboxCount > 0}>
            <span style={{
              "min-width": "18px", height: "16px", padding: "0 5px",
              "border-radius": "999px",
              background: props.inboxOnly ? "rgba(255,255,255,.25)" : "var(--m-warn)",
              color: props.inboxOnly ? "var(--m-accent)" : "white",
              "font-size": "10px", "font-weight": 700,
              display: "inline-flex", "align-items": "center", "justify-content": "center",
            }}>{props.inboxCount}</span>
          </Show>
        </button>

        <div style={{
          display: "inline-flex",
          background: "var(--surface-2)",
          border: "1px solid var(--m-border)",
          "border-radius": "var(--r)",
          padding: "2px",
        }}>
          <button
            class={`m-btn sm ghost ${props.viewMode === "list" ? "active" : ""}`}
            onClick={() => props.onSetViewMode("list")}
            title="List view"
            style={{ "box-shadow": "none" }}
          >List</button>
          <button
            class={`m-btn sm ghost ${props.viewMode === "grid" ? "active" : ""}`}
            onClick={() => props.onSetViewMode("grid")}
            title="Grid view"
            style={{ "box-shadow": "none" }}
          >Grid</button>
        </div>

        <button class="m-btn ghost" onClick={props.onSwitchToTerminal} title="Switch to terminal UI">
          terminal
        </button>
        <button class="m-btn ghost" onClick={props.onOpenPalette} title="Command palette (⌘K)">
          ⌘K
        </button>
      </div>
    </header>
  );
};

const ProjectTabs: Component<{
  projects: [string, number][];
  active: string;
  onChange: (v: string) => void;
  totalAll: number;
}> = (props) => {
  return (
    <div style={{
      flex: "0 0 auto",
      display: "flex",
      "align-items": "center",
      gap: "4px",
      padding: "8px 16px",
      "border-bottom": "1px solid var(--border-soft)",
      background: "var(--bg)",
      "overflow-x": "auto",
    }}>
      <button
        class={`m-tab ${props.active === "__all" ? "active" : ""}`}
        onClick={() => props.onChange("__all")}
      >
        <span>All sessions</span>
        <span class="count">{props.totalAll}</span>
      </button>
      <span style={{ width: "1px", height: "18px", background: "var(--m-border)", margin: "0 6px" }}></span>
      <For each={props.projects.slice(0, 12)}>
        {([path, count]) => {
          const label = path.split("/").filter(Boolean).pop() || path;
          return (
            <button
              class={`m-tab ${props.active === path ? "active" : ""}`}
              onClick={() => props.onChange(path)}
              title={path}
            >
              <span style={{ color: "var(--text-3)", "margin-right": "2px" }}>
                <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">
                  <path d="M1.5 4.5h4l1.5 1.5h7.5v7.5h-13z" />
                </svg>
              </span>
              <span>{label}</span>
              <span class="count">{count}</span>
            </button>
          );
        }}
      </For>
    </div>
  );
};

const SessionsPanel: Component<{
  rows: UnifiedSession[];
  selectedId: string | null;
  focusedIndex: number;
  onSelect: (s: UnifiedSession) => void;
  onContextMenu: (s: UnifiedSession, x: number, y: number) => void;
  pinnedSessionIds: Set<string>;
  viewMode: "list" | "grid";
}> = (props) => {
  return (
    <div style={{
      display: "flex",
      "flex-direction": "column",
      "min-height": 0,
      "border-right": "1px solid var(--border-soft)",
    }}>
      <div style={{
        flex: "0 0 auto",
        display: "flex",
        "align-items": "center",
        gap: "10px",
        padding: "10px 16px 8px",
      }}>
        <span style={{ color: "var(--text-3)", "font-size": "11px", "font-weight": 600, "letter-spacing": "0.04em", "text-transform": "uppercase" }}>
          Sessions
        </span>
        <span style={{ color: "var(--text-3)", "font-size": "12px" }}>
          {props.rows.length} total
        </span>
        <span style={{ "margin-left": "auto", color: "var(--text-3)", "font-size": "11px", "white-space": "nowrap" }}>
          sorted by status &middot; recency
        </span>
      </div>

      <div style={{ flex: 1, "min-height": 0, overflow: "auto", padding: "0 12px 12px" }}>
        <Show when={props.rows.length === 0}>
          <div style={{ padding: "40px", "text-align": "center", color: "var(--text-3)" }}>
            No sessions match your filters.
          </div>
        </Show>

        <Show
          when={props.viewMode === "grid"}
          fallback={
            <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
              <For each={props.rows}>
                {(s, i) => (
                  <SessionRowCard
                    s={s}
                    selected={props.selectedId === s.id}
                    pinned={props.pinnedSessionIds.has(s.id)}
                    index={i()}
                    focused={props.focusedIndex === i()}
                    onClick={() => props.onSelect(s)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      props.onContextMenu(s, e.clientX, e.clientY);
                    }}
                  />
                )}
              </For>
            </div>
          }
        >
          <div style={{
            display: "grid",
            "grid-template-columns": "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "10px",
          }}>
            <For each={props.rows}>
              {(s, i) => (
                <SessionGridCard
                  s={s}
                  selected={props.selectedId === s.id}
                  pinned={props.pinnedSessionIds.has(s.id)}
                  index={i()}
                  focused={props.focusedIndex === i()}
                  onClick={() => props.onSelect(s)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    props.onContextMenu(s, e.clientX, e.clientY);
                  }}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};

const StateRail: Component<{ state: ChatState }> = (props) => {
  const color = () =>
    props.state === "working" ? "var(--ok-line)" :
    props.state === "waiting" ? "var(--warn-line)" :
    "var(--m-border)";
  return (
    <span style={{
      width: "3px",
      "align-self": "stretch",
      background: color(),
      "border-radius": "2px",
      "flex-shrink": 0,
    }}></span>
  );
};

const SessionRowCard: Component<{
  s: UnifiedSession;
  selected: boolean;
  pinned: boolean;
  index: number;
  focused: boolean;
  onClick: () => void;
  onContextMenu: (e: MouseEvent) => void;
}> = (props) => {
  const state = () => chatState(props.s);
  const sm = () => stateMeta(state());
  const name = () => sessionName(props.s);

  return (
    <div
      data-card-index={props.index}
      ref={(el) => { if (props.focused) el?.scrollIntoView({ block: "nearest" }); }}
      class={`m-card hover ${props.selected ? "selected" : ""} ${state() === "waiting" && !props.selected ? "warn-tint" : ""}`}
      onClick={props.onClick}
      onContextMenu={props.onContextMenu}
      style={{
        cursor: "pointer",
        padding: "11px 14px",
        display: "flex",
        gap: "12px",
        "align-items": "flex-start",
        outline: props.focused && !props.selected ? "1px dashed var(--m-accent)" : "none",
        "outline-offset": "1px",
      }}
    >
      <StateRail state={state()} />
      <div style={{ flex: 1, "min-width": 0, display: "flex", "flex-direction": "column", gap: "6px" }}>
        <div style={{ display: "flex", "align-items": "center", gap: "8px", "min-width": 0 }}>
          <span class={`m-pill ${sm().cls}`}>
            <span class={`dot ${state() === "waiting" ? "m-pulse-dot" : ""}`}></span>
            {sm().label}
          </span>
          <Show when={props.s.pending_tool_use}>
            <span
              class="m-pill warn"
              title={`Pending: ${props.s.pending_tool_use!.tool_name}`}
              style={{ "font-size": "10.5px" }}
            >
              <span class="dot m-pulse-dot"></span>
              pending {props.s.pending_tool_use!.tool_name}
            </span>
          </Show>
          <Show when={props.pinned}>
            <span style={{ color: "var(--m-accent)" }} title="pinned">★</span>
          </Show>
          <span style={{
            color: "var(--m-text)",
            "font-weight": 600,
            "font-size": "13px",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
            "min-width": 0,
          }}>{name()}</span>
          <span style={{ "margin-left": "auto", color: "var(--text-3)", "font-size": "11px", "white-space": "nowrap" }}>
            {timeSince(props.s.updated_at)}
          </span>
        </div>

        <Show when={props.s.first_user_message_preview}>
          <div style={{
            color: "var(--text-2)",
            "font-size": "12px",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}>
            {props.s.first_user_message_preview}
          </div>
        </Show>

        <div style={{ display: "flex", "align-items": "center", gap: "10px", "flex-wrap": "wrap" }}>
          <span style={{
            display: "inline-flex", "align-items": "center", gap: "4px",
            color: "var(--text-3)", "font-size": "11px",
            overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap",
            "min-width": 0, "max-width": "65%",
            direction: "rtl",
            "text-align": "left",
          }} title={projectFullPath(props.s)}>
            {projectFullPath(props.s)}
          </span>
          <span class="mono" style={{ color: "var(--text-3)", "font-size": "11px" }}>
            {props.s.message_count} msgs
          </span>
          <ContextBar session={props.s} width="50px" modern />
        </div>
      </div>
    </div>
  );
};

const SessionGridCard: Component<{
  s: UnifiedSession;
  selected: boolean;
  pinned: boolean;
  index: number;
  focused: boolean;
  onClick: () => void;
  onContextMenu: (e: MouseEvent) => void;
}> = (props) => {
  const state = () => chatState(props.s);
  const sm = () => stateMeta(state());
  const name = () => sessionName(props.s);

  return (
    <div
      data-card-index={props.index}
      ref={(el) => { if (props.focused) el?.scrollIntoView({ block: "nearest" }); }}
      class={`m-card hover ${props.selected ? "selected" : ""} ${state() === "waiting" && !props.selected ? "warn-tint" : ""}`}
      onClick={props.onClick}
      onContextMenu={props.onContextMenu}
      style={{
        cursor: "pointer",
        padding: "14px",
        display: "flex",
        "flex-direction": "column",
        gap: "10px",
        "min-height": "160px",
        outline: props.focused && !props.selected ? "1px dashed var(--m-accent)" : "none",
        "outline-offset": "1px",
      }}
    >
      <div style={{ display: "flex", "align-items": "center", gap: "6px", "flex-wrap": "wrap" }}>
        <span class={`m-pill ${sm().cls}`}>
          <span class={`dot ${state() === "waiting" ? "m-pulse-dot" : ""}`}></span>
          {sm().label}
        </span>
        <Show when={props.s.pending_tool_use}>
          <span
            class="m-pill warn"
            title={`Pending: ${props.s.pending_tool_use!.tool_name}`}
            style={{ "font-size": "10.5px" }}
          >
            <span class="dot m-pulse-dot"></span>
            pending {props.s.pending_tool_use!.tool_name}
          </span>
        </Show>
        <Show when={props.pinned}>
          <span style={{ color: "var(--m-accent)" }} title="pinned">★</span>
        </Show>
        <span style={{ "margin-left": "auto", color: "var(--text-3)", "font-size": "11px" }}>
          {timeSince(props.s.updated_at)}
        </span>
      </div>

      <div style={{
        color: "var(--m-text)", "font-weight": 600, "font-size": "13.5px",
        "line-height": 1.35,
        overflow: "hidden", "text-overflow": "ellipsis",
        display: "-webkit-box",
        "-webkit-line-clamp": 2,
        "-webkit-box-orient": "vertical",
        "word-break": "break-word",
      }}>
        {name()}
      </div>

      <Show when={props.s.first_user_message_preview}>
        <div style={{
          color: "var(--text-2)", "font-size": "12px", "line-height": 1.4,
          overflow: "hidden", "text-overflow": "ellipsis",
          display: "-webkit-box",
          "-webkit-line-clamp": 2,
          "-webkit-box-orient": "vertical",
        }}>
          {props.s.first_user_message_preview}
        </div>
      </Show>

      <div style={{ flex: 1 }}></div>

      <div style={{
        "padding-top": "8px",
        "border-top": "1px solid var(--border-soft)",
        display: "flex", "align-items": "center", gap: "10px",
        color: "var(--text-3)", "font-size": "11px",
      }}>
        <span style={{
          flex: 1,
          overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap",
          direction: "rtl", "text-align": "left",
        }} title={projectFullPath(props.s)}>
          {projectFullPath(props.s)}
        </span>
        <span class="mono">{props.s.message_count} msgs</span>
        <ContextBar session={props.s} width="50px" modern />
      </div>
    </div>
  );
};

const DetailPanel: Component<{
  session: UnifiedSession | null;
  messages: UnifiedMessage[];
  toolStats: ToolStat[];
  tailing: boolean;
  onToggleTail: () => void;
  onTogglePin: (id: string) => void;
  isPinned: boolean;
  onSendTmux: (pane: string, text: string) => Promise<void>;
  detailHeight: number;
  onVResizeStart: (e: MouseEvent) => void;
  pendingList: PendingToolCall[];
  pendingIds: Set<string>;
  firstPendingId: string | null;
  onRequestBind?: (s: UnifiedSession) => void;
}> = (props) => {
  return (
    <Show
      when={props.session}
      fallback={
        <div style={{
          flex: 1,
          background: "var(--surface)",
          display: "flex", "align-items": "center", "justify-content": "center",
          color: "var(--text-3)",
        }}>
          Select a session to view.
        </div>
      }
    >
      <div style={{
        flex: 1,
        background: "var(--surface)",
        display: "flex", "flex-direction": "column", "min-height": 0,
      }}>
        <div style={{
          height: `${props.detailHeight}px`,
          "flex-shrink": 0,
          "overflow-y": "auto",
        }}>
          <SessionHeader
            session={props.session!}
            tailing={props.tailing}
            onToggleTail={props.onToggleTail}
            onTogglePin={props.onTogglePin}
            isPinned={props.isPinned}
            toolStats={props.toolStats}
            onRequestBind={props.onRequestBind}
          />
        </div>
        <div
          onMouseDown={props.onVResizeStart}
          title="drag to resize"
          style={{
            height: "4px",
            cursor: "row-resize",
            background: "var(--border-soft)",
            "flex-shrink": 0,
            "user-select": "none",
          }}
        ></div>
        <Conversation
          messages={props.messages}
          tailing={props.tailing}
          state={chatState(props.session!)}
          pendingIds={props.pendingIds}
          firstPendingId={props.firstPendingId}
          pane={props.session!.tmux_pane}
        />
        <PendingToolBar
          pending={props.pendingList}
          pane={props.session!.tmux_pane}
        />
        <ModeBar
          pane={props.session!.tmux_pane}
          sessionId={props.session!.id}
        />
        <ReplyBar session={props.session!} onSend={props.onSendTmux} />
      </div>
    </Show>
  );
};

const SessionHeader: Component<{
  session: UnifiedSession;
  tailing: boolean;
  onToggleTail: () => void;
  onTogglePin: (id: string) => void;
  isPinned: boolean;
  toolStats: ToolStat[];
  onRequestBind?: (s: UnifiedSession) => void;
}> = (props) => {
  const s = () => props.session;
  const state = () => chatState(s());
  const sm = () => stateMeta(state());

  const palette = ["#6c4cf2", "#4f7df0", "#1d9c6a", "#d97706", "#dc2626", "#7c7c7c", "#94a3b8", "#a78bfa"];
  const total = () => props.toolStats.reduce((a, t) => a + t.call_count, 0) || 1;

  return (
    <div style={{ padding: "14px 18px", "border-bottom": "1px solid var(--border-soft)" }}>
      <div style={{ display: "flex", "align-items": "center", gap: "10px" }}>
        <span class={`m-pill ${sm().cls}`}>
          <span class={`dot ${state() === "waiting" ? "m-pulse-dot" : ""}`}></span>
          {sm().label}
        </span>
        <span style={{ "margin-left": "auto", display: "flex", gap: "6px" }}>
          <button class={`m-btn sm ${props.tailing ? "active" : ""}`} onClick={props.onToggleTail}>
            <Show when={props.tailing} fallback={
              <span style={{ width: "6px", height: "6px", "border-radius": "999px", background: "var(--text-4)" }}></span>
            }>
              <span class="m-live-dot"></span>
            </Show>
            {props.tailing ? "Live" : "Tail"}
          </button>
          <button class={`m-btn sm ${props.isPinned ? "active" : ""}`} onClick={() => props.onTogglePin(s().id)}>
            {props.isPinned ? "★ Pinned" : "☆ Pin"}
          </button>
        </span>
      </div>

      <h2 style={{
        margin: "10px 0 4px",
        "font-size": "17px",
        "font-weight": 600,
        "letter-spacing": "-0.01em",
        "word-break": "break-word",
        color: "var(--m-text)",
      }}>{sessionName(s())}</h2>

      <Show when={s().first_user_message_preview}>
        <p style={{ margin: 0, color: "var(--text-2)", "font-size": "12.5px", "line-height": 1.5 }}>
          {s().first_user_message_preview}
        </p>
      </Show>

      <div style={{ display: "flex", "flex-wrap": "wrap", gap: "6px 14px", "margin-top": "12px", color: "var(--text-3)", "font-size": "11.5px" }}>
        <span style={{
          display: "inline-flex",
          "align-items": "center",
          gap: "5px",
          overflow: "hidden",
          "text-overflow": "ellipsis",
          "white-space": "nowrap",
          "max-width": "60%",
        }} title={projectFullPath(s())}>
          <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M1.5 4.5h4l1.5 1.5h7.5v7.5h-13z" />
          </svg>
          <span class="mono" style={{ color: "var(--text-2)" }} >{projectFullPath(s())}</span>
        </span>
        <Show when={s().model}>
          <span class="mono" style={{ color: "var(--text-3)", "white-space": "nowrap" }}>{s().model}</span>
        </Show>
        <span class="mono" style={{ color: "var(--text-3)", "white-space": "nowrap" }}>{s().message_count} msgs</span>
        <span style={{ display: "inline-flex", "align-items": "center", gap: "5px" }}>
          <ContextBar session={s()} width="80px" modern />
          <span class="mono" style={{ color: "var(--text-3)" }}>ctx</span>
        </span>
        <Show when={s().tmux_pane}>
          <PaneSourceBadge
            pane={s().tmux_pane}
            source={s().pane_source}
            onBind={() => props.onRequestBind?.(s())}
            modern
          />
        </Show>
        <Show when={!s().tmux_pane}>
          <button
            type="button"
            class="dc-pending-btn"
            onClick={() => props.onRequestBind?.(s())}
            style={{ "font-size": "10.5px" }}
          >
            bind tmux pane…
          </button>
        </Show>
      </div>

      <Show when={props.toolStats.length > 0}>
        <div style={{ "margin-top": "14px" }}>
          <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-bottom": "6px" }}>
            <span style={{ "font-size": "10.5px", "font-weight": 600, "letter-spacing": "0.04em", "text-transform": "uppercase", color: "var(--text-3)" }}>
              Tools
            </span>
            <span class="mono" style={{ "font-size": "11px", color: "var(--text-3)" }}>{total()} calls</span>
          </div>
          <div style={{ display: "flex", height: "8px", "border-radius": "4px", overflow: "hidden", background: "var(--surface-3)" }}>
            <For each={props.toolStats}>
              {(t, i) => (
                <span title={`${t.tool_name}: ${t.call_count}`} style={{
                  width: `${(t.call_count / total()) * 100}%`,
                  background: palette[i() % palette.length],
                }}></span>
              )}
            </For>
          </div>
          <div style={{ display: "flex", "flex-wrap": "wrap", gap: "6px", "margin-top": "8px" }}>
            <For each={props.toolStats.slice(0, 10)}>
              {(t, i) => (
                <span style={{
                  display: "inline-flex", "align-items": "center", gap: "5px",
                  color: "var(--text-2)", "font-size": "11px",
                }}>
                  <span style={{
                    width: "8px", height: "8px", "border-radius": "2px",
                    background: palette[i() % palette.length],
                  }}></span>
                  <span>{t.tool_name}</span>
                  <span class="mono" style={{ color: "var(--text-3)" }}>{t.call_count}</span>
                </span>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
};

const Conversation: Component<{
  messages: UnifiedMessage[];
  tailing: boolean;
  state: ChatState;
  pendingIds?: Set<string>;
  firstPendingId?: string | null;
  pane?: string | null;
}> = (props) => {
  let scrollRef: HTMLDivElement | undefined;

  const visibleMessages = createMemo(() =>
    props.messages.filter((m) => {
      const hasRenderable = m.content.some(
        (b) =>
          (b.type === "text" && b.text.trim().length > 0) ||
          (b.type === "thinking" && b.text.trim().length > 0) ||
          b.type === "tool_call"
      );
      return hasRenderable;
    })
  );

  const toolResultsMap = createMemo(() => {
    const map = new Map<string, any>();
    for (const msg of props.messages) {
      for (const block of msg.content) {
        if (block.type === "tool_result") {
          map.set(block.tool_id, block);
        }
      }
    }
    return map;
  });

  const getToolResult = (id: string) => toolResultsMap().get(id);

  const [expandedTools, setExpandedTools] = createSignal<Set<string>>(new Set());
  const isToolExpanded = (id: string) => expandedTools().has(id);
  const toggleToolExpanded = (id: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  let lastFirstMsgId: string | null = null;
  let lastMsgCount = 0;
  let lastTailing = false;
  createEffect(() => {
    if (!scrollRef) return;
    const msgs = visibleMessages();
    const msgCount = msgs.length;
    const tailing = !!props.tailing;
    const firstMsgId = msgs[0]?.id ?? null;
    if (msgCount === 0) {
      lastFirstMsgId = firstMsgId;
      lastMsgCount = 0;
      lastTailing = tailing;
      return;
    }
    const newSession = firstMsgId !== lastFirstMsgId;
    const newMessages = !newSession && msgCount > lastMsgCount;
    const tailingTurnedOn = tailing && !lastTailing;
    if (newSession) {
      if (tailing) {
        queueMicrotask(() => {
          if (scrollRef) scrollRef.scrollTop = scrollRef.scrollHeight;
        });
      } else if (scrollRef) {
        scrollRef.scrollTop = 0;
      }
      setExpandedTools(new Set<string>());
    } else if (tailing && (newMessages || tailingTurnedOn)) {
      queueMicrotask(() => {
        if (scrollRef) scrollRef.scrollTop = scrollRef.scrollHeight;
      });
    }
    lastFirstMsgId = firstMsgId;
    lastMsgCount = msgCount;
    lastTailing = tailing;
  });

  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1, "min-height": 0, overflow: "auto",
        padding: "18px 18px 24px",
        background: "var(--bg)",
      }}
    >
      <For each={visibleMessages()}>
        {(msg) => (
          <Show
            when={msg._optimistic}
            fallback={
              <MessageBlock
                message={msg}
                getToolResult={getToolResult}
                pendingIds={props.pendingIds}
                firstPendingId={props.firstPendingId ?? null}
                pane={props.pane ?? null}
                isToolExpanded={isToolExpanded}
                onToggleToolExpanded={toggleToolExpanded}
              />
            }
          >
            <div style={{ opacity: 0.55 }}>
              <MessageBlock
                message={msg}
                getToolResult={getToolResult}
                pendingIds={props.pendingIds}
                firstPendingId={props.firstPendingId ?? null}
                pane={props.pane ?? null}
                isToolExpanded={isToolExpanded}
                onToggleToolExpanded={toggleToolExpanded}
              />
              <div style={{
                "font-size": "10px",
                color: "var(--text-3, var(--ink-3))",
                "font-style": "italic",
                padding: "0 0 8px 2px",
              }}>
                sending…
              </div>
            </div>
          </Show>
        )}
      </For>

      <Show when={props.tailing && props.state === "working"}>
        <div style={{
          display: "flex", "align-items": "center", gap: "8px",
          color: "var(--text-3)", "font-size": "12px",
          padding: "8px 0",
        }}>
          <span class="m-live-dot"></span>
          <span>Claude is typing…</span>
        </div>
      </Show>
      <Show when={props.tailing && props.state === "waiting"}>
        <div style={{ color: "var(--text-3)", "font-size": "12px", padding: "8px 0", "font-style": "italic" }}>
          Waiting for your input…
        </div>
      </Show>
    </div>
  );
};

const ReplyBar: Component<{
  session: UnifiedSession;
  onSend: (pane: string, text: string) => Promise<void>;
}> = (props) => {
  const [sending, setSending] = createSignal(false);
  const [status, setStatus] = createSignal<string | null>(null);
  const [slashQuery, setSlashQuery] = createSignal<string | null>(null);
  const [xmlTags, setXmlTags] = createSignal<string[]>([]);
  let textareaRef: HTMLTextAreaElement | undefined;
  let popupKeyHandler: ((e: KeyboardEvent) => boolean) | null = null;
  let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;

  const computeSlashQuery = (v: string): string | null => {
    if (!v.startsWith("/")) return null;
    if (v.includes("\n")) return null;
    if (v.includes(" ")) return null;
    return v.slice(1);
  };

  const resize = () => {
    if (!textareaRef) return;
    textareaRef.style.height = "auto";
    textareaRef.style.height = Math.min(textareaRef.scrollHeight, 200) + "px";
  };

  createEffect(() => {
    const id = props.session.id;
    const draft = getDraft(id);
    if (textareaRef) {
      textareaRef.value = draft;
      resize();
    }
    setSlashQuery(computeSlashQuery(draft));
    setXmlTags(detectXmlTags(draft));
    setStatus(null);
  });

  onCleanup(() => {
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
  });

  const scheduleDraftSave = (id: string, value: string) => {
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => setDraft(id, value), 250);
  };

  const onSlashSelect = (name: string) => {
    if (!textareaRef) return;
    const next = `/${name} `;
    textareaRef.value = next;
    setSlashQuery(null);
    scheduleDraftSave(props.session.id, next);
    resize();
    queueMicrotask(() => {
      if (!textareaRef) return;
      textareaRef.focus();
      textareaRef.setSelectionRange(next.length, next.length);
    });
  };

  const hasPane = () => !!props.session.tmux_pane;

  const send = async () => {
    if (!textareaRef) return;
    const body = textareaRef.value;
    if (!hasPane() || !body.trim() || sending()) return;
    setSending(true);
    setStatus(null);
    try {
      await props.onSend(props.session.tmux_pane!, body);
      textareaRef.value = "";
      resize();
      setSlashQuery(null);
      setXmlTags([]);
      clearDraft(props.session.id);
      setStatus("sent");
      setTimeout(() => setStatus(null), 1500);
      textareaRef.focus();
    } catch (e) {
      setStatus(`failed: ${String(e).slice(0, 80)}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{
      flex: "0 0 auto",
      padding: "10px 12px",
      "border-top": "1px solid var(--border-soft)",
      background: "var(--surface)",
    }}>
      <Show when={!hasPane()}>
        <div style={{ color: "var(--text-3)", "font-size": "11.5px", "margin-bottom": "4px", "font-style": "italic" }}>
          no tmux pane detected — sending disabled
        </div>
      </Show>
      <Show when={status()}>
        <div style={{
          color: status() === "sent" ? "var(--m-ok)" : "var(--m-warn)",
          "font-size": "11.5px",
          "margin-bottom": "4px",
        }}>
          {status()}
        </div>
      </Show>
      <Show when={xmlTags().length > 0}>
        <div class="dc-xml-indicator" style={{ "margin-bottom": "4px" }}>
          <span class="dc-xml-label">tags</span>
          <For each={xmlTags()}>
            {(name) => <span class="dc-xml-tag">{`<${name}>`}</span>}
          </For>
        </div>
      </Show>
      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        style={{
          display: "flex", "align-items": "flex-end", gap: "8px",
          padding: "6px 6px 6px 12px",
          background: "var(--bg)",
          border: "1px solid var(--m-border)",
          "border-radius": "10px",
          opacity: hasPane() ? 1 : 0.55,
          position: "relative",
        }}
      >
        <SlashCommandPopup
          cwd={props.session.cwd}
          query={slashQuery()}
          onSelect={onSlashSelect}
          onClose={() => setSlashQuery(null)}
          registerKeyHandler={(h) => { popupKeyHandler = h; }}
        />
        <textarea
          ref={textareaRef}
          placeholder={hasPane() ? "Reply to Claude… (Enter to send · Shift+Enter for newline · / for commands)" : "no tmux pane"}
          disabled={!hasPane() || sending()}
          rows={1}
          onInput={(e) => {
            const v = e.currentTarget.value;
            setSlashQuery(computeSlashQuery(v));
            scheduleDraftSave(props.session.id, v);
            setXmlTags(detectXmlTags(v));
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = Math.min(el.scrollHeight, 200) + "px";
          }}
          onKeyDown={(e) => {
            if (popupKeyHandler && popupKeyHandler(e)) return;
            if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              send();
            }
          }}
          style={{
            flex: 1,
            background: "transparent",
            border: 0,
            outline: 0,
            color: "var(--m-text)",
            "font-family": "inherit",
            "font-size": "13px",
            resize: "none",
            "min-height": "20px",
            "max-height": "200px",
            "padding-top": "6px",
            "padding-bottom": "6px",
            "line-height": "1.4",
          }}
        />
        <button
          type="submit"
          class="m-btn primary sm"
          disabled={!hasPane() || sending()}
        >
          {sending() ? "Sending…" : "Send ↵"}
        </button>
      </form>
    </div>
  );
};

const StatusBar: Component<{ counts: ModernAppProps["counts"] }> = (props) => {
  return (
    <footer style={{
      flex: "0 0 auto",
      display: "flex", "align-items": "center", gap: "14px",
      padding: "6px 16px",
      "border-top": "1px solid var(--border-soft)",
      background: "var(--bg)",
      color: "var(--text-3)",
      "font-size": "11px",
    }}>
      <span style={{ display: "inline-flex", "align-items": "center", gap: "5px" }}>
        <span style={{ width: "6px", height: "6px", "border-radius": "999px", background: "var(--m-ok)" }}></span>
        Working <b style={{ color: "var(--m-text)" }}>{props.counts.active}</b>
      </span>
      <span style={{ display: "inline-flex", "align-items": "center", gap: "5px" }}>
        <span style={{ width: "6px", height: "6px", "border-radius": "999px", background: "var(--m-warn)" }}></span>
        Needs input <b style={{ color: "var(--m-text)" }}>{props.counts.waiting}</b>
      </span>
      <span style={{ display: "inline-flex", "align-items": "center", gap: "5px" }}>
        <span style={{ width: "6px", height: "6px", "border-radius": "999px", background: "var(--text-4)" }}></span>
        Idle <b style={{ color: "var(--m-text)" }}>{props.counts.idle}</b>
      </span>
      <span style={{ "margin-left": "auto", display: "inline-flex", gap: "12px" }}>
        <span><span class="m-kbd">/</span> search</span>
        <span><span class="m-kbd">i</span> inbox</span>
        <span><span class="m-kbd">j</span><span class="m-kbd">k</span> nav</span>
        <span><span class="m-kbd">↵</span> open</span>
      </span>
    </footer>
  );
};

export default ModernApp;
