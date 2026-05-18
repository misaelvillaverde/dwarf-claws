import { Component, createEffect, createMemo, For, Show } from "solid-js";
import type { UnifiedSession } from "../lib/types";
import { chatState, ChatState, projectFullPath, sessionName, timeSince } from "../lib/sessionState";
import ContextBar from "./ContextBar";

interface Props {
  sortedSessions: UnifiedSession[];
  selectedId: string | null;
  focusedIndex: number;
  onSelect: (session: UnifiedSession) => void;
  onContextMenu?: (session: UnifiedSession, x: number, y: number) => void;
  highlightedSessionIds?: Set<string> | null;
  pinnedSessionIds?: Set<string>;
  inboxBanner?: { count: number; onClick: () => void } | null;
  groupByProject?: boolean;
  viewMode?: "list" | "grid";
}

function stateMeta(s: ChatState): { cls: string; label: string; accent: string } {
  if (s === "working") return { cls: "ok",   label: "WORK", accent: "var(--ok)" };
  if (s === "waiting") return { cls: "warn", label: "WAIT", accent: "var(--warn)" };
  return { cls: "idle", label: "IDLE", accent: "var(--rule)" };
}

interface Group {
  key: string;
  name: string;
  rows: UnifiedSession[];
  startIndex: number;
}

