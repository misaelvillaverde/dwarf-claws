import { Component } from "solid-js";
import type { UnifiedSession } from "../lib/types";

interface Props {
  session: UnifiedSession;
  selected: boolean;
  onClick: () => void;
}

function formatTime(timestamp: string | null, updatedAt: number | null): string {
  const ms = updatedAt ?? (timestamp ? new Date(timestamp).getTime() : 0);
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays < 7) {
    return `${diffDays}d`;
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function shortModel(model: string | null): string {
  if (!model) return "";
  return model
    .replace("claude-", "")
    .replace("anthropic/", "")
    .replace("sonnet-", "s")
    .replace("opus-", "o")
    .replace("haiku-", "h");
}

const SessionItem: Component<Props> = (props) => {
  const badge = () => props.session.source === "OpenClaw" ? "OC" : "CC";
  const badgeColor = () =>
    props.session.source === "OpenClaw" ? "var(--orange)" : "var(--blue)";

  const preview = () => {
    const name = props.session.display_name;
    const msg = props.session.first_user_message_preview;
    return name || (msg ? msg.slice(0, 60) : props.session.id.slice(0, 8));
  };

  return (
    <div
      onClick={props.onClick}
      style={{
        padding: "4px 6px",
        cursor: "pointer",
        background: props.selected ? "var(--bg-selected)" : "transparent",
        "border-left": props.selected ? "2px solid var(--yellow)" : "2px solid transparent",
        display: "flex",
        gap: "6px",
        "align-items": "flex-start",
        "min-height": "28px",
      }}
      onMouseEnter={(e) => {
        if (!props.selected) e.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        if (!props.selected) e.currentTarget.style.background = "transparent";
      }}
    >
      <span
        style={{
          color: badgeColor(),
          "font-weight": "bold",
          "font-size": "11px",
          "flex-shrink": 0,
          "min-width": "20px",
        }}
      >
        {badge()}
      </span>
      <span
        style={{
          flex: 1,
          overflow: "hidden",
          "text-overflow": "ellipsis",
          "white-space": "nowrap",
          color: props.selected ? "var(--yellow)" : "var(--text)",
        }}
      >
        {preview()}
      </span>
      <span
        style={{
          color: "var(--text-dim)",
          "font-size": "11px",
          "flex-shrink": 0,
        }}
      >
        {formatTime(props.session.timestamp, props.session.updated_at)}
      </span>
    </div>
  );
};

export default SessionItem;
