import { Component, Show } from "solid-js";
import type { PaneSource } from "../lib/types";

interface Props {
  pane: string | null;
  source: PaneSource | null;
  onBind?: () => void;
  modern?: boolean;
}

function sourceMeta(s: PaneSource | null): { label: string; tone: "ok" | "info" | "warn" | "muted"; tip: string } {
  switch (s) {
    case "manual":
      return { label: "manual", tone: "ok", tip: "You bound this pane explicitly. Persists across restarts." };
    case "resume_id":
      return { label: "resume", tone: "ok", tip: "Matched by claude --resume <session-id> in the pane's process tree." };
    case "scrollback":
      return { label: "scrollback", tone: "ok", tip: "Session UUID found in the pane's recent output (banner / /status / errors). Deterministic match." };
    case "jsonl":
      return { label: "jsonl", tone: "info", tip: "Matched by claude holding the session's .jsonl file open (lsof)." };
    case "active_cwd":
      return { label: "active cwd", tone: "info", tip: "Matched by a running claude process whose cwd equals the session's cwd." };
    case "cwd":
      return { label: "cwd guess", tone: "warn", tip: "No live claude found. Pane was picked because its cwd matches — may be wrong if multiple panes share this directory. Click to bind explicitly." };
    case "none":
    default:
      return { label: "unknown", tone: "muted", tip: "Source not recorded." };
  }
}

const PaneSourceBadge: Component<Props> = (props) => {
  const meta = () => sourceMeta(props.source);
  const isCwdGuess = () => props.source === "cwd";

  const toneColor = () => {
    const t = meta().tone;
    if (t === "ok") return "var(--ok, var(--m-ok))";
    if (t === "warn") return "var(--warn, var(--m-warn))";
    if (t === "info") return "var(--info, var(--m-info, var(--m-accent)))";
    return "var(--ink-3, var(--text-3))";
  };

  return (
    <span
      style={{
        display: "inline-flex",
        "align-items": "center",
        gap: "6px",
        "white-space": "nowrap",
        "font-size": props.modern ? "11.5px" : "10.5px",
      }}
    >
      <span class="mono" style={{ color: "var(--m-info, var(--info))" }}>
        tmux {props.pane}
      </span>
      <Show when={props.source}>
        <span
          title={meta().tip}
          style={{
            color: toneColor(),
            "border": "1px solid currentColor",
            "border-radius": "3px",
            padding: "0 4px",
            "font-size": "10px",
            "letter-spacing": "0.04em",
          }}
        >
          {meta().label}
        </span>
      </Show>
      <Show when={props.onBind}>
        <button
          type="button"
          class="dc-pending-btn ghost"
          onClick={() => props.onBind!()}
          style={{ "font-size": "10px", padding: "1px 5px" }}
          title={isCwdGuess() ? "Pick the right pane manually" : "Bind to a specific pane"}
        >
          bind…
        </button>
      </Show>
    </span>
  );
};

export default PaneSourceBadge;