const CCList: Component<Props> = (props) => {
  const rowRefs: HTMLDivElement[] = [];

  createEffect(() => {
    const idx = props.focusedIndex;
    if (idx < 0 || idx >= rowRefs.length) return;
    const el = rowRefs[idx];
    if (el) el.scrollIntoView({ block: "nearest" });
  });

  const groups = createMemo<Group[]>(() => {
    const list = props.sortedSessions;
    if (!props.groupByProject) {
      return [{ key: "__all", name: "all sessions", rows: list, startIndex: 0 }];
    }
    const byProj = new Map<string, UnifiedSession[]>();
    for (const s of list) {
      const k = projectFullPath(s);
      if (!byProj.has(k)) byProj.set(k, []);
      byProj.get(k)!.push(s);
    }
    let cursor = 0;
    const out: Group[] = [];
    for (const [name, rows] of byProj) {
      out.push({ key: name, name, rows, startIndex: cursor });
      cursor += rows.length;
    }
    return out;
  });

  const countsFor = (rows: UnifiedSession[]) => {
    let working = 0, waiting = 0, idle = 0;
    for (const s of rows) {
      const st = chatState(s);
      if (st === "working") working++;
      else if (st === "waiting") waiting++;
      else idle++;
    }
    return { working, waiting, idle };
  };

  const renderRow = (s: UnifiedSession, globalIdx: number) => {
    const state = chatState(s);
    const sm = stateMeta(state);
    const isSelected = () => props.selectedId === s.id;
    const isFocused = () => props.focusedIndex === globalIdx;
    const isHighlighted = () => props.highlightedSessionIds?.has(s.id) ?? false;
    const isPinned = () => props.pinnedSessionIds?.has(s.id) ?? false;
    const name = () => sessionName(s);

    return (
      <div
        ref={(el) => (rowRefs[globalIdx] = el)}
        class={`row ${isSelected() ? "selected" : ""} ${isFocused() ? "focused" : ""}`}
        onClick={() => props.onSelect(s)}
        onContextMenu={(e) => {
          e.preventDefault();
          props.onContextMenu?.(s, e.clientX, e.clientY);
        }}
        style={{
          display: "grid",
          "grid-template-columns": "70px minmax(0, 1fr) 120px 70px 56px 40px",
          gap: "10px",
          "align-items": "center",
          padding: "var(--row-py) var(--row-px)",
          "border-bottom": "1px solid var(--rule-soft)",
          "border-left": isFocused() ? "2px solid var(--accent)" : "2px solid transparent",
          "font-size": "12px",
          background: isHighlighted() && !isSelected() && !isFocused()
            ? "var(--paper-3)" : undefined,
        }}
      >
        <span class={`chip ${sm.cls}`} style={{ width: "64px", "justify-content": "flex-start" }}>
          <span class="dot"></span>{sm.label}
        </span>

        <span style={{ "min-width": 0, display: "flex", "align-items": "center", gap: "8px" }}>
          <Show when={isPinned()}>
            <span style={{ color: "var(--accent)" }} title="pinned">&#9733;</span>
          </Show>
          <Show when={s.pending_tool_use}>
            <span
              class="chip warn"
              title={`Pending: ${s.pending_tool_use!.tool_name}`}
              style={{ "font-size": "10px" }}
            >
              <span class="dot"></span>
              {s.pending_tool_use!.tool_name}
            </span>
          </Show>
          <span style={{
            color: "var(--ink)",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}>
            {name()}
          </span>
          <Show when={state === "waiting" && s.first_user_message_preview}>
            <span class="ink-mid" style={{
              overflow: "hidden",
              "text-overflow": "ellipsis",
              "white-space": "nowrap",
              "font-style": "italic",
              "font-size": "11.5px",
            }}>
              &middot; {s.first_user_message_preview}
            </span>
          </Show>
        </span>

        <span class="ink-faint" style={{
          "font-size": "11px",
          overflow: "hidden",
          "text-overflow": "ellipsis",
          "white-space": "nowrap",
          direction: "rtl",
          "text-align": "right",
        }}>
          {projectFullPath(s)}
        </span>

        <span style={{ display: "flex", "justify-content": "flex-end" }}>
          <ContextBar session={s} width="60px" />
        </span>

        <span class="ink-faint" style={{ "text-align": "right", "font-size": "11px" }}>
          {s.message_count >= 1000
            ? `${(s.message_count / 1000).toFixed(1)}k`
            : s.message_count}
        </span>

        <span class="ink-faint" style={{ "text-align": "right", "font-size": "11px" }}>
          {timeSince(s.updated_at)}
        </span>
      </div>
    );
  };

  const renderCard = (s: UnifiedSession, globalIdx: number) => {
    const state = chatState(s);
    const sm = stateMeta(state);
    const isSelected = () => props.selectedId === s.id;
    const isFocused = () => props.focusedIndex === globalIdx;
    const isPinned = () => props.pinnedSessionIds?.has(s.id) ?? false;
    const name = () => sessionName(s);
    const isWaiting = state === "waiting";

    return (
      <div
        ref={(el) => (rowRefs[globalIdx] = el)}
        data-card-index={globalIdx}
        class="row"
        onClick={() => props.onSelect(s)}
        onContextMenu={(e) => {
          e.preventDefault();
          props.onContextMenu?.(s, e.clientX, e.clientY);
        }}
        style={{
          cursor: "pointer",
          background: isSelected()
            ? "var(--accent-bg)"
            : isWaiting
            ? "var(--warn-bg)"
            : "var(--paper-2)",
          border: "1px solid var(--rule)",
          "border-left": `3px solid ${sm.accent}`,
          outline: isFocused() ? "1px dashed var(--accent)" : "none",
          "outline-offset": "1px",
          padding: "10px",
          display: "flex",
          "flex-direction": "column",
          gap: "6px",
          "min-height": "120px",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", "align-items": "center", gap: "6px", "flex-wrap": "wrap" }}>
          <span class={`chip ${sm.cls}`}>
            <span class="dot"></span>{sm.label}
          </span>
          <Show when={s.pending_tool_use}>
            <span
              class="chip warn"
              title={`Pending: ${s.pending_tool_use!.tool_name}`}
              style={{ "font-size": "10px" }}
            >
              <span class="dot"></span>
              {s.pending_tool_use!.tool_name}
            </span>
          </Show>
          <Show when={isPinned()}>
            <span style={{ color: "var(--accent)", "font-size": "12px" }} title="pinned">&#9733;</span>
          </Show>
          <span class="ink-faint" style={{ "margin-left": "auto", "font-size": "10.5px" }}>
            {timeSince(s.updated_at)} &middot;{" "}
            {s.message_count >= 1000
              ? `${(s.message_count / 1000).toFixed(1)}k`
              : s.message_count}{" "}
            msgs
          </span>
        </div>

        <div style={{
          color: "var(--ink)",
          "font-weight": 600,
          "font-size": "12.5px",
          "line-height": 1.3,
          overflow: "hidden",
          "text-overflow": "ellipsis",
          display: "-webkit-box",
          "-webkit-line-clamp": 2,
          "-webkit-box-orient": "vertical",
          "word-break": "break-word",
        }}>
          {name()}
        </div>

        <Show when={s.first_user_message_preview}>
          <div class="ink-mid" style={{
            "font-size": "11px",
            "font-style": "italic",
            "line-height": 1.4,
            overflow: "hidden",
            "text-overflow": "ellipsis",
            display: "-webkit-box",
            "-webkit-line-clamp": 2,
            "-webkit-box-orient": "vertical",
          }}>
            &ldquo;{s.first_user_message_preview}&rdquo;
          </div>
        </Show>

        <div style={{ flex: 1 }}></div>

        <div style={{
          "border-top": "1px dashed var(--rule-soft)",
          "padding-top": "4px",
          "margin-top": "2px",
          display: "flex",
          "align-items": "center",
          gap: "8px",
        }}>
          <span class="ink-faint" style={{
            "font-size": "10.5px",
            flex: 1,
            "min-width": 0,
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
            direction: "rtl",
            "text-align": "left",
          }} title={projectFullPath(s)}>
            {projectFullPath(s)}
          </span>
          <ContextBar session={s} width="50px" />
        </div>
      </div>
    );
  };

  return (
    <div class="frame-body" style={{ flex: 1 }}>
      <div style={{
        display: "flex",
        "align-items": "center",
        gap: "10px",
        padding: "5px 12px",
        "border-bottom": "1px solid var(--rule)",
        background: "var(--paper-2)",
        "font-size": "11px",
        "flex-shrink": 0,
      }}>
        <span class="bracket-title">[<b>sessions</b>]</span>
        <span class="ink-faint" style={{ "font-size": "10.5px" }}>
          {props.sortedSessions.length} shown
        </span>
        <Show when={props.viewMode !== "grid"}>
          <span style={{
            "margin-left": "auto",
            "font-size": "10px",
            color: "var(--ink-4)",
            "letter-spacing": "0.08em",
            "text-transform": "uppercase",
          }}>
            status &middot; session &middot; project &middot; ctx &middot; msgs &middot; age
          </span>
        </Show>
      </div>

      <Show when={props.inboxBanner}>
        {(b) => (
          <div
            onClick={() => b().onClick()}
            style={{
              display: "flex",
              "align-items": "center",
              gap: "8px",
              padding: "5px 12px",
              background: "var(--warn-bg)",
              "border-bottom": "1px solid var(--rule)",
              color: "var(--warn)",
              cursor: "pointer",
              "font-size": "11.5px",
              "font-weight": 600,
            }}
          >
            <span style={{ width: "6px", height: "6px", "border-radius": "50%", background: "currentColor" }}></span>
            <span>{b().count} session{b().count === 1 ? "" : "s"} waiting for your input</span>
            <span class="ink-mid" style={{ "margin-left": "auto", "font-weight": 400, "font-size": "11px" }}>
              click to focus inbox &rarr;
            </span>
          </div>
        )}
      </Show>

      <div style={{ flex: 1, overflow: "auto" }}>
        <Show when={props.sortedSessions.length === 0}>
          <div class="ink-faint" style={{ padding: "20px", "text-align": "center", "font-style": "italic" }}>
            no sessions match
          </div>
        </Show>

        <For each={groups()}>
          {(g) => {
            const c = countsFor(g.rows);
            return (
              <section>
                <Show when={props.groupByProject !== false}>
                  <div style={{
                    padding: "6px 12px 3px 10px",
                    display: "flex",
                    "align-items": "baseline",
                    gap: "10px",
                    background: "var(--paper-2)",
                    "border-top": "1px solid var(--rule-soft)",
                    "border-bottom": "1px dashed var(--rule-soft)",
                    position: "sticky",
                    top: 0,
                    "z-index": 1,
                  }}>
                    <span
                      style={{
                        color: "var(--ink)",
                        "font-weight": 600,
                        overflow: "hidden",
                        "text-overflow": "ellipsis",
                        "white-space": "nowrap",
                        direction: "rtl",
                        "text-align": "left",
                        flex: 1,
                        "min-width": 0,
                      }}
                      title={g.name}
                    >
                      {g.name}
                    </span>
                    <span class="ink-faint" style={{ "font-size": "11px" }}>&middot; {g.rows.length}</span>
                    <span style={{ "margin-left": "auto", display: "inline-flex", gap: "10px", "font-size": "10.5px" }}>
                      <Show when={c.working > 0}>
                        <span style={{ color: "var(--ok)" }}>&bull; {c.working} working</span>
                      </Show>
                      <Show when={c.waiting > 0}>
                        <span style={{ color: "var(--warn)" }}>&bull; {c.waiting} waiting</span>
                      </Show>
                      <Show when={c.idle > 0}>
                        <span class="ink-faint">&bull; {c.idle} idle</span>
                      </Show>
                    </span>
                  </div>
                </Show>

                <Show
                  when={props.viewMode === "grid"}
                  fallback={
                    <For each={g.rows}>
                      {(s, j) => renderRow(s, g.startIndex + j())}
                    </For>
                  }
                >
                  <div style={{
                    display: "grid",
                    "grid-template-columns": "repeat(auto-fill, minmax(240px, 1fr))",
                    gap: "8px",
                    padding: "10px",
                  }}>
                    <For each={g.rows}>
                      {(s, j) => renderCard(s, g.startIndex + j())}
                    </For>
                  </div>
                </Show>
              </section>
            );
          }}
        </For>
      </div>
    </div>
  );
};

export default CCList;
