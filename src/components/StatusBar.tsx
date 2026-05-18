import { Component } from "solid-js";

interface Props {
  roomCount: number;
  activeCount: number;
  idleCount: number;
  waitingCount: number;
}

function KeyHint(props: { k: string; a: string }) {
  return (
    <span style={{ display: "inline-flex", gap: "4px", "align-items": "center" }}>
      <kbd style={{
        background: "var(--paper-3)",
        border: "1px solid var(--rule)",
        padding: "0 4px",
        "font-size": "10px",
        color: "var(--ink-2)",
        "font-family": "inherit",
        height: "14px",
        display: "inline-flex",
        "align-items": "center",
        "line-height": 1,
      }}>{props.k}</kbd>
      <span class="ink-faint" style={{ "font-size": "10.5px" }}>{props.a}</span>
    </span>
  );
}

const StatusBar: Component<Props> = (props) => {
  return (
    <div style={{
      display: "flex",
      "align-items": "center",
      gap: "14px",
      padding: "5px 12px",
      "border-top": "1px solid var(--rule)",
      background: "var(--paper-2)",
      "font-size": "11px",
      color: "var(--ink-3)",
      "flex-shrink": 0,
    }}>
      <span>projects <span style={{ color: "var(--ink)", "font-weight": 600 }}>{props.roomCount}</span></span>
      <span style={{ color: "var(--ok)" }}>&bull; working <b>{props.activeCount}</b></span>
      <span style={{ color: "var(--warn)" }}>&bull; waiting <b>{props.waitingCount}</b></span>
      <span>&bull; idle <b style={{ color: "var(--ink)" }}>{props.idleCount}</b></span>
      <span style={{ "margin-left": "auto", display: "inline-flex", gap: "14px" }}>
        <KeyHint k="/" a="search" />
        <KeyHint k="!" a="msg search" />
        <KeyHint k="i" a="inbox" />
        <KeyHint k="j/k" a="nav" />
        <KeyHint k="gg/G" a="top/bot" />
        <KeyHint k="↵" a="select" />
        <KeyHint k="esc" a="clear" />
      </span>
    </div>
  );
};

export default StatusBar;
