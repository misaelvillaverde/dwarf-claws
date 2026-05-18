import { Component } from "solid-js";
import type { UnifiedSession } from "../lib/types";
import { contextUsage } from "../lib/sessionState";

interface Props {
  session: UnifiedSession;
  width?: string;
  height?: string;
  showLabel?: boolean;
  modern?: boolean;
}

const ContextBar: Component<Props> = (props) => {
  const u = () => contextUsage(props.session);
  const color = () => {
    const p = u().pct;
    if (p >= 0.85) return props.modern ? "var(--m-warn)" : "var(--warn)";
    if (p >= 0.6) return props.modern ? "#d97706" : "var(--accent)";
    return props.modern ? "var(--m-ok)" : "var(--ok)";
  };
  const trackBg = () => (props.modern ? "var(--surface-3)" : "var(--paper-3)");
  const labelColor = () => (props.modern ? "var(--text-3)" : "var(--ink-3)");
  return (
    <span
      title={`${Math.round(u().pct * 100)}% context · ${u().label} (${u().source === "tokens" ? "from JSONL usage" : "char approximation"})`}
      style={{
        display: "inline-flex",
        "align-items": "center",
        gap: "5px",
        "font-size": "10.5px",
        color: labelColor(),
      }}
    >
      <span
        style={{
          width: props.width ?? "60px",
          height: props.height ?? "4px",
          background: trackBg(),
          "border-radius": "2px",
          overflow: "hidden",
          position: "relative",
          flex: "0 0 auto",
        }}
      >
        <span
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${Math.max(2, Math.round(u().pct * 100))}%`,
            background: color(),
          }}
        />
      </span>
      {props.showLabel ? `${Math.round(u().pct * 100)}%` : null}
    </span>
  );
};

export default ContextBar;
