import { Component, For, Show, createSignal, createEffect, onCleanup } from "solid-js";
import { listTmuxPanes, type TmuxPaneInfo } from "../lib/api";

interface Props {
  open: boolean;
  sessionId: string;
  sessionCwd: string | null;
  currentPane: string | null;
  onPick: (pane: string | null) => void;
  onClose: () => void;
}

const TmuxBindingPicker: Component<Props> = (props) => {
  const [panes, setPanes] = createSignal<TmuxPaneInfo[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [filter, setFilter] = createSignal("");

  createEffect(() => {
    if (!props.open) return;
    setLoading(true);
    setError(null);
    listTmuxPanes()
      .then((list) => setPanes(list))
      .catch((e) => setError(`failed: ${String(e).slice(0, 80)}`))
      .finally(() => setLoading(false));
  });

  const onKey = (e: KeyboardEvent) => {
    if (!props.open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    }
  };

  createEffect(() => {
    if (props.open) {
      document.addEventListener("keydown", onKey);
    } else {
      document.removeEventListener("keydown", onKey);
    }
  });

  onCleanup(() => document.removeEventListener("keydown", onKey));

  const visible = () => {
    const q = filter().trim().toLowerCase();
    const list = panes();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.pane.toLowerCase().includes(q) ||
        p.session.toLowerCase().includes(q) ||
        p.window_name.toLowerCase().includes(q) ||
        p.cwd.toLowerCase().includes(q),
    );
  };

  const sameCwd = (p: TmuxPaneInfo) =>
    props.sessionCwd && p.cwd === props.sessionCwd;

  return (
    <Show when={props.open}>
      <div
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
        style={{
          position: "fixed",
          inset: "0",
          background: "rgba(0,0,0,0.45)",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "z-index": 1000,
        }}
      >
        <div
          style={{
            width: "min(640px, 92vw)",
            "max-height": "78vh",
            background: "var(--paper-2, var(--surface, white))",
            color: "var(--ink, var(--m-text))",
            border: "1px solid var(--rule, var(--m-border))",
            "border-radius": "10px",
            display: "flex",
            "flex-direction": "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "10px 14px",
              "border-bottom": "1px solid var(--rule-soft, var(--border-soft))",
              display: "flex",
              "align-items": "center",
              gap: "10px",
            }}
          >
            <span style={{ "font-weight": 600 }}>Bind to tmux pane</span>
            <span class="ink-faint" style={{ "font-size": "11px" }}>
              session {props.sessionId.slice(0, 8)}
            </span>
            <span style={{ "margin-left": "auto", display: "flex", gap: "6px" }}>
              <Show when={props.currentPane}>
                <button
                  type="button"
                  class="dc-pending-btn warn"
                  onClick={() => {
                    props.onPick(null);
                    props.onClose();
                  }}
                >
                  Clear binding
                </button>
              </Show>
              <button type="button" class="dc-pending-btn ghost" onClick={() => props.onClose()}>
                Cancel
              </button>
            </span>
          </div>
          <div style={{ padding: "8px 14px", "border-bottom": "1px solid var(--rule-soft, var(--border-soft))" }}>
            <input
              autofocus
              placeholder="filter…"
              value={filter()}
              onInput={(e) => setFilter(e.currentTarget.value)}
              style={{
                width: "100%",
                padding: "6px 8px",
                background: "var(--paper-3, var(--surface-3, rgba(0,0,0,0.04)))",
                border: "1px solid var(--rule, var(--m-border))",
                color: "var(--ink, var(--m-text))",
                font: "inherit",
                "font-size": "12px",
                outline: "none",
              }}
            />
          </div>
          <div style={{ flex: 1, "min-height": 0, overflow: "auto" }}>
            <Show when={loading()}>
              <div class="ink-faint" style={{ padding: "14px", "text-align": "center" }}>loading…</div>
            </Show>
            <Show when={error()}>
              <div style={{ padding: "14px", color: "var(--warn)" }}>{error()}</div>
            </Show>
            <Show when={!loading() && !error() && visible().length === 0}>
              <div class="ink-faint" style={{ padding: "14px", "text-align": "center", "font-style": "italic" }}>
                no panes match
              </div>
            </Show>
            <For each={visible()}>
              {(p) => (
                <div
                  onClick={() => {
                    props.onPick(p.pane);
                    props.onClose();
                  }}
                  style={{
                    padding: "8px 14px",
                    cursor: "pointer",
                    "border-bottom": "1px solid var(--rule-soft, var(--border-soft))",
                    display: "flex",
                    "align-items": "center",
                    gap: "8px",
                    background:
                      props.currentPane === p.pane
                        ? "var(--accent-soft, var(--surface-3))"
                        : undefined,
                  }}
                >
                  <span
                    class="mono"
                    style={{
                      "font-weight": 600,
                      "min-width": "92px",
                      color: "var(--ink, var(--m-text))",
                    }}
                  >
                    {p.pane}
                  </span>
                  <Show when={p.has_claude}>
                    <span
                      class="dc-pending-btn"
                      style={{
                        "font-size": "10px",
                        padding: "1px 5px",
                        color: "var(--ok, var(--m-ok))",
                        "border-color": "var(--ok, var(--m-ok))",
                        cursor: "default",
                      }}
                      title={p.resume_id ? `claude --resume ${p.resume_id}` : "claude running"}
                    >
                      claude
                    </span>
                  </Show>
                  <Show when={sameCwd(p)}>
                    <span
                      class="dc-pending-btn"
                      style={{
                        "font-size": "10px",
                        padding: "1px 5px",
                        color: "var(--info, var(--m-info, var(--m-accent)))",
                        "border-color": "currentColor",
                        cursor: "default",
                      }}
                      title="cwd matches session.cwd"
                    >
                      cwd match
                    </span>
                  </Show>
                  <span class="ink-faint" style={{ "font-size": "11px" }}>
                    {p.session} · {p.window_name || `w${p.window_index}`}
                  </span>
                  <span
                    class="ink-mid"
                    style={{
                      "margin-left": "auto",
                      "font-size": "10.5px",
                      "white-space": "nowrap",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "max-width": "55%",
                      direction: "rtl",
                      "text-align": "left",
                    }}
                    title={p.cwd}
                  >
                    {p.cwd}
                  </span>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default TmuxBindingPicker;
